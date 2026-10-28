/**
 * LIFE-GRID-* — the option grid, as code rather than as prose.
 *
 * Spec: docs/specs/story-architecture.md §4, §6.6.
 *
 * THE REPORTED FAILURE: *"always directing the user to the same or very similar
 * options in the grid."* The audit found the cause is structural, not stylistic.
 * `LIFE-OPT-VARIETY` is a good rule — it names the action types and states its
 * failure as a count — but it governs ONE grid in isolation. Nothing showed the
 * model the previous option sets, and nothing forbade offering the same three
 * shapes turn after turn. `<recentlyPracticed>` exists to stop VOCAB repeating
 * across turns; actions had no equivalent.
 *
 * Two mechanisms, in the order they fire:
 *
 *  1. **PREVENT** (`requiredTypeForTurn`). Code picks a required action type and
 *     injects it into the request. Costs nothing, and guarantees the spread by
 *     construction. Same technique as the existing `exerciseSeed` fill-blank
 *     rotation, which already works in this repo.
 *  2. **REJECT** (`gradeOptionSet`) as a backstop only. Rejection costs a whole
 *     extra call, so it should almost never fire; if the measured rate goes
 *     above ~15% the rule is wrong, not the model.
 */
import type { OptionType } from '@/types/lifeState';

/** How many past option sets the model is shown, so it can avoid repeating a
 *  shape. Small on purpose — this rides in the volatile zone of the prompt
 *  (below the cache boundary), so every row costs on every turn. */
export const RECENT_ACTIONS_WINDOW = 8;

/** One offered option, reduced to the shape that matters for variety. */
export type ActionShape = { type: OptionType; targetId: string | null };

/**
 * `requiredTypeForTurn`, `renderRequiredType`, `renderRecentActions`,
 * `actionShapesFromEvents`, `optionRules` and `optionOutputContract` LIVED HERE
 * and MOVED with SRV-PROMPT-8..13 batch 8 — the first four to
 * `functions/src/prompts/lifeStepBlocks.ts`, the sixth to
 * `functions/src/prompts/lifeStepSI.ts`. All of them write text the model
 * reads, and `prompts/step.ts` was their only consumer.
 *
 * ⚠ `optionRules` WAS NOT PORTED AT ALL. It built five system-instruction lines
 * for the variant `LIFE-SI-LEAN-7` deleted, and `git grep optionRules` returned
 * its own definition and nothing else — dead since that change. Porting it
 * would have put five prompt rules server-side that no prompt serves, which is
 * the `prompts/stepTurn.ts` shape batch 0 deleted. Its rules are not lost:
 * `stepLean`'s `OPTIONS —` line and `optionOutputContract`'s `actionType` row
 * carry the live versions.
 *
 * WHAT STAYED is the REJECT half — `gradeOptionSet`, `offeredShapes`,
 * `takenShapeCounts`, `shapeKey` and `goalKey`. Those judge
 * a response the model has already written, which is engine work.
 */

export type OptionSetVerdict =
  | { ok: true }
  | {
      ok: false;
      /** SRV-PROMPT-12 — the two values the retry sentence quotes. The sentence
       *  itself is server-side now (`lifeStepViolations.ts`, `dangled-goal`),
       *  so the verdict carries the facts and nothing else. */
      goal: string;
      takes: number;
    };

