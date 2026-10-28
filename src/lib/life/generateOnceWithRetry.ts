/**
 * LIFE-FAIL-10 — ONE retry for the once-per-world / once-per-chapter
 * generation calls whose failure silently degrades everything downstream.
 *
 * Reported 2026-08-01, from a real session log:
 *
 *     [LIFE/WORLD-ARC-FAILED] worldArc generateGemini threw — falling back
 *     { "err": "TypeError: Load failed", "chapterNumber": 1 }
 *
 * `TypeError: Load failed` is WebKit's wording for a transport failure — the
 * request never reached the server, which the telemetry confirms (there is no
 * `life_world_arc` row in that session at all, while the saga and bio calls
 * either side of it recorded normally). So this was one dropped socket.
 *
 * The cost of that one socket was the whole of chapter 1: `runWorldArcGenerate`
 * caught, logged, and fell straight back to `trivialArc`, and a chapter arc is
 * generated exactly once — nothing later re-attempts it. The saga has the same
 * shape and the same blast radius.
 *
 * These calls are rare (one per world / one per chapter), so a second attempt
 * is close to free, and the precedent is already in the codebase:
 * `generateNpcAvatarWithRetry` (LIFE-FAIL-3/5) retries once for exactly this
 * reason, then accepts a graceful terminal state.
 *
 * WHAT IS NOT RETRIED, and why: an `AppError` means we reached a definite
 * answer — a missing session (`auth/session-expired`) or a rejected token
 * (`network/unauthorized`) will fail identically a second time, so retrying
 * only delays the fallback the player is waiting on. Everything else — the
 * transport `TypeError`, a 5xx, a rate-limit, the client-side timeout — is
 * plausibly transient and gets one more attempt.
 */
import { AppError } from '@/lib/errors';

/** Error codes for which a second attempt cannot succeed. */
const TERMINAL_CODES = new Set(['auth/session-expired', 'network/unauthorized']);

export function isRetryableGenError(err: unknown): boolean {
  if (err instanceof AppError) return !TERMINAL_CODES.has(err.code);
  // A non-AppError escaping `generateGemini` is a transport failure
  // (`TypeError: Load failed` / `Failed to fetch`) — the retryable case this
  // exists for.
  return true;
}

/**
 * Run `attempt` and, if it throws something retryable, run it once more.
 * The SECOND error is the one that propagates — it is the one that decided
 * the outcome, and reporting the first would misattribute the failure.
 *
 * `onRetry` is called between the two, so the caller can log that a retry
 * happened; a log line that only ever appears on the recovered path is how
 * you find out whether this is earning its keep.
 */
export async function generateOnceWithRetry<T>(
  attempt: () => Promise<T>,
  onRetry?: (firstError: unknown) => void,
): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    if (!isRetryableGenError(err)) throw err;
    onRetry?.(err);
    return attempt();
  }
}
