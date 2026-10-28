/**
 * LIFE-SCENE-31.1 — the close reports EXACTLY ONCE, on every path.
 *
 * The bug this file pins: three silent dead ends (`failed`, an empty history
 * line, a throwing write) each returned without telling the screen, so the
 * summary slot pulsed its placeholder for ever. Every test below is one of
 * those paths, and every one of them asserts the callback fired.
 *
 * Spec: docs/specs/life-sim.md, `LIFE-SCENE-31.1`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/life/runSceneClose', () => ({ runSceneClose: vi.fn() }));
vi.mock('@/lib/life/world', () => ({ updateLifeWorld: vi.fn() }));
vi.mock('@/lib/life/scene', () => ({ updateActiveScene: vi.fn() }));
vi.mock('@/lib/life/sceneLog', () => ({ buildSceneLog: () => [] }));
vi.mock('@/lib/life/fronts', () => ({ frontsNeedingSign: () => [] }));

import { runSceneClose } from '@/lib/life/runSceneClose';
import { updateLifeWorld } from '@/lib/life/world';
import { updateActiveScene } from '@/lib/life/scene';
import { closeResolvedScene, SCENE_CLOSE_TIMEOUT_MS } from './nodeEngineSceneClose';
import type { LifeWorld, SceneOutline } from '@/types/firestore';

const closeMock = vi.mocked(runSceneClose);
const worldWrite = vi.mocked(updateLifeWorld);
const sceneWrite = vi.mocked(updateActiveScene);

const WORLD = { id: 'w1', cast: [], fronts: [], sagaHistory: [] } as unknown as LifeWorld;
const OUTLINE = { subject: 'the key', premise: 'find it' } as unknown as SceneOutline;

const ok = (historyLine: string) =>
  ({
    kind: 'ok',
    historyLine,
    fronts: [],
    cast: [],
    situation: null,
    sagaResolved: null,
    // LIFE-GOAL-11: every ok close now carries a verdict; 'stands' is the
    // normal one and leaves the ladder alone.
    objectiveVerdict: 'stands',
    objectiveBecause: null,
  }) as never;

function run(over: Parameters<typeof closeResolvedScene>[0]['resolved'] = null) {
  const onSummary = vi.fn();
  const p = closeResolvedScene({
    uid: 'u1',
    world: WORLD,
    outline: OUTLINE,
    events: [],
    npcs: [],
    resolved: over,
    onSummary,
  });
  return { p, onSummary };
}

const RESOLVED = { outcomeLine: 'La puerta se cerró.', outcomeLineNative: 'The door closed.' };

describe('LIFE-SCENE-31.1 — the close always reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    worldWrite.mockResolvedValue(undefined as never);
    sceneWrite.mockResolvedValue(undefined as never);
  });

  it('reports the world’s record on the happy path', async () => {
    closeMock.mockResolvedValueOnce(ok('  You talked Bébert into lending the key.  '));
    const { p, onSummary } = run(RESOLVED);
    await p;
    expect(onSummary).toHaveBeenCalledTimes(1);
    expect(onSummary).toHaveBeenCalledWith('You talked Bébert into lending the key.');
  });

  it('DEAD END 1 — a failed close still reports, falling back to the resolution beat', async () => {
    closeMock.mockResolvedValueOnce({ kind: 'failed', reason: 'unparseable' } as never);
    const { p, onSummary } = run(RESOLVED);
    await p;
    // The native twin, not the practice line: this is a summary card, and
    // LIFE-SCENE-28 is why the native one exists.
    expect(onSummary).toHaveBeenCalledExactlyOnceWith('The door closed.');
  });

  it('DEAD END 2 — an EMPTY history line falls back rather than reporting ""', async () => {
    // `runSceneClose` coerces a missing `history` to '' and still returns ok,
    // so "ok" is not the same question as "there is a record".
    closeMock.mockResolvedValueOnce(ok('   '));
    const { p, onSummary } = run(RESOLVED);
    await p;
    expect(onSummary).toHaveBeenCalledExactlyOnceWith('The door closed.');
  });

  it('DEAD END 3 — a throwing world write reports, and does NOT claim the record', async () => {
    // LIFE-SCENE-31: the card shows the world's record only once the world
    // holds it. The write threw, so the honest thing on screen is the beat.
    closeMock.mockResolvedValueOnce(ok('You talked Bébert into lending the key.'));
    worldWrite.mockRejectedValueOnce(new Error('permission-denied'));
    const { p, onSummary } = run(RESOLVED);
    await p;
    expect(onSummary).toHaveBeenCalledExactlyOnceWith('The door closed.');
  });

  it('reports NULL — the terminal "no record" state — when there is not even a beat', async () => {
    // This is the value that stops the shimmer. Without it the card cannot tell
    // "back with nothing" from "not back yet".
    closeMock.mockResolvedValueOnce({ kind: 'failed', reason: 'boom' } as never);
    const { p, onSummary } = run(null);
    await p;
    expect(onSummary).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('falls back to the PRACTICE line when the native twin is missing', async () => {
    // Scenes resolved before LIFE-SCENE-28 shipped carry no `outcomeLineNative`.
    closeMock.mockResolvedValueOnce({ kind: 'failed', reason: 'boom' } as never);
    const { p, onSummary } = run({ outcomeLine: 'La puerta se cerró.' });
    await p;
    expect(onSummary).toHaveBeenCalledExactlyOnceWith('La puerta se cerró.');
  });

  it('a close that NEVER settles still reports, at the timeout', async () => {
    // The failure mode no `catch` can reach: a promise that neither resolves
    // nor rejects. Nothing bounded the total before this.
    vi.useFakeTimers();
    try {
      closeMock.mockReturnValueOnce(new Promise(() => {}) as never);
      const { p, onSummary } = run(RESOLVED);
      expect(onSummary).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(SCENE_CLOSE_TIMEOUT_MS + 1);
      await p;
      expect(onSummary).toHaveBeenCalledExactlyOnceWith('The door closed.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never rejects — the caller stores it in a ref and nothing awaits it', async () => {
    closeMock.mockRejectedValueOnce(new Error('transport'));
    const { p, onSummary } = run(RESOLVED);
    await expect(p).resolves.toBeUndefined();
    expect(onSummary).toHaveBeenCalledTimes(1);
  });
});

/**
 * LIFE-GOAL-11 — the reported behaviour, at the seam that fixes it.
 *
 * *"The immediate goal didn't regenerate in scene 2."* The objective could only
 * end if the mid-turn STEP model volunteered an optional field, so it followed
 * the player out of the scene it belonged to. The close — the one call that has
 * read the whole scene — now rules on it, and its verdict is REQUIRED.
 */
