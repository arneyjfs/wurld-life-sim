import { describe, expect, it } from 'vitest';
import { AI_REVIEW_PREFIX, buildAiReviewFeedback } from './translationFeedback';

describe('buildAiReviewFeedback', () => {
  it('prefixes the comment with the AI-review tag', () => {
    const out = buildAiReviewFeedback({
      chatId: 'c1',
      messageId: 'm1',
      score: 3,
      cleanComment: 'Verb tense is slightly off.',
      inputText: 'hola',
      outputText: 'hello',
      inputLanguage: 'es',
      outputLanguage: 'en',
    });
    expect(out.comment).toBe(`${AI_REVIEW_PREFIX}Verb tense is slightly off.`);
    expect(out.comment?.startsWith(AI_REVIEW_PREFIX)).toBe(true);
    expect(out).toEqual({
      chatId: 'c1',
      messageId: 'm1',
      score: 3,
      comment: '[AI review] Verb tense is slightly off.',
      inputText: 'hola',
      outputText: 'hello',
      inputLanguage: 'es',
      outputLanguage: 'en',
    });
  });

  it('collapses empty optional text fields to undefined', () => {
    const out = buildAiReviewFeedback({
      chatId: 'c1',
      messageId: 'm1',
      score: 4,
      cleanComment: 'Good.',
      inputText: '',
      outputText: '',
      inputLanguage: '',
      outputLanguage: 'en',
    });
    expect(out.inputText).toBeUndefined();
    expect(out.outputText).toBeUndefined();
    expect(out.inputLanguage).toBeUndefined();
    expect(out.outputLanguage).toBe('en');
  });
});
