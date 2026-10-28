/**
 * LIFE-EX-13 — the end-of-scene review set.
 *
 * The tier ORDER is the whole point of the change. A review drawn uniformly
 * from recent vocab spends most of its five slots on words the player already
 * knew; sorting the misses to the front makes the one guaranteed-useful thing
 * also the first thing.
 */
import { describe, expect, it } from 'vitest';
import { buildSceneReviewPairs, CARD_MATCH_MAX_PAIRS } from './cardMatch';
import type { LifeEvent } from '@/types/firestore';

let n = 0;
const ev = (kind: string, payload: Record<string, unknown> = {}): LifeEvent =>
  ({ id: `e${n++}`, kind, payload }) as unknown as LifeEvent;

const sceneStart = () => ev('scene_started');
const beat = (wordTranslations: Record<string, string>) =>
  ev('beat', { practiceText: 'x', wordTranslations });
const graded = (correct: boolean, correctAnswer: string, correctAnswerNative: string) =>
  ev('correction', { correct, correctAnswer, correctAnswerNative, picked: 'whatever' });

describe('LIFE-EX-13 — misses lead', () => {
  it('puts a WRONG answer ahead of a right one and ahead of narration vocab', () => {
    const pairs = buildSceneReviewPairs([
      sceneStart(),
      beat({ enveloppe: 'envelope' }),
      graded(true, 'sceau', 'seal'),
      graded(false, 'consumer', 'to burn up'),
    ]);
    expect(pairs.map((p) => p.practice)).toEqual(['consumer', 'sceau', 'enveloppe']);
  });

  it('pairs from the CORRECT answer, never from what the player picked', () => {
    // Drilling the wrong word is the one thing a review must not do.
    const pairs = buildSceneReviewPairs([
      sceneStart(),
      ev('correction', {
        correct: false,
        picked: 'veux',
        correctAnswer: 'voudrais',
        correctAnswerNative: 'would like',
      }),
    ]);
    expect(pairs).toEqual([{ id: 'q:voudrais', practice: 'voudrais', native: 'would like' }]);
  });

  it('the LATER attempt at a repeated target wins', () => {
    const pairs = buildSceneReviewPairs([
      sceneStart(),
      graded(false, 'sceau', 'seal (older gloss)'),
      graded(false, 'sceau', 'wax seal'),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.native).toBe('wax seal');
  });
});

describe('LIFE-EX-13 — narration vocab is ordered by FREQUENCY', () => {
  it('a word the scene used repeatedly beats a word it used once', () => {
    // Frequency, not recency: the repeated word is what the scene was ABOUT;
    // the newest is an accident of where the scene stopped.
    const pairs = buildSceneReviewPairs([
      sceneStart(),
      beat({ lettre: 'letter' }),
      beat({ lettre: 'letter', arcade: 'arcade' }),
      beat({ lettre: 'letter' }),
      beat({ ombre: 'shadow' }),
    ]);
    expect(pairs[0]!.practice).toBe('lettre');
  });

  it('caps the grid so a review stays a review', () => {
    const beats = Array.from({ length: 20 }, (_, i) => beat({ [`mot${i}`]: `word${i}` }));
    expect(buildSceneReviewPairs([sceneStart(), ...beats])).toHaveLength(CARD_MATCH_MAX_PAIRS);
  });
});

describe('LIFE-EX-13 — the scene boundary', () => {
  it('ignores everything before this scene started', () => {
    const pairs = buildSceneReviewPairs([
      beat({ vieux: 'old' }),
      graded(false, 'oublie', 'forget'),
      sceneStart(),
      beat({ neuf: 'new' }),
    ]);
    expect(pairs.map((p) => p.practice)).toEqual(['neuf']);
  });

  it('uses the LATEST marker when several scenes are in the window', () => {
    const pairs = buildSceneReviewPairs([
      sceneStart(),
      beat({ premier: 'first' }),
      sceneStart(),
      beat({ second: 'second' }),
    ]);
    expect(pairs.map((p) => p.practice)).toEqual(['second']);
  });

  it('falls back to the whole window when no marker is present', () => {
    // A world mid-migration, or a listener scrolled past its own marker. A
    // review over too much beats no review.
    const pairs = buildSceneReviewPairs([beat({ orphelin: 'orphan' })]);
    expect(pairs.map((p) => p.practice)).toEqual(['orphelin']);
  });
});

describe('LIFE-EX-13 — half-filled rows never reach the grid', () => {
  it('skips a correction with no native gloss rather than emitting a blank tile', () => {
    // `correctAnswerNative` is spread-when-present on the write
    // (LIFE-VOCAB-RECAP-7), so absent is a real and expected shape.
    const pairs = buildSceneReviewPairs([
      sceneStart(),
      ev('correction', { correct: false, correctAnswer: 'sceau' }),
      beat({ lettre: 'letter' }),
    ]);
    expect(pairs.map((p) => p.practice)).toEqual(['lettre']);
  });

  it('an empty scene yields an empty set, not a crash', () => {
    expect(buildSceneReviewPairs([sceneStart()])).toEqual([]);
    expect(buildSceneReviewPairs([])).toEqual([]);
  });

  it('a graded pair and a narration pair for the SAME word appear once', () => {
    const pairs = buildSceneReviewPairs([
      sceneStart(),
      beat({ sceau: 'seal' }),
      graded(false, 'sceau', 'wax seal'),
    ]);
    expect(pairs).toHaveLength(1);
    // The graded tier wins — it is the one the player demonstrably missed.
    expect(pairs[0]!.native).toBe('wax seal');
  });
});
