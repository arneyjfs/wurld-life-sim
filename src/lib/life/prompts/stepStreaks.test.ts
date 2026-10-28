/**
 * LIFE-EX-CADENCE-* — the streak the DEBUG ROW reads.
 *
 * ⚠ THE RENDER HALF MOVED with SRV-PROMPT-8..13 batch 8, to
 * `functions/src/__tests__/life/stepStreaks.test.ts`. `renderPracticeCadence`,
 * `renderProductionCadence` and `recentlyPracticedTargets` all write (or feed)
 * blocks the model reads.
 *
 * `cyoaStreak` + `cadenceTier` STAYED, and the duplication does NOT expire:
 * `generateStepOptions` reads them for the LIFE-EX-CADENCE-3 debug row, which
 * records whether the model HONOURED the cadence it was given — a judgement on
 * the response. `tests/playthrough/serverPromptParity.test.ts` guards the two
 * copies against each other.
 */
import { describe, expect, it } from 'vitest';
import { cyoaStreak } from './stepStreaks';
import type { LifeEvent } from '@/types/firestore';

const ev = (kind: LifeEvent['kind'], n = 0): LifeEvent => ({ id: `${kind}-${n}`, kind });

describe('cyoaStreak', () => {
  it('counts decisions since the last graded moment', () => {
    expect(cyoaStreak([ev('decision', 1), ev('decision', 2)])).toBe(2);
  });

  it('a correction spends the slot and resets the count', () => {
    expect(cyoaStreak([ev('decision', 1), ev('correction'), ev('decision', 2)])).toBe(1);
  });

  it('LIFE-EX-CADENCE-1 — a DEMOTED question spends the slot too', () => {
    // Counting only `correction` left the streak elevated after a demote, so
    // the directive fired again on the very next node: a demote loop at three
    // calls a turn, which the player experiences as "too many questions".
    expect(cyoaStreak([ev('decision', 1), ev('question_demoted'), ev('decision', 2)])).toBe(1);
  });

  it('is zero on an empty log', () => {
    expect(cyoaStreak([])).toBe(0);
  });
});


