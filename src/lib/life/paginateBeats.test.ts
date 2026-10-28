import { describe, expect, it } from 'vitest';
import {
  MAX_BEATS,
  PAGE_SIZE,
  beatBudgetRule,
  needsPaging,
  paginateBeats,
} from './paginateBeats';

/**
 * LIFE-PAGE-1 — pagination in code.
 *
 * The properties here are the ones the PROMPT could not hold. The lean arm
 * returned a `continuation` node carrying two options where the rule is exactly
 * one, with that rule stated in the instruction. A page cannot be malformed
 * this way because a malformed page is not expressible.
 */
const beats = (n: number) => Array.from({ length: n }, (_, i) => `b${i}`);

describe('LIFE-PAGE-1 — paginateBeats', () => {
  it('leaves the common case alone — two beats is one page, no Continue', () => {
    expect(paginateBeats(beats(2))).toEqual([{ beats: ['b0', 'b1'], more: false, index: 0 }]);
  });

  it('splits three beats into 2 + 1, with a Continue only on the first', () => {
    const pages = paginateBeats(beats(3));
    expect(pages.map((p) => p.beats)).toEqual([['b0', 'b1'], ['b2']]);
    expect(pages.map((p) => p.more)).toEqual([true, false]);
  });

  it('the LAST page is always the one that carries the real options', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const pages = paginateBeats(beats(n));
      expect(pages.at(-1)!.more).toBe(false);
      expect(pages.slice(0, -1).every((p) => p.more)).toBe(true);
    }
  });

  it('preserves every beat, in order, across pages', () => {
    for (const n of [1, 3, 5, 6]) {
      expect(paginateBeats(beats(n)).flatMap((p) => p.beats)).toEqual(beats(n));
    }
  });

  it('an EMPTY array yields ONE empty page, not zero pages', () => {
    // A question node after a speech pick legitimately has no lead-in beats
    // (LIFE-CONTRACT-EX-7). Zero pages would mean nothing to render and nowhere
    // to attach the options — the node would vanish.
    expect(paginateBeats([])).toEqual([{ beats: [], more: false, index: 0 }]);
  });

  it('never emits an empty page except for empty input', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      expect(paginateBeats(beats(n)).every((p) => p.beats.length > 0)).toBe(true);
    }
  });

  it('indexes pages from zero, contiguously', () => {
    expect(paginateBeats(beats(5)).map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it('survives a nonsense page size rather than looping forever', () => {
    // `pageSize` is a constant today, but a zero or negative would hang the
    // loop, and a hang is the one failure mode a player cannot recover from.
    expect(paginateBeats(beats(3), 0).length).toBe(3);
    expect(paginateBeats(beats(3), -2).length).toBe(3);
    expect(paginateBeats(beats(3), 2.7)).toEqual(paginateBeats(beats(3), 2));
  });
});

describe('LIFE-PAGE-1 — needsPaging', () => {
  it('is false at or under the page size, true above it', () => {
    expect(needsPaging(beats(0))).toBe(false);
    expect(needsPaging(beats(PAGE_SIZE))).toBe(false);
    expect(needsPaging(beats(PAGE_SIZE + 1))).toBe(true);
  });
});

describe('LIFE-PAGE-1 — the rule the model is given', () => {
  it('states the DEFAULT before the exception', () => {
    const rule = beatBudgetRule();
    expect(rule.indexOf('TWO')).toBeLessThan(rule.indexOf(String(MAX_BEATS)));
  });

  it('names what the extra room is NOT for', () => {
    // A bound with no stated purpose reads as a target to work around — which
    // is how a "maximum 2 beats" rule produced a continuation with two options.
    expect(beatBudgetRule()).toMatch(/not use the extra room for two unrelated moments/i);
  });

  it('tells the model the client pages it, so it does not try to', () => {
    expect(beatBudgetRule()).toMatch(/client pages/i);
    expect(beatBudgetRule()).toMatch(/Continue/);
  });
});
