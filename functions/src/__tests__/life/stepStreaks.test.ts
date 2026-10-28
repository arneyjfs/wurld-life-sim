/**
 * LIFE-EX-CADENCE-* / LIFE-EX-PLAN-3 — the cadence BLOCKS and the
 * recently-practised list.
 *
 * ⚠ MOVED from `src/lib/life/prompts/stepStreaks.test.ts` by SRV-PROMPT-8..13
 * batch 8: all three subjects write text the model reads, so they crossed with
 * the step prompt. The streak COUNTERS stayed client-side (the debug row reads
 * them). The assertions are unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  CADENCE_DUE,
  CADENCE_OVERDUE,
  PRODUCTION_DUE,
  cadenceTier,
  productionStreak,
  renderPracticeCadence,
  renderProductionCadence,
  type StepEvent as LifeEvent,
} from '../../prompts/lifeStepBlocks';

const ev = (kind: LifeEvent['kind'], n = 0): LifeEvent => ({ id: `${kind}-${n}`, kind });

describe('LIFE-EX-CADENCE-3 — the window actually closes', () => {
  it('says nothing below DUE', () => {
    expect(cadenceTier(0)).toBe('none');
    expect(cadenceTier(CADENCE_DUE - 1)).toBe('none');
  });

  it('nudges at DUE, where placement is still the model’s call', () => {
    expect(cadenceTier(CADENCE_DUE)).toBe('due');
  });

  it('FORCES at OVERDUE — the tier that used to offer an out', () => {
    // THE DEFECT: a real scene ran twelve turns and produced ONE question. Both
    // tiers handed the model an alternative, and the overdue one ended "make
    // the NEXT node the question" — takeable again on the next node, and the
    // next, with nothing counting how many times it had been.
    expect(cadenceTier(CADENCE_OVERDUE)).toBe('forced');
  });

  it('stays forced however long the streak runs', () => {
    // The previous shape had no terminal state at all, which is exactly how a
    // streak of twelve still produced a deferral.
    for (const n of [CADENCE_OVERDUE, 5, 12, 40]) {
      expect(cadenceTier(n), String(n)).toBe('forced');
    }
  });

  it('bounds the question rate to 1-in-3 at best, 1-in-4 at worst', () => {
    // Asserted as arithmetic over the constants so a threshold tweak has to
    // acknowledge what it does to the player-visible rate. THIS TRIPWIRE HAS
    // NOW FIRED TWICE, in opposite directions, and both readings are recorded
    // because the next person will be tempted to move it again.
    //
    // 2026-08-03, 2 → 1: a 12-turn scene came back with TWO questions on the
    // 1-in-3/1-in-4 band, "because a scene lives at the FLOOR of a band, not
    // the ceiling".
    //
    // 2026-08-04, 1 → 2: a full 8-scene world came back with FORTY-FIVE
    // questions in 72 turns — 62% of turns, gaps [1,3,1,2,1,2,3,1,1,1,2,...],
    // only 51% inside the 2-3 band `scoreCadence` scores. A question every
    // other turn is a quiz with a story around it.
    //
    // WHAT THE ARITHMETIC SAYS: with DUE=2/OVERDUE=3 and `forced` genuinely
    // forcing, the streak can reach 3 before the window shuts, so the largest
    // possible gap is 4 and a 12-turn scene gets at least three questions.
    // The 2-in-12 reading is only reachable if the model defers at `forced`,
    // which the current wording forbids outright.
    //
    // WHAT IS NOT SETTLED: the `forced` rewrite landed BEFORE the 2 → 1 tune,
    // so that two-question scene may already have had a forcing `forced` — in
    // which case compliance, not the threshold, is the loose part. Measured
    // 2026-08-04 in the other direction too: the model asked on turns where
    // the tier was `none` and nothing was rendered at all, which is why
    // LIFE-EX-CADENCE-5 now says "not yet" out loud instead of staying silent.
    //
    // So this pair is a MEASURED BET, not a derivation. Re-read the question
    // rate AND Q-TIMING off the next benchmark before trusting it: the failure
    // mode of asking less often is asking at worse moments.
    expect(CADENCE_DUE + 1).toBe(3);
    expect(CADENCE_OVERDUE + 1).toBe(4);
  });
});

/**
 * LIFE-EX-CADENCE-4's rotation tests lived here and are DELETED with the
 * rotation itself (`LIFE-EX-18`). They asserted that the kind alternates and
 * that a demoted question still advances the counter — both true, and both about
 * a mechanism that no longer exists.
 *
 * The kind is now DERIVED from whose line the plan holds (`deriveGradedKind`),
 * and what replaced the rotation as production's guarantee is
 * `renderProductionCadence` — tested below — plus `gradeTarget` on options.
 * Measured before removing it: production held at 0.64 per turn with the kind
 * instruction present and absent alike.
 */

