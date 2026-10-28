/**
 * LIFE-GOAL-3/4 — the DIRECTIVE, which is the half `currentGoals` never had.
 *
 * `currentGoals` was rendered as readable state and offered in the output
 * schema, and the model wrote to it 0 times in 95 measured turns. These tests
 * pin the thing that makes this different: a per-turn block the model has to
 * ANSWER, whose wording changes with the ladder's state.
 */
import { describe, expect, it } from 'vitest';
import {
  renderGoalDirective,
  renderGoalState,
  type StepGoalLadder,
} from '../../prompts/lifeStepBlocks';

/**
 * ⚠ ADAPTED BY SRV-PROMPT-8..13 batch 8, and the adaptation is the point.
 *
 * `renderGoalDirective` took `(ladder, facts)` and called
 * `exposureReason(objective, facts)` itself. `worldFactsFor` reduces the whole
 * world and the whole roster, and it is ALSO read by `clearingMove` for the
 * option grid — so it stayed client-side and its ANSWER travels instead
 * (`goalLadder.blocked`). The fixtures below therefore state the block
 * directly, which is what the wire carries.
 *
 * `daysLeft` moved the same way: the ladder used to carry `days` + `dayIndex`
 * and the renderer subtracted; it now carries the difference.
 *
 * Every ASSERTION is unchanged.
 */
const ladder = (over: Partial<StepGoalLadder> = {}): StepGoalLadder => ({
  saga: { text: 'hang work in the Friday show', when: 'Friday', daysLeft: 12 },
  objective: { text: 'find the key' },
  done: [],
  ...over,
});

describe('LIFE-GOAL-4 — the directive asks something different in each state', () => {
  it('NO objective: asks the model to mint one, tied to the saga goal', () => {
    const out = renderGoalDirective(ladder({ objective: null }))!;
    expect(out).toContain('state="none"');
    expect(out).toContain('nextObjective');
    // Tied to the distant goal, so the ladder is a ladder and not a list of
    // unrelated errands.
    expect(out).toContain('hang work in the Friday show');
  });

  it('LIVE: says the objective STANDS, in as many words', () => {
    // The sentence that answers "the key never came back up again". A model
    // told only what the objective IS will replace it; one told it survives a
    // turn that ignored it will not.
    const out = renderGoalDirective(ladder())!;
    expect(out).toContain('state="live"');
    expect(out).toMatch(/STANDS/);
    expect(out).toMatch(/not over because they did something else/);
  });

  it('LIVE: tells the model its replacement will be IGNORED', () => {
    // The reducer drops it silently. A model whose output is discarded without
    // being told keeps producing it — so the prompt says so out loud.
    expect(renderGoalDirective(ladder())!).toMatch(/IGNORED while this one is live/);
  });

  it('LIVE: names both ways it can legitimately end, and no third', () => {
    const out = renderGoalDirective(ladder())!;
    expect(out).toContain('objectiveDone');
    expect(out).toContain('objectiveClosed');
  });

  it('BLOCKED: reports the block so the prose agrees with the chip', () => {
    const out = renderGoalDirective(
      ladder({
        objective: { text: 'get the good wall', need: { name: 'Hélène' } },
        // `exposureReason({kind:'who', name:'Hélène'}, facts)` — resolved at
        // the call site now, so the fixture carries its answer.
        blocked: 'Hélène has no reason to do this for you yet',
      }),
    )!;
    expect(out).toContain('state="blocked"');
    expect(out).toContain('Hélène has no reason to do this for you yet');
    // The obvious model move is to make the obstacle evaporate in narration.
    expect(out).toMatch(/do not write a beat in which the obstacle quietly resolves/);
    // LIFE-NEED-4: pushing anyway still costs the turn and still moves the story.
    expect(out).toMatch(/still learn something/);
  });

  it('a MET need is not blocked — the directive drops back to live', () => {
    // A MET need makes `exposureReason` return null, so nothing travels.
    const out = renderGoalDirective(
      ladder({ objective: { text: 'be at the gallery', need: { name: 'the gallery' } } }),
    )!;
    expect(out).toContain('state="live"');
  });

  it('a world with no saga goal gets NO directive — nothing to hang it on', () => {
    expect(renderGoalDirective(ladder({ saga: undefined }))).toBeNull();
    expect(renderGoalDirective(null)).toBeNull();
  });
});

describe('LIFE-GOAL-1 — the state block', () => {
  it('carries the goal, the day count and the live objective', () => {
    const out = renderGoalState(
      ladder({ saga: { text: 'hang work in the Friday show', when: 'Friday', daysLeft: 8 } }),
    )!;
    expect(out).toContain('<sagaGoal by="Friday" daysLeft="8">hang work in the Friday show</sagaGoal>');
    expect(out).toContain('<objective>find the key</objective>');
  });

  it('names an objective’s need so the model can see what it waits on', () => {
    const out = renderGoalState(ladder({
      objective: { text: 'get the good wall', need: { name: 'Hélène' } },
    }))!;
    expect(out).toContain('needs="Hélène"');
  });

  it('shows what SETTLED, with the reason a close carried', () => {
    // So the model can refer back to what the player achieved instead of
    // re-proposing it, and so a closed objective reads as closed.
    const out = renderGoalState(ladder({
      done: [
        { text: 'find the key', how: 'closed', because: 'Bébert changed the lock' },
        { text: 'meet Rosa', how: 'done' },
      ],
    }))!;
    expect(out).toContain('<settled how="closed">find the key — Bébert changed the lock</settled>');
    expect(out).toContain('<settled how="done">meet Rosa</settled>');
  });

  it('caps the settled list — a ledger, not a transcript', () => {
    const out = renderGoalState(ladder({
      done: Array.from({ length: 9 }, (_, i) => ({ text: `thing ${i}`, how: 'done' as const })),
    }))!;
    expect(out.match(/<settled/g) ?? []).toHaveLength(3);
    expect(out).toContain('thing 8');
    expect(out).not.toContain('thing 5');
  });

  it('renders nothing for an absent ladder rather than an empty block', () => {
    expect(renderGoalState(null)).toBeNull();
    expect(renderGoalState(undefined)).toBeNull();
  });
});
