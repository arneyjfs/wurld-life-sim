import { describe, it, expect } from 'vitest';
import { buildWordBank, normalizeOrder, isOrderCorrect } from './wordOrder';

describe('buildWordBank — LIFE-EX-11', () => {
  it('splits a sentence into one tile per word, with stable original indices', () => {
    const tiles = buildWordBank('Je voudrais un café', 1);
    expect(tiles).toHaveLength(4);
    // Every original word is present exactly once (order shuffled).
    expect(tiles.map((t) => t.text).sort()).toEqual(
      ['Je', 'café', 'un', 'voudrais'].sort(),
    );
    // Indices are the ORIGINAL positions (0..3), preserved through the shuffle.
    expect(tiles.map((t) => t.index).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('keeps duplicate words individually addressable (distinct indices)', () => {
    const tiles = buildWordBank('le chat et le chien', 5);
    const les = tiles.filter((t) => t.text === 'le');
    expect(les).toHaveLength(2);
    expect(les[0]!.index).not.toBe(les[1]!.index);
  });

  it('is deterministic per seed + varies across seeds', () => {
    const a = buildWordBank('un deux trois quatre cinq', 3).map((t) => t.index);
    const b = buildWordBank('un deux trois quatre cinq', 3).map((t) => t.index);
    const c = buildWordBank('un deux trois quatre cinq', 4).map((t) => t.index);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('normalizeOrder / isOrderCorrect — LIFE-EX-11', () => {
  it('matches the target order ignoring case + surrounding whitespace', () => {
    expect(isOrderCorrect('  Je Voudrais un café  ', 'Je voudrais un café')).toBe(true);
  });

  it('rejects a wrong word order', () => {
    expect(isOrderCorrect('voudrais Je un café', 'Je voudrais un café')).toBe(false);
  });

  it('keeps punctuation + accents load-bearing', () => {
    expect(isOrderCorrect('Je viens quand même.', 'Je viens quand même.')).toBe(true);
    expect(isOrderCorrect('Je viens quand meme.', 'Je viens quand même.')).toBe(false);
  });

  it('rejects an empty answer', () => {
    expect(isOrderCorrect('', 'Je voudrais un café')).toBe(false);
    expect(isOrderCorrect('   ', 'Je voudrais un café')).toBe(false);
  });

  it('normalizeOrder lowercases + collapses whitespace', () => {
    expect(normalizeOrder('  Je   Voudrais  ')).toBe('je voudrais');
  });
});
