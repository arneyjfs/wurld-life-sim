/**
 * Timeout + retry primitives for every Gemini call (moved out of index.ts,
 * audit CPLX-FN-15, so they can be unit-tested).
 */

/** Races a promise against a timeout. Rejects with a clear message on expiry. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The HTTP status the Gemini SDK attaches to a failed request
 *  (`GoogleGenerativeAIFetchError.status`), or a numeric `code`. */
export function errorStatus(err: unknown): number | undefined {
  const e = err as { status?: unknown; code?: unknown } | null;
  if (e && typeof e.status === "number") return e.status;
  if (e && typeof e.code === "number" && e.code >= 100 && e.code < 600) return e.code;
  return undefined;
}

/**
 * MSG-PIPE-3.2 — is this error worth retrying (transient / server-side)?
 *
 * Classified on the STATUS the SDK sets when it has one: 408, 429 and 5xx
 * retry; any other status (400, 403, 404 …) does not — a 404 reaches the
 * fallback model through robustGenerate's `shouldSwapToFallback` widening, not
 * through here. Only a status-less error (network failure, our own timeout)
 * falls back to message sniffing, and that list no longer contains
 * `"internal"`: it matched any error whose message mentioned the word,
 * including our own deterministic parse errors, and retried them with backoff
 * (audit CPLX-FN-15). A real Gemini 500 carries `status: 500`.
 */
export function isRetryable(err: unknown): boolean {
  const status = errorStatus(err);
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    /\[(?:5\d\d|429|408)\b/.test(msg) ||
    msg.includes("unavailable") ||
    msg.includes("deadline") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("timed out") ||
    msg.includes("resource exhausted")
  );
}

/**
 * Retry an async function with exponential backoff.
 * Only retries on transient errors. Throws immediately for non-retryable ones.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    retries = 1,
    baseDelayMs = 500,
    label = "call",
    onRetry,
    isRetryable: retryPredicate = isRetryable,
  }: {
    retries?: number;
    baseDelayMs?: number;
    label?: string;
    onRetry?: (err: unknown, attempt: number) => void;
    /**
     * SEC-FN-11 (CPLX-FN-1) — override of the transient-error predicate.
     * `robustGenerate` widens it so a model-retirement 404 (which is NOT
     * transient) still gets its one retry — on the fallback model, which
     * `onRetry` swaps in. Without this the swap in `onRetry` was dead code
     * on the non-streaming path: `isRetryable` said no and the 404 was
     * rethrown before `onRetry` ever ran.
     */
    isRetryable?: (err: unknown) => boolean;
  } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries && retryPredicate(err)) {
        onRetry?.(err, attempt);
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.warn(`[${label}] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, (err as Error).message);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}
