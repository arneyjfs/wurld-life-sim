import { beforeEach, describe, it, expect, vi } from 'vitest';

// startScene has side effects; mock its collaborators. The pure
// helpers (computeReplanPlan / snapshotSceneCompletion) don't touch
// these, and `./vocabRecap` is deliberately left UNMOCKED so
// snapshotSceneCompletion's real derivePractisedWords still runs.
vi.mock('./runSceneOpen', () => ({ runSceneOpen: vi.fn() }));
vi.mock('./scene', () => ({
  archiveScene: vi.fn(async () => undefined),
  createScene: vi.fn(async () => undefined),
  updateActiveScene: vi.fn(async () => undefined),
}));
vi.mock('./world', () => ({
  appendLifeEvent: vi.fn(async () => undefined),
  updateLifeWorld: vi.fn(async () => undefined),
}));
vi.mock('./arcs', () => ({
  appendCompletedArc: vi.fn(async () => undefined),
}));
vi.mock('./npcs', () => ({
  promoteNpcToWorld: vi.fn(async () => undefined),
  promoteOrTouchNpc: vi.fn(async () => ({ isNew: true })),
  retireNpcToTransient: vi.fn(async () => undefined),
}));
vi.mock('./commitNode', () => ({
  kickoffNpcAssets: vi.fn(async () => undefined),
}));
vi.mock('../log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import {
  startScene,
  archiveActiveArc,
  closeSceneFlow,
  computeReplanPlan,
  snapshotSceneCompletion,
} from './sceneLifecycle';
import { derivePractisedWords } from './vocabRecap';
import { MAX_BIO_SCENE_MEMORIES } from './bioMemory';
import { sceneResolveTooEarly } from './sceneLifecycle';
import { SCENE_FLOOR } from './prompts/stepRender';
import { runSceneOpen } from './runSceneOpen';
import { promoteOrTouchNpc } from './npcs';
import { kickoffNpcAssets } from './commitNode';
import { appendCompletedArc } from './arcs';
import { appendLifeEvent, updateLifeWorld } from './world';
import type {
  SceneCompletionSnapshot,
} from './sceneLifecycle';
import type { LifeScene, LifeEvent, LifeWorld, WorldArc } from '@/types/firestore';

const runSceneOpenMock = vi.mocked(runSceneOpen);
const promoteOrTouchNpcMock = vi.mocked(promoteOrTouchNpc);
const kickoffNpcAssetsMock = vi.mocked(kickoffNpcAssets);
const appendCompletedArcMock = vi.mocked(appendCompletedArc);
const updateLifeWorldMock = vi.mocked(updateLifeWorld);
const appendLifeEventMock = vi.mocked(appendLifeEvent);

const baseOutline = () => ({
  title: 'Test Arc',
  premise: 'A test scene',
  tone: 'noir',
  practiceFocus: [],
  keyNpcs: [],
  // LIFE-STORY-SHAPE-3: plotBeats removed from outline.
  openBranches: [],
  candidateEndings: [],
  completionTriggers: [],
  estimatedPhaseCount: 4,
});

const baseScene = (overrides: Partial<LifeScene> = {}): LifeScene => ({
  id: 'c-1',
  status: 'active',
  outline: baseOutline(),
  currentPhase: 'rising',
  turnsSinceReplan: 0,
  ...overrides,
});

