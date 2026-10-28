/**
 * Event-log counters that drive the step prompt's two CADENCE directives.
 *
 * Extracted from `step.ts` for the 600-LOC cap, and the split earns itself: both
 * are pure reductions over the events log with no prompt-rendering concerns, so
 * they are testable — and readable — without the 800-line prompt builder around
 * them. The DIRECTIVES they feed live in `stepRender.ts`; this module only
 * answers "how long has it been".
 */
import type { LifeEvent } from '@/types/firestore';

/** LIFE-EX-CADENCE-1/2: narrative picks before a graded moment is DUE (a nudge
 *  the model may place naturally) and before it is OVERDUE (the window closes).
 *
 *  DUE stays at 2 — that is the tier that produces the target rate when taken.
 *  OVERDUE moved 4 → 3 on 2026-07-31 because the model was **taking the
 *  deferral almost every time**. Measured on a real world
 *  (`w-1785453145426-8w0ffo`): **8 corrections across 34 decisions = 23.5%**,
 *  i.e. ~1 question in 4.3 against the `LIFE-WORLD-ARC-7` target of ~1 in 3.
 *  Zero `question_demoted` events, so this is deferral, not rejection.
 *
 *  The arithmetic the window implies: taking DUE lands a question every 3rd
 *  turn (33%); deferring to OVERDUE=4 lands one every 5th (20%). 23.5% sits
 *  just above the deferral floor. Closing the window to 3 raises that floor to
 *  25% and narrows the band to 25-33%.
 *
 *  DIRECTIONAL, NOT MEASURED TO A CONCLUSION: this moves the floor, it does not
 *  make the model take DUE more often. Re-measure the correction/decision ratio
 *  on a real chapter before claiming the target is met. */
/*
 * RE-TUNED 2026-08-04, and the reason the earlier value can be undone.
 *
 * DUE went 2 → 1 on 2026-08-03 to raise the FLOOR, because the model was
 * deferring at `due` and a scene produced two questions. It worked, and it
 * overshot: measured across a full 8-scene world, 45 questions in 72 turns —
 * 62% of turns, with gaps [1,3,1,2,1,2,3,1,1,1,2,...] and only 51% inside the
 * 2-3 band the check scores. A question every other turn is a quiz with a story
 * around it.
 *
 * The floor no longer needs DUE=1 to hold it up. `forced` stopped offering an
 * alternative in the same 2026-08-03 change (LIFE-EX-CADENCE-3), so a deferral
 * at `due` can now only postpone by one turn before the window closes for real.
 * That is what protects the floor; DUE was doing it a second time, from the
 * other direction, and paying for it in density.
 *
 * Back to 2/3: the band is 1-in-3 to 1-in-4, against the LIFE-WORLD-ARC-7
 * target of ~1 in 3.
 */
export const CADENCE_DUE = 2;
export const CADENCE_OVERDUE = 3;

/**
 * LIFE-EX-CADENCE-3 — the tier the cadence directive should speak in.
 *
 * THE DEFECT, reported 2026-08-03 and visible in the note above a month before
 * anyone acted on it: a real scene ran TWELVE turns and produced ONE question.
 *
 * The 2026-07-31 change tuned OVERDUE 4 → 3 and its own comment predicted the
 * outcome — *"this moves the floor, it does not make the model take DUE more
 * often."* It didn't, because the threshold was never the problem. BOTH tiers
 * handed the model an out, and the OVERDUE one ended *"make the NEXT node the
 * question"* — a deferral it could take again on the next node, and the next,
 * with nothing anywhere counting how many times it already had.
 *
 * That is the recurring lesson for the seventh time in this codebase: **a rule
 * the model can satisfy by doing nothing is not a mechanism.** The fix is not a
 * fourth tier or another threshold; it is that OVERDUE stops offering an
 * alternative. `due` remains a genuine nudge where PLACEMENT is the model's
 * call — that judgement is worth keeping, and a question the story earned does
 * teach more than a pop quiz. `forced` is where the window actually closes.
 *
 * RE-TUNED 2026-08-03 after a full scene produced TWO questions. With DUE=2 /
 * OVERDUE=3 the band was 1-in-3 to 1-in-4, and a scene runs 6-12 turns, so the
 * ceiling was ~4 questions and the floor ~2. The floor is what a player
 * actually got. DUE=1 / OVERDUE=2 makes the band 1-in-2 to 1-in-3, which is the
 * requested target, and — because `forced` now genuinely forces — the FLOOR is
 * the thing that moved: a deferral at DUE can only postpone by one turn.
 */
export type CadenceTier = 'none' | 'due' | 'forced';

