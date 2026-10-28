/**
 * LIFE-EX-8: type-to-fill — a fill-blank question the player TYPES instead of
 * picking a chip (production practice, not recognition). It is a CLIENT-side
 * rendering variant of a normal fill-blank (LIFE-EX-1): the graded generator
 * still authors the chips (which identify the answer); the UI just swaps the
 * chip grid for a text input at intermediate+ levels and grades the typed
 * string against the correct chip.
 */

/** Synthetic choice id used for the player's typed answer (it is not one of
 *  the generated chips). */
export const TYPED_ANSWER_ID = '__typed__';

/** Whether a graded question should render as type-to-fill (a text input)
 *  rather than a chip grid. Fill-blank ONLY — comprehension always stays
 *  chips (you can't "type" an interpretation) — and only at level
 *  `>= TYPE_FILL_MIN_LEVEL`: typing is production, harder than recognition, so
 *  beginners keep the multiple-choice scaffold. */
export const TYPE_FILL_MIN_LEVEL = 4;

export function shouldTypeFill(
  kind: string,
  difficulty: number | null | undefined,
): boolean {
  return kind === 'generation' && (difficulty ?? 2) >= TYPE_FILL_MIN_LEVEL;
}

/** Normalise a typed answer for comparison: trim, collapse internal
 *  whitespace, lowercase, and strip surrounding punctuation / quotes.
 *  Accents are KEPT — they're part of the target and pedagogically load-
 *  bearing ("ou" ≠ "où"). */
export function normalizeTypedAnswer(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[-¿¡"'«»“”().,!?;:…]+/u, '')
    .replace(/[-"'«»“”().,!?;:…]+$/u, '')
    .trim();
}

/** True when the typed answer matches the expected target (both normalised,
 *  and non-empty).
 *
 *  ACCENT-SENSITIVE on purpose (ou ≠ où) — accents ARE the lesson for a
 *  language learner, so unlike practice mode's `gradeAnswer` (Levenshtein,
 *  accent-insensitive) this keeps them. The independent analysis flagged that
 *  the exact match "books a full SM-2 lapse on a near-miss typo", but flashcard
 *  threading + SRS credit from the story were removed (§10.47), so there is no
 *  lapse to soften — a miss here only shows "wrong" feedback, which for a typed
 *  production answer is honest. Left exact rather than trading away accent
 *  sensitivity for a harm that no longer exists. */
export function typedAnswerCorrect(typed: string, expected: string): boolean {
  const t = normalizeTypedAnswer(typed);
  return t.length > 0 && t === normalizeTypedAnswer(expected);
}
