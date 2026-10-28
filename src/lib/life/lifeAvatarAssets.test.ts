import { beforeEach, describe, expect, it, vi } from 'vitest';

// Firestore mocked so path construction + parse logic runs without a
// live backend. `doc(db, ...segments)` records its path; `setDoc`
// captures (ref, data); `getDoc` returns a controllable snapshot.
vi.mock('@/lib/firebase', () => ({ db: {} }));

const setDocMock = vi.fn(async (_ref: unknown, _data: unknown) => undefined);
let getDocResult: { exists: () => boolean; data: () => unknown } = {
  exists: () => false,
  data: () => ({}),
};

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    setDoc: (ref: unknown, data: unknown) => setDocMock(ref, data),
    getDoc: async () => getDocResult,
  };
});

import {
  writeCharacterAvatar,
  readCharacterAvatar,
  writeNpcAvatar,
  readNpcAvatar,
} from './lifeAvatarAssets';

beforeEach(() => {
  vi.clearAllMocks();
  getDocResult = { exists: () => false, data: () => ({}) };
});

describe('writeCharacterAvatar — LIFE-DATA-1', () => {
  it('writes { dataUri } to the assets/character sidecar', async () => {
    await writeCharacterAvatar('u1', 'w1', 'data:image/svg+xml;utf8,<svg/>');
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [ref, data] = setDocMock.mock.calls[0]!;
    expect((ref as { path: string }).path).toBe(
      'users/u1/lifeWorlds/w1/assets/character',
    );
    expect(data).toEqual({ dataUri: 'data:image/svg+xml;utf8,<svg/>' });
  });
});

describe('readCharacterAvatar — LIFE-DATA-1', () => {
  it('returns the dataUri when the sidecar exists', async () => {
    getDocResult = { exists: () => true, data: () => ({ dataUri: 'data:abc' }) };
    expect(await readCharacterAvatar('u1', 'w1')).toBe('data:abc');
  });

  it('returns null when the sidecar is missing', async () => {
    getDocResult = { exists: () => false, data: () => ({}) };
    expect(await readCharacterAvatar('u1', 'w1')).toBeNull();
  });

  it('returns null when dataUri is empty / non-string / absent', async () => {
    getDocResult = { exists: () => true, data: () => ({ dataUri: '' }) };
    expect(await readCharacterAvatar('u1', 'w1')).toBeNull();
    getDocResult = { exists: () => true, data: () => ({ dataUri: 123 }) };
    expect(await readCharacterAvatar('u1', 'w1')).toBeNull();
    getDocResult = { exists: () => true, data: () => ({}) };
    expect(await readCharacterAvatar('u1', 'w1')).toBeNull();
  });
});

describe('writeNpcAvatar / readNpcAvatar — LIFE-DATA-1 / LIFE-NPC-2', () => {
  it('writes to the assets/npc-{id} sidecar, namespaced away from the player', async () => {
    await writeNpcAvatar('u1', 'w1', 'sophie', 'data:npc');
    const [ref, data] = setDocMock.mock.calls[0]!;
    expect((ref as { path: string }).path).toBe(
      'users/u1/lifeWorlds/w1/assets/npc-sophie',
    );
    expect(data).toEqual({ dataUri: 'data:npc' });
  });

  it('reads the dataUri back for an NPC', async () => {
    getDocResult = { exists: () => true, data: () => ({ dataUri: 'data:npc' }) };
    expect(await readNpcAvatar('u1', 'w1', 'sophie')).toBe('data:npc');
  });

  it('returns null when the NPC sidecar is missing', async () => {
    getDocResult = { exists: () => false, data: () => ({}) };
    expect(await readNpcAvatar('u1', 'w1', 'sophie')).toBeNull();
  });
});
