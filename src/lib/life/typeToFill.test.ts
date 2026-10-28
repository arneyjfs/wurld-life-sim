import { describe, it, expect } from 'vitest';
import {
  shouldTypeFill,
  normalizeTypedAnswer,
  typedAnswerCorrect,
} from './typeToFill';

describe('shouldTypeFill — LIFE-EX-8', () => {
  it('is true for fill-blank at upper-intermediate+ (difficulty >= 4)', () => {
    expect(shouldTypeFill('generation', 4)).toBe(true);
    expect(shouldTypeFill('generation', 7)).toBe(true);
  });

  it('is false for fill-blank at levels 1-3 (they keep the chip scaffold)', () => {
    expect(shouldTypeFill('generation', 1)).toBe(false);
    expect(shouldTypeFill('generation', 2)).toBe(false);
    expect(shouldTypeFill('generation', 3)).toBe(false);
  });

  it("is false for comprehension at any level (you can't type an interpretation)", () => {
    expect(shouldTypeFill('comprehension', 5)).toBe(false);
    expect(shouldTypeFill('comprehension', 7)).toBe(false);
  });

  it('defaults difficulty to 2 (chips) when absent', () => {
    expect(shouldTypeFill('generation', null)).toBe(false);
    expect(shouldTypeFill('generation', undefined)).toBe(false);
  });
});

describe('typedAnswerCorrect / normalizeTypedAnswer — LIFE-EX-8', () => {
  it('matches ignoring case + surrounding whitespace + punctuation/quotes', () => {
    expect(typedAnswerCorrect('  Voudrais  ', 'voudrais')).toBe(true);
    expect(typedAnswerCorrect('voudrais.', 'voudrais')).toBe(true);
    expect(typedAnswerCorrect('«voudrais»', 'voudrais')).toBe(true);
  });

  it('KEEPS accents — they are pedagogically load-bearing (ou ≠ où)', () => {
    expect(typedAnswerCorrect('ou', 'où')).toBe(false);
    expect(typedAnswerCorrect('où', 'où')).toBe(true);
  });

  it('collapses internal whitespace for multi-word targets', () => {
    expect(typedAnswerCorrect('quand   même', 'quand même')).toBe(true);
  });

  it('rejects a wrong answer AND an empty answer', () => {
    expect(typedAnswerCorrect('veux', 'voudrais')).toBe(false);
    expect(typedAnswerCorrect('   ', 'voudrais')).toBe(false);
    expect(typedAnswerCorrect('', 'voudrais')).toBe(false);
  });

  it('normalizeTypedAnswer lowercases + trims + strips edge punctuation', () => {
    expect(normalizeTypedAnswer('  «Café!»  ')).toBe('café');
  });
});
