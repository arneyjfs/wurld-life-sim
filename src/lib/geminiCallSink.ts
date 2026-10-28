/**
 * BOOT-SPLIT-6 — the seam between the app-wide Gemini client and whoever wants
 * to observe its calls (docs/specs/cold-boot.md §3d).
 *
 * `gemini.ts` sits on the first-paint path; the only observer today is the
 * life-sim telemetry buffer (`lib/life/telemetry.ts`), which is Life code and
 * must stay in the lazy Life chunks. So the dependency points this way: the
 * client EMITS here, and telemetry SUBSCRIBES when its module loads. Every life
 * caller loads it (via `life/debugLog`) before its first call, so no life call
 * goes unrecorded; calls made before Life was ever opened are not life calls.
 */

export type GeminiCallTokens = {
  in: number;
  out: number;
  cached: number;
  /** LIFE-COST-2: reasoning tokens. Billed at the OUTPUT rate but excluded
   *  from `out` (`candidatesTokenCount`) — see `estimateCallCost`. Optional:
   *  a backend older than the 2026-07 fix doesn't send it. */
  thoughts?: number;
};

export type GeminiCallRecord = {
  /** Wall-clock ms (sort key). */
  ts: number;
  /** Logical bucket: `life_step`, `life_bio`, `life_world_saga`, etc. */
  category: string;
  /** Gemini model name actually used (may differ from requested if
   *  the backend fell back). */
  modelUsed: string | null;
  /** Token usage from `result.response.usageMetadata`. Null if the
   *  backend didn't return it (e.g. pre-deploy or older backend). */
  tokens: GeminiCallTokens | null;
  /** End-to-end backend-measured duration of the Gemini call. */
  durationMs: number | null;
  /** LIFE-COST-3: 0-based attempt index. > 0 means this call is a
   *  REGENERATION after a schema / validator rejection — paid-for waste. */
  attempt?: number;
};

type Listener = (record: GeminiCallRecord) => void;
const listeners = new Set<Listener>();

/** Observe every completed Gemini call. Returns an unsubscribe. */
export function onGeminiCall(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by `gemini.ts` after each call. A listener that throws never
 *  reaches the caller. */
export function emitGeminiCall(record: GeminiCallRecord): void {
  listeners.forEach((fn) => {
    try {
      fn(record);
    } catch {
      /* observers must never break the call */
    }
  });
}
