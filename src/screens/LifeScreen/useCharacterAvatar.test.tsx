import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/life/lifeAvatarAssets', () => ({
  readCharacterAvatar: vi.fn(async () => null),
}));

import { readCharacterAvatar } from '@/lib/life/lifeAvatarAssets';
import {
  useCharacterAvatar,
  __resetCharacterAvatarCache,
  PENDING_AVATAR_TIMEOUT_MS,
} from './useCharacterAvatar';

const readMock = vi.mocked(readCharacterAvatar);

beforeEach(() => {
  vi.clearAllMocks();
  __resetCharacterAvatarCache();
});

describe('useCharacterAvatar — LIFE-NPC-2 / LIFE-DATA-1', () => {
  it("fetches the sidecar once when status is 'ready'", async () => {
    readMock.mockResolvedValue('data:ready');
    const { result } = renderHook(() => useCharacterAvatar('u1', 'w1', 'ready'));
    await waitFor(() => expect(result.current.url).toBe('data:ready'));
    expect(readMock).toHaveBeenCalledWith('u1', 'w1');
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT fetch when status is 'pending' (shimmer state)", async () => {
    const { result } = renderHook(() => useCharacterAvatar('u1', 'w1', 'pending'));
    expect(result.current.url).toBeNull();
    expect(readMock).not.toHaveBeenCalled();
  });

  it('does NOT fetch when status is undefined (never generated)', async () => {
    const { result } = renderHook(() =>
      useCharacterAvatar('u1', 'w1', undefined),
    );
    expect(result.current.url).toBeNull();
    expect(readMock).not.toHaveBeenCalled();
  });

  it('caches across instances — a second ready mount for the same world does NOT re-fetch', async () => {
    readMock.mockResolvedValue('data:cached');
    const first = renderHook(() => useCharacterAvatar('u1', 'w1', 'ready'));
    await waitFor(() => expect(first.result.current.url).toBe('data:cached'));
    expect(readMock).toHaveBeenCalledTimes(1);
    // Second mount reads the module cache synchronously — no new fetch.
    const second = renderHook(() => useCharacterAvatar('u1', 'w1', 'ready'));
    expect(second.result.current.url).toBe('data:cached');
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('null uid / worldId yields a null url and no fetch', async () => {
    const { result } = renderHook(() => useCharacterAvatar(null, null, 'ready'));
    expect(result.current.url).toBeNull();
    expect(readMock).not.toHaveBeenCalled();
  });
});

describe('useCharacterAvatar — LIFE-FAIL-9 client pending timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('LIFE-FAIL-9 — a pending avatar shimmers (loading=true), then the timeout gives up to the fallback (loading=false)', () => {
    const { result } = renderHook(() =>
      useCharacterAvatar('u1', 'w1', 'pending'),
    );
    expect(result.current.loading).toBe(true);
    act(() => {
      vi.advanceTimersByTime(PENDING_AVATAR_TIMEOUT_MS + 1);
    });
    // Timeout fired: a dead gen no longer shimmers forever — the initials
    // circle shows (loading=false).
    expect(result.current.loading).toBe(false);
    expect(result.current.url).toBeNull();
  });

  it('LIFE-FAIL-9 — a ready avatar is never loading', () => {
    const { result } = renderHook(() =>
      useCharacterAvatar('u1', 'w1', 'ready'),
    );
    expect(result.current.loading).toBe(false);
  });

  it('LIFE-FAIL-9 — an absent status (never generated) is never loading', () => {
    const { result } = renderHook(() =>
      useCharacterAvatar('u1', 'w1', undefined),
    );
    expect(result.current.loading).toBe(false);
  });

  it('LIFE-FAIL-9 — a pending that resolves BEFORE the timeout stops loading without giving up', () => {
    const { result, rerender } = renderHook(
      ({ s }: { s: 'pending' | 'ready' }) => useCharacterAvatar('u1', 'w1', s),
      { initialProps: { s: 'pending' as 'pending' | 'ready' } },
    );
    expect(result.current.loading).toBe(true);
    act(() => {
      vi.advanceTimersByTime(PENDING_AVATAR_TIMEOUT_MS / 2);
    });
    rerender({ s: 'ready' });
    expect(result.current.loading).toBe(false);
  });
});
