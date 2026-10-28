/**
 * MSG-PIPE-31 — one call to OpenAI's Responses API, the second provider behind
 * the per-category switch (`providerSwitch.ts`). `gemini/routed.ts` is the only
 * caller: it decides when to come here, and goes to Gemini on any error this
 * throws.
 *
 * The request is the shape `tests/prompts/_shared/openai_call.py` measured
 * (MSG-PIPE-31.4): the SI as a `developer` block carrying an explicit cache
 * breakpoint, explicit-only caching with a 12 h TTL, reasoning `none`,
 * `store: false`. Plain `fetch` (Node 22), no SDK: this is one POST, and the
 * SDK would be a dependency to keep current for a request we pin by hand.
 *
 * No retry here (MSG-PIPE-31.2): a failed attempt goes straight to the other
 * provider (routed.ts).
 */

import type { ProviderCategory } from "../providerSwitch";

const LUNA = "gpt-6-luna";
export type OpenAIModel = typeof LUNA;

/** OpenAI model ids per routed category (MSG-PIPE-4: no literals at call sites).
 *  Each category's Luna prompt was measured on this model (MSG-PIPE-31.7). */
export const OPENAI_MODELS: Readonly<Record<ProviderCategory, OpenAIModel>> = {
  analysis: LUNA,
  convert_key: LUNA,
  convert_multi: LUNA,
  convert_batch: LUNA,
  suggest_native: LUNA,
  clarify: LUNA,
  tutor_reply: LUNA,
  tutor_setup: LUNA,
  explain: LUNA,
  explain_practice: LUNA,
  explain_phrase: LUNA,
  topic_classify: LUNA,
  chat_import_extract: LUNA,
  practice_planner: LUNA,
  practice_generate: LUNA,
};

/**
 * MSG-PIPE-31.2 — one OpenAI attempt's timeout per category, for the whole
 * answer (streamed or not). Luna writes ~120 tokens/s against Gemini's ~500, so
 * these sit at a few times its measured p95 for the category's output length,
 * and never above the Gemini timeout at the same site.
 */
export const OPENAI_TIMEOUT_MS: Readonly<Record<ProviderCategory, number>> = {
  analysis: 8_000,
  convert_key: 10_000,
  convert_multi: 20_000,
  convert_batch: 40_000,
  suggest_native: 8_000,
  clarify: 10_000,
  tutor_reply: 15_000,
  tutor_setup: 15_000,
  explain: 20_000,
  explain_practice: 15_000,
  explain_phrase: 10_000,
  topic_classify: 8_000,
  chat_import_extract: 30_000,
  practice_planner: 25_000,
  practice_generate: 10_000,
};

export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

/** 12 h cache lifetime (GPT-5.6+). A write bills at 2.5x input; the 30 min
 *  default bills 1.25x but expires between quiet-hour sends. */
export const OPENAI_CACHE_TTL = "12h";

const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

export type OpenAIRequest = {
  model: OpenAIModel;
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** `none` is the analogue of Gemini's `thinkingLevel: "minimal"`. */
  reasoning?: "none" | "low" | "medium" | "high";
  responseSchema?: Record<string, unknown>;
  /** Strict structured output: the answer must match the schema exactly. */
  strictSchema?: boolean;
  /** MSG-PIPE-31.12 — Fast mode (formerly Priority processing). */
  serviceTier?: "priority";
  /** MSG-PIPE-31.13 — the prompt split at its cache points: the strings must
   *  join to `prompt`, and every one but the last gets a 30 min breakpoint. */
  promptBlocks?: readonly string[];
  /** MSG-PIPE-31.14 — write or refresh the cache only; no output. */
  prewarm?: boolean;
};

/** MSG-PIPE-31.13 — lifetime of the per-sender cache points. */
export const OPENAI_HEADER_CACHE_TTL = "30m";

