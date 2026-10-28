/**
 * Client Gemini proxies: `geminiGenerate` and `geminiStreamV2` (SRV-PROMPT-*).
 *
 * Moved verbatim out of `index.ts` (audit: index.ts split); `index.ts`
 * re-exports the Cloud Functions defined here under their unchanged names.
 */
import { paidFeatureForCategory, paidFeatureDenial } from "../paidFeatureGate";
import { getFirestore, verifyAuth } from "../firebaseConfig";
import { hasProEntitlement, entitlementFields } from "../entitlement";
import * as functionsV1 from "firebase-functions/v1";
import { Request, Response } from "express";
import { setCors, checkRateLimit, ALLOWED_ORIGINS } from "../httpShared";
import { enforceVersionFloor } from "../versionFloor";
import * as admin from "firebase-admin";
import { clientCategory, createStreamRelay, prepareClientCall } from "../gemini/clientCall";
import { generateRouted, geminiModelsFor, type GeminiStep } from "../gemini/routed";
import { MODELS } from "../gemini/client";
import { robustGenerate } from "../gemini/generate";
import { recordTokenUsage } from "../tokenUsage";
import { isGeminiDisabledError, respondGeminiDisabled, isGeminiEnabled } from "../runtimeConfig";
import { onRequestV2 } from "../httpV2";
import { type GeminiModel } from "../modelAllowlist";
import { buildGenerateRequest } from "../generationConfig";
import { GEMINI_STUB_ENABLED, stubStreamResult } from "../geminiStub";
import { withTimeout } from "../gemini/retry";
import { shouldSwapToFallback } from "../modelFallback";
import { billedOutputTokens } from "../tokenAccounting";
import { captureModelFailure, withSentryHttp } from "../observability/sentry";

// ---------------------------------------------------------------------------
// Prompt size limit (64 KB)
// ---------------------------------------------------------------------------
// Life-sim prompts legitimately exceed 10KB once saga + chapter
// outline + roster + recent events are assembled. 64KB is still
// abuse-resistant (well under Gemini's 1M-token window) while
// covering the largest legitimate lifeStep prompts comfortably.
//
// The constant now lives in `./promptLimits` so `prompts/practiceSpec.ts` can
// apply the SAME number to prompts the server assembles (PRACTICE-OWN-6)
// without importing this module. Imported at the top of the file.

// ---------------------------------------------------------------------------
// Reliability helpers — timeout, retry, cached access token
// ---------------------------------------------------------------------------

// withTimeout / isRetryable / withRetry live in ./gemini/retry.

// shouldSwapToFallback() — extracted to ./modelFallback so its unit test
// doesn't have to import this whole module. See docs/specs/message-pipeline.md
// MSG-PIPE-3 / MSG-ROBUST-4.
// Imported at the top of this file.

// robustGenerate lives in ./gemini/generate (audit CPLX-FN-14/15).

// (Cloud TTS no longer uses an OAuth access token — the gen-1 runtime
//  SA's metadata token lacks the cloud-platform scope the synthesize
//  endpoint needs, so TTS authenticates with the GEMINI_API_KEY via
//  `?key=`. See synthGeminiTTS / listAllTTSVoices.)

/**
 * LANG-TIER-1.1 — the paid-feature gate for the two client-direct Gemini
 * proxies. Returns false when it has already answered 402; callers MUST return.
 *
 * Shared by `geminiGenerate` and `geminiStreamV2` on purpose. The two endpoints
 * have drifted before — PRACTICE-OWN-10 and MSG-PIPE-23 both record a knob the
 * streaming one silently dropped — and an entitlement check present on one and
 * missing on the other is that same class of bug with a bill attached.
 *
 * Which categories are gated is `paidFeatureGate.ts`'s business, including the
 * card-creation ones it deliberately leaves free and the tutor it deliberately
 * leaves to LANG-GATE-4.3.
 *
 * ⚠ Costs one `users/{uid}` read, and ONLY on a gated category. An explain or
 * practice call already spends a Gemini request, so one document read is noise
 * against it — but it is placed behind `paidFeatureForCategory` rather than in
 * front of it so the free paths (topic classification on every new card, the
 * chat importer) pay nothing.
 *
 * Read fresh every time, never memoised: a trial expiring is a clock event with
 * no write behind it (LANG-TRIAL-6), and this is the authority that has to see
 * it.
 */
