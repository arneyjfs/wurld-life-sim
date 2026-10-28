import { useEffect, useState } from 'react';
import {
  doc,
  getDocFromCache,
  onSnapshot,
  type DocumentReference,
  type FirestoreError,
} from 'firebase/firestore';
import type { z } from 'zod';
import { db } from '@/lib/firebase';
import { parseDoc } from '@/types/firestore';
import { useAuthStore } from '@/store/authStore';
import {
  readSnapshotCache,
  writeSnapshotCache,
} from '@/lib/localCache';
import {
  deleteDocCache,
  readDocCache,
  writeDocCache,
} from '@/lib/snapshotCache';
import * as log from '@/lib/log';
import { collectionLabelOfPath, reportListenerError } from '@/lib/firestoreListenerReport';
import { isFirestoreShutDown } from '@/lib/firestoreShutdown';

export type SnapshotResult<T> = {
  data: T | null;
  loading: boolean;
  error: FirestoreError | null;
};

function hydrateFromCache<T>(
  schema: z.ZodTypeAny,
  wantsDoc: boolean,
  path: string | null | undefined,
  cacheKey: string | undefined,
): SnapshotResult<T> {
  if (!wantsDoc) return { data: null, loading: false, error: null };
  // In-memory cache by path — fastest path. Always preferred when
  // available because it's already parsed.
  const cached = readDocCache<T>(path);
  if (cached !== undefined) {
    return { data: cached, loading: false, error: null };
  }
  // localStorage cache (opt-in via cacheKey) — falls through to here
  // on a cold mount where the in-memory cache hasn't been seeded yet
  // this session.
  if (cacheKey) {
    const cachedRows = readSnapshotCache(cacheKey);
    if (cachedRows && cachedRows.length > 0) {
      const first = cachedRows[0];
      if (first) {
        const parsed = parseDoc(schema, first.id, first.data) as T | null;
        if (parsed !== null) {
          return { data: parsed, loading: false, error: null };
        }
      }
    }
  }
  return { data: null, loading: wantsDoc, error: null };
}

/**
 * Subscribe to a single Firestore document by path and parse it through a
 * Zod schema. Returns `null` data if the doc doesn't exist or fails to parse.
 *
 * Pass null/undefined as path to suspend the subscription (use when waiting
 * on a parent value like uid).
 *
 * When `cacheKey` is provided, the latest doc data is mirrored to
 * localStorage at that key and read back synchronously in the `useState`
 * initialiser. This is opt-in and intended only for tiny, route-critical
 * docs (currently just the user profile via `useUserProfile`) where a
 * synchronous first-paint matters — it lets routes.tsx decide whether to
 * show ProfileSetupScreen vs AppShell before any IndexedDB roundtrip.
 *
 * Most documents rely on the Firestore IndexedDB cache via `getDocFromCache`
 * alone. Bounded collections have the same opt-in on `useCollectionSnapshot`
 * (BOOT-HYDRATION-5).
 */
