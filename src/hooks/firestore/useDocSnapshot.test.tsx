import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Mock firebase/firestore at the module boundary so the hook never touches
// the real SDK. We only care about the doc-path → state transition
// behaviour; the actual snapshot wiring is tested by integration in the
// app itself.
const docFromCache = vi.fn();
const onSnapshotMock = vi.fn();
const docRef = { __ref: true };

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => docRef),
  getDocFromCache: (...args: unknown[]) => docFromCache(...args),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
}));

vi.mock('@/lib/firebase', () => ({ db: {} }));

// Controllable auth state. We default to "no user" so Stage 2 (the live
// listener) is skipped — keeps the test focused on the synchronous
// hydration path.
const authState = { user: null as { uid: string } | null };
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) =>
    selector(authState),
}));

// Controllable localCache. Each test arranges what readSnapshotCache
// returns for the cacheKey it cares about.
const cacheStore = new Map<string, Array<{ id: string; data: unknown }> | null>();
vi.mock('@/lib/localCache', () => ({
  readSnapshotCache: (key: string) => cacheStore.get(key) ?? null,
  writeSnapshotCache: (key: string, docs: Array<{ id: string; data: unknown }>) => {
    cacheStore.set(key, docs);
  },
}));

const logError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/log', async (orig) => ({ ...(await orig<typeof import('@/lib/log')>()), error: logError }));

import { useDocSnapshot } from './useDocSnapshot';
import { _resetFirestoreShutDownForTest, markFirestoreShutDown } from '@/lib/firestoreShutdown';
import { _clearSnapshotCacheForTest } from '@/lib/snapshotCache';

const ZProfile = z.object({
  displayName: z.string().optional(),
  nativeLanguage: z.string().optional(),
});

beforeEach(() => {
  cacheStore.clear();
  authState.user = null;
  docFromCache.mockReset();
  onSnapshotMock.mockReset();
  docFromCache.mockResolvedValue({ exists: () => false });
  onSnapshotMock.mockReturnValue(() => {});
  // In-memory docCache persists across tests (module scope). Stage 1's
  // write would otherwise leak prior-test data into the next test's
  // synchronous hydrate path.
  _clearSnapshotCacheForTest();
  _resetFirestoreShutDownForTest();
});

afterEach(() => {
  cacheStore.clear();
});

describe('useDocSnapshot — synchronous hydration', () => {
  it('returns data: null, loading: false when path is null and no cacheKey', () => {
    const { result } = renderHook(() => useDocSnapshot(ZProfile, null));
    expect(result.current).toEqual({ data: null, loading: false, error: null });
  });

  it('synchronously hydrates from localStorage on first render when path + cacheKey present', () => {
    cacheStore.set('user:uid1', [
      { id: 'uid1', data: { displayName: 'Cached Alice' } },
    ]);
    const { result } = renderHook(() =>
      useDocSnapshot(ZProfile, 'users/uid1', 'user:uid1'),
    );
    expect(result.current.data).toEqual({ displayName: 'Cached Alice' });
    expect(result.current.loading).toBe(false);
  });

  it('returns loading: true when path is set but no cache hit', () => {
    const { result } = renderHook(() =>
      useDocSnapshot(ZProfile, 'users/uid1', 'user:uid1'),
    );
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });
});

