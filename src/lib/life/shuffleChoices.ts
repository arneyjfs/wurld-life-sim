/**
 * LIFE-EX-GEN-8: Fisher-Yates shuffle of the authored graded chips so
 * the correct answer's POSITION is randomised before the chip set
 * reaches the UI.
 *
 * The generator authors the correct chip first (its OUTPUT SHAPE
 * example in `functions/src/prompts/lifeGradedQuestion.ts` lists the
 * "correct" chip as
 * c1, and models copy that ordering). Left unshuffled, the answer
 * would always be the first chip — a trivial tell. `correctness`
 * identifies the answer independent of order, so shuffling preserves
 * it while scrambling the visible position.
 *
 * `rng` is injectable purely for deterministic tests; production uses
 * `Math.random`.
 *
 * Spec: docs/specs/life-sim.md §10.45 (LIFE-EX-GEN-8).
 */
import type { StepChoice } from './stepSchema';

export function shuffleChoices(
  choices: ReadonlyArray<StepChoice>,
  rng: () => number = Math.random,
): StepChoice[] {
  const out = choices.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
