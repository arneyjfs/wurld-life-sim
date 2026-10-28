/**
 * LIFE-GRID-4 / LIFE-GRID-5 — the grid blocks as they reach the LIVE prompt.
 *
 * ⚠ MOVED from `src/lib/life/optionGridWiring.test.ts` by SRV-PROMPT-8..13
 * batch 8. `optionGrid.test.ts` covers the mechanics in isolation; this asserts
 * they are actually WIRED into the assembled prompt — so it had to follow the
 * prompt server-side. The RETRY-ladder half of that file stayed behind, because
 * the spread backstop and the `actionType` coercion judge the model's answer.
 *
 * The assertions are unchanged; the fixture is mapped by `stepFixture.ts`.
 */
import { describe, expect, it } from 'vitest';
import { actionShapesFromEvents, requiredTypeForTurn } from '../../prompts/lifeStepBlocks';
import { buildStepPromptFromWorld as buildLifeStepPrompt } from '../helpers/stepFixture';
import type { LifeEvent, LifeWorld } from '../helpers/stepTypes';

const world = {
  id: 'w1',
  characterName: 'Alice',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  systemLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
} as unknown as LifeWorld;

const decision = (actionType?: string, targetId?: string): LifeEvent => ({
  id: `d-${actionType ?? 'x'}-${targetId ?? ''}-${Math.random()}`,
  kind: 'decision',
  payload: { choiceId: 'c', text: 'did a thing', ...(actionType ? { actionType } : {}), ...(targetId ? { targetId } : {}) },
});

const build = (events: LifeEvent[]) =>
  buildLifeStepPrompt({
    world,
    events,
    choice: null,
    freeText: null,
    practiceOutcome: null,
    isOpeningBeat: events.length === 0,
    scene: null,
    npcs: [],
    requestKind: 'live',
    currentNodeKind: null,
  });

describe('LIFE-GRID-5 — the required type reaches the live prompt', () => {
  it('every turn carries a <requiredAction> block', () => {
    expect(build([])).toContain('<requiredAction type="do"');
  });

  it('the type rotates with the turn, so two adjacent turns differ', () => {
    const a = build([]);
    const b = build([decision('do')]);
    expect(a).toContain('<requiredAction type="do"');
    expect(b).toContain('<requiredAction type="move"');
  });

  it('a passive required type also demands an ACTIVE option', () => {
    // LIFE-GRID-1.2 prevented rather than rejected: on an `observe` turn
    // nothing else forces an option that acts on the world.
    const observeTurn = build([decision('do'), decision('move')]);
    expect(requiredTypeForTurn(2)).toBe('observe');
    expect(observeTurn).toContain('<requiredAction type="active"');
  });

  it('an ACTIVE required type does not need the extra block', () => {
    expect(build([])).not.toContain('type="active"');
  });
});

describe('LIFE-GRID-4 — the cross-turn memory reaches the live prompt', () => {
  it('renders the shapes already in play', () => {
    const p = build([decision('do', 'rey'), decision('ask', 'lucas')]);
    expect(p).toContain('<recentActions>do:rey · ask:lucas</recentActions>');
    expect(p).toContain('already in play');
  });

  it('is absent on the opening turn rather than an empty block', () => {
    expect(build([])).not.toContain('<recentActions>');
  });

  it('skips legacy decisions with no actionType instead of guessing', () => {
    // Worlds created before LIFE-GRID-1.1 have decision rows without the field.
    // A WRONG shape here is worse than a missing one — the model is told not to
    // repeat what this block lists.
    expect(actionShapesFromEvents([decision(), decision('move')])).toEqual([
      { type: 'move', targetId: null },
    ]);
  });

  it('ignores an actionType that is not one of the six', () => {
    expect(actionShapesFromEvents([decision('sing')])).toEqual([]);
  });

  it('reads only decisions, never beats', () => {
    const beat: LifeEvent = { id: 'b', kind: 'beat', payload: { actionType: 'do' } };
    expect(actionShapesFromEvents([beat, decision('ask')])).toEqual([
      { type: 'ask', targetId: null },
    ]);
  });
});
