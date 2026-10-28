// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSnapshotCache,
  purgeAllSnapshotCaches,
  readSnapshotCache,
  writeSnapshotCache,
} from './localCache';
import { Timestamp } from 'firebase/firestore';
import { parseDoc, ZChat } from '@/types/firestore';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('localCache', () => {
  it('round-trips a payload through write → read', () => {
    const docs = [
      { id: 'c1', data: { name: 'Ana', members: ['u1', 'u2'] } },
      { id: 'c2', data: { name: 'Bob', members: ['u1', 'u3'] } },
    ];
    writeSnapshotCache('chats:u1', docs);
    expect(readSnapshotCache('chats:u1')).toEqual(docs);
  });

  it('returns null when the key was never written', () => {
    expect(readSnapshotCache('unknown')).toBeNull();
  });

  it('returns null for malformed JSON without throwing', () => {
    localStorage.setItem('wurld.snap.v1.bad', 'not json');
    expect(readSnapshotCache('bad')).toBeNull();
  });

  it('returns null when the entry was written with a different schema version', () => {
    // Simulate a future-version entry that should not be honoured.
    localStorage.setItem(
      'wurld.snap.v1.future',
      JSON.stringify({ v: 99, docs: [{ id: 'a', data: {} }] }),
    );
    expect(readSnapshotCache('future')).toBeNull();
  });

  it('returns null when docs is missing or not an array', () => {
    localStorage.setItem(
      'wurld.snap.v1.shapeless',
      JSON.stringify({ v: 1, docs: 'oops' }),
    );
    expect(readSnapshotCache('shapeless')).toBeNull();
  });

  it('overwrites a previous entry rather than appending', () => {
    writeSnapshotCache('chats:u1', [{ id: 'c1', data: { name: 'before' } }]);
    writeSnapshotCache('chats:u1', [{ id: 'c1', data: { name: 'after' } }]);
    const out = readSnapshotCache('chats:u1');
    expect(out).toEqual([{ id: 'c1', data: { name: 'after' } }]);
  });

  it('clearSnapshotCache removes the named entry but leaves others alone', () => {
    writeSnapshotCache('chats:u1', [{ id: 'c1', data: {} }]);
    writeSnapshotCache('contacts:u1', [{ id: 'k1', data: {} }]);
    clearSnapshotCache('chats:u1');
    expect(readSnapshotCache('chats:u1')).toBeNull();
    expect(readSnapshotCache('contacts:u1')).not.toBeNull();
  });

  it('purgeAllSnapshotCaches clears only wurld.snap.* keys', () => {
    writeSnapshotCache('chats:u1', [{ id: 'c1', data: {} }]);
    writeSnapshotCache('contacts:u1', [{ id: 'k1', data: {} }]);
    localStorage.setItem('wurld.boot.v1', 'unrelated state — must survive');
    localStorage.setItem('other.app', 'untouched');

    purgeAllSnapshotCaches();

    expect(readSnapshotCache('chats:u1')).toBeNull();
    expect(readSnapshotCache('contacts:u1')).toBeNull();
    expect(localStorage.getItem('wurld.boot.v1')).toBe('unrelated state — must survive');
    expect(localStorage.getItem('other.app')).toBe('untouched');
  });

  it('on QuotaExceededError, purges its own caches and retries once', () => {
    writeSnapshotCache('chats:u1', [{ id: 'c1', data: {} }]);
    writeSnapshotCache('contacts:u1', [{ id: 'k1', data: {} }]);

    // Throw the first setItem call (the original write) but let the
    // retry after purge succeed.
    const original = Storage.prototype.setItem;
    let throws = 1;
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (throws > 0) {
          throws -= 1;
          const err = new Error('quota');
          (err as Error & { name: string }).name = 'QuotaExceededError';
          throw err;
        }
        original.call(this, key, value);
      });

    writeSnapshotCache('flashcards:u1', [{ id: 'f1', data: { phrase: 'x' } }]);

    expect(spy).toHaveBeenCalled();
    // Retry succeeded — the new entry is present, and the prior
    // entries were purged on the way.
    expect(readSnapshotCache('flashcards:u1')).toEqual([
      { id: 'f1', data: { phrase: 'x' } },
    ]);
    expect(readSnapshotCache('chats:u1')).toBeNull();
    expect(readSnapshotCache('contacts:u1')).toBeNull();
  });

  it('silently drops the write when both attempts fail', () => {
    const err = new Error('quota');
    (err as Error & { name: string }).name = 'QuotaExceededError';
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw err;
    });

    // Should not throw despite both writes failing.
    expect(() =>
      writeSnapshotCache('chats:u1', [{ id: 'c1', data: {} }]),
    ).not.toThrow();
  });

  it('does not treat a non-quota error as recoverable', () => {
    const err = new Error('something else');
    (err as Error & { name: string }).name = 'TypeError';
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw err;
      });

    writeSnapshotCache('chats:u1', [{ id: 'c1', data: {} }]);
    // One attempt only — no retry for non-quota errors.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('round-trips a Firestore-style timestamp shape', () => {
    // Firestore Timestamp.toJSON() produces { seconds, nanoseconds };
    // we don't reconstruct the class here (that's the caller's
    // Zod-based parseDoc step) but the raw shape must survive.
    const docs = [
      {
        id: 'c1',
        data: {
          name: 'Ana',
          lastMessageAt: { seconds: 1700000000, nanoseconds: 123_000_000 },
        },
      },
    ];
    writeSnapshotCache('chats:u1', docs);
    expect(readSnapshotCache('chats:u1')).toEqual(docs);
  });
});

