import { auth } from './firebase';
import { endpointUrl } from './endpoints';
import { AppError, toNetworkError } from './errors';
import * as log from './log';
import { emitGeminiCall } from './geminiCallSink';
import type { PracticePromptSpec } from './practicePromptSpec';
import { reportUpgradeRequired, wurldVersionHeaders } from './versionHeader';

/** OBS-VERSION-11 — a 426 is the version floor: block now, and say so. The
 *  message keeps the status so nothing downstream reads it as retryable. */
function upgradeRequired(res: Response, functionName: GeminiFunction): AppError {
  reportUpgradeRequired(null);
  return new AppError('app/update-required', `${res.url || 'gemini'} 426`, undefined, {
    functionName,
    httpStatus: 426,
  });
}

type GeminiFunction = 'geminiGenerate' | 'geminiStreamV2';

/** OBS-LABEL-7 — the non-OK statuses both endpoints share, each carrying the
 *  function and status. A 402 is the paid-feature gate (LANG-TIER-1.1). */
function statusError(res: Response, functionName: GeminiFunction, message: string): AppError {
  const details = { functionName, httpStatus: res.status };
  if (res.status === 401) return new AppError('network/unauthorized', undefined, undefined, details);
  if (res.status === 426) return upgradeRequired(res, functionName);
  if (res.status === 429) return new AppError('pipeline/rate-limited', undefined, undefined, details);
  if (res.status === 402) return new AppError('feature/requires-plan', undefined, undefined, details);
  return new AppError('pipeline/failed', message, undefined, details);
}

/**
 * Non-streaming Gemini call. Used for structured-output tasks like
 * flashcard topic classification where we want JSON back rather than
 * incremental token chunks.
 *
 * IMPORTANT: the backend `geminiGenerate` is exposed as
 * `functionsV1.https.onRequest` (a plain HTTP endpoint), not a
 * callable. The source app calls it with a direct `fetch` — see
 * source services/geminiProxy.ts:149. We mirror that here. Using
 * `httpsCallable` against this endpoint silently 400s with "Missing
 * prompt" because the SDK wraps the payload in `{ data: {...} }`,
 * which the onRequest body parser never unwraps. That regression
 * caused every flashcard topic classification to fall into the catch
 * block and write `topic: 'general'`.
 */
export type GeminiGenerateRequest = {
  /** Omitted when `promptSpec` is set — the server builds the real one. */
  prompt?: string;
  /** PRACTICE-OWN-* — see `practicePromptSpec.ts`. Supersedes `prompt` +
   *  `systemInstruction` for the kinds the server owns, and is REQUIRED for
   *  any `practice_*` category (the server 400s without it). */
  promptSpec?: PracticePromptSpec;
  model?: string;
  /** ⚠ `thinkingBudget` was here and is GONE. It was Gemini 2.x's numeric
   *  reasoning knob, and every 2.x model has been retired (404 on
   *  `generateContent`); the 3.x models take `thinkingLevel` only. The SERVER
   *  still translates a legacy `thinkingBudget: 0` from an older bundle, so
   *  removing it here breaks nothing in flight — it just stops new code
   *  reaching for a knob nothing answers. */
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  responseMimeType?: 'application/json' | 'text/plain';
  responseSchema?: unknown;
  systemInstruction?: string;
  /** Sampling temperature 0..2. Pinned low for classification tasks
   *  (topic_classify, etc.) where we want stable output across
   *  semantically-similar inputs; left undefined for tasks that
   *  benefit from variety. */
  temperature?: number;
  /** Telemetry bucket label for backend metrics. */
  category?: string;
  /** LIFE-COST-3: 0-based attempt index for callers that retry (the
   *  `generateStepOptions` schema ladder, the graded-question leak guard).
   *  Anything > 0 is a REGENERATION — a call the user is paying for twice.
   *  Client-side telemetry only; stripped before the request goes on the wire
   *  so the backend contract is unchanged. Retries were ~24% of `life_step`
   *  spend in the 2026-07 audit off a 13-call sample; this makes the rate a
   *  measurement instead of a guess. */
  attempt?: number;
};

