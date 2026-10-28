/**
 * LIFE-VOCAB-RECAP-1: pure derivation of the "Words you practised"
 * recap list shown on the scene / chapter completion screens.
 *
 * Zero LLM, zero extra Firestore reads — the input is the already-
 * loaded `useLifeEvents` window (chronological, oldest → newest).
 * `correction` events contribute the tested answer; `flashcard_added`
 * events contribute the saved phrase + its native gloss.
 *
 * Spec: docs/specs/life-sim.md §10.9 (LIFE-VOCAB-RECAP-*).
 */
import type { LifeEvent } from '@/types/firestore';

export type PractisedWord = {
  /** Practice-language word/phrase, as shown on the recap chip.
   *  Keeps the casing of its first occurrence in the window. */
  text: string;
  /** Native gloss when known (`flashcard_added` carries one;
   *  `correction` events don't). */
  translation: string | null;
  /** Latest graded outcome for this word inside the window; null when
   *  the word only appeared as a saved flashcard. */
  correct: boolean | null;
};

/** Seconds of a Firestore Timestamp-like value; 0 when absent. The 0
 *  fallback mirrors `snapshotSceneCompletion` — an event with no
 *  `createdAt` sorts before any positive window start. */
export function timestampSeconds(
  ts: { seconds: number } | null | undefined,
): number {
  return ts && typeof ts.seconds === 'number' ? ts.seconds : 0;
}


/**
 * LIFE-VOCAB-RECAP-5 — the recap is a VOCABULARY list, so it holds vocabulary.
 *
 * Reported 2026-08-01: the screen says "Words you practised" and shows whole
 * messages. Both halves are working as built — `correction` events carry
 * `correctAnswer`, and for a fill-blank that IS a word (`difficultés`) while
 * for word-order or comprehension it is the entire sentence. One list, two
 * kinds of thing, under a heading that only describes one of them.
 *
 * A sentence is not dropped from the player's RESULTS by this — the scene
 * stats already score every exercise type, and the missed-words quiz still
 * rebuilds from the graded outcomes. What it is dropped from is the list that
 * claims to be words.
 *
 * The threshold is deliberately generous: real vocabulary is routinely
 * multi-word ("junto al río", "por la tarde", separable verbs, fixed
 * expressions), so cutting at one token would throw away most of what the
 * player actually learned. Four is above every phrase the vocab pipeline
 * emits and below the shortest sentence the sentence exercises produce.
 */
export const MAX_RECAP_WORDS = 4;

/** True when `text` reads as vocabulary rather than as a whole line. */
export function isVocabSized(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > MAX_RECAP_WORDS) return false;
  // Sentence punctuation is the other tell: a short line can still be a line
  // ("Je ne sais pas." is four words), and terminal punctuation is what the
  // sentence exercises always carry and the vocab pipeline never does.
  return !/[.!?]$/.test(text.trim());
}

/**
 * Derive the practised-words list from the loaded event window.
 *
 * @param events chronological (oldest → newest) events — pass the
 *   `useLifeEvents` data array as-is.
 * @param sinceSeconds window start (e.g. `scene.acceptedAt.seconds`
 *   or `arc.startedAt.seconds`); events strictly before it are ignored.
 */
export function derivePractisedWords(
  events: ReadonlyArray<LifeEvent>,
  sinceSeconds: number,
): PractisedWord[] {
  const byKey = new Map<string, PractisedWord>();
  const out: PractisedWord[] = [];
  for (const e of events) {
    if (e.kind !== 'correction' && e.kind !== 'flashcard_added') continue;
    if (timestampSeconds(e.createdAt) < sinceSeconds) continue;
    const p = (e.payload ?? {}) as {
      correct?: boolean;
      correctAnswer?: string;
      /** LIFE-VOCAB-RECAP-7: the answer's gloss, resolved by `glossForAnswer`
       *  at the moment the outcome was built. Absent on events written before
       *  2026-08-01 — those rows stay read-only rather than inventing a back. */
      correctAnswerNative?: string | null;
      practice?: string;
      native?: string;
    };
    const raw = e.kind === 'correction' ? p.correctAnswer : p.practice;
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) continue;
    // LIFE-VOCAB-RECAP-5: keep the list honest to its own heading.
    if (!isVocabSized(text)) continue;
    const key = text.toLowerCase();
    const existing = byKey.get(key);
    if (e.kind === 'correction') {
      // LIFE-VOCAB-RECAP-7: without this the graded rows were the ONLY ones
      // with no gloss, and RECAP-4 withholds the save button from a glossless
      // row — so the word the player got wrong was the one they could not keep.
      const gloss =
        typeof p.correctAnswerNative === 'string'
          ? p.correctAnswerNative.trim()
          : '';
      if (existing) {
        // Latest attempt wins for the outcome; the gloss is ADDITIVE, so a
        // later glossed attempt makes an earlier unglossed row saveable.
        existing.correct = p.correct === true;
        if (!existing.translation && gloss) existing.translation = gloss;
      } else {
        const entry: PractisedWord = {
          text,
          translation: gloss || null,
          correct: p.correct === true,
        };
        byKey.set(key, entry);
        out.push(entry);
      }
    } else {
      const native = typeof p.native === 'string' ? p.native.trim() : '';
      if (existing) {
        if (!existing.translation && native) existing.translation = native;
      } else {
        const entry: PractisedWord = {
          text,
          translation: native || null,
          correct: null,
        };
        byKey.set(key, entry);
        out.push(entry);
      }
    }
  }
  return out;
}