describe('BOOT-CACHE-4 — superseded storage keys are purged', () => {
  it('BOOT-CACHE-4 — old boot / snapshot versions go, current ones and foreign keys stay', async () => {
    const { purgeStaleStorageKeys } = await import('./localCache');
    localStorage.setItem('wurld.boot.v1', '{"uid":"old"}');
    localStorage.setItem('wurld.boot.v2', '{"uid":"current"}');
    localStorage.setItem('wurld.snap.v0.chats:u1', '{}');
    localStorage.setItem('wurld.sync.v2.u1', '{}'); // retired store (BOOT-HYDRATION-10)
    localStorage.setItem('wurld.sync.v1.u1', '{}');
    writeSnapshotCache('chats:u1', [{ id: 'c1', data: {} }]);
    localStorage.setItem('wurld:theme', 'dark');
    localStorage.setItem('other.app', 'untouched');

    purgeStaleStorageKeys();

    expect(localStorage.getItem('wurld.boot.v1')).toBeNull();
    expect(localStorage.getItem('wurld.snap.v0.chats:u1')).toBeNull();
    expect(localStorage.getItem('wurld.sync.v2.u1')).toBeNull();
    expect(localStorage.getItem('wurld.sync.v1.u1')).toBeNull();
    expect(localStorage.getItem('wurld.boot.v2')).toBe('{"uid":"current"}');
    expect(readSnapshotCache('chats:u1')).not.toBeNull();
    expect(localStorage.getItem('wurld:theme')).toBe('dark');
    expect(localStorage.getItem('other.app')).toBe('untouched');
  });
});

describe('BOOT-HYDRATION-12 — the mirror is written once per doc version', () => {
  it('BOOT-HYDRATION-12 — an identical payload does not call setItem again', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    const docs = [{ id: 'me', data: { displayName: 'Me' } }];
    writeSnapshotCache('user:me', docs);
    writeSnapshotCache('user:me', [{ id: 'me', data: { displayName: 'Me' } }]);
    writeSnapshotCache('user:me', docs);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('BOOT-HYDRATION-12 — a changed payload is written', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    writeSnapshotCache('user:me', [{ id: 'me', data: { displayName: 'Me' } }]);
    writeSnapshotCache('user:me', [{ id: 'me', data: { displayName: 'Renamed' } }]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(readSnapshotCache('user:me')).toEqual([{ id: 'me', data: { displayName: 'Renamed' } }]);
  });

  it('BOOT-HYDRATION-12 — an external clear is not mistaken for "already written"', () => {
    const docs = [{ id: 'me', data: { displayName: 'Me' } }];
    writeSnapshotCache('user:me', docs);
    purgeAllSnapshotCaches();
    writeSnapshotCache('user:me', docs);
    expect(readSnapshotCache('user:me')).toEqual(docs);
    localStorage.clear();
    writeSnapshotCache('user:me', docs);
    expect(readSnapshotCache('user:me')).toEqual(docs);
  });
});

describe('BOOT-HYDRATION-7 — mirrored chat docs parse back like live ones', () => {
  it('BOOT-HYDRATION-7 — a chat doc with a Timestamp round-trips through the mirror', () => {
    const at = new Timestamp(1_790_000_000, 123_000_000);
    writeSnapshotCache('chats:u1', [
      { id: 'c1', data: { isGroup: false, members: ['u1', 'u2'], lastMessage: 'hola', lastMessageAt: at } },
    ]);
    const row = readSnapshotCache('chats:u1')?.[0];
    const chat = row ? parseDoc(ZChat, row.id, row.data) : null;
    expect(chat?.lastMessageAt?.toMillis()).toBe(at.toMillis());
    expect(chat?.lastMessage).toBe('hola');
  });
});
