/**
 * LIFE-SCENE-1 — the active-scene doc: patched in place, archived on resolve.
 *
 * Spec: docs/specs/life-sim.md — LIFE-SCENE-1, LIFE-SCENE-23.
 *
 * The 2026-08 rename moved this from `campaigns/` to `scenes/` and briefly
 * carried a copy-forward so a mid-scene world migrated itself on its next
 * turn. That is gone — the life sim is a new feature and its beta data is
 * disposable. What remains under test is the contract itself: `active` is a
 * reserved id, archiving moves it under the scene's own id, and a missing
 * scene is an error rather than a silent no-op.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** path -> stored doc. `undefined` = missing. */
const store = new Map<string, Record<string, unknown>>();
const setDocMock = vi.fn<(ref: { path: string }, data: unknown) => Promise<void>>(
  async () => undefined,
);
const updateDocMock = vi.fn<(ref: { path: string }, data: unknown) => Promise<void>>(
  async () => undefined,
);
const deleteDocMock = vi.fn<(ref: { path: string }) => Promise<void>>(
  async () => undefined,
);

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/'), ref: null }),
  collection: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  getDoc: async (ref: { path: string }) => {
    const data = store.get(ref.path);
    return { exists: () => data !== undefined, data: () => data, ref };
  },
  getDocs: async (ref: { path: string }) => ({
    docs: [...store.entries()]
      .filter(([p]) => p.startsWith(`${ref.path}/`))
      .map(([p, data]) => ({
        id: p.slice(ref.path.length + 1),
        data: () => data,
        ref: { path: p },
      })),
  }),
  setDoc: (ref: { path: string }, data: unknown) => setDocMock(ref, data),
  updateDoc: (ref: { path: string }, data: unknown) => updateDocMock(ref, data),
  deleteDoc: (ref: { path: string }) => deleteDocMock(ref),
  serverTimestamp: () => ({ __ts: 'server' }),
  writeBatch: () => {
    const ops: Array<{ kind: string; path: string; data?: unknown }> = [];
    batchOps = ops;
    return {
      set: (ref: { path: string }, data: unknown) =>
        ops.push({ kind: 'set', path: ref.path, data }),
      delete: (ref: { path: string }) => ops.push({ kind: 'delete', path: ref.path }),
      commit: async () => undefined,
    };
  },
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));

let batchOps: Array<{ kind: string; path: string; data?: unknown }> = [];

import { archiveScene, createScene, updateActiveScene } from './scene';
import type { SceneOutline } from '@/types/firestore';

const NEW = 'users/u1/lifeWorlds/w1/scenes';

const sceneDoc = () => ({
  id: 's-1',
  status: 'active',
  outline: { title: 'The Letter' },
  currentPhase: 'rising',
  turnsSinceReplan: 3,
});

beforeEach(() => {
  store.clear();
  batchOps = [];
  vi.clearAllMocks();
});

describe('LIFE-SCENE-1 — updateActiveScene', () => {
  it('patches the active doc in place', async () => {
    store.set(`${NEW}/active`, sceneDoc());
    await updateActiveScene('u1', 'w1', { turnsSinceReplan: 4 });
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock.mock.calls[0]![0].path).toBe(`${NEW}/active`);
    expect(setDocMock).not.toHaveBeenCalled();
  });

  it('still issues the update when there is no scene — a missing one is an ERROR', async () => {
    // No active scene is a real fault for this caller, and `updateDoc` throwing
    // on a missing doc is the contract. It must not become a silent no-op.
    await updateActiveScene('u1', 'w1', { turnsSinceReplan: 1 });
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    expect(updateDocMock.mock.calls[0]![0].path).toBe(`${NEW}/active`);
  });
});

describe('LIFE-SCENE-1 — archiveScene', () => {
  it('moves `active` under the scene\'s own id and deletes the reserved doc', async () => {
    store.set(`${NEW}/active`, sceneDoc());
    await archiveScene('u1', 'w1', 'completed');
    expect(batchOps.find((o) => o.kind === 'set')?.path).toBe(`${NEW}/s-1`);
    expect(batchOps.find((o) => o.kind === 'delete')?.path).toBe(`${NEW}/active`);
  });

  it('does nothing when there is no active scene', async () => {
    await archiveScene('u1', 'w1', 'completed');
    expect(batchOps).toEqual([]);
  });
});

