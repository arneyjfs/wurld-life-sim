import { describe, expect, it } from 'vitest';
import {
  DAY_KEY_WORD_CAP,
  deriveDayWords,
  deriveKeyWords,
  derivePractisedWords,
  timestampSeconds,
} from './vocabRecap';
import type { LifeEvent } from '@/types/firestore';

const at = (seconds: number) =>
  ({ seconds, nanoseconds: 0 }) as LifeEvent['createdAt'];

const beat = (
  complexWords: string[],
  wordTranslations: Record<string, string>,
  seconds: number,
): LifeEvent =>
  ({
    id: `b-${seconds}-${complexWords.join('')}`,
    kind: 'beat',
    payload: { speaker: 'npc', practiceText: complexWords.join(' '), complexWords, wordTranslations },
    createdAt: at(seconds),
  }) as LifeEvent;

const correction = (
  correctAnswer: string,
  correct: boolean,
  seconds: number,
): LifeEvent => ({
  id: `c-${correctAnswer}-${seconds}`,
  kind: 'correction',
  payload: {
    kind: 'generation',
    correct,
    picked: correct ? correctAnswer : 'autre',
    correctAnswer,
    promptSource: `… ${correctAnswer} …`,
  },
  createdAt: at(seconds),
});

const flashcard = (
  practice: string,
  native: string,
  seconds: number,
): LifeEvent => ({
  id: `f-${practice}-${seconds}`,
  kind: 'flashcard_added',
  payload: { id: `card-${practice}`, practice, native },
  createdAt: at(seconds),
});

describe('derivePractisedWords — LIFE-VOCAB-RECAP-1', () => {
  it('LIFE-VOCAB-RECAP-1 — corrections in the window contribute correctAnswer + outcome', () => {
    const words = derivePractisedWords(
      [correction('voudrais', false, 150), correction('le marché', true, 200)],
      100,
    );
    expect(words).toEqual([
      { text: 'voudrais', translation: null, correct: false },
      { text: 'le marché', translation: null, correct: true },
    ]);
  });

  it('LIFE-VOCAB-RECAP-1 — events before sinceSeconds are excluded', () => {
    const words = derivePractisedWords(
      [correction('avant', true, 50), flashcard('aussi avant', 'also before', 99)],
      100,
    );
    expect(words).toEqual([]);
  });

  it('LIFE-VOCAB-RECAP-1 — flashcard_added contributes practice text + native gloss', () => {
    const words = derivePractisedWords(
      [flashcard('la boulangerie', 'the bakery', 150)],
      100,
    );
    expect(words).toEqual([
      { text: 'la boulangerie', translation: 'the bakery', correct: null },
    ]);
  });

  it('LIFE-VOCAB-RECAP-1 — dedupes case-insensitively; latest correction wins; flashcard fills translation', () => {
    const words = derivePractisedWords(
      [
        correction('Quand même', false, 110),
        flashcard('quand même', 'even so', 120),
        correction('quand même', true, 130),
      ],
      100,
    );
    expect(words).toEqual([
      { text: 'Quand même', translation: 'even so', correct: true },
    ]);
  });

  it('LIFE-VOCAB-RECAP-1 — empty or missing payload text is skipped', () => {
    const events: LifeEvent[] = [
      { id: 'e1', kind: 'correction', payload: { correct: true }, createdAt: at(150) },
      {
        id: 'e2',
        kind: 'correction',
        payload: { correct: true, correctAnswer: '   ' },
        createdAt: at(150),
      },
      {
        id: 'e3',
        kind: 'flashcard_added',
        payload: { native: 'no practice text' },
        createdAt: at(150),
      },
    ];
    expect(derivePractisedWords(events, 100)).toEqual([]);
  });

  it('LIFE-VOCAB-RECAP-1 — non-practice event kinds are ignored', () => {
    const events: LifeEvent[] = [
      { id: 'b1', kind: 'beat', payload: { practiceText: 'Salut' }, createdAt: at(150) },
      { id: 'd1', kind: 'decision', payload: { text: 'partir' }, createdAt: at(150) },
      correction('voudrais', true, 150),
    ];
    expect(derivePractisedWords(events, 100)).toHaveLength(1);
  });

  it('LIFE-VOCAB-RECAP-1 — missing createdAt counts as seconds 0 (excluded by a positive window)', () => {
    const noTs: LifeEvent = {
      id: 'n1',
      kind: 'correction',
      payload: { correct: true, correctAnswer: 'sans date' },
    };
    expect(derivePractisedWords([noTs], 1)).toEqual([]);
    expect(derivePractisedWords([noTs], 0)).toHaveLength(1);
  });
});

