import { describe, expect, it } from 'vitest';
import { waitKindForTurn } from './waitKind';

/**
 * LIFE-UI-11 — the precedence IS the behaviour, so it is tested directly.
 *
 * A graded outcome and a free-text submit both arrive with no `choice`, and the
 * opening turn arrives with none of the three — so the order these are checked
 * in decides the answer in every ambiguous case.
 */
describe('LIFE-UI-11 — waitKindForTurn', () => {
  it('LIFE-UI-11 — a practice outcome wins over everything else', () => {
    // The post-graded turn can carry a choice from the same turn; the outcome
    // is the more specific thing to be waiting on.
    expect(
      waitKindForTurn({
        practiceOutcome: { correct: true },
        choice: { speechAct: 'say' },
        eventCount: 9,
      }),
    ).toBe('outcome');
  });

  it('LIFE-UI-11 — free text beats the absent-choice fallbacks', () => {
    expect(waitKindForTurn({ freeText: 'I look around', eventCount: 9 })).toBe('write');
    // Empty free text is NOT a write — it must fall through, or a cleared
    // composer would mislabel the wait.
    expect(waitKindForTurn({ freeText: '', eventCount: 9 })).toBe('resume');
  });

  it('LIFE-UI-11 — a pick reports its declared direction', () => {
    expect(waitKindForTurn({ choice: { speechAct: 'say' }, eventCount: 3 })).toBe('say');
    expect(waitKindForTurn({ choice: { speechAct: 'act' }, eventCount: 3 })).toBe('act');
    // LIFE-SPEECH-8: a `hear` row sat between these two. `WaitKind` lost the
    // member with the speechAct it mirrored — this function derives one from
    // the other, so it had become unreachable.
  });

  it('LIFE-UI-11 — an undeclared speechAct floors at "act"', () => {
    // The step SI makes `act` the default and says to omit the field for it,
    // so most chips genuinely arrive without one.
    expect(waitKindForTurn({ choice: {}, eventCount: 3 })).toBe('act');
  });

  it('LIFE-UI-11 — no action at all: first turn opens, later turns resume', () => {
    expect(waitKindForTurn({ eventCount: 0 })).toBe('opening');
    expect(waitKindForTurn({ eventCount: 1 })).toBe('resume');
  });
});
