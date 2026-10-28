/**
 * LIFE-SETTINGS-6 — deleting a wurld wipes EVERY subcollection it promised to.
 *
 * Spec: docs/specs/life-sim.md — LIFE-SETTINGS-6, LIFE-BACKDROP-22,
 * LIFE-SCENE-23.
 *
 * THE BUG THIS EXISTS FOR. `deleteLifeWorld` hard-codes the list of
 * subcollections to sweep, and the 2026-08 rename moved two of them. After the
 * backdrop rename the list still said `scenes` — the name backdrops had just
 * VACATED — so a wipe deleted nothing at the new `backdrops/` path and left
 * every generated SVG behind. Silent, because the world doc itself does
 * disappear and the screen looks right.
 *
 * The delete-confirm copy says "every event, NPC, backdrop, and any active or
 * archived scene". This array is the only thing that makes that true, which is
 * why it is asserted by NAME rather than by "the delete didn't throw".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleted: string[] = [];
const listed: string[] = [];

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  collection: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  getDocs: async (ref: { path: string }) => {
    listed.push(ref.path);
    // One doc per collection, so a missed collection shows up as a missing
    // DELETE rather than only as a missing read.
    return {
      forEach: (fn: (d: { ref: { path: string } }) => void) =>
        fn({ ref: { path: `${ref.path}/doc-1` } }),
    };
  },
  serverTimestamp: () => ({ __ts: 'server' }),
  setDoc: async () => undefined,
  updateDoc: async () => undefined,
  writeBatch: () => ({
    delete: (ref: { path: string }) => deleted.push(ref.path),
    commit: async () => undefined,
  }),
}));
vi.mock('firebase/storage', () => ({
  ref: () => ({}),
  listAll: async () => ({ items: [], prefixes: [] }),
  deleteObject: async () => undefined,
}));
vi.mock('@/lib/firebase', () => ({ db: {}, storage: {} }));
vi.mock('@/lib/log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('./backdropCache', () => ({ clearAllBackdropCaches: vi.fn() }));

import { deleteLifeWorld, WORLD_SUBCOLLECTIONS } from './world';

const BASE = 'users/u1/lifeWorlds/w1';

beforeEach(() => {
  deleted.length = 0;
  listed.length = 0;
});

describe('LIFE-SETTINGS-6 — deleteLifeWorld sweeps every subcollection', () => {
  it('deletes a doc from each of the world’s subcollections, and the world doc', async () => {
    await deleteLifeWorld('u1', 'w1');
    for (const name of WORLD_SUBCOLLECTIONS) {
      expect(deleted, name).toContain(`${BASE}/${name}/doc-1`);
    }
    expect(deleted).toContain(BASE);
  });

  it('LIFE-BACKDROP-22 — sweeps `backdrops`, the CURRENT backdrop path', async () => {
    // The regression: after the rename the list still named `scenes`, so every
    // backdrop the player had generated survived a wipe they were told was
    // total.
    await deleteLifeWorld('u1', 'w1');
    expect(deleted).toContain(`${BASE}/backdrops/doc-1`);
  });

  it('LIFE-BACKDROP-22 / LIFE-SCENE-23 — sweeps the ORPHANED pre-rename names too', async () => {
    // Nothing reads these any more. But "nothing reads it" is not "the user
    // agreed to keep it", and the delete copy promises a total wipe.
    await deleteLifeWorld('u1', 'w1');
    expect(deleted).toContain(`${BASE}/scenes/doc-1`); // scenes + legacy backdrops
    expect(deleted).toContain(`${BASE}/campaigns/doc-1`); // legacy scenes
  });

  it('sweeps completedArcs and assets — the two nobody remembers', async () => {
    // `assets` holds the player-avatar bytes and `completedArcs` the chapter
    // history; both were absent from the original list.
    await deleteLifeWorld('u1', 'w1');
    expect(deleted).toContain(`${BASE}/completedArcs/doc-1`);
    expect(deleted).toContain(`${BASE}/assets/doc-1`);
  });

  it('names no collection twice — a duplicate is a rename that half-landed', async () => {
    expect(new Set(WORLD_SUBCOLLECTIONS).size).toBe(WORLD_SUBCOLLECTIONS.length);
  });
});
