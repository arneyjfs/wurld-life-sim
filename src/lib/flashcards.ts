import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import type { FlashCard } from '@/types/firestore';
import * as log from './log';
// BOOT-SPLIT-4 — static. `topics` imports `isCardCancelled` from here, but both
// sides use the other only inside functions, so the ESM cycle is harmless; the
// old dynamic import split nothing (topics is statically imported elsewhere).
import { computeAndAssignTopic } from './topics';

const CURRENT_CARD_SCHEMA_VERSION = 2;

/**
 * In-memory cancellation registry for in-flight topic classification.
 *
 * Why this exists:
 *   `addFlashCard` writes the card doc first and kicks off topic
 *   classification asynchronously. The user may toggle the same save
 *   button off (calling `deleteFlashcard`) before classification
 *   resolves. We need the late `updateDoc(topic)` to drop silently
 *   instead of resurrecting the deleted doc or throwing a
 *   not-found error.
 *
 * Keyed by cardId. `addFlashCard` registers `false` on save; topic
 * classifier checks the flag before its final write; `deleteFlashcard`
 * flips it to `true` and removes the entry. The classifier ALSO
 * does a `doc.exists()` guard via the underlying Firestore SDK
 * (updateDoc on a missing doc rejects); the in-memory flag is the
 * fast path so we don't even attempt the write.
 */
const cancelledCards = new Set<string>();

/** @internal — exposed for unit tests only. */
export function _cancelCardForTest(cardId: string): void {
  cancelledCards.add(cardId);
}
/** @internal — exposed for unit tests only. */
export function _isCardCancelled(cardId: string): boolean {
  return cancelledCards.has(cardId);
}
/** @internal — exposed for unit tests only. */
export function _resetCancelledCards(): void {
  cancelledCards.clear();
}

export type ReviewQuality = 'again' | 'hard' | 'good' | 'easy';

/**
 * Simplified SM-2 (SuperMemo 2) implementation. Given a card and a review
 * quality, returns the updated SRS fields. The actual Firestore write
 * happens in applyReview().
 *
 * 'again': fail. Reset to interval 1, ease floored at 1.3.
 * 'hard':  passed but hard. interval * 1.2, ease -= 0.15
 * 'good':  default pass. interval = interval * ease, ease unchanged
 * 'easy':  passed easily. interval = interval * ease * 1.3, ease += 0.15
 */
export function computeNext(card: Pick<FlashCard, 'interval' | 'ease' | 'reps' | 'lapses'>, quality: ReviewQuality) {
  const ease = card.ease ?? 2.5;
  const interval = card.interval ?? 1;
  const reps = card.reps ?? 0;
  const lapses = card.lapses ?? 0;
  let nextInterval: number;
  let nextEase: number;
  let nextReps: number;
  let nextLapses: number;
  switch (quality) {
    case 'again':
      nextInterval = 1;
      nextEase = Math.max(1.3, ease - 0.2);
      nextReps = 0;
      nextLapses = lapses + 1;
      break;
    case 'hard':
      nextInterval = Math.max(1, Math.round(interval * 1.2));
      nextEase = Math.max(1.3, ease - 0.15);
      nextReps = reps + 1;
      nextLapses = lapses;
      break;
    case 'good':
      nextInterval = Math.max(1, Math.round(interval * ease));
      nextEase = ease;
      nextReps = reps + 1;
      nextLapses = lapses;
      break;
    case 'easy':
      nextInterval = Math.max(1, Math.round(interval * ease * 1.3));
      nextEase = ease + 0.15;
      nextReps = reps + 1;
      nextLapses = lapses;
      break;
  }
  const nextReviewMs = Date.now() + nextInterval * 24 * 60 * 60 * 1000;
  return {
    interval: nextInterval,
    ease: nextEase,
    reps: nextReps,
    lapses: nextLapses,
    nextReviewAt: Timestamp.fromMillis(nextReviewMs),
  };
}

