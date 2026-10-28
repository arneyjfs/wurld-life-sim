/**
 * The ONE preparation both client-direct Gemini proxies run (audit CPLX-FN-2,
 * SRV-PROMPT-19). `geminiGenerate` and `geminiStreamV2` each used to resolve
 * the prompt, model, thinking, cache, fallback and generation config inline,
 * and every divergence between the copies was a bug found later: the stream
 * dropped `temperature` (MSG-PIPE-23), ignored the server's schema
 * (PRACTICE-OWN-10), and never consulted the explicit SI cache the
 * non-streaming endpoint serves allowlisted categories from.
 *
 * Everything that decides WHAT is sent lives here. What stays in each handler
 * is the transport: the auth/rate-limit/entitlement preamble, the call itself
 * (`robustGenerate` vs `generateContentStream`) and the response shape.
 */
import type { GenerativeModel } from "@google/generative-ai";
import { resolveClientModel, resolveClientThinking, type GeminiModel, type GeminiThinkingLevel } from "../modelAllowlist";
import { resolveServerPrompt, type PracticeRejectCode } from "../prompts/serverPromptSpec";
import { resolveLunaPrompt } from "../prompts/luna/clientKinds";
import type { ProviderCategory } from "../providerSwitch";
import type { RoutedOpenAIRequest } from "./routed";
import { getGeminiModel, getMinimalThinking, MODELS } from "./client";
import { getCachedSiModel, getCachedSlotModel } from "./explicitCache";

/** The body's category, normalised once: a non-string buckets as "unknown". */
export function clientCategory(body: unknown): string {
  const raw = (body as { category?: unknown } | null | undefined)?.category;
  return typeof raw === "string" ? raw : "unknown";
}

export type PreparedClientCall = {
  category: string;
  prompt: string;
  /** The server's SI (LIFE-BACKDROP-30) — bound once so the cached model, the
   *  inline fallback and the fallback MODEL all agree. */
  systemInstruction: string;
  primaryName: GeminiModel;
  thinking: { thinkingLevel: GeminiThinkingLevel };
  /** Cache-backed when a slot or the SI allowlist serves it, else inline SI. */
  model: GenerativeModel;
  /** Whether `model` is served from an explicit cache (telemetry). */
  cached: boolean;
  /** `MODELS.fallback` at minimal thinking (MSG-ROBUST-10), or undefined when
   *  the primary IS the fallback. */
  fallbackModel: GenerativeModel | undefined;
  generationConfig: Record<string, unknown> | undefined;
  /** MSG-PIPE-31.7 / 31.9 — the OpenAI side for a routed kind (its own Luna
   *  prompt, same temperature), or null: the kind stays Gemini-only and the
   *  handler calls Gemini exactly as before. */
  luna: { category: ProviderCategory; request: RoutedOpenAIRequest } | null;
};

export type ClientCallPreparation =
  | { status: "ok"; call: PreparedClientCall }
  | { status: "reject"; code: PracticeRejectCode; reason: string };

/**
 * Resolve everything a client-direct call sends. Never throws for a bad body:
 * a prompt the server will not build is a `reject` (the handler answers 400);
 * an unknown model or thinking level is neutralised to the endpoint default
 * (`resolveClientModel` / `resolveClientThinking` say why).
 */
