/**
 * LIFE-COST-1 — token→money. The arithmetic here is easy to get subtly wrong
 * in a way that silently under-reports, which is the worst failure mode for a
 * cost display: it reads as "this feature is free".
 */
import { describe, expect, it } from 'vitest';
import {
  MODEL_RATES,
  estimateCallCost,
  formatUsd,
  rateFor,
} from './geminiPricing';

const LITE = 'gemini-3.1-flash-lite';

describe('LIFE-COST-1 — call pricing', () => {
  it('does NOT double-count the cached prefix', () => {
    // Gemini's promptTokenCount INCLUDES the cached portion — cachedContent is
    // a subset, not an addition. Billing 1M input + 800k cached as if they
    // were disjoint would over-report the prefix on every single turn.
    const c = estimateCallCost({ in: 1_000_000, out: 0, cached: 800_000 }, LITE);
    expect(c.inputUsd).toBeCloseTo(0.2 * MODEL_RATES[LITE]!.input, 10);
    expect(c.cachedUsd).toBeCloseTo(0.8 * MODEL_RATES[LITE]!.cached, 10);
    // 200k uncached @ $0.25/M + 800k cached @ $0.025/M = $0.05 + $0.02
    expect(c.totalUsd).toBeCloseTo(0.07, 10);
  });

  // LIFE-COST-2. Measured 2026-07 against real Gemini: `candidatesTokenCount`
  // EXCLUDES reasoning tokens, which are billed at the output rate and only
  // appear in `thoughtsTokenCount`. Pricing `out` alone under-reported
  // `life_backdrop` by 21% and `life_world_saga` by 42%.
  it('bills thinking tokens at the OUTPUT rate, not free', () => {
    const withoutThinking = estimateCallCost({ in: 0, out: 1_000, cached: 0 }, LITE);
    const withThinking = estimateCallCost(
      { in: 0, out: 1_000, cached: 0, thoughts: 1_000 },
      LITE,
    );
    expect(withThinking.outputUsd).toBeCloseTo(withoutThinking.outputUsd * 2, 10);
    expect(withThinking.totalUsd).toBeGreaterThan(withoutThinking.totalUsd);
  });

  it('prices a thinking call the same as one that emitted the tokens visibly', () => {
    // 500 visible + 500 reasoning must cost exactly what 1,000 visible costs —
    // the split is a reporting detail, not a discount.
    const split = estimateCallCost({ in: 10, out: 500, cached: 0, thoughts: 500 }, LITE);
    const whole = estimateCallCost({ in: 10, out: 1_000, cached: 0 }, LITE);
    expect(split.totalUsd).toBeCloseTo(whole.totalUsd, 10);
  });

  it('treats a missing `thoughts` as zero so an older backend still prices', () => {
    const legacy = estimateCallCost({ in: 100, out: 200, cached: 0 }, LITE);
    const explicitZero = estimateCallCost(
      { in: 100, out: 200, cached: 0, thoughts: 0 },
      LITE,
    );
    expect(legacy.totalUsd).toBeCloseTo(explicitZero.totalUsd, 10);
  });

  it('counts thinking in the no-cache comparison too', () => {
    // uncachedTotalUsd drives the "cache saved you X" line — if it omitted
    // thinking, the saving would look bigger than it is.
    const c = estimateCallCost(
      { in: 1_000, out: 100, cached: 900, thoughts: 400 },
      LITE,
    );
    const r = MODEL_RATES[LITE]!;
    expect(c.uncachedTotalUsd).toBeCloseTo(
      (1_000 / 1e6) * r.input + (500 / 1e6) * r.output,
      10,
    );
  });

  it('prices output at its real premium — 6× input on flash-lite', () => {
    const inOnly = estimateCallCost({ in: 1_000_000, out: 0, cached: 0 }, LITE);
    const outOnly = estimateCallCost({ in: 0, out: 1_000_000, cached: 0 }, LITE);
    expect(outOnly.totalUsd / inOnly.totalUsd).toBeCloseTo(6, 5);
  });

  it('reports what the cache actually saved', () => {
    const c = estimateCallCost({ in: 100_000, out: 1_000, cached: 90_000 }, LITE);
    // Full price would be 100k @ $0.25/M + 1k @ $1.50/M.
    expect(c.uncachedTotalUsd).toBeCloseTo(0.025 + 0.0015, 10);
    expect(c.totalUsd).toBeLessThan(c.uncachedTotalUsd);
    // A 90% cache hit on the INPUT saves only ~76% of the call, not ~90%:
    // output tokens are never discounted, and at 6× the input rate even a
    // small completion dominates the residue. This is the ceiling on what any
    // amount of prefix-cache engineering can buy — past a point the only
    // lever left is emitting fewer output tokens.
    expect(1 - c.totalUsd / c.uncachedTotalUsd).toBeCloseTo(0.764, 2);
  });

  it('clamps a cached count that exceeds the prompt rather than going negative', () => {
    const c = estimateCallCost({ in: 100, out: 0, cached: 500 }, LITE);
    expect(c.inputUsd).toBe(0);
    expect(c.totalUsd).toBeGreaterThan(0);
  });

  it('an unknown model falls back to a REAL rate, never to free', () => {
    // Under-reporting is worse than mis-reporting: $0 reads as "free".
    const c = estimateCallCost({ in: 1_000_000, out: 0, cached: 0 }, 'gemini-9-unreleased');
    expect(c.totalUsd).toBeGreaterThan(0);
  });

  it('tolerates date-suffixed model ids, preferring the longest match', () => {
    expect(rateFor('gemini-3-flash-preview-06-2026')).toEqual(MODEL_RATES['gemini-3-flash-preview']);
    expect(rateFor('gemini-3.1-flash-lite-preview-11-2026')).toEqual(MODEL_RATES[LITE]);
  });

  it('missing usage metadata costs nothing rather than throwing', () => {
    expect(estimateCallCost(null, LITE).totalUsd).toBe(0);
    expect(estimateCallCost(undefined, null).totalUsd).toBe(0);
  });

  it('formats sub-cent amounts with enough precision to be readable', () => {
    // A single turn costs fractions of a cent; toFixed(2) would render the
    // entire table as "$0.00".
    expect(formatUsd(0.000123)).toBe('$0.00012');
    expect(formatUsd(0.0123)).toBe('$0.0123');
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(0)).toBe('$0');
  });
});

