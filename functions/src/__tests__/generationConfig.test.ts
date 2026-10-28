/**
 * MSG-ROBUST-5 / LIFE-COST-4 — the model-level vs request-level
 * `generationConfig` merge.
 *
 * The regression this guards: `@google/generative-ai` shallow-assigns a
 * request-level `generationConfig` OVER the model-level one, so every caller
 * that passed `responseMimeType` / `responseSchema` / `temperature` silently
 * threw away the `thinkingConfig` that `getGeminiModel()` had set. Measured
 * against real Gemini, the production call shape produced 0 thinking tokens
 * while the same call with thinking in the request produced 3,054 — i.e. the
 * app's entire thinking-level configuration was dead code.
 */
import { describe, expect, it } from "vitest";
import { buildGenerateRequest, mergeGenerationConfig } from "../generationConfig";

describe("mergeGenerationConfig (MSG-ROBUST-10)", () => {
  it("keeps the model's thinkingConfig when the request supplies its own config", () => {
    // THE BUG. This is the exact production shape: getGeminiModel sets
    // thinkingConfig, geminiGenerate passes responseMimeType + temperature.
    const merged = mergeGenerationConfig(
      { thinkingConfig: { thinkingLevel: "minimal", includeThoughts: true } },
      { responseMimeType: "application/json", temperature: 0.95 },
    );
    expect(merged).toEqual({
      thinkingConfig: { thinkingLevel: "minimal", includeThoughts: true },
      responseMimeType: "application/json",
      temperature: 0.95,
    });
  });

  it("lets a request-level thinkingConfig override the model's, key by key", () => {
    const merged = mergeGenerationConfig(
      { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } },
      { thinkingConfig: { thinkingLevel: "minimal" } },
    );
    // thinkingLevel overridden; includeThoughts preserved — a partial request
    // override must not silently drop the rest of the model's thinking setup.
    expect(merged!.thinkingConfig).toEqual({
      thinkingLevel: "minimal",
      includeThoughts: true,
    });
  });

  it("request-level scalars win over model-level ones", () => {
    const merged = mergeGenerationConfig(
      { temperature: 0.1, maxOutputTokens: 100 },
      { temperature: 0.9 },
    );
    expect(merged).toEqual({ temperature: 0.9, maxOutputTokens: 100 });
  });

  it("returns undefined when there is nothing to send", () => {
    // Callers use this to keep passing the bare prompt string — the SDK's
    // cheapest request shape. An empty object would change the request form
    // for every non-configured call in the app.
    expect(mergeGenerationConfig(undefined, undefined)).toBeUndefined();
    expect(mergeGenerationConfig({}, {})).toBeUndefined();
    expect(mergeGenerationConfig(null, null)).toBeUndefined();
  });

  it("passes either side through when the other is absent", () => {
    expect(mergeGenerationConfig({ thinkingConfig: { thinkingLevel: "low" } }, undefined))
      .toEqual({ thinkingConfig: { thinkingLevel: "low" } });
    expect(mergeGenerationConfig(undefined, { responseMimeType: "text/plain" }))
      .toEqual({ responseMimeType: "text/plain" });
  });

  it("does not treat a non-object thinkingConfig as mergeable", () => {
    // Defensive: a malformed value must not produce a spread of string indices.
    const merged = mergeGenerationConfig(
      { thinkingConfig: "high" as unknown as Record<string, unknown> },
      { responseMimeType: "application/json" },
    );
    expect(merged!.thinkingConfig).toBe("high");
  });

  it("does not mutate either input", () => {
    const model = { thinkingConfig: { thinkingLevel: "minimal" } };
    const request = { thinkingConfig: { includeThoughts: true } };
    mergeGenerationConfig(model, request);
    expect(model).toEqual({ thinkingConfig: { thinkingLevel: "minimal" } });
    expect(request).toEqual({ thinkingConfig: { includeThoughts: true } });
  });
});

