import { createHash } from "crypto";

/**
 * Tutor explicit-cache key helpers. (This module also held MSG-PIPE-13's
 * analysis RESULT cache key until that cache was deleted 2026-09-30, audit
 * CPLX-FN-11.)
 */

/**
 * TUTOR-CTX-CACHE-6 — key + Firestore doc path for the tutor's explicit SI
 * cache. Extracted so it is unit-testable: the functions vitest project must
 * never import index.ts.
 *
 * The key is exactly the tuple `buildTutorReplySystemInstruction` depends on.
 * If it ever hashed LESS than the SI depends on, two language pairs would
 * share one cache and a French learner would be served a German tutor's
 * instruction — so the cost of getting this wrong is a wrong-language reply,
 * not a slow one.
 *
 * TUTOR-CTX-CACHE-9 — that tuple is now just the MODEL. The SI stopped
 * depending on the language pair and the gender when both moved into the user
 * prompt, so keying on them would have split one cache into (pairs x genders)
 * identical copies, each billing storage around the clock. The rule is
 * unchanged and the reason it is safe is unchanged: the key still hashes
 * exactly what the SI varies on. The SI simply varies on less.
 *
 * The model stays in the key because a cache is bound to the model that created
 * it — a fallback to `gemini-3.6-flash` (TUTOR-CTX-CACHE-1; was
 * `gemini-2.5-flash` until that id was retired) cannot be served from the
 * flash-lite cache.
 *
 * The doc path still HASHES the key. Nothing in it needs escaping today, but
 * the hash is what makes that true of whatever gets added next.
 */
export function buildTutorCacheKey(input: { model: string }): string {
  return `tutor:${input.model}`;
}

export function tutorCacheDocPath(cacheKey: string): string {
  return `system/tutorContextCache_${createHash("sha256").update(cacheKey).digest("hex").slice(0, 32)}`;
}
