/**
 * Cheap token estimator for client-side context-budget decisions
 * (LIFE-COMPACT-1).
 *
 * Uses the well-worn "~4 characters per token" heuristic — accurate
 * to within ~10-20% for English / Romance languages, which is well
 * within the noise margin we care about when deciding whether to
 * fire compaction. We are NOT trying to predict billable usage to
 * the dollar; we're trying to decide whether the assembled prompt
 * is approaching the model's context window.
 *
 * If we ever need a tighter estimate (e.g. for cost reporting) we
 * can swap in a real tokenizer (gpt-tokenizer or @gemini-cli/core).
 * For triggering compaction the heuristic is sufficient.
 */

/** Average bytes-per-token across natural language. Tweakable
 *  constant rather than a magic literal so it's easy to retune if
 *  we measure drift. */
const CHARS_PER_TOKEN = 4;

/** Estimate token count for an arbitrary string. Returns 0 for empty
 *  / nullish input so callers can sum without guards. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Math.ceil keeps the estimate from rounding short strings down to
  // zero — a 3-char string is still "1 token" from the budget's
  // perspective.
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
