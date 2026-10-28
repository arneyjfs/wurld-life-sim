/**
 * PRACTICE-CACHE-1 — the placeholder tokens that make a prompt CACHEABLE.
 *
 * A Gemini explicit context cache is keyed on system-instruction BYTES. Any SI
 * that interpolates a language name therefore needs one cache per language
 * pair, and cache storage bills $1.00 per 1M tokens per HOUR whether or not the
 * pair is ever used. `serverPromptSpec.ts` did that arithmetic and stopped:
 * 7,140 possible pairs against a 5.78 calls/hour break-even on
 * `gemini-3.1-flash-lite`, which seven of the eight generator prompts cannot
 * clear. Its note says the fix is to restructure for cache-ability, and that
 * doing so "needs a language-fidelity eval first". This is that restructuring.
 *
 * Written against these tokens, each prompt has exactly ONE system instruction
 * for the whole population, and adding a language adds no caches at all.
 *
 * The token names are deliberately the SAME ones the analysis SI has used since
 * MSG-PIPE-15 and the convert SIs since MSG-PIPE-25. One vocabulary across every
 * prompt in the app: a reader who has seen `NATIVE` in one prompt reads it the
 * same way in the next, and so does the model.
 *
 * ⚠ A prompt written against tokens is INCOMPLETE on its own. The binding must
 * reach the model in the USER prompt (`practiceLanguageMapping`), which is the
 * dynamic, uncached half of the call. A prompt that is tokenised without its
 * mapping asks the model to translate into a language called "PRACTICE".
 */
export const LANG_TOKENS = {
  /** The language the learner is learning. */
  practice: "PRACTICE",
  /** The language the learner already speaks — all instructions and glosses. */
  native: "NATIVE",
} as const;

export const PRACTICE_TOKEN = LANG_TOKENS.practice;
export const NATIVE_TOKEN = LANG_TOKENS.native;

/**
 * Bind the tokens to this call's real languages, for the head of a user prompt.
 *
 * Emphatic, and in the same voice as the analysis mapping (MSG-PIPE-15) for the
 * same measured reason: a naive mapping regressed the analysis eval to 3
 * direction errors and the strengthened one recovered it. The abstraction has a
 * quality cost on lite models; this is what pays it back.
 */
export function practiceLanguageMapping(practice: string, native: string): string {
  return `LANGUAGE MAPPING — read the system instruction with these substitutions (apply to EVERY occurrence):
  ${PRACTICE_TOKEN} = ${practice}  → the language being learned. Every rule about ${PRACTICE_TOKEN} text, ${PRACTICE_TOKEN} options or a ${PRACTICE_TOKEN} phrase means ${practice}.
  ${NATIVE_TOKEN} = ${native}  → the language the learner already speaks. Every instruction, explanation and gloss you write is in ${native} — never in ${practice} unless the rule explicitly asks for ${PRACTICE_TOKEN} text.`;
}
