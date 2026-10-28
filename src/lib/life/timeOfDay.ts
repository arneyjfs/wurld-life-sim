/**
 * LIFE-TIME-1 — the world clock.
 *
 * THE DEFECT, reported 2026-08-03: a morning at the bakery, one walk to the
 * bay, and the bay rendered as night.
 *
 * Two halves were missing and they compound.
 *
 * 1. **Nothing tracked the time.** The step model encodes it ad hoc inside
 *    `vibe` when it happens to think of it (`quiet_morning`, `busy_morning`)
 *    and drops it when it doesn't (`ominous`). `vibe` is doing double duty as
 *    world register AND mood, so "ominous" steered the SVG generator dark and
 *    nothing contradicted it.
 * 2. **The re-skin was never built.** The backdrop SI's rule 12
 *    (`functions/src/prompts/lifeBackdrop.ts`) has always
 *    told the generator to tag `sky` / `lighting` / `lamp` / `shadow` classes
 *    "so the app can re-skin one SVG for morning / midday / evening / night",
 *    and `backdropDescriptor` deliberately keeps time OUT of the cache key on
 *    the same reasoning — *"time-of-day is a CSS overlay, not a separate
 *    backdrop"*. Every cached SVG carries the hooks. Nothing ever pulled them.
 *
 * WHY THIS IS A RATCHET, not a field the model rewrites. Time of day is a
 * quantity, and the recurring lesson of this codebase is that a model is good
 * at writing a sentence given a situation and bad at maintaining a system. A
 * model asked "what time is it now?" every turn will answer "morning" in the
 * evening, because most scenes read like mornings. So the model may only ever
 * say *how much time passed*, and the arithmetic happens here.
 *
 * Same shape as `LIFE-FRONT-9`'s drift and `LIFE-CAST-3.1`'s standing step: the
 * model reports a local judgement, code owns the number.
 */
import {
  TIMES_OF_DAY,
  ZTimeAdvance,
  ZTimeOfDay,
  type TimeAdvance,
  type TimeOfDay,
} from '@/types/lifeState';

export { TIMES_OF_DAY, ZTimeAdvance, ZTimeOfDay, type TimeAdvance, type TimeOfDay };

const STEP: Record<TimeAdvance, number> = {
  none: 0,
  /** A conversation, an errand, a walk across town. */
  some: 1,
  /** A shift finished, a long journey, a meal and everything after it. */
  lots: 2,
  nextMorning: 0, // handled separately — it wraps rather than steps
};

/**
 * Apply an advance. Monotonic within a day; only `nextMorning` wraps.
 *
 * Clamps at `night` rather than rolling over silently: a story that has reached
 * night and keeps going should say so out loud (`nextMorning`), because "and
 * then it was suddenly morning again" is a thing the player must be told, not
 * something a counter should do behind their back.
 */
export function advanceTimeOfDay(from: TimeOfDay, advance: TimeAdvance): TimeOfDay {
  if (advance === 'nextMorning') return 'morning';
  const i = TIMES_OF_DAY.indexOf(from);
  const next = Math.min(TIMES_OF_DAY.length - 1, i + STEP[advance]);
  return TIMES_OF_DAY[next]!;
}

/** Coerce whatever the model emitted into a usable advance. Anything
 *  unrecognised — including `null`, which the model writes into optional
 *  fields as a matter of course (LIFE-CAST-4) — means no time passed. */
export function readTimeAdvance(v: unknown): TimeAdvance {
  const parsed = ZTimeAdvance.safeParse(v);
  return parsed.success ? parsed.data : 'none';
}

export function readTimeOfDay(v: unknown): TimeOfDay {
  const parsed = ZTimeOfDay.safeParse(v);
  return parsed.success ? parsed.data : 'morning';
}

/**
 * ✅ `renderTimeOfDay` AND ITS SIX GLOSS STRINGS MOVED with SRV-PROMPT-8..13
 * batch 8, and with them the LAST duplication batch 1 created.
 *
 * `renderTimeOfDayForBackdrop` crossed in batch 1 and had to LEAVE the glosses
 * behind, because `renderTimeOfDay` still needed them and its consumer
 * (`prompts/step.ts`) did not migrate until batch 8. So the six strings lived
 * on both sides of the wire for eight batches, guarded by a drift test that
 * carried a stated expiry. Both copies are now server-side
 * (`lifeBackdrop.ts`'s `BACKDROP_TIME_OF_DAY_GLOSS` and `lifeStepBlocks.ts`'s
 * `GLOSS`), the guard has expired, and this module keeps only the RATCHET —
 * `advanceTimeOfDay` / `readTimeAdvance` / `readTimeOfDay`, which is code
 * owning the number and never migrates.
 */

/**
 * `renderTimeOfDayForBackdrop` USED TO SIT HERE and is now
 * `functions/src/prompts/lifeBackdrop.ts` (SRV-PROMPT-8..13 batch 1). It had
 * exactly one non-test consumer — the backdrop user prompt — so it moved whole
 * rather than being copied, per SRV-PROMPT-3.
 *
 * `GLOSS` above could NOT move with it: `renderTimeOfDay` still needs it, and
 * the `life_step` prompt that calls it is batch 8. So the six gloss strings now
 * exist on both sides of the wire — the `PRACTICE-IMPORT-16` shape (two live
 * copies that must agree), not the `PRACTICE-IMPORT-12` one (a mirror nobody
 * reads). Drift is invisible and expensive: the prose would describe one hour
 * and the picture behind it would be lit for another, which is LIFE-TIME-1's
 * own defect arriving by a new route. `timeOfDay.test.ts` asserts the two
 * against each other, and that guard retires with batch 8.
 */
