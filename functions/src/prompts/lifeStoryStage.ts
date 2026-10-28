/**
 * LIFE-STORY-STAGE-1/-3 — how far into its FIRST chapter a world is, and what a
 * SCENE that early may be about.
 *
 * ── WHAT WAS DUPLICATED HERE, AND HOW IT ENDED ─────────────────────────────
 *
 * `src/lib/life/prompts/storyStage.ts` held three things with three different
 * futures, so this file was never a copy of it. ✅ **All three resolved with
 * SRV-PROMPT-8..13 batch 8; the client module is DELETED.**
 *
 *   | artefact                           | was          | now                                |
 *   |------------------------------------|--------------|------------------------------------|
 *   | `storyStage` + the three `STAGE_*` | DUPLICATED   | single copy, HERE (`lifeStep.ts` and `lifeStepBlocks.ts` import it) |
 *   | `renderSceneStage`                 | MOVED, whole | unchanged — `life_scene_gen` only  |
 *   | `renderStoryStage` + `CAST_FLOOR`  | left behind  | moved to `lifeStepBlocks.ts`, which imports `STAGE_UNDERWAY_AT` from here rather than restating it |
 *
 * The behavioural parity guard in `tests/playthrough/serverPromptParity.test.ts`
 * that covered the duplicated half is gone with it; what replaced it guards the
 * things that did NOT expire (the scene-pace constants, the cadence thresholds,
 * the shape sentences), so the file did not simply get shorter.
 *
 * ⚠ CONSUMERS WERE CHECKED, NOT ASSUMED — and this is worth keeping now the
 * duplication is closed, because it is what made closing it cheap. Batch 3's
 * own note records getting this wrong twice in one change: three shared
 * artefacts, three different retiring batches, and the first reading had all
 * three the same. `git grep` for `storyStage` / `renderSceneStage` /
 * `renderStoryStage` is a thirty-second check and it is the only thing that
 * stood between "duplicated until batch 8" and "duplicated forever because
 * nobody looked".
 *
 * ── WHY THE CLASSIFIER IS SERVER-SIDE AT ALL ────────────────────────────────
 *
 * The client could compute the stage and send the enum, the way batch 1 sends
 * `timeOfDay`. It does not, and the difference matters: `timeOfDay` is a fact
 * about the world that only the client holds, whereas the STAGE is a THRESHOLD
 * DECISION — it decides what the model is allowed to be told. `chapterNumber`
 * and `chapterTurns` are the raw counters and they travel; where the ladder's
 * rungs sit stays here, next to the prose those rungs gate, where a
 * `deploy:prod:functions` can move them. It is the same split as LIFE-FRONT-8's
 * "the model never sees the numbers and never decides the threshold", one level
 * up.
 */

export type StoryStage = "arrival" | "settling" | "stirring" | "underway";

/** Turn thresholds inside chapter 1. A chapter runs ~25-40 turns, so the three
 *  held-back stages take roughly its first half. Duplicated from
 *  `src/lib/life/prompts/storyStage.ts`; the parity guard asserts both copies
 *  classify the same turn the same way. */
export const STAGE_SETTLING_AT = 6;
export const STAGE_STIRRING_AT = 13;
export const STAGE_UNDERWAY_AT = 21;

export function storyStage(opts: {
  /** 1 for a world's first chapter. Anything higher is `underway`. */
  chapterNumber: number;
  /** `storyLog.turns` — player turns THIS chapter. */
  chapterTurns: number;
}): StoryStage {
  if (opts.chapterNumber > 1) return "underway";
  if (opts.chapterTurns >= STAGE_UNDERWAY_AT) return "underway";
  if (opts.chapterTurns >= STAGE_STIRRING_AT) return "stirring";
  if (opts.chapterTurns >= STAGE_SETTLING_AT) return "settling";
  return "arrival";
}

/**
 * The SCENE PLANNER's copy of the stage — what a scene may be ABOUT this early.
 *
 * The step prompt's own stage block (`renderStoryStage`, in
 * `lifeStepBlocks.ts` since batch 8) governs what a TURN may contain, and it is
 * not enough on its own: a scene's `subject` rides into every step prompt for as long as the
 * scene runs, so a first scene planned around the front's agenda re-introduces
 * the pressure into exactly the turns the step-level block just cleared it out
 * of. The subject becomes the leak.
 *
 * Scene-scoped wording, deliberately not `renderStoryStage`'s: that block talks
 * about beats and forbidden lines, and this one is about a SUBJECT.
 */
export function renderSceneStage(stage: StoryStage): string {
  if (stage === "underway") return "";
  const subject =
    stage === "stirring"
      ? `Its subject may be the FIRST small, concrete thing the player notices about this world — a discrepancy, an absence, a name that keeps coming up. Not a revelation, and nobody explains it to them.`
      : `Its subject is ORDINARY: settling in, learning the work, a favour, a meal, a repair, meeting someone properly, getting one small thing right. NOT what any <force> in <inMotion> is driving at — those have not reached the player yet. A scene whose subject is a secret, a threat, a warning or a mystery is the WRONG scene for this stage; rewrite it as something the player could tell a friend about without it sounding like a thriller.`;
  return (
    `<storyStage stage="${escapeAttr(stage)}">This world is at the very beginning of its first chapter. ` +
    `${subject}</storyStage>`
  );
}

// The client's copy reaches for `stepRender`'s exported `escapeText` /
// `escapeAttr`; `stepRender` is the step renderer and has no business crossing
// for two four-line functions, so they are local here. Same behaviour, and the
// golden-parity fixture is what proves it rather than the shared name.
function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
