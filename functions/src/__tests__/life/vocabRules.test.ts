/**
 * MOVED from `src/lib/life/prompts/` by SRV-PROMPT-8..13 batch 8 (SRV-PROMPT-3:
 * a retired client prompt module is deleted and its tests MOVE rather than die).
 * The assertions are unchanged; only the imports point at the server modules.
 */
import { describe, expect, it } from 'vitest';
import { lifeVocabAnnotationRules } from '../../prompts/lifeStepSI';

describe('lifeVocabAnnotationRules — LIFE-LANG-10', () => {
  const rules = lifeVocabAnnotationRules('French', 'English');

  it('LIFE-LANG-10 — frames the task as full-line SEGMENTATION, not key-word selection', () => {
    // v2.1: reframed from "surface the hard words" (implies a sparse subset) to
    // "segment the whole line" (implies complete coverage → denser tagging).
    expect(rules).toContain('SEGMENTATION, NOT SELECTION');
    expect(rules).toMatch(/BREAK THE WHOLE LINE/);
    expect(rules).toContain('4+');
    expect(rules).not.toContain('1-3 hardest words');
  });

  it('LIFE-LANG-10 — carries the must-tag / skippable split from the chat rules', () => {
    expect(rules).toContain('MUST surface');
    expect(rules).toContain('SKIP');
    expect(rules).toContain('content words');
    expect(rules).toContain('fixed expressions');
    // group cap + no crossing a comma/conjunction
    expect(rules).toMatch(/≤ 4 words/);
  });

  it('LIFE-LANG-10 — carries the literal-gloss + exact-form rules', () => {
    expect(rules).toContain('(lit: word-by-word)');
    expect(rules).toContain('EXACT form as written');
  });

  it('LIFE-LANG-10 — parameterised on both languages: gloss in system language, tag the practice channel', () => {
    expect(rules).toContain('French channel');
    expect(rules).toContain('English gloss');
    // OPTION labels get the same treatment (LIFE-BUBBLE-7 chip parity).
    expect(rules).toContain('Annotate OPTION labels the same way');
  });

  it('LIFE-LANG-10 — names the immersion case (annotate narration when system == practice)', () => {
    const immersion = lifeVocabAnnotationRules('French', 'French');
    expect(immersion).toContain('French == French');
  });
});
