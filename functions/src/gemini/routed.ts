/**
 * MSG-PIPE-31.2 — `generateRouted`: serve a call category from its primary
 * provider (the switch in `providerSwitch.ts` names it), and hand the call to
 * the other provider when the primary fails, in either direction.
 *
 * The Gemini call arrives as a thunk so the Gemini model, and the explicit
 * cache read or create behind it, is only built when Gemini actually runs: an
 * OpenAI-served send pays nothing on the Gemini side.
 */
import { GeminiDisabledError, isGeminiEnabled } from "../runtimeConfig";
import { recordPipelineTrace, type PipelineTraceSummary } from "../pipeline/traces";
import { isOpenAIEnabledFor, isOpenAIFastFor, OPENAI_AVAILABLE, type ProviderCategory } from "../providerSwitch";
import {
  callOpenAIResponses,
  cleanOpenAIPartial,
  cleanOpenAIText,
  OPENAI_MODELS,
  OPENAI_TIMEOUT_MS,
  streamOpenAIResponses,
} from "../openai/responses";
import { captureModelFailure, captureServerError } from "../observability/sentry";
import type { RobustGenerateResult } from "./generate";

/** MSG-PIPE-31.10 — 3 primary failures within 60 s send a category to the
 *  other provider first on this instance for 5 minutes. */
export const PROVIDER_BREAKER = { failures: 3, windowMs: 60_000, openMs: 300_000 } as const;

export type Provider = "openai" | "gemini";

/** `<category>:<primary>`: flipping the switch starts the new primary clean. */
export type BreakerKey = `${ProviderCategory}:${Provider}`;

export type ProviderBreaker = {
  /** False while the breaker is open: try the other provider first. */
  allows: (key: BreakerKey) => boolean;
  success: (key: BreakerKey) => void;
  /** Returns true when this failure OPENED the breaker. */
  failure: (key: BreakerKey) => boolean;
};

/**
 * MSG-PIPE-31.10 — per-instance, in memory, per category and primary. Once the
 * open period ends, the next call is a trial: a success closes the breaker, a
 * failure reopens it straight away.
 */
export function createProviderBreaker({ now = Date.now }: { now?: () => number } = {}): ProviderBreaker {
  const state = new Map<BreakerKey, { recent: number[]; openUntil: number }>();
  return {
    allows: (key) => now() >= (state.get(key)?.openUntil ?? 0),
    success: (key) => { state.delete(key); },
    failure: (key) => {
      const t = now();
      const s = state.get(key) ?? { recent: [], openUntil: 0 };
      const trial = s.openUntil > 0;
      s.recent = [...s.recent.filter((at) => t - at < PROVIDER_BREAKER.windowMs), t];
      const opens = trial || s.recent.length >= PROVIDER_BREAKER.failures;
      if (opens) {
        s.openUntil = t + PROVIDER_BREAKER.openMs;
        s.recent = [];
      }
      state.set(key, s);
      return opens;
    },
  };
}

const instanceBreaker = createProviderBreaker();

export type RoutedResult = RobustGenerateResult & { provider: Provider };

/** MSG-PIPE-31.4a — `attempt` is one sequence across both providers. */
export type OnPartial = (accumulated: string, attempt: number) => void;

/**
 * MSG-PIPE-31.2a — which Gemini models one Gemini step may use. `both`: the
 * category's model with its retry, then the backup model (`MODELS.fallback`),
 * as robustGenerate always did. `primary`: the category's model and its retry,
 * no backup model. `backup`: the backup model alone.
 */
export type GeminiModels = "both" | "primary" | "backup";

/** What a Gemini step gets from generateRouted. */
export type GeminiStep = { onPartial?: OnPartial; models: GeminiModels };

type Step = { provider: "openai" } | { provider: "gemini"; models: GeminiModels };

/**
 * MSG-PIPE-31.2 / 31.2a / 31.10 — the order the steps run in. Gemini's backup
 * model is always the last resort, after both providers' main models (owner,
 * 2026-10-25: Luna answers better than the backup model, and the same in
 * reverse). Which main model goes first is the primary, or the other one while
 * the breaker is open.
 */
export function routeSteps(primary: Provider, primaryFirst: boolean): Step[] {
  const geminiFirst = (primary === "gemini") === primaryFirst;
  return geminiFirst
    ? [{ provider: "gemini", models: "primary" }, { provider: "openai" }, { provider: "gemini", models: "backup" }]
    : [{ provider: "openai" }, { provider: "gemini", models: "primary" }, { provider: "gemini", models: "backup" }];
}

