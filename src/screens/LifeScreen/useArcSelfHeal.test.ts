import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/life/runWorldArcGenerate', () => ({
  runWorldArcGenerate: vi.fn(),
}));
vi.mock('@/lib/life/world', () => ({ updateLifeWorld: vi.fn(async () => undefined) }));

import { runWorldArcGenerate } from '@/lib/life/runWorldArcGenerate';
import { updateLifeWorld } from '@/lib/life/world';
import { useArcSelfHeal } from './useArcSelfHeal';
import type { LifeWorld, WorldArc } from '@/types/firestore';

/**
 * LIFE-WORLD-ARC-9 — a world with no `currentArc` repairs itself on open.
 *
 * The dead state this exists to end: `archiveActiveArc` nulls `currentArc` by
 * design, and only the *Continue your wurld* CTA ever refilled it. Pausing
 * instead — or one failed call — stranded the world permanently: still
 * playable, no through-line, and `archiveActiveArc` early-returns on `!active`
 * so the chapter could never complete again. Measured on
 * `w-1785453145426-8w0ffo`: 37 turns, 1 hook, 110 events, no arc.
 */
const arcGen = vi.mocked(runWorldArcGenerate);
const update = vi.mocked(updateLifeWorld);

const arc: WorldArc = {
  chapterNumber: 2,
  premise: 'p',
  playerTeaser: 't',
  themes: [],
  status: 'active',
  recurringNpcIds: [],
  completedSceneMemories: [],
};

const world = (over: Partial<LifeWorld> = {}): LifeWorld =>
  ({
    id: 'w1',
    characterName: 'Marc',
    practiceLanguage: 'French',
    nativeLanguage: 'English',
    difficulty: 3,
    worldSeedKey: 'city_life',
    rollingSummary: '',
    ...over,
  }) as LifeWorld;

