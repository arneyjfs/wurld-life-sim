/**
 * LIFE-SCENE-13: bio scene-memory de-accretion.
 *
 * `world.bio` is the frozen `<bio>…</bio>` character sheet followed by an
 * accreting tail of `\n<completedScene …>…</completedScene>` lines —
 * one appended by `closeSceneFlow` (LIFE-SCENE-10) per scene that
 * resolves. The bio is embedded VERBATIM in the stable prefix of every step
 * prompt (`prompts/step.ts`, LIFE-CTX-1), so an unbounded tail bloats every
 * turn's token bill AND trends the world doc toward Firestore's 1 MiB ceiling.
 *
 * We cap the tail to the last `MAX_BIO_SCENE_MEMORIES` entries. Nothing is
 * lost permanently: every scene outcome is also recorded — as a superset,
 * with `keyMomentsForArc` — in its arc's `completedSceneMemories[]`
 * (LIFE-WORLD-ARC-2), archived to `completedArcs/{arcId}` on chapter close.
 * The bio tail is just the recent-history window the prompt sees; older
 * continuity rides the `storyLog` spine (LIFE-STORY-LOG-2) + archived arcs.
 */

/** The literal that opens every appended memory line. `escapeText` in
 *  `sceneLifecycle.ts` turns any `<` in the outcome/title into `&lt;`,
 *  so this marker can NEVER appear inside a memory's body — the split is
 *  unambiguous even when an outcome sentence mentions a tag. */
const MEMORY_MARKER = '\n<completedScene';

/** How many `<completedScene>` lines the bio tail retains. ~8 recent
 *  scene outcomes ≈ 1-2 chapters of history — enough for the model to
 *  keep continuity; older ones live in the archived arcs. */
export const MAX_BIO_SCENE_MEMORIES = 8;

/** Trim a bio's `<completedScene>` tail to its last `max` entries. The
 *  base `<bio>` character-sheet block is preserved untouched, and a bio at
 *  or below the cap is returned BYTE-IDENTICAL (so the prompt's stable
 *  prefix isn't perturbed unnecessarily — LIFE-CTX-1). */
export function capSceneMemories(
  bio: string,
  max: number = MAX_BIO_SCENE_MEMORIES,
): string {
  const first = bio.indexOf(MEMORY_MARKER);
  if (first === -1) return bio; // no memory tail yet
  const base = bio.slice(0, first);
  const tail = bio.slice(first); // starts with the marker
  // Zero-width lookahead split keeps each `\n<completedScene…>` line whole
  // and prefixed; the leading '' (before the first marker) is filtered out.
  const memories = tail
    .split(/(?=\n<completedScene)/)
    .filter((chunk) => chunk.startsWith(MEMORY_MARKER));
  if (memories.length <= max) return bio;
  return base + memories.slice(memories.length - max).join('');
}

/** Append a new scene-memory line to the bio, then cap the tail. The
 *  single entry point `closeSceneFlow` uses, so the append and the cap
 *  can never drift apart. */
export function appendSceneMemory(
  bio: string,
  memoryLine: string,
  max: number = MAX_BIO_SCENE_MEMORIES,
): string {
  return capSceneMemories(bio + memoryLine, max);
}
