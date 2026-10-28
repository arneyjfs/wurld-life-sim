/**
 * LIFE-GOAL-11 — the CLOSE decides whether the objective survives the scene.
 *
 * Reported from a live transcript: *"the immediate goal didn't regenerate in
 * scene 2."* The objective could only end if the mid-turn STEP model
 * volunteered `objectiveDone` / `objectiveClosed` — optional fields, and this
 * repo has measured that shape failing twice over (`hear`, 4 of 2,110 options;
 * `addGoals`, 0 of 95 turns). So an objective about Vic and a failing pylon
 * survived into a scene about Mel and her ledgers.
 *
 * The close is the right judge: it is the one call with the WHOLE scene in
 * view, it already owns history, clocks, cast and canon, and — unlike a
 * mid-turn field — its verdict is REQUIRED by the response schema, so "the
 * model forgot" is not an available outcome.
 *
 * ⚠ THE PROMPT + SCHEMA ROWS MOVED (SRV-PROMPT-3 / PRACTICE-OWN-8). The three
 * assertions that read `SCENE_CLOSE_SCHEMA` and `buildSceneClosePrompt` are now
 * at `functions/src/__tests__/lifeSceneClose.test.ts`, because SRV-PROMPT-8..13
 * batch 4 deleted `prompts/sceneClose.ts` and the server copy had no coverage
 * of its own. They were not dropped — the "required verdict" assertion in
 * particular IS the mechanism this file documents, and losing it at the moment
 * the schema became the only copy is the failure SRV-PROMPT-3 names.
 *
 * What stays here is `ladderDeltaFromVerdict` and the reducer it feeds: the
 * verdict is decided by the model, but what HAPPENS to the player's objective
 * is decided in code, and that code did not move.
 */
import { describe, expect, it } from 'vitest';
import { applyLadderDelta, EMPTY_FACTS, type GoalLadder } from './goalLadder';
import { ladderDeltaFromVerdict } from './sceneCloseObjective';

describe('LIFE-GOAL-11 — the verdict maps onto the ladder reducer', () => {
  const live: GoalLadder = {
    saga: { text: 'keep the crossing open', when: 'Friday', days: 12 },
    objective: { id: 'o1', text: 'get Vic to admit the pylon is failing', need: null },
    done: [],
    dayIndex: 0,
  };
  const apply = (verdict: string, because?: string | null) =>
    applyLadderDelta(
      live,
      ladderDeltaFromVerdict(verdict, because ?? null),
      EMPTY_FACTS,
      { newId: 'obj-next' },
    );

  it('ACHIEVED banks it and frees the slot', () => {
    const after = apply('achieved');
    expect(after.objective).toBeNull();
    expect(after.done).toHaveLength(1);
    expect(after.done[0]!.how).toBe('done');
  });

  it('OVERTAKEN closes it WITH the reason the player is shown', () => {
    // LIFE-GOAL-3: the reason is the whole difference between a close and the
    // silent drop this feature exists to prevent.
    const after = apply('overtaken', 'the bridge was shut before you could ask');
    expect(after.objective).toBeNull();
    expect(after.done[0]!.how).toBe('closed');
    expect(after.done[0]!.because).toBe('the bridge was shut before you could ask');
  });

  it('STANDS leaves it exactly alone', () => {
    const after = apply('stands');
    expect(after.objective?.id).toBe('o1');
    expect(after.done).toHaveLength(0);
  });

  it('OVERTAKEN with no reason DEGRADES to stands rather than dropping it silently', () => {
    // A close with no reason is the silent drop, wearing a verdict. Better to
    // keep the objective than to remove it with nothing to show the player.
    //
    // Asserted on `ladderDeltaFromVerdict` DIRECTLY, not through the reducer:
    // written the other way it passed with this guard deleted, because
    // `applyLadderDelta` independently ignores an empty reason. A test that
    // survives the removal of the code it names is not testing that code.
    expect(ladderDeltaFromVerdict('overtaken', '   ')).toEqual({});
    expect(ladderDeltaFromVerdict('overtaken', null)).toEqual({});
    // …and the reducer agrees, which is the belt to that braces.
    const after = apply('overtaken', '   ');
    expect(after.objective?.id).toBe('o1');
    expect(after.done).toHaveLength(0);
  });

  it('an UNKNOWN verdict is treated as stands', () => {
    // The schema constrains the enum, but the parse must not depend on that:
    // a model that returns something else must not be able to delete the
    // player's objective by accident.
    const after = apply('banana');
    expect(after.objective?.id).toBe('o1');
  });
});
