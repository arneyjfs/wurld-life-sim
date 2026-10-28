import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/life/lifeAvatarAssets', () => ({
  readNpcAvatar: vi.fn(async () => null),
}));

import { readNpcAvatar } from '@/lib/life/lifeAvatarAssets';
import {
  useNpcAvatars,
  useNpcAvatarPending,
  __resetNpcAvatarCache,
} from './useNpcAvatars';
import { PENDING_AVATAR_TIMEOUT_MS } from './useCharacterAvatar';
import type { LifeNpc } from '@/types/firestore';

const readMock = vi.mocked(readNpcAvatar);

const npc = (id: string, status: LifeNpc['avatarStatus']): LifeNpc =>
  ({ id, name: id, avatarStatus: status }) as LifeNpc;

const roster = (...npcs: LifeNpc[]): ReadonlyMap<string, LifeNpc> => {
  const m = new Map<string, LifeNpc>();
  for (const n of npcs) m.set(n.id, n);
  return m;
};

beforeEach(() => {
  vi.clearAllMocks();
  __resetNpcAvatarCache();
});

describe('useNpcAvatars — LIFE-NPC-2 / LIFE-DATA-1', () => {
  it('fetches each READY npc sidecar and maps npcId → url', async () => {
    readMock.mockImplementation(async (_u, _w, npcId) => `data:${npcId}`);
    const { result } = renderHook(() =>
      useNpcAvatars(
        'u1',
        'w1',
        roster(npc('sophie', 'ready'), npc('paul', 'ready')),
      ),
    );
    await waitFor(() => {
      expect(result.current.get('sophie')).toBe('data:sophie');
      expect(result.current.get('paul')).toBe('data:paul');
    });
    expect(readMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT fetch pending npcs and omits them from the map', async () => {
    readMock.mockImplementation(async (_u, _w, npcId) => `data:${npcId}`);
    const { result } = renderHook(() =>
      useNpcAvatars(
        'u1',
        'w1',
        roster(npc('sophie', 'ready'), npc('leo', 'pending')),
      ),
    );
    await waitFor(() => expect(result.current.get('sophie')).toBe('data:sophie'));
    expect(result.current.has('leo')).toBe(false);
    expect(readMock).toHaveBeenCalledTimes(1);
    expect(readMock).toHaveBeenCalledWith('u1', 'w1', 'sophie');
  });

  it('caches — a second mount for the same ready npc does not re-fetch', async () => {
    readMock.mockResolvedValue('data:cached');
    const first = renderHook(() =>
      useNpcAvatars('u1', 'w1', roster(npc('sophie', 'ready'))),
    );
    await waitFor(() =>
      expect(first.result.current.get('sophie')).toBe('data:cached'),
    );
    expect(readMock).toHaveBeenCalledTimes(1);
    const second = renderHook(() =>
      useNpcAvatars('u1', 'w1', roster(npc('sophie', 'ready'))),
    );
    expect(second.result.current.get('sophie')).toBe('data:cached');
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('null uid / worldId → empty map, no fetch', async () => {
    const { result } = renderHook(() =>
      useNpcAvatars(null, null, roster(npc('sophie', 'ready'))),
    );
    expect(result.current.size).toBe(0);
    expect(readMock).not.toHaveBeenCalled();
  });
});

describe('useNpcAvatarPending — LIFE-FAIL-9 client pending timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('LIFE-FAIL-9 — a pending npc is in the set, then drops out after the timeout (fallback to initials)', () => {
    const { result } = renderHook(() =>
      useNpcAvatarPending(roster(npc('leo', 'pending'))),
    );
    expect(result.current.has('leo')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(PENDING_AVATAR_TIMEOUT_MS + 1);
    });
    // Dead gen no longer shimmers forever — the id leaves the pending set so
    // the slot shows the initials circle.
    expect(result.current.has('leo')).toBe(false);
  });

  it('LIFE-FAIL-9 — a ready npc is never pending', () => {
    const { result } = renderHook(() =>
      useNpcAvatarPending(roster(npc('sophie', 'ready'))),
    );
    expect(result.current.size).toBe(0);
  });

  it('LIFE-FAIL-9 — an npc whose gen lands (pending→ready) leaves the pending set immediately', () => {
    const { result, rerender } = renderHook(
      ({ r }: { r: ReadonlyMap<string, LifeNpc> }) => useNpcAvatarPending(r),
      { initialProps: { r: roster(npc('leo', 'pending')) } },
    );
    expect(result.current.has('leo')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(PENDING_AVATAR_TIMEOUT_MS / 2);
    });
    rerender({ r: roster(npc('leo', 'ready')) });
    expect(result.current.has('leo')).toBe(false);
  });
});