describe('useDocSnapshot — null → set path transition', () => {
  it('hydrates synchronously on the NEXT render when path transitions from null to set', () => {
    // This is the no-flash regression test. Without the render-time
    // setState-from-previous-render pattern, the first render with the
    // new path would show {data: null, loading: false} carried over from
    // the previous (path=null) render — which on routes.tsx flashes
    // ProfileSetupScreen for returning users while onSnapshot resolves.
    cacheStore.set('user:uid1', [
      { id: 'uid1', data: { displayName: 'Cached Alice' } },
    ]);

    const { result, rerender } = renderHook(
      ({ path, cacheKey }: { path: string | null; cacheKey?: string }) =>
        useDocSnapshot(ZProfile, path, cacheKey),
      { initialProps: { path: null as string | null, cacheKey: undefined as string | undefined } },
    );

    // First render: path=null, no hydration.
    expect(result.current).toEqual({ data: null, loading: false, error: null });

    // Auth restores, parent passes the real path + cacheKey.
    rerender({ path: 'users/uid1', cacheKey: 'user:uid1' });

    // No flash — the cached profile is in state by the time this render
    // returns. Without the render-time setState the data would be null
    // here and only the next effect-driven render would have it.
    expect(result.current.data).toEqual({ displayName: 'Cached Alice' });
    expect(result.current.loading).toBe(false);
  });

  it('resets to data: null, loading: false when path goes from set to null', () => {
    cacheStore.set('user:uid1', [
      { id: 'uid1', data: { displayName: 'Cached Alice' } },
    ]);
    const { result, rerender } = renderHook(
      ({ path, cacheKey }: { path: string | null; cacheKey?: string }) =>
        useDocSnapshot(ZProfile, path, cacheKey),
      {
        initialProps: {
          path: 'users/uid1' as string | null,
          cacheKey: 'user:uid1' as string | undefined,
        },
      },
    );
    expect(result.current.data).not.toBeNull();
    rerender({ path: null, cacheKey: undefined });
    expect(result.current).toEqual({ data: null, loading: false, error: null });
  });

  it('rehydrates from the new cacheKey when uid changes', () => {
    cacheStore.set('user:uid1', [
      { id: 'uid1', data: { displayName: 'Alice' } },
    ]);
    cacheStore.set('user:uid2', [
      { id: 'uid2', data: { displayName: 'Bob' } },
    ]);
    const { result, rerender } = renderHook(
      ({ path, cacheKey }: { path: string; cacheKey: string }) =>
        useDocSnapshot(ZProfile, path, cacheKey),
      { initialProps: { path: 'users/uid1', cacheKey: 'user:uid1' } },
    );
    expect(result.current.data).toEqual({ displayName: 'Alice' });
    rerender({ path: 'users/uid2', cacheKey: 'user:uid2' });
    expect(result.current.data).toEqual({ displayName: 'Bob' });
  });
});

describe('useDocSnapshot — schema drift on cache', () => {
  it('falls back to {data: null, loading: true} when cached doc fails parseDoc', () => {
    // Simulate a server-side schema change that leaves an old cached
    // entry that no longer matches the Zod shape. readSnapshotCache
    // returns it; parseDoc rejects it; we should treat that as "no
    // cache" rather than crashing or rendering garbage.
    cacheStore.set('user:uid1', [
      { id: 'uid1', data: { displayName: 123 } /* wrong type */ },
    ]);
    const { result } = renderHook(() =>
      useDocSnapshot(ZProfile, 'users/uid1', 'user:uid1'),
    );
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });
});

describe('useDocSnapshot — Stage 2 cache read', () => {
  it('updates state from getDocFromCache when localStorage had nothing', async () => {
    docFromCache.mockResolvedValue({
      exists: () => true,
      id: 'uid1',
      data: () => ({ displayName: 'From IndexedDB' }),
    });
    const { result } = renderHook(() =>
      useDocSnapshot(ZProfile, 'users/uid1'),
    );
    expect(result.current.loading).toBe(true);
    await act(async () => {
      // Let the Stage 2 promise resolve.
      await Promise.resolve();
    });
    expect(result.current.data).toEqual({ displayName: 'From IndexedDB' });
    expect(result.current.loading).toBe(false);
  });

  it('Stage 2 does not clobber Stage 1 hydrated data', async () => {
    cacheStore.set('user:uid1', [
      { id: 'uid1', data: { displayName: 'From localStorage' } },
    ]);
    docFromCache.mockResolvedValue({
      exists: () => true,
      id: 'uid1',
      data: () => ({ displayName: 'From IndexedDB' }),
    });
    const { result } = renderHook(() =>
      useDocSnapshot(ZProfile, 'users/uid1', 'user:uid1'),
    );
    // Stage 1 wins because loading: false already.
    expect(result.current.data).toEqual({ displayName: 'From localStorage' });
    await act(async () => {
      await Promise.resolve();
    });
    // Stage 2 saw loading: false and bailed.
    expect(result.current.data).toEqual({ displayName: 'From localStorage' });
  });
});

