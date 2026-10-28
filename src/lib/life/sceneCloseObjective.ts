/**
 * LIFE-GOAL-11 — turning the close's verdict into a ladder delta.
 *
 * Its own module because it is the ONE place the close's vocabulary
 * (`achieved` / `overtaken` / `stands`) meets the ladder's
 * (`objectiveDone` / `objectiveClosed`), and that translation is where a
 * mistake would silently delete the player's objective. Pure, so it is
 * testable without a model.
 */
import type { LadderDelta } from './goalLadder';

/** The close's three answers. `stands` is the safe default for anything else. */
export const OBJECTIVE_VERDICTS = ['achieved', 'overtaken', 'stands'] as const;

export function ladderDeltaFromVerdict(
  verdict: string | null | undefined,
  because: string | null | undefined,
): LadderDelta {
  const reason = (because ?? '').trim();
  if (verdict === 'achieved') return { objectiveDone: true };
  // OVERTAKEN WITHOUT A REASON DEGRADES TO `stands`, and this is the important
  // line in the file. `LIFE-GOAL-3` exists because an objective that vanishes
  // with nothing to show the player is the silent drop the whole feature was
  // built to prevent — and a reasonless close is that drop wearing a verdict.
  // Keeping the objective is the recoverable error; deleting it is not.
  if (verdict === 'overtaken' && reason) return { objectiveClosed: reason };
  // Anything else — `stands`, an empty string, or a value outside the enum the
  // schema is supposed to constrain. The parse must not lean on the schema
  // holding: a model returning something unexpected must not be able to take
  // the objective away by accident.
  return {};
}
