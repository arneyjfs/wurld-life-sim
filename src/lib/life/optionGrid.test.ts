/**
 * LIFE-GRID-* — the option grid's REJECT half.
 *
 * The reported failure these exist for: *"always directing the user to the same
 * or very similar options in the grid."* The audit found `LIFE-OPT-VARIETY`
 * governs ONE grid in isolation, with nothing showing the model the previous
 * sets — so cross-turn repetition was structurally unguarded.
 *
 * ⚠ THE PREVENT HALF MOVED with SRV-PROMPT-8..13 batch 8, to
 * `functions/src/__tests__/life/optionGrid.test.ts`. `requiredTypeForTurn`,
 * `renderRequiredType`, `renderRecentActions` and `actionShapesFromEvents` all
 * write (or feed) blocks the model reads, so they crossed with the step prompt.
 * `pushRecentActions` + `RECENT_ACTIONS_WINDOW` went with them: the window is
 * the render cap, and the fold had no caller left once the renderer moved.
 *
 * What stayed is what judges the model's ANSWER — `gradeOptionSet`,
 * `offeredShapes`, `takenShapeCounts`, `shapeKey`, `goalKey`.
 */
import { describe, expect, it } from 'vitest';
import {
  goalKey,
  gradeOptionSet,
  shapeKey,
  takenShapeCounts,
  type ActionShape,
} from './optionGrid';

const a = (type: ActionShape['type'], targetId: string | null = null): ActionShape => ({
  type,
  targetId,
});

describe('LIFE-GRID-6 — a goal taken twice may not be offered a third time', () => {
  const counts = (pairs: Array<[string, number]>) => new Map(pairs);

  it('REJECTS a shape the player has already taken twice', () => {
    const v = gradeOptionSet(
      [a('do', 'letter'), a('ask', 'remy'), a('move', 'gate')],
      counts([['do:letter', 2]]),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) {
      // SRV-PROMPT-12 — the verdict carries the FACTS now; the sentence it
      // used to carry is `lifeStepViolations.ts`'s `dangled-goal` template.
      expect(v.goal).toBe('do:letter');
      // The two legitimate ways out are still offered — a bare "don't" sends
      // the retry back with nothing to do differently — but the SENTENCE that
      // offers them is `lifeStepViolations.ts`'s `dangled-goal` template now,
      // and `functions/src/__tests__/stepGoldenParity.test.ts` asserts it is
      // byte-identical to the one this verdict used to carry. What travels
      // here is the COUNT, which is the other half of that sentence.
      expect(v.takes).toBe(2);
    }
  });

  it('ALLOWS one repeat — asking again after the conversation moved is ordinary', () => {
    expect(
      gradeOptionSet([a('do', 'letter'), a('ask', 'remy')], counts([['do:letter', 1]])).ok,
    ).toBe(true);
  });

  it('keys on type AND target, so a different verb on the same thing is a different shape', () => {
    // Deliberate: keying on the target alone measured 14.5%, at the ceiling.
    // The prompt still tells the model a different verb is a repeat; only the
    // machine backstop is the narrower rule.
    expect(
      gradeOptionSet([a('ask', 'letter'), a('move', 'gate')], counts([['do:letter', 3]])).ok,
    ).toBe(true);
  });

  it('is SKIPPED when no counts are supplied, so old callers are unaffected', () => {
    expect(gradeOptionSet([a('do', 'letter'), a('ask', 'remy')]).ok).toBe(true);
    expect(gradeOptionSet([a('do', 'letter'), a('ask', 'remy')], null).ok).toBe(true);
  });
});

describe('LIFE-GRID-6 — takenShapeCounts', () => {
  const decision = (actionType: string, targetId: string | null) =>
    ({ kind: 'decision', payload: { actionType, ...(targetId ? { targetId } : {}) } });

  it('counts decisions per shape', () => {
    const m = takenShapeCounts([
      decision('do', 'letter'),
      decision('ask', 'remy'),
      decision('do', 'letter'),
    ]);
    expect(m.get('do:letter')).toBe(2);
    expect(m.get('ask:remy')).toBe(1);
  });

  it('is UNWINDOWED — a goal dangled across a long scene is the case a window drops', () => {
    const many = Array.from({ length: 30 }, () => decision('ask', 'filler'));
    const m = takenShapeCounts([decision('do', 'letter'), ...many, decision('do', 'letter')]);
    expect(m.get('do:letter')).toBe(2);
  });

  it('ignores non-decision events and unknown action types', () => {
    const m = takenShapeCounts([
      { kind: 'beat', payload: { actionType: 'do', targetId: 'letter' } },
      { kind: 'decision', payload: { actionType: 'nonsense', targetId: 'x' } },
    ]);
    expect(m.size).toBe(0);
  });

  it('keys by goalKey, NOT shapeKey — this assertion had it backwards', () => {
    // WRITTEN WRONG THE FIRST TIME, and it is worth saying so here rather than
    // silently swapping it. It asserted that the count map keys a targetless
    // pick the same way `shapeKey` displays it — which made the two "agree"
    // exactly as intended and shipped a rule that fired on 75.7% of grids.
    //
    // The map and the CHECK must agree; the map and the DISPLAY must not. See
    // `goalKey`.
    expect(takenShapeCounts([decision('observe', null)]).size).toBe(0);
    const m = takenShapeCounts([decision('do', 'letter')]);
    expect(m.has(goalKey(a('do', 'letter'))!)).toBe(true);
    expect(m.has(shapeKey(a('do', 'letter')))).toBe(true); // identical when targeted
  });
});

describe('LIFE-GRID-6 — the dangle key ignores options with no target', () => {
  it('goalKey is null when the option acts on nothing specific', () => {
    expect(goalKey({ type: 'ask', targetId: null })).toBeNull();
    expect(goalKey({ type: 'do', targetId: 'letter' })).toBe('do:letter');
  });

  it('NEVER rejects a targetless option, however many times its verb was taken', () => {
    // THE REGRESSION. `ask` taken eight times is a player having conversations,
    // not a world dangling something.
    const counts = new Map([['ask', 8], ['observe', 8], ['do', 4]]);
    const v = gradeOptionSet(
      [a('ask', null), a('observe', null), a('do', null)],
      counts,
    );
    expect(v.ok).toBe(true);
  });

  it('still rejects the TARGETED goal taken twice', () => {
    const v = gradeOptionSet(
      [a('do', 'letter'), a('ask', null), a('move', 'gate')],
      new Map([['do:letter', 2]]),
    );
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.goal).toBe('do:letter');
  });

  it('takenShapeCounts SKIPS a targetless decision rather than counting its verb', () => {
    const d = (actionType: string, targetId: string | null) =>
      ({ kind: 'decision', payload: { actionType, ...(targetId ? { targetId } : {}) } });
    const m = takenShapeCounts([
      d('ask', null), d('ask', null), d('ask', null),
      d('do', 'letter'), d('do', 'letter'),
    ]);
    expect(m.get('ask')).toBeUndefined();
    expect(m.get('do:letter')).toBe(2);
  });
});
