/**
 * Spec: docs/specs/message-pipeline.md — MSG-PIPE-3, MSG-ROBUST-4.
 *
 * Decide whether a Gemini call's error justifies retrying with
 * `MODELS.fallback`. Two failure families count:
 *   - overloaded   (503 / "service unavailable" / "high demand")
 *   - model-gone   (404 / "no longer available" / "is deprecated" /
 *                   "not found" + "models/")
 *
 * Kept narrow on purpose: unrelated 404s (Firestore doc-not-found,
 * etc.) MUST NOT trigger the fallback swap. Burning the fallback on
 * errors the fallback can't help with would mask real failures and
 * waste latency.
 *
 * Extracted from `index.ts` so the unit test (shouldSwapToFallback.test.ts)
 * doesn't have to import the full Cloud-Function module (~7k lines of
 * firebase-functions / firebase-admin / sharp imports).
 */
export function shouldSwapToFallback(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  const isOverloaded =
    msg.includes("503") ||
    msg.includes("service unavailable") ||
    msg.includes("high demand");
  const isModelGone =
    msg.includes("no longer available") ||
    msg.includes("model is deprecated") ||
    (msg.includes("404") && msg.includes("model")) ||
    (msg.includes("not found") && msg.includes("models/"));
  return isOverloaded || isModelGone;
}
