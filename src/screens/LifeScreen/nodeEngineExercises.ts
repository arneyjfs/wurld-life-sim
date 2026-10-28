/**
 * Text-answer exercise graders (type-to-fill LIFE-EX-8, word-order LIFE-EX-11),
 * extracted from `nodeEngineActions` (at the 600-LOC cap). Both are fill-blank
 * render variants where the player PRODUCES the answer (types the word / orders
 * the sentence) instead of picking a chip; each grades its input and routes
 * through the SAME `resolveGraded` feedback + prefetch flow as a chip pick.
 *
 * LIFE-EX-DIR-1: both are OUTBOUND-only by construction. Producing an answer is
 * the player speaking, so the `practicePrompt.kind !== 'generation'` early-out
 * in each grader IS the direction gate (fill-blank ⇔ `{ speaker: 'player' }`,
 * `gradedDirection`). Widening it to comprehension would route the player's own
 * typed words into an NPC's bubble.
 */
import { TYPED_ANSWER_ID, typedAnswerCorrect } from '@/lib/life/typeToFill';
import { ORDER_ANSWER_ID, isOrderCorrect } from '@/lib/life/wordOrder';
import { completedFillBlank } from '@/lib/life/exerciseVariant';
import type { StepChoice } from '@/lib/life/stepSchema';
import type { NodeEngineState } from './nodeEngineTypes';

export function createTextGraders(ctx: {
  machineRef: { current: NodeEngineState };
  resolveGraded: (picked: StepChoice, correct: boolean) => void;
}): {
  gradeTyped: (typed: string) => void;
  gradeOrder: (built: string) => void;
} {
  const { machineRef, resolveGraded } = ctx;

  /** LIFE-EX-GEN-11: when a produced (typed / ordered) answer happens to match
   *  a generator-authored WRONG chip, carry that chip's `whyWrong` so the
   *  feedback still explains the specific mistake. Normalised, case/accent-
   *  tolerant compare (the produced string won't be byte-identical). */
  function whyWrongFor(answer: string, choices: ReadonlyArray<StepChoice>): string | undefined {
    const a = answer.trim().toLowerCase();
    const hit = choices.find(
      (c) => c.correctness === 'wrong' && c.whyWrong && c.practiceText.trim().toLowerCase() === a,
    );
    return hit?.whyWrong ?? undefined;
  }

  /** LIFE-EX-8: compare the typed word to the correct chip. */
  function gradeTyped(typed: string): void {
    const q = machineRef.current.question;
    if (!q || q.practicePrompt.kind !== 'generation') return;
    const correctChip = q.choices.find((c) => c.correctness === 'correct');
    if (!correctChip) return;
    const correct = typedAnswerCorrect(typed, correctChip.practiceText);
    resolveGraded(
      {
        id: TYPED_ANSWER_ID, practiceText: typed.trim(), nativeText: '',
        correctness: correct ? 'correct' : 'wrong',
        ...(correct ? {} : { whyWrong: whyWrongFor(typed, q.choices) }),
      },
      correct,
    );
  }

  /** LIFE-EX-11: compare the assembled sentence to the completed target. */
  function gradeOrder(built: string): void {
    const q = machineRef.current.question;
    if (!q || q.practicePrompt.kind !== 'generation') return;
    const target = completedFillBlank(q.practicePrompt.practiceText, q.choices);
    const correct = isOrderCorrect(built, target);
    resolveGraded(
      {
        id: ORDER_ANSWER_ID, practiceText: built.trim(), nativeText: '',
        correctness: correct ? 'correct' : 'wrong',
        ...(correct ? {} : { whyWrong: whyWrongFor(built, q.choices) }),
      },
      correct,
    );
  }

  return { gradeTyped, gradeOrder };
}
