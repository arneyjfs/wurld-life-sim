/**
 * LIMIT-3 — the global Gemini kill switch.
 *
 * Spec: docs/specs/cost-limits.md.
 *
 * `config/runtime` is one Firestore document, `{ geminiEnabled: boolean }`,
 * that an operator flips from the console. Every model call site asks
 * `isGeminiEnabled()` first, so all Gemini (and Cloud TTS) spend can be stopped
 * WITHOUT a redeploy — the lever the audit found missing (SEC-FN-6).
 *
 * Read with a 60-second in-memory TTL per instance: one document read per
 * instance per minute is noise against the Gemini call it guards, and a
 * one-minute lag on the switch is fine for a lever whose alternative is a
 * deploy. A read FAILURE keeps the last known value, or fails OPEN when nothing
 * is cached yet — a Firestore blip must not take every Gemini path down, and
 * the switch is for spend, not safety.
 *
 * Only the boolean `false` disables. An absent doc, an absent field, or any
 * other value means enabled, so a typo'd write cannot silently switch the
 * product off. The rules file denies clients all access to the doc.
 *
 * The factory is exported so the TTL / default / failure logic is unit-tested
 * with a fake reader (`functions/src/__tests__/runtimeConfig.test.ts`); the
 * production reader below is the same factory over Firestore.
 */
import { getFirestore } from "firebase-admin/firestore";

export const RUNTIME_CONFIG_PATH = "config/runtime";
export const RUNTIME_CONFIG_TTL_MS = 60_000;

/** The wire error code + HTTP status every refusing handler answers with. */
export const GEMINI_DISABLED_CODE = "temporarily_disabled";
export const GEMINI_DISABLED_STATUS = 503;

/**
 * Thrown by `robustGenerate` when the switch is off. Its message deliberately
 * matches none of the substrings `isRetryable` / `shouldSwapToFallback` look
 * for, so a killed call fails once rather than retrying or swapping models.
 */
export class GeminiDisabledError extends Error {
  readonly code = GEMINI_DISABLED_CODE;
  readonly httpStatus = GEMINI_DISABLED_STATUS;
  constructor(label?: string) {
    super(`Gemini is switched off by ${RUNTIME_CONFIG_PATH}${label ? ` (${label})` : ""}`);
    this.name = "GeminiDisabledError";
  }
}

export function isGeminiDisabledError(err: unknown): err is GeminiDisabledError {
  return err instanceof GeminiDisabledError
    || (typeof err === "object" && err !== null
      && (err as { code?: unknown }).code === GEMINI_DISABLED_CODE
      && (err as { httpStatus?: unknown }).httpStatus === GEMINI_DISABLED_STATUS);
}

/** Minimal shape of an express response, so this module stays admin-only. */
type Responder = { status: (code: number) => { json: (body: unknown) => unknown } };

/** Answer 503 `{ error: "temporarily_disabled" }`. Callers MUST return after. */
export function respondGeminiDisabled(res: Responder): void {
  res.status(GEMINI_DISABLED_STATUS).json({ error: GEMINI_DISABLED_CODE });
}

export type RuntimeConfigReader = () => Promise<Record<string, unknown> | null | undefined>;

/** A `config/runtime` value. Calling it never waits for Firestore (LIMIT-3.1);
 *  `refresh()` does, and exists for priming and tests. */
export type RuntimeConfigValue<T> = (() => Promise<T>) & { refresh: () => Promise<void> };

/**
 * A value derived from `config/runtime`, read through an injected document
 * reader. LIMIT-3.1: a call NEVER waits for the read. It answers what is in
 * memory: the last loaded value, or `fallback` before the first read lands.
 * When that value is missing or older than `ttlMs`, the call starts ONE
 * background read (concurrent stale calls share it). A failed read keeps the
 * last value and is retried by the next call; it is never cached as a value.
 *
 * `prime: true` starts the first read at construction, so a new instance has
 * the doc before its first request in practice.
 *
 * Shared by the kill switch below and the OpenAI provider switch
 * (`providerSwitch.ts`, MSG-PIPE-31.1), so both levers on this doc behave the
 * same way under a Firestore blip.
 */
export function createRuntimeConfigReader<T>(
  read: RuntimeConfigReader,
  select: (data: Record<string, unknown> | null | undefined) => T,
  fallback: T,
  opts: { ttlMs?: number; now?: () => number; prime?: boolean } = {},
): RuntimeConfigValue<T> {
  const ttlMs = opts.ttlMs ?? RUNTIME_CONFIG_TTL_MS;
  const now = opts.now ?? Date.now;
  let cached: { value: T; fetchedAt: number } | null = null;
  let inFlight: Promise<void> | null = null;

  const stale = () => !cached || now() - cached.fetchedAt >= ttlMs;
  const start = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        cached = { value: select(await read()), fetchedAt: now() };
      } catch (err) {
        console.error(`[runtimeConfig] failed to read ${RUNTIME_CONFIG_PATH}; using ${cached ? "last known value" : "the default"}`, err);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  const value = (async () => {
    if (stale()) void start();
    return cached ? cached.value : fallback;
  }) as RuntimeConfigValue<T>;
  value.refresh = () => (inFlight ?? (stale() ? start() : Promise.resolve()));
  // A macrotask, not now: the Admin SDK app is initialised by a module that
  // may load after this one, and a read before that would only log an error.
  if (opts.prime) setTimeout(() => void start(), 0);
  return value;
}

/** Build an `isGeminiEnabled` over an injected document reader (LIMIT-3). */
export function createGeminiEnabledReader(
  read: RuntimeConfigReader,
  opts: { ttlMs?: number; now?: () => number; prime?: boolean } = {},
): RuntimeConfigValue<boolean> {
  return createRuntimeConfigReader(read, (data) => data?.geminiEnabled !== false, true, opts);
}

/** Production readers start their first read at module load (LIMIT-3.1),
 *  except under vitest (nothing may touch Firestore on import) and in the
 *  deploy CLI's function discovery, which loads the code but serves nothing. */
export const PRIME_AT_LOAD = !process.env.VITEST && process.env.FUNCTIONS_CONTROL_API !== "true";

/** The production reader of `config/runtime`. */
export async function readRuntimeConfigDoc(): Promise<Record<string, unknown> | null> {
  const snap = await getFirestore().doc(RUNTIME_CONFIG_PATH).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

/** LIMIT-3 — the production switch. `false` only when the doc says so. */
export const isGeminiEnabled: () => Promise<boolean> = createGeminiEnabledReader(readRuntimeConfigDoc, { prime: PRIME_AT_LOAD });
