/**
 * LIFE-LANG-19 — the correct answer's gloss is always GENERATED, and only ever
 * withheld from the tappable chips.
 *
 * Reported 2026-07-31: "the 'it means' shows the practice word without native
 * on some question types."
 *
 * The cause is a deliberate rule doing more than intended. A fill-blank chip
 * MUST carry `nativeText: ""` — the gradedQuestion prompt calls the empty
 * string mandatory, because a gloss on a tappable chip telegraphs the answer.
 * `LIFE-LANG-17` then suppressed the "It means:" label rather than print
 * "It means: voudrais", a word asserting it means itself.
 *
 * Both are right, and together they lost something real: after answering, the
 * learner should see what the word they just practised MEANS. Withholding it
 * from the chip is the requirement; withholding it from the FEEDBACK never was.
 *
 * No new field and no new generation requirement: `practicePrompt.lineVocab`
 * (`LIFE-EX-VOCAB-3`) is already required on both graded kinds, and for
 * fill-blank it segments the COMPLETED sentence — the one with the blank filled
 * in — so the answer token is already in there. It just was not being read.
 */

/**
 * The gloss for `answer` from a line's vocab map.
 *
 * Two passes, because segmentation chunks by MEANING, not by the blank: the
 * answer "tend" can legitimately live inside the entry "te tend", and an exact
 * lookup alone would miss it and fall back to nothing.
 */
export function glossForAnswer(
  lineVocab: Record<string, string> | null | undefined,
  answer: string,
): string | null {
  const target = answer.trim();
  if (!lineVocab || !target) return null;

  // 1. Exact surface form — the common case, and unambiguous.
  const exact = lineVocab[target];
  if (exact?.trim()) return exact.trim();

  const lower = target.toLowerCase();
  for (const [k, v] of Object.entries(lineVocab)) {
    if (k.toLowerCase() === lower && v.trim()) return v.trim();
  }

  // 2. The chunk that CONTAINS the answer. Word-boundary matched so "tend"
  //    does not match "attendre", and shortest-first so the answer picks up
  //    the tightest chunk that covers it rather than a whole clause.
  const containing = Object.entries(lineVocab)
    .filter(([k, v]) => v.trim() && containsWord(k, lower))
    .sort((a, b) => a[0].length - b[0].length)[0];
  return containing ? containing[1].trim() : null;
}

function containsWord(chunk: string, lowerWord: string): boolean {
  const parts = chunk.toLowerCase().split(/[^\p{L}\p{N}'’-]+/u);
  return parts.includes(lowerWord);
}
