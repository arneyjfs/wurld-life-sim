import { useMemo } from 'react';
import { levelFor } from '@/lib/level';
import { useUserProfile } from '@/hooks/useUserProfile';
import { resolveWurldDifficulty } from '@/lib/life/resolveDifficulty';
import type { Difficulty, LifeWorld } from '@/types/firestore';

/**
 * LIFE-SETTINGS-7: resolve the wurld's effective difficulty and hand back
 * a world clone with `difficulty` overridden to it — the single value the
 * node engine (and every generator downstream of it) reads.
 *
 * The live global difficulty comes from the SAME profile hook the Settings
 * slider writes (`useUserProfile` → `profile.difficulty`), so an unpinned
 * wurld tracks a mid-story change in Settings: the memo re-resolves the
 * next render and the new level applies on the next generation. A pinned
 * wurld ignores the global and stays at its fixed level.
 *
 * `globalDifficulty` is also returned so the ⋯ menu can render the
 * "Following global · Level X" automatic state without a second listener.
 */
export function useEffectiveWorld(
  uid: string | null,
  world: LifeWorld | null,
): { effectiveWorld: LifeWorld | null; globalDifficulty: Difficulty } {
  const profile = useUserProfile(uid);
  // XP-LANG-4 — the user's level in THIS wurld's practice language.
  const globalDifficulty = levelFor(profile.data, world?.practiceLanguage);
  const effectiveWorld = useMemo<LifeWorld | null>(
    () =>
      world
        ? {
            ...world,
            difficulty: resolveWurldDifficulty(
              world.difficultyPinned,
              globalDifficulty,
            ) as Difficulty,
          }
        : null,
    [world, globalDifficulty],
  );
  return { effectiveWorld, globalDifficulty };
}
