import { useEffect, useRef, useState } from 'react';
import {
  getDocsFromCache,
  onSnapshot,
  type FirestoreError,
  type Query,
} from 'firebase/firestore';
import type { z } from 'zod';
import { parseDoc } from '@/types/firestore';
import { useAuthStore } from '@/store/authStore';
import * as log from '@/lib/log';
import { trace } from '@/lib/scrollTrace';
import { queryLabel, reportListenerError } from '@/lib/firestoreListenerReport';
import { isFirestoreShutDown } from '@/lib/firestoreShutdown';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/localCache';

export type CollectionResult<T> = {
  data: T[];
  loading: boolean;
  error: FirestoreError | null;
  /**
   * True if the most recent emit came from Firestore's local cache
   * rather than the server. Cache emits can return partial data (e.g.
   * fewer docs than a `limit(N)` query would yield from the server)
   * because the cache has only what's been previously synced. Use
   * `fromCache === false` as the "definitive" gate when you need to
   * distinguish "we don't have all the docs yet" from "the server has
   * confirmed this is everything." Starts `true` and stays `true`
   * until the first server emit.
   */
  fromCache: boolean;
  /**
   * RAW doc count of the most recent snapshot (`snap.docs.length`),
   * BEFORE schema parsing. `data.length` can be smaller when docs
   * fail Zod parse (schema drift) — exhaustion / end-of-stream
   * decisions MUST use this raw count, never the parsed length, or a
   * single drifted doc near a page boundary falsely latches
   * "no more messages" (audit finding 1.9 in
   * docs/CHAT-SCROLL-AUDIT-2026-06.md (deleted 2026-09-29, git history)). For cache-seeded initial
   * states (no snapshot yet) this equals the seeded data length.
   */
  rawSize: number;
};

import {
  readCollectionCache,
  retainLiveCollection,
  writeCollectionCache,
  writeCollectionCacheUnlessLive,
} from '@/lib/snapshotCache';

/**
 * Initial state for a (resetKey, cacheKey): the parsed in-memory cache first,
 * else the localStorage mirror (BOOT-HYDRATION-1), else empty + loading.
 * Mirrored rows are `fromCache: true` — only a server emit confirms them.
 */
function hydrate<T>(
  schema: z.ZodTypeAny,
  queried: boolean,
  resetKey: unknown,
  cacheKey: string | undefined,
): HookState<T> {
  const cached = readCollectionCache<T>(schema, resetKey);
  if (cached)
    return { data: cached, loading: false, error: null, fromCache: true, rawSize: cached.length };
  const mirrored = queried && cacheKey ? readSnapshotCache(cacheKey) : null;
  if (mirrored && mirrored.length > 0) {
    const out: T[] = [];
    for (const row of mirrored) {
      const parsed = parseDoc(schema, row.id, row.data) as T | null;
      if (parsed !== null) out.push(parsed);
    }
    return { data: out, loading: false, error: null, fromCache: true, rawSize: mirrored.length, fromMirror: true };
  }
  return { data: [], loading: queried, error: null, fromCache: true, rawSize: 0 };
}

/** Internal state: `fromMirror` marks rows painted from the localStorage mirror
 *  that nothing but our own pending writes has overlaid yet (BOOT-HYDRATION-14). */
type HookState<T> = CollectionResult<T> & { fromMirror?: true };

/** BOOT-HYDRATION-14 — overlay a pending-writes-only emit onto mirrored rows by id. */
function overlayById<T>(base: T[], over: T[]): T[] {
  const byId = new Map(over.map((r) => [(r as { id?: string }).id, r]));
  const out = base.map((r) => {
    const id = (r as { id?: string }).id;
    const hit = byId.get(id);
    if (hit === undefined) return r;
    byId.delete(id);
    return hit;
  });
  return [...out, ...byId.values()];
}

