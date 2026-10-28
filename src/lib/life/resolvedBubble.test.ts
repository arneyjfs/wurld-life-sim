import { describe, it, expect } from 'vitest';
import { buildResolvedBubble } from './resolvedBubble';
import type { StepChoice } from './stepSchema';

const choice = (overrides: Partial<StepChoice>): StepChoice => ({
  id: 'c',
  practiceText: 'voudrais',
  nativeText: 'like',
  correctness: 'correct',
  ...overrides,
});

describe('buildResolvedBubble — LIFE-CONTRACT-EX-3 (non-mutating)', () => {
  describe('outbound (fill-blank)', () => {
    it('substitutes the CORRECT chip into the template, even when the player picked wrong', () => {
      const bubble = buildResolvedBubble(
        {
          outcomeKind: 'generation',
          promptSource: 'Je ___ un café',
          // The correct answer the model marked.
          correctAnswer: choice({ practiceText: 'voudrais' }),
        },
        1000,
      );
      expect(bubble.speaker).toBe('user');
      expect(bubble.practiceText).toBe('Je voudrais un café');
    });

    it('substitutes the correct chip even if the picked chip is different (non-mutation)', () => {
      // This test pins the contract: the player would have picked
      // "peux" (wrong), but the bubble that lands shows the line
      // built from the CORRECT chip ("voudrais") — the world didn't
      // fork on the player's pick.
      const bubble = buildResolvedBubble(
        {
          outcomeKind: 'generation',
          promptSource: 'Je ___ un café',
          correctAnswer: choice({ practiceText: 'voudrais' }),
        },
        1000,
      );
      expect(bubble.practiceText).toBe('Je voudrais un café');
      // What the player-picked-wrong word would have produced is
      // NEVER what lands. (Validate with the exact wrong line.)
      expect(bubble.practiceText).not.toBe('Je peux un café');
    });

    it('handles templates with multiple underscores in the blank token', () => {
      const bubble = buildResolvedBubble(
        {
          outcomeKind: 'generation',
          promptSource: 'Tu _____ aller boire un verre ce soir ?',
          correctAnswer: choice({ practiceText: 'voudrais' }),
        },
        1000,
      );
      expect(bubble.practiceText).toBe(
        'Tu voudrais aller boire un verre ce soir ?',
      );
    });

    it('LIFE-LANG-6 — user bubble carries the completed-sentence gloss when provided', () => {
      const bubble = buildResolvedBubble({
        outcomeKind: 'generation',
        promptSource: 'Je ___ un café',
        correctAnswer: choice({ practiceText: 'voudrais', nativeText: 'like' }),
        nativeText: 'I would like a coffee',
      });
      expect(bubble.nativeText).toBe('I would like a coffee');
    });

    it('user bubble gloss is null when none is provided (legacy/absent)', () => {
      const bubble = buildResolvedBubble({
        outcomeKind: 'generation',
        promptSource: 'Je ___ un café',
        correctAnswer: choice({ practiceText: 'voudrais', nativeText: 'like' }),
      });
      expect(bubble.nativeText).toBeNull();
    });
  });

  describe('inbound (comprehension)', () => {
    it('carries the verbatim npcUtterance as the NPC bubble', () => {
      const bubble = buildResolvedBubble(
        {
          outcomeKind: 'comprehension',
          promptSource: "Salut ! Comment s'est passée ta semaine ?",
          correctAnswer: choice({ practiceText: "She's asking about my week" }),
          speakerName: 'Sophie',
          npcId: 'sophie-friend',
        },
        2000,
      );
      expect(bubble.speaker).toBe('npc');
      expect(bubble.practiceText).toBe(
        "Salut ! Comment s'est passée ta semaine ?",
      );
      expect(bubble.speakerName).toBe('Sophie');
      expect(bubble.npcId).toBe('sophie-friend');
    });

    it('preserves the npcUtterance regardless of which chip the player picked', () => {
      // The chip the player picked is irrelevant to what the NPC
      // says — the contract pins this.
      const bubble = buildResolvedBubble({
        outcomeKind: 'comprehension',
        promptSource: 'Tu vas où ?',
        // pretend correctAnswer here is the right interpretation chip
        correctAnswer: choice({ practiceText: "She's asking where I'm going" }),
        speakerName: 'Sophie',
      });
      expect(bubble.practiceText).toBe('Tu vas où ?');
    });

    it('LIFE-LANG-12 — NPC bubble carries the utterance translation when provided', () => {
      const bubble = buildResolvedBubble({
        outcomeKind: 'comprehension',
        promptSource: 'Tu vas où ?',
        correctAnswer: choice({ practiceText: "She's asking where I'm going" }),
        speakerName: 'Sophie',
        nativeText: 'Where are you going?',
      });
      // The revealed NPC bubble is bilingual like every other npc bubble.
      expect(bubble.nativeText).toBe('Where are you going?');
    });
  });

  describe('annotations (LIFE-BUBBLE-7)', () => {
    it('LIFE-BUBBLE-7 — outbound resolved bubble carries the correct chip\'s annotations', () => {
      const bubble = buildResolvedBubble(
        {
          outcomeKind: 'generation',
          promptSource: 'Je ___ un café',
          correctAnswer: choice({
            practiceText: 'voudrais',
            complexWords: ['voudrais'],
            wordTranslations: { 'voudrais': 'would like' },
          }),
        },
        1000,
      );
      expect(bubble.complexWords).toEqual(['voudrais']);
      expect(bubble.wordTranslations).toEqual({ 'voudrais': 'would like' });
    });

    it('LIFE-BUBBLE-7 — inbound (comprehension) resolved bubble carries no annotations', () => {
      const bubble = buildResolvedBubble({
        outcomeKind: 'comprehension',
        promptSource: 'Tu vas où ?',
        correctAnswer: choice({
          practiceText: "She's asking where I'm going",
          complexWords: ['asking'],
          wordTranslations: { 'asking': 'x' },
        }),
        speakerName: 'Sophie',
      });
      expect(bubble.complexWords).toBeUndefined();
      expect(bubble.wordTranslations).toBeUndefined();
    });
  });
});