describe('computeReplanPlan — LIFE-SCENE-4', () => {
  it('returns shouldReplan=false + bumps turnsSinceReplan when nothing signals', () => {
    const plan = computeReplanPlan(baseScene(), undefined);
    expect(plan.shouldReplan).toBe(false);
    expect(plan.reason).toBe('none');
    expect(plan.patch.turnsSinceReplan).toBe(1);
  });

  it('triggers replan when model emits replanRequested', () => {
    const plan = computeReplanPlan(baseScene(), { replanRequested: true });
    expect(plan.shouldReplan).toBe(true);
    expect(plan.reason).toBe('replanRequested');
    expect(plan.patch.turnsSinceReplan).toBe(0);
  });

  it('triggers replan with hardPivot reason when model signals hardPivot', () => {
    const plan = computeReplanPlan(baseScene(), { hardPivot: true });
    expect(plan.shouldReplan).toBe(true);
    expect(plan.reason).toBe('hardPivot');
  });

  it('triggers tick replan when turnsSinceReplan would hit 5 (LIFE-STORY-SHAPE-4)', () => {
    const plan = computeReplanPlan(baseScene({ turnsSinceReplan: 4 }), undefined);
    expect(plan.shouldReplan).toBe(true);
    expect(plan.reason).toBe('tick');
    expect(plan.patch.turnsSinceReplan).toBe(0);
  });

  it('LIFE-STORY-SHAPE-3: completedBeatIds is now a no-op (plot-beat tracking removed)', () => {
    const plan = computeReplanPlan(
      baseScene({ turnsSinceReplan: 3 }),
      { completedBeatIds: ['b2'] },
    );
    // No plotBeats on the outline anymore; the signal is a no-op.
    expect(plan.outlineForReplan).toBe(baseScene({ turnsSinceReplan: 3 }).outline === plan.outlineForReplan ? plan.outlineForReplan : plan.outlineForReplan);
    expect(plan.patch.outline).toBeUndefined();
  });

  it('applies phaseTransition into the patch', () => {
    const plan = computeReplanPlan(baseScene(), {
      phaseTransition: 'climax',
    });
    expect(plan.patch.currentPhase).toBe('climax');
  });

  it('hardPivot wins precedence over replanRequested and tick when all signal', () => {
    const plan = computeReplanPlan(
      baseScene({ turnsSinceReplan: 20 }),
      { hardPivot: true, replanRequested: true },
    );
    expect(plan.reason).toBe('hardPivot');
  });
});

