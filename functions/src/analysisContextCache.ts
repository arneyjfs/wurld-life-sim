/**
 * MSG-PIPE-15 — shared analysis context-cache adoption predicate. Extracted from
 * index.ts so it can be unit tested without importing the whole pipeline graph
 * (the functions vitest project must never import ./index — see vitest.config.ts).
 *
 * The explicit Gemini context cache holding the (language-agnostic) analysis
 * system instruction is published to a single Firestore doc so warm instances
 * ADOPT one existing cache instead of each paying the full create cost. This
 * predicate decides whether a published doc is still usable for the CURRENT
 * SI + model: it must match both AND have more than the refresh margin left, so
 * we never adopt a cache we'd immediately have to recreate (the same margin the
 * in-memory entry uses).
 */
export type SharedAnalysisCacheDoc = {
  /** Gemini cache resource name, e.g. `cachedContents/abc123`. */
  name: string;
  /** Hash of the SI the cache was created from (must match to adopt). */
  siDigest: string;
  /** Model the cache is bound to (a cache is model-specific). */
  model: string;
  /** Absolute expiry (epoch ms) the creating instance computed from its TTL. */
  expiresAtMs: number;
};

export function isSharedAnalysisCacheUsable(
  doc: Partial<SharedAnalysisCacheDoc> | null | undefined,
  siDigest: string,
  model: string,
  nowMs: number,
  refreshMs: number,
): doc is SharedAnalysisCacheDoc {
  return (
    !!doc &&
    typeof doc.name === "string" &&
    doc.name.length > 0 &&
    doc.siDigest === siDigest &&
    doc.model === model &&
    typeof doc.expiresAtMs === "number" &&
    doc.expiresAtMs - nowMs > refreshMs
  );
}