/**
 * LIFE-EX-VOCAB-3 — the graded line lands TAPPABLE.
 *
 * Reported 2026-07-31: "Make sure comprehension or spoken phrases get
 * vocabulary words during generation so when they are sent as a message the
 * vocab words are visible."
 *
 * Comprehension carried NO annotations at all — the NPC utterance is a full
 * practice-language line and the densest thing in the turn, and it was the one
 * line the learner could not look up. Fill-blank inherited the correct CHIP's
 * annotations, which cover the answer token ("voudrais") while the bubble is
 * the whole completed sentence — so one word of a line was tappable.
 */
describe('LIFE-EX-VOCAB-3 — graded bubbles carry line vocab', () => {
  const chip = {
    id: 'c',
    practiceText: 'voudrais',
    nativeText: '',
    complexWords: ['voudrais'],
    wordTranslations: { voudrais: 'would like' },
  };

  it('LIFE-EX-VOCAB-3 — comprehension: the utterance is annotated', () => {
    const b = buildResolvedBubble({
      outcomeKind: 'comprehension',
      promptSource: 'Il fait un froid de canard aujourd’hui.',
      correctAnswer: { id: 'c', practiceText: 'x', nativeText: 'y' },
      speakerName: 'Sophie',
      lineVocab: { 'un froid de canard': 'freezing cold (lit: a duck cold)' },
    });
    expect(b.wordTranslations).toEqual({
      'un froid de canard': 'freezing cold (lit: a duck cold)',
    });
    // Derived from the keys, same contract as a beat (LIFE-COST-5).
    expect(b.complexWords).toEqual(['un froid de canard']);
  });

  it('LIFE-EX-VOCAB-3 — fill-blank: the COMPLETED sentence wins over the chip token', () => {
    const b = buildResolvedBubble({
      outcomeKind: 'generation',
      promptSource: 'Je ___ déjeuner avec toi.',
      correctAnswer: chip,
      lineVocab: { voudrais: 'would like', 'déjeuner': 'to have lunch' },
    });
    expect(b.practiceText).toBe('Je voudrais déjeuner avec toi.');
    // The chip glossed one token; the line glosses the line.
    expect(Object.keys(b.wordTranslations ?? {})).toEqual(['voudrais', 'déjeuner']);
  });

  it('LIFE-EX-VOCAB-3 — without lineVocab, fill-blank still falls back to the chip', () => {
    // Responses authored before the field existed must not lose what they had.
    const b = buildResolvedBubble({
      outcomeKind: 'generation',
      promptSource: 'Je ___ déjeuner avec toi.',
      correctAnswer: chip,
    });
    expect(b.wordTranslations).toEqual({ voudrais: 'would like' });
  });

  it('LIFE-EX-VOCAB-3 — comprehension with no lineVocab omits the fields entirely', () => {
    const b = buildResolvedBubble({
      outcomeKind: 'comprehension',
      promptSource: 'Bonjour.',
      correctAnswer: { id: 'c', practiceText: 'x', nativeText: 'y' },
    });
    expect(b.wordTranslations).toBeUndefined();
    expect(b.complexWords).toBeUndefined();
  });
});
