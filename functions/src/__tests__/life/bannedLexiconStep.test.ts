/**
 * LIFE-STORY-LEXICON-1 — the step prompt is the INVERTED row.
 *
 * ⚠ MOVED from `src/lib/life/prompts/bannedLexicon.test.ts` by
 * SRV-PROMPT-8..13 batch 8, because the SI it asserts against is now built
 * here. The measurement in the comment below is unchanged and is why the rule
 * stays dropped.
 */
import { describe, expect, it } from 'vitest';
import { lifeStepSystemInstruction } from '../../prompts/lifeStep';

describe('LIFE-STORY-LEXICON-1 — the step prompt is the INVERTED row', () => {
  const marker = 'NAMING + WORD CHOICE';

  /**
   * LIFE-SI-LEAN-7 — the step prompt does NOT carry this, deliberately, and the
   * assertion is inverted so the decision is pinned rather than merely absent.
   *
   * **The rule was measured before being dropped**, which is why it stays
   * dropped:
   *
   *   · `CLICHE-NAME`, the measured one — 2 offending names in 220 with the
   *     step SI carrying it, 3 in 432 without. Unmoved, and expected to be:
   *     names are MINTED by `life_saga` and `life_world_arc`, which still carry
   *     it. Both of those assertions now live server-side (see the file header).
   *   · `CLICHE`, the judged one, per scene — 1.92 [1.75, 2.08] with vs 1.67
   *     [1.47, 1.86] without. **Overlapping, so not shown**, by the same rule
   *     that reverted `LIFE-PRECEDENCE-1`. It is the first row to look at if the
   *     owner reports the vocabulary coming back.
   *   · `LIFE-STORY-LEXICON-2` (the stock warning-idiom) runs at 100% in both
   *     arms over 410 beats — the machine-countable half is not violated either
   *     way.
   */
  it('the step prompt does NOT carry it — measured, and dropped on the measurement', () => {
    expect(
      lifeStepSystemInstruction({
        practiceLanguage: 'French',
        nativeLanguage: 'English',
        systemLanguage: 'English',
        difficulty: 4,
      }),
    ).not.toContain(marker);
  });
});
