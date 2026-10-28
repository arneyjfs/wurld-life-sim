/**
 * LIFE-LANG-5: map a graded life-sim turn into the shape the
 * ExplainModal's practice mode consumes (`ExplainPracticeQuestion`).
 * Mirrors `src/screens/Practice/buildExplainQuestion.ts` —
 * everything maps onto `questionType: 'multiple-choice'`.
 *
 * `displayLang` is the language the chips were RENDERED in
 * (LIFE-LANG-1: comprehension → 'native', fill-blank → 'practice');
 * `options`, `correctAnswer` and the caller's `userAnswer` must all
 * be expressed in that language so the explanation reasons about
 * what the learner actually saw.
 *
 * Pure function — no React, no state — unit-tested in isolation.
 *
 * Spec: docs/specs/life-sim.md §9.6 (LIFE-LANG-5).
 */
import type { PracticePrompt, StepChoice } from '@/lib/life/stepSchema';
import type { ExplainPracticeQuestion } from '@/lib/explain';

export type LifeExplainDisplayLang = 'practice' | 'native';

/** The label a chip showed on-screen for the given display language.
 *  Falls back to practiceText when the native label is empty so the
 *  explain prompt never carries a blank option. */
export function lifeChoiceLabel(
  choice: Pick<StepChoice, 'practiceText' | 'nativeText'>,
  displayLang: LifeExplainDisplayLang,
): string {
  if (displayLang === 'native' && choice.nativeText.trim()) {
    return choice.nativeText;
  }
  return choice.practiceText;
}

export function buildLifeExplainQuestion(
  prompt: PracticePrompt,
  choices: ReadonlyArray<StepChoice>,
  displayLang: LifeExplainDisplayLang,
): ExplainPracticeQuestion {
  const options = choices.map((c) => lifeChoiceLabel(c, displayLang));
  const correct = choices.find((c) => c.correctness === 'correct');
  const correctAnswer = correct ? lifeChoiceLabel(correct, displayLang) : '';
  if (prompt.kind === 'comprehension') {
    return {
      questionType: 'multiple-choice',
      // The generator's native question is the task cue (LIFE-LANG-2).
      // English fallbacks mirror buildExplainQuestion's own fallbacks —
      // the instruction is LLM input, not rendered UI.
      instruction:
        prompt.question.trim() ||
        (prompt.speakerName
          ? `What is ${prompt.speakerName} saying?`
          : 'What did they just say?'),
      practiceText: prompt.npcUtterance,
      options,
      correctAnswer,
    };
  }
  return {
    questionType: 'multiple-choice',
    instruction: 'Complete the sentence.',
    practiceText: prompt.practiceText,
    options,
    correctAnswer,
  };
}
