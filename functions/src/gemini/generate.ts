/**
 * `robustGenerate` — the one wrapper every server-side Gemini generation goes
 * through: kill switch, timeout, retry, fallback-model swap, usage extraction,
 * pipeline trace. Moved out of index.ts (audit CPLX-FN-14/15) so it can be
 * unit-tested with a fake model; see gemini/__tests__ in functions/src/__tests__.
 */
import type { GenerateContentResult, GenerativeModel } from "@google/generative-ai";
import type { GeminiThinkingLevel } from "../modelAllowlist";
import { GEMINI_STUB_ENABLED, stubGenerateResult, stubStreamDelivery } from "../geminiStub";
import { buildGenerateRequest } from "../generationConfig";
import { billedOutputTokens } from "../tokenAccounting";
import { shouldSwapToFallback } from "../modelFallback";
import { GeminiDisabledError, isGeminiEnabled } from "../runtimeConfig";
import { recordPipelineTrace, type PipelineTraceSummary } from "../pipeline/traces";
import { captureModelFailure } from "../observability/sentry";
import { getGeminiModelName } from "./client";
import { isRetryable, withRetry, withTimeout } from "./retry";

export type RobustGenerateResult = {
  text: string;
  tokens?: { in: number; out: number; cached: number; thoughts: number };
  /** Name of the model that actually served the call (primary or fallback).
   *  Surfaced so callers can partition per-model telemetry
   *  (TUTOR-CTX-CACHE-3). */
  modelUsed?: string;
};