describe('LIFE-GOAL-11 — the close frees the slot so a new objective can be minted', () => {
  const WITH_OBJECTIVE = {
    ...WORLD,
    goalLadder: {
      saga: { text: 'keep the crossing open', when: 'Friday', days: 12 },
      objective: { id: 'o1', text: 'get Vic to admit the pylon is failing', need: null },
      done: [],
      dayIndex: 0,
    },
  } as unknown as LifeWorld;

  const closeWith = (verdict: string, because: string | null = null) =>
    ({
      kind: 'ok', historyLine: 'The pylon held.', fronts: [], cast: [],
      situation: null, sagaResolved: null,
      objectiveVerdict: verdict, objectiveBecause: because,
    }) as never;

  const runIt = async (result: unknown) => {
    closeMock.mockResolvedValueOnce(result as never);
    await closeResolvedScene({
      uid: 'u1', world: WITH_OBJECTIVE, outline: OUTLINE,
      events: [], npcs: [], resolved: RESOLVED, onSummary: vi.fn(),
    });
    return worldWrite.mock.calls.at(-1)?.[2] as { goalLadder?: { objective: unknown } } | undefined;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    worldWrite.mockResolvedValue(undefined as never);
    sceneWrite.mockResolvedValue(undefined as never);
  });

  it('the objective is HANDED to the close — it cannot rule on what it cannot see', async () => {
    closeMock.mockResolvedValueOnce(closeWith('stands'));
    await closeResolvedScene({
      uid: 'u1', world: WITH_OBJECTIVE, outline: OUTLINE,
      events: [], npcs: [], resolved: RESOLVED, onSummary: vi.fn(),
    });
    expect(closeMock.mock.calls[0]![0]).toMatchObject({
      objective: { id: 'o1', text: 'get Vic to admit the pylon is failing' },
    });
  });

  it('ACHIEVED empties the slot in the SAME write as the history line', async () => {
    // One write, so a world cannot end up with the day recorded and the
    // objective still standing, or the reverse.
    const patch = await runIt(closeWith('achieved'));
    expect(patch?.goalLadder?.objective).toBeNull();
  });

  it('OVERTAKEN empties it too, carrying the reason the player is shown', async () => {
    const patch = await runIt(closeWith('overtaken', 'the bridge shut before you could ask'));
    expect(patch?.goalLadder?.objective).toBeNull();
  });

  it('STANDS does not touch the ladder at all', async () => {
    // Not merely "leaves it equal" — absent from the patch, so an unchanged
    // ladder never costs a write.
    const patch = await runIt(closeWith('stands'));
    expect(patch).not.toHaveProperty('goalLadder');
  });

  it('a close with NO verdict leaves the objective alone', async () => {
    // `runSceneClose` defaults to 'stands'. The safe direction: a close that
    // came back malformed must not be able to delete the player's goal.
    const patch = await runIt(closeWith(''));
    expect(patch).not.toHaveProperty('goalLadder');
  });

  it('a world with no objective still closes, and asks for no verdict', async () => {
    closeMock.mockResolvedValueOnce(closeWith('stands'));
    await closeResolvedScene({
      uid: 'u1', world: WORLD, outline: OUTLINE,
      events: [], npcs: [], resolved: RESOLVED, onSummary: vi.fn(),
    });
    expect(closeMock.mock.calls[0]![0]).toMatchObject({ objective: null });
  });
});
