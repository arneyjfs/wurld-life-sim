/**
 * LIFE-WORLD-9: read-only scene thumbnail for the overview WorldCard.
 *
 * Resolves the world's most-recently-persisted scene SVG WITHOUT ever
 * triggering generation (zero Gemini calls — the overview must stay
 * free). Resolution ladder:
 *   1. `descriptorFromWorld(world)` — null for fresh worlds → no banner.
 *   2. Sync localStorage cache hit (`readBackdropCache`).
 *   3. Bundled fallback silhouette immediately, then the async
 *      Firestore mirror (`readPersistentBackdrop`) swaps in if it hits —
 *      and re-seeds the local cache so the next render (and the
 *      LifeScreen open) is a sync hit.
 *
 * Same ladder as `useLifeBackdrop` (src/hooks/useLifeBackdrop.ts) MINUS the
 * generation step. Persisted SVGs were sanitised at generation time
 * (see src/lib/life/sanitizeSvg.ts) — no re-sanitisation on read,
 * matching BackdropStage.
 *
 * Spec: docs/specs/life-sim.md §10.6 (LIFE-WORLD-9).
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { getFallbackBackdrop } from '@/lib/life/fallbackBackdrops';
import { pickFallback } from '@/lib/life/backdropDescriptor';
import { readBackdropCache, writeBackdropCache } from '@/lib/life/backdropCache';
import { readPersistentBackdrop } from '@/lib/life/backdrops';
import type { LifeWorld } from '@/types/firestore';
import { descriptorFromWorld } from './backdropDescriptorForLife';

export function useWorldThumbnail(world: LifeWorld): { svg: string | null } {
  const uid = useAuthStore((s) => s.user?.uid ?? null);
  const descriptor = descriptorFromWorld(world);

  // Lazy initializer so a sync cache hit (or the silhouette) paints on
  // the very first frame — no banner pop-in after mount. Cards are
  // keyed by world.id in the overview list, so mount-time init is
  // per-world; the effect below handles post-mount descriptor changes.
  const [svg, setSvg] = useState<string | null>(() => {
    if (!descriptor) return null;
    return (
      readBackdropCache(descriptor, world.id) ??
      getFallbackBackdrop(pickFallback(descriptor))
    );
  });

  // Same setState-in-effect shape as useLifeBackdrop: the cache lookup is
  // sync but the Firestore fallback isn't, and both feed one state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!descriptor) {
      setSvg(null);
      return;
    }
    // 1. Sync localStorage hit — done; never touch the network.
    const cached = readBackdropCache(descriptor, world.id);
    if (cached) {
      setSvg(cached);
      return;
    }
    // 2. Silhouette while (and in case) the Firestore read misses —
    //    banner presence stays deterministic on descriptor presence.
    setSvg(getFallbackBackdrop(pickFallback(descriptor)));
    if (!uid) return;
    let cancelled = false;
    void (async () => {
      const persisted = await readPersistentBackdrop(uid, world.id, descriptor);
      if (cancelled || !persisted) return;
      // Re-seed the local cache so subsequent renders are sync hits.
      writeBackdropCache(descriptor, world.id, persisted);
      setSvg(persisted);
    })();
    return () => {
      cancelled = true;
    };
    // descriptor is rebuilt every render by descriptorFromWorld — depend
    // on its identity-bearing fields instead of the object (same pattern
    // + justification as useLifeBackdrop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor?.locationType, descriptor?.vibe, descriptor?.persistent, descriptor?.label, world.id, uid]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { svg };
}
