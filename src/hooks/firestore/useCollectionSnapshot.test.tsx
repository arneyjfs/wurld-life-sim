import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const docsFromCache = vi.fn();
const onSnapshotMock = vi.fn();

vi.mock('firebase/firestore', () => ({
  getDocsFromCache: (...args: unknown[]) => docsFromCache(...args),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

const authState = { user: null as { uid: string } | null };
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) =>
    selector(authState),
}));

import { useCollectionSnapshot } from './useCollectionSnapshot';
import { _resetFirestoreShutDownForTest, markFirestoreShutDown } from '@/lib/firestoreShutdown';
import { _clearSnapshotCacheForTest, readLiveCollection } from '@/lib/snapshotCache';
import { readSnapshotCache, writeSnapshotCache } from '@/lib/localCache';

const ZRow = z.object({
  id: z.string().optional(),
  name: z.string(),
});

beforeEach(() => {
  authState.user = null;
  docsFromCache.mockReset();
  onSnapshotMock.mockReset();
  docsFromCache.mockResolvedValue({ docs: [] });
  onSnapshotMock.mockReturnValue(() => {});
  // The collection cache is module-scope. Without this, an earlier test's
  // written array gets served synchronously to the next test that reuses
  // (schema, resetKey), flipping loading from true to false unexpectedly.
  _clearSnapshotCacheForTest();
  _resetFirestoreShutDownForTest();
});

