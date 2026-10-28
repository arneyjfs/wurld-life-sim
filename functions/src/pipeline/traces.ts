/**
 * Pipeline trace recording — Firestore-native tracing (moved out of index.ts,
 * audit CPLX-FN-14/15, so robustGenerate can live in ./gemini/generate).
 *
 * Lightweight summaries go on the message doc (`pipeline.traces`); full
 * prompts/outputs go to `pipelineTraceDetails` with a 14-day TTL.
 *
 * MSG-PIPE-28 (audit CPLX-FN-4) — while a send is running its summaries are
 * BUFFERED in memory and land on the message doc in ONE write. Every write to
 * a message doc is a version delivered to every open listener on the chat, a
 * billed read per viewer (COST-FS-1); one `arrayUnion` per LLM call and per
 * stage was half the versions of a 1:1 send (9 of 18). Details still go
 * straight to `pipelineTraceDetails` — that collection has no listeners.
 */
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getFirestore } from "../firebaseConfig";
import { TRACE_DETAILS_COLLECTION } from "../observability/queries";
import { currentRequestScope } from "../requestScope";

export const TRACE_TTL_DAYS = 14;

// ---------------------------------------------------------------------------
// TraceBuffer (MSG-PIPE-28)
// ---------------------------------------------------------------------------

// API-GW-6.2 — the buffers are the current REQUEST's. Inside a request scope
// (the gen2 `api` function, many requests per process) two concurrent sends of
// the same message each own their buffer; outside one (gen1 exports, triggers)
// the process-wide map is the request's, as before.
const processBuffers = new Map<string, PipelineTraceSummary[]>();
const scopedBuffers = (): Map<string, PipelineTraceSummary[]> =>
  (currentRequestScope()?.traceBuffers as Map<string, PipelineTraceSummary[]> | undefined) ?? processBuffers;
const bufferKey = (chatId: string, messageId: string) => `${chatId}/${messageId}`;

/**
 * Start buffering summaries for one message. Returns `true` when THIS call
 * opened the buffer (and so owns the flush), `false` when one was already
 * open — the HTTP send opens it before analysis, and `runPipelineJobs`, which
 * it calls inline, must not flush the send's buffer early.
 *
 * Per process: a trace recorded by another instance (a trigger) is written
 * directly, as before.
 */
export function openTraceBuffer(chatId: string, messageId: string): boolean {
  const buffers = scopedBuffers();
  const key = bufferKey(chatId, messageId);
  if (buffers.has(key)) return false;
  buffers.set(key, []);
  return true;
}

/** Close the buffer WITHOUT writing it (a deduped send: the doc is another
 *  call's, and so are its traces). */
export function discardTraceBuffer(chatId: string, messageId: string): void {
  scopedBuffers().delete(bufferKey(chatId, messageId));
}

/**
 * Close the buffer and land everything it holds on the message doc in ONE
 * update. A no-op when nothing was buffered. Never throws: traces must never
 * fail a send. Summaries recorded after this go straight to the doc.
 */
export async function flushTraceBuffer(chatId: string, messageId: string): Promise<void> {
  const buffers = scopedBuffers();
  const key = bufferKey(chatId, messageId);
  const summaries = buffers.get(key);
  buffers.delete(key);
  if (!summaries?.length) return;
  try {
    await getFirestore().doc(`chats/${chatId}/messages/${messageId}`).update({
      "pipeline.traces": FieldValue.arrayUnion(...summaries),
    });
  } catch (err: any) {
    console.warn("[trace] flushTraceBuffer failed:", err?.message ?? err);
  }
}

/** Buffer the summary if a buffer is open for the message; `true` if it was. */
function buffered(chatId: string, messageId: string, summary: PipelineTraceSummary): boolean {
  const buf = scopedBuffers().get(bufferKey(chatId, messageId));
  if (!buf) return false;
  buf.push(summary);
  return true;
}

/** Test seam: how many buffers are open in the current scope (a leak shows up here). */
export function openTraceBufferCount(): number {
  return scopedBuffers().size;
}