/**
 * LIFE-VOCAB-RECAP-3: the chapter's KEY WORDS — the vocabulary the player
 * actually READ across the chapter's beats, FREQUENCY-RANKED (a word the story
 * kept returning to is a key word). Distinct from `derivePractisedWords`
 * (tested + saved words): this surfaces the STORY's own recurring vocabulary,
 * harvested from beat `complexWords`/`wordTranslations`. Zero LLM, zero reads.
 */
export function deriveKeyWords(
  events: ReadonlyArray<LifeEvent>,
  sinceSeconds: number,
  cap = 12,
): PractisedWord[] {
  const byKey = new Map<
    string,
    { text: string; translation: string | null; count: number }
  >();
  for (const e of events) {
    if (e.kind !== 'beat') continue;
    if (timestampSeconds(e.createdAt) < sinceSeconds) continue;
    const p = (e.payload ?? {}) as {
      complexWords?: string[];
      wordTranslations?: Record<string, string>;
    };
    const glosses = p.wordTranslations ?? {};
    for (const raw of p.complexWords ?? []) {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) continue;
      const key = text.toLowerCase();
      const gloss = (glosses[text] ?? glosses[key] ?? '').trim() || null;
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        if (!existing.translation && gloss) existing.translation = gloss;
      } else {
        byKey.set(key, { text, translation: gloss, count: 1 });
      }
    }
  }
  return [...byKey.values()]
    // LIFE-VOCAB-RECAP-5 applies here too. `complexWords` comes off the vocab
    // segmentation pipeline, which emits words and phrases rather than lines,
    // so this is belt-and-braces — but it is the same list under the same
    // heading, and one rule beats two that agree today.
    .filter((v) => isVocabSized(v.text))
    .sort((a, b) => b.count - a.count)
    .slice(0, cap)
    .map((v) => ({ text: v.text, translation: v.translation, correct: null }));
}

/** LIFE-VOCAB-RECAP-6: how many STORY words a day may contribute. The
 *  chapter's number — a day is the smaller window, so if 12 does not swamp a
 *  chapter it will not swamp a day. The GRADED half is uncapped: it is already
 *  bounded by how many questions the day asked, and `LIFE-VOCAB-RECAP-4`
 *  removed caps from what the list renders. */
export const DAY_KEY_WORD_CAP = 12;

/**
 * LIFE-VOCAB-RECAP-6 — the day-completion list, fed by the whole day.
 *
 * `derivePractisedWords` alone makes the list a function of how many questions
 * the day happened to ask: two graded turns, two rows, and everything the
 * player READ is missing. `deriveKeyWords` already harvests exactly that from
 * the beat payloads at zero cost (no LLM, no extra reads), so the day runs it
 * over its own window and appends what is new.
 *
 * ONE list rather than a second section: it already holds untested items (a
 * flashcard saved mid-day carries `correct: null`), so story words are the
 * same kind of thing it was showing — and a second section here would rebuild
 * the duplication `LIFE-DAY-2` took off the chapter screen.
 *
 * Graded words come FIRST and win the dedupe, so a word the player was tested
 * on keeps its ✓/✗ instead of being flattened to untested by a later story
 * mention.
 */
export function deriveDayWords(
  events: ReadonlyArray<LifeEvent>,
  sinceSeconds: number,
  cap = DAY_KEY_WORD_CAP,
): PractisedWord[] {
  const graded = derivePractisedWords(events, sinceSeconds);
  const seen = new Set(graded.map((w) => w.text.trim().toLowerCase()));
  const story = deriveKeyWords(events, sinceSeconds, cap).filter(
    (w) => !seen.has(w.text.trim().toLowerCase()),
  );
  return [...graded, ...story];
}
