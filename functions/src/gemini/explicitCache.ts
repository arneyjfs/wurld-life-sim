/**
 * Explicit Gemini context caches for system instructions — ONE implementation
 * behind every "model from explicit cache" call site (audit CPLX-FN-3).
 *
 * There used to be five near-identical wrappers in `index.ts`
 * (`getCachedTutorModel`, `getCachedSlotModel`, `getCachedConvertModel`,
 * `getCachedAnalysisModel`, `getCachedSiModel`), each ending in the same
 * thinkingConfig → `getGenerativeModelFromCachedContent` → `catch → null`
 * block. Only two of them carried the `GEMINI_STUB` guard, so an emulator E2E
 * run (`GEMINI_STUB=1` with a real key in `functions/.secret.local`) still
 * created REAL, billed Gemini caches for the analysis SI and the tutor SI —
 * exactly what the guard on the other two said it prevented. The guard now
 * lives in `modelFromExplicitCache`, so no wrapper can be written without it
 * (MSG-PIPE-15.1).
 *
 * Contract (MSG-PIPE-15, MSG-PIPE-25, TUTOR-CTX-CACHE-6, LIFE-BACKDROP-11):
 * every function here answers a cache-backed `GenerativeModel` or `null`, and
 * `null` always means "use the inline-SI model this call". Nothing here
 * throws; caching never blocks a send.
 */
import type { GenerativeModel, CachedContent } from "@google/generative-ai";
import { getFirestore } from "../firebaseConfig";
import { GEMINI_STUB_ENABLED } from "../geminiStub";
import { buildTutorCacheKey, tutorCacheDocPath } from "../analysisCacheKey";
import { explicitSiCacheSlot, isExplicitSiCacheCategory } from "../explicitSiCache";
import { isSharedAnalysisCacheUsable, type SharedAnalysisCacheDoc } from "../analysisContextCache";
import type { ConvertMode } from "../prompts/translateMessage";
import type { GeminiModel } from "../modelAllowlist";
import { MODELS, cacheManager, genAI, type ThinkingConfig } from "./client";
import { shortHash } from "../shortHash";

// ── Explicit context cache for the analysis system instruction ──────────────
// The analysis SI is language-agnostic (unifiedAnalysis.ts) → byte-identical for
// every chat, so ONE explicit Gemini context cache serves them all. Each analyze
// call then bills the SI tokens at the cached rate instead of full price. On ANY
// cache failure the caller falls back to the inline-SI model, so caching is a
// pure optimisation that never blocks a send. Cross-instance sharing
// (MSG-PIPE-15): the cache identity is published to ONE Firestore doc, so a warm
// instance ADOPTS an existing cache (a cheap metadata fetch) instead of each
// paying the full create cost — create bills the whole SI once; adopt bills
// nothing.
const ANALYSIS_CACHE_TTL_SECONDS = 3600; // 1h server-side TTL
const ANALYSIS_CACHE_REFRESH_MS = 10 * 60_000; // recreate when < 10min remain
const ANALYSIS_CACHE_DOC_PATH = "system/analysisContextCache";

/**
 * Explicit SI caches, KEYED.
 *
 * This was a single slot when analysis was the only caller — there is exactly
 * one analysis SI. The tutor (TUTOR-INV-18) needs its own, and the convert
 * surfaces one per mode, so the slot became a map rather than being copied: a
 * second copy of the adopt/create/publish dance is a second place for the TTL,
 * the refresh window and the Firestore shape to drift apart.
 */
type ExplicitCacheSlot = { siDigest: string; model: string; cached: CachedContent; expiresAtMs: number };
const explicitCacheEntries = new Map<string, ExplicitCacheSlot>();
const explicitCacheInflight = new Map<string, Promise<CachedContent | null>>();
/**
 * MSG-PIPE-25.1 — system instructions Gemini has REFUSED to cache because they
 * are below its minimum, keyed to the exact SI digest that was refused.
 *
 * Gemini's floor is `min_total_token_count=1024`, and two of our SIs sit under
 * it: the per-message `translate-only` convert prompt (734 tokens) and its
 * batch twin (591). Measured with `scripts/cost-sim/cachefloor.mjs`.
 *
 * Without this, a below-floor SI is not merely un-cached — it is un-cached AND
 * pays for the discovery on EVERY call, because the create is attempted, fails
 * with a 400, and falls back. That is a network round-trip added to the send
 * hot path, forever, in exchange for nothing. The fallback itself was always
 * correct; what was missing was remembering.
 *
 * Keyed on the digest so a prompt edit that pushes the SI over the floor starts
 * caching again with no deploy-time bookkeeping, and one that drops it back
 * under re-learns the refusal once.
 */
const explicitCacheTooSmall = new Map<string, string>();
/** Gemini's own words when an SI is under the floor. Matched on the message
 *  rather than the status because a 400 alone is not specific enough to
 *  permanently stop trying. */
const CACHE_TOO_SMALL = /too small|min_total_token_count/i;

