/**
 * LIFE-SETTINGS-7: resolve a wurld's EFFECTIVE difficulty (1-7).
 *
 * A wurld either PINS its own level (`difficultyPinned` is a number) or
 * FOLLOWS the live global `profile.difficulty` (pin is null/absent). The
 * resolution is `pinned ?? global ?? 2` — the app-wide default of 2 (the
 * beginner band) is the final fallback when neither is set.
 *
 * Pure so it can be unit-tested and re-run cheaply every render (the
 * LifeScreen memo re-resolves when the global changes mid-story).
 */
export function resolveWurldDifficulty(
  pinned: number | null | undefined,
  global: number | undefined,
): number {
  return pinned ?? global ?? 2;
}
