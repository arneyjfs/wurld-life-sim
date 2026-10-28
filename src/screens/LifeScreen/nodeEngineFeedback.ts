/**
 * LIFE-LANG-6/12 + LIFE-EX-VOCAB-3: build the graded-feedback state from the
 * answered question.
 *
 * Extracted from `nodeEngineActions.ts` for the 600-line cap. It is the natural
 * piece to lift: everything here is a PURE function of the question, the plan
 * and the picked chip — no refs, no transitions, no Firestore — whereas the
 * `resolveGraded` remainder is entirely about firing those side effects.
 *
 * The two branches are not symmetrical and that asymmetry is the whole point:
 * a fill-blank's sentence is the TEMPLATE with the blank filled by the correct
 * chip (so it matches the line `buildResolvedBubble` will land), while a
 * comprehension's is the NPC's utterance verbatim, glossed by the faithful
 * whole-line translation rather than the chip's third-person interpretation —
 * which the player has already seen as the answer.
 */
import type { GradedPlan, StepChoice } from '@/lib/life/stepSchema';
import type { FeedbackState, NodeEngineState } from './nodeEngineTypes';

export function buildFeedbackState(input: {
  question: NonNullable<NodeEngineState['question']>;
  plan: GradedPlan | null;
  picked: StepChoice;
  correct: boolean;
}): FeedbackState {
  const { question, plan, picked, correct } = input;
  const correctChip =
    question.choices.find((c) => c.correctness === 'correct') ?? picked;
  const prompt = question.practicePrompt;
  const promptSource =
    prompt.kind === 'generation' ? prompt.practiceText : prompt.npcUtterance;
  // LIFE-LANG-6: the full sentence + native translation the feedback overlay
  // ALWAYS shows. Fill-blank = the completed sentence (blank filled with the
  // correct chip, matching buildResolvedBubble's line) + completedNativeText;
  // comprehension = the NPC utterance + its faithful translation.
  const sentencePractice =
    prompt.kind === 'generation'
      ? promptSource.replace(/_{2,}/, correctChip.practiceText)
      : promptSource;
  const sentenceNative =
    prompt.kind === 'generation'
      ? prompt.completedNativeText?.trim() ?? ''
      : // LIFE-LANG-12: the faithful translation of the WHOLE utterance — NOT
        // the picked chip's third-person interpretation (which the player
        // already saw as the answer). Fall back only for legacy prompts
        // authored before utteranceNativeText existed.
        prompt.utteranceNativeText?.trim() || correctChip.nativeText;
  return {
    correct,
    picked,
    correctAnswer: correctChip,
    outcomeKind: prompt.kind,
    promptSource,
    sentencePractice,
    sentenceNative,
    speakerName: plan?.kind === 'comprehension' ? plan.speakerName ?? null : null,
    npcId: plan?.kind === 'comprehension' ? plan.npcId ?? null : null,
    // LIFE-EX-VOCAB-3: annotations for the line about to become a bubble.
    lineVocab: prompt.lineVocab ?? null,
  };
}