/**
 * LIFE-GRID-6 — the backstop, and the ONE thing it can check that nothing else
 * can: whether this grid re-offers a goal the world has already refused.
 *
 * ## What it used to check, and where those rules went
 *
 * It was written as the REJECT half of LIFE-GRID-1.1/1.2 and checked three
 * things: all-one-type · nothing-active · same-shape-as-last-turn. It was then
 * never CALLED from anywhere in `src` — unit-tested, imported by nothing. In
 * the meantime `optionSpreadIssues` (stepSchema.ts) grew the first two rules,
 * more strictly (it demands EVERY option differ, not merely that they are not
 * all identical) and IS wired, at the request-shape stage. Measured over 1,980
 * archived grids, this function's versions of those two rules fire on 0.0% of
 * turns — not because grids are perfect, but because the live path already
 * rejected them upstream.
 *
 * Two functions answering "is this grid OK?" is how a guard silently stops
 * being the guard, so they are now one each: `optionSpreadIssues` owns the
 * SPREAD (it needs only the options), and this owns the parts that need the
 * EVENT LOG.
 *
 * The third rule, same-shape-as-the-previous-turn, is GONE rather than kept
 * with a permanently-null argument. It measured 2.3% — real, but the app
 * cannot enforce it: only the player's PICK is persisted, never the set they
 * were offered, so there is no previous grid to compare against. Keeping the
 * arm would have recreated exactly the defect above (a rule that cannot fire).
 * Reinstating it means persisting the offered set on the decision event; see
 * LIFE-GRID-6 in docs/specs/life-sim.md.
 */
export function gradeOptionSet(
  options: readonly ActionShape[],
  /** How many times the player has already TAKEN each shape (`shapeKey` →
   *  count), from `takenShapeCounts`. Omitted ⇒ the check is skipped. */
  takenCounts?: ReadonlyMap<string, number> | null,
): OptionSetVerdict {
  if (options.length < 2 || !takenCounts) return { ok: true };

  // The DANGLED GOAL, rejected rather than requested.
  //
  // MEASURED over 2,026 archived grids, against this module's own note that a
  // backstop above ~15% means the rule is wrong:
  //   any re-offer of a taken goal    19.5%  — over the ceiling
  //   offered after TWO takes          7.1%  — chosen
  //   offered after THREE takes        2.5%
  // Two takes and it is being offered a third time is not ambiguous: the
  // player has done this, twice, and the world is still holding it out.
  //
  // Keyed by `goalKey`, so an option that names no entity is skipped entirely.
  // Read its comment before changing this — keying targetless options by their
  // bare verb is what took this rule to 75.7% for one commit.
  const dangled = options.find((o) => {
    const k = goalKey(o);
    return k !== null && (takenCounts.get(k) ?? 0) >= DANGLE_TAKES;
  });
  if (!dangled) return { ok: true };

  const k = goalKey(dangled)!;
  return { ok: false, goal: k, takes: takenCounts.get(k) ?? 0 };
}

/** LIFE-GRID-6: takes of the same shape before a re-offer becomes a defect.
 *  TWO, from the measurement above — one repeat is ordinary (asking again
 *  after the conversation moved), a third offer of something twice-attempted
 *  is the dangle the owner reported. */
export const DANGLE_TAKES = 2;

/** The key `<recentActions>` DISPLAYS. A targetless option collapses to its
 *  bare verb here, which is fine for a list the model reads — but fatal as a
 *  dangle key, which is why `goalKey` exists below. */
export function shapeKey(a: ActionShape): string {
  return `${a.type}${a.targetId ? `:${a.targetId}` : ''}`;
}

/**
 * LIFE-GRID-6 — the DANGLE key. `null` for an option that acts on nothing
 * specific, and a null key is never counted and never checked.
 *
 * THE BUG THIS FIXES, because it is the whole lesson. The rule was chosen from
 * a measurement (2.2% of grids) and then implemented against a DIFFERENT key
 * from the one measured. The measurement keyed a targetless option by its
 * LABEL — near-unique, so targetless picks essentially never collided. The
 * implementation used `shapeKey`, which collapses a targetless option to its
 * bare verb: two targetless `ask` picks, which is nothing at all in a
 * conversation game, and every later grid containing any targetless `ask` was
 * rejected as a "dangled goal".
 *
 * Caught by a real playthrough on 2026-08-06 and then measured over all 2,026
 * archived grids:
 *
 *     bare-verb key (shipped, wrong)   75.7%   — five times the ~15% ceiling
 *     targeted-only key, taken >= 2     7.1%   — chosen
 *     targeted-only key, taken >= 3     2.5%
 *     targeted-only key, taken >= 1    19.5%   — over the ceiling
 *
 * At 75.7% it was not a backstop, it was a tax: three quarters of turns paying
 * a second generation to be told *"option 'ask' is a goal the player has
 * already taken 8 times"*, which is not a sentence about anything.
 *
 * A DANGLED GOAL IS A THING THE WORLD KEEPS REFUSING — the letter, the ledger,
 * the door. "Ask" is not a goal, and neither is "move". If an option names no
 * entity, it cannot be the thing the story is dangling.
 */
