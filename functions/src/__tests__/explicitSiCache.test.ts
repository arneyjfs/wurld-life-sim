import {
  EXPLICIT_SI_CACHE_CATEGORIES,
  explicitSiCacheSlot,
  isExplicitSiCacheCategory,
  serverOwnedSystemInstruction,
} from "../explicitSiCache";
import { BACKDROP_SYSTEM_INSTRUCTION } from "../prompts/lifeBackdrop";

/**
 * LIFE-BACKDROP-12 — eligibility for the explicit SI cache. The cache MECHANISM is
 * shared with the analysis SI and the tutor and lives in index.ts
 * (`getOrCreateExplicitCache`); its adoption predicate is covered by
 * analysisContextCache.test.ts. What is tested here is the eligibility rule —
 * the part with a wrong answer that costs real money, since caching a
 * per-user-parameterised SI fragments into one billed cache per variant.
 */
describe("isExplicitSiCacheCategory (LIFE-BACKDROP-12)", () => {
  it("allows life_backdrop — a byte-constant SI above break-even call rate", () => {
    expect(isExplicitSiCacheCategory("life_backdrop")).toBe(true);
  });

  it("refuses life_step — its SI is parameterised, so caches would fragment", () => {
    expect(isExplicitSiCacheCategory("life_step")).toBe(false);
  });

  it("refuses the NPC-avatar categories — constant SI, but sub-break-even rate", () => {
    expect(isExplicitSiCacheCategory("life_npc_avatar")).toBe(false);
    expect(isExplicitSiCacheCategory("life_npc_avatar_params")).toBe(false);
  });

  it("refuses unknown / non-string categories rather than defaulting open", () => {
    expect(isExplicitSiCacheCategory("unknown")).toBe(false);
    expect(isExplicitSiCacheCategory(undefined)).toBe(false);
    expect(isExplicitSiCacheCategory(null)).toBe(false);
    expect(isExplicitSiCacheCategory({ category: "life_backdrop" })).toBe(false);
  });
});

/**
 * LIFE-BACKDROP-29 — one cache slot per allowlisted category.
 *
 * Found 2026-08-09 while measuring `life_step` caching. The allowlist above is
 * documented as extensible ("Adding one is a COST decision, not a cleanup"),
 * but the call site in index.ts passed a HARD-CODED `"backdrop"` cacheKey and
 * the single `system/backdropContextCache` doc path for whatever category
 * cleared the allowlist. With one entry that is correct; with two it is a
 * money leak, and a silent one:
 *
 *   category X caches → slot holds digest(X)
 *   category Y calls  → digest mismatch → CREATE (bills Y's whole SI) → publish
 *   category X calls  → digest mismatch → CREATE (bills X's whole SI) → publish
 *
 * — perpetual thrash where every call pays a full-price create, i.e. strictly
 * WORSE than not caching at all. Nothing would have surfaced it: `[si-cache]
 * created` logs read as normal, and the failure only shows up as a bill.
 *
 * These assertions are written against ARBITRARY category strings rather than
 * the current single-entry allowlist, because the defect only exists on the
 * day someone adds the second entry — which is exactly when nobody re-reads
 * the call site.
 */
describe("explicitSiCacheSlot (LIFE-BACKDROP-29)", () => {
  it("gives two categories different slots — both key AND doc path", () => {
    const a = explicitSiCacheSlot("life_backdrop");
    const b = explicitSiCacheSlot("life_npc_avatar");
    expect(a.cacheKey).not.toBe(b.cacheKey);
    expect(a.docPath).not.toBe(b.docPath);
  });

  it("is stable — the same category always resolves to the same slot", () => {
    expect(explicitSiCacheSlot("life_backdrop")).toEqual(explicitSiCacheSlot("life_backdrop"));
  });

  it("keeps life_backdrop on the doc path already published in prod", () => {
    // Changing it would strand the live cache handle and make every warm
    // instance pay a fresh create instead of adopting.
    expect(explicitSiCacheSlot("life_backdrop").docPath).toBe("system/backdropContextCache");
  });

  it("every allowlisted category resolves to a valid Firestore document path", () => {
    for (const category of EXPLICIT_SI_CACHE_CATEGORIES) {
      const { docPath } = explicitSiCacheSlot(category);
      // collection/document — exactly one separator, and an id Firestore accepts.
      expect(docPath.split("/")).toHaveLength(2);
      expect(docPath.split("/")[1]).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

/**
 * LIFE-BACKDROP-30 — you may only cache a prompt you own.
 *
 * The rule these assert is not a style preference. `geminiGenerate` reads
 * `systemInstruction` and `category` from the request body, and the cache
 * digest used to be computed over whatever bytes arrived. That let any
 * authenticated caller mint unbounded billed caches — and, without any
 * attacker, made an ordinary staged rollout pathological: two app versions
 * carrying different prompt bytes are both live for a while, each overwrites
 * the other's shared cache record, and every call then pays to create a cache
 * the next call discards. Caching cost MORE than not caching.
 */
describe("LIFE-BACKDROP-30 — server-owned prompts", () => {
  it("LIFE-BACKDROP-30 — every cacheable category has a server-owned SI", () => {
    // The load-bearing one. If this can fail, a category became cacheable
    // without the server holding its bytes, and the client can steer the
    // digest again.
    for (const category of EXPLICIT_SI_CACHE_CATEGORIES) {
      const si = serverOwnedSystemInstruction(category);
      expect(si, `${category} is cacheable but the server owns no SI for it`).toBeTruthy();
      expect(typeof si).toBe("string");
    }
  });

  it("LIFE-BACKDROP-30 — life_backdrop resolves to the server's own copy", () => {
    expect(serverOwnedSystemInstruction("life_backdrop")).toBe(BACKDROP_SYSTEM_INSTRUCTION);
  });

  it("LIFE-BACKDROP-30 — a category the server owns nothing for returns null, so the caller's own SI stands", () => {
    // Substitution must be opt-in per category: `geminiGenerate` is a generic
    // passthrough and most callers legitimately supply their own instruction.
    expect(serverOwnedSystemInstruction("life_step")).toBeNull();
    expect(serverOwnedSystemInstruction("unknown")).toBeNull();
    expect(serverOwnedSystemInstruction(undefined)).toBeNull();
    expect(serverOwnedSystemInstruction(null)).toBeNull();
    expect(serverOwnedSystemInstruction({ category: "life_backdrop" })).toBeNull();
  });

  it("LIFE-BACKDROP-30 — a server-owned SI interpolates nothing, so one cache serves every user", () => {
    // The premise the whole explicit cache rests on. A `${...}` creeping in
    // would fragment the cache per user and quietly invert its economics —
    // and nothing else would report it.
    for (const category of EXPLICIT_SI_CACHE_CATEGORIES) {
      const si = serverOwnedSystemInstruction(category) ?? "";
      expect(si, `${category} SI must not interpolate`).not.toContain("${");
      expect(si.length).toBeGreaterThan(100);
    }
  });
});