export async function prepareClientCall(
  body: unknown,
  opts: { category: string; defaultModel: GeminiModel },
): Promise<ClientCallPreparation> {
  const b = (body ?? {}) as {
    promptSpec?: unknown;
    model?: unknown;
    thinkingLevel?: unknown;
    responseMimeType?: unknown;
    responseSchema?: unknown;
    temperature?: unknown;
  };
  const { category } = opts;

  const built = resolveServerPrompt(category, b.promptSpec);
  if (built.status === "reject") return built;

  const primaryName = resolveClientModel(b.model, opts.defaultModel, category);
  const thinking = resolveClientThinking(b.thinkingLevel, category);
  const systemInstruction = built.systemInstruction;

  // LIFE-BACKDROP-11 / PRACTICE-CACHE-1 — a server-built prompt names its own
  // cache slot when its SI is token-built; otherwise an allowlisted category's
  // byte-constant SI is served from the per-category cache. Either answers
  // null on any failure → inline SI.
  const cachedModel =
    (built.cacheSlot && systemInstruction
      ? await getCachedSlotModel(built.cacheSlot, systemInstruction, primaryName, thinking)
      : null)
    ?? (await getCachedSiModel(category, systemInstruction, primaryName, thinking));
  const model = cachedModel ?? getGeminiModel(primaryName, thinking, systemInstruction);

  const fallbackModel = primaryName !== MODELS.fallback
    ? getGeminiModel(MODELS.fallback, getMinimalThinking(MODELS.fallback), systemInstruction)
    : undefined;

  // MSG-PIPE-23 — validated on the same range on both transports.
  const temperature = typeof b.temperature === "number" && b.temperature >= 0 && b.temperature <= 2
    ? b.temperature
    : undefined;
  const responseMimeType = typeof b.responseMimeType === "string" && b.responseMimeType ? b.responseMimeType : undefined;
  // SRV-PROMPT-1 / PRACTICE-OWN-10 — a server-built schema is authoritative
  // over the body's.
  const bodySchema = b.responseSchema && typeof b.responseSchema === "object"
    ? (b.responseSchema as Record<string, unknown>)
    : undefined;
  const responseSchema = built.responseSchema ?? bodySchema;
  const generationConfig = (responseMimeType || responseSchema || temperature !== undefined)
    ? {
      ...(responseMimeType ? { responseMimeType } : {}),
      ...(responseSchema ? { responseSchema } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    }
    : undefined;

  const lunaPrompt = resolveLunaPrompt(category, b.promptSpec, built);
  const luna = lunaPrompt
    ? {
      category: lunaPrompt.providerCategory,
      request: {
        systemInstruction: lunaPrompt.systemInstruction,
        prompt: lunaPrompt.prompt,
        maxOutputTokens: lunaPrompt.maxOutputTokens,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(lunaPrompt.responseSchema ? { responseSchema: lunaPrompt.responseSchema } : {}),
        ...(lunaPrompt.strictSchema ? { strictSchema: true } : {}),
      },
    }
    : null;

  return {
    status: "ok",
    call: {
      category,
      prompt: built.prompt,
      systemInstruction,
      primaryName,
      thinking,
      model,
      cached: cachedModel !== null,
      fallbackModel,
      generationConfig,
      luna,
    },
  };
}

/**
 * MSG-PIPE-31.4a — the SSE relay for a routed stream. The client protocol
 * (`streamGemini` in src/lib/gemini.ts) is append-only: `data: {"text"}`
 * deltas the client concatenates, with no way to say "start again". So:
 *
 * - each partial is the provider's ACCUMULATED text; what extends what the
 *   client already has goes out as a delta;
 * - a new attempt (a provider switch, the backup model) before anything was
 *   sent is invisible to the client: the new attempt simply streams;
 * - a new attempt AFTER text was sent cannot be expressed, so the relay
 *   reports `restarted` once and goes quiet; the handler answers it with the
 *   stream's error event, which is what a mid-stream failure did before
 *   routing existed.
 */
export function createStreamRelay(write: (delta: string) => void, onRestart: () => void) {
  let sent = "";
  let attempt: number | undefined;
  let restarted = false;
  const push = (acc: string) => {
    if (restarted || !acc.startsWith(sent) || acc.length === sent.length) return;
    write(acc.slice(sent.length));
    sent = acc;
  };
  return {
    onPartial(acc: string, n: number): void {
      if (restarted) return;
      if (attempt !== undefined && n !== attempt && sent.length > 0) {
        restarted = true;
        onRestart();
        return;
      }
      attempt = n;
      push(acc);
    },
    /** The final text: flush whatever the last partial did not carry. */
    finish(text: string): void { push(text); },
    get restarted(): boolean { return restarted; },
  };
}