/** Generate content with timeout + retry (non-streaming). */
export async function robustGenerate(
  model: GenerativeModel,
  prompt: string,
  {
    timeoutMs = 30_000,
    retries = 1,
    label = "generate",
    fallbackModel,
    traceContext,
    generationConfig,
    systemInstruction,
    thinking,
    onPartial,
  }: {
    timeoutMs?: number;
    retries?: number;
    label?: string;
    fallbackModel?: GenerativeModel;
    traceContext?: Record<string, unknown>;
    generationConfig?: Record<string, unknown>;
    /** Passed through to trace detail for admin waterfall inspection. */
    systemInstruction?: string;
    /** Thinking config used for the call — recorded on the trace so
     *  admin can verify what was actually sent. */
    thinking?: { thinkingLevel?: GeminiThinkingLevel; thinkingBudget?: number };
    /**
     * MSG-PIPE-20 — opt into STREAMING. Called with the response accumulated
     * SO FAR each time a chunk lands, so a caller with a self-delimiting
     * output shape can act on a finished item while the model is still
     * writing the next. Absent (every other caller), the call is a single
     * blocking `generateContent` exactly as before.
     *
     * `attempt` increments on every retry AND on a fallback-model swap, and a
     * new attempt restarts the response from an empty string. A caller
     * carrying parse state across chunks MUST reset it when `attempt` changes,
     * or it will treat the retry's first bytes as a continuation of the failed
     * attempt's last ones.
     *
     * The callback must not throw and must not be slow: it runs inline between
     * chunks, so anything expensive belongs behind a queue on the caller's
     * side.
     */
    onPartial?: (accumulated: string, attempt: number) => void;
  } = {},
): Promise<RobustGenerateResult> {
  let activeModel = model;
  let fallbackUsed = false;
  let attemptSeq = 0;

  // LIMIT-3 — the global kill switch, checked once per call BEFORE any
  // attempt. Cached 60s per instance (runtimeConfig.ts). The error's message
  // matches no retry / fallback trigger, so a killed call fails exactly once.
  if (!(await isGeminiEnabled())) {
    throw new GeminiDisabledError(label);
  }

  return withRetry(
    async () => {
      // --- Execute the actual Gemini call ---
      let generatedText = "";
      let usageMetadata:
        | {
          input_tokens: number;
          output_tokens: number;
          total_tokens: number;
          cached_tokens: number;
          thoughts_tokens: number;
        }
        | undefined;
      let thinkingText: string | undefined;
      let traceError: string | undefined;
      let apiMs: number | undefined;

      const timingStart = Date.now();
      console.info(`[${label}] gemini-call:start`, { timestamp: new Date().toISOString() });

      try {
        const apiCallStart = Date.now();
        // MSG-ROBUST-10 / LIFE-COST-4: merge the MODEL's generationConfig (which
        // carries the thinkingConfig getGeminiModel set) with this request's.
        // The SDK would otherwise shallow-assign the request's over the model's
        // and drop thinking entirely — see generationConfig.ts. Built off
        // `activeModel` INSIDE the retry loop, not once outside it, so a
        // mid-retry fallback swap picks up the fallback's own config rather
        // than replaying a config built for a different model family.
        const request: any = buildGenerateRequest(
          activeModel as unknown as { generationConfig?: Record<string, unknown> },
          generationConfig,
          prompt,
        );
        // Layer-B test seam: deterministic stub instead of a real Gemini call
        // when GEMINI_STUB=1 (emulator e2e only). Shaped like the SDK result so
        // all downstream extraction below is unchanged. See geminiStub.ts.
        // ONE increment per attempt. `attemptSeq` is also what the trace
        // reports as `attempt` (see the write below), so incrementing it in
        // two places made a first-try success report 2 and a retry report 4 —
        // defeating the field's whole purpose, which is telling "one slow
        // call" apart from "a retry" (they have opposite fixes).
        const attempt = ++attemptSeq;
        let result: GenerateContentResult;
        if (GEMINI_STUB_ENABLED) {
          result = stubGenerateResult({
            label,
            systemInstruction,
            prompt,
            responseSchema: generationConfig?.responseSchema,
          }) as unknown as GenerateContentResult;
          // The stub has no chunks; hand a streaming caller the whole thing at
          // once so the emulator exercises the same commit path — or, for the
          // MSG-PIPE-32.7 sentinel, line by line.
          const delivery = onPartial ? stubStreamDelivery(label, prompt, result.response.text()) : null;
          if (delivery) {
            let acc = "";
            for (const chunk of delivery.chunks) {
              await new Promise((r) => setTimeout(r, delivery.delayMs));
              acc += chunk;
              onPartial?.(acc, attempt);
            }
          } else {
            onPartial?.(result.response.text(), attempt);
          }
        } else if (onPartial) {
          const streamed = await withTimeout(
            activeModel.generateContentStream(request),
            timeoutMs,
            `${label}.init`,
          );
          let acc = "";
          // MSG-PIPE-3.3 — `timeoutMs` bounds the WHOLE read, stalls included.
          // It used to be checked only when a chunk ARRIVED, so a stream that
          // stopped sending was bounded by nothing but the function timeout
          // (audit CPLX-FN-15). Each `next()` now races the remaining budget.
          const remaining = () => timeoutMs - (Date.now() - apiCallStart);
          const iter = streamed.stream[Symbol.asyncIterator]();
          for (;;) {
            if (remaining() <= 0) throw new Error(`${label}: stream exceeded ${timeoutMs}ms`);
            const step = await withTimeout(iter.next(), remaining(), `${label}.stream`);
            if (step.done) break;
            const chunk = step.value;
            const parts = chunk.candidates?.[0]?.content?.parts ?? [];
            const text = (parts as any[])
              .filter((p) => p.thought !== true && typeof p.text === "string")
              .map((p) => p.text)
              .join("");
            if (!text) continue;
            acc += text;
            onPartial(acc, attempt);
          }
          result = { response: await withTimeout(streamed.response, Math.max(1, remaining()), `${label}.response`) } as GenerateContentResult;
        } else {
          result = await withTimeout(
            activeModel.generateContent(request),
            timeoutMs,
            label,
          );
        }
        apiMs = Date.now() - apiCallStart;
        console.info(`[${label}] gemini-call:api-complete`, { durationMs: apiMs });
        
        const usage = result.response.usageMetadata;
        usageMetadata = usage
          ? {
            input_tokens: Number(usage.promptTokenCount ?? 0),
            // OBS-USAGE-2: generated text + thinking. Gemini reports the
            // two DISJOINTLY (prompt + candidates + thoughts === total)
            // but bills thinking at the output rate, so recording
            // candidates alone under-reports — measured 51.9% low on a
            // thinkingLevel:"high" call.
            output_tokens: billedOutputTokens(usage),
            total_tokens: Number(usage.totalTokenCount ?? 0),
            // Gemini exposes this when implicit / explicit caching
            // serves part of the prompt. Field name is camelCase in
            // newer SDKs (`cachedContentTokenCount`); older SDKs
            // surfaced it as `cached_content_token_count`. Read both.
            cached_tokens: Number(
              (usage as unknown as { cachedContentTokenCount?: number; cached_content_token_count?: number })
                .cachedContentTokenCount
              ?? (usage as unknown as { cached_content_token_count?: number })
                .cached_content_token_count
              ?? 0,
            ),
            // LIFE-COST-2: reasoning tokens. Gemini bills these at the OUTPUT
            // rate but does NOT include them in `candidatesTokenCount` — they
            // only show up in `totalTokenCount`. Recording `out` alone
            // under-reported every thinking call (measured: backdrop by 21%, world
            // saga by 42%), so cost decisions were being made off numbers that
            // omitted up to a third of the real output spend. Kept as its own
            // field rather than folded into `out` so "what is thinking costing
            // me" stays answerable; pricing sums the two.
            thoughts_tokens: Number(
              (usage as unknown as { thoughtsTokenCount?: number; thoughts_token_count?: number })
                .thoughtsTokenCount
              ?? (usage as unknown as { thoughts_token_count?: number })
                .thoughts_token_count
              ?? 0,
            ),
          }
          : undefined;
        // Extract thinking + output text from response parts (Gemini 2.5/3 models)
        // SDK 0.24.1's .text() doesn't filter thinking parts, so we must do it manually.
        const parts = result.response.candidates?.[0]?.content?.parts ?? [];
        thinkingText = (parts as any[])
          .filter((p) => p.thought === true && typeof p.text === "string")
          .map((p) => p.text)
          .join("\n") || undefined;
        generatedText = (parts as any[])
          .filter((p) => p.thought !== true && typeof p.text === "string")
          .map((p) => p.text)
          .join("") || result.response.text();
        
        const totalMs = Date.now() - timingStart;
        console.info(`[${label}] gemini-call:complete`, { totalDurationMs: totalMs });
      } catch (err: any) {
        const totalMs = Date.now() - timingStart;
        console.warn(`[${label}] gemini-call:error`, { totalDurationMs: totalMs, error: err?.message ?? String(err) });
        traceError = err?.message ?? String(err);
        // OBS-SRV-7 — every failed attempt, even one a retry or the backup
        // model goes on to rescue.
        captureModelFailure(err, { provider: "gemini", model: getGeminiModelName(activeModel), label, attempt: attemptSeq });
        throw err;
      } finally {
        // --- Record Firestore pipeline trace (fire-and-forget) ---
        const totalDurationMs = Date.now() - timingStart;
        const chatId = typeof traceContext?.chat_id === "string" ? traceContext.chat_id : undefined;
        const messageId = typeof traceContext?.message_id === "string" ? traceContext.message_id : undefined;
        const flow = typeof traceContext?.flow === "string" ? traceContext.flow : undefined;
        if (chatId && messageId) {
          const traceSummary: PipelineTraceSummary = {
            stage: label,
            model: getGeminiModelName(activeModel),
            startMs: timingStart,
            durationMs: totalDurationMs,
            ...(typeof apiMs === "number" ? { apiMs } : {}),
            attempt: attemptSeq,
            // LIFE-COST-2: thinking tokens are billed at the OUTPUT rate but
            // excluded from candidatesTokenCount, so a trace without them
            // under-reports the call.
            ...(usageMetadata ? { tokens: { in: usageMetadata.input_tokens, out: usageMetadata.output_tokens, cached: usageMetadata.cached_tokens, thoughts: usageMetadata.thoughts_tokens } } : {}),
            status: traceError ? "error" : (fallbackUsed ? "fallback" : "ok"),
            ...(traceError ? { error: traceError.slice(0, 200) } : {}),
            ...(typeof traceContext?.target_language === "string" ? { jobKey: traceContext.target_language as string } : {}),
            ...(typeof thinking?.thinkingLevel === "string" ? { thinkingLevel: thinking.thinkingLevel } : {}),
            ...(typeof thinking?.thinkingBudget === "number" ? { thinkingBudget: thinking.thinkingBudget } : {}),
          };
          recordPipelineTrace(chatId, messageId, traceSummary, {
            prompt,
            rawOutput: generatedText || traceError || "",
            ...(thinkingText ? { thinking: thinkingText } : {}),
            ...(systemInstruction ? { systemInstruction } : {}),
          }).catch(() => {});
        } else if (flow === "message_pipeline" || flow === "tutor_chat" || flow === "tutor_message_translate") {
          // These flows OWN a message doc — if chatId/messageId aren't
          // in the traceContext, a trace goes missing in the admin
          // waterfall. Warn loudly so regressions surface in logs.
          console.warn("[robustGenerate] pipeline trace skipped — missing chat_id/message_id", {
            label, flow, hasChatId: !!chatId, hasMessageId: !!messageId,
          });
        }
      }

      return {
        text: generatedText,
        tokens: usageMetadata
          ? {
            in: usageMetadata.input_tokens,
            out: usageMetadata.output_tokens,
            cached: usageMetadata.cached_tokens,
            thoughts: usageMetadata.thoughts_tokens,
          }
          : undefined,
        modelUsed: getGeminiModelName(activeModel),
      };
    },
    {
      retries,
      label,
      baseDelayMs: 500,
      // SEC-FN-11 — a retirement/quota error is worth one more attempt only
      // because `onRetry` below moves it onto the fallback model.
      isRetryable: (err) => isRetryable(err) || (!!fallbackModel && !fallbackUsed && shouldSwapToFallback(err)),
      onRetry: (err) => {
        if (shouldSwapToFallback(err) && fallbackModel && !fallbackUsed) {
          fallbackUsed = true;
          const primaryName = getGeminiModelName(activeModel);
          const fallbackName = getGeminiModelName(fallbackModel);
          activeModel = fallbackModel;
          const reason = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
          // console.ERROR (not warn) because a fallback firing is a
          // non-trivial event — typically the primary model is a
          // preview tier that got yanked, quota'd, or 503'd. The user
          // explicitly asked for this surface so the symptom is
          // visible in `firebase functions:log` without digging.
          console.error(
            `[${label}] PRIMARY model ${primaryName} failed — swapping to fallback ${fallbackName}. reason: ${reason}`,
          );
        }
      },
    },
  );
}