describe('LIFE-EX-CADENCE-5 — saying nothing is not saying no', () => {
  it('renders a "not yet" block at tier none instead of nothing at all', () => {
    // A turn that had JUST been graded carried no cadence block, so the model
    // was free to ask again immediately — and did. Measured gaps of 1 made up
    // most of the run's 62% question rate, and a gap of 1 is a question the
    // cadence machinery never asked for: the streak was 0, so nothing
    // rendered, so nothing objected.
    //
    // Third form of the same lesson as `forced` and the kind rotation: an
    // absent instruction is not a prohibition.
    const out = renderPracticeCadence({
      events: [], isOpeningBeat: false, hasPracticeOutcome: false,
    });
    expect(out).not.toBeNull();
    expect(out).toMatch(/tier="none"/);
    expect(out).toMatch(/do not emit kind "question"/i);
  });

  it('still says nothing on the opening beat or straight after an outcome', () => {
    // Those two already have their own reasons not to carry a cadence line,
    // and adding one would spend tokens to repeat what the turn kind implies.
    expect(renderPracticeCadence({
      events: [], isOpeningBeat: true, hasPracticeOutcome: false,
    })).toBeNull();
    expect(renderPracticeCadence({
      events: [], isOpeningBeat: false, hasPracticeOutcome: true,
    })).toBeNull();
  });
});

/**
 * LIFE-EX-CADENCE-6 — the cadence block stops contradicting the rules it sits
 * next to.
 *
 * Three defects that survived two SI rewrites and every one of the 43 string
 * tests, because all of them were looking at the SYSTEM INSTRUCTION and the
 * instruction doing the damage arrives PER TURN. Measured over 12 archived runs
 * across both SI arms:
 *
 *   · **25 of 25** act-pick question nodes that shipped with no lead-in came
 *     from a turn whose prompt said "(no beats, no top-level options)". The
 *     validator rejects exactly that node (`question-omits-lead-in`), so the
 *     prompt was instructing the model into a retry.
 *   · **40 of 40** fill-blank NODES following a `say` pick landed on a
 *     `kind="fill-blank"` cadence slot — not one appeared anywhere else.
 *   · comprehension slots leaked the tested line at 23-32%, against fill-blank's
 *     8-18%, with the `forced` body saying "have someone say the thing worth
 *     testing, then test it" in as many words.
 *
 * The lesson, stated because it is the third time this session: two prompt
 * REWRITES of a rule the model was disobeying moved nothing. What moved it was
 * finding the other instruction that told it to disobey. A rule can be present,
 * well-worded and unreachable (`LIFE-SI-LEAN-6`), or present and CONTRADICTED —
 * and a substring test cannot see either.
 */