/**
 * LIFE-EX-CADENCE-4's kind ROTATION lived here and is DELETED (`LIFE-EX-18`).
 *
 * It forced production every other graded slot because, left free, the model
 * chose comprehension every time — "production never fired once, in a session
 * with twelve `say` picks". That was true, and it was true of a world where the
 * NODE was the only way to practise producing language.
 *
 * It is not true any more. `LIFE-SPEECH-3` moved production onto `gradeTarget`
 * on an option and `LIFE-EX-CADENCE-7` gave it its own clock, so the node route
 * now carries ~9% of production. The rotation had also started to FIGHT its
 * neighbours: it told the model to author a fill-blank NODE on slots where
 * `LIFE-SPEECH-3` tells it not to, which `LIFE-EX-CADENCE-6` had to referee.
 *
 * MEASURED before deleting, 4 runs each, kind instruction present vs absent:
 *
 *     fill-blank NODES      6  ->  2
 *     comprehension nodes  21  -> 21
 *     gradeTarget options  55  -> 61
 *     production per turn      0.64  ->  0.64
 *
 * The node route shrank and the option route absorbed it exactly. Comprehension
 * did NOT balloon, because this block still decides WHETHER a turn is graded —
 * only WHICH KIND is gone, and that is now derived from whose line the plan
 * holds (`deriveGradedKind`).
 */

export function cadenceTier(streak: number): CadenceTier {
  if (streak >= CADENCE_OVERDUE) return 'forced';
  if (streak >= CADENCE_DUE) return 'due';
  return 'none';
}

/** Count of `decision` events that appear AFTER the most recent
 *  `correction` event in the events log. Each completed graded
 *  practice writes a correction event (see commitNode); narrative picks
 *  write decision events. So this metric is "how many CYOA-style
 *  turns has the player taken since their last actual practice".
 *  Drives the `<practiceCadence>` directive built in `step.ts`. */
export function cyoaStreak(events: ReadonlyArray<LifeEvent>): number {
  let streak = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    // LIFE-EX-CADENCE-1: a graded slot is SPENT either by being answered
    // (`correction`) or by being planned and rejected (`question_demoted`).
    // Counting only the former meant a demoted question left the streak
    // elevated, so the directive fired again on the very next node — a demote
    // loop, three calls a turn (the question `life_step`, the failed
    // `life_graded_question`, and the replacement options fetch), and a run of
    // forced questions the player experiences as "too many questions".
    if (e.kind === 'correction' || e.kind === 'question_demoted') break;
    if (e.kind === 'decision') streak += 1;
  }
  return streak;
}

/**
 * LIFE-EX-CADENCE-7 — a SEPARATE clock for the one exercise that has no
 * substitute.
 *
 * Owner, 2026-08-10: *"I'm definitely finding the model is missing most
 * opportunities to test me saying something... Maybe gate only on if I've had
 * specifically a generate based question recently."* That is exactly right, and
 * the archives say why.
 *
 * `cyoaStreak` counts turns since ANY graded moment, so a COMPREHENSION question
 * resets the clock for PRODUCTION. The two are not interchangeable — one has the
 * player read, the other has them speak, and only the second is what most people
 * mean by learning a language. Worse, they do not even cost the same: a
 * comprehension needs a whole node, while production can ride a `gradeTarget` on
 * an option the player was going to pick anyway. Gating the cheap one on the
 * expensive one's clock is backwards.
 *
 * So production gets its own counter, reset ONLY by a `fill-blank` correction.
 * Both routes into that event count — the option's `gradeTarget` and the node
 * form both resolve as `payload.kind === 'generation'` — because what is being
 * measured is whether the PLAYER SPOKE, not which mechanism got them there.
 *
 * A demoted question deliberately does NOT reset it: `question_demoted` means the
 * exercise did not happen, and treating a failure as a spend is how
 * `LIFE-EX-CADENCE-1` lost questions in the first place, one direction over.
 */
/**
 * `PRODUCTION_DUE`, `productionStreak`, `renderProductionCadence`,
 * `renderPracticeCadence` and `recentlyPracticedTargets` LIVED HERE and MOVED
 * to `functions/src/prompts/lifeStepBlocks.ts` with SRV-PROMPT-8..13 batch 8.
 * All five are prompt text or feed it, and `prompts/step.ts` was their only
 * consumer.
 *
 * ⚠ `cyoaStreak` + `cadenceTier` ABOVE DID *NOT* MOVE, and the duplication does
 * NOT expire. `generateStepOptions` reads them for the LIFE-EX-CADENCE-3 debug
 * row — whether the model HONOURED the cadence it was given — which is a
 * judgement on the RESPONSE and never migrates. `DELTA_PER_FRONT` shape, not
 * the gloss shape; `tests/playthrough/serverPromptParity.test.ts` guards them.
 */
