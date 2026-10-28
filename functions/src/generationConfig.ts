/**
 * MSG-ROBUST-10 / LIFE-COST-4: merge a model-level `generationConfig` with a
 * per-request one.
 *
 * WHY THIS EXISTS. `@google/generative-ai` builds its request as
 *
 *   Object.assign({ generationConfig: this.generationConfig, ... }, params)
 *
 * (`dist/index.js:1377`) — a SHALLOW assign, so a request that supplies its own
 * `generationConfig` REPLACES the model's wholesale. `getGeminiModel()` puts
 * `thinkingConfig` on the model, and every structured caller passes a request
 * config (`responseMimeType` / `responseSchema` / `temperature`). The result:
 * `thinkingLevel` and `includeThoughts` were silently discarded on essentially
 * every structured Gemini call in the app.
 *
 * Verified against real Gemini (2026-07-29), identical prompt, flash-lite:
 *
 *   model-level `high` + request generationConfig  → 0 thinking tokens
 *   model-level `high`, no request config          → 2,592 thinking tokens
 *   `thinkingConfig` inside the request config     → 3,054 thinking tokens
 *
 * So the models were running at their DEFAULT reasoning level, not the
 * requested one — `getMinimalThinking()`'s whole purpose ("thinking budget is
 * wasted spend on these tasks") never took effect, and the life-sim's
 * `thinkingLevel: 'high'` one-shots never got their extra reasoning either.
 *
 * Merge semantics: request-level keys win over model-level ones, EXCEPT that
 * `thinkingConfig` is merged key-by-key rather than replaced — it is the one
 * nested object we set in two places, and replacing it is the exact bug above.
 * Returns `undefined` when there is nothing to send, so callers can keep
 * passing the bare prompt (the SDK's cheapest request shape).
 */
export function mergeGenerationConfig(
  modelLevel: Record<string, unknown> | undefined | null,
  requestLevel: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined {
  const model = modelLevel ?? {};
  const request = requestLevel ?? {};
  if (Object.keys(model).length === 0 && Object.keys(request).length === 0) {
    return undefined;
  }

  const merged: Record<string, unknown> = { ...model, ...request };

  const modelThinking = asRecord(model.thinkingConfig);
  const requestThinking = asRecord(request.thinkingConfig);
  if (modelThinking || requestThinking) {
    merged.thinkingConfig = { ...(modelThinking ?? {}), ...(requestThinking ?? {}) };
  }

  return merged;
}

/**
 * MSG-ROBUST-10: build the wire request for `prompt` against a SPECIFIC model.
 *
 * The request is a function OF the model — so a fallback swap has to rebuild
 * it, not replay the one built for the primary. `robustGenerate` always did
 * this (it merges off `activeModel` inside the retry loop); `geminiStreamV2`
 * did not, and the consequences were not theoretical:
 *
 *  - the fallback model's own `thinkingConfig` became dead code, because the
 *    replayed request's config overwrote it (the SDK's shallow assign again);
 *  - the fallback was `gemini-2.5-flash` while the primaries were Gemini 3.x,
 *    and 2.5-flash REJECTED `thinkingLevel: "minimal"` (its knob was the
 *    numeric `thinkingBudget`). So the request built for a 3.x primary broke
 *    the very call that exists to rescue it. ⚠ That SECOND bullet is now
 *    history: every 2.x model was retired (404 on generateContent) and the
 *    fallback is `gemini-3.6-flash`, so there is no cross-family replay left to
 *    get wrong. The FIRST bullet is not history — a request config still
 *    overwrites the model's `thinkingConfig` wholesale, which is what this
 *    whole module exists for.
 *
 * Returning the BARE PROMPT when there is nothing to send is not a
 * micro-optimisation: it is the only request shape the SDK does not overwrite
 * the model's config with, so `{contents, generationConfig: {}}` would
 * reintroduce the bug for unconfigured callers.
 */
export function buildGenerateRequest(
  model: { generationConfig?: Record<string, unknown> },
  requestLevel: Record<string, unknown> | undefined | null,
  prompt: string,
): { contents: Array<{ role: string; parts: Array<{ text: string }> }>; generationConfig: Record<string, unknown> } | string {
  const merged = mergeGenerationConfig(model.generationConfig, requestLevel);
  if (!merged) return prompt;
  return { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: merged };
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}