describe('timestampSeconds — LIFE-VOCAB-RECAP-1', () => {
  it('LIFE-VOCAB-RECAP-1 — reads .seconds; 0 on null/undefined', () => {
    expect(timestampSeconds({ seconds: 42 })).toBe(42);
    expect(timestampSeconds(null)).toBe(0);
    expect(timestampSeconds(undefined)).toBe(0);
  });
});

describe('deriveKeyWords — LIFE-VOCAB-RECAP-3', () => {
  it('LIFE-VOCAB-RECAP-3 — harvests beat vocab, frequency-ranked, gloss-carrying', () => {
    const key = deriveKeyWords(
      [
        beat(['sac', 'chien'], { sac: 'bag', chien: 'dog' }, 100),
        beat(['sac', 'pain'], { sac: 'bag', pain: 'bread' }, 110),
        beat(['sac'], { sac: 'bag' }, 120),
      ],
      50,
    );
    // 'sac' appears 3× → ranked first; each carries its gloss.
    expect(key[0]).toEqual({ text: 'sac', translation: 'bag', correct: null });
    expect(key.map((w) => w.text)).toEqual(['sac', 'chien', 'pain']);
  });

  it('LIFE-VOCAB-RECAP-3 — excludes beats before the window + non-beat events', () => {
    const key = deriveKeyWords(
      [
        beat(['vieux'], { vieux: 'old' }, 10), // before window
        beat(['neuf'], { neuf: 'new' }, 200),
        correction('autre', true, 200), // not a beat
      ],
      100,
    );
    expect(key.map((w) => w.text)).toEqual(['neuf']);
  });
});

/**
 * LIFE-VOCAB-RECAP-5 — the list under "Words you practised" holds words.
 *
 * `correction` events carry `correctAnswer`, which for a fill-blank is a word
 * and for word-order or comprehension is the whole sentence. Both were landing
 * in one list under a heading that describes only the first.
 */
describe('LIFE-VOCAB-RECAP-5 — vocabulary, not whole lines', () => {
  const ev = (answer: string, correct = true) =>
    ({
      kind: 'correction',
      createdAt: { seconds: 100 },
      payload: { correct, correctAnswer: answer },
    }) as unknown as LifeEvent;

  it('keeps single words and real multi-word vocabulary', () => {
    const out = derivePractisedWords(
      [ev('difficultés'), ev('junto al río'), ev('por la tarde')],
      0,
    );
    expect(out.map((w) => w.text)).toEqual([
      'difficultés',
      'junto al río',
      'por la tarde',
    ]);
  });

  it('drops a whole sentence', () => {
    const out = derivePractisedWords(
      [ev('Je rencontre souvent des difficultés avec la grammaire.')],
      0,
    );
    expect(out).toEqual([]);
  });

  it('drops a SHORT sentence too — length alone is not the tell', () => {
    // Four words, so the word count passes; the full stop is what identifies
    // it as a line the sentence exercises produced.
    expect(derivePractisedWords([ev('Je ne sais pas.')], 0)).toEqual([]);
  });

  it('is not fooled by an apostrophe or accents inside a phrase', () => {
    const out = derivePractisedWords([ev("l'agitation des passants")], 0);
    expect(out.map((w) => w.text)).toEqual(["l'agitation des passants"]);
  });
});

/**
 * LIFE-VOCAB-RECAP-6 — the day's list is fed by the whole DAY.
 *
 * `LIFE-VOCAB-RECAP-5` closed the sentences half of the trade-off; this closes
 * the other half. A day with two graded questions was a two-row list, with all
 * the vocabulary the player actually READ nowhere on the screen.
 */
