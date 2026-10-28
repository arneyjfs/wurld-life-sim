/**
 * LIFE-STORY-STAGE-1/2 — a world's first chapter starts slowly, and the model
 * cannot see the twist while it does.
 *
 * Spec: docs/specs/life-sim.md — LIFE-STORY-STAGE-1 (the counted stage ladder),
 * LIFE-STORY-STAGE-2 (staged saga render).
 *
 * THE BUG THESE EXIST FOR. Reported 2026-08-03: *"The wurld always drops you in
 * to a high drama situation 'full of lies', where 'nothings what it seems'.
 * Characters are never introduced, the universe is not laid up before seeds of
 * story line start to take root. Tension never builds, characters don't
 * develop, relationships don't form."*
 *
 * The assertions below are deliberately about the two things that are
 * STRUCTURAL rather than about prose wording: which stage a turn count maps to,
 * and — the one a prompt rule could never guarantee — that the saga's twist,
 * climax, endings, conflict and antagonist are ABSENT from the prompt while the
 * story has not started. A model that cannot see the twist cannot foreshadow
 * it.
 */
import { describe, expect, it } from 'vitest';
import { CAST_FLOOR, renderStoryStage } from '../../prompts/lifeStepBlocks';
import { STAGE_SETTLING_AT, STAGE_STIRRING_AT, STAGE_UNDERWAY_AT, storyStage } from '../../prompts/lifeStoryStage';

