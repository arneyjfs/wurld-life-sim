/**
 * LIFE-FRONT-* — the rules the model is not trusted with.
 *
 * Every test here exists because the corresponding model weakness is
 * documented in docs/specs/story-architecture.md §6.5: arithmetic drift,
 * inability to answer "no change", unreliable "at most one X", and
 * self-reported thresholds. If any of these moved into the prompt, the
 * invariant would be a plea again.
 */
import { describe, expect, it } from 'vitest';
import {
  acceptedSignOf,
  applyClockDeltas,
  breachesRealisticCeiling,
  capPrincipals,
  capThreats,
  conformsToOpeningRule,
  DELTA_BUDGET,
  frontsNeedingSign,
  needsSign,
  driftUnattended,
  SAGA_ADVANCE_COOLDOWN,
  sagaResolution,
  UNATTENDED_DRIFT_SCENES,
} from './fronts';
import type { CastMember, Front } from '@/types/lifeState';

type ClockFixture = { filled: number; size: number; consequence: string; peak?: number; unattended?: number; sinceAdvance?: number };

/** `peak` defaults to `filled` because that is the only history consistent with
 *  a clock standing where it stands — it got there somehow. */
const front = (over: Partial<Omit<Front, 'clock'>> & { id: string; clock?: ClockFixture }): Front => {
  const c = over.clock ?? { filled: 0, size: 6, consequence: 'a door closes' };
  return {
    name: over.id,
    driverId: 'circumstance',
    agenda: 'something is in motion',
    kind: 'opportunity',
    scope: 'chapter',
    resolved: null,
    ...over,
    clock: {
      ...c,
      peak: c.peak ?? c.filled,
      unattended: c.unattended ?? 0,
      // Off cooldown unless a test says otherwise — LIFE-FRONT-10 is exercised
      // by its own cases, and every other case predates it.
      sinceAdvance: c.sinceAdvance ?? 99,
    },
  };
};

describe('LIFE-FRONT-2.1 — the delta budget', () => {
  it('lets a single modest advance through untouched', () => {
    const { fronts, dropped } = applyClockDeltas(
      [front({ id: 'a' })],
      [{ frontId: 'a', delta: 1, reason: 'the player left it alone' }],
    );
    expect(fronts[0]!.clock.filled).toBe(1);
    expect(dropped).toHaveLength(0);
  });

  it('caps the TOTAL across fronts, not just each one', () => {
    // The measured model behaviour this guards: asked for a delta it produces a
    // non-zero one for EVERY front, EVERY close. Three fronts × 8 scenes takes
    // the whole world to maximum inside one chapter.
    const { fronts, dropped } = applyClockDeltas(
      [front({ id: 'a' }), front({ id: 'b' }), front({ id: 'c' })],
      [
        { frontId: 'a', delta: 2, reason: 'r' },
        { frontId: 'b', delta: 2, reason: 'r' },
        { frontId: 'c', delta: 2, reason: 'r' },
      ],
    );
    const moved = fronts.reduce((n, f) => n + f.clock.filled, 0);
    expect(moved).toBe(DELTA_BUDGET);
    expect(dropped.length).toBeGreaterThan(0);
  });

  it('spends the budget on the LARGEST movement, not the first emitted', () => {
    // Truncating in emission order would keep whichever front happened to be
    // first in the array — arbitrary. The model's own sense of significance is
    // the better tiebreak.
    const { fronts } = applyClockDeltas(
      [front({ id: 'small' }), front({ id: 'big' })],
      [
        { frontId: 'small', delta: 1, reason: 'r' },
        { frontId: 'big', delta: 2, reason: 'r' },
      ],
    );
    expect(fronts.find((f) => f.id === 'big')!.clock.filled).toBe(2);
    expect(fronts.find((f) => f.id === 'small')!.clock.filled).toBe(0);
  });

  it('does NOT budget relief — a player pushing back is never rationed', () => {
    const { fronts } = applyClockDeltas(
      [
        front({ id: 'a', clock: { filled: 3, size: 6, consequence: 'c' } }),
        front({ id: 'b', clock: { filled: 3, size: 6, consequence: 'c' } }),
      ],
      [
        { frontId: 'a', delta: -2, reason: 'the player fixed it' },
        { frontId: 'b', delta: -2, reason: 'and this too' },
      ],
    );
    expect(fronts.map((f) => f.clock.filled)).toEqual([1, 1]);
  });

  it('clamps a per-front delta beyond ±2 before the budget sees it', () => {
    const { fronts } = applyClockDeltas(
      [front({ id: 'a' })],
      [{ frontId: 'a', delta: 99, reason: 'r' }],
    );
    expect(fronts[0]!.clock.filled).toBe(DELTA_BUDGET);
  });

  it('ignores a delta naming a front that does not exist', () => {
    const { fronts } = applyClockDeltas(
      [front({ id: 'a' })],
      [{ frontId: 'ghost', delta: 2, reason: 'r' }],
    );
    expect(fronts[0]!.clock.filled).toBe(0);
  });
});

