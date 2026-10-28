/**
 * BOOT-CACHE-2 / BOOT-CACHE-3 — the shared in-memory cache layer
 * (docs/specs/cold-boot.md §1b).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  _clearSnapshotCacheForTest,
  derivedCache,
  notifyViewerChange,
  onViewerChange,
  readCollectionCache,
  readDocCache,
  readLiveCollection,
  retainLiveCollection,
  writeCollectionCache,
  writeCollectionCacheUnlessLive,
  writeDocCache,
} from './snapshotCache';

const ZThing = z.object({ id: z.string() });

afterEach(() => {
  _clearSnapshotCacheForTest();
});

describe('BOOT-CACHE-2 — derivedCache', () => {
  it('BOOT-CACHE-2 — the same name is the same store', () => {
    const a = derivedCache<string>('t-same', 10);
    a.set('k', 'v');
    expect(derivedCache<string>('t-same', 10).get('k')).toBe('v');
  });

  it('BOOT-CACHE-2 — LRU by write order: a rewrite refreshes, the oldest is evicted', () => {
    const c = derivedCache<number>('t-lru', 2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('a', 11); // refresh a
    c.set('c', 3); // evicts b
    expect(c.has('b')).toBe(false);
    expect(c.entries()).toEqual([
      ['a', 11],
      ['c', 3],
    ]);
  });
});

describe('BOOT-CACHE-3 — one viewer-transition signal', () => {
  it('BOOT-CACHE-3 — a cold boot (null -> uid) wipes nothing', () => {
    writeDocCache('users/u1', { id: 'u1' });
    writeCollectionCache(ZThing, 'u1', [{ id: 'x' }]);
    derivedCache<string>('t-cold', 10).set('u1|c', 'hi');
    notifyViewerChange('u1');
    expect(readDocCache('users/u1')).toEqual({ id: 'u1' });
    expect(readCollectionCache(ZThing, 'u1')).toEqual([{ id: 'x' }]);
    expect(derivedCache<string>('t-cold', 10).get('u1|c')).toBe('hi');
  });

  it('BOOT-CACHE-3 — leaving a signed-in user wipes doc, collection and derived caches', () => {
    notifyViewerChange('u1');
    writeDocCache('users/u1', { id: 'u1' });
    writeCollectionCache(ZThing, 'u1', [{ id: 'x' }]);
    derivedCache<string>('t-switch', 10).set('u1|c', 'hi');
    notifyViewerChange('u2');
    expect(readDocCache('users/u1')).toBeUndefined();
    expect(readCollectionCache(ZThing, 'u1')).toBeUndefined();
    expect(derivedCache<string>('t-switch', 10).size()).toBe(0);
  });

  it('BOOT-CACHE-3 — listeners hear (prev, next) once per real transition', () => {
    const seen: Array<[string | null, string | null]> = [];
    const off = onViewerChange((p, n) => seen.push([p, n]));
    notifyViewerChange('u1');
    notifyViewerChange('u1'); // no-op
    notifyViewerChange(null);
    off();
    notifyViewerChange('u2');
    expect(seen).toEqual([
      [null, 'u1'],
      ['u1', null],
    ]);
  });

  it('BOOT-CACHE-3 — no module outside the auth plumbing registers onAuthStateChanged', () => {
    const SRC = path.resolve(import.meta.dirname, '..');
    const allowed = new Set(['store/authStore.ts', 'lib/firebase.ts']);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== 'test') walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        const rel = path.relative(SRC, full);
        if (allowed.has(rel)) continue;
        if (/\bonAuthStateChanged\s*\(/.test(readFileSync(full, 'utf8'))) offenders.push(rel);
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

describe('BOOT-CACHE-3 — authStore drives it', () => {
  it('BOOT-CACHE-3 — authStore forwards every auth emission', async () => {
    vi.resetModules();
    const cbs: Array<(u: { uid: string; phoneNumber: string | null; providerData: unknown[] } | null) => void> = [];
    vi.doMock('firebase/auth', () => ({
      onIdTokenChanged: (_a: unknown, cb: (typeof cbs)[number]) => {
        cbs.push(cb);
        return () => {};
      },
    }));
    vi.doMock('@/lib/firebase', () => ({ auth: {} }));
    vi.doMock('../lib/firebase', () => ({ auth: {} }));
    const snap = await import('./snapshotCache');
    const seen: Array<[string | null, string | null]> = [];
    snap.onViewerChange((p, n) => seen.push([p, n]));
    await import('@/store/authStore');
    const u9 = { uid: 'u9', phoneNumber: '+447700900000', providerData: [{ providerId: 'password' }] };
    for (const cb of cbs) cb(u9);
    // A token refresh for the same account is not a viewer change.
    for (const cb of cbs) cb(u9);
    // Standalone: no phone step, so an account without a phone IS a viewer
    // (Wurld's AUTH-ACCOUNT-3 pending state is not used here).
    for (const cb of cbs) cb({ uid: 'nophone', phoneNumber: null, providerData: [] } as never);
    for (const cb of cbs) cb(null);
    expect(seen).toEqual([
      [null, 'u9'],
      ['u9', 'nophone'],
      ['nophone', null],
    ]);
    vi.doUnmock('firebase/auth');
    vi.doUnmock('@/lib/firebase');
    vi.doUnmock('../lib/firebase');
  });
});

describe('BOOT-CACHE-5 — live collections', () => {
  it('BOOT-CACHE-5 — readLiveCollection serves an entry only while retained', () => {
    writeCollectionCache(ZThing, 'chat:live', [{ id: 'm2' }, { id: 'm1' }]);
    expect(readLiveCollection(ZThing, 'chat:live')).toBeUndefined();
    const releaseA = retainLiveCollection(ZThing, 'chat:live');
    const releaseB = retainLiveCollection(ZThing, 'chat:live');
    expect(readLiveCollection(ZThing, 'chat:live')).toEqual([{ id: 'm2' }, { id: 'm1' }]);
    releaseA();
    releaseA(); // idempotent
    expect(readLiveCollection(ZThing, 'chat:live')).toBeDefined();
    releaseB();
    expect(readLiveCollection(ZThing, 'chat:live')).toBeUndefined();
  });
});

describe('BOOT-CACHE-6 — only the holding listener writes a live entry', () => {
  it('BOOT-CACHE-6 — a non-listener write is dropped while the entry is live', () => {
    writeCollectionCache(ZThing, 'k6', [{ id: 'new' }, { id: 'old' }]);
    const release = retainLiveCollection(ZThing, 'k6');
    expect(writeCollectionCacheUnlessLive(ZThing, 'k6', [{ id: 'old' }])).toBe(false);
    expect(readLiveCollection<{ id: string }>(ZThing, 'k6')?.map((r) => r.id)).toEqual(['new', 'old']);
    release();
  });

  it('BOOT-CACHE-6 — and lands when nothing holds the entry live', () => {
    writeCollectionCache(ZThing, 'k6b', [{ id: 'a' }]);
    expect(writeCollectionCacheUnlessLive(ZThing, 'k6b', [{ id: 'b' }])).toBe(true);
    expect(readCollectionCache<{ id: string }>(ZThing, 'k6b')?.map((r) => r.id)).toEqual(['b']);
  });
});
