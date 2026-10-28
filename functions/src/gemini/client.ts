/**
 * The Gemini SDK singletons and the per-use-case model registry.
 *
 * Extracted from `index.ts` (audit CPLX-FN-3/14/16, A6 §1.3 `gemini/client.ts`)
 * so the explicit-cache and generate helpers can live in their own modules —
 * and be unit-tested, which nothing inside `index.ts` can be (the functions
 * vitest project never imports `./index`).
 *
 * Importing this module constructs the SDK clients from `GEMINI_API_KEY`
 * exactly as `index.ts` used to at load time; nothing here does network I/O.
 */
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import { GoogleAICacheManager } from "@google/generative-ai/server";
import type { GeminiModel, GeminiThinkingLevel } from "../modelAllowlist";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
export const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
export const cacheManager = new GoogleAICacheManager(GEMINI_API_KEY);

/**
 * Per-use-case Gemini model selection. Single source of truth (MSG-PIPE-4) — if
 * you want to swap one use case to a different model (e.g. promote the batch
 * translator to a heavier model when accuracy beats latency), change ONE line
 * here. Every server call site reads from this map via the `MODELS.<useCase>`
 * key.
 *
 * Client-direct endpoints (`geminiGenerate`, `geminiStreamV2`) honour any
 * `model` field the client passes (through the allowlist); if the client omits
 * it, the server falls back to `MODELS.clientGenerate` / `MODELS.clientStream`.
 */
export const MODELS = {
  /** Per-message translate + annotate pipeline. */
  pipeline: "gemini-3.1-flash-lite",
  /** Unified analysis (corrections + natural alternative). */
  analysis: "gemini-3.1-flash-lite",
  /** Batch translation (chat-translations backfill, etc.). */
  batchTranslate: "gemini-3.1-flash-lite",
  /** Tutor agent reply generation. */
  tutorRespond: "gemini-3.1-flash-lite",
  /** Tutor message translation. */
  tutorTranslate: "gemini-3.1-flash-lite",
  /** Server default for client-direct non-stream calls
   *  (geminiGenerate — topics, practice quiz generation). */
  clientGenerate: "gemini-3.1-flash-lite",
  /** Server default for client-direct stream calls
   *  (geminiStreamV2 — ExplainModal). */
  clientStream: "gemini-3.1-flash-lite",
  /** Topic category label localisation in `onTopicCreate` (Firestore
   *  trigger). Cheap structured-output task — JSON map of locale→label. */
  topicLocalize: "gemini-3.1-flash-lite",
  /** `robustGenerate` fallback slot — used when the primary errors out
   *  (503 / overloaded, or 404 / model-deprecated) AFTER its retry.
   *
   *  ⚠ WAS `gemini-2.5-flash`, WHICH HAD ITSELF BEEN RETIRED. Probed against
   *  the live API 2026-09-18: it answers `404 — "no longer available to new
   *  users"`, so the slot that exists to rescue a 404 WAS one. The rescue path
   *  had been converting transient failures into hard ones, after paying for
   *  the extra attempt, and `ListModels` still lists the id so the catalogue
   *  would not have told you.
   *
   *  The old rationale — "a DIFFERENT model family, so falling back helps when
   *  the primary's family is degraded" — is no longer purchasable: every model
   *  that answers is 3.x. What survives of it is the TIER: every primary here
   *  is a flash-LITE and this is a flash, which is also what `gemini-2.5-flash`
   *  was, and it is the successor Google's own deprecation notice names. So
   *  this preserves the original decision as far as the available models allow
   *  rather than making a new one. Revisit if a non-3.x family appears. */
  fallback: "gemini-3.6-flash",
} as const satisfies Record<string, GeminiModel>;

/** Thinking config as the SDK takes it (3.x: `thinkingLevel`). */
export type ThinkingConfig = {
  thinkingBudget?: number;
  thinkingLevel?: GeminiThinkingLevel;
  includeThoughts?: boolean;
};

/**
 * ⚠ `isGemini3` AND THE 2.x ARMS OF THESE TWO ARE GONE, and the reason is not
 * tidiness: **there are no 2.x models left to serve.** `gemini-2.5-flash`,
 * `gemini-2.5-flash-lite` and `gemini-2.0-flash` all answer `404 — "no longer
 * available to new users"`, probed against the live API. `CLIENT_SELECTABLE_MODELS`
 * is now 3.x-only and `modelAllowlist.test.ts` asserts that, so the branch was a
 * test on a constant and its `thinkingBudget` arms were unreachable code
 * carrying a knob the surviving models do not take.
 *
 * Both functions still exist, and deliberately. They are not synonyms of each
 * other by accident — they are two DECISIONS that currently agree:
 * `getDynamicThinking` is "let the model decide" and `getMinimalThinking` is
 * "the prompt's structure already does the reasoning, do not pay twice". For
 * 3.x both answer `minimal`. Collapsing them into one would erase which call
 * sites made which decision, and the next model family to arrive is exactly
 * when that distinction gets its value back.
 *
 * `includeThoughts: true` is kept so we still surface any thoughts a model does
 * emit.
 */
export function getDynamicThinking(_modelName: GeminiModel): { thinkingLevel: GeminiThinkingLevel; includeThoughts: boolean } {
  return { thinkingLevel: "minimal", includeThoughts: true };
}

/** Force-minimal thinking — for tasks where the prompt's XML structure
 *  already drives reasoning (translate, analyze) so the model's internal
 *  thinking budget is wasted spend. */
export function getMinimalThinking(_modelName: GeminiModel): { thinkingLevel: GeminiThinkingLevel; includeThoughts: boolean } {
  return { thinkingLevel: "minimal", includeThoughts: true };
}

/**
 * A Gemini model with optional thinking config and system instruction.
 *
 * NOT cached (audit CPLX-FN-14). `getGenerativeModel` is a plain constructor —
 * no network I/O — and the old cache was an unbounded Map keyed by a 32-bit
 * djb2 hash of the system instruction: every distinct SI (per-call client SIs
 * included) was kept forever, and two SIs that collided would silently share
 * one model and so one instruction.
 */
export function getGeminiModel(
  modelName: GeminiModel,
  thinking?: ThinkingConfig,
  systemInstruction?: string,
): GenerativeModel {
  const config: any = {};
  const thinkingConfig: Record<string, unknown> = {};
  if (thinking?.includeThoughts) thinkingConfig.includeThoughts = true;
  if (typeof thinking?.thinkingLevel === "string") {
    thinkingConfig.thinkingLevel = thinking.thinkingLevel;
  }
  if (typeof thinking?.thinkingBudget === "number") {
    thinkingConfig.thinkingBudget = thinking.thinkingBudget;
  }
  if (Object.keys(thinkingConfig).length) {
    config.generationConfig = { thinkingConfig };
  }
  if (systemInstruction) {
    config.systemInstruction = { role: "system", parts: [{ text: systemInstruction }] };
  }
  return genAI.getGenerativeModel({ model: modelName, ...config });
}

/** The model id a `GenerativeModel` (inline or cache-backed) will call. */
export function getGeminiModelName(model: GenerativeModel | undefined): string {
  const anyModel = model as any;
  return String(anyModel?.model ?? anyModel?.modelParams?.model ?? MODELS.fallback);
}
