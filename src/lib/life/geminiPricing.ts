/**
 * LIFE-COST-1: token → money.
 *
 * Token counts alone don't tell you whether a design decision was worth it —
 * output tokens cost 6× input on flash-lite, and a cached input token costs a
 * TENTH of an uncached one. A change that adds 2k input tokens to a cached
 * prefix is nearly free; one that adds 200 output tokens per turn is not.
 * This turns the telemetry buffer into a number you can act on.
 *
 * Rates are USD per 1,000,000 tokens, paid tier, text (audio is dearer and we
 * send none). Verified 2026-07-21 against
 * https://ai.google.dev/gemini-api/docs/pricing — update `RATES_VERIFIED_ON`
 * whenever you re-check, because these move.
 */

export const RATES_VERIFIED_ON = '2026-07-25';

export type ModelRate = {
  /** USD per 1M uncached input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cached input tokens (implicit or explicit cache hit). */
  cached: number;
};

/** Paid-tier text rates. Keys are the model ids this repo actually sends. */
export const MODEL_RATES: Record<string, ModelRate> = {
  // The life-sim's per-turn workhorse (lifeStep, scene gen/replan, graded
  // questions). Cached input is 10% of standard — a 90% discount, which is why
  // prefix-cache stability is worth engineering for.
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5, cached: 0.025 },
  // LIFE-BACKDROP-11: the backdrop-gen tier. DEARER than 3.1-flash-lite on
  // BOTH axes (+20% input, +67% output) — it is NOT a cheaper drop-in.
  // It only wins where it emits materially fewer tokens than the model
  // it replaces, which is why the migration moved backdrops here (off the
  // 0.5/3.0 preview tier) but left the per-turn + analysis paths on 3.1.
  // MUST precede the 'gemini-3.5-flash' row conceptually — longest-prefix
  // selection in rateFor() handles the ordering, but the row must exist
  // or a 3.5-lite id would fall through to the dearer flash rate.
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cached: 0.03 },
  'gemini-3.5-flash': { input: 1.5, output: 9.0, cached: 0.15 },
  // Backdrops, NPC avatars, the saga. 2× the lite tier on input, 2× on output.
  'gemini-3-flash-preview': { input: 0.5, output: 3.0, cached: 0.05 },
  'gemini-3-flash': { input: 0.5, output: 3.0, cached: 0.05 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cached: 0.03 },
  // MUST precede the 2.5-flash prefix match — "gemini-2.5-flash-lite" starts
  // with "gemini-2.5-flash", so without its own row it would be priced at the
  // dearer flash rate. Longest-prefix selection handles the ordering, but the
  // row must exist.
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cached: 0.01 },
  'gemini-3.1-pro-preview': { input: 2.0, output: 12.0, cached: 0.2 },
  // MSG-PIPE-31.5: OpenAI, the second provider behind the per-category
  // switch (analysis). Its 12 h cache WRITE bills 2.5x input, a few times a
  // day; not counted. Rates from the OpenAI pricing page, 2026-10-24.
  'gpt-6-luna': { input: 0.1, output: 0.5, cached: 0.01 },
};

/** Unknown/renamed models fall back to the lite tier rather than reporting
 *  $0 — an under-report reads as "this is free", which is the worst failure
 *  mode for a cost display. */
const FALLBACK: ModelRate = MODEL_RATES['gemini-3.1-flash-lite']!;

export function rateFor(model: string | null | undefined): ModelRate {
  if (!model) return FALLBACK;
  // The SDK reports the model as a resource name — "models/gemini-3-flash-
  // preview" (functions getGeminiModelName). Strip that prefix, or startsWith
  // never matches any rate key and EVERY call is mispriced at the fallback
  // (lite) tier — silently under-reporting backdrops/avatars, which cost 2×.
  const id = model.replace(/^(models|tunedModels)\//, '');
  if (MODEL_RATES[id]) return MODEL_RATES[id]!;
  // Tolerate date-suffixed ids ("gemini-3.1-flash-lite-preview-06-2026") via
  // longest-prefix match.
  const prefixHit = Object.keys(MODEL_RATES)
    .filter((k) => id.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefixHit ? MODEL_RATES[prefixHit]! : FALLBACK;
}

export type CallCost = {
  /** USD for the uncached portion of the prompt. */
  inputUsd: number;
  /** USD for the cache-served portion of the prompt. */
  cachedUsd: number;
  /** USD for generated tokens. */
  outputUsd: number;
  totalUsd: number;
  /** What the same call would have cost with NO cache hit — the saving the
   *  prefix ordering is actually buying. */
  uncachedTotalUsd: number;
};

export const ZERO_COST: CallCost = {
  inputUsd: 0, cachedUsd: 0, outputUsd: 0, totalUsd: 0, uncachedTotalUsd: 0,
};

/**
 * Cost of one call.
 *
 * NOTE ON `in`: Gemini's `promptTokenCount` is the WHOLE prompt and INCLUDES
 * the cached portion; `cachedContentTokenCount` is a subset of it, not an
 * addition. Billing therefore splits it — `in - cached` at the standard rate
 * plus `cached` at the cache rate. Treating them as disjoint would
 * double-count the prefix on every single turn.
 *
 * NOTE ON `out` (LIFE-COST-2): the opposite trap. `candidatesTokenCount` does
 * NOT include reasoning tokens — those arrive separately as
 * `thoughtsTokenCount` and are billed at the same OUTPUT rate. Pricing `out`
 * alone silently under-reported every thinking call (measured 2026-07: backdrop
 * by 21%, world saga by 42%), which is how a "cheap" call can be a third
 * dearer than the dashboard claims. Billed output is `out + thoughts`.
 * `thoughts` is optional so traces captured by an older backend still price.
 */
export function estimateCallCost(
  tokens:
    | { in: number; out: number; cached: number; thoughts?: number }
    | null
    | undefined,
  model: string | null | undefined,
): CallCost {
  if (!tokens) return ZERO_COST;
  const r = rateFor(model);
  const cached = Math.max(0, Math.min(tokens.cached, tokens.in));
  const uncachedIn = Math.max(0, tokens.in - cached);
  const billedOut = Math.max(0, tokens.out) + Math.max(0, tokens.thoughts ?? 0);
  const inputUsd = (uncachedIn / 1e6) * r.input;
  const cachedUsd = (cached / 1e6) * r.cached;
  const outputUsd = (billedOut / 1e6) * r.output;
  return {
    inputUsd,
    cachedUsd,
    outputUsd,
    totalUsd: inputUsd + cachedUsd + outputUsd,
    uncachedTotalUsd: (tokens.in / 1e6) * r.input + outputUsd,
  };
}

/** Money is small here — a turn costs fractions of a cent — so a plain
 *  `toFixed(2)` would render every row as "$0.00". Scale the precision to the
 *  magnitude instead. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