/** MSG-PIPE-31.13 — the user message: one string, or one block per cache point. */
function userContent(req: OpenAIRequest): string | Array<Record<string, unknown>> {
  const blocks = req.promptBlocks;
  if (!blocks || blocks.length < 2 || blocks.join("") !== req.prompt) return req.prompt;
  return blocks.map((text, i) => ({
    type: "input_text",
    text,
    ...(i < blocks.length - 1 ? { prompt_cache_breakpoint: { mode: "explicit", ttl: OPENAI_HEADER_CACHE_TTL } } : {}),
  }));
}

export type OpenAITokens = { in: number; out: number; cached: number; thoughts: number };

/** Thrown for a non-2xx answer; `status` is the HTTP status. */
export class OpenAIError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "OpenAIError";
  }
}

/** MSG-PIPE-31.4 — the request body. */
export function buildOpenAIRequestBody(req: OpenAIRequest): Record<string, unknown> {
  const effort = req.reasoning ?? "none";
  return {
    model: req.model,
    prompt_cache_options: { mode: "explicit", ttl: OPENAI_CACHE_TTL, ...(req.prewarm ? { prewarm: true } : {}) },
    input: [
      {
        role: "developer",
        content: [{
          type: "input_text",
          text: req.systemInstruction,
          prompt_cache_breakpoint: { mode: "explicit" },
        }],
      },
      { role: "user", content: userContent(req) },
    ],
    reasoning: { effort },
    max_output_tokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    store: false,
    ...(req.serviceTier ? { service_tier: req.serviceTier } : {}),
    // Reasoning models reject sampling params unless reasoning is off.
    ...(req.temperature !== undefined && effort === "none" ? { temperature: req.temperature } : {}),
    ...(req.responseSchema
      ? { text: { format: { type: "json_schema", name: "out", schema: req.responseSchema, strict: req.strictSchema === true } } }
      : {}),
  };
}

type OpenAIUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
} | null | undefined;

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * MSG-PIPE-31.5 — usage in `robustGenerate`'s terms. `in` includes the cached
 * part, as Gemini's `promptTokenCount` does; `out` is BILLED output
 * (OBS-USAGE-2), which OpenAI's `output_tokens` already is, reasoning included.
 */
export function normalizeOpenAIUsage(usage: OpenAIUsage): OpenAITokens {
  return {
    in: count(usage?.input_tokens),
    out: count(usage?.output_tokens),
    cached: count(usage?.input_tokens_details?.cached_tokens),
    thoughts: count(usage?.output_tokens_details?.reasoning_tokens),
  };
}

/** The answer's text: every `output_text` part of every `message` item. */
export function extractOpenAIText(body: unknown): string {
  const output = (body as { output?: unknown } | null)?.output;
  if (!Array.isArray(output)) return "";
  return output
    .filter((item) => item?.type === "message" && Array.isArray(item.content))
    .flatMap((item) => item.content as Array<{ type?: string; text?: unknown }>)
    .filter((c) => c.type === "output_text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("");
}

/**
 * MSG-PIPE-31.4b — Luna sometimes leaks chat-format tokens (`<|end|>`,
 * `<|channel|>`) into its answer. They are never content.
 */
export function cleanOpenAIText(text: string): string {
  return text.replace(/<\|[^|<>]*\|>/g, "");
}

/** A streamed prefix, cleaned, minus any token still being written at its end,
 *  so each prefix the caller sees extends the one before (MSG-PIPE-20). */
export function cleanOpenAIPartial(text: string): string {
  return cleanOpenAIText(text).replace(/<(\|[^|<>]*\|?)?$/, "");
}

type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
}>;

type OpenAIResult = {
  text: string;
  tokens: OpenAITokens;
  apiMs: number;
  /** MSG-PIPE-31.12 — the tier OpenAI answered with (`default` when it
   *  downgraded a priority request). */
  serviceTier?: string;
};

const tierOf = (v: unknown): { serviceTier?: string } => (typeof v === "string" && v ? { serviceTier: v } : {});

/** POST the request with the key and a timeout covering `read` as well;
 *  turns a non-2xx answer and the abort into `OpenAIError`. */