/**
 * Per-question attempt write. Updates the legacy counter
 * (`correctCount` / `incorrectCount`) AND the SM-2 fields
 * (`interval`, `ease`, `reps`, `lapses`, `nextReviewAt`) in a single
 * `updateDoc`. Source-style counter logging stays for back-compat
 * dashboards, but the SM-2 stamps are what the planner consumes
 * via `computeDueCards` + the `dueCards` learner-context field
 * (see PRACTICE-SRS-* and PRACTICE-PLAN-20 in docs/specs/practice-mode.md).
 *
 * Grade mapping (PRACTICE-SRS-2):
 *   - correct + reviewMode=true     → 'hard' (recently-failed card just
 *                                    got right; schedule shorter than
 *                                    a fresh good)
 *   - correct + nearMiss            → 'hard' (fuzzy-graded pass with
 *                                    drift; treat as struggling)
 *   - correct (default)             → 'good'
 *   - !correct                      → 'again'
 *
 * Skipped questions DO NOT call recordAttempt — the screen-level
 * skip path writes nothing.
 *
 * Sentinel cardIds ('matching' / 'generated') must not reach this
 * function — the caller filters them out (PRACTICE-SRS-5).
 */
export async function recordAttempt({
  uid,
  cardId,
  correct,
  nearMiss = false,
  reviewMode = false,
  card,
}: {
  uid: string;
  cardId: string;
  correct: boolean;
  nearMiss?: boolean;
  reviewMode?: boolean;
  /** Current SM-2 state of the card. Fresh defaults applied when omitted. */
  card?: Pick<
    FlashCard,
    | 'interval'
    | 'ease'
    | 'reps'
    | 'lapses'
    | 'consecutiveCorrectDays'
    | 'lastReviewedAt'
  >;
}): Promise<void> {
  const quality: ReviewQuality = correct
    ? reviewMode || nearMiss
      ? 'hard'
      : 'good'
    : 'again';
  const next = computeNext(card ?? {}, quality);

  // CARDS-ARCHIVE-2/3: maintain the auto-archive streak. Distinct days
  // where the card was answered correctly without any wrong answer
  // breaking the streak — once it hits AUTO_ARCHIVE_STREAK_DAYS the
  // card is auto-archived and skipped from future practice sessions
  // until the user explicitly asks for archived-card review.
  //
  // Wrong answers reset the streak to 0 (and reactivate an archived
  // card so it cycles back through practice — the user evidently
  // still needs work on it).
  //
  // Reads `lastReviewedAt` to compute "distinct day" — if today's
  // calendar day is the same as the last review, the streak doesn't
  // tick up (multiple correct answers in one session don't count for
  // more than one).
  const archiveExtras = computeArchiveStateChange({
    correct,
    prevStreak: card?.consecutiveCorrectDays ?? 0,
    prevLastReviewedMs: card?.lastReviewedAt?.toMillis() ?? null,
    nowMs: Date.now(),
  });

  await updateDoc(doc(db, 'users', uid, 'flashcards', cardId), {
    [correct ? 'correctCount' : 'incorrectCount']: increment(1),
    interval: next.interval,
    ease: next.ease,
    reps: next.reps,
    lapses: next.lapses,
    nextReviewAt: next.nextReviewAt,
    lastReviewedAt: serverTimestamp(),
    ...archiveExtras,
  });
}

/** CARDS-ARCHIVE-2: distinct-day correct-streak threshold for auto-
 *  archive. Five days means a card has been seen and answered
 *  correctly across at least a working week's worth of spaced
 *  encounters — high enough to read as "learnt", low enough to keep
 *  the deck moving for active users. */
export const AUTO_ARCHIVE_STREAK_DAYS = 5;

/** Pure helper for testability. Returns the partial-update fields
 *  that go on the flashcard doc for the archive state. */
