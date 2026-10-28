/**
 * LIFE-LANG-18 — RETIRED (2026-09-24). The swap-words feature (the "second
 * list", swapWords[] — code-switch candidates) was cut from the app entirely,
 * along with chat Easy mode (MSG-VOCAB-2 / MSG-VOCAB-7) and the tutor's flag
 * (TUTOR-INV-21).
 *
 * These assertions pin the ABSENCE: the step SI must not ask for the list in
 * its annotation rules or its output schema, and the segmentation rule it used
 * to be fenced off from (LIFE-LANG-10) must still be intact.
 */
import { describe, expect, it } from 'vitest';
import {
  lifeVocabAnnotationRules,
  optionOutputContract,
  stepOutputSchemaBlock,
} from '../../prompts/lifeStepSI';
import { lifeStepSystemInstruction } from '../../prompts/lifeStep';

describe('LIFE-LANG-18 — retired: no swap words anywhere in the step SI', () => {
  const rules = lifeVocabAnnotationRules('French', 'English');

  it('LIFE-LANG-18 — retired: the annotation rules no longer ask for swapWords', () => {
    expect(rules).not.toContain('swapWords');
    expect(rules).not.toMatch(/SWAP WORDS|code-switch|SCOPE FENCE/i);
  });

  it('LIFE-LANG-18 — retired: the output schema carries no swapWords field', () => {
    const schema = [
      ...stepOutputSchemaBlock({ practiceLanguage: 'French', systemLanguage: 'English' }),
      ...optionOutputContract({ practiceLanguage: 'French', systemLanguage: 'English' }),
    ].join('\n');
    expect(schema).not.toContain('swapWords');
  });

  it('LIFE-LANG-18 — retired: the whole step SI never mentions swapWords', () => {
    for (const difficulty of [1, 3, 6]) {
      const si = lifeStepSystemInstruction({
        practiceLanguage: 'French',
        nativeLanguage: 'English',
        systemLanguage: 'English',
        difficulty,
      });
      expect(si).not.toContain('swapWords');
      expect(si).not.toMatch(/LIFE-LANG-18|swap rules|code-switch/i);
    }
  });

  it('LIFE-LANG-10 — still demands full segmentation for complexWords', () => {
    expect(rules).toContain('SEGMENTATION, NOT SELECTION');
    expect(rules).toMatch(/BREAK THE WHOLE LINE/);
  });
});
