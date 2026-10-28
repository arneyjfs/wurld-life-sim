import { describe, expect, it } from 'vitest';
import { practiceOutcomeFromFeedback } from './practiceOutcomeFromFeedback';

/**
 * LIFE-VOCAB-RECAP-7 — ONE builder for the practice outcome.
 *
 * `nodeEngineActions` builds this twice: once to prefetch the post-feedback
 * live turn, once on Continue (the copy that reaches Firestore). They were two
 * literals that had to agree, and a divergence would mean the stored event
 * disagreed with the context the model was given for the same answer.
 */
const FB = {
  outcomeKind: 'generation' as const,
  correct: false,
  picked: { practiceText: 'veux' },
  correctAnswer: { practiceText: 'voudrais' },
  promptSource: 'Je ___ déjeuner avec toi.',
  lineVocab: { voudrais: 'would like', déjeuner: 'to have lunch' },
};

describe('LIFE-VOCAB-RECAP-7 — practiceOutcomeFromFeedback', () => {
  it('carries the answer gloss out of lineVocab', () => {
    // toMatchObject, not toEqual: LIFE-SPEECH-6 added `resolvedLine` /
    // `resolvedSpeaker`, and this test is about the GLOSS. Pinning the exact
    // field set made an additive change look like a regression.
    expect(practiceOutcomeFromFeedback(FB)).toMatchObject({
      kind: 'generation',
      correct: false,
      picked: 'veux',
      correctAnswer: 'voudrais',
      correctAnswerNative: 'would like',
      promptSource: 'Je ___ déjeuner avec toi.',
    });
  });

  it('is null-glossed rather than wrong when lineVocab has no entry', () => {
    // LIFE-LANG-19's `glossForAnswer` returns null rather than guessing, and a
    // null gloss is what makes the row render read-only (LIFE-VOCAB-RECAP-4).
    const out = practiceOutcomeFromFeedback({ ...FB, lineVocab: { autre: 'other' } });
    expect(out.correctAnswerNative).toBeNull();
  });

  it('tolerates a question that carried no lineVocab at all', () => {
    const out = practiceOutcomeFromFeedback({ ...FB, lineVocab: null });
    expect(out.correctAnswerNative).toBeNull();
    expect(out.correctAnswer).toBe('voudrais');
  });

  it('reads the PICKED answer, not the correct one, into `picked`', () => {
    // The two are adjacent fields of the same shape; swapping them would make
    // every wrong answer look right in the event log.
    expect(practiceOutcomeFromFeedback(FB).picked).toBe('veux');
  });
});