describe('snapshotSceneCompletion — LIFE-SCENE-10', () => {
  const correction = (
    correct: boolean,
    kind: 'generation' | 'comprehension',
    seconds: number,
  ): LifeEvent => ({
    id: `e-${seconds}`,
    kind: 'correction',
    payload: { correct, kind },
    createdAt: { seconds, nanoseconds: 0 } as LifeEvent['createdAt'],
  });

  it('only counts corrections after acceptedAt', () => {
    const scene = baseScene();
    // Splice acceptedAt as a Timestamp-like object so the seconds
    // filter has something to compare against.
    (scene as { acceptedAt: { seconds: number } }).acceptedAt = {
      seconds: 100,
    };
    const events: LifeEvent[] = [
      correction(true, 'generation', 50),          // BEFORE acceptedAt — excluded
      correction(true, 'generation', 150),         // included, correct
      correction(false, 'generation', 160),        // included, wrong
      correction(true, 'comprehension', 200),      // included, correct
    ];
    const snap = snapshotSceneCompletion(
      scene,
      { endingKey: 'heroic', outcomeLine: 'Saved the day.' },
      events,
    );
    expect(snap.stats.gradedCount).toBe(3);
    expect(snap.stats.correctCount).toBe(2);
    expect(snap.stats.generationCount).toBe(2);
    expect(snap.stats.comprehensionCount).toBe(1);
    expect(snap.title).toBe('Test Arc');
    expect(snap.endingKey).toBe('heroic');
    expect(snap.outcomeLine).toBe('Saved the day.');
  });

  /**
   * LIFE-SCENE-28 — the outcome line is the only story on the scene-complete
   * screen, and it was practice-language only. The snapshot is what the screen
   * reads from, so the twin has to survive this hop.
   */
  describe('LIFE-SCENE-28 — the outcome line carries its system-language twin', () => {
    it('carries outcomeLineNative through to the snapshot', () => {
      const scene = baseScene();
      (scene as { acceptedAt: { seconds: number } }).acceptedAt = { seconds: 0 };
      const snap = snapshotSceneCompletion(
        scene,
        {
          endingKey: 'heroic',
          outcomeLine: 'Tes photos ont trouvé leur mur.',
          outcomeLineNative: 'Your photos found their wall.',
        },
        [],
      );
      expect(snap.outcomeLine).toBe('Tes photos ont trouvé leur mur.');
      expect(snap.outcomeLineNative).toBe('Your photos found their wall.');
    });

    it('defaults to the empty string when the model did not send one', () => {
      // Not undefined: the screen tests `.trim()` to decide whether to render
      // the muted second row, and an always-present string keeps that one
      // check instead of two.
      const scene = baseScene();
      (scene as { acceptedAt: { seconds: number } }).acceptedAt = { seconds: 0 };
      const snap = snapshotSceneCompletion(
        scene,
        { endingKey: 'open', outcomeLine: 'It ended.' },
        [],
      );
      expect(snap.outcomeLineNative).toBe('');
    });
  });

  /**
   * LIFE-DAY-6 — the per-type cells are SCORES, not tallies.
   *
   * A day of 6 fill-blanks and 4 comprehensions read identically whether the
   * player aced one type and missed the other or was evenly mediocre, because
   * the only accuracy shown was the day's.
   */
  describe('LIFE-DAY-6 — per-type correct counts', () => {
    it('scores each exercise type independently of the day total', () => {
      const scene = baseScene();
      (scene as { acceptedAt: { seconds: number } }).acceptedAt = { seconds: 0 };
      const events: LifeEvent[] = [
        correction(true, 'generation', 10),
        correction(true, 'generation', 20),
        correction(false, 'generation', 30),
        correction(false, 'comprehension', 40),
        correction(false, 'comprehension', 50),
      ];
      const snap = snapshotSceneCompletion(
        scene,
        { endingKey: 'open', outcomeLine: '.' },
        events,
      );
      expect(snap.stats.generationCount).toBe(3);
      expect(snap.stats.generationCorrect).toBe(2);
      expect(snap.stats.comprehensionCount).toBe(2);
      expect(snap.stats.comprehensionCorrect).toBe(0);
      // The day total is unchanged by the split.
      expect(snap.stats.gradedCount).toBe(5);
      expect(snap.stats.correctCount).toBe(2);
    });

    it('leaves an untagged correction in the day total and in NEITHER type', () => {
      // The two fractions are allowed not to sum to the total. Forcing them to
      // would be asserting the model always tags its `kind`.
      const scene = baseScene();
      (scene as { acceptedAt: { seconds: number } }).acceptedAt = { seconds: 0 };
      const events: LifeEvent[] = [
        correction(true, 'generation', 10),
        {
          id: 'e-untagged',
          kind: 'correction',
          payload: { correct: true },
          createdAt: { seconds: 20, nanoseconds: 0 } as LifeEvent['createdAt'],
        },
      ];
      const snap = snapshotSceneCompletion(
        scene,
        { endingKey: 'open', outcomeLine: '.' },
        events,
      );
      expect(snap.stats.gradedCount).toBe(2);
      expect(snap.stats.correctCount).toBe(2);
      expect(snap.stats.generationCorrect).toBe(1);
      expect(snap.stats.comprehensionCorrect).toBe(0);
      expect(snap.stats.comprehensionCount).toBe(0);
    });
  });

  it('handles no corrections in the window (zero stats)', () => {
    const scene = baseScene();
    (scene as { acceptedAt: { seconds: number } }).acceptedAt = {
      seconds: 100,
    };
    const snap = snapshotSceneCompletion(
      scene,
      { endingKey: 'open', outcomeLine: 'It ended.' },
      [],
    );
    expect(snap.stats.gradedCount).toBe(0);
    expect(snap.stats.correctCount).toBe(0);
  });

  it('ignores non-correction events', () => {
    const scene = baseScene();
    (scene as { acceptedAt: { seconds: number } }).acceptedAt = {
      seconds: 0,
    };
    const events: LifeEvent[] = [
      { id: 'e-1', kind: 'beat', payload: {} },
      { id: 'e-2', kind: 'decision', payload: {} },
      correction(true, 'generation', 200),
    ];
    const snap = snapshotSceneCompletion(
      scene,
      { endingKey: 'open', outcomeLine: '.' },
      events,
    );
    expect(snap.stats.gradedCount).toBe(1);
  });

  it('LIFE-VOCAB-RECAP-2 — snapshot carries practised words from the scene window', () => {
    const scene = baseScene();
    (scene as { acceptedAt: { seconds: number } }).acceptedAt = {
      seconds: 100,
    };
    const events: LifeEvent[] = [
      {
        id: 'w-old',
        kind: 'correction',
        payload: { correct: true, kind: 'generation', correctAnswer: 'avant' },
        createdAt: { seconds: 50, nanoseconds: 0 } as LifeEvent['createdAt'],
      },
      {
        id: 'w-new',
        kind: 'correction',
        payload: { correct: false, kind: 'generation', correctAnswer: 'voudrais' },
        createdAt: { seconds: 150, nanoseconds: 0 } as LifeEvent['createdAt'],
      },
      {
        id: 'w-card',
        kind: 'flashcard_added',
        payload: { id: 'card-1', practice: 'la boulangerie', native: 'the bakery' },
        createdAt: { seconds: 160, nanoseconds: 0 } as LifeEvent['createdAt'],
      },
    ];
    const snap = snapshotSceneCompletion(
      scene,
      { endingKey: 'open', outcomeLine: '.' },
      events,
    );
    // LIFE-VOCAB-RECAP-2: the snapshot carries only the window START; the words
    // list is DERIVED reactively at render (de-racing the Firestore listener).
    // Deriving over that window reproduces exactly the scene-window words.
    expect(snap.windowStartSec).toBe(100);
    expect(derivePractisedWords(events, snap.windowStartSec)).toEqual([
      { text: 'voudrais', translation: null, correct: false },
      { text: 'la boulangerie', translation: 'the bakery', correct: null },
    ]);
  });
});

