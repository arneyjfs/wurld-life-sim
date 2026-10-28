/**
 * LIFE-BENCH-6 — the transcript records what the player was SHOWN.
 *
 * Free: pure shape logic, no API calls, so it runs in `npm test` with
 * everything else (same reasoning as `playSeeds.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import type { PracticePrompt, StepChoice } from '@/lib/life/stepSchema';
import { captureGraded } from './captureGraded';

const fillBlank: PracticePrompt = {
  kind: 'generation',
  practiceText: 'Je ___ un café.',
  nativeText: 'I would like a coffee.',
  completedNativeText: 'I would like a coffee.',
  disambiguation: 'translation-anchor',
} as PracticePrompt;

const chip = (over: Partial<StepChoice>): StepChoice =>
  ({ id: 'c1', practiceText: 'voudrais', nativeText: '', ...over }) as StepChoice;

const capture = (choices: StepChoice[], prompt: PracticePrompt = fillBlank) =>
  captureGraded({
    kind: 'generation',
    target: 'voudrais',
    line: 'Je voudrais un café.',
    practicePrompt: prompt,
    choices,
    direction: 'outbound',
    origin: 'model',
  });

describe('LIFE-BENCH-6 — the whole prompt object survives', () => {
  it('keeps the prompt as an OBJECT, not a truncated JSON string', () => {
    const out = capture([chip({})]);
    expect(typeof out.prompt).toBe('object');
    expect(out.prompt).toEqual(fillBlank);
  });

  it('keeps a field that a 400-char truncation would have cut', () => {
    // The concrete loss: `completedNativeText` is the native anchor
    // LIFE-EX-8.2 turns on, and it sorts late enough in JSON.stringify order
    // to fall off the end of a long fill-blank prompt.
    const long = {
      ...fillBlank,
      practiceText: `Je ___ ${'un très grand café au lait avec du sucre, '.repeat(12)}`,
    } as PracticePrompt;
    const out = capture([chip({})], long);
    expect(
      (out.prompt as { completedNativeText?: string }).completedNativeText,
    ).toBe('I would like a coffee.');
  });
});

describe('LIFE-BENCH-6 — every chip carries its verdict', () => {
  it('records which chip is correct and why each wrong one is wrong', () => {
    const out = capture([
      chip({ id: 'a', practiceText: 'voudrais', correctness: 'correct' }),
      chip({ id: 'b', practiceText: 'veux', correctness: 'wrong', whyWrong: 'too blunt for a shop' }),
    ]);
    expect(out.choices).toEqual([
      { text: 'voudrais', correctness: 'correct', whyWrong: null },
      { text: 'veux', correctness: 'wrong', whyWrong: 'too blunt for a shop' },
    ]);
  });

  it('preserves chip ORDER — the shuffle is what the player saw', () => {
    const out = capture([
      chip({ id: 'a', practiceText: 'veux', correctness: 'wrong', whyWrong: 'w' }),
      chip({ id: 'b', practiceText: 'voudrais', correctness: 'correct' }),
    ]);
    expect(out.choices.map((c) => c.text)).toEqual(['veux', 'voudrais']);
    expect(out.choices.findIndex((c) => c.correctness === 'correct')).toBe(1);
  });

  it('a CYOA-shaped chip set records nulls rather than inventing a verdict', () => {
    const out = capture([chip({ id: 'a', correctness: undefined })]);
    expect(out.choices[0]).toEqual({ text: 'voudrais', correctness: null, whyWrong: null });
  });

  it('falls back to the native gloss for a comprehension chip', () => {
    const out = capture([chip({ practiceText: undefined, nativeText: 'How much is it?' })]);
    expect(out.choices[0]!.text).toBe('How much is it?');
  });

  it('an EMPTY practiceText is recorded as empty, not silently replaced', () => {
    // A chip with no face is a defect worth seeing in the artefact. Swapping in
    // the gloss would hide it behind something that looks fine.
    const out = capture([chip({ practiceText: '', nativeText: 'coffee' })]);
    expect(out.choices[0]!.text).toBe('');
  });

  it('a blank whyWrong normalises to null so "present but empty" is not counted as present', () => {
    const out = capture([chip({ correctness: 'wrong', whyWrong: '   ' })]);
    expect(out.choices[0]!.whyWrong).toBeNull();
  });
});
