import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/life/runResumeRecapGenerate', () => ({
  runResumeRecapGenerate: vi
    .fn()
    .mockResolvedValue({ kind: 'skipped', reason: 'no-events' }),
}));

import { runResumeRecapGenerate } from '@/lib/life/runResumeRecapGenerate';
import { useResumeRecapOnExit } from './useResumeRecapOnExit';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

const runMock = runResumeRecapGenerate as unknown as ReturnType<typeof vi.fn>;

const world: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  worldMode: 'realistic',
};

const beat = (id: string): LifeEvent => ({
  id,
  kind: 'beat',
  payload: { speaker: 'npc', practiceText: `line-${id}` },
});

beforeEach(() => {
  runMock.mockClear();
});

describe('useResumeRecapOnExit — LIFE-FLOW-5', () => {
  it('LIFE-FLOW-5 — does not fire while mounted', () => {
    renderHook(() =>
      useResumeRecapOnExit({
        uid: 'u1',
        world,
        events: [beat('e1')],
        worldId: 'w1',
      }),
    );
    expect(runMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — fires once on unmount with the LATEST snapshot', () => {
    const { rerender, unmount } = renderHook(
      (p: Parameters<typeof useResumeRecapOnExit>[0]) => useResumeRecapOnExit(p),
      {
        initialProps: {
          uid: 'u1',
          world,
          events: [beat('e1')],
          worldId: 'w1',
        },
      },
    );
    rerender({ uid: 'u1', world, events: [beat('e1'), beat('e2')], worldId: 'w1' });
    unmount();
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith({
      uid: 'u1',
      world,
      events: [beat('e1'), beat('e2')],
    });
  });

  it('LIFE-FLOW-5 — does not fire when the world never loaded', () => {
    const { unmount } = renderHook(() =>
      useResumeRecapOnExit({ uid: 'u1', world: null, events: [], worldId: 'w1' }),
    );
    unmount();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — does not fire when the loaded world does not match the exited worldId', () => {
    const { unmount } = renderHook(() =>
      useResumeRecapOnExit({
        uid: 'u1',
        world,
        events: [beat('e1')],
        worldId: 'other-world',
      }),
    );
    unmount();
    expect(runMock).not.toHaveBeenCalled();
  });
});