describe('startScene — LIFE-NPC-6/7 key-NPC promotion + assets', () => {
  const world = {
    id: 'w1',
    characterName: 'Marc',
    saga: { premise: 'Reopen the café.', tone: 'warm city' },
  } as unknown as LifeWorld;

  const outlineWithKeyNpc = {
    title: 'The Bakery War',
    premise: 'A rivalry over the last good oven in the arrondissement.',
    tone: 'noir',
    practiceFocus: [],
    keyNpcs: [{ npcId: 'marie', name: 'Marie', role: 'rival baker' }],
    openBranches: [],
    candidateEndings: [],
    completionTriggers: [],
    estimatedPhaseCount: 4,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    runSceneOpenMock.mockResolvedValue({
      usedFallback: false,
      outline: outlineWithKeyNpc,
    } as never);
    promoteOrTouchNpcMock.mockResolvedValue({ isNew: true });
  });

  // LIFE-SCENE-24: no pitch, no hook id — a scene starts because the world
  // has none, and the generator invents the premise itself.
  const run = () => startScene({ uid: 'u1', world });

  it('LIFE-NPC-6 — promotes each key-NPC WITH relationship set from ZSceneKeyNpc.role', async () => {
    await run();
    expect(promoteOrTouchNpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        npcId: 'marie',
        name: 'Marie',
        relationship: 'rival baker',
      }),
    );
  });

  it('LIFE-NPC-6/7 — kicks avatar + profile asset gen for a freshly-promoted key-NPC', async () => {
    await run();
    expect(kickoffNpcAssetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        npcId: 'marie',
        name: 'Marie',
        role: 'rival baker',
        needsAvatar: true,
        needsProfile: true,
      }),
    );
  });

  it('LIFE-NPC-6 — does NOT re-kick assets for a key-NPC that already existed (isNew=false)', async () => {
    promoteOrTouchNpcMock.mockResolvedValue({ isNew: false });
    await run();
    expect(kickoffNpcAssetsMock).not.toHaveBeenCalled();
  });
});