export type RoutedOpenAIRequest = {
  /** Luna's own SI (MSG-PIPE-31.7). */
  systemInstruction: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Defaults to `OPENAI_TIMEOUT_MS[category]`. */
  timeoutMs?: number;
  /** MSG-PIPE-31.13 — `prompt` split at its cache points (OpenAI only). */
  promptBlocks?: readonly string[];
  responseSchema?: Record<string, unknown>;
  strictSchema?: boolean;
};

export async function generateRouted(
  opts: {
    category: ProviderCategory;
    /** Stage label, shared with the Gemini call's own trace. */
    label: string;
    /** The OpenAI side's request. */
    openai: RoutedOpenAIRequest;
    traceContext?: Record<string, unknown>;
    /** Stream: partial text from whichever provider is answering. */
    onPartial?: OnPartial;
    /** The call the category makes on Gemini. Pass `h.onPartial` on as
     *  robustGenerate's `onPartial` when streaming, and honour `h.models`
     *  (MSG-PIPE-31.2a): `geminiModelsFor(h.models, model, backup)`. */
    gemini: (h: GeminiStep) => Promise<RobustGenerateResult>;
  },
  deps: {
    isEnabled?: (category: ProviderCategory) => Promise<boolean>;
    available?: boolean;
    call?: typeof callOpenAIResponses;
    stream?: typeof streamOpenAIResponses;
    breaker?: ProviderBreaker;
    /** MSG-PIPE-31.12 — the Fast mode switch. */
    isFast?: (category: ProviderCategory) => Promise<boolean>;
  } = {},
): Promise<RoutedResult> {
  const { onPartial } = opts;
  // MSG-PIPE-31.1a — no OpenAI here: the Gemini call exactly as before.
  if (!(deps.available ?? OPENAI_AVAILABLE)) {
    return { ...(await opts.gemini({ onPartial, models: "both" })), provider: "gemini" };
  }
  const isEnabled = deps.isEnabled ?? isOpenAIEnabledFor;
  const breaker = deps.breaker ?? instanceBreaker;

  const primary: Provider = (await isEnabled(opts.category)) ? "openai" : "gemini";
  const key: BreakerKey = `${opts.category}:${primary}`;
  const primaryFirst = breaker.allows(key);
  const steps = routeSteps(primary, primaryFirst);

  // MSG-PIPE-31.4a — every provider attempt gets a fresh number.
  let seq = 0;
  let lastError: unknown;
  for (const [i, step] of steps.entries()) {
    try {
      const result = step.provider === "openai"
        ? await attemptOpenAI(opts, deps, ++seq)
        : await attemptGemini(opts, step.models, seq, (n) => { seq = Math.max(seq, n); });
      if (i === 0 && primaryFirst) breaker.success(key);
      return result;
    } catch (err) {
      // MSG-PIPE-31.3 — the kill switch is never answered by the other provider.
      if (err instanceof GeminiDisabledError) throw err;
      if (err instanceof NoBackupModelError) continue;
      lastError = err;
      const reason = err instanceof Error ? err.message : String(err);
      const next = steps[i + 1];
      const name = (s: Step) => (s.provider === "gemini" && s.models === "backup" ? "the Gemini backup model" : s.provider);
      console.error(`[${opts.label}] ${name(step)} failed${next ? ` — falling back to ${name(next)}` : ""}. reason: ${reason.slice(0, 120)}`);
      // Only the primary tried first counts: while the breaker is open the
      // primary is the fallback, and its failures say nothing new.
      if (i === 0 && primaryFirst && breaker.failure(key)) reportOpened(opts, primary, reason);
    }
  }
  throw lastError;
}

