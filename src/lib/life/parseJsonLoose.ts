/**
 * LIFE-FAIL-11: parse a model's JSON response even when it trails prose.
 *
 * THE BUG THIS EXISTS FOR. Measured 2026-08-03 while probing the saga
 * generator: 2 of 6 real `life_world_saga` responses failed
 * `JSON.parse` with *"Unexpected non-whitespace character AFTER JSON"* —
 * a COMPLETE, valid object followed by something else. The object was
 * fine; only the tail was junk.
 *
 * What that costs is out of all proportion to the defect. `runWorldSagaGenerate`
 * retries a THROWN call but NOT a parse failure — a null parse goes straight to
 * `trivialSaga`, so the player silently gets the placeholder world instead of
 * the saga the model actually wrote. That is the same user-visible failure
 * `LIFE-WORLD-SAGA-9` was written for ("every realistic wurld was called 'A
 * Life'"), reached by a different route. The saga is generated ONCE per world
 * and is the input to every chapter, scene and turn after it, so losing one is
 * the most expensive parse failure in the app.
 *
 * WHY NOT JUST RETRY. A retry costs a second full generation (the saga is the
 * priciest call in the sim, on flash-preview with a ~5.5k-token response) to
 * re-obtain an object we are already holding. Salvage first; the retry ladder
 * stays for responses that are genuinely broken.
 *
 * WHY A BRACKET SCANNER AND NOT A REGEX. A regex cannot match balanced
 * delimiters, and the saga body is full of braces inside strings (`"{...}"` in
 * example prose) and of escaped quotes. The scanner tracks string state and
 * escapes, so it stops at the object's real end rather than at the first `}`.
 *
 * DELIBERATELY NOT LENIENT ABOUT ANYTHING ELSE. No trailing-comma repair, no
 * single-quote coercion, no comment stripping. Those change what the model
 * said; this only ignores what it appended after it had finished saying it.
 */

/** Strip a leading ```json / ``` fence and its closing counterpart. */
export function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  lines.shift();
  if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
  return lines.join('\n').trim();
}

/**
 * The substring from the first `{` (or `[`) to its MATCHING close, or null when
 * there is no balanced top-level value. String contents and `\`-escapes are
 * tracked, so braces inside strings do not close the object early.
 */
export function extractFirstJsonValue(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // never closed — genuinely truncated, not merely trailing junk
}

/**
 * Parse a model response, tolerating a fence and any trailing content.
 *
 * Returns `undefined` (not null) when nothing usable is present, so a model
 * that legitimately returned `null` is still distinguishable from a failure.
 */
export function parseJsonLoose(raw: string): unknown {
  const text = stripFences(raw);
  try {
    return JSON.parse(text);
  } catch {
    // Fall through to salvage.
  }
  const sliced = extractFirstJsonValue(text);
  if (sliced === null) return undefined;
  try {
    return JSON.parse(sliced);
  } catch {
    return undefined;
  }
}