describe('LIFE-EX-CADENCE-6 — no instruction here may contradict the pick', () => {
  const render = (pick?: 'say' | 'act' | null, streak = CADENCE_DUE) =>
    renderPracticeCadence({
      events: Array.from({ length: streak }, (_, i) => ev('decision', i)),
      isOpeningBeat: false,
      hasPracticeOutcome: false,
      pickedSpeechAct: pick,
    })!;

  it('never tells the model a question node has no beats', () => {
    // Unconditional, and wrong after an ACTION pick, where `validateStep`
    // REQUIRES the lead-in beat. `leadInDirective` answers this per turn,
    // conditioned on the pick, and agrees with the validator.
    for (const pick of ['say', 'act', null] as const) {
      for (const streak of [CADENCE_DUE, CADENCE_OVERDUE]) {
        expect(render(pick, streak)).not.toMatch(/no beats/i);
      }
    }
  });

  it('points at <leadIn> for the beat question rather than answering it', () => {
    expect(render('act')).toMatch(/<leadIn>/);
  });

  it('still forbids top-level options, which IS unconditional', () => {
    expect(render('act')).toMatch(/NO top-level options/);
  });

  /**
   * LIFE-EX-18 — these three used to assert a `kind="fill-blank"` /
   * `kind="comprehension"` attribute on the block, and the rules that branched
   * off it. The attribute is gone: the graded kind is derived from whose line
   * the plan holds, not rotated by a counter the model was told to obey.
   *
   * The RULES are not gone, and that is what these now pin. Both survived the
   * rotation's deletion by being restated without it — which they could be,
   * because neither ever needed a slot kind:
   *
   *   the unsaid-line rule   was comprehension-only, is true of both kinds
   *   the after-`say` route  keys off the PICK, which is a different axis
   *
   * Deleting a mechanism is allowed to delete the mechanism. It is not allowed
   * to quietly delete the measured rules riding on it — which it did, and the
   * only reason it was caught is that these tests were specific enough to fail.
   */
  it('after a SAY pick, production routes to the OPTION and not to a fill-blank node', () => {
    // **40 of 40**. The player has already spoken, so there is nothing left for
    // a fill-blank node to intercept — LIFE-SPEECH-3's only working route is a
    // gradeTarget on the option.
    const out = render('say');
    expect(out).toMatch(/ALREADY spoken/);
    expect(out).toMatch(/nothing left to intercept/);
    expect(out).toMatch(/gradeTarget/);
    // LIFE-SPEECH-4: the reply is still fair game. Closing the node route must
    // not be read as "no question this turn".
    expect(out).toMatch(/comprehension of the REPLY/);
  });

  it('an ACT or HEAR pick gets no such note — the node route is open', () => {
    // The routing is conditional on the pick. Suppressing the node form on
    // every turn would lose the comprehension exercise entirely, which is a
    // worse bug than the one being fixed.
    for (const pick of ['act', null] as const) {
      expect(render(pick), String(pick)).not.toMatch(/ALREADY spoken/);
    }
  });

  it('the tested line is never one already on screen — on EITHER kind', () => {
    // A line already rendered with its gloss under it is not a question; the
    // player reads the answer. Measured at 23-32% on comprehension slots. The
    // rule now rides `shape`, so it applies at every tier and to both kinds
    // rather than only where the rotation happened to put it.
    for (const pick of ['say', 'act', null] as const) {
      for (const streak of [CADENCE_DUE, CADENCE_OVERDUE]) {
        const out = render(pick, streak);
        expect(out, `${pick}/${streak}`).toMatch(/has NOT been said yet/);
        expect(out, `${pick}/${streak}`).toMatch(/never write it as a beat/i);
      }
    }
  });

  it('the FORCED escape hatch no longer instructs the leak', () => {
    // It may still rescue a thin moment; what it may not do is pre-write the
    // line the question is about to test.
    const out = render('act', CADENCE_OVERDUE);
    expect(out).toContain('tier="forced"');
    expect(out).not.toMatch(/have someone say the thing worth testing/);
    expect(out).not.toMatch(/the last NPC beat is a line that was heard/);
    expect(out).toMatch(/Do NOT write it as a beat first/);
  });
});