/**
 * Subscribe to a Firestore query and parse each doc through a Zod schema.
 * Docs that fail to parse are silently dropped (with a Sentry breadcrumb).
 * Pass null/undefined as query to suspend the subscription.
 *
 * Two-stage activation:
 *
 *  1. Eager `getDocsFromCache(query)` fires immediately. This reads from
 *     Firestore's persistent IndexedDB cache without going to the server,
 *     so cold-boots paint from the last-known-good state. With the
 *     boot-time mitigations in `lib/firebase.ts` (popup-redirect resolver
 *     disabled, navigator.onLine spoof, accounts:lookup fetch guard), the
 *     SDK's async queue is unblocked and this typically returns within
 *     ~100ms.
 *
 *  2. Live `onSnapshot` subscription waits for `useAuthStore.user` — the
 *     watch stream RPC needs a valid auth token. Once attached, every
 *     fire merges with the existing state so the UI updates in place.
 */
export function useCollectionSnapshot<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  query: Query | null | undefined,
  /** Stable key for the effect dependency; pass a primitive identifier of the
   * query (e.g. a uid) so the effect doesn't re-subscribe on every render. */
  depKey: string | number | boolean | null | undefined,
  /** Optional coarser key that controls state RESET (data blanking + loading
   * flip back to true). Defaults to `depKey`. Pass a value that changes only
   * when the underlying entity changes (e.g. chatId), while `depKey` may
   * include pagination state (chatId:pageLimit). Without this split, a
   * pagination grow would blank the list while the new larger snapshot
   * resolves. */
  resetKey?: string | number | boolean | null | undefined,
  /** BOOT-HYDRATION-4 — opt-in localStorage mirror key (e.g. `chats:<uid>`).
   * Bounded collections only (BOOT-HYDRATION-5): the mirror paints them in the
   * first render of a cold boot, before the IndexedDB read can resolve. */
  cacheKey?: string,
): CollectionResult<z.infer<TSchema>> {
  type T = z.infer<TSchema>;
  const authReady = useAuthStore((s) => !!s.user);
  const queried = !!query;
  const effectiveResetKey = resetKey === undefined ? depKey : resetKey;

  // Bumped to force a re-subscribe after a listener error. Tied to a
  // window 'online' event and a timed fallback so the spinner contract
  // holds: a visible "loading" state is always backed by either an
  // active subscription or a pending re-attach.
  const [retryEpoch, setRetryEpoch] = useState(0);

  const [state, setState] = useState<HookState<T>>(() =>
    hydrate<T>(schema, queried, effectiveResetKey, cacheKey),
  );
  // Read inside the listener callback, which outlives the render it was made in.
  const fromMirrorRef = useRef(false);
  useEffect(() => {
    fromMirrorRef.current = state.fromMirror === true;
  }, [state.fromMirror]);
  // Reset state when resetKey transitions (e.g. null → real uid, or
  // chatId change). Pagination — which changes depKey but not resetKey
  // — keeps the existing data visible and only re-subscribes via the
  // effect below.
  const [seenResetKey, setSeenResetKey] = useState(effectiveResetKey);
  if (seenResetKey !== effectiveResetKey) {
    setSeenResetKey(effectiveResetKey);
    setState(hydrate<T>(schema, queried, effectiveResetKey, cacheKey));
  }

  useEffect(() => {
    // OBS-FIRESTORE-6 — see useDocSnapshot.
    if (!query || isFirestoreShutDown()) return;

    // Re-subscribing (depKey changed — pagination grew). Reset
    // fromCache to true; the previous query's server confirmation
    // doesn't apply to this new query. Stays true until the new
    // subscription's first server emit lands.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => (s.fromCache ? s : { ...s, fromCache: true }));

    // STAGE 1: Eager cache read. Doesn't help on first-ever install (no
    // cache yet) but on every subsequent boot fills the UI from
    // Firestore's IndexedDB cache before the watch stream connects.
    let alive = true;
    void getDocsFromCache(query)
      .then((snap) => {
        if (!alive) return;
        const out: T[] = [];
        for (const d of snap.docs) {
          const parsed = parseDoc(schema, d.id, d.data());
          if (parsed !== null) out.push(parsed);
        }
        // BOOT-CACHE-6 — on a device the IndexedDB read can lose the race
        // with this listener's own first server emit; the older cache view
        // must not replace the live array the chat-list preview reads.
        writeCollectionCacheUnlessLive(schema, effectiveResetKey, out);
        setState((s) =>
          s.loading
            ? { data: out, loading: false, error: null, fromCache: true, rawSize: snap.docs.length }
            : s,
        );
      })
      .catch(() => {
        /* cache miss / cold install — onSnapshot will deliver */
      });

    // STAGE 2: Live subscription. Gated on auth so the watch stream
    // has a valid token.
    if (!authReady) {
      return () => {
        alive = false;
      };
    }

    // includeMetadataChanges:true so the callback fires when only
    // `metadata.fromCache` transitions (cache emit → server confirms
    // same data). Without this, downstream consumers can't observe
    // the server-confirmation signal that they need for end-of-stream
    // detection — Firestore otherwise suppresses the second callback
    // when the data hasn't changed.
    let retryCleanup: (() => void) | null = null;
    // BOOT-CACHE-5 — this subscription holds the cache entry LIVE while its
    // latest emit is server-sourced. Taken AFTER the write-through below, so
    // a reader never sees "live" over the previous emit's array.
    let releaseLive: (() => void) | null = null;
    const trackLive = (fromCache: boolean) => {
      if (!fromCache && !releaseLive) {
        releaseLive = retainLiveCollection(schema, effectiveResetKey);
      } else if (fromCache && releaseLive) {
        releaseLive();
        releaseLive = null;
      }
    };
    const unsub = onSnapshot(
      query,
      { includeMetadataChanges: true },
      (snap) => {
        // `includeMetadataChanges:true` makes onSnapshot fire on
        // PURE metadata transitions too — most commonly the
        // `fromCache:true → false` flip after server-confirms-the-
        // cached-data. We want to TREAT those as no-ops for the
        // `data` array reference (only update fromCache).
        //
        // CRITICAL: `snap.docChanges()` by default INHERITS the
        // listener's `includeMetadataChanges` setting — so a bare
        // `.docChanges()` would still report every doc whose
        // metadata flipped, even when its content is identical.
        // We MUST pass `{ includeMetadataChanges: false }` to get
        // content-only changes. Without that, this check was a
        // no-op (added 2026-06-04, then re-fixed same day after
        // logs showed the metadata-only emits still propagating).
        //
        // Without this, the cascade was:
        //   1. Re-parse every doc through Zod into NEW JS objects.
        //   2. Build a NEW `out` array reference.
        //   3. `setState({ data: out, ... })` with a new array ref.
        //   4. Every subscriber re-renders. ChatScreen's IIFE in
        //      useMessages produces new `messages`/`pages` refs.
        //      MessageList re-renders, ChatList virtuoso receives a
        //      new `data` array prop, fires a measurement sniff
        //      per item → 1-2px flicker at scroll-settle.
        const hasDocChanges =
          snap.docChanges({ includeMetadataChanges: false }).length > 0;
        // BOOT-HYDRATION-14 — rows still painted from the mirror (only our
        // own pending writes overlaid) are not the SDK's view: its first
        // server answer replaces them even when, to the SDK, nothing changed.
        const confirmsMirror = fromMirrorRef.current && !snap.metadata.fromCache;
        if (!hasDocChanges && !confirmsMirror) {
          // Pure metadata tick. Just update `fromCache` if it moved;
          // keep the `data` array reference stable so downstream
          // memos / virtualizers don't see a "new data" event.
          const nextFromCache = snap.metadata.fromCache;
          trackLive(nextFromCache);
          setState((prev) =>
            prev.fromCache === nextFromCache
              ? prev
              : { ...prev, fromCache: nextFromCache },
          );
          return;
        }
        const out: T[] = [];
        let drift = 0;
        for (const doc of snap.docs) {
          const parsed = parseDoc(schema, doc.id, doc.data());
          if (parsed === null) {
            drift += 1;
          } else {
            out.push(parsed);
          }
        }
        if (drift > 0) log.warn('[useCollectionSnapshot] schema drift', { drift });
        // BOOT-HYDRATION-14 — a cache emit made only of our own un-acked
        // writes is not the collection. With no local copy of the rest (an
        // evicted or recovery-cleared IndexedDB, or the emulator's memory
        // cache) it holds just the written docs — e.g. the tutor contact
        // `ensureTutorChat` re-merges at every boot — and replacing the
        // mirrored rows with it blanked every other contact. Overlay it by id
        // instead, and keep it out of both caches until a real emit lands.
        const pendingOnly =
          snap.metadata.fromCache &&
          snap.docs.length > 0 &&
          snap.docs.every((d) => d.metadata?.hasPendingWrites === true);
        if (pendingOnly && fromMirrorRef.current) {
          setState((prev) =>
            prev.fromMirror
              ? { ...prev, data: overlayById(prev.data, out), loading: false, error: null }
              : { data: out, loading: false, error: null, fromCache: true, rawSize: snap.docs.length },
          );
          return;
        }
        writeCollectionCache(schema, effectiveResetKey, out);
        // BOOT-HYDRATION-3 — write through so the next cold boot paints this
        // state in its first render. Only content emits reach here, and the
        // write itself skips an unchanged payload (BOOT-HYDRATION-12).
        if (cacheKey) {
          writeSnapshotCache(cacheKey, snap.docs.map((d) => ({ id: d.id, data: d.data() })));
        }
        trackLive(snap.metadata.fromCache);
        // Structured trace instead of the previous always-on console
        // log (which shipped to prod — see
        // docs/CHAT-SCROLL-AUDIT-2026-06.md (deleted 2026-09-29, git history) §4.3). High-volume but
        // load-bearing for emit-order attribution; the ring absorbs
        // it and wurldScrollDebug='2' mirrors it live. rawLen vs len
        // exposes parse-drops (audit finding 1.9) per emit.
        trace('load', 'fs-emit', {
          depKey,
          len: out.length,
          rawLen: snap.docs.length,
          fromCache: snap.metadata.fromCache,
          hasPendingWrites: snap.metadata.hasPendingWrites,
          // Several hooks key their listener on a bare uid (useChats,
          // useContacts, useFlashcards) — depKey alone can't attribute
          // an emit storm to a collection. First doc's path
          // disambiguates (2026-06-12 write-loop hunt).
          path0: snap.docs[0]?.ref.path ?? null,
          // The docs this emit actually changed — path0 alone
          // misattributes (it's the FIRST query doc, not the written
          // one; a 109-emit storm initially read as tutor-contact
          // writes because the tutor sorts first).
          changed: snap.docChanges().slice(0, 3)
            .map((ch) => `${ch.type}:${ch.doc.ref.path.split('/').pop()}`),
        });
        setState({
          data: out,
          loading: false,
          error: null,
          fromCache: snap.metadata.fromCache,
          rawSize: snap.docs.length,
        });
      },
      (err) => {
        // OBS-COVER-5 — non-transient codes reach Sentry (once per query + code).
        reportListenerError(err, { label: queryLabel(query), hook: 'useCollectionSnapshot' });
        // Preserve last-good data on error so a transient permission
        // denied or network blip doesn't wipe the UI. fromCache stays
        // as-is — DOWNSTREAM CONTRACT: if fromCache is true the UI
        // will render a spinner, so we MUST keep a pending re-attach
        // alive (online listener + timed backstop) so that spinner is
        // always backed by a subscription that WILL deliver.
        setState((s) => ({
          data: s.data,
          loading: false,
          error: err,
          fromCache: s.fromCache,
          rawSize: s.rawSize,
        }));
        const trigger = () => setRetryEpoch((n) => n + 1);
        const onOnline = () => {
          window.removeEventListener('online', onOnline);
          trigger();
        };
        window.addEventListener('online', onOnline);
        const backstop = window.setTimeout(() => {
          window.removeEventListener('online', onOnline);
          trigger();
        }, 10_000);
        retryCleanup = () => {
          window.removeEventListener('online', onOnline);
          window.clearTimeout(backstop);
        };
      },
    );
    return () => {
      alive = false;
      unsub();
      releaseLive?.();
      retryCleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema, depKey, authReady, retryEpoch]);

  return state;
}
