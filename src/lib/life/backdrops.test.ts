/**
 * LIFE-BACKDROP-2/3 — the persistent backdrop cache reads and writes ONE path.
 *
 * Spec: docs/specs/life-sim.md — LIFE-BACKDROP-2/3, LIFE-BACKDROP-22.
 *
 * The 2026-08 rename moved this from `scenes/` to `backdrops/` and, briefly,
 * carried a read-fallback that served the old row and copied it forward. That
 * is gone: the life sim is a new feature with no data worth preserving, and a
 * cache miss costs one regeneration. What these assert is the contract that
 * remains — a hit serves, a miss returns null rather than an empty string, and
 * writes land where reads look.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Snap = { exists: () => boolean; data: () => unknown };

/** path -> stored doc. `undefined` = missing. */
const store = new Map<string, Record<string, unknown>>();
const setDocMock = vi.fn<(ref: { path: string }, data: unknown) => Promise<void>>(
  async () => undefined,
);
const updateDocMock = vi.fn<(...a: unknown[]) => Promise<void>>(async () => undefined);

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  collection: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  getDoc: async (ref: { path: string }): Promise<Snap> => {
    const data = store.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  },
  setDoc: (ref: { path: string }, data: unknown) => setDocMock(ref, data),
  updateDoc: (...a: unknown[]) => updateDocMock(...a),
  serverTimestamp: () => ({ __ts: 'server' }),
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));

import {
  backdropsCollection,
  readPersistentBackdrop,
  writePersistentBackdrop,
} from './backdrops';
import type { BackdropDescriptor } from './backdropDescriptor';

const descriptor: BackdropDescriptor = {
  locationType: 'cafe',
  vibe: 'modern_city',
  persistent: true,
};

const NEW = 'users/u1/lifeWorlds/w1/backdrops';

/** The doc id `descriptorCacheKey` resolves to for `descriptor`, discovered
 *  from the write path rather than hardcoded — the key format is that
 *  module's business, not this test's. */
async function keyForDescriptor(): Promise<string> {
  setDocMock.mockClear();
  await writePersistentBackdrop('u1', 'w1', descriptor, '<svg/>');
  const path = setDocMock.mock.calls[0]![0].path;
  return path.slice(path.lastIndexOf('/') + 1);
}

let ID = '';

beforeEach(async () => {
  store.clear();
  vi.clearAllMocks();
  if (!ID) ID = await keyForDescriptor();
  store.clear();
  vi.clearAllMocks();
});

describe('LIFE-BACKDROP-2/3 — the backdrop cache', () => {
  it('serves a cached row, and never writes on a read', async () => {
    store.set(`${NEW}/${ID}`, { svgInline: '<svg id="new"/>' });
    expect(await readPersistentBackdrop('u1', 'w1', descriptor)).toBe('<svg id="new"/>');
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('returns null on a miss — the caller regenerates', async () => {
    expect(await readPersistentBackdrop('u1', 'w1', descriptor)).toBeNull();
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('treats an empty svgInline as a miss', async () => {
    // A row that exists but carries no bytes is not a cache hit — serving ''
    // would render an empty stage rather than falling through to a render.
    store.set(`${NEW}/${ID}`, { svgInline: '' });
    expect(await readPersistentBackdrop('u1', 'w1', descriptor)).toBeNull();
  });

  it('writes where reads look', async () => {
    await writePersistentBackdrop('u1', 'w1', descriptor, '<svg/>', 'Le Café');
    expect(setDocMock).toHaveBeenCalledTimes(1);
    expect(setDocMock.mock.calls[0]![0].path).toBe(`${NEW}/${ID}`);
    expect(backdropsCollection('u1', 'w1').path).toBe(NEW);
  });
});