async function attemptOpenAI(
  opts: Parameters<typeof generateRouted>[0],
  deps: Parameters<typeof generateRouted>[1] & object,
  attempt: number,
): Promise<RoutedResult> {
  // MSG-PIPE-31.3 — the kill switch covers both providers. robustGenerate
  // checks it again on the Gemini path.
  if (!(await isGeminiEnabled())) throw new GeminiDisabledError(opts.label);
  const model = OPENAI_MODELS[opts.category];
  // MSG-PIPE-31.12 — answered from memory, like the provider switch.
  const fast = await (deps.isFast ?? isOpenAIFastFor)(opts.category);
  const req = {
    model, ...opts.openai, timeoutMs: opts.openai.timeoutMs ?? OPENAI_TIMEOUT_MS[opts.category],
    ...(fast ? { serviceTier: "priority" as const } : {}),
  };
  const startMs = Date.now();
  try {
    const { onPartial } = opts;
    const r = onPartial
      ? await (deps.stream ?? streamOpenAIResponses)(req, (acc) => onPartial(cleanOpenAIPartial(acc), attempt))
      : await (deps.call ?? callOpenAIResponses)(req);
    const text = cleanOpenAIText(r.text);
    // MSG-PIPE-31.6 — the trace's convention (PipelineTraceSummary): `out` is
    // the answer and `thoughts` is added on top, so reasoning comes out of `out`.
    const tokens = { ...r.tokens, out: Math.max(0, r.tokens.out - r.tokens.thoughts) };
    trace(opts, { model, startMs, apiMs: r.apiMs, tokens, status: "ok", ...(fast && r.serviceTier ? { serviceTier: r.serviceTier } : {}) }, r.text);
    return { text, tokens: r.tokens, modelUsed: model, provider: "openai" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    trace(opts, { model, startMs, status: "error", error: reason.slice(0, 200) }, reason);
    // OBS-SRV-7 — reported even when Gemini then answers. Gemini steps report
    // their own attempts inside robustGenerate.
    captureModelFailure(err, { provider: "openai", model, label: opts.label, category: opts.category, attempt });
    throw err;
  }
}

async function attemptGemini(
  opts: Parameters<typeof generateRouted>[0],
  models: GeminiModels,
  base: number,
  advance: (attempt: number) => void,
): Promise<RoutedResult> {
  const { onPartial } = opts;
  const r = await opts.gemini({
    models,
    onPartial: onPartial && ((acc, n) => { advance(base + n); onPartial(acc, base + n); }),
  });
  return { ...r, provider: "gemini" };
}

/** Thrown by a `backup` step that has no backup model (the category's model IS
 *  the backup): the step is skipped, not counted as a failure. */
export class NoBackupModelError extends Error {
  constructor() {
    super("no Gemini backup model for this call");
    this.name = "NoBackupModelError";
  }
}

/**
 * MSG-PIPE-31.2a — the model and backup model a Gemini step passes to
 * robustGenerate. A `backup` step with no backup model throws
 * NoBackupModelError, which generateRouted skips.
 */
export function geminiModelsFor<M>(models: GeminiModels, model: M, backup: M | undefined): { model: M; fallbackModel: M | undefined } {
  if (models === "backup") {
    if (backup === undefined) throw new NoBackupModelError();
    return { model: backup, fallbackModel: undefined };
  }
  if (models === "primary") return { model, fallbackModel: undefined };
  return { model, fallbackModel: backup };
}

/** MSG-PIPE-31.10 — ONE Sentry event per opening, not one per failure. */
function reportOpened(opts: { label: string; category: ProviderCategory }, primary: Provider, reason: string): void {
  const minutes = PROVIDER_BREAKER.openMs / 60_000;
  const other = primary === "openai" ? "gemini" : "openai";
  console.error(`[${opts.label}] provider breaker OPEN for ${opts.category}: ${other} first on this instance for ${minutes} min`);
  captureServerError(new Error(`Provider breaker open: ${opts.category} moved from ${primary} to ${other} for ${minutes} min`), {
    lastError: reason.slice(0, 300),
    tags: { provider_breaker: "open", category: opts.category, provider: primary },
  });
}

/** MSG-PIPE-31.6 — the OpenAI attempt's own row in the admin waterfall. */
function trace(
  opts: { label: string; openai: { systemInstruction: string; prompt: string }; traceContext?: Record<string, unknown> },
  s: Pick<PipelineTraceSummary, "model" | "startMs" | "status"> & Partial<Pick<PipelineTraceSummary, "apiMs" | "tokens" | "error" | "serviceTier">>,
  rawOutput: string,
): void {
  const chatId = typeof opts.traceContext?.chat_id === "string" ? opts.traceContext.chat_id : undefined;
  const messageId = typeof opts.traceContext?.message_id === "string" ? opts.traceContext.message_id : undefined;
  if (!chatId || !messageId) return;
  const jobKey = opts.traceContext?.target_language;
  const summary: PipelineTraceSummary = {
    stage: opts.label,
    durationMs: Date.now() - s.startMs,
    attempt: 1,
    // The reasoning effort sent (responses.ts sends `none` unless asked).
    thinkingLevel: "none",
    ...(typeof jobKey === "string" ? { jobKey } : {}),
    ...s,
  };
  recordPipelineTrace(chatId, messageId, summary, {
    prompt: opts.openai.prompt,
    rawOutput,
    systemInstruction: opts.openai.systemInstruction,
  }).catch(() => {});
}