describe('LIFE-STORY-STAGE-1 — the stage ladder', () => {
  it('walks arrival → settling → stirring → underway on the turn count', () => {
    const at = (chapterTurns: number) => storyStage({ chapterNumber: 1, chapterTurns });
    expect(at(0)).toBe('arrival');
    expect(at(STAGE_SETTLING_AT - 1)).toBe('arrival');
    expect(at(STAGE_SETTLING_AT)).toBe('settling');
    expect(at(STAGE_STIRRING_AT - 1)).toBe('settling');
    expect(at(STAGE_STIRRING_AT)).toBe('stirring');
    expect(at(STAGE_UNDERWAY_AT - 1)).toBe('stirring');
    expect(at(STAGE_UNDERWAY_AT)).toBe('underway');
  });

  it('is UNDERWAY from turn zero of chapter 2 — the ladder governs first chapters only', () => {
    // A returning player is not arriving anywhere. Re-running the held-back
    // stages every chapter would make the whole saga a series of beginnings.
    expect(storyStage({ chapterNumber: 2, chapterTurns: 0 })).toBe('underway');
    expect(storyStage({ chapterNumber: 7, chapterTurns: 3 })).toBe('underway');
  });

  it('emits NOTHING once the world is underway', () => {
    // The block caps what the story may contain. Leaving it up past the
    // opening would hold the world at low volume forever — the opposite defect.
    expect(
      renderStoryStage({ stage: 'underway', chapterTurns: 40, castSize: 0 }),
    ).toBe('');
  });

  it('LIFE-STORY-STAGE-1 — ARRIVAL briefs what an opening IS, not just what it may not be', () => {
    // REWRITTEN 2026-08-03 with the block it asserts. The old contract was a
    // seven-item forbidden list on the reasoning that "a list of things to find
    // and delete is observable, where 'don't be dramatic' is not". True, and it
    // produced the opposite failure: told at length what a scene may not
    // contain — and told outright that nothing has happened yet and that is
    // correct — the model wrote a POSTCARD. Observed in production: "The sun
    // shines on the port. Fishing boats float gently in the blue bay. The air
    // smells of salt and hot coffee." Nobody in it, nothing happening, and
    // options that only let the player choose what to look at.
    //
    // The stakes ceiling was never the problem. The premise that its opposite
    // is stillness was. An ordinary morning still has someone in it doing
    // something.
    const block = renderStoryStage({ stage: 'arrival', chapterTurns: 2, castSize: 1 });
    expect(block).toContain('stage="arrival"');
    expect(block).toContain('turns="2"');
    expect(block).toContain('ALREADY UNDERWAY');
    expect(block).toContain('PUT A PERSON IN IT');
    expect(block).toContain('something to DO');
  });

  it('LIFE-STORY-STAGE-1 — ARRIVAL still refuses the thriller register', () => {
    // The ceiling survives the rewrite; it is stated once instead of as a
    // checklist, so it competes with the positive brief instead of drowning it.
    const block = renderStoryStage({ stage: 'arrival', chapterTurns: 2, castSize: 1 });
    expect(block).toContain('the saga\'s conflict has not started');
    expect(block).toContain('make the player uneasy');
    expect(block).toContain('thriller');
  });

  it('SETTLING asks for a WANT, and for someone already met to deepen', () => {
    const block = renderStoryStage({ stage: 'settling', chapterTurns: 8, castSize: 2 });
    expect(block).toContain('WANT');
    expect(block).toMatch(/DEEPEN, DON'T ADD/);
  });

  it('STIRRING allows ONE concrete thing to be noticed, never a revelation', () => {
    const block = renderStoryStage({ stage: 'stirring', chapterTurns: 15, castSize: 3 });
    expect(block).toContain('CONCRETE');
    expect(block).toContain('never as a revelation');
  });

  it('STIRRING bars an NPC from EXPLAINING the thing, and offers what to do instead', () => {
    // Observed in a real 22-turn playthrough (2026-08-03): the discovery
    // itself was right — a black sap found under a walkway — and then two
    // turns later an NPC said "it is the heart of the tree beginning to rot".
    // The chapter's discovery was handed to a player who had done nothing to
    // earn it, in the portentous register that flattens the cast. A rule the
    // model can act on has to name the alternative, not only the ban.
    const block = renderStoryStage({ stage: 'stirring', chapterTurns: 15, castSize: 3 });
    expect(block).toContain('NO CHARACTER EXPLAINS WHAT IT MEANS');
    expect(block).toMatch(/may say so without saying WHAT/);
  });
});

describe('LIFE-STORY-STAGE-1 — the cast floor', () => {
  it('names the SHORTFALL when the roster is under the stage floor', () => {
    // The observable half of "characters are never introduced". The gentle-
    // introduction rules already govern HOW; nothing governed how MANY, so a
    // world could run twenty turns on one NPC in one room and break no rule.
    const block = renderStoryStage({ stage: 'settling', chapterTurns: 8, castSize: 1 });
    expect(block).toContain(`known="1"`);
    expect(block).toContain(`wantedByNow="${CAST_FLOOR.settling}"`);
    expect(block).toContain('Bring in 1 more');
  });

  it('says nothing about the cast when the floor is already met', () => {
    const block = renderStoryStage({ stage: 'settling', chapterTurns: 8, castSize: 4 });
    expect(block).not.toContain('<cast');
  });

  it('the floor RISES across the stages — a world grows a cast', () => {
    expect(CAST_FLOOR.arrival).toBeLessThan(CAST_FLOOR.settling);
    expect(CAST_FLOOR.settling).toBeLessThan(CAST_FLOOR.stirring);
  });
});

/**
 * LIFE-STORY-STAGE-3 — WHAT AN EARLY SCENE MAY BE ABOUT MOVED SERVER-SIDE.
 *
 * `renderSceneStage` was the SCENE PLANNER's copy of this ladder and
 * `prompts/sceneOpen.ts` was its only consumer, so SRV-PROMPT-8..13 batch 4
 * moved it whole to `functions/src/prompts/lifeStoryStage.ts` and these four
 * rows with it, to `functions/src/__tests__/lifeSceneOpen.test.ts`
 * (SRV-PROMPT-3: tests move, they do not die).
 *
 * ⚠ `storyStage` and the three thresholds above are now DUPLICATED, because
 * `prompts/step.ts` still reads them here. The duplication expires with batch 8
 * and `tests/playthrough/serverPromptParity.test.ts` guards it until then —
 * including a sweep asserting both classifiers agree on every turn of the
 * ladder, which is what stops a threshold retuned on one side putting the turn
 * block and the scene subject on different rungs.
 */
