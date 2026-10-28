import { describe, expect, it } from 'vitest';
import { compositeOf, median, spreadAcrossRuns } from './runVariance';

/**
 * LIFE-BENCH-7 — the aggregation the benchmark's resolution limit is read from.
 *
 * Unit-tested rather than trusted, because the two decisions encoded here are
 * both ones this repo has got wrong before at a different level: treating an
 * UNMEASURED score as a bad one (`rubric.collapse`'s own note), and reading a
 * mean where one catastrophic sample should not dominate.
 */
describe('LIFE-BENCH-7 — median of N runs', () => {
  it('takes the middle value on odd counts and the midpoint on even', () => {
    expect(median([2, 1, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('is NaN for no runs rather than 0 — an absent score is not a zero', () => {
    expect(median([])).toBeNaN();
  });

  it('is not dragged by one catastrophic run the way a mean is', () => {
    // The case this exists for: three ordinary runs and one world that failed
    // to open. The median describes what a player typically meets.
    const scores = [3, 3, 3, 0];
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(median(scores)).toBe(3);
    expect(mean).toBeLessThan(median(scores));
  });
});

describe('LIFE-BENCH-7 — spread across runs', () => {
  const run = (pairs: [string, number][]) => ({
    scores: pairs.map(([dimension, score]) => ({ dimension, score })),
  });

  it('reports the min/max/spread per dimension across runs', () => {
    const rows = spreadAcrossRuns([
      run([['PROSE', 2], ['INTENT', 1]]),
      run([['PROSE', 3], ['INTENT', 1]]),
      run([['PROSE', 1], ['INTENT', 1]]),
    ]);
    const prose = rows.find((r) => r.dimension === 'PROSE')!;
    expect(prose.min).toBe(1);
    expect(prose.max).toBe(3);
    expect(prose.spread).toBe(2);
    expect(rows.find((r) => r.dimension === 'INTENT')!.spread).toBe(0);
  });

  it('sorts widest-spread first — the resolution limit is what you read', () => {
    const rows = spreadAcrossRuns([
      run([['STEADY', 2], ['NOISY', 0]]),
      run([['STEADY', 2], ['NOISY', 4]]),
    ]);
    expect(rows[0]!.dimension).toBe('NOISY');
  });

  it('EXCLUDES negative scores — those mean UNMEASURED, not bad', () => {
    // `rubric.collapse` makes exactly this distinction and says why: a layer
    // that could not see its subject must not overrule one that could.
    // Averaging -1 in would report a dimension as volatile for having been
    // unobservable in one run.
    const rows = spreadAcrossRuns([
      run([['ARC', 3]]),
      run([['ARC', -1]]),
      run([['ARC', 3]]),
    ]);
    const arc = rows.find((r) => r.dimension === 'ARC')!;
    expect(arc.scores).toEqual([3, 3]);
    expect(arc.spread).toBe(0);
  });

  it('a dimension absent from every run simply does not appear', () => {
    expect(spreadAcrossRuns([run([]), run([])])).toEqual([]);
  });
});

describe('LIFE-BENCH-7 — composite is read from either archive shape', () => {
  /**
   * Found by running the tool: `rubric.ts` writes `composite` as
   * `{ mean, gateFailures, weakest }` while the REPORT prints a bare number.
   * The first draft assumed the report's shape, so every composite came back
   * NaN and the summary line read `median NaN min Infinity`. A silent NaN in a
   * variance tool is the worst possible failure — it looks like "no data" when
   * it means "wrong key".
   */
  it('reads the object shape rubric.ts actually writes', () => {
    expect(compositeOf({ composite: { mean: 2.41 } })).toBeCloseTo(2.41);
  });

  it('still reads a bare number', () => {
    expect(compositeOf({ composite: 2.41 })).toBeCloseTo(2.41);
  });

  it('is NaN when absent, never 0', () => {
    expect(compositeOf({})).toBeNaN();
  });
});