describe('LIFE-FRONT-5 — resolution is READ, never reported', () => {
  it('a clock reaching its size resolves as filled', () => {
    const { fronts } = applyClockDeltas(
      [front({ id: 'a', scope: 'saga', clock: { filled: 5, size: 6, consequence: 'c' } })],
      [{ frontId: 'a', delta: 1, reason: 'nobody attended to it' }],
    );
    expect(fronts[0]!.resolved).toBe('filled');
    expect(sagaResolution(fronts)).toBe('filled');
  });

  it('LIFE-FRONT-5.1 — a clock pushed to zero from past HALF resolves as CLEARED', () => {
    const { fronts } = applyClockDeltas(
      [front({ id: 'a', scope: 'saga', clock: { filled: 4, size: 6, consequence: 'c' }, })],
      [
        { frontId: 'a', delta: -2, reason: 'the player settled it' },
        { frontId: 'a', delta: -2, reason: 'and finished settling it' },
      ],
    );
    expect(fronts[0]!.clock.filled).toBe(0);
    expect(fronts[0]!.resolved).toBe('cleared');
    expect(sagaResolution(fronts)).toBe('cleared');
  });

  it('LIFE-FRONT-5.1 — a clock nudged down from ZERO is NOT cleared', () => {
    // THE REGRESSION. The first headless playthrough ended a whole saga after
    // ONE scene: the model emitted -1 on a front sitting at 0/8, the clamp held
    // it at 0, and "landed on zero going down" read as resolved. A pressure
    // that never advanced has not been overcome — nothing happened to it.
    const { fronts } = applyClockDeltas(
      [front({ id: 'a', scope: 'saga', clock: { filled: 0, size: 8, consequence: 'c' } })],
      [{ frontId: 'a', delta: -1, reason: 'the player was nice to somebody' }],
    );
    expect(fronts[0]!.resolved).toBeNull();
    expect(sagaResolution(fronts)).toBeNull();
  });

  it('LIFE-FRONT-5.1 — pushed back to zero from BELOW half is not cleared either', () => {
    // Half is the threshold at which a front became perceivable (LIFE-FRONT-8).
    // Clearing means undoing something the player could SEE, not tidying away
    // something that never surfaced.
    const { fronts } = applyClockDeltas(
      [front({ id: 'a', scope: 'saga', clock: { filled: 2, size: 8, consequence: 'c' } })],
      [{ frontId: 'a', delta: -2, reason: 'a small favour' }],
    );
    expect(fronts[0]!.clock.filled).toBe(0);
    expect(fronts[0]!.resolved).toBeNull();
  });

  it('LIFE-FRONT-5.1 — peak is a high-water mark, not the current value', () => {
    const { fronts } = applyClockDeltas(
      [front({ id: 'a', clock: { filled: 3, size: 6, consequence: 'c' } })],
      [{ frontId: 'a', delta: -2, reason: 'pushed back' }],
    );
    expect(fronts[0]!.clock).toMatchObject({ filled: 1, peak: 3 });
  });

  it('a clock that merely sits at 0 is NOT cleared', () => {
    // Otherwise every front is born resolved.
    const { fronts } = applyClockDeltas([front({ id: 'a', scope: 'saga' })], []);
    expect(fronts[0]!.resolved).toBeNull();
    expect(sagaResolution(fronts)).toBeNull();
  });

  it('a CHAPTER front filling does not close the saga', () => {
    const { fronts } = applyClockDeltas(
      [
        front({ id: 'top', scope: 'saga' }),
        front({ id: 'sub', scope: 'chapter', clock: { filled: 5, size: 6, consequence: 'c' } }),
      ],
      [{ frontId: 'sub', delta: 1, reason: 'r' }],
    );
    expect(fronts.find((f) => f.id === 'sub')!.resolved).toBe('filled');
    expect(sagaResolution(fronts)).toBeNull();
  });

  it('a resolved front stops moving', () => {
    const { fronts } = applyClockDeltas(
      [front({ id: 'a', resolved: 'filled', clock: { filled: 6, size: 6, consequence: 'c' } })],
      [{ frontId: 'a', delta: -2, reason: 'r' }],
    );
    expect(fronts[0]!.clock.filled).toBe(6);
  });
});

