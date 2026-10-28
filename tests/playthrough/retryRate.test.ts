import { describe, expect, it } from 'vitest';
import { classifyRejection, poolRuns, wilson } from './retryRate';

/**
 * LIFE-BENCH-8 — the pooled retry-rate instrument.
 *
 * Every assertion here corresponds to a mistake already made once while
 * analysing this metric by hand, which is why the analysis is now a tested
 * module instead of a shell one-liner rewritten each time.
 */
describe('LIFE-BENCH-8 — Wilson interval', () => {
  it('brackets the observed rate', () => {
    const [lo, hi] = wilson(20, 100);
    expect(lo).toBeLessThan(0.2);
    expect(hi).toBeGreaterThan(0.2);
  });

  it('narrows as the sample grows — this is the whole reason arms are pooled', () => {
    const [lo1, hi1] = wilson(6, 30);
    const [lo2, hi2] = wilson(24, 120);
    expect(hi2 - lo2).toBeLessThan(hi1 - lo1);
  });

  it('never returns a negative lower bound, even at zero successes', () => {
    // The normal approximation does, and a tool that prints "-4.1%" stops
    // being believed at exactly the moment it matters.
    const [lo, hi] = wilson(0, 30);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(0);
  });

  it('is [0, 0] for an empty arm rather than NaN', () => {
    expect(wilson(0, 0)).toEqual([0, 0]);
  });
});

describe('LIFE-BENCH-8 — rejection attribution', () => {
  const turn = (act: string | null, canon: string[] = []) =>
    `${canon.length ? `<canon>${canon.map((i) => `<entity id="${i}"/>`).join('')}</canon>` : ''}` +
    `<turn kind="choice"${act ? ` speechAct="${act}"` : ''}><choice id="c1">Do it</choice></turn>`;

  const question = (beats: unknown[]) =>
    JSON.stringify({ node: { kind: 'question', beats, gradedPlan: {} }, options: [] });

  it('names a beatless question after an ACTION pick', () => {
    expect(classifyRejection(turn('act'), question([]))).toBe('question-omits-lead-in');
  });

  it('does NOT name it when the pick was `hear` — the check is disarmed there', () => {
    // The guard omitted from the first hand-rolled pass. A beatless question
    // after a `hear` pick is LEGAL, so counting it inflates the attribution.
    expect(classifyRejection(turn('hear'), question([]))).toContain('disarmed');
  });

  it('does NOT name it when no pick was rendered at all', () => {
    expect(classifyRejection('<turn kind="opening"/>', question([]))).toContain('disarmed');
  });

  it('reads the speechAct off a tag that CARRIES other attributes', () => {
    // The regex bug: `<turn kind="choice">` with the `>` fixed in place matched
    // only turns WITHOUT the attribute, so a first pass reported zero of them.
    expect(classifyRejection(turn('act'), question([]))).toBe('question-omits-lead-in');
  });

  it('prefers an unknown-entity-ref, which is a harder fault', () => {
    const body = JSON.stringify({
      node: { kind: 'question', beats: [], gradedPlan: {} },
      options: [{ targetId: 'ghost' }],
    });
    expect(classifyRejection(turn('act', ['real']), body)).toBe('unknown-entity-ref');
  });

  it('does not fire unknown-entity-ref on an EMPTY ledger', () => {
    // A brand-new world has no canon; enforcing then rejects every targeted
    // option for want of a ledger that cannot exist yet.
    const body = JSON.stringify({ node: { kind: 'branch', beats: [{}] }, options: [{ targetId: 'x' }] });
    expect(classifyRejection(turn('act'), body)).toBe('other');
  });

  it('reports unparseable output rather than throwing', () => {
    expect(classifyRejection(turn('act'), '{"node":')).toBe('not-json');
  });
});

describe('LIFE-BENCH-8 — pooling', () => {
  const archive = (attempts: number[]) => ({
    calls: attempts.map((attempt, i) => ({
      category: 'life_step',
      attempt,
      seq: i,
      prompt: '<turn kind="choice" speechAct="act"><choice id="c">x</choice></turn>',
      response: JSON.stringify({ node: { kind: 'question', beats: [], gradedPlan: {} }, options: [] }),
    })),
  });

  it('sums calls and retries across runs', () => {
    const p = poolRuns([archive([0, 1, 0]), archive([0, 0, 1, 0])]);
    expect(p.runs).toBe(2);
    expect(p.calls).toBe(7);
    expect(p.retries).toBe(2);
    expect(p.rate).toBeCloseTo(2 / 7);
  });

  it('ignores non-life_step categories', () => {
    const a = archive([0, 1]);
    a.calls.push({ ...a.calls[0]!, category: 'life_backdrop', attempt: 1, seq: 99 });
    expect(poolRuns([a]).calls).toBe(2);
  });

  it('attributes each retry to the response that was rejected', () => {
    const p = poolRuns([archive([0, 1])]);
    expect(p.attribution['question-omits-lead-in']).toBe(1);
  });

  it('an empty archive pools to a zero rate, not NaN', () => {
    const p = poolRuns([{ calls: [] }]);
    expect(p.rate).toBe(0);
    expect(Number.isNaN(p.rate)).toBe(false);
  });
});
