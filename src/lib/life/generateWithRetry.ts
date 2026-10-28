/**
 * LIFE-NODE-14: retry a TRANSPORT failure instead of abandoning the turn.
 *
 * THE BUG THIS EXISTS FOR. Reported 2026-08-03: *"I hit 'the story hit a snag'
 * a lot. I think it's when the system decides to make a practice question from
 * my point of view."*
 *
 * Both life-sim generators run a retry ladder for CONTENT faults — invalid
 * JSON, a schema miss, a wrong-shaped response, a leaked answer. Neither
 * retried a THROW. `generateGemini` rejecting (a dropped socket, a 429, a 5xx,
 * the 45s abort) took the `catch` arm, which `return`ed out of the loop:
 *
 *     try { raw = await generateGemini({...}) }
 *     catch (err) { return { kind: 'error', ... } }   // <- leaves the ladder
 *
 * So a single network hiccup went straight to `options-failed` — "the story hit
 * a snag" plus a Continue chip the player has to tap, whose only job is to make
 * the same call again. The retry was there; the transport just never reached
 * it.
 *
 * WHY THE REPORT POINTS AT GRADED TURNS. A graded turn is the call-heaviest
 * turn in the sim: the live turn that authored the option, then
 * `life_graded_question`, then the post-outcome turn — three calls where an
 * ordinary pick makes one, plus a fourth when the question demotes. Nothing is
 * wrong with the graded PLAN (measured 2026-08-03 against real Gemini: 7/7
 * plans built and generated cleanly, 21/21 across the three step shapes on the
 * critical path). Graded turns simply roll the transport dice three times, so
 * that is where a per-call failure rate concentrates — which is exactly what
 * the player sees and reports.
 *
 * TRANSPORT RETRIES DO NOT SPEND THE CONTENT BUDGET. A dropped socket says
 * nothing about the model's output, so charging it to `MAX_ATTEMPTS` would let
 * one blip disarm the schema ladder for the rest of the turn. The two budgets
 * are therefore separate: this wraps a SINGLE content attempt and hands back
 * either its text or the error, and the caller's own loop is untouched.
 *
 * NOT EVERYTHING IS WORTH RETRYING. An expired session or a 400 is
 * deterministic — retrying spends the player's wait and lands in the same
 * place. Only failures whose cause can plausibly clear on its own are retried.
 */
import { AppError, toAppError } from '@/lib/errors';
import { generateGemini, type GeminiGenerateRequest } from '@/lib/gemini';
import * as log from '@/lib/log';
import { lifeWarn } from './debugLog';

/** Backoffs BETWEEN attempts, so the array length is the retry count and the
 *  total added latency is legible: at most ~1.6s before the caller sees a
 *  failure. Kept short deliberately — the player is watching a spinner, and a
 *  ladder long enough to outlast a real outage would feel like a hang. */
export const TRANSPORT_BACKOFF_MS: readonly number[] = [400, 1200];

/**
 * Is this failure worth another go?
 *
 * TRANSIENT: the socket, the proxy, the rate limiter, the timeout.
 * NOT: auth, authorisation, and 4xx request faults other than 429 — those
 * reproduce exactly.
 */
export function isTransientGenError(err: unknown): boolean {
  const e = toAppError(err);
  switch (e.code) {
    case 'network/offline':
    case 'network/timeout':
    case 'pipeline/rate-limited':
      return true;
    case 'auth/session-expired':
    case 'auth/unknown':
    case 'network/unauthorized':
      return false;
    case 'pipeline/failed': {
      // `pipeline/failed` is the catch-all for BOTH the 45s abort and every
      // non-ok status, so the code alone cannot separate "the server is busy"
      // from "the request was malformed". The message carries the status.
      const m = e.message;
      if (/timed out after/.test(m)) return true;
      const status = /geminiGenerate (\d{3})/.exec(m)?.[1];
      if (!status) return true; // no status parsed — assume transport
      return status === '408' || status === '429' || status.startsWith('5');
    }
    default:
      // A bare `TypeError: fetch failed` / `Failed to fetch` arrives here: the
      // browser rejected before any response existed, which is the transport
      // failure this whole module is for.
      return true;
  }
}

/**
 * One content attempt, with the transport retried underneath it.
 *
 * Returns the model's raw text, or throws the LAST error once the transport
 * ladder is spent — so a caller's existing `catch` keeps working unchanged and
 * only ever sees a failure that survived every retry.
 */
export async function generateWithTransportRetry(
  request: GeminiGenerateRequest,
): Promise<string> {
  let lastErr: unknown = new AppError('pipeline/failed', 'no attempt ran');
  for (let i = 0; i <= TRANSPORT_BACKOFF_MS.length; i++) {
    try {
      return await generateGemini(request);
    } catch (err) {
      lastErr = err;
      if (!isTransientGenError(err) || i === TRANSPORT_BACKOFF_MS.length) throw err;
      const backoffMs = TRANSPORT_BACKOFF_MS[i]!;
      log.warn('life.gen.transport-retry', {
        category: request.category ?? 'unknown',
        retry: i + 1,
        err: String(err),
      });
      // LIFE-NODE-15(d) — LOG IT WHERE IT IS DECIDED, NOT WHERE THE LADDER ENDS.
      //
      // Reported alongside the retry itself: *"log the reason they failed even
      // if they retry"*. The whole point of this ladder is that attempt N+1
      // usually SUCCEEDS, and a successful turn returns nothing for a caller to
      // log — so if the blip is not recorded here it is recorded nowhere, and
      // the buffer shows a healthy turn that silently cost three round-trips.
      //
      // `lifeWarn`, NOT `lifeFailed`: this attempt failed but the CALL has not.
      // A `LIFE/GEN-RETRY-FAILED` tag would read identically to an abandoned
      // turn in the overlay, which is exactly the distinction someone reading
      // the buffer after a snag is trying to make. The level is still 'warn',
      // so it renders amber and stays impossible to miss.
      //
      // The terminal failure is deliberately NOT logged here — the caller owns
      // it (`generateStepOptions` → `step gen threw`), and logging both would
      // double-count every abandoned turn.
      lifeWarn(
        'GEN-RETRY',
        `${request.category ?? 'unknown'} transport attempt ${i + 1} failed → retrying in ${backoffMs}ms`,
        {
          category: request.category ?? 'unknown',
          attempt: i,
          retry: i + 1,
          backoffMs,
          // The AppError code is the machine-readable half (`network/timeout`,
          // `pipeline/rate-limited`); `err` keeps the message, which is where a
          // `pipeline/failed` hides its HTTP status.
          code: toAppError(err).code,
          err: String(err),
        },
      );
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
