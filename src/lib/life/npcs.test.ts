import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase', () => ({ db: {} }));

const updateDocMock = vi.fn(async (_ref: unknown, _data: unknown) => undefined);
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
    collection: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
    updateDoc: (ref: unknown, data: unknown) => updateDocMock(ref, data),
    serverTimestamp: () => '__ts__',
  };
});
vi.mock('./lifeAvatarAssets', () => ({
  writeNpcAvatar: vi.fn(async () => undefined),
}));
vi.mock('@/lib/log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import { setNpcAvatar, npcHasReadyAvatar, writeNpcMemories } from './npcs';
import { writeNpcAvatar } from './lifeAvatarAssets';
import type { LifeNpc } from '@/types/firestore';

const writeNpcAvatarMock = vi.mocked(writeNpcAvatar);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('setNpcAvatar — LIFE-DATA-1 (bytes to sidecar, status to doc)', () => {
  it('writes the BYTES to the npc sidecar and only the STATUS flag to the npc doc', async () => {
    await setNpcAvatar('u1', 'w1', 'sophie', 'data:xyz');
    // Sidecar first (bytes).
    expect(writeNpcAvatarMock).toHaveBeenCalledWith('u1', 'w1', 'sophie', 'data:xyz');
    // Doc gets the status flag — NEVER the avatar bytes.
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateDocMock.mock.calls[0]!;
    expect(patch).toMatchObject({ avatarStatus: 'ready' });
    expect(patch).not.toHaveProperty('avatarUrl');
  });
});

describe('npcHasReadyAvatar — LIFE-DATA-1', () => {
  it('is true for a ready npc — no avatarUrl needed (bytes live in the sidecar)', () => {
    expect(
      npcHasReadyAvatar({ id: 'x', name: 'X', avatarStatus: 'ready' } as LifeNpc),
    ).toBe(true);
    expect(
      npcHasReadyAvatar({ id: 'x', name: 'X', avatarStatus: 'pending' } as LifeNpc),
    ).toBe(false);
    expect(npcHasReadyAvatar(null)).toBe(false);
  });
});

describe('writeNpcMemories — LIFE-NPC-MEM-1 (roster-guarded, shared by inline + compaction)', () => {
  const roster: LifeNpc[] = [
    { id: 'n-sophie', name: 'Sophie', avatarStatus: 'ready', scope: 'world' },
    { id: 'n-marc', name: 'Marc', avatarStatus: 'ready', scope: 'world' },
  ];

  it('writes a trimmed memory for a KNOWN npc and skips it entirely for none', async () => {
    await writeNpcMemories('u1', 'w1', [{ npcId: 'n-sophie', oneLineMemory: '  You fixed her stall.  ' }], roster);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateDocMock.mock.calls[0]!;
    expect(patch).toMatchObject({ oneLineMemory: 'You fixed her stall.' });
  });

  it('DROPS a hallucinated npcId not in the roster (never writes it)', async () => {
    await writeNpcMemories('u1', 'w1', [{ npcId: 'n-ghost', oneLineMemory: 'invented' }], roster);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('DROPS an empty / whitespace memory', async () => {
    await writeNpcMemories('u1', 'w1', [{ npcId: 'n-sophie', oneLineMemory: '   ' }], roster);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('writes only the valid subset of a mixed batch', async () => {
    await writeNpcMemories('u1', 'w1', [
      { npcId: 'n-sophie', oneLineMemory: 'ok' },
      { npcId: 'n-ghost', oneLineMemory: 'dropped' },
      { npcId: 'n-marc', oneLineMemory: 'ok too' },
    ], roster);
    expect(updateDocMock).toHaveBeenCalledTimes(2);
  });

  it('a failed per-doc write is swallowed — never throws (best-effort polish)', async () => {
    updateDocMock.mockRejectedValueOnce(new Error('firestore offline'));
    await expect(
      writeNpcMemories('u1', 'w1', [{ npcId: 'n-sophie', oneLineMemory: 'x' }], roster),
    ).resolves.toBeUndefined();
  });
});
