import { describe, expect, it } from 'vitest';
import { shuffleChoices } from './shuffleChoices';
import type { StepChoice } from './stepSchema';

const choices: StepChoice[] = [
  { id: 'c1', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
  { id: 'c2', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
  { id: 'c3', practiceText: 'voulais', nativeText: '', correctness: 'wrong' },
];

describe('shuffleChoices (LIFE-EX-GEN-8)', () => {
  it('LIFE-EX-GEN-8 — preserves the exact element set with one still correct', () => {
    const out = shuffleChoices(choices, () => 0);
    expect(out).toHaveLength(3);
    expect(new Set(out.map((c) => c.id))).toEqual(new Set(['c1', 'c2', 'c3']));
    expect(out.filter((c) => c.correctness === 'correct')).toHaveLength(1);
    // Every chip object survives untouched (same reference set).
    expect(new Set(out)).toEqual(new Set(choices));
  });

  it('LIFE-EX-GEN-8 — an injected deterministic rng moves the correct answer off index 0', () => {
    // rng → 0: Fisher-Yates swaps the first (correct) element to the tail.
    const out = shuffleChoices(choices, () => 0);
    const correctIdx = out.findIndex((c) => c.correctness === 'correct');
    expect(correctIdx).not.toBe(0);
    expect(correctIdx).toBe(2);
  });

  it('LIFE-EX-GEN-8 — does not mutate the input array', () => {
    const snapshot = choices.slice();
    shuffleChoices(choices, () => 0.5);
    expect(choices).toEqual(snapshot);
    expect(choices[0]!.correctness).toBe('correct'); // still authoring order
  });
});
