/**
 * Pure helpers for the token-usage telemetry pipeline. Kept in a
 * separate module so vitest's `functions` project can unit-test them
 * without dragging in `index.ts` (which would pull
 * firebase-functions, sharp, and the whole pipeline graph — see the
 * note in vitest.config.ts).
 *
 * Spec: docs/specs/wurld-tutor.md — TUTOR-CTX-CACHE-3 (cache-hit
 * telemetry).
 */

/**
 * Normalise a Gemini model name for use as a Firestore field-path
 * segment. Model names like "gemini-3.1-flash-lite" contain dots
 * that the SDK would interpret as nested-map traversal; replace dots
 * with underscores so the key stays a flat literal segment.
 *
 * Stable + reversible: the client-side `denormalizeModelKey` (in
 * `src/screens/Admin/types.ts`) round-trips back to the display name
 * by undoing the same substitution.
 */
export function normalizeModelKeyForUsage(model: string): string {
  return model.replace(/\./g, "_");
}

/**
 * Parsed shape of a per-model usage field key like
 * `tutor_chat.byModel.gemini-3_1-flash-lite.cached`.
 *
 * Returns null for any key that doesn't match the prefix / shape —
 * the aggregation reader uses that as the "not a byModel field, skip"
 * signal.
 */
export type ParsedByModelKey = {
  category: string;
  model: string;
  metric: "in" | "out" | "count" | "cached";
};

/**
 * Parse a flat dotted field key written by `recordTokenUsage` when a
 * model was supplied. The expected shape is
 * `${category}.byModel.${normalisedModel}.${metric}` where:
 *
 *   - `category` may not contain `.byModel.` (we use lastIndexOf to
 *     identify the split, so a category like `tutor_chat` is fine).
 *   - `normalisedModel` may contain dashes / underscores but no dots
 *     (dots are stripped at write time by `normalizeModelKeyForUsage`).
 *   - `metric` is one of `in`, `out`, `count`, `cached`.
 *
 * Returns `null` for any key not matching this shape.
 */
export function parseByModelFieldKey(key: string): ParsedByModelKey | null {
  const MARKER = ".byModel.";
  const markerIdx = key.indexOf(MARKER);
  if (markerIdx < 0) return null;
  const category = key.slice(0, markerIdx);
  if (!category) return null;
  const rest = key.slice(markerIdx + MARKER.length);
  const dotIdx = rest.lastIndexOf(".");
  if (dotIdx < 0) return null;
  const model = rest.slice(0, dotIdx);
  const metric = rest.slice(dotIdx + 1);
  if (!model) return null;
  if (metric !== "in" && metric !== "out" && metric !== "count" && metric !== "cached") return null;
  return { category, model, metric };
}