export type PipelineTraceSummary = {
  stage: string;
  model: string;
  startMs: number;
  durationMs: number;
  /** `thoughts` = reasoning tokens (LIFE-COST-2): billed at the OUTPUT rate but
   *  NOT included in `out` (`candidatesTokenCount`). Anything pricing a trace
   *  must charge `out + thoughts`. */
  tokens?: { in: number; out: number; cached?: number; thoughts?: number };
  status: "ok" | "error" | "fallback";
  error?: string;
  chatId?: string;
  messageId?: string;
  /** Time inside `generateContent` alone, vs `durationMs` which also covers
   *  response parsing. A gap between them points at us; a gap between `apiMs`
   *  and a healthy baseline points at Gemini. */
  apiMs?: number;
  /** 1-based attempt that produced this result. `durationMs` is measured PER
   *  ATTEMPT, so without this a 15s trace is ambiguous between one slow call
   *  and a retry — and those have opposite fixes. */
  attempt?: number;
  /** Populated when the trace is tied to a specific translation job. */
  jobKey?: string;
  /** Translation mode for job traces: translateOnly, translateAndAnnotate, annotateOnly. */
  mode?: string;
  /** Annotation native language for annotated jobs (enables pivot-by-native in admin). */
  annotationNative?: string;
  /** Thinking config requested at call time. Surfaced in admin so we
   *  can verify the deployed code actually sent "minimal" (vs. drift /
   *  cache staleness). One or the other depending on model family
   *  (3.x → thinkingLevel, 2.x → thinkingBudget). */
  thinkingLevel?: string;
  thinkingBudget?: number;
  /** MSG-PIPE-31.12 — the OpenAI tier answered, on Fast mode attempts only. */
  serviceTier?: string;
};

/**
 * Record a pipeline trace to Firestore.
 * 1. Appends a lightweight summary to the message doc's pipeline.traces array.
 * 2. Writes full prompt + raw output to pipelineTraceDetails collection (14-day TTL).
 * Fire-and-forget — traces must never block the pipeline.
 */
export async function recordPipelineTrace(
  chatId: string,
  messageId: string,
  summary: PipelineTraceSummary,
  detail?: { prompt: string; rawOutput: string; thinking?: string; systemInstruction?: string },
): Promise<void> {
  try {
    const promises: Promise<any>[] = [];

    // 1. Append summary to message doc — or to its open buffer (MSG-PIPE-28).
    if (!buffered(chatId, messageId, summary)) {
      const messageRef = getFirestore().doc(`chats/${chatId}/messages/${messageId}`);
      promises.push(
        messageRef.update({
          "pipeline.traces": FieldValue.arrayUnion(summary),
        }).catch(() => {}),
      );
    }

    // 2. Write full detail with TTL
    if (detail) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + TRACE_TTL_DAYS * 24 * 60 * 60 * 1000);
      promises.push(
        getFirestore().collection(TRACE_DETAILS_COLLECTION).add({
          chatId,
          messageId,
          stage: summary.stage,
          model: summary.model,
          prompt: detail.prompt,
          rawOutput: detail.rawOutput,
          ...(detail.thinking ? { thinking: detail.thinking } : {}),
          ...(detail.systemInstruction ? { systemInstruction: detail.systemInstruction } : {}),
          ...(summary.thinkingLevel ? { thinkingLevel: summary.thinkingLevel } : {}),
          ...(typeof summary.thinkingBudget === "number" ? { thinkingBudget: summary.thinkingBudget } : {}),
          ...(summary.serviceTier ? { serviceTier: summary.serviceTier } : {}),
          tokens: summary.tokens ?? null,
          durationMs: summary.durationMs,
          startMs: summary.startMs,
          status: summary.status,
          error: summary.error ?? null,
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: Timestamp.fromDate(expiresAt),
        }),
      );
    }

    await Promise.all(promises);
  } catch (err: any) {
    console.warn("[trace] recordPipelineTrace failed:", err?.message ?? err);
  }
}

/**
 * Record a stage-level pipeline trace (for non-LLM operations like DB writes, parsing, etc.)
 * This complements the LLM-level traces recorded by robustGenerate.
 */
export async function recordStageTrace(
  chatId: string,
  messageId: string,
  stage: string,
  startMs: number,
  status: "ok" | "error" = "ok",
  error?: string,
): Promise<void> {
  const durationMs = Date.now() - startMs;
  const summary: PipelineTraceSummary = {
    stage,
    model: "—",
    startMs,
    durationMs,
    status,
    chatId,
    messageId,
    ...(error ? { error: error.slice(0, 200) } : {}),
  };
  if (buffered(chatId, messageId, summary)) return;
  try {
    const messageRef = getFirestore().doc(`chats/${chatId}/messages/${messageId}`);
    await messageRef.update({
      "pipeline.traces": FieldValue.arrayUnion(summary),
    }).catch(() => {});
  } catch {
    // Fire-and-forget
  }
}
