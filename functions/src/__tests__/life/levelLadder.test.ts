/**
 * MOVED from `src/lib/life/prompts/` by SRV-PROMPT-8..13 batch 8 (SRV-PROMPT-3:
 * a retired client prompt module is deleted and its tests MOVE rather than die).
 * The assertions are unchanged; only the imports point at the server modules.
 */
import { describe, expect, it } from 'vitest';
import { levelLadder } from '../../prompts/lifeStepSI';

/**
 * LIFE-LANG-9.1 — render the band the player is ON, not the whole ladder.
 *
 * The block shipped all three bands on every call: at difficulty 3 the model
 * was handed the level 1-2 rules (with a worked French illustration), the 3-4
 * rules, and the 5-7 rules, plus a paragraph explaining the mapping. Two thirds
 * of it described levels the player is not on.
 *
 * `difficulty` is already a parameter. Rules for a band the player is not in
 * cannot be helping, and this repo has now measured twice what surplus text in
 * this prompt costs: an exemplar for the wrong case beat the rule outright
 * (`LIFE-CONTRACT-EX-9`), and the SI is large enough that no single rule in it
 * is reliably salient (`LIFE-ENGINE-CMP-3`).
 *
 * This is the "code owns the decision" principle applied to prompt LENGTH, and
 * unlike the option grid it needs no judge to justify — the removed text is
 * unreachable for this player by construction.
 *
 * WHAT STAYS AT EVERY LEVEL, because it is not band-specific:
 *  - the LANGUAGE LEVEL rule itself (what leveling means, err-toward-simple);
 *  - the anti-sanitise rule — level governs LANGUAGE, never STORY. It is the
 *    guard against a level-1 noir turning into a bedtime story, and it matters
 *    most precisely where the band text is shortest;
 *  - the FLOOR (simple is not childish).
 */
const ladder = (difficulty: number) =>
  levelLadder({ practiceLanguage: 'French', nativeLanguage: 'English', difficulty });

describe('LIFE-LANG-9.1 — only the player\'s own band is rendered', () => {
  it('a beginner gets the 1-2 rules and NOT the 5-7 rules', () => {
    const si = ladder(1);
    expect(si).toContain('Level 1-2');
    expect(si).not.toContain('Level 5-7');
    expect(si).not.toContain('Level 3-4');
  });

  it('an intermediate gets 3-4 only', () => {
    const si = ladder(3);
    expect(si).toContain('Level 3-4');
    expect(si).not.toContain('Level 1-2');
    expect(si).not.toContain('Level 5-7');
  });

  it('an advanced player gets 5-7 only', () => {
    const si = ladder(7);
    expect(si).toContain('Level 5-7');
    expect(si).not.toContain('Level 1-2');
  });

  it('every band boundary resolves to exactly one band', () => {
    for (const d of [1, 2, 3, 4, 5, 6, 7]) {
      const bands = ['Level 1-2', 'Level 3-4', 'Level 5-7'].filter((b) => ladder(d).includes(b));
      expect(bands).toHaveLength(1);
    }
  });

  it('keeps the level rule, the anti-sanitise rule and the floor at EVERY level', () => {
    for (const d of [1, 4, 7]) {
      const si = ladder(d);
      expect(si).toContain('LANGUAGE LEVEL');
      expect(si).toContain('ERR TOWARD TOO SIMPLE');
      // The guard that stops a dark scene being softened to match easy words.
      // Asserted on the two IDEAS rather than the old sentence: the band merge
      // reworded the heading, and a test pinned to the phrasing would have
      // reported a surviving rule as deleted.
      expect(si).toMatch(/level governs language|never touches the story/i);
      expect(si).toMatch(/sanitise/i);
      expect(si).toMatch(/full-strength story/i);
      expect(si).toContain('FLOOR');
    }
  });

  it('still names the player\'s own difficulty and languages', () => {
    const si = ladder(5);
    expect(si).toContain('level 5/7');
    expect(si).toContain('French');
    expect(si).toContain('English');
  });

  it('is materially shorter than shipping all three bands', () => {
    // The point of the change. Measured against the shipped length, ~2,400.
    expect(ladder(3).length).toBeLessThan(1_800);
  });
});
