/**
 * LIFE-BACKDROP-12: which telemetry categories may have their SYSTEM INSTRUCTION
 * served from an explicit Gemini context cache.
 *
 * The cache MECHANISM lives in index.ts (`getOrCreateExplicitCache`), shared
 * with the analysis SI and the tutor. This file owns only the eligibility
 * question, because that is the part with a wrong answer that costs money.
 *
 * Gemini's IMPLICIT prefix cache only engages above ~7.3k total input tokens
 * (`LIFE-CTX-14`), so a call with a big SI and a short prompt never gets a
 * discount: backdrop generation sends a ~1,600-token SI with a ~500-char prompt and
 * cached 0 tokens on every call. An explicit cache fixes exactly that shape.
 *
 * Two conditions, and BOTH matter:
 *
 *  - The SI must be a byte-constant GLOBAL **that the SERVER owns**.
 *    `BACKDROP_SYSTEM_INSTRUCTION` is (it interpolates nothing per world), so
 *    ONE cache serves every user. The `life_step` SI is the counter-example: it
 *    is parameterised on (practiceLanguage, nativeLanguage, systemLanguage,
 *    difficulty), so caches would fragment per language-pair x difficulty and
 *    never reach break-even. Hence an allowlist rather than "cache any SI we are
 *    sent".
 *    (`life_step` needs no rescue here anyway: measured 2026-08-09 it is already
 *    ~76% served by the IMPLICIT cache, which does engage at its ~21k input —
 *    `LIFE-CTX-14`/`-17`. The categories that need this one are the SMALL-input
 *    ones, which is the opposite end of the size range.)
 *  - Call rate must clear break-even. At ~1,600 SI tokens the saving is
 *    ~$0.00054/call against ~$0.0016/hour of storage → ~3 calls/hour globally.
 *    MEASURED 2026-08-11 (real Gemini `countTokens`, PR #6 review): the SI is
 *    10,637 chars = **2,757 tokens**, not ~1,600. That understates absolute
 *    spend by 1.7x but does NOT move break-even, and an earlier revision of
 *    this note claiming "a bigger SI means an EASIER break-even" was WRONG:
 *
 *        break-even calls/hr = (T·storage + creates·T·input) / (T·(input - cached))
 *
 *    T cancels. Break-even is SIZE-INVARIANT — a bigger SI raises the per-call
 *    saving and the hourly storage bill by exactly the same factor.
 *
 *    What DOES move the bar is the MODEL, and that is where ~3/hour fails to
 *    transfer. It was measured on `gemini-3-flash-preview` ($0.50 in / $0.05
 *    cached). Flash-lite input is half that, so the same storage needs ~1.6x
 *    the traffic to amortise:
 *
 *      gemini-3-flash-preview   2.22/hr storage-only | 3.56/hr incl. re-creates
 *      gemini-3.5-flash-lite    3.70/hr              | 5.04/hr
 *      gemini-3.1-flash-lite    4.44/hr              | 5.78/hr   <- practice
 *
 *    So applying the ~3/hour bar to anything on flash-lite is too LAX by ~1.9x.
 *    Use ~5.8 calls/hour PER DISTINCT CACHE there. `creates` = 1.2/hr, from
 *    TTL 3600s minus the 600s refresh window.
 *
 * Caching is a PURE OPTIMISATION: every failure path returns null and the caller
 * falls back to the inline-SI model, so it can never block a render.
 */
import { BACKDROP_SYSTEM_INSTRUCTION } from "./prompts/lifeBackdrop";

/**
 * LIFE-BACKDROP-30 — **you may only cache a prompt you own.**
 *
 * The system instruction for every cacheable category, held BY THE SERVER. The
 * allowlist below is derived from this map rather than written beside it, which
 * is the point: a category cannot be made cacheable without the server holding
 * its bytes, so the two can never disagree.
 *
 * That rule exists because the alternative was measured to fail in the boring
 * case, not the adversarial one. `geminiGenerate` takes `systemInstruction` and
 * `category` from the request body; when the allowlist gated only the category,
 * the cache digest was computed over whatever bytes arrived. Any authenticated
 * caller could therefore mint unbounded billed caches — but far more likely,
 * ANY ordinary staged rollout would: two app versions carrying different prompt
 * bytes are both live for a while, each overwrites the other's shared cache
 * record, every call misses, and every call pays to create a cache the next
 * call discards. Caching then costs strictly more than no caching, which is the
 * failure this file's own header warns about, reached without an attacker.
 *
 * Adding an entry is a COST decision, not a cleanup: verify the SI interpolates
 * nothing per-user, and that the category runs > ~3 calls/hour across the whole
 * deployment.
 *
 * `life_npc_avatar` / `life_npc_avatar_params` are deliberately absent: their
 * SIs are constant too, but a portrait renders roughly once per NPC ever, so the
 * hourly rate is not reliably above break-even.
 */
const SERVER_OWNED_SI: Readonly<Record<string, string>> = {
  life_backdrop: BACKDROP_SYSTEM_INSTRUCTION,
};

export const EXPLICIT_SI_CACHE_CATEGORIES: ReadonlySet<string> = new Set(
  Object.keys(SERVER_OWNED_SI),
);

export function isExplicitSiCacheCategory(category: unknown): boolean {
  return typeof category === "string" && EXPLICIT_SI_CACHE_CATEGORIES.has(category);
}

/**
 * The SI the server will use for `category`, or null when the server does not
 * own one and the caller's own instruction stands.
 *
 * Callers MUST prefer this over the request body for any category it answers,
 * for both the cached and the inline path — using the client's bytes inline
 * while caching the server's would make the cache a silent behaviour change
 * rather than an optimisation.
 */
export function serverOwnedSystemInstruction(category: unknown): string | null {
  if (typeof category !== "string") return null;
  return SERVER_OWNED_SI[category] ?? null;
}

/**
 * Categories that shipped before slots were per-category, mapped to the doc
 * path their cache is ALREADY published at. Keeping the path means a deploy
 * ADOPTS the live cache (a metadata fetch) instead of every warm instance
 * paying a fresh create. New categories never belong here — they get the
 * derived path below.
 */
const LEGACY_DOC_PATHS: Readonly<Record<string, string>> = {
  life_backdrop: "system/backdropContextCache",
};

/**
 * LIFE-BACKDROP-29 — the cache slot for one allowlisted category.
 *
 * The call site used to hard-code `("backdrop", BACKDROP_CACHE_DOC_PATH)` for
 * whatever cleared the allowlist. Correct with one entry; a money leak with
 * two, because `getOrCreateExplicitCache` keys its in-memory slot and its
 * Firestore doc on exactly these two strings and rotates on an SI-digest
 * mismatch. Two categories sharing them would see a mismatch on every call and
 * CREATE a cache every time — each create billing the full SI at full price,
 * which is strictly worse than not caching. Nothing would surface it but the
 * bill, so the fix belongs at the boundary rather than in a comment warning
 * the next person to remember.
 *
 * Only allowlisted categories reach here, and the allowlist is a hard-coded
 * Set of `[a-z_]` identifiers, so the derived path is a valid Firestore
 * document id by construction — the client cannot steer it.
 */
export function explicitSiCacheSlot(category: string): { cacheKey: string; docPath: string } {
  return {
    cacheKey: `si:${category}`,
    docPath: LEGACY_DOC_PATHS[category] ?? `system/siContextCache_${category}`,
  };
}
