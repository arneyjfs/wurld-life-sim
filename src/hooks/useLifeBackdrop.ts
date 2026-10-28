/**
 * LIFE-BACKDROP-1 / LIFE-FAIL-3 / LIFE-FAIL-4 driver hook.
 *
 * Given a descriptor, resolve to an SVG via this priority order:
 *   1. localStorage cache hit (persistent only)
 *   2. fresh Gemini gen → cache → emit
 *   3. fallback silhouette (LIFE-BACKDROP-8) when gen fails
 *
 * The hook also exposes a `regenerate` callback so a future
 * character-sheet "rebuild this café" affordance has somewhere to
 * hook in (LIFE-BACKDROP-10) — not wired up in Phase A.2.
 */
import { useEffect, useRef, useState } from 'react';
import * as log from '@/lib/log';
import { useAuthStore } from '@/store/authStore';
import { generateBackdrop, type BackdropGenResult } from '@/lib/life/generateBackdrop';
import { getFallbackBackdrop } from '@/lib/life/fallbackBackdrops';
import {
  pickFallback,
  type BackdropDescriptor,
} from '@/lib/life/backdropDescriptor';
import {
  fullCacheKey,
  readBackdropCache,
  writeBackdropCache,
} from '@/lib/life/backdropCache';
import {
  readPersistentBackdrop,
  writePersistentBackdrop,
} from '@/lib/life/backdrops';

/**
 * In-flight backdrop generations, keyed by the FULL cache key
 * (`worldId::descriptorKey`). A second effect run for the same backdrop —
 * React StrictMode's dev double-invoke, or any concurrent trigger —
 * shares this ONE Gemini call instead of firing a duplicate. Without it,
 * every cache-MISS backdrop generated twice (2× tokens); the effect's
 * `cancelled` flag only drops the late RESULT, never the already-fired
 * network call. Cleared when the generation settles.
 */
const inFlightBackdropGens = new Map<string, Promise<BackdropGenResult>>();

export type LifeBackdropStatus = 'cache' | 'generating' | 'ready' | 'fallback';

/**
 * LIFE-BACKDROP-7: whether the "Building your wurld…" placeholder affordance
 * (pill + shimmer) should show over the backdrop. True during an active Gemini
 * render ('generating') OR the FRESH-WORLD placeholder window — the fallback
 * silhouette is up ('fallback'), no real backdrop can generate yet
 * (`!canGenerate` — no `backdropIntent`/`currentBackdrop`), AND there's no history
 * (`eventCount === 0`). The event-count guard excludes a resumed world that
 * has events but momentarily lacks a `currentBackdrop`: that silhouette must NOT
 * read as "building" — the world is already underway. Also excludes the
 * LIFE-BACKDROP-8 terminal-failure silhouette, which sits at `canGenerate === true`.
 */
export function backdropBuildingVisible(
  status: LifeBackdropStatus,
  canGenerate: boolean,
  eventCount: number,
): boolean {
  if (status === 'generating') return true;
  return status === 'fallback' && !canGenerate && eventCount === 0;
}

export type LifeBackdropState = {
  /** Current SVG markup to render. Always set — when gen is in
   *  flight, this is the fallback silhouette so the screen never
   *  blanks. */
  svg: string;
  /** Where the current SVG came from. */
  status: LifeBackdropStatus;
  /** Re-runs the gen pipeline. Cache is bypassed on retry. */
  regenerate: () => void;
};

