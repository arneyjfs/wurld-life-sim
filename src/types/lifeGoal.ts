/**
 * LIFE-GOAL-* / LIFE-NEED-* — the goal ladder's stored shapes.
 *
 * Split out of `firestore.ts` for the 600-LOC cap, and it belongs on its own
 * anyway: `WorldCanon` sits beside it in `lifeNarrative.ts` for the same reason
 * — these are NARRATIVE state, not the app's document plumbing.
 *
 * The behaviour that acts on these lives in `src/lib/life/goalLadder.ts`; this
 * file is only what Firestore stores.
 */
import { z } from 'zod';

/** LIFE-NEED-1: the three things an objective can be waiting on. Stored
 *  resolved (kind + canonical name); the MODEL only ever names a flat string
 *  and code infers the kind (`resolveNeed`, LIFE-NEED-5). */
export const ZGoalNeed = z.object({
  kind: z.enum(['who', 'what', 'where']),
  name: z.string(),
});

export const ZObjective = z.object({
  id: z.string(),
  text: z.string(),
  need: ZGoalNeed.nullable().optional(),
});

/**
 * LIFE-GOAL-1/2 — the ladder. One distant goal, one live objective.
 *
 * `saga.days` is the count at open and `dayIndex` is what has elapsed, so the
 * ribbon count is a subtraction rather than a stored number something has to
 * remember to decrement. Only `timeAdvance: 'nextMorning'` moves `dayIndex`
 * (LIFE-GOAL-7) — the clock v1 already owns.
 */
export const ZGoalLadder = z.object({
  saga: z.object({
    text: z.string(),
    /** A SHORT named day — "Friday", "the second Sunday". Clamped at the
     *  source, because a sentence here pushes the goal off the sheet. */
    when: z.string(),
    days: z.number(),
  }).nullable().optional(),
  objective: ZObjective.nullable().optional(),
  done: z.array(z.object({
    text: z.string(),
    how: z.enum(['done', 'closed']),
    because: z.string().optional(),
  })).default([]),
  dayIndex: z.number().default(0),
});
export type GoalNeedDoc = z.infer<typeof ZGoalNeed>;
export type ObjectiveDoc = z.infer<typeof ZObjective>;
export type GoalLadderDoc = z.infer<typeof ZGoalLadder>;

