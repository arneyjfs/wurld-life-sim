import { describe, expect, it } from 'vitest';
import { glossForAnswer } from './answerGloss';

/**
 * LIFE-LANG-19 — the gloss exists; it was just never read.
 *
 * `lineVocab` segments the COMPLETED fill-blank sentence, so the answer token
 * is already glossed there. The chip stays bare (a gloss on a tappable answer
 * telegraphs it); the FEEDBACK, shown only after answering, does not have to.
 */
describe('LIFE-LANG-19 — glossForAnswer', () => {
  it('LIFE-LANG-19 — exact surface form wins', () => {
    expect(glossForAnswer({ voudrais: 'would like', 'un café': 'a coffee' }, 'voudrais')).toBe(
      'would like',
    );
  });

  it('LIFE-LANG-19 — case-insensitive when the line capitalised the word', () => {
    // Sentence-initial answers come back capitalised in the chip but lowercase
    // in the segmentation, or vice versa.
    expect(glossForAnswer({ Voudrais: 'would like' }, 'voudrais')).toBe('would like');
    expect(glossForAnswer({ voudrais: 'would like' }, 'Voudrais')).toBe('would like');
  });

  it('LIFE-LANG-19 — falls back to the CHUNK containing the answer', () => {
    // Segmentation chunks by meaning, not by where the blank was: "tend" is a
    // legitimate answer inside the entry "te tend".
    expect(glossForAnswer({ 'te tend': 'hands you', baguette: 'baguette' }, 'tend')).toBe(
      'hands you',
    );
  });

  it('LIFE-LANG-19 — the containing match is word-boundaried', () => {
    // "tend" must not match "attendre" — a substring match would gloss the
    // answer with an unrelated word's meaning, which is worse than no gloss.
    expect(glossForAnswer({ attendre: 'to wait' }, 'tend')).toBeNull();
  });

  it('LIFE-LANG-19 — prefers the TIGHTEST chunk that covers the answer', () => {
    const vocab = {
      'te tend une baguette': 'hands you a baguette',
      'te tend': 'hands you',
    };
    expect(glossForAnswer(vocab, 'tend')).toBe('hands you');
  });

  it('LIFE-LANG-19 — no vocab, no answer, or no match returns null (never a guess)', () => {
    expect(glossForAnswer(null, 'voudrais')).toBeNull();
    expect(glossForAnswer(undefined, 'voudrais')).toBeNull();
    expect(glossForAnswer({ voudrais: 'would like' }, '  ')).toBeNull();
    expect(glossForAnswer({ baguette: 'baguette' }, 'voudrais')).toBeNull();
  });

  it('LIFE-LANG-19 — an empty gloss is not a gloss', () => {
    // Better to suppress the label (LIFE-LANG-17) than render "It means: x · ".
    expect(glossForAnswer({ voudrais: '   ' }, 'voudrais')).toBeNull();
  });
});
