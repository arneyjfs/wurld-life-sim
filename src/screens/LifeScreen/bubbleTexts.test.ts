/**
 * LIFE-LANG-3 — which lines a life bubble shows under the two-row model.
 *
 * Spec: docs/specs/life-sim.md — LIFE-LANG-3; docs/specs/message-pipeline.md —
 * MSG-VIEW-7.
 *
 * This is the one function the whole life surface routes through, and it has
 * to keep two promises that pull against each other: every state an existing
 * wurld is in must render exactly what it rendered before the redesign, and
 * LIFE-LANG-4's answer-leak gate must still outrank whatever the player
 * chose.
 */
import { describe, expect, it } from 'vitest';
import { bubbleTexts, type BubbleLines } from './bubbleTexts';
import type { ViewSettings } from '@/lib/viewSettings';

const S = (primary: ViewSettings['primary'], secondRow: boolean): ViewSettings => ({
  primary,
  secondRow,
});

const bubble = (over: Partial<BubbleLines> = {}): BubbleLines => ({
  practiceText: 'Bonjour, mon ami.',
  nativeText: 'Hello, my friend.',
  wordTranslations: { bonjour: 'hello', ami: 'friend' },
  ...over,
});

describe('LIFE-LANG-3 — bubble lines under the two-row model', () => {
  describe('the states existing wurlds are already in', () => {
    it('practice + second row = the old `visible`', () => {
      const r = bubbleTexts(bubble(), S('practice', true), false, false);
      expect(r.primary).toBe('Bonjour, mon ami.');
      expect(r.secondary).toBe('Hello, my friend.');
    });

    it('practice, no second row = the old `hidden` (life’s default)', () => {
      const r = bubbleTexts(bubble(), S('practice', false), false, false);
      expect(r.primary).toBe('Bonjour, mon ami.');
      expect(r.secondary).toBeNull();
    });

    it('native, no second row = the old `native-only`', () => {
      const r = bubbleTexts(bubble(), S('native', false), false, false);
      expect(r.primary).toBe('Hello, my friend.');
      expect(r.secondary).toBeNull();
    });

    it('a flip still reveals the withheld line, in both directions', () => {
      expect(bubbleTexts(bubble(), S('practice', false), false, true).secondary).toBe(
        'Hello, my friend.',
      );
      expect(bubbleTexts(bubble(), S('native', false), false, true).secondary).toBe(
        'Bonjour, mon ami.',
      );
    });
  });

  describe('the state the old model could not express', () => {
    it('native on top WITH the practice line beneath it', () => {
      const r = bubbleTexts(bubble(), S('native', true), false, false);
      expect(r.primary).toBe('Hello, my friend.');
      expect(r.secondary).toBe('Bonjour, mon ami.');
    });
  });

  describe('LIFE-LANG-3 — the mixed row is gone (swap words cut)', () => {
    it('LIFE-LANG-3 — a practice-primary line renders the practice row and never a mixed row', () => {
      const r = bubbleTexts(bubble(), S('practice', false), false, false);
      expect(r.primary).toBe('Bonjour, mon ami.');
      expect(r).not.toHaveProperty('swapRuns');
    });
  });

  describe('LIFE-LANG-4 — the answer-leak gate outranks everything', () => {
    it.each(['practice', 'native'] as const)(
      'primary=%s still shows practiceText with no gloss',
      (p) => {
        const r = bubbleTexts(bubble(), S(p, true), true, false);
        expect(r.primary).toBe('Bonjour, mon ami.');
        expect(r.secondary).toBeNull();
      },
    );

    it('the deliberate reveal still works — the answer is spent', () => {
      const r = bubbleTexts(bubble(), S('native', true), true, true);
      expect(r.secondary).toBe('Hello, my friend.');
    });
  });

  describe('LIFE-WIP-2 — no bubble ever renders empty', () => {
    it('a beat with no native text falls back to practice as the primary', () => {
      const r = bubbleTexts(bubble({ nativeText: null }), S('native', false), false, false);
      expect(r.primary).toBe('Bonjour, mon ami.');
      expect(r.secondary).toBeNull();
    });

    it('whitespace-only native text counts as absent', () => {
      const r = bubbleTexts(bubble({ nativeText: '   ' }), S('native', true), false, false);
      expect(r.primary).toBe('Bonjour, mon ami.');
      expect(r.secondary).toBeNull();
    });

    it('the second row never repeats the row above it', () => {
      for (const s of [S('practice', true), S('native', true)]) {
        const r = bubbleTexts(bubble(), s, false, false);
        expect(r.secondary, JSON.stringify(s)).not.toBe(r.primary);
      }
    });
  });
});