async function enforcePaidFeature(
  uid: string,
  category: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } },
): Promise<boolean> {
  const feature = paidFeatureForCategory(category);
  if (!feature) return true;
  const snap = await getFirestore().doc(`users/${uid}`).get().catch(() => null);
  const d = snap?.data();
  // LANG-SEC-2 — a missing or unreadable doc is NOT entitled.
  const entitled = hasProEntitlement(
    entitlementFields(d),
    Date.now(),
  );
  if (entitled) return true;
  res.status(402).json(paidFeatureDenial(feature));
  return false;
}

// ---------------------------------------------------------------------------
// 1. geminiGenerate — non-streaming Gemini proxy
//    POST { prompt: string, model: ModelTier }
//    Returns { text: string }
// ---------------------------------------------------------------------------

export const geminiGenerate = functionsV1
  // MSG-PIPE-31.8 — OPENAI_API_KEY: the routed client kinds may run on, or
  // fall back to, OpenAI.
  .runWith({ timeoutSeconds: 120, memory: "512MB", secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY"] })
  .https.onRequest(withSentryHttp("geminiGenerate", async (req: Request, res: Response) => {
    setCors(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
    if (!(await enforceVersionFloor(req, res))) return; // OBS-VERSION-10

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyAuth(req);
    } catch (err: any) {
      res.status(401).json({ error: err.message });
      return;
    }

    if (!(await checkRateLimit(decodedToken.uid, res))) return; // LIMIT-1

    // SRV-PROMPT-8..13 — the wire shape is `{ category, promptSpec, … }`. The
    // server builds BOTH halves of every call from the spec; a body `prompt`
    // or `systemInstruction` is not read. Read up-front: the practice gate,
    // the explicit-SI-cache allowlist and the post-call telemetry key off it.
    const category = clientCategory(req.body);

    // LANG-TIER-1.1 — before the prompt is resolved, so an unentitled caller
    // gets the 402 that names the reason rather than a 400 about a promptSpec
    // they were never going to be allowed to run.
    if (!(await enforcePaidFeature(decodedToken.uid, category, res))) return;

    try {
      // SRV-PROMPT-19 — prompt, SI, model, thinking, explicit cache, fallback
      // and generation config: ONE preparation, shared with geminiStreamV2
      // (./gemini/clientCall). `resolveServerPrompt` inside it is the whole
      // prompt rule (PRACTICE-OWN-*, SRV-PROMPT-*).
      const prepared = await prepareClientCall(req.body, { category, defaultModel: MODELS.clientGenerate });
      if (prepared.status === "reject") {
        // Logged, not just returned: the CODE separates the causes.
        console.warn(`[geminiGenerate] practice-${prepared.code} category=${category}: ${prepared.reason}`);
        res.status(400).json({ error: `Invalid promptSpec: ${prepared.reason}` });
        return;
      }
      const call = prepared.call;
      const genStart = Date.now();
      // MSG-PIPE-31.2a — the Gemini call, with the models generateRouted's
      // step allows. `both` (the non-routed path) is the call exactly as before.
      const runGemini = (h: GeminiStep) => {
        const m = geminiModelsFor(h.models, call.model, call.fallbackModel);
        return robustGenerate(m.model, call.prompt, {
          timeoutMs: 45_000,
          retries: 1,
          label: "geminiGenerate",
          generationConfig: call.generationConfig,
          fallbackModel: m.fallbackModel,
          // The SI is baked into `geminiModel` above, so the CALL works without
          // this — but `robustGenerate` writes its argument to the trace detail
          // the admin waterfall renders, and to the emulator stub's request
          // record. Omitting it meant the busiest endpoint in the app (practice,
          // topic-classify, chat-import, card-translate, life, Explain) showed NO
          // system instruction in either. Worse for tests than for admin: an
          // integration assertion like `!recordedSi.includes(INJECTED)` passed
          // VACUOUSLY against an empty string, which is the same trap that once
          // made this suite's security check green for the wrong reason.
          systemInstruction: call.systemInstruction,
        });
      };
      // MSG-PIPE-31.9 — a routed kind goes to its primary provider (OpenAI
      // with its own Luna prompt, or Gemini) and falls back to the other.
      const { text, tokens: genTokens, modelUsed } = call.luna
        ? await generateRouted({
          category: call.luna.category,
          label: "geminiGenerate",
          openai: call.luna.request,
          gemini: runGemini,
        })
        : await runGemini({ models: "both" });
      const genDurationMs = Date.now() - genStart;
      if (genTokens) {
        // Pass cached (implicit/explicit prefix-cache hit) + model so the
        // admin dashboard sees them — the in-story telemetry already echoes
        // `tokens.cached` (below), but this write is the ONLY path to the
        // dashboard counters and was dropping cached, so every client-direct
        // category (life_step, practice_*, etc.) showed cache=0 there.
        recordTokenUsage(decodedToken.uid, category, genTokens.in, genTokens.out, {
          cached: genTokens.cached,
          model: modelUsed,
          // LIFE-COST-2: billed at the output rate, absent from `out`.
          thoughts: genTokens.thoughts,
        }).catch(() => {});
      }
      // Echo token + duration + model telemetry so the client-side
      // debug overlay can show per-call cost + cache-hit data. The
      // `tokens.cached` field is populated when Gemini's implicit OR
      // explicit prefix cache serves part of the prompt.
      res.json({
        text,
        tokens: genTokens ?? null,
        modelUsed,
        durationMs: genDurationMs,
      });
    } catch (err: any) {
      if (isGeminiDisabledError(err)) { respondGeminiDisabled(res); return; } // LIMIT-3
      console.error("[geminiGenerate] Gemini error:", err);
      const status = err.message?.includes("timed out") ? 504 : 500;
      res.status(status).json({ error: err.message?.includes("timed out") ? "Request timed out — please try again" : "Gemini generation failed" });
    }
  }));

// ---------------------------------------------------------------------------
// 2. geminiStream — streaming Gemini proxy
//    POST { prompt: string, model: ModelTier }
//    Returns text/event-stream with chunks
// ---------------------------------------------------------------------------

export const geminiStreamV2 = onRequestV2(
  "geminiStreamV2",
  {
    timeoutSeconds: 120,
    memory: "512MiB",
    cors: ALLOWED_ORIGINS,
    // MSG-PIPE-31.8 — see geminiGenerate.
    secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY"],
  },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyAuth(req as unknown as Request);
    } catch (err: any) {
      res.status(401).json({ error: err.message });
      return;
    }

    if (!(await checkRateLimit(decodedToken.uid, res))) return; // LIMIT-1
    // LIMIT-3 — refuse BEFORE the SSE headers go out so the client gets a
    // plain 503 JSON it can map, not an event stream carrying an error.
    if (!(await isGeminiEnabled())) { respondGeminiDisabled(res); return; }

    // Same wire shape as `geminiGenerate`: `{ category, promptSpec, … }`, no
    // body prompt or SI is read.
    const streamCategory = clientCategory(req.body);

    // LANG-TIER-1.1 — the SAME gate the non-streaming endpoint applies, in the
    // same position, and it must stay that way: ExplainModal's main stream is
    // the single largest paid surface on this endpoint. Before the SSE headers
    // go out, so the refusal is a plain JSON 402 rather than an error event
    // inside a stream the client has already opened.
    if (!(await enforcePaidFeature(decodedToken.uid, streamCategory, res))) return;

    // SRV-PROMPT-19 — the IDENTICAL preparation the non-streaming endpoint
    // makes (./gemini/clientCall): server prompt + SI, model and thinking
    // resolution, the explicit SI cache (slot AND per-category — the category
    // cache was never consulted here before), the fallback model, and the
    // generation config. Before the SSE headers, so a reject is a plain 400.
    const streamPrepared = await prepareClientCall(req.body, {
      category: streamCategory, defaultModel: MODELS.clientStream,
    });
    if (streamPrepared.status === "reject") {
      console.warn(
        `[geminiStreamV2] practice-${streamPrepared.code} category=${streamCategory}: ${streamPrepared.reason}`,
      );
      res.status(400).json({ error: `Invalid promptSpec: ${streamPrepared.reason}` });
      return;
    }
    const streamCall = streamPrepared.call;

    // Set up SSE headers — Cloud Run (Gen 2) streams these without buffering
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    // Heartbeat keeps the connection alive while Gemini "thinks" (2.5/3 models
    // can pause 5-15s before emitting text). Without this the client may
    // interpret silence as a dead connection.
    const HEARTBEAT_INTERVAL_MS = 5_000;
    const heartbeat = setInterval(() => {
      try { res.write(": heartbeat\n\n"); } catch { /* connection gone */ }
    }, HEARTBEAT_INTERVAL_MS);

    // MSG-PIPE-31.9 / 31.4a — a routed kind streams through generateRouted.
    // Below this block, the non-routed path is unchanged.
    if (streamCall.luna) {
      const routedStart = Date.now();
      let routedError: string | undefined;
      let routedModel: string = streamCall.primaryName;
      let routedTokens: { in: number; out: number; cached: number; thoughts: number } | undefined;
      const send = (payload: Record<string, unknown>) => {
        try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* connection gone */ }
      };
      // The client protocol cannot restart a stream: a provider switch after
      // text went out ends it with the error event (createStreamRelay).
      const relay = createStreamRelay((text) => send({ text }), () => send({ error: "Gemini streaming failed" }));
      // MSG-PIPE-31.2a — Gemini as robustGenerate streaming (onPartial), with
      // the models the step allows.
      const runGemini = (h: GeminiStep) => {
        const m = geminiModelsFor(h.models, streamCall.model, streamCall.fallbackModel);
        return robustGenerate(m.model, streamCall.prompt, {
          timeoutMs: 60_000,
          retries: 1,
          label: "geminiStreamV2",
          generationConfig: streamCall.generationConfig,
          fallbackModel: m.fallbackModel,
          systemInstruction: streamCall.systemInstruction,
          thinking: streamCall.thinking,
          onPartial: h.onPartial,
        });
      };
      try {
        const routed = await generateRouted({
          category: streamCall.luna.category,
          label: "geminiStreamV2",
          openai: streamCall.luna.request,
          onPartial: relay.onPartial,
          gemini: runGemini,
        });
        routedModel = routed.modelUsed ?? routedModel;
        if (routed.tokens) {
          // MSG-PIPE-31.5 — booked to the model that answered.
          recordTokenUsage(decodedToken.uid, streamCategory, routed.tokens.in, routed.tokens.out, {
            cached: routed.tokens.cached,
            model: routed.modelUsed,
            thoughts: routed.tokens.thoughts,
          }).catch(() => {});
          routedTokens = routed.tokens;
        }
        if (!relay.restarted) {
          relay.finish(routed.text);
          res.write("data: [DONE]\n\n");
        }
      } catch (err: unknown) {
        routedError = err instanceof Error ? err.message : String(err);
        console.error("[geminiStream] routed error:", err);
        if (!relay.restarted) {
          send({ error: routedError.includes("timed out") ? "Request timed out — please try again" : "Gemini streaming failed" });
        }
      } finally {
        clearInterval(heartbeat);
        res.end();
        console.info("[geminiStreamV2] gemini-call:complete", {
          category: streamCategory,
          totalDurationMs: Date.now() - routedStart,
          model: routedModel,
          explicitCache: streamCall.cached,
          tokens: routedTokens ?? null,
          ...(relay.restarted ? { restarted: true } : {}),
          ...(routedError ? { error: routedError.slice(0, 200) } : {}),
        });
      }
      return;
    }

    const streamStart = Date.now();
    let streamError: string | undefined;
    // Tracked alongside the model so the usage write can attribute spend to
    // the tier that actually served the stream (a fallback swap changes it).
    let streamModelUsed: GeminiModel = streamCall.primaryName;
    let streamTokens: { in: number; out: number; cached: number; thoughts: number } | undefined;
    try {
      let geminiModel = streamCall.model;
      const effectiveStreamPrompt = streamCall.prompt;
      const effectiveStreamSi = streamCall.systemInstruction;
      const streamGenerationConfig = streamCall.generationConfig as
        | { responseSchema?: Record<string, unknown> } & Record<string, unknown>
        | undefined;
      // MSG-ROBUST-10: same clobber applies to the streaming path — a request
      // carrying responseMimeType/responseSchema would drop the model's
      // thinkingConfig, so `minimal` never reached the wire and the stream ran
      // at the model's default reasoning level (slower first token, dearer).
      // Built FROM the model, so the fallback swap below rebuilds it.
      const streamRequest: any = buildGenerateRequest(
        geminiModel as unknown as { generationConfig?: Record<string, unknown> },
        streamGenerationConfig,
        effectiveStreamPrompt,
      );
      // Timeout on the initial connection — if Gemini doesn't start streaming
      // within 30s something is wrong.
      // One-shot fallback: if the initial connection fails because the model
      // is overloaded (503) or no longer available (404), swap to
      // MODELS.fallback once and retry the open. Same trigger as
      // robustGenerate so behaviour stays consistent across streaming + non-
      // streaming paths. We only re-attempt for the open — mid-stream
      // failures still bubble to the catch below.
      let streamResult;
      try {
        // SRV-PROMPT-7 — the same test seam `robustGenerate` has, on the path
        // that had none. Placed HERE rather than earlier so everything above it
        // (spec resolution, SI selection, generationConfig assembly, the
        // request build) runs exactly as in production — a seam further up
        // would let the scenario pass while the real assembly was broken.
        streamResult = GEMINI_STUB_ENABLED
          ? stubStreamResult({
              label: "geminiStreamV2",
              systemInstruction: effectiveStreamSi,
              prompt: effectiveStreamPrompt,
              responseSchema: streamGenerationConfig?.responseSchema,
            })
          : await withTimeout(
              geminiModel.generateContentStream(streamRequest),
              30_000,
              "geminiStream.init",
            );
      } catch (initErr) {
        // OBS-SRV-7 — reported whether or not the fallback model rescues it.
        captureModelFailure(initErr, { provider: "gemini", model: streamModelUsed, label: "geminiStreamV2", attempt: 1 });
        if (!shouldSwapToFallback(initErr) || !streamCall.fallbackModel) throw initErr;
        const reason = initErr instanceof Error ? initErr.message.slice(0, 120) : String(initErr).slice(0, 120);
        console.warn(`[geminiStream] swapping to fallback model (${MODELS.fallback}). reason: ${reason}`);
        // MSG-ROBUST-10: `getMinimalThinking`, matching every other fallback
        // construction in this file — the fallback flash thinks by default
        // (~874 tokens unconfigured), on the one path that only runs when the
        // primary is already degraded.
        // The prepared fallback: `MODELS.fallback`, minimal thinking, the same
        // server SI (SRV-PROMPT-19).
        geminiModel = streamCall.fallbackModel;
        streamModelUsed = MODELS.fallback;
        // MSG-ROBUST-10: REBUILD from the fallback. Replaying `streamRequest`
        // would send the Gemini-3 primary's `thinkingLevel` to gemini-2.5-flash,
        // which rejects that field at "minimal" (measured — see ExplainModal),
        // and would overwrite the fallback's own thinkingConfig on the way.
        const fallbackRequest: any = buildGenerateRequest(
          geminiModel as unknown as { generationConfig?: Record<string, unknown> },
          streamGenerationConfig,
          effectiveStreamPrompt,
        );
        streamResult = await withTimeout(
          geminiModel.generateContentStream(fallbackRequest),
          30_000,
          "geminiStream.init.fallback",
        );
      }

      for await (const chunk of streamResult.stream) {
        // Gemini 2.5/3 models emit "thinking" chunks — skip them.
        // With includeThoughts=true, thinking parts have thought=true and
        // .text() may succeed instead of throwing, so check parts explicitly.
        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        const hasThought = (parts as any[]).some((p) => p.thought === true);
        if (hasThought) continue;
        let text = "";
        try { text = chunk.text(); } catch { continue; }
        if (text) {
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }

      // Capture token usage from completed stream
      try {
        const streamResponse = await streamResult.response;
        const usage = streamResponse.usageMetadata;
        if (usage) {
          const tokensIn = Number(usage.promptTokenCount ?? 0);
          // OBS-USAGE-2: includes thinking tokens, which bill as output.
          const tokensOut = billedOutputTokens(usage);
          // Same cache-hit field robustGenerate reads (camelCase in newer
          // SDKs, snake_case in older) — the stream path wasn't extracting it,
          // so streamed categories never recorded cache to the dashboard.
          const cached = Number(
            (usage as unknown as { cachedContentTokenCount?: number }).cachedContentTokenCount ??
              (usage as unknown as { cached_content_token_count?: number }).cached_content_token_count ??
              0,
          );
          // `streamCategory` rather than a second read of the body: that one
          // was `?? "unknown"`, which passes a NON-string category (a number,
          // an object) straight into the telemetry bucket. Normalised once at
          // the top now, and shared with the practice gate so the category the
          // spec is checked against is the category the spend is booked to.
          //
          // `model` matters too: the dashboard prices per model, and this path
          // can have swapped to MODELS.fallback (a different tier) on the open.
          // Omitting it priced every streamed call at the default.
          // LIFE-COST-2 — reasoning tokens booked on their own counter, as
          // `geminiGenerate` (via robustGenerate) always has; `tokensOut`
          // already includes them (OBS-USAGE-2).
          const thoughts = Number(
            (usage as unknown as { thoughtsTokenCount?: number }).thoughtsTokenCount ?? 0,
          );
          recordTokenUsage(decodedToken.uid, streamCategory, tokensIn, tokensOut, {
            cached,
            model: streamModelUsed,
            thoughts,
          }).catch(() => {});
          streamTokens = { in: tokensIn, out: tokensOut, cached, thoughts };
        }
      } catch { /* stream may have errored, skip token recording */ }

      res.write("data: [DONE]\n\n");
    } catch (err: any) {
      streamError = err?.message ?? String(err);
      console.error("[geminiStream] Gemini error:", err);
      const msg = err.message?.includes("timed out")
        ? "Request timed out — please try again"
        : "Gemini streaming failed";
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    } finally {
      clearInterval(heartbeat);
      res.end();
      // SRV-PROMPT-19 — the same call record `robustGenerate` logs for the
      // non-streaming endpoint, so the two transports are comparable in logs:
      // duration, the model that served, whether the SI came from the cache,
      // and the tokens (thoughts included).
      console.info("[geminiStreamV2] gemini-call:complete", {
        category: streamCategory,
        totalDurationMs: Date.now() - streamStart,
        model: streamModelUsed,
        explicitCache: streamCall.cached,
        tokens: streamTokens ?? null,
        ...(streamError ? { error: streamError.slice(0, 200) } : {}),
      });
    }
  }
);
