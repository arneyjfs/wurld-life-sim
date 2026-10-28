/**
 * MOVED from `src/lib/life/prompts/` by SRV-PROMPT-8..13 batch 8 (SRV-PROMPT-3:
 * a retired client prompt module is deleted and its tests MOVE rather than die).
 * The assertions are unchanged; only the imports point at the server modules.
 */
import { describe, expect, it } from 'vitest';
import { buildStepPromptFromWorld as buildLifeStepPrompt } from '../helpers/stepFixture';

/** The client-shaped fixture these tests were written against. */
type LifeStepInput = Record<string, unknown>;
import type { LifeWorld, WorldArc } from '../helpers/stepTypes';

/**
 * LIFE-WORLD-ARC-4 — while NO scene is active, the `<scene>` slot renders
 * the CHAPTER's through-line instead of a bare `status="idle"` tag.
 *
 * This was specified and never implemented. The consequence, measured on a real
 * world (`w-1785453145426-8w0ffo`, 2026-07-31): 110 events, **one**
 * `scene_hook_offered`. `<hookPressure>` was rendering OVERDUE into a prompt
 * that gave the model nothing to hook INTO — no premise, no themes, no
 * recurring cast. "Offer a hook that serves the chapter" has no referent when
 * the chapter is not in the prompt.
 *
 * The idle block is where a scene is BORN, so it is the one place the arc
 * has to be legible.
 */
const baseWorld: LifeWorld = {
  id: 'main',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
};

const arc: WorldArc = {
  chapterNumber: 2,
  premise: 'Marc is trying to get his paintings into a real gallery.',
  playerTeaser: 'The gallery door is open a crack.',
  themes: ['ambition', 'the cost of being seen'],
  status: 'active',
  recurringNpcIds: ['npc-sophie', 'npc-elise'],
  completedSceneMemories: [],
};

const build = (world: LifeWorld) =>
  buildLifeStepPrompt({
    world,
    events: [],
    systemLanguage: 'English',
  } as unknown as LifeStepInput);

describe('LIFE-WORLD-ARC-4 — the idle scene block carries the chapter', () => {
  it('LIFE-WORLD-ARC-4 — renders premise, themes and recurring cast when idle', () => {
    const out = build({ ...baseWorld, currentArc: arc });
    expect(out).toContain('Marc is trying to get his paintings into a real gallery.');
    expect(out).toContain('the cost of being seen');
    expect(out).toContain('npc-sophie');
    // It is still the scene slot, and still idle — the model must not read
    // this as an ACTIVE scene and start emitting `scene.resolved` for it.
    expect(out).toContain('status="idle"');
    expect(out).not.toContain('status="active"');
  });

  it('LIFE-WORLD-ARC-4 — states the chapter number so <chapterPace> has a subject', () => {
    const out = build({ ...baseWorld, currentArc: arc });
    expect(out).toMatch(/chapterNumber="2"/);
  });

  it('LIFE-WORLD-ARC-4 — an ACTIVE scene still wins the slot', () => {
    // The scene outline is the primary context when one is running; the arc
    // colours it but must not compete with it (LIFE-WORLD-ARC-4, second half).
    const out = buildLifeStepPrompt({
      world: { ...baseWorld, currentArc: arc },
      events: [],
      systemLanguage: 'English',
      scene: {
        id: 'c-active',
        status: 'active',
        outline: {
          title: 'The Letter',
          premise: 'A stranger gave you a letter.',
          tone: 'noir',
          practiceFocus: [],
          keyNpcs: [],
          openBranches: [],
          candidateEndings: [{ key: 'heroic', summary: 'You help.' }],
          completionTriggers: ['resolution-beat-landed'],
          estimatedPhaseCount: 5,
        },
        currentPhase: 'rising',
        turnsSinceReplan: 3,
      },
    } as unknown as LifeStepInput);
    expect(out).toContain('status="active"');
    expect(out).toContain('A stranger gave you a letter.');
    expect(out).not.toContain('status="idle"');
  });

  it('LIFE-WORLD-ARC-4 — a world with NO arc still emits the bare idle tag', () => {
    // The stranded state this exists to make visible: between chapters, or on a
    // world whose arc was archived and never regenerated. It must not crash and
    // must not fabricate a chapter.
    const out = build(baseWorld);
    expect(out).toContain('<scene status="idle"/>');
  });
});