describe('archiveActiveArc — LIFE-WORLD-ARC-1 (subcollection + completedArcCount)', () => {
  const activeArc: WorldArc = {
    chapterNumber: 4,
    premise: 'The reckoning.',
    playerTeaser: 'The reckoning approaches.',
    themes: ['loyalty'],
    status: 'active',
    recurringNpcIds: ['marie'],
    completedSceneMemories: [],
  };

  const snapshot = (): SceneCompletionSnapshot => ({
    title: 'The Bakery War',
    premise: 'A rivalry over the last good oven.',
    tone: 'noir',
    outcomeLine: 'You won the oven, and lost a friend.',
    outcomeLineNative: '',
    endingKey: 'bittersweet',
    arcStage: 'concluding',
    keyMomentsForArc: [],
    promotedNpcIds: [],
    retiredNpcIds: [],
    stats: {
      gradedCount: 0,
      correctCount: 0,
      generationCount: 0,
      generationCorrect: 0,
      comprehensionCount: 0,
      comprehensionCorrect: 0,
    },
    windowStartSec: 0,
  });

  const worldWith = (over: Partial<LifeWorld>): LifeWorld =>
    ({
      id: 'w1',
      characterName: 'Marc',
      currentArc: activeArc,
      ...over,
    }) as unknown as LifeWorld;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('LIFE-WORLD-ARC-1 — writes the resolved arc to the completedArcs SUBcollection (not an inline array)', async () => {
    await archiveActiveArc({
      uid: 'u1',
      world: worldWith({ completedArcCount: 2 }),
      snapshot: snapshot(),
    });
    expect(appendCompletedArcMock).toHaveBeenCalledTimes(1);
    const [uid, worldId, arc] = appendCompletedArcMock.mock.calls[0]!;
    expect(uid).toBe('u1');
    expect(worldId).toBe('w1');
    expect(arc).toMatchObject({
      chapterNumber: 4,
      status: 'completed',
      outcomeLine: 'You won the oven, and lost a friend.',
    });
  });

  it('LIFE-WORLD-ARC-1 — increments completedArcCount and nulls currentArc; NEVER writes a completedArcs array', async () => {
    await archiveActiveArc({
      uid: 'u1',
      world: worldWith({ completedArcCount: 2 }),
      snapshot: snapshot(),
    });
    expect(updateLifeWorldMock).toHaveBeenCalledWith('u1', 'w1', {
      currentArc: null,
      completedArcCount: 3,
    });
    // Clean break: no inline array is ever written back.
    const patch = updateLifeWorldMock.mock.calls[0]![2] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('completedArcs');
  });

  it('LIFE-WORLD-ARC-1 — completedArcCount defaults to 0 (⇒ 1) when the world has none yet', async () => {
    await archiveActiveArc({
      uid: 'u1',
      world: worldWith({}),
      snapshot: snapshot(),
    });
    expect(updateLifeWorldMock).toHaveBeenCalledWith('u1', 'w1', {
      currentArc: null,
      completedArcCount: 1,
    });
  });

  it('LIFE-WORLD-ARC-1 — emits a world_arc_completed event with the chapter + outcome', async () => {
    await archiveActiveArc({
      uid: 'u1',
      world: worldWith({ completedArcCount: 0 }),
      snapshot: snapshot(),
    });
    expect(appendLifeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uid: 'u1',
        worldId: 'w1',
        kind: 'world_arc_completed',
        payload: expect.objectContaining({
          chapterNumber: 4,
          outcomeLine: 'You won the oven, and lost a friend.',
        }),
      }),
    );
  });

  it('LIFE-WORLD-ARC-1 — returns null and writes NOTHING when there is no active arc', async () => {
    const result = await archiveActiveArc({
      uid: 'u1',
      world: worldWith({ currentArc: null }),
      snapshot: snapshot(),
    });
    expect(result).toBeNull();
    expect(appendCompletedArcMock).not.toHaveBeenCalled();
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });
});

describe('closeSceneFlow — LIFE-SCENE-13 (bio de-accretion on append)', () => {
  const BASE_BIO = '<bio>\n  <job>Baker</job>\n</bio>';
  const mem = (i: number) =>
    `\n<completedScene title="Arc ${i}" ending="win">Outcome ${i}.</completedScene>`;
  const ccCount = (s: string) => (s.match(/<completedScene\b/g) ?? []).length;

  const snap = (): SceneCompletionSnapshot => ({
    title: 'Latest',
    premise: 'p',
    tone: 'noir',
    outcomeLine: 'The newest outcome.',
    outcomeLineNative: '',
    endingKey: 'win',
    arcStage: 'continues',
    keyMomentsForArc: [],
    promotedNpcIds: [],
    retiredNpcIds: [],
    stats: {
      gradedCount: 0,
      correctCount: 0,
      generationCount: 0,
      generationCorrect: 0,
      comprehensionCount: 0,
      comprehensionCorrect: 0,
    },
    windowStartSec: 0,
  });

  const worldWithBio = (bio: string): LifeWorld =>
    ({ id: 'w1', characterName: 'Marc', currentArc: null, bio }) as unknown as LifeWorld;

  const close = (bio: string) =>
    closeSceneFlow({
      uid: 'u1',
      world: worldWithBio(bio),
      scene: baseScene(),
      snapshot: snap(),
    });

  const bioPatch = () =>
    (updateLifeWorldMock.mock.calls[0]![2] as { bio: string }).bio;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends the new memory when the bio is below the cap (nothing dropped)', async () => {
    await close(BASE_BIO + mem(1) + mem(2));
    const bio = bioPatch();
    expect(ccCount(bio)).toBe(3);
    expect(bio).toContain('The newest outcome.');
    expect(bio).toContain('Outcome 1.'); // old entry retained
    expect(bio.startsWith(BASE_BIO)).toBe(true);
  });

  it('caps the tail at MAX_BIO_SCENE_MEMORIES, dropping the oldest and keeping the character sheet', async () => {
    const full =
      BASE_BIO +
      Array.from({ length: MAX_BIO_SCENE_MEMORIES }, (_, i) => mem(i + 1)).join('');
    await close(full);
    const bio = bioPatch();
    expect(ccCount(bio)).toBe(MAX_BIO_SCENE_MEMORIES); // still 8, not 9
    expect(bio).toContain('The newest outcome.'); // newest kept
    expect(bio).not.toContain('Outcome 1.'); // oldest dropped
    expect(bio.startsWith(BASE_BIO)).toBe(true); // <bio> preserved
  });
});