async function postResponses<T>(
  body: Record<string, unknown>,
  timeoutMs: number,
  deps: { fetchImpl?: FetchLike; apiKey?: string },
  read: (res: Awaited<ReturnType<FetchLike>>) => Promise<T>,
): Promise<T> {
  const apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) throw new OpenAIError("OPENAI_API_KEY not set");
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new OpenAIError(`OpenAI ${res.status}: ${detail.slice(0, 200)}`, res.status);
    }
    return await read(res);
  } catch (err) {
    if (controller.signal.aborted) throw new OpenAIError(`openai timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** One Responses call, bounded by `timeoutMs`. Throws on any failure. */
export async function callOpenAIResponses(
  req: OpenAIRequest & { timeoutMs: number },
  deps: { fetchImpl?: FetchLike; apiKey?: string } = {},
): Promise<OpenAIResult> {
  const start = Date.now();
  return postResponses(buildOpenAIRequestBody(req), req.timeoutMs, deps, async (res) => {
    const body = await res.json();
    const text = extractOpenAIText(body);
    // MSG-PIPE-31.14 — a prewarm answers with no output by design.
    if (!text && !req.prewarm) throw new OpenAIError("OpenAI returned an empty answer");
    return {
      text,
      tokens: normalizeOpenAIUsage((body as { usage?: OpenAIUsage }).usage),
      apiMs: Date.now() - start,
      ...tierOf((body as { service_tier?: unknown }).service_tier),
    };
  });
}

type StreamEvent = {
  type?: string;
  delta?: unknown;
  message?: unknown;
  response?: {
    usage?: OpenAIUsage;
    service_tier?: unknown;
    error?: { message?: string } | null;
    incomplete_details?: { reason?: string } | null;
  };
};

/**
 * MSG-PIPE-31.4a — the same call streamed (`stream: true`). `onText` gets the
 * whole answer so far, raw, after every text delta; the usage comes from
 * `response.completed`. A failed or incomplete response, an `error` event, or
 * a stream that ends before `response.completed` throws. `timeoutMs` covers
 * the whole stream.
 */
export async function streamOpenAIResponses(
  req: OpenAIRequest & { timeoutMs: number },
  onText: (accumulated: string) => void,
  deps: { fetchImpl?: FetchLike; apiKey?: string } = {},
): Promise<OpenAIResult> {
  const start = Date.now();
  return postResponses({ ...buildOpenAIRequestBody(req), stream: true }, req.timeoutMs, deps, async (res) => {
    if (!res.body) throw new OpenAIError("OpenAI stream has no body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let usage: OpenAIUsage | undefined;
    let tier: unknown;
    let completed = false;

    const handle = (block: string) => {
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") return;
      let ev: StreamEvent;
      try { ev = JSON.parse(data) as StreamEvent; } catch { return; }
      if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") {
        text += ev.delta;
        onText(text);
      } else if (ev.type === "response.completed") {
        usage = ev.response?.usage;
        tier = ev.response?.service_tier;
        completed = true;
      } else if (ev.type === "response.failed") {
        throw new OpenAIError(`OpenAI response failed: ${String(ev.response?.error?.message ?? "unknown").slice(0, 200)}`);
      } else if (ev.type === "response.incomplete") {
        throw new OpenAIError(`OpenAI response incomplete: ${String(ev.response?.incomplete_details?.reason ?? "unknown")}`);
      } else if (ev.type === "error") {
        throw new OpenAIError(`OpenAI stream error: ${String(ev.message ?? "unknown").slice(0, 200)}`);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) !== -1) {
        handle(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
      }
      if (done) break;
    }
    if (buffer.trim()) handle(buffer);
    if (!completed) throw new OpenAIError("OpenAI stream ended before the response completed");
    if (!text) throw new OpenAIError("OpenAI returned an empty answer");
    return { text, tokens: normalizeOpenAIUsage(usage), apiMs: Date.now() - start, ...tierOf(tier) };
  });
}