/**
 * LIFE-CAST-6 — THE SCENE DOC MUST BE WRITABLE.
 *
 * `updateActiveScene` has stripped `undefined` since it was written;
 * `createScene` passed its outline straight into `setDoc`. The Firestore SDK
 * rejects an explicit `undefined` field value outright rather than ignoring it
 * (`ignoreUndefinedProperties` is not set in `src/lib/firebase.ts`), so ONE
 * absent optional field on the outline — `where`, `openQuestion` — failed the
 * entire scene write. `startScene` threw, `startSceneIfNone` swallowed it, and
 * the world was left with no active scene: per LIFE-SCENE-24 a chapter that
 * cannot end, re-billing `sceneOpen` every turn.
 *
 * The strip has to reach INSIDE the outline, not just the top level of the
 * doc: the outline is a nested map on both the `setDoc` payload and the
 * `updateActiveScene` patch replan uses to drop a fresh one in. Firestore
 * refuses an undefined at any depth.
 *
 * Asserted with `in` / `Object.keys`, not `toBeUndefined()` — `=== undefined`
 * cannot tell an absent key from an explicit one, which is the entire
 * distinction the SDK makes.
 */
describe('LIFE-CAST-6 — the scene doc carries no explicit undefined key', () => {
  const undefinedKeys = (o: object): string[] =>
    Object.entries(o)
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);

  const outline = (extra: Partial<SceneOutline> = {}): SceneOutline => ({
    title: 'The Letter',
    premise: 'The letter is still unopened',
    subject: 'the unopened letter',
    drawsOn: [],
    signOf: null,
    tone: '',
    practiceFocus: [],
    keyNpcs: [],
    openBranches: [],
    candidateEndings: [],
    completionTriggers: [],
    ...extra,
  });

  it('LIFE-CAST-6 — createScene strips an explicit undefined out of the outline before setDoc', async () => {
    await createScene({
      uid: 'u1',
      worldId: 'w1',
      id: 's-9',
      outline: outline({ where: undefined, openQuestion: undefined }),
    });
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [ref, data] = setDocMock.mock.calls[0]!;
    expect(ref.path).toBe(`${NEW}/active`);
    const written = data as { outline: Record<string, unknown> };
    expect('where' in written.outline).toBe(false);
    expect('openQuestion' in written.outline).toBe(false);
    expect(undefinedKeys(written.outline)).toEqual([]);
    expect(undefinedKeys(written)).toEqual([]);
  });

  it('LIFE-CAST-6 — the rest of the scene doc survives the strip', async () => {
    await createScene({
      uid: 'u1',
      worldId: 'w1',
      id: 's-9',
      outline: outline({ where: 'the bakery', keyNpcs: [{ npcId: 'marc', name: 'Marc', role: 'the baker' }] }),
    });
    const written = setDocMock.mock.calls[0]![1] as {
      id: string;
      status: string;
      currentPhase: string;
      turnsSinceReplan: number;
      chosenEndingKey: null;
      acceptedAt: unknown;
      outline: SceneOutline;
    };
    expect(written.id).toBe('s-9');
    expect(written.status).toBe('active');
    expect(written.currentPhase).toBe('opening');
    expect(written.turnsSinceReplan).toBe(0);
    // A real null is a legitimate Firestore value — only `undefined` is not.
    expect(written.chosenEndingKey).toBeNull();
    expect(written.acceptedAt).toEqual({ __ts: 'server' });
    expect(written.outline.where).toBe('the bakery');
    expect(written.outline.keyNpcs).toEqual([{ npcId: 'marc', name: 'Marc', role: 'the baker' }]);
  });

  it('LIFE-CAST-6 — updateActiveScene strips a NESTED undefined too, not just a top-level one', async () => {
    // Replan hands a whole fresh outline in through this path, so it carries
    // the identical exposure — the top-level-only strip walked straight past it.
    await updateActiveScene('u1', 'w1', {
      turnsSinceReplan: 0,
      outline: outline({ where: undefined }),
      leaning: undefined,
    });
    const patch = updateDocMock.mock.calls[0]![1] as {
      outline: Record<string, unknown>;
    };
    expect('leaning' in patch).toBe(false);
    expect('where' in patch.outline).toBe(false);
    expect(undefinedKeys(patch.outline)).toEqual([]);
  });
});
