/**
 * LIFE-SCENE-26 / LIFE-ARC-PACE-4 — the SCENE PACE constants, and nothing else.
 *
 * ⚠ THIS FILE USED TO BE THE STEP PROMPT'S RENDER HELPERS. SRV-PROMPT-8..13
 * batch 8 moved every renderer to `functions/src/prompts/lifeStepRender.ts`
 * (see below), and the two XML escapes went with them once the sweep showed
 * nothing under `src/` still imported either — `sceneLeaning.ts` was the last
 * caller and its own renderer crossed in the same batch. Leaving them would
 * have been two dead exports of prompt machinery, which is the
 * `prompts/stepTurn.ts` shape batch 0 deleted.
 *
 * The PATH is kept rather than renamed so `sceneLifecycle.ts` and
 * `tests/playthrough/run.play.ts` do not churn for a rename; what the file IS
 * now is four numbers the engine enforces.
 *
 * Spec: docs/specs/life-sim.md §4 (LIFE-CTX-*).
 */

/**
 * `renderEvent`, `renderIdleChapter`, `renderScenePace`, `renderChapterPace`
 * and `renderRecentEvents` LIVED HERE and MOVED to
 * `functions/src/prompts/lifeStepRender.ts` with SRV-PROMPT-8..13 batch 8. They
 * are PROMPT TEXT and `prompts/step.ts` was their only consumer.
 *
 * ⚠ THE PACE CONSTANTS BELOW DID *NOT* MOVE, and the duplication does NOT
 * expire. `SCENE_FLOOR` is read by `sceneLifecycle.ts`, which REFUSES a resolve
 * below it — engine code judging the model's answer — and `SCENE_OVERDUE` by
 * the playthrough harness. So this is the `DELTA_PER_FRONT` shape (batch 4),
 * not the batch-1 gloss shape: the two copies never re-converge, and
 * `tests/playthrough/serverPromptParity.test.ts` guards them for good.
 *
 * `escapeText` / `escapeAttr` stay for the same kind of reason: they are two
 * lines each, several client modules still escape model text with them, and a
 * shared escape is not prompt text.
 */

/** LIFE-ARC-PACE-1: chapter length in GENERATED TURNS (`storyLog.turns`,
 *
 *  RESTORED 2026-08-01 to 25/32/40, after being halved to 12/16/20 the night
 *  before on "chapters last far too long, I get bored and switch off".
 *  Halving the CHAPTER was the wrong lever and the owner corrected it: "I
 *  guess I meant the day needs to finish earlier... my misleading is causing
 *  them both to finish at the same time." At 12-16 turns a chapter resolved
 *  inside a single scene, so chapter 1 ended after day 1 and the two
 *  milestones collapsed into one — the day-complete and chapter-complete
 *  screens firing back to back, which is worse than a long chapter.
 *
 *  A chapter is meant to SPAN several days. The unit that was actually
 *  dragging is the SCENE (= a day, LIFE-DAY-1), and nothing bounds it: it
 *  resolves when a completionTrigger is satisfied, with no turn budget and no
 *  observable counter, which is the same "rule stated in terms the model
 *  cannot observe" defect `renderChapterPace` exists to fix one level up.
 *  Giving the scene its own pace block is the real fix and is NOT done
 *  here — see the note in docs/specs/life-sim.md (LIFE-ARC-PACE-4).
 *
 *  chapter-scoped — `applyTurnSignals` resets it when `chapterNumber` changes).
 *  These are the same numbers the step SI's pace rule quotes, which is only
 *  sound because `turns` excludes pre-authored resolution arrivals; counting
 *  `entries.length` instead ran 1.36x fast (measured: 34 entries / 25 turns). */
export const CHAPTER_IN_RANGE = 25;
export const CHAPTER_DUE = 32;
export const CHAPTER_OVERDUE = 40;


/** LIFE-ARC-PACE-4: scene (= DAY) length in generated turns. A chapter
 *  spans several of these — see the CHAPTER_* note above for why halving the
 *  chapter was the wrong lever for "the day drags".
 *
 *  A day is the unit the player feels most directly: they see a day-complete
 *  screen at the end of it. 6-9 turns is roughly a morning-to-evening arc at
 *  the pacing the step prompt already writes to, and it lands ~2-3 graded
 *  questions, so a day is a session rather than a sitting. */
/** LIFE-SCENE-26: a scene shorter than this has not been a scene. The model
 *  may resolve early when the subject genuinely lands, but `sceneLifecycle`
 *  REFUSES a resolve below the floor — "too small to be satisfying" is the
 *  failure the owner named alongside "too long", and only one of the two was
 *  ever guarded. */
export const SCENE_FLOOR = 4;
export const SCENE_IN_RANGE = 6;
export const SCENE_DUE = 9;
export const SCENE_OVERDUE = 12;
