/**
 * OBS-USAGE-2: billed output tokens INCLUDE thinking tokens.
 *
 * Gemini reports the three counts as DISJOINT sets —
 * `promptTokenCount + candidatesTokenCount + thoughtsTokenCount ===
 * totalTokenCount` (verified empirically 2026-07-25 against
 * gemini-3.1-flash-lite and gemini-3.5-flash-lite). But Google BILLS
 * thinking tokens at the output rate. Recording `candidatesTokenCount`
 * alone therefore under-reports cost on any call that thinks — measured
 * at 51.9% under-report on a `thinkingLevel: "high"` call, and ~20% on
 * a `medium` backdrop generation.
 *
 * An under-report is the worst failure mode for a cost display: it reads
 * as "this is free" (the same reasoning `src/lib/life/geminiPricing.ts`
 * gives for its fallback rate). Every usage-recording path routes
 * through this helper so the admin dashboard and the in-story telemetry
 * tab agree with the invoice.
 */

/** The subset of Gemini's `usageMetadata` this module needs. */
export type GeminiUsageLike = {
  candidatesTokenCount?: number | null;
  thoughtsTokenCount?: number | null;
} | null | undefined;

/**
 * Output tokens as GOOGLE BILLS THEM: generated text + thinking.
 *
 * `thoughtsTokenCount` is absent on models/levels that don't think, and
 * absent on older SDKs — both coerce to 0 rather than NaN.
 */
export function billedOutputTokens(usage: GeminiUsageLike): number {
  if (!usage) return 0;
  const candidates = Number(usage.candidatesTokenCount ?? 0);
  const thoughts = Number(usage.thoughtsTokenCount ?? 0);
  const safe = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
  return safe(candidates) + safe(thoughts);
}