export function computeArchiveStateChange(input: {
  correct: boolean;
  prevStreak: number;
  prevLastReviewedMs: number | null;
  nowMs: number;
}): {
  consecutiveCorrectDays: number;
  cardStatus?: 'active' | 'archived';
  archivedAt?: ReturnType<typeof serverTimestamp>;
} {
  // Wrong answer → reset streak + reactivate (no archivedAt write —
  // we leave the historical archivedAt for analytics; cardStatus flips
  // back to 'active' since they need more practice).
  if (!input.correct) {
    return {
      consecutiveCorrectDays: 0,
      cardStatus: 'active',
    };
  }
  // Correct + same calendar day as last attempt → streak stays put.
  // Multiple correct answers in one session count for ONE day only.
  const sameDay =
    input.prevLastReviewedMs !== null &&
    sameLocalCalendarDay(input.prevLastReviewedMs, input.nowMs);
  if (sameDay) {
    return { consecutiveCorrectDays: input.prevStreak };
  }
  // Correct + new day → streak ticks up. Hit the threshold → archive.
  const nextStreak = input.prevStreak + 1;
  if (nextStreak >= AUTO_ARCHIVE_STREAK_DAYS) {
    return {
      consecutiveCorrectDays: nextStreak,
      cardStatus: 'archived',
      archivedAt: serverTimestamp(),
    };
  }
  return { consecutiveCorrectDays: nextStreak };
}

function sameLocalCalendarDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** CARDS-ARCHIVE-4: manual toggle. Flipping to 'archived' resets the
 *  streak (the user is asserting "I know this") and stamps archivedAt
 *  for display. Flipping back to 'active' clears archivedAt. */
export async function setCardArchiveStatus({
  uid,
  cardId,
  archived,
}: {
  uid: string;
  cardId: string;
  archived: boolean;
}): Promise<void> {
  await updateDoc(doc(db, 'users', uid, 'flashcards', cardId), {
    cardStatus: archived ? 'archived' : 'active',
    archivedAt: archived ? serverTimestamp() : null,
    consecutiveCorrectDays: archived ? AUTO_ARCHIVE_STREAK_DAYS : 0,
  });
}

/** CARDS-LIST-8: user-driven edit of phrase / translation / topic /
 *  practiceLanguage. The user's topic + language choices are
 *  authoritative — we mark the card cancelled for the topic-classifier
 *  so any in-flight Gemini classification can't later overwrite the
 *  explicit pick. */
export async function updateFlashcardDetails({
  uid,
  cardId,
  phrase,
  translation,
  topic,
  topicSubject,
  practiceLanguage,
}: {
  uid: string;
  cardId: string;
  phrase: string;
  translation: string;
  topic: string;
  /** TOPIC-SET-5: the classifier's subject, passed only when the topic came
   *  from a classify-on-blur in the editor. Omitted → the stored value is
   *  left as it was. */
  topicSubject?: string;
  practiceLanguage?: string;
}): Promise<void> {
  const cleanPhrase = phrase.trim();
  const cleanTranslation = translation.trim();
  if (!cleanPhrase || !cleanTranslation) {
    throw new Error('updateFlashcardDetails: phrase and translation are required');
  }
  cancelledCards.add(cardId);
  await updateDoc(doc(db, 'users', uid, 'flashcards', cardId), {
    phrase: cleanPhrase,
    translation: cleanTranslation,
    topic: topic.trim(),
    ...(topicSubject?.trim() ? { topicSubject: topicSubject.trim() } : {}),
    ...(practiceLanguage ? { practiceLanguage } : {}),
  });
  setTimeout(() => cancelledCards.delete(cardId), 120_000);
}

export async function deleteFlashcard({
  uid,
  cardId,
}: {
  uid: string;
  cardId: string;
}): Promise<void> {
  // Mark the card cancelled BEFORE the delete completes so any
  // concurrent topic-classify callback that hasn't yet reached its
  // final updateDoc bails out without touching the missing doc.
  cancelledCards.add(cardId);
  try {
    await deleteDoc(doc(db, 'users', uid, 'flashcards', cardId));
  } finally {
    // Keep the cancelled marker around long enough for the late
    // classify callback to see it, then drop it so the Set doesn't
    // leak across the user's session. Two minutes is comfortably
    // larger than the slowest Gemini call we've observed (~30s p99).
    setTimeout(() => cancelledCards.delete(cardId), 120_000);
  }
}

/**
 * Tells the topic-classify pipeline whether to skip its final
 * `updateDoc` for this card id. Used by `lib/topics.ts`; kept here so
 * the cancellation registry has a single owner.
 */
