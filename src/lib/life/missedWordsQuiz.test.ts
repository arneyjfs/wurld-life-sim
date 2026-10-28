import { describe, expect, it } from 'vitest';
import {
  MAX_MISSED_IN_QUIZ,
  buildMissedIntent,
  missedQuizHref,
  missedWords,
} from './missedWordsQuiz';
import type { PractisedWord } from './vocabRecap';

const w = (
  text: string,
  correct: boolean | null,
  translation: string | null = null,
): PractisedWord => ({ text, translation, correct });

describe('LIFE-DAY-3 — practise what you missed', () => {
  it('LIFE-DAY-3 — only FALSE counts as missed; ungraded is not a failure', () => {
    // `correct: null` = met in the story, never tested. Quizzing it would be
    // inventing a failure the player never had.
    const words = [w('a', true), w('b', false), w('c', null)];
    expect(missedWords(words).map((x) => x.text)).toEqual(['b']);
  });

  it('LIFE-DAY-3 — no mistakes means NO quiz, not an empty one', () => {
    expect(buildMissedIntent([w('a', true), w('c', null)])).toBeNull();
    expect(missedQuizHref([w('a', true)])).toBeNull();
    expect(missedQuizHref([])).toBeNull();
  });

  it('LIFE-DAY-3 — the intent carries the words AND their glosses', () => {
    // "tablier" alone is ambiguous to the planner in a way "tablier (apron)"
    // is not.
    const intent = buildMissedIntent(
      [w('tablier', false, 'apron'), w('quand même', false, 'even so')],
      'French',
    );
    expect(intent).toContain('tablier (apron)');
    expect(intent).toContain('quand même (even so)');
    expect(intent).toContain('French');
  });

  it('LIFE-DAY-3 — a word with no gloss still makes the list, bare', () => {
    const intent = buildMissedIntent([w('tablier', false)]);
    expect(intent).toContain('tablier');
    expect(intent).not.toContain('(');
  });

  it('LIFE-DAY-3 — caps the list so the intent stays a prompt, not a corpus', () => {
    const many = Array.from({ length: 30 }, (_, i) => w(`mot-${i}`, false));
    const href = missedQuizHref(many)!;
    expect(href).toContain(`count=${MAX_MISSED_IN_QUIZ}`);
    expect(href).not.toContain('mot-20');
  });

  it('LIFE-DAY-3 — count tracks the MISTAKES, so a 2-mistake day is a 2-question session', () => {
    // Padding a short session out to the default length would fill it with
    // cards the player never got wrong — the opposite of the ask.
    const href = missedQuizHref([w('a', false), w('b', false), w('c', true)])!;
    expect(href).toContain('count=2');
  });

  it('LIFE-DAY-3 — routes through the EXISTING practice intent contract', () => {
    const href = missedQuizHref([w('tablier', false, 'apron')], 'French')!;
    expect(href.startsWith('/cards/practice?')).toBe(true);
    const q = new URLSearchParams(href.split('?')[1]);
    // Round-trips through URLSearchParams — the intent contains commas,
    // parentheses and (in other languages) non-ASCII.
    expect(q.get('intent')).toContain('tablier (apron)');
    expect(q.get('count')).toBe('1');
  });
});

/**
 * LIFE-DAY-5 — the practice link carries where to come back to.
 *
 * Practice exits to `/cards` by default, which is right from the deck and
 * wrong from a wurld: the player was mid-story, and finishing a drill dropped
 * them somewhere they were not using with the world to find again by hand.
 * The return path travels in the URL rather than a store because practice is a
 * full navigation — a store would not survive a reload or a cold open.
 */
describe('LIFE-DAY-5 — the return path', () => {
  const missed: PractisedWord[] = [
    { text: 'difficultés', translation: 'difficulties', correct: false },
    { text: 'bonjour', translation: 'hello', correct: true },
  ];

  it('carries the world path as `from` when given one', () => {
    const href = missedQuizHref(missed, 'French', '/wurlds/abc123');
    expect(href).not.toBeNull();
    expect(new URLSearchParams(href!.split('?')[1]).get('from')).toBe('/wurlds/abc123');
  });

  it('omits `from` entirely when there is nowhere particular to return to', () => {
    const href = missedQuizHref(missed, 'French');
    expect(href).not.toBeNull();
    expect(new URLSearchParams(href!.split('?')[1]).get('from')).toBeNull();
  });
});
