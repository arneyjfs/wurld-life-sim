import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/life/generateBackdrop', () => ({ generateBackdrop: vi.fn() }));
vi.mock('@/lib/life/backdropCache', () => ({
  readBackdropCache: vi.fn(() => null),
  writeBackdropCache: vi.fn(),
  fullCacheKey: (d: { label?: string; locationType: string; vibe: string }, worldId: string | null) =>
    `${worldId ?? '__nw__'}::${d.label ?? `${d.locationType}::${d.vibe}`}`,
}));
vi.mock('@/lib/life/backdrops', () => ({
  readPersistentBackdrop: vi.fn(async () => null),
  writePersistentBackdrop: vi.fn(),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { uid: 'u1' } }),
}));
vi.mock('@/lib/log', () => ({ warn: vi.fn() }));

import { generateBackdrop } from '@/lib/life/generateBackdrop';
import { readBackdropCache } from '@/lib/life/backdropCache';
import { useLifeBackdrop, backdropBuildingVisible } from './useLifeBackdrop';
import type { BackdropDescriptor } from '@/lib/life/backdropDescriptor';

const genMock = vi.mocked(generateBackdrop);
const readCacheMock = vi.mocked(readBackdropCache);

const descriptor: BackdropDescriptor = {
  locationType: 'apartment_bedroom',
  vibe: 'modern_city',
  persistent: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  readCacheMock.mockReturnValue(null);
});

describe('useLifeBackdrop — LIFE-BACKDROP-7 onboarding gen gate', () => {
  it('LIFE-BACKDROP-7 — does NOT generate when generate=false (fresh-world silhouette)', async () => {
    genMock.mockResolvedValue({ kind: 'ok', svg: '<svg>real</svg>' });
    const { result } = renderHook(() =>
      useLifeBackdrop(descriptor, 'w1', 'French', false),
    );
    // Let any effects flush.
    await act(async () => {
      await Promise.resolve();
    });
    expect(genMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe('fallback');
  });

  it('LIFE-BACKDROP-7 — generates once when generate=true and the cache misses', async () => {
    genMock.mockResolvedValue({ kind: 'ok', svg: '<svg>real</svg>' });
    const { result } = renderHook(() =>
      useLifeBackdrop(descriptor, 'w1', 'French', true),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(genMock).toHaveBeenCalledTimes(1);
    expect(result.current.svg).toBe('<svg>real</svg>');
  });

  it('LIFE-BACKDROP-7 — a cache hit still renders even when generate=false (no gen)', async () => {
    readCacheMock.mockReturnValue('<svg>cached</svg>');
    const { result } = renderHook(() =>
      useLifeBackdrop(descriptor, 'w1', 'French', false),
    );
    await waitFor(() => expect(result.current.status).toBe('cache'));
    expect(result.current.svg).toBe('<svg>cached</svg>');
    expect(genMock).not.toHaveBeenCalled();
  });

  it('LIFE-BACKDROP-2 — StrictMode double-invoke fires the Gemini backdrop gen ONCE (in-flight dedup)', async () => {
    genMock.mockResolvedValue({ kind: 'ok', svg: '<svg>real</svg>' });
    // StrictMode double-invokes the effect on mount — without the in-flight
    // dedup, that fires generateBackdrop twice (the 2x-tokens bug).
    const { result } = renderHook(
      () => useLifeBackdrop(descriptor, 'wStrict', 'French', true),
      { wrapper: StrictMode },
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(genMock).toHaveBeenCalledTimes(1);
  });
});

describe('useLifeBackdrop — LIFE-FAIL-3/4 gen retry + terminal fallback', () => {
  it('LIFE-FAIL-3 — a PERSISTENT backdrop retries ONCE on a transient failure, then succeeds', async () => {
    genMock
      .mockResolvedValueOnce({ kind: 'error', error: 'boom' })
      .mockResolvedValueOnce({ kind: 'ok', svg: '<svg>retry</svg>' });
    const { result } = renderHook(() =>
      useLifeBackdrop(descriptor, 'wRetry', 'French', true),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(genMock).toHaveBeenCalledTimes(2);
    expect(result.current.svg).toBe('<svg>retry</svg>');
  });

  it('LIFE-FAIL-3 — a PERSISTENT backdrop that fails TWICE lands on the fallback silhouette (never stuck generating)', async () => {
    genMock.mockResolvedValue({ kind: 'error', error: 'boom' });
    const { result } = renderHook(() =>
      useLifeBackdrop(descriptor, 'wFail', 'French', true),
    );
    await waitFor(() => expect(result.current.status).toBe('fallback'));
    expect(genMock).toHaveBeenCalledTimes(2);
  });

  it('LIFE-FAIL-4 — a TRANSIENT backdrop does NOT retry: one failure → fallback', async () => {
    genMock.mockResolvedValue({ kind: 'error', error: 'boom' });
    const transient: BackdropDescriptor = { ...descriptor, persistent: false };
    const { result } = renderHook(() =>
      useLifeBackdrop(transient, 'wTrans', 'French', true),
    );
    await waitFor(() => expect(result.current.status).toBe('fallback'));
    expect(genMock).toHaveBeenCalledTimes(1);
  });

  it('robustness — a gen that REJECTS lands on fallback, never stuck in generating', async () => {
    genMock.mockRejectedValue(new Error('network died'));
    const { result } = renderHook(() =>
      useLifeBackdrop(descriptor, 'wThrow', 'French', true),
    );
    await waitFor(() => expect(result.current.status).toBe('fallback'));
  });
});

describe('backdropBuildingVisible — LIFE-BACKDROP-7', () => {
  it('shows during an active gen regardless of gate/history', () => {
    expect(backdropBuildingVisible('generating', true, 5)).toBe(true);
    expect(backdropBuildingVisible('generating', false, 0)).toBe(true);
  });

  it('shows during the fresh-world placeholder window (fallback + cannot-gen + no events)', () => {
    expect(backdropBuildingVisible('fallback', false, 0)).toBe(true);
  });

  it('does NOT show once a real backdrop can generate (excludes LIFE-BACKDROP-8 terminal fallback)', () => {
    // canGenerate === true ⇒ a backdropIntent/currentBackdrop exists; a 'fallback'
    // here is the failure silhouette, not the "building" placeholder.
    expect(backdropBuildingVisible('fallback', true, 0)).toBe(false);
  });

  it('does NOT show on a resumed world that has history but momentarily no backdrop', () => {
    expect(backdropBuildingVisible('fallback', false, 12)).toBe(false);
  });

  it('does NOT show once a backdrop is ready or cached', () => {
    expect(backdropBuildingVisible('ready', false, 0)).toBe(false);
    expect(backdropBuildingVisible('cache', false, 0)).toBe(false);
  });
});
