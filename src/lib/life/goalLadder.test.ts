/**
 * LIFE-GOAL-* / LIFE-NEED-* — the ladder.
 *
 * Spec: docs/specs/life-sim.md, "Direction, consequence and standing".
 *
 * The reported bug is one assertion in here — *"I was asked to find a key, I saw
 * it but picked a different option on that turn, and the key never came back"* —
 * and it is `a live objective SURVIVES a turn that ignores it`.
 */
import { describe, expect, it } from 'vitest';
import {
  applyLadderDelta,
  clearingMove,
  daysLeft,
  EMPTY_FACTS,
  EMPTY_LADDER,
  exposureReason,
  objectiveBlockFor,
  needMet,
  REPUTATION_FLOOR,
  resolveNeed,
  type GoalLadder,
  type WorldFacts,
} from './goalLadder';

const facts = (over: Partial<WorldFacts> = {}): WorldFacts => ({
  ...EMPTY_FACTS,
  people: [{ id: 'helene', name: 'Hélène', standing: 0 }],
  things: ['the framed canvas'],
  places: ['the gallery'],
  here: 'the studio',
  holding: [],
  ...over,
});

const withObjective = (text = 'find the key', need?: GoalLadder['objective'] extends null ? never : NonNullable<GoalLadder['objective']>['need']): GoalLadder => ({
  ...EMPTY_LADDER,
  saga: { text: 'hang work in the Friday show', when: 'Friday', days: 12 },
  objective: { id: 'o1', text, need: need ?? null },
});

describe('LIFE-GOAL-3 — an objective is never silently dropped', () => {
  it('THE REPORTED BUG: a live objective SURVIVES a turn that ignores it', () => {
    // The player was asked to find a key, saw it, and picked something else.
    // Under the old `currentGoals` list the model could rewrite the set on any
    // turn for any reason, so the key stopped existing. Here a proposal lands
    // only into an EMPTY slot.
    const before = withObjective('find the key');
    const after = applyLadderDelta(
      before,
      { nextObjective: 'help Rosa close up the shop' },
      facts(),
      { newId: 'o2' },
    );
    expect(after.objective?.text).toBe('find the key');
    expect(after.objective?.id).toBe('o1');
    expect(after.done).toHaveLength(0);
  });

  it('and it survives ten such turns — this is not a one-turn grace period', () => {
    let l = withObjective('find the key');
    for (let i = 0; i < 10; i++) {
      l = applyLadderDelta(l, { nextObjective: `distraction ${i}` }, facts(), { newId: `x${i}` });
    }
    expect(l.objective?.text).toBe('find the key');
  });

  it('completing it banks it and adopts the replacement', () => {
    const after = applyLadderDelta(
      withObjective('find the key'),
      { objectiveDone: true, nextObjective: 'open the cellar' },
      facts(),
      { newId: 'o2' },
    );
    expect(after.objective).toMatchObject({ id: 'o2', text: 'open the cellar' });
    expect(after.done).toEqual([{ text: 'find the key', how: 'done' }]);
  });

  it('the world CAN close one, but only with a reason the player is shown', () => {
    const after = applyLadderDelta(
      withObjective('find the key'),
      { objectiveClosed: 'Bébert changed the lock', nextObjective: 'find Bébert' },
      facts(),
      { newId: 'o2' },
    );
    expect(after.done).toEqual([
      { text: 'find the key', how: 'closed', because: 'Bébert changed the lock' },
    ]);
    expect(after.objective?.text).toBe('find Bébert');
  });

  it('an empty closed-reason is NOT a close — it is a silent drop wearing a field', () => {
    const after = applyLadderDelta(
      withObjective('find the key'),
      { objectiveClosed: '   ', nextObjective: 'something else' },
      facts(),
      { newId: 'o2' },
    );
    expect(after.objective?.text).toBe('find the key');
  });

  it('an EMPTY slot accepts a proposal — that is how the ladder starts moving', () => {
    const after = applyLadderDelta(
      { ...EMPTY_LADDER, saga: { text: 'g', when: 'Friday', days: 12 } },
      { nextObjective: 'find the key' },
      facts(),
      { newId: 'o1' },
    );
    expect(after.objective).toMatchObject({ id: 'o1', text: 'find the key' });
  });

  it('completing with NO replacement leaves the slot empty rather than stale', () => {
    const after = applyLadderDelta(
      withObjective('find the key'),
      { objectiveDone: true },
      facts(),
      { newId: 'o2' },
    );
    expect(after.objective).toBeNull();
    expect(after.done).toHaveLength(1);
  });
});

