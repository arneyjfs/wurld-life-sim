/**
 * LIFE-WORLD-9 — useWorldThumbnail resolution ladder.
 *
 * Real modules: backdropCache (localStorage in jsdom), fallbackBackdrops,
 * backdropDescriptor, backdropDescriptorForLife. Mocked: authStore (uid) and
 * lib/life/scenes (Firestore — keeps @/lib/firebase out of the test).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LifeWorld } from '@/types/firestore';
import { getFallbackBackdrop } from '@/lib/life/fallbackBackdrops';
import { pickFallback } from '@/lib/life/backdropDescriptor';
import { readBackdropCache, writeBackdropCache } from '@/lib/life/backdropCache';

// --- Controllable mock state ---------------------------------------------
let uidValue: string | null = 'u1';
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { uid: string } | null }) => unknown) =>
    sel({ user: uidValue ? { uid: uidValue } : null }),
}));

const readPersistentBackdropMock = vi.fn<
  (uid: string, worldId: string, d: unknown) => Promise<string | null>
>(async () => null);
vi.mock('@/lib/life/backdrops', () => ({
  readPersistentBackdrop: (uid: string, worldId: string, d: unknown) =>
    readPersistentBackdropMock(uid, worldId, d),
}));

import { useWorldThumbnail } from './useWorldThumbnail';

// --- Fixtures --------------------------------------------------------------
const CURRENT_SCENE = {
  locationType: 'cafe',
  vibe: 'modern_city',
  persistent: true,
  label: 'Cafe Lumiere',
};

function world(over: Partial<LifeWorld> = {}): LifeWorld {
  return {
    id: 'w1',
    characterName: 'Marc',
    practiceLanguage: 'French',
    nativeLanguage: 'English (British)',
    difficulty: 3,
    worldSeedKey: 'city_life',
    worldMode: 'realistic',
    ...over,
  };
}

const CACHED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#0c0c0c"/></svg>';
const REMOTE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#123456"/></svg>';
const SILHOUETTE = getFallbackBackdrop(pickFallback(CURRENT_SCENE));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('LIFE-WORLD-9 — useWorldThumbnail', () => {
  beforeEach(() => {
    localStorage.clear();
    uidValue = 'u1';
    readPersistentBackdropMock.mockReset();
    readPersistentBackdropMock.mockResolvedValue(null);
  });

  it('LIFE-WORLD-9 — fresh world (no currentBackdrop) resolves to null; no reads fired', async () => {
    const { result } = renderHook(() => useWorldThumbnail(world()));
    expect(result.current.svg).toBeNull();
    await flush();
    expect(result.current.svg).toBeNull();
    expect(readPersistentBackdropMock).not.toHaveBeenCalled();
  });

  it('LIFE-WORLD-9 — sync localStorage hit renders on first frame; Firestore read skipped', async () => {
    writeBackdropCache(CURRENT_SCENE, 'w1', CACHED_SVG);
    const { result } = renderHook(() =>
      useWorldThumbnail(world({ currentBackdrop: CURRENT_SCENE })),
    );
    expect(result.current.svg).toBe(CACHED_SVG);
    await flush();
    expect(result.current.svg).toBe(CACHED_SVG);
    expect(readPersistentBackdropMock).not.toHaveBeenCalled();
  });

  it('LIFE-WORLD-9 — cache miss: silhouette immediately, persisted SVG swaps in and re-seeds the cache', async () => {
    readPersistentBackdropMock.mockResolvedValue(REMOTE_SVG);
    const { result } = renderHook(() =>
      useWorldThumbnail(world({ currentBackdrop: CURRENT_SCENE })),
    );
    // Silhouette from the very first frame — no blank banner state.
    expect(result.current.svg).toBe(SILHOUETTE);
    await waitFor(() => expect(result.current.svg).toBe(REMOTE_SVG));
    expect(readPersistentBackdropMock).toHaveBeenCalledWith(
      'u1',
      'w1',
      expect.objectContaining({ label: 'Cafe Lumiere' }),
    );
    // Re-seed: the next render is a sync hit.
    expect(readBackdropCache(CURRENT_SCENE, 'w1')).toBe(REMOTE_SVG);
  });

  it('LIFE-WORLD-9 — cache miss + Firestore miss: silhouette stays; exactly one read, zero retries', async () => {
    const { result } = renderHook(() =>
      useWorldThumbnail(world({ currentBackdrop: CURRENT_SCENE })),
    );
    expect(result.current.svg).toBe(SILHOUETTE);
    await flush();
    expect(readPersistentBackdropMock).toHaveBeenCalledTimes(1);
    expect(result.current.svg).toBe(SILHOUETTE);
  });

  it('LIFE-WORLD-9 — signed-out (no uid): async read skipped, silhouette renders', async () => {
    uidValue = null;
    const { result } = renderHook(() =>
      useWorldThumbnail(world({ currentBackdrop: CURRENT_SCENE })),
    );
    expect(result.current.svg).toBe(SILHOUETTE);
    await flush();
    expect(readPersistentBackdropMock).not.toHaveBeenCalled();
  });

  it('LIFE-WORLD-9 — hook source never references a generation path (read-only reuse guard)', () => {
    // __dirname + join is the repo's established static-test pattern
    // (src/lib/__tests__/no-bare-model-literals.static.test.ts) — do
    // NOT use import.meta.url here (URL-scheme varies by transform).
    const src = readFileSync(join(__dirname, 'useWorldThumbnail.ts'), 'utf8');
    expect(src).not.toMatch(
      /generateBackdrop|generateGemini|geminiGenerate|runLifeStep|callHttp|callFunction/,
    );
  });
});