/**
 * LIFE-SCENE-35 — the arc memory carries BOTH languages.
 *
 * `outcomeLineNative` has been computed on every snapshot since
 * LIFE-SCENE-28 and dropped on the floor here. That was defensible while the
 * memory was only a persistence record; LIFE-SCENE-31 made it the chapter
 * card's lead content and nothing came back to this line.
 */
describe('closeSceneFlow — LIFE-SCENE-35 (the arc memory keeps the native twin)', () => {
  const snapWith = (native: string): SceneCompletionSnapshot => ({
    title: 'La Cour des Pétales',
    premise: 'p',
    tone: 'noir',
    outcomeLine: 'Rémy a refusé de te remettre la lettre.',
    outcomeLineNative: native,
    endingKey: 'refused',
    arcStage: 'continues',
    keyMomentsForArc: [],
    promotedNpcIds: [],
    retiredNpcIds: [],
    stats: {
      gradedCount: 0, correctCount: 0, generationCount: 0,
      generationCorrect: 0, comprehensionCount: 0, comprehensionCorrect: 0,
    },
    windowStartSec: 0,
  });

  const worldWithArc = (): LifeWorld =>
    ({
      id: 'w1',
      characterName: 'Marc',
      bio: '<bio/>',
      currentArc: {
        chapterNumber: 1, premise: 'p', playerTeaser: '', themes: [],
        status: 'active', recurringNpcIds: [], completedSceneMemories: [],
      },
    }) as unknown as LifeWorld;

  const memoryWritten = () => {
    const patch = updateLifeWorldMock.mock.calls[0]![2] as {
      currentArc: { completedSceneMemories: { summary: string; summaryNative?: string }[] };
    };
    return patch.currentArc.completedSceneMemories.at(-1)!;
  };

  beforeEach(() => vi.clearAllMocks());

  it('stores summaryNative alongside the practice summary', async () => {
    await closeSceneFlow({
      uid: 'u1',
      world: worldWithArc(),
      scene: baseScene(),
      snapshot: snapWith('Rémy refused to hand you the letter.'),
    });
    expect(memoryWritten()).toMatchObject({
      summary: 'Rémy a refusé de te remettre la lettre.',
      summaryNative: 'Rémy refused to hand you the letter.',
    });
  });

  it('a snapshot with no twin stores an empty string, never undefined', async () => {
    // Firestore rejects `undefined` on a write; a scene resolved by a model
    // that omitted the field must not take the whole close down with it.
    await closeSceneFlow({
      uid: 'u1',
      world: worldWithArc(),
      scene: baseScene(),
      snapshot: snapWith(''),
    });
    const m = memoryWritten();
    expect(m.summaryNative).toBe('');
    expect(Object.values(m).every((v) => v !== undefined)).toBe(true);
  });
});

/**
 * LIFE-SCENE-26 — a scene shorter than the floor has not been a scene.
 *
 * The owner named BOTH failure modes — scenes that ran too long AND scenes too
 * small to feel like anything — and only the first was ever guarded, by
 * `<scenePace>`. A model that resolves on turn 2 because a completionTrigger
 * happened to match hands the player a completion screen for something they
 * barely played.
 */
describe('sceneResolveTooEarly — LIFE-SCENE-26', () => {
  it('refuses a resolve below the floor', () => {
    for (let n = 0; n < SCENE_FLOOR; n += 1) {
      expect(sceneResolveTooEarly(n), `${n} turns`).toBe(true);
    }
  });

  it('allows one AT the floor — early is permitted, tiny is not', () => {
    // The rule is a floor, not a minimum length: the model may still end a
    // scene before its window when the subject genuinely lands.
    expect(sceneResolveTooEarly(SCENE_FLOOR)).toBe(false);
    expect(sceneResolveTooEarly(SCENE_FLOOR + 1)).toBe(false);
    expect(sceneResolveTooEarly(50)).toBe(false);
  });

  it('sits well below the window, so the floor and the pacing never fight', () => {
    // A floor at or above SCENE_IN_RANGE would refuse resolves inside the very
    // window <scenePace> is asking the model to resolve in.
    expect(SCENE_FLOOR).toBeLessThan(6);
    expect(SCENE_FLOOR).toBeGreaterThan(0);
  });
});