/**
 * BOOT-HYDRATION-9 — a document we know about ONLY because we just wrote to
 * it is not knowledge of the document.
 *
 * The bug: `recordLastSeen` stamps `lastSeenAt/lastPlatform/lastAppVersion`
 * on the user doc at boot. With a cold Firestore cache the SDK has no server
 * copy to merge onto, so its latency-compensated local view is a doc
 * containing ONLY those three fields. `useUserProfile` resolved that as
 * `{ loading: false, data: <partial> }`, the onboarding gate read it as a
 * real profile with every field missing, and the user was shown the legal /
 * profile-completion gate for as long as the server round-trip took.
 *
 * Caught by the @critical webkit-mobile suite, which failed EVERY spec at
 * that gate. Timing-dependent — adding a console.log made it pass — which is
 * exactly why the fix has to be at the source rather than a longer timeout.
 */
describe('BOOT-HYDRATION-9 — a pending-write-only doc is not resolved data', () => {
  /** The local view Firestore synthesises for a merge write onto a doc it has
   *  never seen: our fields, nothing else, flagged as un-acked. */
  const pendingSnap = (data: unknown) => ({
    exists: () => true,
    id: 'uid1',
    data: () => data,
    metadata: { hasPendingWrites: true, fromCache: true },
  });
  const serverSnap = (data: unknown) => ({
    exists: () => true,
    id: 'uid1',
    data: () => data,
    metadata: { hasPendingWrites: false, fromCache: false },
  });

  it('BOOT-HYDRATION-9 — the live listener ignores a pending-write-only doc', async () => {
    authState.user = { uid: 'uid1' };
    const { result } = renderHook(() => useDocSnapshot(ZProfile, 'users/uid1'));
    await act(async () => {
      await Promise.resolve();
    });
    const onNext = onSnapshotMock.mock.calls[0]?.[1] as (s: unknown) => void;

    // Our own un-acked stamp. `displayName` is absent — the gate must NOT be
    // told the profile is loaded-and-empty.
    act(() => onNext(pendingSnap({ nativeLanguage: undefined })));
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    // The server's copy lands: now we know the profile.
    act(() => onNext(serverSnap({ displayName: 'Alice', nativeLanguage: 'English' })));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ displayName: 'Alice', nativeLanguage: 'English' });
  });

  it('BOOT-HYDRATION-9 — once resolved, pending writes DO apply (optimistic edits)', async () => {
    authState.user = { uid: 'uid1' };
    const { result } = renderHook(() => useDocSnapshot(ZProfile, 'users/uid1'));
    await act(async () => {
      await Promise.resolve();
    });
    const onNext = onSnapshotMock.mock.calls[0]?.[1] as (s: unknown) => void;

    act(() => onNext(serverSnap({ displayName: 'Alice' })));
    expect(result.current.data).toEqual({ displayName: 'Alice' });

    // The user renames themselves in Settings. That edit must show INSTANTLY,
    // not wait for the server ack — the guard is only about the window before
    // we have any real data at all.
    act(() => onNext(pendingSnap({ displayName: 'Alicia' })));
    expect(result.current.data).toEqual({ displayName: 'Alicia' });
  });

  it('BOOT-HYDRATION-9 — the eager cache read ignores a pending-write-only doc', async () => {
    // `getDocFromCache` reads the same local view, so it has the same phantom.
    docFromCache.mockResolvedValue(pendingSnap({ nativeLanguage: undefined }));
    const { result } = renderHook(() => useDocSnapshot(ZProfile, 'users/uid1'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
  });
});

/**
 * BOOT-HYDRATION-13 — a cache miss is not evidence that the doc is gone.
 *
 * Offline, with the doc absent from the SDK's local cache (a memory cache, an
 * evicted or recovery-cleared IndexedDB), the live listener reports
 * `exists() === false` with `fromCache: true`. That resolved as "deleted" and
 * wiped the profile the localStorage mirror had already painted, so an
 * offline cold boot dropped a fully-onboarded user onto the first-run legal
 * gate ("Before you start") and unmounted the chat they had open — the
 * MSG-ROBUST-2 outbox-restart E2E caught it.
 */