describe('useCollectionSnapshot', () => {
  it('returns empty + loading: false when query is null', () => {
    const { result } = renderHook(() => useCollectionSnapshot(ZRow, null, null));
    expect(result.current).toEqual({
      data: [],
      loading: false,
      error: null,
      fromCache: true,
      rawSize: 0,
    });
  });

  it('returns empty + loading: true when query is set but cache + listener not resolved', () => {
    const { result } = renderHook(() =>
      useCollectionSnapshot(ZRow, {} as never, 'uid1'),
    );
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  it('resets state when depKey transitions null → set', () => {
    // The render-time setState pattern: a hook that mounted with
    // depKey=null and useState(loading: false) shouldn't carry that into
    // the first render with a real depKey. Otherwise consumers gating on
    // `loading` (e.g. spinners) would skip the loading state entirely
    // on the first render after uid arrives.
    const { result, rerender } = renderHook(
      ({ query, depKey }: { query: never | null; depKey: string | null }) =>
        useCollectionSnapshot(ZRow, query, depKey),
      {
        initialProps: {
          query: null as never | null,
          depKey: null as string | null,
        },
      },
    );
    expect(result.current).toEqual({
      data: [],
      loading: false,
      error: null,
      fromCache: true,
      rawSize: 0,
    });

    rerender({ query: {} as never, depKey: 'uid1' });
    expect(result.current.loading).toBe(true);
  });

  it('populates state from getDocsFromCache when it resolves with docs', async () => {
    docsFromCache.mockResolvedValue({
      docs: [
        { id: 'r1', data: () => ({ name: 'first' }) },
        { id: 'r2', data: () => ({ name: 'second' }) },
      ],
    });
    const { result } = renderHook(() =>
      useCollectionSnapshot(ZRow, {} as never, 'uid1'),
    );
    expect(result.current.loading).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    // parseDoc merges the firestore doc id onto the parsed object — see
    // types/firestore.ts. The hook respects that, so consumers can use
    // `row.id` even when the underlying doc data doesn't carry one.
    expect(result.current.data).toEqual([
      { id: 'r1', name: 'first' },
      { id: 'r2', name: 'second' },
    ]);
    expect(result.current.loading).toBe(false);
  });

  it('silently drops cache docs that fail parseDoc (schema drift)', async () => {
    docsFromCache.mockResolvedValue({
      docs: [
        { id: 'good', data: () => ({ name: 'kept' }) },
        { id: 'bad', data: () => ({ name: 42 }) /* wrong type */ },
      ],
    });
    const { result } = renderHook(() =>
      useCollectionSnapshot(ZRow, {} as never, 'uid1'),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data).toEqual([{ id: 'good', name: 'kept' }]);
  });

  it('does not attach onSnapshot until authReady', () => {
    renderHook(() => useCollectionSnapshot(ZRow, {} as never, 'uid1'));
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });
});

describe('BOOT-CACHE-5 — live collections', () => {
  function snap(fromCache: boolean, names: string[]) {
    const docs = names.map((n) => ({ id: n, data: () => ({ name: n }), ref: { path: `rows/${n}` } }));
    return {
      docs,
      metadata: { fromCache, hasPendingWrites: false },
      docChanges: () => docs.map((d) => ({ type: 'added', doc: d })),
    };
  }

  it('BOOT-CACHE-5 — live only after a SERVER emit, and no longer once unmounted', () => {
    authState.user = { uid: 'u1' };
    let emit: ((s: unknown) => void) | null = null;
    onSnapshotMock.mockImplementation((_q: unknown, _o: unknown, next: (s: unknown) => void) => {
      emit = next;
      return () => {};
    });
    const { unmount } = renderHook(() => useCollectionSnapshot(ZRow, {} as never, 'live-k'));
    expect(readLiveCollection(ZRow, 'live-k')).toBeUndefined();

    act(() => emit!(snap(true, ['a'])));
    expect(readLiveCollection(ZRow, 'live-k')).toBeUndefined(); // cache emit: not live

    act(() => emit!(snap(false, ['b', 'a'])));
    expect(readLiveCollection<{ name: string }>(ZRow, 'live-k')?.map((r) => r.name)).toEqual(['b', 'a']);

    unmount();
    expect(readLiveCollection(ZRow, 'live-k')).toBeUndefined();
  });
});

describe('BOOT-CACHE-6 — only the holding listener writes a live entry', () => {
  function snap(fromCache: boolean, names: string[]) {
    const docs = names.map((n) => ({ id: n, data: () => ({ name: n }), ref: { path: `rows/${n}` } }));
    return {
      docs,
      metadata: { fromCache, hasPendingWrites: false },
      docChanges: () => docs.map((d) => ({ type: 'added', doc: d })),
    };
  }

  it('BOOT-CACHE-6 — a stage-1 cache read that resolves after the first server emit does not overwrite the live tail', async () => {
    authState.user = { uid: 'u1' };
    // The device case: IndexedDB is slow, so the eager cache read is still in
    // flight when the listener's first SERVER emit lands with newer docs.
    let resolveCache: ((v: unknown) => void) | null = null;
    docsFromCache.mockReturnValue(new Promise((r) => { resolveCache = r; }));
    let emit: ((s: unknown) => void) | null = null;
    onSnapshotMock.mockImplementation((_q: unknown, _o: unknown, next: (s: unknown) => void) => {
      emit = next;
      return () => {};
    });
    const { unmount } = renderHook(() => useCollectionSnapshot(ZRow, {} as never, 'race-k'));
    act(() => emit!(snap(false, ['new', 'old'])));
    await act(async () => {
      resolveCache!({ docs: [{ id: 'old', data: () => ({ name: 'old' }) }] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(readLiveCollection<{ name: string }>(ZRow, 'race-k')?.map((r) => r.name)).toEqual(['new', 'old']);
    unmount();
  });
});

describe('OBS-FIRESTORE-6 — never touches a terminated client', () => {
  it('OBS-FIRESTORE-6 — once shut down, neither the cache read nor the listener runs', () => {
    authState.user = { uid: 'uid1' };
    markFirestoreShutDown();
    renderHook(() => useCollectionSnapshot(ZRow, {} as never, 'uid1'));
    expect(docsFromCache).not.toHaveBeenCalled();
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });
});

describe('BOOT-HYDRATION — localStorage mirror for bounded collections', () => {
  function snap(fromCache: boolean, names: string[]) {
    const docs = names.map((n) => ({ id: n, data: () => ({ name: n }), ref: { path: `rows/${n}` } }));
    return {
      docs,
      metadata: { fromCache, hasPendingWrites: false },
      docChanges: () => docs.map((d) => ({ type: 'added', doc: d })),
    };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it('BOOT-HYDRATION-1 — a mirrored collection paints in the first render, before any cache read resolves', () => {
    writeSnapshotCache('rows:u1', [
      { id: 'a', data: { name: 'Ana' } },
      { id: 'b', data: { name: 'Ben' } },
    ]);
    docsFromCache.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() =>
      useCollectionSnapshot(ZRow, {} as never, 'u1', undefined, 'rows:u1'),
    );
    expect(result.current.data).toEqual([
      { id: 'a', name: 'Ana' },
      { id: 'b', name: 'Ben' },
    ]);
    expect(result.current.loading).toBe(false);
    // Not server-confirmed: consumers gating on the server still wait.
    expect(result.current.fromCache).toBe(true);
  });

  it('BOOT-HYDRATION-1 — the mirror also paints when the key arrives after mount (uid null → set)', () => {
    writeSnapshotCache('rows:u1', [{ id: 'a', data: { name: 'Ana' } }]);
    docsFromCache.mockReturnValue(new Promise(() => {}));
    const { result, rerender } = renderHook(
      ({ uid }: { uid: string | null }) =>
        useCollectionSnapshot(ZRow, uid ? ({} as never) : null, uid, undefined, uid ? `rows:${uid}` : undefined),
      { initialProps: { uid: null as string | null } },
    );
    rerender({ uid: 'u1' });
    expect(result.current.data).toEqual([{ id: 'a', name: 'Ana' }]);
    expect(result.current.loading).toBe(false);
  });

  it('BOOT-HYDRATION-3 — a listener emit with new content writes through to the mirror', () => {
    authState.user = { uid: 'u1' };
    let emit: ((s: unknown) => void) | null = null;
    onSnapshotMock.mockImplementation((_q: unknown, _o: unknown, next: (s: unknown) => void) => {
      emit = next;
      return () => {};
    });
    renderHook(() => useCollectionSnapshot(ZRow, {} as never, 'u1', undefined, 'rows:u1'));
    act(() => emit!(snap(false, ['x', 'y'])));
    expect(readSnapshotCache('rows:u1')).toEqual([
      { id: 'x', data: { name: 'x' } },
      { id: 'y', data: { name: 'y' } },
    ]);
  });

  it('BOOT-HYDRATION-4 — without a cacheKey nothing is mirrored or read back', () => {
    authState.user = { uid: 'u1' };
    writeSnapshotCache('rows:u1', [{ id: 'a', data: { name: 'Ana' } }]);
    let emit: ((s: unknown) => void) | null = null;
    onSnapshotMock.mockImplementation((_q: unknown, _o: unknown, next: (s: unknown) => void) => {
      emit = next;
      return () => {};
    });
    const { result } = renderHook(() => useCollectionSnapshot(ZRow, {} as never, 'u1'));
    expect(result.current.data).toEqual([]);
    act(() => emit!(snap(false, ['x'])));
    expect(readSnapshotCache('rows:u1')).toEqual([{ id: 'a', data: { name: 'Ana' } }]);
  });

  it('BOOT-HYDRATION-1 — a mirrored row that no longer parses is dropped, not fatal', () => {
    writeSnapshotCache('rows:u1', [
      { id: 'a', data: { name: 'Ana' } },
      { id: 'bad', data: { name: 42 } },
    ]);
    docsFromCache.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() =>
      useCollectionSnapshot(ZRow, {} as never, 'u1', undefined, 'rows:u1'),
    );
    expect(result.current.data).toEqual([{ id: 'a', name: 'Ana' }]);
  });
});

describe('BOOT-HYDRATION-14 — our own pending writes do not replace mirrored rows', () => {
  function pendingSnap(names: string[]) {
    const docs = names.map((n) => ({
      id: n,
      data: () => ({ name: n }),
      ref: { path: `rows/${n}` },
      metadata: { hasPendingWrites: true },
    }));
    return {
      docs,
      metadata: { fromCache: true, hasPendingWrites: true },
      docChanges: () => docs.map((d) => ({ type: 'added', doc: d })),
    };
  }
  function serverSnap(names: string[]) {
    const docs = names.map((n) => ({
      id: n,
      data: () => ({ name: n }),
      ref: { path: `rows/${n}` },
      metadata: { hasPendingWrites: false },
    }));
    return {
      docs,
      metadata: { fromCache: false, hasPendingWrites: false },
      docChanges: () => docs.map((d) => ({ type: 'added', doc: d })),
    };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it('BOOT-HYDRATION-14 — a cache emit holding only a pending write is overlaid on the mirror, not swapped in, and not mirrored', () => {
    authState.user = { uid: 'u1' };
    writeSnapshotCache('rows:u1', [
      { id: 'tutor', data: { name: 'Old tutor' } },
      { id: 'friend', data: { name: 'Friend' } },
    ]);
    docsFromCache.mockReturnValue(new Promise(() => {}));
    let emit: ((s: unknown) => void) | null = null;
    onSnapshotMock.mockImplementation((_q: unknown, _o: unknown, next: (s: unknown) => void) => {
      emit = next;
      return () => {};
    });
    const { result } = renderHook(() => useCollectionSnapshot(ZRow, {} as never, 'u1', undefined, 'rows:u1'));
    act(() => emit!(pendingSnap(['tutor'])));
    expect(result.current.data).toEqual([
      { id: 'tutor', name: 'tutor' },
      { id: 'friend', name: 'Friend' },
    ]);
    expect(readSnapshotCache('rows:u1')).toEqual([
      { id: 'tutor', data: { name: 'Old tutor' } },
      { id: 'friend', data: { name: 'Friend' } },
    ]);

    // The server's answer is the collection: it replaces and is mirrored.
    act(() => emit!(serverSnap(['tutor'])));
    expect(result.current.data).toEqual([{ id: 'tutor', name: 'tutor' }]);
    expect(readSnapshotCache('rows:u1')).toEqual([{ id: 'tutor', data: { name: 'tutor' } }]);
  });

  it('BOOT-HYDRATION-14 — a server confirm with no content change still replaces the overlaid mirror', () => {
    authState.user = { uid: 'u1' };
    writeSnapshotCache('rows:u1', [
      { id: 'tutor', data: { name: 'tutor' } },
      { id: 'gone', data: { name: 'Deleted elsewhere' } },
    ]);
    docsFromCache.mockReturnValue(new Promise(() => {}));
    let emit: ((s: unknown) => void) | null = null;
    onSnapshotMock.mockImplementation((_q: unknown, _o: unknown, next: (s: unknown) => void) => {
      emit = next;
      return () => {};
    });
    const { result } = renderHook(() => useCollectionSnapshot(ZRow, {} as never, 'u1', undefined, 'rows:u1'));
    act(() => emit!(pendingSnap(['tutor'])));
    expect(result.current.data).toHaveLength(2);
    // The SDK's view already held exactly [tutor]: the server ack is a pure
    // metadata tick, yet it is the first word on the whole collection.
    act(() => emit!({ ...serverSnap(['tutor']), docChanges: () => [] }));
    expect(result.current.data).toEqual([{ id: 'tutor', name: 'tutor' }]);
    expect(result.current.fromCache).toBe(false);
    expect(readSnapshotCache('rows:u1')).toEqual([{ id: 'tutor', data: { name: 'tutor' } }]);
  });

  it('BOOT-HYDRATION-14 — without mirrored rows a pending-only emit applies as before', () => {
    authState.user = { uid: 'u1' };
    let emit: ((s: unknown) => void) | null = null;
    onSnapshotMock.mockImplementation((_q: unknown, _o: unknown, next: (s: unknown) => void) => {
      emit = next;
      return () => {};
    });
    const { result } = renderHook(() => useCollectionSnapshot(ZRow, {} as never, 'u1', undefined, 'rows:u1'));
    act(() => emit!(pendingSnap(['tutor'])));
    expect(result.current.data).toEqual([{ id: 'tutor', name: 'tutor' }]);
  });
});