export function goalKey(a: ActionShape): string | null {
  return a.targetId ? `${a.type}:${a.targetId}` : null;
}

/**
 * LIFE-GRID-6: the OFFERED shapes of one grid, ready for `gradeOptionSet`.
 *
 * An option with no declared `actionType` is SKIPPED, not defaulted — the same
 * call `actionShapesFromEvents` makes below, for the same reason: a guessed
 * shape is worse than a missing one when the guess is what the check then
 * rejects. Coercing an absent field to `'ask'` turned every type-less option
 * into an "all options are ask" violation and spent a retry on it.
 *
 * Measured over 1,980 archived grids: ZERO carried an option without a type
 * (the field is REQUIRED in the output contract and the model honours it), so
 * skipping costs nothing live and only stops the check inventing a fault out
 * of a missing field.
 */
export function offeredShapes(
  options: readonly { actionType?: string | null; targetId?: string | null }[],
): ActionShape[] {
  const out: ActionShape[] = [];
  for (const o of options) {
    const t = o.actionType;
    if (typeof t !== 'string' || !OPTION_TYPES.includes(t)) continue;
    out.push({ type: t as OptionType, targetId: o.targetId ?? null });
  }
  return out;
}

/** LIFE-GRID-6: how many times each shape has been TAKEN, for `gradeOptionSet`.
 *  Built from the same `decision` events `actionShapesFromEvents` reads, but
 *  UNWINDOWED — a goal dangled across a long scene is exactly the case the
 *  8-row prompt window would drop. */
export function takenShapeCounts(
  events: readonly { kind: string; payload?: Record<string, unknown> }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'decision') continue;
    const t = e.payload?.actionType;
    if (typeof t !== 'string' || !OPTION_TYPES.includes(t as OptionType)) continue;
    const target = e.payload?.targetId;
    // `goalKey`, not `shapeKey` — a pick that acted on nothing specific is not
    // a goal and must not accumulate a count that later rejects a whole verb.
    const k = goalKey({
      type: t as OptionType,
      targetId: typeof target === 'string' ? target : null,
    });
    if (k === null) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}


/**
 * LIFE-GRID-4 — recover the recent action shapes from the append-only log.
 *
 * The offered SETS are not persisted (only the pick is), so this reads the
 * `decision` events: what the player actually took, in order. That is the
 * weaker of the two possible histories and it is the honest one — it is what
 * the log contains. It is still the memory the grid never had, and it is what
 * stops the same shape being offered turn after turn.
 *
 * `actionType` is optional on the payload because worlds created before
 * LIFE-GRID-1.1 have decision events without it. Those rows are skipped rather
 * than guessed at: a wrong shape in this block is worse than a missing one,
 * because the model is told not to repeat it.
 */
export function actionShapesFromEvents(
  events: readonly { kind: string; payload?: Record<string, unknown> }[],
): ActionShape[] {
  const out: ActionShape[] = [];
  for (const e of events) {
    if (e.kind !== 'decision') continue;
    const t = e.payload?.actionType;
    if (typeof t !== 'string' || !OPTION_TYPES.includes(t as OptionType)) continue;
    const target = e.payload?.targetId;
    out.push({ type: t as OptionType, targetId: typeof target === 'string' ? target : null });
  }
  return out.slice(-RECENT_ACTIONS_WINDOW);
}

const OPTION_TYPES: readonly string[] = ['ask', 'do', 'move', 'observe', 'offer', 'leave'];