describe('LIFE-WORLD-ARC-9 — arc self-heal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arcGen.mockResolvedValue({ arc } as Awaited<ReturnType<typeof runWorldArcGenerate>>);
  });

  it('LIFE-WORLD-ARC-9 — regenerates when currentArc is missing, at completedArcCount + 1', async () => {
    renderHook(() => useArcSelfHeal({ uid: 'u1', world: world({ completedArcCount: 1 }) }));
    await waitFor(() => expect(arcGen).toHaveBeenCalledTimes(1));
    // The archived arc is the only record of what completed; the scalar is what
    // the clean-break data model keeps for exactly this.
    expect(arcGen.mock.calls[0]![0]).toMatchObject({ uid: 'u1', chapterNumber: 2 });
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('u1', 'w1', { currentArc: arc }),
    );
  });

  it('LIFE-WORLD-ARC-9 — a world that already has an arc is left alone', async () => {
    renderHook(() => useArcSelfHeal({ uid: 'u1', world: world({ currentArc: arc }) }));
    await new Promise((r) => setTimeout(r, 20));
    expect(arcGen).not.toHaveBeenCalled();
  });

  it('LIFE-WORLD-ARC-9 — a BRAND NEW world is left alone (chapter 1 is LIFE-WORLD-ARC-3s job)', async () => {
    // completedArcCount 0 + no arc = creation still in flight. Firing here
    // would race LifeStartScreen and write a SECOND chapter 1.
    renderHook(() => useArcSelfHeal({ uid: 'u1', world: world({ completedArcCount: 0 }) }));
    await new Promise((r) => setTimeout(r, 20));
    expect(arcGen).not.toHaveBeenCalled();
  });

  it('LIFE-WORLD-ARC-9 — fires ONCE even across re-renders', async () => {
    const w = world({ completedArcCount: 1 });
    const { rerender } = renderHook(() => useArcSelfHeal({ uid: 'u1', world: w }));
    await waitFor(() => expect(arcGen).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    await new Promise((r) => setTimeout(r, 20));
    // The world prop does not change until the write round-trips, so the
    // precondition is still true on every re-render. Without a latch this is an
    // unbounded loop of billed model calls.
    expect(arcGen).toHaveBeenCalledTimes(1);
  });

  it('LIFE-WORLD-ARC-9 — a failed generate does not throw and does not retry-loop', async () => {
    arcGen.mockRejectedValue(new Error('gemini down'));
    const { rerender } = renderHook(() =>
      useArcSelfHeal({ uid: 'u1', world: world({ completedArcCount: 1 }) }),
    );
    await waitFor(() => expect(arcGen).toHaveBeenCalledTimes(1));
    rerender();
    await new Promise((r) => setTimeout(r, 20));
    expect(arcGen).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('LIFE-WORLD-ARC-9 — no uid, no world: no call', async () => {
    renderHook(() => useArcSelfHeal({ uid: null, world: world({ completedArcCount: 1 }) }));
    renderHook(() => useArcSelfHeal({ uid: 'u1', world: null }));
    await new Promise((r) => setTimeout(r, 20));
    expect(arcGen).not.toHaveBeenCalled();
  });
});

/**
 * LIFE-WORLD-ARC-10 — the self-heal never races the *Continue your wurld* CTA.
 *
 * PRODUCTION, 2026-08-06: chapter 2 was generated TWICE. `archiveActiveArc`
 * nulls `currentArc`, which makes the self-heal's precondition true the instant
 * the chapter-complete screen appears — and `continueToNextChapter` is about to
 * generate the very same chapter number from the CTA. Two billed generations
 * for one chapter, last write wins, and the chapter the player was shown is not
 * necessarily the one that got stored.
 *
 * The existing `completedArcCount <= 0` guard is the SAME defect solved for
 * chapter 1 ("firing here would race LifeStartScreen"). This is its sibling for
 * chapter N+1, and the distinguishing fact is the same one: whose job is it?
 * If the arc VANISHED while this hook was mounted, a chapter just completed
 * here and the CTA owns what follows. If it was already missing on arrival, the
 * world was stranded before this session and nothing else is coming.
 */
describe('LIFE-WORLD-ARC-10 — the self-heal yields to the chapter-complete CTA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arcGen.mockResolvedValue({ arc } as Awaited<ReturnType<typeof runWorldArcGenerate>>);
  });

  it('LIFE-WORLD-ARC-10 — an arc that DISAPPEARS mid-session is not healed', async () => {
    // Exactly the production sequence: playing (arc present) → the chapter
    // completes → archiveActiveArc nulls it → this hook sees no arc.
    const { rerender } = renderHook(
      ({ w }: { w: LifeWorld }) => useArcSelfHeal({ uid: 'u1', world: w }),
      { initialProps: { w: world({ currentArc: arc, completedArcCount: 1 }) } },
    );
    rerender({ w: world({ currentArc: undefined, completedArcCount: 2 }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(arcGen).not.toHaveBeenCalled();
  });

  it('LIFE-WORLD-ARC-10 — a world ALREADY stranded on arrival is still healed', async () => {
    // The case LIFE-WORLD-ARC-9 exists for is untouched: no arc on the first
    // snapshot means nobody else is coming.
    renderHook(() => useArcSelfHeal({ uid: 'u1', world: world({ completedArcCount: 1 }) }));
    await waitFor(() => expect(arcGen).toHaveBeenCalledTimes(1));
  });

  it('LIFE-WORLD-ARC-10 — the suppression is per MOUNT, so re-entering the world heals it', async () => {
    // Pause-for-now unmounts the screen. Coming back later, the arc is missing
    // on the first snapshot again — which is precisely the stranded state.
    const { rerender, unmount } = renderHook(
      ({ w }: { w: LifeWorld }) => useArcSelfHeal({ uid: 'u1', world: w }),
      { initialProps: { w: world({ currentArc: arc, completedArcCount: 1 }) } },
    );
    rerender({ w: world({ currentArc: undefined, completedArcCount: 2 }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(arcGen).not.toHaveBeenCalled();
    unmount();

    renderHook(() => useArcSelfHeal({ uid: 'u1', world: world({ completedArcCount: 2 }) }));
    await waitFor(() => expect(arcGen).toHaveBeenCalledTimes(1));
    expect(arcGen.mock.calls[0]![0]).toMatchObject({ chapterNumber: 3 });
  });
});