export function isCardCancelled(cardId: string): boolean {
  return cancelledCards.has(cardId);
}

export type NewFlashCardInput = {
  phrase: string;
  translation: string;
  practiceLanguage: string;
  nativeLanguage: string;
  /** Optional sentence-level context (e.g. the full message body). */
  context?: string;
  sourceMessageId?: string | null;
  sourceChatId?: string | null;
  tags?: string[];
  /** CARDS-LIST-8: when the caller already resolved the topic
   *  (e.g. the manual-add editor that classifies on blur), pass it
   *  here. The async classifier is skipped and the value lands on
   *  the doc directly. */
  topic?: string;
  /** TOPIC-SET-5: the classifier's subject for a pre-classified `topic`.
   *  Written only alongside a non-empty `topic`. */
  topicSubject?: string;
};

/**
 * Save a new flashcard for the given user. Dedupes silently against an
 * existing card with the same (practiceLanguage, phrase, translation) so
 * tapping "save" twice on the same word doesn't write a second doc. Returns
 * the card id (existing or new).
 *
 * The doc lands first (so the UI can flip to "saved" immediately) with
 * `topic: ''` as a placeholder. Topic classification is kicked off in
 * the background and writes the resolved topic via `updateDoc` when it
 * resolves. If the user toggles the save off before classification
 * returns, `deleteFlashcard` flips a cancellation flag and the late
 * classify write is silently dropped — see `cancelledCards` above and
 * `computeAndAssignTopic` in `./topics.ts`.
 *
 * Mirrors source services/flashCardService.ts:60. We keep
 * schemaVersion stamped so future migrations can identify pre-cutover docs.
 */
export async function addFlashCard(
  uid: string,
  input: NewFlashCardInput,
): Promise<string> {
  const phrase = input.phrase.trim();
  const translation = input.translation.trim();
  if (!phrase || !translation) {
    throw new Error('addFlashCard: phrase and translation are required');
  }
  const col = collection(db, 'users', uid, 'flashcards');
  try {
    const dupe = await getDocs(
      query(
        col,
        where('practiceLanguage', '==', input.practiceLanguage),
        where('phrase', '==', phrase),
        where('translation', '==', translation),
        limit(1),
      ),
    );
    if (!dupe.empty) return dupe.docs[0]!.id;
  } catch (err) {
    // Don't block the save on a dedup failure — it's belt-and-braces only.
    log.warn('addFlashCard dedup query failed', { err });
  }
  const explicitTopic = input.topic?.trim() ?? '';
  const ref = await addDoc(col, {
    phrase,
    translation,
    practiceLanguage: input.practiceLanguage,
    nativeLanguage: input.nativeLanguage,
    // When the caller pre-classified (manual-add editor), write the
    // resolved topic immediately. Otherwise an empty placeholder keeps
    // the field consistent with the Zod schema's `z.string().optional()`
    // while the async classifier runs.
    topic: explicitTopic,
    ...(explicitTopic && input.topicSubject?.trim()
      ? { topicSubject: input.topicSubject.trim() }
      : {}),
    ...(input.context ? { context: input.context } : {}),
    ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
    ...(input.sourceChatId ? { sourceChatId: input.sourceChatId } : {}),
    ...(input.tags && input.tags.length ? { tags: input.tags } : {}),
    userId: uid,
    createdAt: serverTimestamp(),
    correctCount: 0,
    incorrectCount: 0,
    schemaVersion: CURRENT_CARD_SCHEMA_VERSION,
  });
  if (explicitTopic) {
    // Pre-classified path — skip the async classifier entirely.
    return ref.id;
  }
  // Clear any stale cancellation marker (the same card id is brand new
  // — addDoc generates it server-side — so this is paranoia, not load-
  // bearing). Then fire-and-forget topic classification.
  cancelledCards.delete(ref.id);
  void Promise.resolve()
    .then(() =>
      computeAndAssignTopic({
        uid,
        cardId: ref.id,
        phrase,
        translation,
        practiceLanguage: input.practiceLanguage,
      }),
    )
    .catch((err) => log.warn('topic classify scheduling failed', { err }));
  return ref.id;
}