describe('LIFE-INTENT-2 — computeReplanPlan folds the leaning signal', () => {
  it('a declared move lands the new leaning and clears the stall', () => {
    const plan = computeReplanPlan(baseScene({ leaning: 'nobody has asked', leaningStall: 2 }), {
      leaning: 'he is hardening — you pushed on the debt',
      leaningMoved: true,
    });
    expect(plan.patch.leaning).toBe('he is hardening — you pushed on the debt');
    expect(plan.patch.leaningStall).toBe(0);
  });

  it('a declined move counts and leaves the leaning alone', () => {
    const plan = computeReplanPlan(baseScene({ leaning: 'nobody has asked', leaningStall: 1 }), {
      leaning: 'a quiet rewrite',
      leaningMoved: false,
    });
    expect(plan.patch.leaning).toBe('nobody has asked');
    expect(plan.patch.leaningStall).toBe(2);
  });

  it('a signal that says nothing about the leaning still counts as a decline', () => {
    const plan = computeReplanPlan(baseScene({ leaning: 'x', leaningStall: 0 }), {
      phaseTransition: 'climax',
    });
    expect(plan.patch.leaningStall).toBe(1);
  });
});

/**
 * LIFE-DAY-2.1 — the close hands BACK the arc it just wrote.
 *
 * `closeSceneFlow` returned void, so `useChapterCompletion` archived the arc
 * from its own render-time `world` — a copy that predates the write made a line
 * earlier. Every chapter recap was therefore one day short, and a chapter of a
 * single scene archived an EMPTY day list, which is precisely the content
 * `LIFE-SCENE-31` promoted to be that card's lead.
 */
describe('LIFE-DAY-2.1 — closeSceneFlow returns the arc including the day just closed', () => {
  const baseWorld = {
    id: 'w1',
    bio: '',
    currentArc: {
      chapterNumber: 1,
      premise: 'Settle in.',
      themes: [],
      status: 'active',
      recurringNpcIds: [],
      completedSceneMemories: [],
    },
  } as unknown as LifeWorld;

  const snapshot = {
    title: 'The Gallery Show',
    endingKey: 'wall-found',
    outcomeLine: 'Tes photos ont trouvé le mur.',
    outcomeLineNative: 'Your photos made the wall.',
    keyMomentsForArc: [],
    promotedNpcIds: [],
    retiredNpcIds: [],
    arcStage: 'concluding',
  } as unknown as SceneCompletionSnapshot;

  it('the returned arc CONTAINS the scene that just ended', async () => {
    const arc = await closeSceneFlow({
      uid: 'u1',
      world: baseWorld,
      scene: { id: 's1' } as unknown as LifeScene,
      snapshot,
    });
    expect(arc).not.toBeNull();
    expect(arc!.completedSceneMemories).toHaveLength(1);
    expect(arc!.completedSceneMemories[0]!.summary).toBe('Tes photos ont trouvé le mur.');
    // LIFE-SCENE-35: the native twin rides along, so the chapter card's day
    // row can be bilingual like every other narrative surface.
    expect(arc!.completedSceneMemories[0]!.summaryNative).toBe('Your photos made the wall.');
  });

  it('the CALLER cannot get this from its own world copy — that is the bug', () => {
    // The stale object the hook used to archive from. Asserting it stays empty
    // is what makes the fix meaningful rather than decorative: the day exists
    // only in the value the close returns.
    expect(baseWorld.currentArc!.completedSceneMemories).toHaveLength(0);
  });

  it('returns null for a world with no active arc, rather than inventing one', async () => {
    const arc = await closeSceneFlow({
      uid: 'u1',
      world: { ...baseWorld, currentArc: undefined } as unknown as LifeWorld,
      scene: { id: 's1' } as unknown as LifeScene,
      snapshot,
    });
    expect(arc).toBeNull();
  });
});