export function useLifeBackdrop(
  descriptor: BackdropDescriptor | null,
  worldId: string | null,
  practiceLanguage: string | null,
  /** LIFE-BACKDROP-7: gate the async gen pipeline. When false (a fresh
   *  world's onboarding, before any real `backdropIntent` / `currentBackdrop`
   *  exists), the descriptor is only a seed GUESS — show its silhouette
   *  placeholder but do NOT burn a Gemini render that the first beat's
   *  real backdrop will immediately replace. A cache/persistent hit still
   *  renders; only the fresh generation is suppressed. Defaults true. */
  generate: boolean = true,
): LifeBackdropState {
  const uid = useAuthStore((s) => s.user?.uid ?? null);
  const fallbackKey = descriptor ? pickFallback(descriptor) : 'apartment_bedroom';
  const fallbackSvg = getFallbackBackdrop(fallbackKey);

  const [state, setState] = useState<{ svg: string; status: LifeBackdropStatus }>({
    svg: fallbackSvg,
    status: 'fallback',
  });
  const [regenNonce, setRegenNonce] = useState(0);
  // Track the descriptor that the current generation belongs to so a
  // late-arriving response for an obsolete descriptor doesn't
  // overwrite the current backdrop.
  const liveKeyRef = useRef<string | null>(null);

  // Backdrop resolution is inherently async — cache lookup is sync, but
  // the gen call isn't, and we need to update state across both
  // paths. setState-in-effect is the right shape here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!descriptor) {
      setState({ svg: fallbackSvg, status: 'fallback' });
      return;
    }
    // Use the same cache-key shape as descriptorCacheKey so this
    // ref reflects the actual cache identity (label-first, locationType
    // + vibe fallback). Without this, swapping between two libraries
    // with the same locationType/vibe would race responses.
    const key = `${worldId ?? '__no_world__'}::${descriptor.label
      ? descriptor.label.toLowerCase().trim()
      : `${descriptor.locationType}::${descriptor.vibe}`}`;
    liveKeyRef.current = key;

    // 1. localStorage cache (synchronous, fastest path) — skip on
    //    regenerate so retries actually re-render.
    if (regenNonce === 0) {
      const cached = readBackdropCache(descriptor, worldId);
      if (cached) {
        setState({ svg: cached, status: 'cache' });
        return;
      }
    }

    // LIFE-BACKDROP-7: onboarding placeholder. When there's no real backdrop
    // yet (fresh world, no backdropIntent / currentBackdrop), the descriptor is
    // only a seed GUESS — show its silhouette and DO NOT generate. The
    // first beat's real backdropIntent triggers the single real render, so we
    // never burn a fallback gen that's immediately replaced.
    if (!generate) {
      setState({ svg: fallbackSvg, status: 'fallback' });
      return;
    }

    // 2. Generate fresh. While in flight, show the fallback
    //    silhouette so the screen isn't blank.
    setState({ svg: fallbackSvg, status: 'generating' });

    let cancelled = false;
    void (async () => {
      // 2a. LIFE-DATA-4 cross-device fallback: before burning a fresh
      //     Gemini render, check the player's Firestore lifeBackdrops
      //     index. If they've already seen this descriptor in another
      //     session (or another device), reuse the persisted SVG and
      //     re-seed the local cache. Per LIFE-BACKDROP-3 (revised), this
      //     fires for transient descriptors too — resume must hit
      //     cache. Only skipped when regenNonce > 0 (user asked for a
      //     fresh render).
      if (regenNonce === 0 && uid && worldId) {
        const persistent = await readPersistentBackdrop(uid, worldId, descriptor);
        if (cancelled || liveKeyRef.current !== key) return;
        if (persistent) {
          writeBackdropCache(descriptor, worldId, persistent);
          setState({ svg: persistent, status: 'cache' });
          return;
        }
      }

      // Dedup concurrent gens for the SAME backdrop (StrictMode double-invoke
      // in dev, or any rapid re-trigger): reuse an in-flight promise for
      // this cache key so the Gemini call fires ONCE, not twice.
      const genKey = fullCacheKey(descriptor, worldId);
      let genPromise = inFlightBackdropGens.get(genKey);
      if (!genPromise) {
        genPromise = generateBackdrop({
          descriptor,
          practiceLanguage: practiceLanguage ?? 'English',
        });
        inFlightBackdropGens.set(genKey, genPromise);
        // Trailing `.catch` so the cleanup side-chain never surfaces as an
        // unhandled rejection if `generateBackdrop` ever rejects (it returns a
        // typed result today; the awaiter below handles the value/rejection).
        void genPromise
          .finally(() => inFlightBackdropGens.delete(genKey))
          .catch(() => undefined);
      }
      // `generateBackdrop` returns a typed result and never throws, but wrap
      // defensively so an unexpected rejection can NEVER strand the backdrop in
      // 'generating' forever (a permanent shimmer) — it always lands on the
      // fallback silhouette.
      let result: BackdropGenResult;
      try {
        result = await genPromise;
      } catch (err) {
        if (cancelled || liveKeyRef.current !== key) return;
        log.warn('life.backdrop.gen-threw', { descriptor, err: String(err) });
        setState({ svg: fallbackSvg, status: 'fallback' });
        return;
      }
      if (cancelled || liveKeyRef.current !== key) return;

      // 3. LIFE-FAIL-3: a PERSISTENT backdrop gets ONE retry on a transient gen
      //    failure before falling back — the backdrop SVG dominates a world's
      //    first impression, so it's worth one more attempt. LIFE-FAIL-4:
      //    TRANSIENT backdrops skip the retry (a cheap render isn't worth
      //    re-firing). A manual regenerate (regenNonce > 0) also skips the
      //    auto-retry — the user drove that attempt themselves. The retry is a
      //    fresh call (not the settled in-flight promise), so it's a genuine
      //    second attempt.
      if (result.kind !== 'ok' && descriptor.persistent && regenNonce === 0) {
        log.warn('life.backdrop.gen-retry', { kind: result.kind, descriptor });
        try {
          result = await generateBackdrop({
            descriptor,
            practiceLanguage: practiceLanguage ?? 'English',
          });
        } catch (err) {
          if (cancelled || liveKeyRef.current !== key) return;
          log.warn('life.backdrop.gen-threw', { descriptor, err: String(err) });
          setState({ svg: fallbackSvg, status: 'fallback' });
          return;
        }
        if (cancelled || liveKeyRef.current !== key) return;
      }

      if (result.kind === 'ok') {
        writeBackdropCache(descriptor, worldId, result.svg);
        if (uid && worldId) {
          void writePersistentBackdrop(uid, worldId, descriptor, result.svg);
        }
        setState({ svg: result.svg, status: 'ready' });
      } else {
        // LIFE-BACKDROP-8 / LIFE-FAIL-3/4: terminal fallback silhouette — never an
        // infinite shimmer. `backdropBuildingVisible` returns false for this
        // terminal-failure silhouette when a real backdrop could generate
        // (canGenerate === true), so the "Building your wurld…" pill is hidden.
        log.warn('life.backdrop.gen-fell-back', {
          kind: result.kind,
          descriptor,
        });
        setState({ svg: fallbackSvg, status: 'fallback' });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor?.locationType, descriptor?.vibe, descriptor?.persistent, descriptor?.label, worldId, regenNonce, uid, practiceLanguage, generate]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return {
    svg: state.svg,
    status: state.status,
    regenerate: () => setRegenNonce((n) => n + 1),
  };
}