/**
 * Adopt a cache another instance published, if one is usable for this SI+model.
 * A metadata fetch (`cacheManager.get`) — far cheaper than re-creating. Returns
 * null (→ create a fresh one) if the doc is missing, stale, or the fetch fails
 * (e.g. the cache was garbage-collected before this read).
 */
async function adoptSharedExplicitCache(
  cacheKey: string,
  docPath: string,
  siDigest: string,
  modelName: string,
  nowMs: number,
): Promise<CachedContent | null> {
  try {
    const snap = await getFirestore().doc(docPath).get();
    const doc = snap.exists ? (snap.data() as Partial<SharedAnalysisCacheDoc>) : null;
    if (!isSharedAnalysisCacheUsable(doc, siDigest, modelName, nowMs, ANALYSIS_CACHE_REFRESH_MS)) {
      return null;
    }
    const cached = await cacheManager.get(doc.name);
    explicitCacheEntries.set(cacheKey, { siDigest, model: modelName, cached, expiresAtMs: doc.expiresAtMs });
    console.info("[si-cache] adopted", { key: cacheKey, name: doc.name });
    return cached;
  } catch (err: any) {
    console.warn("[si-cache] adopt failed — will create", { key: cacheKey, err: err?.message ?? String(err) });
    return null;
  }
}

async function getOrCreateExplicitCache(
  cacheKey: string,
  docPath: string,
  si: string,
  modelName: string,
): Promise<CachedContent | null> {
  // sha256-based (CPLX-FN-14): a 32-bit digest collision would ADOPT a cache
  // built from a different SI.
  const siDigest = shortHash(si);
  const nowMs = Date.now();
  // MSG-PIPE-25.1 — this exact SI has already been refused as below Gemini's
  // 1,024-token floor. Re-asking costs a round trip on the send path and gets
  // the same 400 back.
  if (explicitCacheTooSmall.get(cacheKey) === siDigest) return null;
  const cur = explicitCacheEntries.get(cacheKey);
  if (cur && cur.siDigest === siDigest && cur.model === modelName && cur.expiresAtMs - nowMs > ANALYSIS_CACHE_REFRESH_MS) {
    return cur.cached;
  }
  // In-flight de-dup: concurrent calls on a warm instance share one create,
  // but only when they want the SAME cache. API-GW-6.3 — keyed by slot + model
  // + SI digest, not slot alone: two concurrent calls on one slot asking for
  // different models must each get a cache for their own model (the cache
  // fixes the model). Two different slots never block each other either.
  const inflightKey = `${cacheKey}|${modelName}|${siDigest}`;
  const inflight = explicitCacheInflight.get(inflightKey);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      // 1) Adopt a cache another instance already created (shared via Firestore).
      const adopted = await adoptSharedExplicitCache(cacheKey, docPath, siDigest, modelName, nowMs);
      if (adopted) return adopted;
      // 2) None usable — create one and publish it for other instances.
      const cached = await cacheManager.create({
        model: `models/${modelName}`,
        contents: [], // SI-only cache — no seeded conversation turns
        systemInstruction: { role: "system", parts: [{ text: si }] },
        ttlSeconds: ANALYSIS_CACHE_TTL_SECONDS,
      });
      const expiresAtMs = nowMs + ANALYSIS_CACHE_TTL_SECONDS * 1000;
      explicitCacheEntries.set(cacheKey, { siDigest, model: modelName, cached, expiresAtMs });
      const cachedTokens = (cached as { usageMetadata?: { totalTokenCount?: number } }).usageMetadata?.totalTokenCount;
      console.info("[si-cache] created", { key: cacheKey, name: cached.name, tokens: cachedTokens });
      // Publish for other instances — best-effort, never blocks the send.
      if (cached.name) {
        await getFirestore()
          .doc(docPath)
          .set({ name: cached.name, siDigest, model: modelName, expiresAtMs } satisfies SharedAnalysisCacheDoc)
          .catch((err: any) =>
            console.warn("[si-cache] publish failed", { key: cacheKey, err: err?.message ?? String(err) }),
          );
      }
      return cached;
    } catch (err: any) {
      // Quota or transient API error → run inline this time and try again on
      // the next call. Below the min-cacheable size is DIFFERENT: it is a
      // permanent property of these bytes, so record it and stop asking
      // (MSG-PIPE-25.1). Either way the caller falls back to the inline SI.
      const msg = err?.message ?? String(err);
      if (CACHE_TOO_SMALL.test(msg)) {
        explicitCacheTooSmall.set(cacheKey, siDigest);
        console.info("[si-cache] SI below Gemini's cache floor — inline from now on", { key: cacheKey });
      } else {
        console.warn("[si-cache] create failed — using inline SI", { key: cacheKey, err: msg });
      }
      return null;
    } finally {
      explicitCacheInflight.delete(inflightKey);
    }
  })();
  explicitCacheInflight.set(inflightKey, p);
  return p;
}

/** Test seam (API-GW-6.3): the adopt/create path without the stub guard. */
export const _getOrCreateExplicitCache = getOrCreateExplicitCache;