describe('LIFE-GOAL-7 — the day count reuses the clock we already have', () => {
  it('only `nextMorning` turns a day', () => {
    const l = withObjective();
    for (const advance of ['none', 'some', 'lots'] as const) {
      expect(applyLadderDelta(l, {}, facts(), { advance, newId: 'x' }).dayIndex).toBe(0);
    }
    expect(applyLadderDelta(l, {}, facts(), { advance: 'nextMorning', newId: 'x' }).dayIndex)
      .toBe(1);
  });

  it('daysLeft counts down and floors at zero, never negative', () => {
    const l: GoalLadder = { ...withObjective(), dayIndex: 11 };
    expect(daysLeft(l)).toBe(1);
    expect(daysLeft({ ...l, dayIndex: 12 })).toBe(0);
    expect(daysLeft({ ...l, dayIndex: 99 })).toBe(0);
  });

  it('a world with no saga goal has no count — the chrome hides, not shows 0', () => {
    expect(daysLeft(EMPTY_LADDER)).toBeNull();
  });
});

describe('LIFE-NEED-5 — a flat name, resolved in code', () => {
  it('resolves a person by name OR id, and reports their canonical name', () => {
    expect(resolveNeed('Hélène', facts())).toEqual({ kind: 'who', name: 'Hélène' });
    expect(resolveNeed('helene', facts())).toEqual({ kind: 'who', name: 'Hélène' });
  });

  it('folds accents and case — "helene" must not become an unmet need forever', () => {
    // Same class of bug as the backdrop fallback scoring "café" as `caf`: a
    // name that fails to match is a need that can never be met, which
    // LIFE-NEED-6 forbids outright.
    expect(resolveNeed('HÉLÈNE', facts())).toEqual({ kind: 'who', name: 'Hélène' });
  });

  it('falls through people → things → places', () => {
    expect(resolveNeed('the framed canvas', facts())).toEqual({
      kind: 'what', name: 'the framed canvas',
    });
    expect(resolveNeed('the gallery', facts())).toEqual({
      kind: 'where', name: 'the gallery',
    });
  });

  it('an UNRESOLVABLE name is no need at all — never a wall wearing a name', () => {
    // LIFE-NEED-6. A need pointing at somebody who does not exist can never be
    // met, so the objective would block forever with no clearing move.
    expect(resolveNeed('the Duke of Somewhere', facts())).toBeNull();
    expect(resolveNeed('', facts())).toBeNull();
    expect(resolveNeed(null, facts())).toBeNull();
  });
});

describe('LIFE-NEED-2 — what counts as met', () => {
  it('a person-need needs standing AT the floor, not merely non-negative', () => {
    // LIFE-REP-1: zero means "you are nobody to them yet". Zero does NOT clear.
    const at = (standing: number) =>
      needMet({ kind: 'who', name: 'Hélène' }, facts({ people: [{ id: 'h', name: 'Hélène', standing }] }));
    expect(at(-1)).toBe(false);
    expect(at(0)).toBe(false);
    expect(at(REPUTATION_FLOOR)).toBe(true);
    expect(at(3)).toBe(true);
  });

  it('a missing person is unmet, and absent standing reads as zero', () => {
    expect(needMet({ kind: 'who', name: 'Nobody' }, facts())).toBe(false);
    expect(needMet({ kind: 'who', name: 'Hélène' },
      facts({ people: [{ id: 'h', name: 'Hélène' }] }))).toBe(false);
  });

  it('a thing-need is met by HOLDING it', () => {
    expect(needMet({ kind: 'what', name: 'the framed canvas' }, facts())).toBe(false);
    expect(needMet({ kind: 'what', name: 'the framed canvas' },
      facts({ holding: ['the framed canvas'] }))).toBe(true);
  });

  it('a place-need is met by BEING there', () => {
    expect(needMet({ kind: 'where', name: 'the gallery' }, facts())).toBe(false);
    expect(needMet({ kind: 'where', name: 'the gallery' },
      facts({ here: 'the gallery' }))).toBe(true);
  });

  it('NO need is always met — a free push is part of the rhythm', () => {
    expect(needMet(null, facts())).toBe(true);
    expect(needMet(undefined, facts())).toBe(true);
  });
});