export function useDocSnapshot<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  path: string | null | undefined,
  cacheKey?: string,
): SnapshotResult<z.infer<TSchema>> {
  type T = z.infer<TSchema>;
  const authReady = useAuthStore((s) => !!s.user);
  const wantsDoc = !!path;

  const [state, setState] = useState<SnapshotResult<T>>(() =>
    hydrateFromCache<T>(schema, wantsDoc, path, cacheKey),
  );
  // Re-hydrate synchronously during render when path/cacheKey change
  // (e.g. null → real path once auth restores). React-supported pattern:
  // the in-flight render is discarded, the next render uses the new state.
  // Without this, the first render after path lands shows the prior state
  // and ProfileSetupScreen could flash briefly before onSnapshot delivers.
  const [seen, setSeen] = useState<{ path: string | null | undefined; cacheKey: string | undefined }>({
    path,
    cacheKey,
  });
  if (seen.path !== path || seen.cacheKey !== cacheKey) {
    setSeen({ path, cacheKey });
    if (!path) {
      setState({ data: null, loading: false, error: null });
    } else {
      setState(hydrateFromCache<T>(schema, true, path, cacheKey));
    }
  }

  useEffect(() => {
    // OBS-FIRESTORE-6 — the recovery terminated the client; keep the last
    // state until the reload rather than throw on every re-render.
    if (!path || isFirestoreShutDown()) return;
    const ref = doc(db, path) as DocumentReference;

    // STAGE 1: Eager Firestore cache read regardless of auth.
    let alive = true;
    // BOOT-HYDRATION-9 — have we seen this doc from a source that is not our
    // OWN un-acked write? Scoped to the effect, so it resets with the path.
    //
    // `recordLastSeen` stamps the user doc at boot. On a cold Firestore cache
    // there is no server copy to merge onto, so the SDK's latency-compensated
    // local view is a document containing ONLY the stamped fields — and that
    // resolved as `{ loading: false, data: <partial> }`. The onboarding gate
    // read it as a real profile with every field missing and showed the legal
    // / profile-completion screen until the server round-trip landed. Before
    // that first real snapshot, "the doc exists" is circular: it exists
    // because we wrote to it, and what we wrote is not what it contains.
    //
    // Only the pre-resolution window is guarded. Once real data has arrived,
    // pending writes are the optimistic-edit path and must apply immediately.
    let resolved = false;
    //
    // NARROWED 2026-10-02: also require the snapshot NOT to be confirmed server
    // data. `hasPendingWrites` alone discards a server snapshot that merely has
    // a later write riding on top (`fromCache: false, hasPendingWrites: true`),
    // which is real data and the only thing that would have resolved `loading`.
    // The circularity this guard exists to break is a LOCAL-ONLY view of our
    // own write, i.e. `fromCache: true`.
    const isOurOwnEcho = (snap: { metadata?: { hasPendingWrites?: boolean; fromCache?: boolean } }) =>
      !resolved && snap.metadata?.hasPendingWrites === true && snap.metadata?.fromCache !== false;
    void getDocFromCache(ref)
      .then((snap) => {
        if (!alive) return;
        if (!snap.exists()) return;
        if (isOurOwnEcho(snap)) return;
        resolved = true;
        const parsed = parseDoc(schema, snap.id, snap.data());
        if (parsed !== null) writeDocCache(path, parsed);
        setState((s) =>
          s.loading ? { data: parsed, loading: false, error: null } : s,
        );
      })
      .catch(() => {
        /* cache miss — onSnapshot will deliver */
      });

    // STAGE 2: Live subscription gated on auth.
    if (!authReady) {
      return () => {
        alive = false;
      };
    }

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          resolved = true;
          // BOOT-HYDRATION-13 — offline, a doc missing from the SDK's local
          // cache reports exists() === false with fromCache: true. That is
          // "not in this cache", not "deleted": it must not erase what the
          // mirror (or an earlier snapshot) already knows. Only the server
          // (fromCache: false) or our own pending delete may clear known
          // data. With nothing known, the miss still resolves to null.
          const cacheMissOnly =
            snap.metadata?.fromCache === true && snap.metadata?.hasPendingWrites !== true;
          if (!cacheMissOnly) deleteDocCache(path);
          setState((s) =>
            cacheMissOnly && s.data !== null
              ? s
              : { data: null, loading: false, error: null },
          );
          return;
        }
        if (isOurOwnEcho(snap)) return; // BOOT-HYDRATION-9
        resolved = true;
        const data = snap.data();
        const parsed = parseDoc(schema, snap.id, data);
        if (parsed === null) {
          log.warn('[useDocSnapshot] schema drift', { path });
        } else {
          writeDocCache(path, parsed);
        }
        setState({ data: parsed, loading: false, error: null });
        if (cacheKey) writeSnapshotCache(cacheKey, [{ id: snap.id, data }]);
      },
      (err) => {
        // OBS-COVER-5 — labelled by collection names only, never the doc id.
        reportListenerError(err, { label: collectionLabelOfPath(path), hook: 'useDocSnapshot' });
        // Preserve last-good data on error so transient blips don't
        // blank the chat header / settings / profile mid-session.
        setState((s) => ({ data: s.data, loading: false, error: err }));
      },
    );
    return () => {
      alive = false;
      unsub();
    };
  }, [schema, path, authReady, cacheKey]);

  return state;
}
