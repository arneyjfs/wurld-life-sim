import { describe, expect, it } from 'vitest';
import { buildLifeExplainQuestion, lifeChoiceLabel } from './buildLifeExplainQuestion';
import type { PracticePrompt, StepChoice } from '@/lib/life/stepSchema';

const comprehensionPrompt: PracticePrompt = {
  kind: 'comprehension',
  npcUtterance: 'Est-ce que tu connais un bon café ?',
  question: 'What is Sophie asking?',
  speakerName: 'Sophie',
  npcId: 'sophie',
};

const comprehensionChoices: StepChoice[] = [
  { id: 'a', practiceText: 'Elle cherche un café', nativeText: "She's asking about a café", correctness: 'correct' },
  { id: 'b', practiceText: 'Elle cherche le bureau', nativeText: "She's asking about the office", correctness: 'wrong' },
];

const generationPrompt: PracticePrompt = {
  kind: 'generation',
  practiceText: 'Je ___ un café',
  nativeText: 'I ___ a coffee',
};

const generationChoices: StepChoice[] = [
  { id: 'a', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
  { id: 'b', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
];

describe('buildLifeExplainQuestion (LIFE-LANG-5)', () => {
  it('LIFE-LANG-5 — comprehension maps to multiple-choice with native options', () => {
    const q = buildLifeExplainQuestion(comprehensionPrompt, comprehensionChoices, 'native');
    expect(q.questionType).toBe('multiple-choice');
    expect(q.instruction).toBe('What is Sophie asking?');
    expect(q.practiceText).toBe('Est-ce que tu connais un bon café ?');
    expect(q.options).toEqual(["She's asking about a café", "She's asking about the office"]);
    expect(q.correctAnswer).toBe("She's asking about a café");
  });

  it('LIFE-LANG-5 — fill-blank maps to multiple-choice with practice options', () => {
    const q = buildLifeExplainQuestion(generationPrompt, generationChoices, 'practice');
    expect(q.instruction).toBe('Complete the sentence.');
    expect(q.practiceText).toBe('Je ___ un café');
    expect(q.options).toEqual(['voudrais', 'veux']);
    expect(q.correctAnswer).toBe('voudrais');
  });

  it('LIFE-LANG-5 — empty comprehension question falls back to a speaker-named cue', () => {
    const q = buildLifeExplainQuestion(
      { ...comprehensionPrompt, question: '' },
      comprehensionChoices,
      'native',
    );
    expect(q.instruction).toBe('What is Sophie saying?');
    const q2 = buildLifeExplainQuestion(
      { ...comprehensionPrompt, question: '', speakerName: null },
      comprehensionChoices,
      'native',
    );
    expect(q2.instruction).toBe('What did they just say?');
  });

  it('LIFE-LANG-5 — lifeChoiceLabel falls back to practiceText when the native label is empty', () => {
    expect(lifeChoiceLabel({ practiceText: 'voudrais', nativeText: '' }, 'native')).toBe('voudrais');
    expect(lifeChoiceLabel({ practiceText: 'voudrais', nativeText: 'would like' }, 'native')).toBe('would like');
    expect(lifeChoiceLabel({ practiceText: 'voudrais', nativeText: 'would like' }, 'practice')).toBe('voudrais');
  });
});