/**
 * Review #14/#15 — the SDK reports "models/<id>", which defeated every rate
 * key and priced EVERY call at the lite fallback (a silent 2× under-report on
 * backdrops/avatars). And 2.5-flash-lite must not inherit 2.5-flash's dearer rate.
 */
describe('LIFE-COST-1 — model-id normalization (review #14/#15)', () => {
  it('strips the SDK "models/" prefix so a non-lite model is priced correctly', () => {
    const flash = MODEL_RATES['gemini-3-flash-preview']!;
    expect(rateFor('models/gemini-3-flash-preview')).toEqual(flash);
    // Before the fix this returned the lite fallback — 2× cheaper than real.
    expect(rateFor('models/gemini-3-flash-preview').input).toBeGreaterThan(
      MODEL_RATES['gemini-3.1-flash-lite']!.input,
    );
  });

  it('handles a models/-prefixed, date-suffixed id via longest-prefix match', () => {
    expect(rateFor('models/gemini-3-flash-preview-09-2026'))
      .toEqual(MODEL_RATES['gemini-3-flash-preview']);
  });

  it('2.5-flash-lite is NOT priced at the dearer 2.5-flash rate', () => {
    const lite = rateFor('models/gemini-2.5-flash-lite');
    expect(lite).toEqual(MODEL_RATES['gemini-2.5-flash-lite']);
    expect(lite.input).toBeLessThan(MODEL_RATES['gemini-2.5-flash']!.input);
  });
});

describe('LIFE-COST-1 — gemini-3.5-flash-lite rates', () => {
  it('LIFE-COST-1 — 3.5-flash-lite is priced from the verified table', () => {
    const r = MODEL_RATES['gemini-3.5-flash-lite'];
    expect(r).toBeDefined();
    expect(r!.input).toBe(0.3);
    expect(r!.output).toBe(2.5);
    expect(r!.cached).toBe(0.03);
  });

  it('LIFE-COST-1 — 3.5-flash-lite costs MORE per token than 3.1 on both axes', () => {
    // Guards the migration rationale: 3.5 is not a cheaper drop-in.
    // It only wins where it emits materially fewer tokens.
    const lite31 = MODEL_RATES['gemini-3.1-flash-lite']!;
    const lite35 = MODEL_RATES['gemini-3.5-flash-lite']!;
    expect(lite35.input).toBeGreaterThan(lite31.input);
    expect(lite35.output).toBeGreaterThan(lite31.output);
  });

  it('LIFE-COST-1 — date-suffixed 3.5 ids resolve to the 3.5 row, not 3.1', () => {
    const r = rateFor('models/gemini-3.5-flash-lite-preview-09-2026');
    expect(r.output).toBe(2.5);
  });
});

describe('MSG-PIPE-31.5 — OpenAI rows', () => {
  it('MSG-PIPE-31.5 — gpt-6-luna is priced at its own rate, not the Gemini fallback', () => {
    expect(rateFor('gpt-6-luna')).toEqual({ input: 0.1, output: 0.5, cached: 0.01 });
  });
});
