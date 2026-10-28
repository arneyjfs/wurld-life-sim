/**
 * LIFE-SPEECH-3 — the outbound fill-blank is gated on the OPTION.
 *
 * Spec: docs/specs/life-sim.md — LIFE-SPEECH-3.
 *
 * The reported bug, verbatim: "Questions seem to not be triggering for things
 * I say, ie they are all comprehension questions so far." They could not: a
 * `say` option MUST carry `saysLine`, the client renders it the instant the
 * player picks, and a fill-blank is defined as intercepting a line the player
 * has NOT yet said. No unspoken line survived the pick.
 */
import { describe, expect, it } from 'vitest';
import { gradedSayPlan } from './gradedSayPlan';
import type { StepOption } from './stepSchema';

const option = (over: Partial<StepOption> = {}): StepOption =>
  ({
    id: 'ask',
    practiceText: 'Ask for the key',
    nativeText: 'Ask for the key',
    speechAct: 'say',
    saysLine: {
      practiceText: 'Tu peux me donner la clé ?',
      nativeText: 'Can you give me the key?',
    },
    ...over,
  }) as StepOption;

describe('LIFE-SPEECH-3 — gradedSayPlan', () => {
  it('builds the fill-blank plan from the option’s own line', () => {
    const plan = gradedSayPlan(option({ gradeTarget: 'clé' }), []);
    expect(plan).toEqual({
      kind: 'generation',
      testTarget: 'clé',
      sentenceContext: 'Tu peux me donner la clé ?',
    });
  });

  it('grades a multi-word target', () => {
    const plan = gradedSayPlan(
      option({
        saysLine: {
          practiceText: 'Je voudrais un café, s’il vous plaît.',
          nativeText: 'I would like a coffee, please.',
        },
        gradeTarget: 's’il vous plaît',
      }),
      [],
    );
    expect(plan?.kind).toBe('generation');
    if (plan?.kind !== 'generation') return;
    expect(plan.testTarget).toBe('s’il vous plaît');
  });

  it('returns null with no gradeTarget — the ordinary say path', () => {
    // The overwhelmingly common case. `null` here is not a failure; it is the
    // line landing as the player's bubble exactly as it does today.
    expect(gradedSayPlan(option(), [])).toBeNull();
    expect(gradedSayPlan(option({ gradeTarget: '   ' }), [])).toBeNull();
  });

  it('returns null when the target is not IN the line', () => {
    // `leakViolations` rejects a plan whose testTarget is absent from its
    // sentenceContext ("the generator can't reliably blank out something not
    // in the sentence") — and would burn a retry and a visible wait doing it.
    // Catch it here, where the cost is one skipped practice moment.
    expect(gradedSayPlan(option({ gradeTarget: 'fromage' }), [])).toBeNull();
  });

  it('matches the target case-insensitively but keeps the authored form', () => {
    const plan = gradedSayPlan(
      option({
        saysLine: { practiceText: 'Bonjour, Élise !', nativeText: 'Hello, Élise!' },
        gradeTarget: 'bonjour',
      }),
      [],
    );
    // Blanking is done downstream on the authored casing; the check is only
    // asking "is this phrase in this sentence".
    expect(plan?.kind).toBe('generation');
    if (plan?.kind !== 'generation') return;
    expect(plan.testTarget).toBe('bonjour');
  });

  it('returns null when the target was practised recently', () => {
    // LIFE-EX-PLAN fresh-targets rule. Recycling a target is worse than not
    // grading at all — the player answers from memory of the last turn.
    expect(gradedSayPlan(option({ gradeTarget: 'clé' }), ['clé'])).toBeNull();
    expect(gradedSayPlan(option({ gradeTarget: 'clé' }), ['CLÉ '])).toBeNull();
    expect(gradedSayPlan(option({ gradeTarget: 'clé' }), ['porte'])).not.toBeNull();
  });

  it('returns null on a hear/act option even if it somehow carries both', () => {
    // Direction is structural: only a `say` pick produces a player line, so
    // only a `say` pick can be gated into an outbound fill-blank.
    expect(
      gradedSayPlan(option({ speechAct: 'act', gradeTarget: 'clé' }), []),
    ).toBeNull();
    // (A `hear` case sat here until LIFE-SPEECH-8 retired the value. It asserted
    // the same thing the `act` case above does — "not a say" — so nothing is
    // uncovered by its removal.)
    // An absent speechAct means `act` (LIFE-UI-11), so it is not a say either.
    expect(
      gradedSayPlan(option({ speechAct: undefined, gradeTarget: 'clé' }), []),
    ).toBeNull();
  });

  it('returns null when there is no line to blank out', () => {
    expect(
      gradedSayPlan(option({ saysLine: undefined, gradeTarget: 'clé' }), []),
    ).toBeNull();
  });
});