describe('LIFE-NEED-3/5 — the block is fiction, and it always has a door', () => {
  const blocked = (need: NonNullable<ReturnType<typeof resolveNeed>>) => ({
    id: 'o1', text: 'get the good wall', need,
  });

  it('says WHY in fiction — never a number and never the word risky', () => {
    const why = exposureReason(blocked({ kind: 'who', name: 'Hélène' }), facts());
    expect(why).toBe('Hélène has no reason to do this for you yet');
    expect(why).not.toMatch(/risk|\d/i);
  });

  it('phrases the block as REPUTATION, which is true under every label', () => {
    // v2 shipped "Arthur Pringle has no reason to take your word for it yet"
    // under a chip reading "Ask Arthur for the 1954 maps" — nothing about
    // asking for an object turns on whether they believe you. The cost line is
    // written before the model writes the label it sits under, so it can only
    // be about STATE. "no reason to do this for you" is true of all of them.
    expect(exposureReason(blocked({ kind: 'who', name: 'Arthur' }), facts()))
      .toBe('Arthur has no reason to do this for you yet');
  });

  it('every block names its clearing move — LIFE-NEED-5, the load-bearing one', () => {
    const f = facts();
    for (const need of [
      { kind: 'who', name: 'Hélène' },
      { kind: 'what', name: 'the framed canvas' },
      { kind: 'where', name: 'the gallery' },
    ] as const) {
      const o = blocked(need);
      expect(exposureReason(o, f), need.kind).toBeTruthy();
      // A block with no door is a wall. There must never be one without the other.
      expect(clearingMove(o, f), need.kind).toBeTruthy();
    }
  });

  it('a MET need reports neither a block nor a door', () => {
    const o = blocked({ kind: 'where', name: 'the gallery' });
    const f = facts({ here: 'the gallery' });
    expect(exposureReason(o, f)).toBeNull();
    expect(clearingMove(o, f)).toBeNull();
  });

  it('an objective with no need is never exposed', () => {
    expect(exposureReason({ id: 'o', text: 't' }, facts())).toBeNull();
    expect(exposureReason(null, facts())).toBeNull();
  });
});

describe('LIFE-NEED-3/5 — objectiveBlockFor: both halves, or neither', () => {
  const blocked = (need: NonNullable<ReturnType<typeof resolveNeed>>) => ({
    id: 'o1', text: 'get the good wall', need,
  });

  it('returns the reason AND the door together', () => {
    const b = objectiveBlockFor(blocked({ kind: 'who', name: 'Hélène' }), facts());
    expect(b).not.toBeNull();
    // LIFE-NEED-3: fiction, attributed, no number and never the word "risky".
    expect(b!.reason).toContain('Hélène');
    expect(b!.reason).not.toMatch(/risky|\d+%/i);
    // LIFE-NEED-5: the door names the same person the block does, or it is not
    // a door to THIS block.
    expect(b!.clearing).toContain('Hélène');
  });

  it('is NULL when the need is met — no chrome on an unblocked turn', () => {
    expect(
      objectiveBlockFor(
        blocked({ kind: 'where', name: 'the gallery' }),
        facts({ here: 'the gallery' }),
      ),
    ).toBeNull();
  });

  it('is NULL for an objective with no need, and for no objective at all', () => {
    expect(objectiveBlockFor({ id: 'o', text: 't' }, facts())).toBeNull();
    expect(objectiveBlockFor(null, facts())).toBeNull();
    expect(objectiveBlockFor(undefined, facts())).toBeNull();
  });

  it('never yields half a block, for ANY need kind', () => {
    // The guard that matters: LIFE-NEED-5 says a block without a door is a
    // wall. This asserts the pair over every kind rather than trusting that
    // `exposureReason` and `clearingMove` will always agree.
    const f = facts({ places: ['the gallery'], things: ['the framed canvas'] });
    for (const need of [
      { kind: 'who', name: 'Hélène' },
      { kind: 'what', name: 'the framed canvas' },
      { kind: 'where', name: 'the gallery' },
    ] as const) {
      const b = objectiveBlockFor(blocked(need), f);
      expect(b, need.kind).not.toBeNull();
      expect(b!.reason.length, need.kind).toBeGreaterThan(0);
      expect(b!.clearing.length, need.kind).toBeGreaterThan(0);
    }
  });
});
