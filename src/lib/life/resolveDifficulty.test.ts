import { describe, it, expect } from 'vitest';
import { resolveWurldDifficulty } from './resolveDifficulty';

describe('resolveWurldDifficulty — LIFE-SETTINGS-7', () => {
  it('LIFE-SETTINGS-7 — a pinned level wins over the global setting', () => {
    expect(resolveWurldDifficulty(4, 2)).toBe(4);
    expect(resolveWurldDifficulty(1, 7)).toBe(1);
    expect(resolveWurldDifficulty(7, 2)).toBe(7);
  });

  it('LIFE-SETTINGS-7 — a null/undefined pin follows the global setting', () => {
    expect(resolveWurldDifficulty(null, 5)).toBe(5);
    expect(resolveWurldDifficulty(undefined, 3)).toBe(3);
  });

  it('LIFE-SETTINGS-7 — both absent resolves to the default 2', () => {
    expect(resolveWurldDifficulty(null, undefined)).toBe(2);
    expect(resolveWurldDifficulty(undefined, undefined)).toBe(2);
  });

  it('LIFE-SETTINGS-7 — a pin of the lowest level (1) is honoured over global', () => {
    // Guards against a `pinned || global` regression: 1 is truthy, but the
    // intent is `pinned ?? global` so null (not 0/1) is the fall-through.
    expect(resolveWurldDifficulty(1, 6)).toBe(1);
  });
});