const GENERATE_TIMEOUT_MS = 45_000;

export async function generateGemini(
  request: GeminiGenerateRequest,
): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new AppError('auth/session-expired');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

  const { attempt, ...wireRequest } = request;

  try {
    const res = await fetch(endpointUrl('geminiGenerate'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...wurldVersionHeaders(),
      },
      body: JSON.stringify(wireRequest),
      signal: controller.signal,
    });
    if (!res.ok) {
      // LANG-TIER-1.1 — the paid-feature 402 (`enforcePaidFeature`) is
      // `feature/requires-plan`. Without it the 402 fell through to
      // `pipeline/failed`, whose copy is "The translation didn't go through.
      // Try again." — wrong on both counts, and reachable for real: the client
      // gates read a clock captured at MOUNT (LANG-TRIAL-5), so a trial lapsing
      // with the app open leaves the affordance on screen while the server has
      // started refusing.
      const detail = [401, 402, 426, 429].includes(res.status) ? '' : await res.text().catch(() => '');
      throw statusError(res, 'geminiGenerate', `geminiGenerate ${res.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      text?: string;
      // `thoughts` (LIFE-COST-2) is optional — a backend deployed before the
      // 2026-07 accounting fix omits it, and the pricing helper treats a
      // missing value as 0 rather than throwing the whole entry away.
      tokens?: { in: number; out: number; cached: number; thoughts?: number } | null;
      modelUsed?: string | null;
      durationMs?: number | null;
    };
    // Telemetry: record per-call cost + cache-hit data so the debug
    // overlay can show running totals. Tokens may be null on older
    // backends — the buffer tolerates that. Side-effect-only; failures
    // here must NEVER affect the caller.
    try {
      emitGeminiCall({
        ts: Date.now(),
        category: request.category ?? 'unknown',
        modelUsed: data.modelUsed ?? null,
        tokens: data.tokens ?? null,
        durationMs: typeof data.durationMs === 'number' ? data.durationMs : null,
        attempt: attempt ?? 0,
      });
    } catch {
      /* telemetry must never break the call */
    }
    return data.text ?? '';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // OBS-LABEL-8 — the 45 s cap is a timeout, not a pipeline failure. The
      // message keeps "timed out after" for the classifiers that read it.
      throw new AppError('network/timeout', `generateGemini timed out after ${GENERATE_TIMEOUT_MS}ms`, err, {
        functionName: 'geminiGenerate',
        name: err.name,
      });
    }
    // OBS-LABEL-8 — a fetch TypeError is network/offline; AppErrors pass.
    throw toNetworkError(err, 'geminiGenerate');
  } finally {
    clearTimeout(timer);
  }
}

export type GeminiStreamRequest = {
  /** Omitted when `promptSpec` is set — the server builds the real one. */
  prompt?: string;
  /** PRACTICE-OWN-* — see `practicePromptSpec.ts`. The streaming planner is a
   *  server-owned prompt, so this is a live path on the stream endpoint too,
   *  not just on `geminiGenerate`. */
  promptSpec?: PracticePromptSpec;
  model?: string;
  systemInstruction?: string;
  /** OBS-USAGE — telemetry bucket, same vocabulary `generateGemini` uses.
   *  The server has always read `category` off the stream body to attribute
   *  spend (`recordTokenUsage`), but this type never carried the field, so no
   *  caller could send one and EVERY streamed call — ExplainModal and the
   *  practice planner, i.e. all of the streaming bill — landed in `unknown`.
   *  Also the key `serverOwnedSystemInstruction` matches on, so a future
   *  server-owned prompt reaches this endpoint too (LIFE-BACKDROP-30). */
  category?: string;
  /** The dial for reasoning effort. (`thinkingBudget`, 2.x's numeric escape
   *  hatch, was removed with the 2.x models themselves — see the note on the
   *  non-streaming request type above.) `'minimal'` is the right
   *  pick for streaming UIs that want a fast first token (chat-style
   *  explanations, conversational replies). The server will translate
   *  this to Gemini's `thinkingConfig.thinkingLevel`. */
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  /** Sampling temperature 0..2 — see CLIENT_TEMPERATURE. Honoured by
   *  geminiStreamV2 since MSG-PIPE-23; before that the endpoint accepted
   *  every other knob and dropped this one on the floor. */
  temperature?: number;
};

/**
 * Stream a Gemini response via the geminiStreamV2 SSE endpoint. Yields text
 * chunks as they arrive. Throws AppError on transport/auth failure.
 *
 * Server SSE format (matches source services/geminiProxy.ts):
 *   data: {"text": "..."}    ← text chunk (yielded)
 *   data: {"error": "..."}   ← surfaced as a thrown AppError
 *   data: [DONE]             ← terminates
 *   :keepalive               ← heartbeat comment; resets stall timer
 *
 * A 30-second silence on the wire is treated as a stall and aborts.
 */
const STREAM_STALL_MS = 30_000;

export async function* streamGemini(
  request: GeminiStreamRequest,
  signal?: AbortSignal,
): AsyncGenerator<string, void, void> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new AppError('auth/session-expired');

  let res: Response;
  try {
    res = await fetch(endpointUrl('geminiStreamV2'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...wurldVersionHeaders(),
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (err) {
    // OBS-LABEL-8 — offline / aborted before any answer.
    throw toNetworkError(err, 'geminiStreamV2');
  }
  // LANG-TIER-1.1 — same mapping as `generateGemini` above. This is the one
  // that actually fires: ExplainModal streams.
  if (!res.ok) throw statusError(res, 'geminiStreamV2', `geminiStreamV2 ${res.status}`);
  if (!res.body) {
    throw new AppError('pipeline/failed', 'Empty response body', undefined, { functionName: 'geminiStreamV2' });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Single rolling stall timer (vs per-iteration). Each successful read
  // resets it; clean exit + abort both clear it so it can't outlive the
  // generator. The promise resolves with `{stalled: true}` on timeout —
  // racing it against `reader.read()` lets us detect silent sockets
  // without scheduling a fresh timer (or its retained reader closure)
  // every chunk.
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  let onStall: (() => void) | undefined;
  const stallPromise = new Promise<{ stalled: true }>((resolve) => {
    onStall = () => resolve({ stalled: true });
  });
  const armStallTimer = () => {
    if (stallTimer !== undefined) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => onStall?.(), STREAM_STALL_MS);
  };
  const clearStallTimer = () => {
    if (stallTimer !== undefined) {
      clearTimeout(stallTimer);
      stallTimer = undefined;
    }
  };

  const onAbort = () => clearStallTimer();
  signal?.addEventListener('abort', onAbort);
  armStallTimer();

  try {
    while (true) {
      const result = await Promise.race([reader.read(), stallPromise]);
      if ('stalled' in result) {
        throw new AppError('pipeline/failed', `streamGemini stalled >${STREAM_STALL_MS}ms`);
      }
      const { value, done } = result;
      if (done) break;
      armStallTimer();
      buffer += decoder.decode(value, { stream: true });

      // Split on \n — SSE frames terminate with \n\n but Cloud Functions
      // sometimes emits per-line; either way we just scan each line.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith(':')) continue; // heartbeat comment
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const parsed = JSON.parse(payload) as { text?: string; error?: string };
          if (parsed.error) {
            throw new AppError('pipeline/failed', parsed.error);
          }
          if (typeof parsed.text === 'string' && parsed.text.length > 0) {
            yield parsed.text;
          }
        } catch (err) {
          if (err instanceof AppError) throw err;
          // Malformed JSON in a data line — log and continue.
          log.warn('streamGemini: malformed line', { line, err });
        }
      }
    }
  } finally {
    clearStallTimer();
    signal?.removeEventListener('abort', onAbort);
    reader.cancel().catch(() => {
      /* ignore */
    });
  }
}