describe('LIFE-FRONT-8 — a clock past half must become perceivable', () => {
  it('flags a clock at or past half', () => {
    expect(needsSign(front({ id: 'a', clock: { filled: 3, size: 6, consequence: 'c' } }))).toBe(true);
    expect(needsSign(front({ id: 'a', clock: { filled: 2, size: 6, consequence: 'c' } }))).toBe(false);
  });

  it('never flags a resolved front', () => {
    expect(
      needsSign(front({ id: 'a', resolved: 'filled', clock: { filled: 6, size: 6, consequence: 'c' } })),
    ).toBe(false);
  });

  it('collects every front the next scene owes a sign for', () => {
    const list = frontsNeedingSign([
      front({ id: 'cold', clock: { filled: 1, size: 8, consequence: 'c' } }),
      front({ id: 'warm', clock: { filled: 4, size: 8, consequence: 'c' } }),
    ]);
    expect(list.map((f) => f.id)).toEqual(['warm']);
  });
});

describe('LIFE-FRONT-3.1 / LIFE-CAST-1.1 — caps are counted, not asked for', () => {
  it('demotes surplus threats rather than dropping the pressure', () => {
    const out = capThreats([
      front({ id: 'a', kind: 'threat' }),
      front({ id: 'b', kind: 'threat' }),
      front({ id: 'c', kind: 'threat' }),
    ]);
    expect(out.filter((f) => f.kind === 'threat')).toHaveLength(1);
    // The pressure survives — it just stops being menace.
    expect(out).toHaveLength(3);
  });

  it('a resolved threat does not consume the live budget', () => {
    const out = capThreats([
      front({ id: 'done', kind: 'threat', resolved: 'filled' }),
      front({ id: 'live', kind: 'threat' }),
    ]);
    expect(out.find((f) => f.id === 'live')!.kind).toBe('threat');
  });

  it('demotes principals past the cap, keeping the established ones', () => {
    const c = (id: string, tier: CastMember['tier']): CastMember => ({
      id, name: id, known: '', tier, voice: '', standing: 0, ties: [],
    });
    const out = capPrincipals([
      c('a', 'principal'), c('b', 'principal'),
      c('c', 'principal'), c('d', 'principal'),
    ]);
    expect(out.filter((x) => x.tier === 'principal').map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('LIFE-FRONT-6 / LIFE-FRONT-7 — register and the opening', () => {
  it('catches a flagrant realistic-ceiling breach', () => {
    expect(breachesRealisticCeiling('the warehouse burns down')).toBe(true);
    expect(breachesRealisticCeiling('Mireille stops speaking to you')).toBe(false);
    expect(breachesRealisticCeiling('the keynote slot goes to someone else')).toBe(false);
  });

  it('chapter 1 admits only slow, non-threatening pressure', () => {
    expect(conformsToOpeningRule(front({ id: 'a', kind: 'relationship', clock: { filled: 0, size: 8, consequence: 'c' } }))).toBe(true);
    // A threat, however slow, is the thing the deleted storyStage existed to
    // prevent on turn one.
    expect(conformsToOpeningRule(front({ id: 'a', kind: 'threat', clock: { filled: 0, size: 12, consequence: 'c' } }))).toBe(false);
    // And a fast clock is a countdown even when it is not a threat.
    expect(conformsToOpeningRule(front({ id: 'a', kind: 'decay', clock: { filled: 0, size: 4, consequence: 'c' } }))).toBe(false);
  });
});

describe('LIFE-FRONT-9 — unattended clocks drift, and the drift is a counter', () => {
  it('nothing moves before the threshold', () => {
    let fronts = [front({ id: 'a' })];
    for (let i = 0; i < UNATTENDED_DRIFT_SCENES - 1; i += 1) {
      const r = driftUnattended(fronts, []);
      fronts = r.fronts;
      expect(r.drifted).toEqual([]);
    }
    expect(fronts[0]!.clock.filled).toBe(0);
    expect(fronts[0]!.clock.unattended).toBe(UNATTENDED_DRIFT_SCENES - 1);
  });

  it('the threshold scene advances it by one and resets the counter', () => {
    // THE REGRESSION this exists for: one playthrough world's saga front sat at
    // 0/8 for six straight scenes because the model — correctly obeying "an
    // empty list is the normal answer" — never moved it. Weather that does not
    // blow. The recurring lesson: a rule the model can satisfy by doing nothing
    // is not a mechanism, so this is a counter in code.
    let fronts = [front({ id: 'a' })];
    let drifted: ReturnType<typeof driftUnattended>['drifted'] = [];
    for (let i = 0; i < UNATTENDED_DRIFT_SCENES; i += 1) {
      const r = driftUnattended(fronts, []);
      fronts = r.fronts;
      drifted = r.drifted;
    }
    expect(drifted.map((d) => d.frontId)).toEqual(['a']);
    expect(fronts[0]!.clock.filled).toBe(1);
    expect(fronts[0]!.clock.unattended).toBe(0);
  });

  it('a delta in EITHER direction counts as attention and resets the counter', () => {
    let fronts = [front({ id: 'a' })];
    fronts = driftUnattended(fronts, []).fronts;
    fronts = driftUnattended(fronts, []).fronts;
    expect(fronts[0]!.clock.unattended).toBe(2);
    fronts = applyClockDeltas(fronts, [{ frontId: 'a', delta: -1, reason: 'the player dealt with it' }]).fronts;
    expect(fronts[0]!.clock.unattended).toBe(0);
    expect(driftUnattended(fronts, []).drifted).toEqual([]);
  });

  it('an attended front does not drift', () => {
    let fronts = [front({ id: 'a' }), front({ id: 'b' })];
    for (let i = 0; i < UNATTENDED_DRIFT_SCENES; i += 1) {
      fronts = driftUnattended(fronts, ['a']).fronts;
    }
    expect(fronts[0]!.clock.filled).toBe(0);
    expect(fronts[1]!.clock.filled).toBe(1);
  });

  it('a resolved front is inert — drift never revives it', () => {
    let fronts = [front({ id: 'a', resolved: 'filled', clock: { filled: 6, size: 6, consequence: 'c' } })];
    for (let i = 0; i < UNATTENDED_DRIFT_SCENES + 2; i += 1) {
      fronts = driftUnattended(fronts, []).fronts;
    }
    expect(fronts[0]!.clock.unattended).toBe(0);
    expect(fronts[0]!.resolved).toBe('filled');
  });

  it('drift can FILL a clock, and the resolution is still read off the integer', () => {
    let fronts = [front({ id: 'a', scope: 'saga', clock: { filled: 5, size: 6, consequence: 'c' } })];
    for (let i = 0; i < UNATTENDED_DRIFT_SCENES; i += 1) {
      fronts = driftUnattended(fronts, []).fronts;
    }
    expect(fronts[0]!.clock.filled).toBe(6);
    expect(sagaResolution(fronts)).toBe('filled');
  });

  it('drift is slow enough to be weather, not story', () => {
    // With DELTA_BUDGET 2 and a saga clock of 8, drift ALONE should take a good
    // many scenes to land — if this number ever gets small, the drift has
    // become the plot.
    let fronts = [front({ id: 'a', clock: { filled: 0, size: 8, consequence: 'c' } })];
    let scenes = 0;
    while (fronts[0]!.clock.filled < 8 && scenes < 100) {
      fronts = driftUnattended(fronts, []).fronts;
      scenes += 1;
    }
    expect(scenes).toBe(8 * UNATTENDED_DRIFT_SCENES);
  });
});

describe('LIFE-FRONT-10 — a saga front cannot advance every close', () => {
  it('blocks a positive delta while the cooldown is unspent', () => {
    // THE REGRESSION: the second playthrough advanced one world's saga front in
    // 5 of 6 closes. Every judgement was locally defensible; the arc collapsed
    // anyway, because DELTA_BUDGET caps a close and is blind to the run.
    const { fronts, dropped } = applyClockDeltas(
      [front({ id: 'a', scope: 'saga', clock: { filled: 2, size: 8, consequence: 'c', sinceAdvance: 0 } })],
      [{ frontId: 'a', delta: 1, reason: 'nobody attended to it' }],
    );
    expect(fronts[0]!.clock.filled).toBe(2);
    expect(dropped).toHaveLength(1);
  });

  it('lets it through once the cooldown is spent', () => {
    const { fronts } = applyClockDeltas(
      [front({ id: 'a', scope: 'saga', clock: { filled: 2, size: 8, consequence: 'c', sinceAdvance: SAGA_ADVANCE_COOLDOWN } })],
      [{ frontId: 'a', delta: 1, reason: 'r' }],
    );
    expect(fronts[0]!.clock.filled).toBe(3);
    expect(fronts[0]!.clock.sinceAdvance).toBe(0);
  });

  it('never rations RELIEF — the player pushing back is always heard', () => {
    const { fronts } = applyClockDeltas(
      [front({ id: 'a', scope: 'saga', clock: { filled: 4, size: 8, consequence: 'c', sinceAdvance: 0 } })],
      [{ frontId: 'a', delta: -2, reason: 'the player dealt with it' }],
    );
    expect(fronts[0]!.clock.filled).toBe(2);
  });

  it('does not ration CHAPTER fronts — those are meant to land inside one', () => {
    const { fronts } = applyClockDeltas(
      [front({ id: 'a', scope: 'chapter', clock: { filled: 2, size: 6, consequence: 'c', sinceAdvance: 0 } })],
      [{ frontId: 'a', delta: 1, reason: 'r' }],
    );
    expect(fronts[0]!.clock.filled).toBe(3);
  });

  it('a rationed saga delta does not eat a chapter front’s budget room', () => {
    const { fronts } = applyClockDeltas(
      [
        front({ id: 'saga', scope: 'saga', clock: { filled: 1, size: 8, consequence: 'c', sinceAdvance: 0 } }),
        front({ id: 'chap', scope: 'chapter' }),
      ],
      [
        { frontId: 'saga', delta: 2, reason: 'r' },
        { frontId: 'chap', delta: 2, reason: 'r' },
      ],
    );
    expect(fronts.find((f) => f.id === 'saga')!.clock.filled).toBe(1);
    expect(fronts.find((f) => f.id === 'chap')!.clock.filled).toBe(2);
  });

  it('the close ages every live clock, which is what spends the cooldown', () => {
    let fronts = [front({ id: 'a', scope: 'saga', clock: { filled: 1, size: 8, consequence: 'c', sinceAdvance: 0 } })];
    fronts = driftUnattended(fronts, ['a']).fronts;
    expect(fronts[0]!.clock.sinceAdvance).toBe(1);
    fronts = driftUnattended(fronts, ['a']).fronts;
    expect(fronts[0]!.clock.sinceAdvance).toBe(2);
    expect(applyClockDeltas(fronts, [{ frontId: 'a', delta: 1, reason: 'r' }]).fronts[0]!.clock.filled).toBe(2);
  });

  it('a saga front advances ONE notch, never two', () => {
    const { fronts } = applyClockDeltas(
      [front({ id: 'a', scope: 'saga', clock: { filled: 0, size: 8, consequence: 'c', sinceAdvance: 99 } })],
      [{ frontId: 'a', delta: 2, reason: 'r' }],
    );
    expect(fronts[0]!.clock.filled).toBe(1);
  });

  it('a saga front cannot fill faster than one notch per two closes, however it is played', () => {
    let fronts = [front({ id: 'a', scope: 'saga', clock: { filled: 0, size: 8, consequence: 'c', sinceAdvance: 99 } })];
    let closes = 0;
    while (fronts[0]!.clock.filled < 8 && closes < 200) {
      // A maximally pushy model: max delta, every single close.
      fronts = applyClockDeltas(fronts, [{ frontId: 'a', delta: 2, reason: 'r' }]).fronts;
      fronts = driftUnattended(fronts, ['a']).fronts;
      closes += 1;
    }
    // 8 notches, one per advance, an advance every other close.
    expect(closes).toBe(8 * SAGA_ADVANCE_COOLDOWN - 1);
  });
});

describe('LIFE-FRONT-8.1 — signOf counts only when it was asked for', () => {
  it('accepts an id the code requested', () => {
    expect(acceptedSignOf('a', ['a', 'b'])).toBe('a');
  });

  it('rejects a volunteered id', () => {
    // The measured failure: the model filled `signOf` on EVERY scene whether or
    // not <makePerceivable> named anything, which marked the front attended on
    // every close and stopped LIFE-FRONT-9's drift from ever firing.
    expect(acceptedSignOf('a', [])).toBeNull();
    expect(acceptedSignOf('b', ['a'])).toBeNull();
  });

  it('treats empty and absent alike', () => {
    expect(acceptedSignOf('', ['a'])).toBeNull();
    expect(acceptedSignOf(null, ['a'])).toBeNull();
    expect(acceptedSignOf(undefined, ['a'])).toBeNull();
  });
});
