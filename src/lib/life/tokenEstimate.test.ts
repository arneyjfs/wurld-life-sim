import { describe, it, expect } from 'vitest';
import { estimateTokens } from './tokenEstimate';

describe('estimateTokens — LIFE-COMPACT-1 context-budget heuristic', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  // The function signature types `text` as a string but defensive
  // code paths may pass null/undefined at runtime (e.g. an optional
  // rollingSummary). The implementation falls back to 0.
  it('returns 0 for nullish input (defensive)', () => {
    expect(estimateTokens(null as unknown as string)).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it('uses ~4 chars per token (rounded up)', () => {
    // 4 chars → 1 token.
    expect(estimateTokens('abcd')).toBe(1);
    // 8 chars → 2 tokens.
    expect(estimateTokens('abcdefgh')).toBe(2);
    // 1-3 chars → 1 token (Math.ceil — short strings still count).
    expect(estimateTokens('a')).toBe(1);
    expect(estimateTokens('abc')).toBe(1);
  });

  it('scales roughly linearly for longer prose', () => {
    const longText = 'x'.repeat(4000); // 4000 chars
    expect(estimateTokens(longText)).toBe(1000); // 1000 tokens
  });

  it('handles unicode the same way (per-char, not per-byte)', () => {
    // String#length counts code units; the 4:1 heuristic is loose
    // enough that we don't try to be clever about multi-byte chars.
    const french = 'Bonjour, comment ça va ?'; // 24 chars
    expect(estimateTokens(french)).toBe(6);
  });
});