describe('BOOT-HYDRATION-13 — a fromCache non-existence never erases known data', () => {
  const missing = (fromCache: boolean, hasPendingWrites = false) => ({
    exists: () => false,
    id: 'uid1',
    data: () => undefined,
    metadata: { fromCache, hasPendingWrites },
  });

  async function listen(cacheKey?: string) {
    authState.user = { uid: 'uid1' };
    const hook = renderHook(() => useDocSnapshot(ZProfile, 'users/uid1', cacheKey));
    await act(async () => {
      await Promise.resolve();
    });
    const onNext = onSnapshotMock.mock.calls[0]?.[1] as (s: unknown) => void;
    return { ...hook, onNext };
  }

  it('BOOT-HYDRATION-13 — mirror-hydrated data survives an offline cache miss', async () => {
    cacheStore.set('user:uid1', [{ id: 'uid1', data: { displayName: 'Cached Alice' } }]);
    const { result, onNext } = await listen('user:uid1');
    act(() => onNext(missing(true)));
    expect(result.current).toEqual({ data: { displayName: 'Cached Alice' }, loading: false, error: null });
  });

  it('BOOT-HYDRATION-13 — the SERVER saying the doc is gone still clears it', async () => {
    cacheStore.set('user:uid1', [{ id: 'uid1', data: { displayName: 'Cached Alice' } }]);
    const { result, onNext } = await listen('user:uid1');
    act(() => onNext(missing(false)));
    expect(result.current).toEqual({ data: null, loading: false, error: null });
  });

  it('BOOT-HYDRATION-13 — our own local delete still clears it (pending write)', async () => {
    cacheStore.set('user:uid1', [{ id: 'uid1', data: { displayName: 'Cached Alice' } }]);
    const { result, onNext } = await listen('user:uid1');
    act(() => onNext(missing(true, true)));
    expect(result.current.data).toBeNull();
  });

  it('BOOT-HYDRATION-13 — with nothing known, a cache miss still resolves to null (unchanged)', async () => {
    const { result, onNext } = await listen();
    act(() => onNext(missing(true)));
    expect(result.current).toEqual({ data: null, loading: false, error: null });
  });
});

describe('OBS-COVER-5 — listener errors', () => {
  it('OBS-COVER-5 — a permission-denied listener error reaches Sentry labelled by collection, not path', async () => {
    logError.mockClear();
    authState.user = { uid: 'uid1' };
    renderHook(() => useDocSnapshot(ZProfile, 'users/uid-secret'));
    // Wait for the listener itself rather than one microtask: the unavailable
    // case failed once under the full parallel suite (2026-10-18) and passed
    // in isolation, and the microtask count is the only timing it depended on.
    await vi.waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    const onError = onSnapshotMock.mock.calls[0]?.[2] as (e: unknown) => void;
    const err = Object.assign(new Error('denied'), { code: 'permission-denied' });
    act(() => onError(err));
    expect(logError).toHaveBeenCalledWith(err, expect.objectContaining({ action: 'firestoreListen', collection: 'users' }));
    expect(JSON.stringify(logError.mock.calls[0]?.[1])).not.toContain('uid-secret');
  });

  it('OBS-COVER-5 — an unavailable listener error stays a breadcrumb', async () => {
    logError.mockClear();
    authState.user = { uid: 'uid1' };
    renderHook(() => useDocSnapshot(ZProfile, 'users/uid2'));
    // Wait for the listener itself rather than one microtask: the unavailable
    // case failed once under the full parallel suite (2026-10-18) and passed
    // in isolation, and the microtask count is the only timing it depended on.
    await vi.waitFor(() => expect(onSnapshotMock).toHaveBeenCalled());
    const onError = onSnapshotMock.mock.calls[0]?.[2] as (e: unknown) => void;
    act(() => onError(Object.assign(new Error('offline'), { code: 'unavailable' })));
    expect(logError).not.toHaveBeenCalled();
  });
});

describe('OBS-FIRESTORE-6 — never touches a terminated client', () => {
  it('OBS-FIRESTORE-6 — once shut down, neither the cache read nor the listener runs', () => {
    authState.user = { uid: 'uid1' };
    markFirestoreShutDown();
    renderHook(() => useDocSnapshot(ZProfile, 'users/uid1'));
    expect(docFromCache).not.toHaveBeenCalled();
    expect(onSnapshotMock).not.toHaveBeenCalled();
  });
});
