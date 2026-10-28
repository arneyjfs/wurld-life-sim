/**
 * Rate card for the cost simulation. USD.
 *
 * COST-RATE-1: every rate below is either (a) verified against the vendor's
 * published pricing page on RATES_VERIFIED_ON, or (b) explicitly marked
 * `verified: false` with the reason. An unverified rate must never be
 * presented as measured.
 *
 * Sources verified 2026-08-11:
 *   https://ai.google.dev/gemini-api/docs/pricing
 *   https://cloud.google.com/firestore/pricing
 *   https://cloud.google.com/run/pricing
 */

export const RATES_VERIFIED_ON = '2026-08-11';

/** Text-model rates, USD per 1M tokens. `cacheStorage` is USD per 1M cached
 *  tokens per HOUR the explicit cache is retained — a standing charge the
 *  app pays for the MSG-PIPE-15 analysis context cache regardless of load. */
export const MODEL_RATES = {
  'gemini-3.1-flash-lite': {
    input: 0.25, output: 1.5, cached: 0.025, cacheStorage: 1.0, verified: true,
  },
  'gemini-2.5-flash': {
    input: 0.3, output: 2.5, cached: 0.03, cacheStorage: 1.0, verified: true,
  },
  'gemini-2.5-flash-lite': {
    input: 0.1, output: 0.4, cached: 0.01, cacheStorage: 1.0, verified: true,
  },
  // Not present on the current pricing page (superseded by the 3.5/3.6 Flash
  // tiers). Carried over from src/lib/life/geminiPricing.ts. Practice mode's
  // five text generators route here (PRACTICE-GEN-11), so if this tier was
  // retired the real cost is whatever replaced it — see the errors log.
  'gemini-3-flash-preview': {
    input: 0.5, output: 3.0, cached: 0.05, cacheStorage: 1.0, verified: false,
    note: 'Not on the 2026-08-11 pricing page; inherited from geminiPricing.ts.',
  },
};

/**
 * Gemini-TTS rates. Billed as text-input tokens + AUDIO-OUTPUT tokens —
 * NOT per character. 25 audio tokens = 1 second of synthesised speech, and
 * there is no free allowance. Audio output dominates: at 25 tok/s and
 * $10/1M, one second of speech costs 400x what one input token costs.
 */
export const TTS_RATES = {
  'gemini-2.5-flash-tts': { textInput: 0.5, audioOutput: 10.0, verified: true },
  // Not separately listed; priced at the flash-tts tier (conservative — the
  // lite tier would be cheaper if it exists).
  'gemini-2.5-flash-lite-preview-tts': {
    textInput: 0.5, audioOutput: 10.0, verified: false,
    note: 'Not separately published; assumed equal to gemini-2.5-flash-tts.',
  },
};

export const TTS_AUDIO_TOKENS_PER_SECOND = 25;

/** Speaking rate used to turn a text length into an audio duration.
 *  ~150 wpm is ordinary conversational pacing; practice clips are short
 *  sentences delivered at natural speed (TTS-SPEED-1 default = 3/Natural). */
export const TTS_WORDS_PER_SECOND = 2.5;

/** Firestore Native, us-central1. USD. */
export const FIRESTORE = {
  readPer100k: 0.06,
  writePer100k: 0.18,
  deletePer100k: 0.02,
  storagePerGiBMonth: 0.18,
  egressPerGiB: 0.12,
  freeDaily: { reads: 50_000, writes: 20_000, deletes: 20_000 },
  freeStorageGiB: 1,
  verified: true,
};

/** Cloud Run functions (2nd gen), request-based billing, us-central1. */
export const CLOUD_RUN = {
  perMillionRequests: 0.4,
  perVcpuSecond: 0.000024,
  perGiBSecond: 0.0000025,
  freeMonthly: { requests: 2_000_000, vcpuSeconds: 180_000, gibSeconds: 360_000 },
  verified: true,
};

/** Cloud Storage (image messages + generated audio are client-cached, not
 *  stored server-side; only user image uploads persist). */
export const CLOUD_STORAGE = {
  standardPerGiBMonth: 0.026,
  egressPerGiB: 0.12,
  classAPer10k: 0.05,
  classBPer10k: 0.004,
  verified: true,
};

/** Unknown/renamed model ids fall back to the lite tier rather than $0 —
 *  an under-report reads as "this is free", the worst failure mode here. */
const FALLBACK = MODEL_RATES['gemini-3.1-flash-lite'];

export function rateFor(model) {
  if (!model) return FALLBACK;
  const id = String(model).replace(/^(models|tunedModels)\//, '');
  if (MODEL_RATES[id]) return MODEL_RATES[id];
  const prefixHit = Object.keys(MODEL_RATES)
    .filter((k) => id.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefixHit ? MODEL_RATES[prefixHit] : FALLBACK;
}

/**
 * Cost of one text-model call.
 *
 * `tokens.in` is the WHOLE prompt and INCLUDES the cached portion (this is
 * how Gemini reports promptTokenCount); `cached` is a subset of it, not an
 * addition. Billing splits it: `in - cached` at the standard rate plus
 * `cached` at the cache rate. Treating them as disjoint double-counts the
 * prefix on every call.
 */
export function callCost(tokens, model) {
  const r = rateFor(model);
  const cached = Math.max(0, Math.min(tokens.cached ?? 0, tokens.in));
  const uncachedIn = Math.max(0, tokens.in - cached);
  const inputUsd = (uncachedIn / 1e6) * r.input;
  const cachedUsd = (cached / 1e6) * r.cached;
  const outputUsd = (tokens.out / 1e6) * r.output;
  return {
    inputUsd,
    cachedUsd,
    outputUsd,
    totalUsd: inputUsd + cachedUsd + outputUsd,
    /** What the call would have cost with no cache hit — the saving the
     *  prefix ordering actually buys. */
    uncachedTotalUsd: (tokens.in / 1e6) * r.input + outputUsd,
  };
}

/** Cost of one TTS synthesis. `textTokens` is the prompt; `audioSeconds`
 *  drives the audio-output tokens that dominate the bill. */
export function ttsCost(textTokens, audioSeconds, model) {
  const r = TTS_RATES[model] ?? TTS_RATES['gemini-2.5-flash-tts'];
  const audioTokens = Math.ceil(audioSeconds * TTS_AUDIO_TOKENS_PER_SECOND);
  return {
    inputUsd: (textTokens / 1e6) * r.textInput,
    outputUsd: (audioTokens / 1e6) * r.audioOutput,
    audioTokens,
    totalUsd: (textTokens / 1e6) * r.textInput + (audioTokens / 1e6) * r.audioOutput,
  };
}

export function formatUsd(usd) {
  if (usd === 0) return '$0';
  const a = Math.abs(usd);
  if (a < 0.000001) return `$${usd.toExponential(2)}`;
  if (a < 0.01) return `$${usd.toFixed(6)}`;
  if (a < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
