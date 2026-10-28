import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { LifeWorld } from '@/types/firestore';

// useEffectiveWorld reads the LIVE global difficulty via useUserProfile.
// Mock it so each test can set `profile.data.difficulty` and prove the
// memo re-resolves when it changes mid-story.
const profileMock = vi.fn();
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => profileMock(),
}));

import { useEffectiveWorld } from './useEffectiveWorld';

function baseWorld(overrides: Partial<LifeWorld> = {}): LifeWorld {
  return {
    id: 'w1',
    characterName: 'Marc',
    practiceLanguage: 'fr',
    nativeLanguage: 'en',
    difficulty: 2,
    worldSeedKey: 'city_life',
    worldMode: 'realistic',
    ...overrides,
  };
}

beforeEach(() => {
  profileMock.mockReset();
});

describe('useEffectiveWorld — LIFE-SETTINGS-7', () => {
  it('LIFE-SETTINGS-7 — a pinned wurld uses its fixed level, ignoring global', () => {
    profileMock.mockReturnValue({ data: { difficulty: 5 }, loading: false });
    const world = baseWorld({ difficulty: 2, difficultyPinned: 3 });
    const { result } = renderHook(() => useEffectiveWorld('u1', world));
    expect(result.current.effectiveWorld?.difficulty).toBe(3);
    expect(result.current.globalDifficulty).toBe(5);
  });

  it('LIFE-SETTINGS-7 — an unpinned wurld follows the live global difficulty', () => {
    profileMock.mockReturnValue({ data: { difficulty: 5 }, loading: false });
    const world = baseWorld({ difficulty: 2, difficultyPinned: null });
    const { result } = renderHook(() => useEffectiveWorld('u1', world));
    expect(result.current.effectiveWorld?.difficulty).toBe(5);
  });

  it('LIFE-SETTINGS-7 — an absent difficultyPinned field also follows global', () => {
    profileMock.mockReturnValue({ data: { difficulty: 4 }, loading: false });
    const world = baseWorld({ difficulty: 2 }); // no difficultyPinned at all
    const { result } = renderHook(() => useEffectiveWorld('u1', world));
    expect(result.current.effectiveWorld?.difficulty).toBe(4);
  });

  it('LIFE-SETTINGS-7 — a mid-story global change re-resolves the effective difficulty', () => {
    profileMock.mockReturnValue({ data: { difficulty: 5 }, loading: false });
    const world = baseWorld({ difficultyPinned: null });
    const { result, rerender } = renderHook(() => useEffectiveWorld('u1', world));
    expect(result.current.effectiveWorld?.difficulty).toBe(5);
    // Global bumped in Settings mid-story → next render re-resolves.
    profileMock.mockReturnValue({ data: { difficulty: 6 }, loading: false });
    rerender();
    expect(result.current.effectiveWorld?.difficulty).toBe(6);
  });

  it('LIFE-SETTINGS-7 — absent global falls back to the default 2', () => {
    profileMock.mockReturnValue({ data: {}, loading: false });
    const world = baseWorld({ difficultyPinned: null });
    const { result } = renderHook(() => useEffectiveWorld('u1', world));
    expect(result.current.effectiveWorld?.difficulty).toBe(2);
    expect(result.current.globalDifficulty).toBe(2);
  });

  it('LIFE-SETTINGS-7 — a null world yields a null effectiveWorld', () => {
    profileMock.mockReturnValue({ data: { difficulty: 5 }, loading: false });
    const { result } = renderHook(() => useEffectiveWorld('u1', null));
    expect(result.current.effectiveWorld).toBeNull();
  });

  it('LIFE-SETTINGS-7 — the override preserves every other world field', () => {
    profileMock.mockReturnValue({ data: { difficulty: 5 }, loading: false });
    const world = baseWorld({ difficulty: 2, difficultyPinned: null, practiceLanguage: 'es' });
    const { result } = renderHook(() => useEffectiveWorld('u1', world));
    expect(result.current.effectiveWorld?.practiceLanguage).toBe('es');
    expect(result.current.effectiveWorld?.difficultyPinned).toBeNull();
    expect(result.current.effectiveWorld?.id).toBe('w1');
  });
});
