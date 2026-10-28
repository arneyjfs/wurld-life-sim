import type { PracticeOutcome } from './generateStepOptions';
import { glossForAnswer } from './answerGloss';


/**
 * The `PracticeOutcome` for a resolved graded question, from the feedback
 * state that is already on screen.
 *
 * `nodeEngineActions` builds this at two points — once to PREFETCH the
 * post-feedback live turn while the overlay is up, and once on Continue, which
 * is the copy that reaches Firestore via `commitNode`. They were two literals
 * that had to agree, and `LIFE-VOCAB-RECAP-7` adding `correctAnswerNative`
 * made that a third field to keep in sync across both. One function instead:
 * a divergence here would mean the event written to Firestore disagreed with
 * the context the model was given for the very same answer.
 *
 * LIFE-VOCAB-RECAP-7: the gloss comes from `lineVocab` via `glossForAnswer` —
 * the same lookup the feedback overlay's "It means:" line already does
 * (`LIFE-LANG-19`), so nothing new is generated or requested for it.
 */
export function practiceOutcomeFromFeedback(
  fb: {
    outcomeKind: PracticeOutcome['kind'];
    correct: boolean;
    picked: { practiceText: string };
    correctAnswer: { practiceText: string };
    promptSource: string;
    lineVocab?: Record<string, string> | null;
  },
  /** LIFE-SPEECH-6: the bubble this answer puts ON SCREEN. Optional so the
   *  existing shape still type-checks, but BOTH production call sites pass it —
   *  without it the post-outcome turn does not know the line was said, and
   *  restages a fill-blank's completed sentence in an NPC's mouth. */
  resolved?: { practiceText: string; speaker: 'user' | 'npc' | 'narrator' } | null,
): PracticeOutcome {
  return {
    resolvedLine: resolved?.practiceText ?? null,
    resolvedSpeaker: resolved?.speaker ?? null,
    kind: fb.outcomeKind,
    correct: fb.correct,
    picked: fb.picked.practiceText,
    correctAnswer: fb.correctAnswer.practiceText,
    correctAnswerNative: glossForAnswer(
      fb.lineVocab ?? null,
      fb.correctAnswer.practiceText,
    ),
    promptSource: fb.promptSource,
  };
}