describe('deriveDayWords — LIFE-VOCAB-RECAP-6', () => {
  it('appends the day’s story vocabulary after the graded words', () => {
    const events = [
      beat(['la boulangerie', 'quand même'], { 'la boulangerie': 'the bakery' }, 20),
      correction('voudrais', false, 30),
    ];
    const out = deriveDayWords(events, 0);
    expect(out.map((w) => w.text)).toEqual([
      'voudrais',
      'la boulangerie',
      'quand même',
    ]);
  });

  it('keeps the graded outcome when a word ALSO appears in the story', () => {
    // Graded first, and graded wins the dedupe: a word the player was tested
    // on must not be flattened to untested by a later story hit.
    const events = [
      correction('voudrais', false, 10),
      beat(['Voudrais'], {}, 20),
    ];
    const out = deriveDayWords(events, 0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: 'voudrais', correct: false });
  });

  it('marks story-only words as untested, not as wrong', () => {
    const out = deriveDayWords([beat(['le marché'], { 'le marché': 'the market' }, 10)], 0);
    expect(out[0]).toEqual({
      text: 'le marché',
      translation: 'the market',
      correct: null,
    });
  });

  it('honours the window start on BOTH halves', () => {
    const events = [
      beat(['avant'], {}, 10),
      correction('aussi', true, 20),
      beat(['après'], {}, 200),
      correction('depuis', true, 210),
    ];
    expect(deriveDayWords(events, 100).map((w) => w.text)).toEqual([
      'depuis',
      'après',
    ]);
  });

  it('caps the story contribution but not the graded one', () => {
    const words = Array.from({ length: DAY_KEY_WORD_CAP + 5 }, (_, i) => `mot${i}`);
    const events = [
      ...Array.from({ length: 20 }, (_, i) => correction(`quiz${i}`, true, 10 + i)),
      beat(words, {}, 50),
    ];
    const out = deriveDayWords(events, 0);
    expect(out.filter((w) => w.correct !== null)).toHaveLength(20);
    expect(out.filter((w) => w.correct === null)).toHaveLength(DAY_KEY_WORD_CAP);
  });

  it('still refuses whole lines from the story side', () => {
    // isVocabSized gates BOTH halves — widening the list must not reopen the
    // sentences LIFE-VOCAB-RECAP-5 closed.
    const out = deriveDayWords([beat(['Je ne sais pas du tout.'], {}, 10)], 0);
    expect(out).toEqual([]);
  });
});

/**
 * LIFE-VOCAB-RECAP-7 — a graded word carries its gloss.
 *
 * Every correction wrote `correctAnswer` and nothing else, so every graded row
 * had `translation: null` — and RECAP-4 gives no save button to a row with no
 * gloss. The word the player got WRONG was therefore the one row on the day
 * summary they could not keep.
 */
describe('derivePractisedWords — LIFE-VOCAB-RECAP-7', () => {
  const glossed = (
    correctAnswer: string,
    correctAnswerNative: string | null,
    seconds: number,
  ): LifeEvent => ({
    id: `g-${correctAnswer}-${seconds}`,
    kind: 'correction',
    payload: {
      kind: 'generation',
      correct: false,
      picked: 'autre',
      correctAnswer,
      correctAnswerNative,
      promptSource: `… ${correctAnswer} …`,
    },
    createdAt: at(seconds),
  });

  it('reads the gloss the correction event carries', () => {
    const out = derivePractisedWords([glossed('voudrais', 'would like', 10)], 0);
    expect(out).toEqual([
      { text: 'voudrais', translation: 'would like', correct: false },
    ]);
  });

  it('leaves the gloss null when the event has none (older events)', () => {
    // Not a backfill: a pre-2026-08-01 correction stays read-only rather than
    // acquiring an invented back.
    const out = derivePractisedWords([correction('tablier', false, 10)], 0);
    expect(out[0]!.translation).toBeNull();
  });

  it('does not let a blank gloss masquerade as one', () => {
    const out = derivePractisedWords([glossed('tablier', '   ', 10)], 0);
    expect(out[0]!.translation).toBeNull();
  });

  it('backfills the gloss onto an earlier unglossed attempt at the same word', () => {
    // Latest attempt wins for `correct`; the gloss is additive, so the row ends
    // up saveable even if the first attempt predated the field.
    const out = derivePractisedWords(
      [correction('voudrais', false, 10), glossed('voudrais', 'would like', 20)],
      0,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      text: 'voudrais',
      translation: 'would like',
      correct: false,
    });
  });
});