/**
 * MSG-PIPE-15.1 — THE one way to get a model backed by an explicit SI cache.
 *
 * `null` means "use the inline-SI model this call", and it is the answer:
 *  - under `GEMINI_STUB=1` (the emulator harness stubs `generateContent` but
 *    NOT the cache manager, so without this every e2e run would create real,
 *    billed caches against Gemini — CPLX-FN-3);
 *  - on any adopt / create / model-from-cache failure (MSG-PIPE-15: caching
 *    never blocks a send).
 *
 * Thinking rides on `modelParams`; the SI itself lives in the cache. The
 * request-level generationConfig is merged over this in `robustGenerate`
 * (`buildGenerateRequest`) — without that merge the SDK would drop it.
 */
export async function modelFromExplicitCache(p: {
  cacheKey: string;
  docPath: string;
  si: string;
  model: string;
  thinking?: ThinkingConfig;
}): Promise<GenerativeModel | null> {
  if (GEMINI_STUB_ENABLED) return null;
  const cached = await getOrCreateExplicitCache(p.cacheKey, p.docPath, p.si, p.model);
  if (!cached) return null;
  try {
    const thinkingConfig: Record<string, unknown> = {};
    if (typeof p.thinking?.thinkingLevel === "string") thinkingConfig.thinkingLevel = p.thinking.thinkingLevel;
    if (typeof p.thinking?.thinkingBudget === "number") thinkingConfig.thinkingBudget = p.thinking.thinkingBudget;
    // `any`: the SDK's GenerationConfig type predates thinkingConfig, so a
    // typed literal doesn't fit.
    const modelParams: any = Object.keys(thinkingConfig).length ? { generationConfig: { thinkingConfig } } : {};
    return genAI.getGenerativeModelFromCachedContent(cached, modelParams);
  } catch (err: any) {
    console.warn("[si-cache] model-from-cache failed — using inline SI", {
      key: p.cacheKey, err: err?.message ?? String(err),
    });
    return null;
  }
}

/** MSG-PIPE-15 — the analysis SI is a singleton: one key, the original doc path. */
export function getCachedAnalysisModel(si: string, thinking?: ThinkingConfig): Promise<GenerativeModel | null> {
  return modelFromExplicitCache({
    cacheKey: "analysis", docPath: ANALYSIS_CACHE_DOC_PATH, si, model: MODELS.analysis, thinking,
  });
}

/**
 * TUTOR-CTX-CACHE-6 — the tutor's explicit SI cache.
 *
 * The tutor SI is invariant across the population — TUTOR-INV-18 moved
 * memories, the language pair and the gender into the user prompt precisely so
 * it would be. TUTOR-CTX-CACHE-9: the key is the tuple the SI actually depends
 * on, which is now just the model, so ONE entry serves every user.
 */
export function getCachedTutorModel(si: string, modelName: string, thinking?: ThinkingConfig): Promise<GenerativeModel | null> {
  const cacheKey = buildTutorCacheKey({ model: modelName });
  return modelFromExplicitCache({ cacheKey, docPath: tutorCacheDocPath(cacheKey), si, model: modelName, thinking });
}

/**
 * MSG-PIPE-25 / PRACTICE-CACHE-1 — a named slot whose SI is byte-identical
 * across the population (a convert mode, `convert_multi`, a server-built
 * practice prompt).
 */
export function getCachedSlotModel(slot: string, si: string, modelName: string, thinking?: ThinkingConfig): Promise<GenerativeModel | null> {
  return modelFromExplicitCache({
    cacheKey: `si:${slot}`, docPath: `system/siContextCache_${slot}`, si, model: modelName, thinking,
  });
}

/**
 * MSG-PIPE-25 — the convert surfaces' slots. One per (surface, mode); the count
 * never grows with the language list. `surface` separates the per-message SI
 * from the batch one: they are different strings, and a shared key would make
 * every call a cache CREATE (the slot rotates on an SI-digest mismatch).
 */
export function getCachedConvertModel(
  surface: "convert" | "batch-convert",
  mode: ConvertMode,
  si: string,
  modelName: string,
  thinking?: ThinkingConfig,
): Promise<GenerativeModel | null> {
  return getCachedSlotModel(`${surface}_${mode}`, si, modelName, thinking);
}

/**
 * LIFE-BACKDROP-11/29 — an allowlisted client category whose SI is a
 * byte-constant global. The slot is derived from the CATEGORY (a hard-coded
 * slot is a silent money leak for a two-entry allowlist — see
 * `explicitSiCacheSlot`).
 */
export async function getCachedSiModel(
  category: unknown,
  systemInstruction: string | undefined,
  modelName: GeminiModel,
  thinking?: ThinkingConfig,
): Promise<GenerativeModel | null> {
  if (typeof category !== "string" || !systemInstruction || !isExplicitSiCacheCategory(category)) {
    return null;
  }
  const { cacheKey, docPath } = explicitSiCacheSlot(category);
  return modelFromExplicitCache({ cacheKey, docPath, si: systemInstruction, model: modelName, thinking });
}