/**
 * LIFE-EX-CADENCE-7 — production gets its own clock.
 *
 * Owner, 2026-08-10: *"I'm definitely finding the model is missing most
 * opportunities to test me saying something."* Two mechanisms, both measured
 * over the 78 turns of the `LIFE-EX-CADENCE-6` runs:
 *
 *   · At `tier="none"` — **54% of all turns** — the model offered 22 `say`
 *     options and marked `gradeTarget` on ONE (4.5%), against 38% at `due`.
 *     "Do not author a gradedPlan" was being read as "no grading this turn",
 *     and `gradeTarget` is not a gradedPlan.
 *   · `cyoaStreak` resets on ANY graded moment, so every comprehension bought
 *     two turns at that tier — i.e. two turns of production suppression.
 */
describe('LIFE-EX-CADENCE-7 — production has a clock of its own', () => {
  const correction = (kind: 'generation' | 'comprehension'): LifeEvent => ({
    id: `c-${kind}`,
    kind: 'correction',
    payload: { kind },
  });

  it('a COMPREHENSION does not reset the production clock', () => {
    // The whole of the owner's report. Reading a line the NPC said is not the
    // same exercise as saying one, and it must not buy silence from the one
    // that has no substitute.
    expect(productionStreak([ev('decision', 1), correction('comprehension'), ev('decision', 2)])).toBe(2);
  });

  it('a FILL-BLANK does reset it', () => {
    expect(productionStreak([ev('decision', 1), correction('generation'), ev('decision', 2)])).toBe(1);
  });

  it('counts BOTH routes into production, because the player cannot tell them apart', () => {
    // A `gradeTarget` on an option and a fill-blank node both resolve as
    // `payload.kind === 'generation'`. What is measured is whether the player
    // SPOKE, not which mechanism got them there.
    expect(productionStreak([correction('generation'), ev('decision', 1)])).toBe(1);
  });

  it('a DEMOTED question does NOT count as production having happened', () => {
    // It means the exercise did not happen. Treating a failure as a spend is
    // LIFE-EX-CADENCE-1's bug in the opposite direction.
    expect(productionStreak([ev('question_demoted'), ev('decision', 1)])).toBe(1);
  });

  it('stays quiet until the streak is actually due', () => {
    const under = Array.from({ length: PRODUCTION_DUE - 1 }, (_, i) => ev('decision', i));
    expect(renderProductionCadence(under)).toBeNull();
  });

  it('asks for an OPTION, never for a question node', () => {
    // The node route is governed by <practiceCadence> and costs a whole turn.
    // Asking for it here would put two blocks back in the business of
    // contradicting each other, which is exactly LIFE-EX-CADENCE-6.
    const out = renderProductionCadence(
      Array.from({ length: PRODUCTION_DUE }, (_, i) => ev('decision', i)),
    )!;
    expect(out).toMatch(/mark `gradeTarget` on exactly ONE/);
    expect(out).toMatch(/NOT a question node/);
    expect(out).toMatch(/does NOT need the practice cadence to be due/);
  });
});

describe('LIFE-EX-CADENCE-7 — the tier-none block stops switching production off', () => {
  it('carves `gradeTarget` out of "do not author a gradedPlan"', () => {
    const out = renderPracticeCadence({
      events: [ev('decision', 1)],
      isOpeningBeat: false,
      hasPracticeOutcome: false,
      pickedSpeechAct: 'act',
    })!;
    expect(out).toContain('tier="none"');
    // The prohibition it is allowed to keep…
    expect(out).toMatch(/do not author a gradedPlan/);
    // …and the one it was never entitled to make.
    expect(out).toMatch(/`gradeTarget` on a "say" OPTION is NOT a gradedPlan/);
    expect(out).toMatch(/welcome on this node/);
  });
});
