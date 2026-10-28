import type { PractisedWord } from './vocabRecap';

/**
 * LIFE-DAY-3 — turn a day's WRONG answers into a practice session.
 *
 * Practice mode's summary offers "Review N mistakes"; the wurld summary showed
 * you what you missed and then had nothing to do about it. The gap was never
 * data — `PractisedWord.correct` has been there all along — it was that the
 * screen was a dead end.
 *
 * Deliberately routes through the EXISTING `/cards/practice?intent=…` contract
 * rather than inventing a wurld-specific session type: the planner already
 * weights the prompt's USER INTENT block, and `PRACTICE-PLAN-38/39` is what
 * makes an intent-driven session actually build around the intent instead of
 * borrowing unrelated cards off the deck. A second session shape would have to
 * re-earn all of that.
 */

/** Words the player got WRONG. `correct === null` is ungraded (met in the story,
 *  never tested) and is NOT a mistake — quizzing it would be inventing a
 *  failure the player never had. */
export function missedWords(
  words: ReadonlyArray<PractisedWord>,
): PractisedWord[] {
  return words.filter((w) => w.correct === false);
}

/** Cap so the intent string stays a prompt rather than a corpus, and so the
 *  session length stays sane on a long chapter. */
export const MAX_MISSED_IN_QUIZ = 12;

/**
 * The `intent` query param — the player's words, near enough, in the voice the
 * planner already reads. Glosses are included when known because "tablier" on
 * its own is ambiguous to the planner in a way "tablier (apron)" is not.
 */
export function buildMissedIntent(
  words: ReadonlyArray<PractisedWord>,
  practiceLanguage?: string,
): string | null {
  const missed = missedWords(words).slice(0, MAX_MISSED_IN_QUIZ);
  if (missed.length === 0) return null;
  const list = missed
    .map((w) => (w.translation ? `${w.text} (${w.translation})` : w.text))
    .join(', ');
  const lang = practiceLanguage ? `${practiceLanguage} ` : '';
  return `Focus on the ${lang}words and phrases I got wrong in my story today: ${list}. Test these specifically.`;
}

/** The route a "practise what I missed" CTA navigates to, or null when there
 *  is nothing to practise. Count tracks the number of missed items so a
 *  two-mistake day is not padded out to a ten-question session. */
export function missedQuizHref(
  words: ReadonlyArray<PractisedWord>,
  practiceLanguage?: string,
  /**
   * LIFE-DAY-5 — where "Back" goes when this session ends.
   *
   * Practice defaults its exit to `/cards`, which is right when the player
   * came from the deck and wrong here: they came from a wurld, mid-story,
   * and finishing a quick drill dropped them into a screen they were not
   * using and left the world to be found again by hand. Carried in the URL
   * rather than in a store because practice is a full navigation — a store
   * would not survive a reload or a cold open of the link.
   */
  returnTo?: string,
): string | null {
  const intent = buildMissedIntent(words, practiceLanguage);
  if (!intent) return null;
  const count = Math.min(missedWords(words).length, MAX_MISSED_IN_QUIZ);
  const q = new URLSearchParams({ intent, count: String(count) });
  if (returnTo) q.set('from', returnTo);
  return `/cards/practice?${q.toString()}`;
}