/**
 * MSG-ROBUST-10 — the request is built FROM a model, so a fallback swap has to
 * rebuild it from the model that will actually serve the call.
 *
 * `robustGenerate` already recomputed the merge per attempt off `activeModel`.
 * `geminiStreamV2` built its request ONCE, before the try, and replayed that
 * same object against the fallback — which, per the SDK's shallow assign, means
 * the PRIMARY's `thinkingConfig` overwrote the fallback's own. Two failures in
 * one: the fallback's config became dead code, and a Gemini-3 `thinkingLevel`
 * was sent to `gemini-2.5-flash`, which rejects that field at "minimal"
 * (measured; recorded in `ExplainModal.tsx`). The path that exists to rescue a
 * degraded primary was the path that broke.
 *
 * ⚠ The 2.x half of that story is HISTORY as of 2026-09-19 — every 2.x model
 * answers 404 and the fallback is `gemini-3.6-flash` — but the shallow-assign
 * that caused it is unchanged, so these assertions are about the MECHANISM and
 * outlive the model ids in their fixtures.
 *
 * Extracting the shape into a helper is what makes that testable at all — the
 * alternative is mounting `geminiStreamV2`, which pulls in firebase-functions
 * and the whole pipeline graph.
 */
describe("buildGenerateRequest (MSG-ROBUST-10)", () => {
  const prompt = "hello";

  it("returns the BARE PROMPT when neither side configures anything", () => {
    // The SDK's cheapest request shape, and the only one where the model's own
    // generationConfig survives untouched. Sending `{contents, generationConfig: {}}`
    // instead would clobber it with an empty object.
    expect(buildGenerateRequest({}, undefined, prompt)).toBe(prompt);
    expect(buildGenerateRequest({ generationConfig: {} }, undefined, prompt)).toBe(prompt);
  });

  it("carries the model's thinkingConfig into the request alongside the request's own keys", () => {
    expect(
      buildGenerateRequest(
        { generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } } },
        { responseMimeType: "application/json" },
        prompt,
      ),
    ).toEqual({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        thinkingConfig: { thinkingLevel: "minimal" },
        responseMimeType: "application/json",
      },
    });
  });

  it("REBUILDS from the serving model, so one model's thinkingConfig never rides another's call", () => {
    // THE BUG, in the shape it was found. Primary was Gemini 3.x
    // (thinkingLevel); MODELS.fallback was gemini-2.5-flash (thinkingBudget),
    // and it REJECTED thinkingLevel:"minimal". Rebuilding is the whole fix:
    // same request-level config, new model config.
    //
    // ⚠ THE SCENARIO IS HISTORY; THE PROPERTY IS NOT. Every 2.x model has been
    // retired and the fallback is now `gemini-3.6-flash`, so no cross-family
    // replay is reachable today — but the SDK still shallow-assigns a request
    // config over the model's, so replaying a request built for one model
    // against another still silently drops the second one's config. The
    // fixture keeps the mixed knobs deliberately: they are the sharpest way to
    // SEE the substitution happen, not a claim that 2.x is live.
    const requestLevel = { responseMimeType: "application/json" };
    const primary = { generationConfig: { thinkingConfig: { thinkingLevel: "minimal" } } };
    const fallback = { generationConfig: { thinkingConfig: { thinkingBudget: 0, includeThoughts: true } } };

    const first = buildGenerateRequest(primary, requestLevel, prompt) as {
      generationConfig: { thinkingConfig: Record<string, unknown> };
    };
    expect(first.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });

    const retry = buildGenerateRequest(fallback, requestLevel, prompt) as {
      generationConfig: { thinkingConfig: Record<string, unknown> };
    };
    expect(retry.generationConfig.thinkingConfig).toEqual({
      thinkingBudget: 0,
      includeThoughts: true,
    });
    // The load-bearing assertion: no Gemini-3-only key survives onto the 2.x call.
    expect(retry.generationConfig.thinkingConfig).not.toHaveProperty("thinkingLevel");
    // ...and the request-level config the caller asked for is still there.
    expect(retry.generationConfig).toMatchObject(requestLevel);
  });

  it("tolerates a model with no generationConfig at all", () => {
    // `getGeminiModel` omits it when nothing about thinking was requested; the
    // SDK's own constructor then stores `{}`. Both shapes must behave the same.
    expect(buildGenerateRequest({}, { temperature: 0.5 }, prompt)).toEqual({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.5 },
    });
  });
});
