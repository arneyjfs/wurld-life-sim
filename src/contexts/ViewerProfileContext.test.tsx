/**
 * BOOT-SHARE-3 — one `users/{me}` listener per open chat, whatever the number
 * of consumers under it.
 *
 * Spec: docs/specs/cold-boot.md § 2b.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = {
  path: string;
  next: (snap: unknown) => void;
  active: boolean;
};
const listeners = vi.hoisted(() => [] as Listener[]);

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
    getDocFromCache: () => Promise.reject(new Error('miss')),
    onSnapshot: (ref: { path: string }, next: (snap: unknown) => void) => {
      const l: Listener = { path: ref.path, next, active: true };
      listeners.push(l);
      return () => {
        l.active = false;
      };
    },
  };
});
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/lib/log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { uid: string } | null }) => unknown) =>
    sel({ user: { uid: 'me' } }),
}));

import { ViewerProfileProvider } from './ViewerProfileContext';
import { useUserProfile } from '@/hooks/useUserProfile';
import { _clearSnapshotCacheForTest } from '@/lib/snapshotCache';

function activeFor(path: string) {
  return listeners.filter((l) => l.active && l.path === path);
}

beforeEach(() => {
  listeners.length = 0;
  _clearSnapshotCacheForTest();
});
afterEach(() => {
  localStorage.clear();
});

describe('BOOT-SHARE-3 — ViewerProfileProvider shares one users/{me} listener', () => {
  it('BOOT-SHARE-3 — 30 useUserProfile(me) consumers under the provider open ONE listener', () => {
    function Consumer() {
      useUserProfile('me');
      return null;
    }
    render(
      <ViewerProfileProvider uid="me">
        {Array.from({ length: 30 }, (_, i) => (
          <Consumer key={i} />
        ))}
      </ViewerProfileProvider>,
    );
    expect(activeFor('users/me')).toHaveLength(1);
  });

  it('BOOT-SHARE-3 — consumers see the provider\'s data', () => {
    const names: Array<string | undefined> = [];
    function Consumer() {
      names.push(useUserProfile('me').data?.displayName);
      return null;
    }
    render(
      <ViewerProfileProvider uid="me">
        <Consumer />
      </ViewerProfileProvider>,
    );
    act(() => {
      for (const l of activeFor('users/me')) {
        l.next({
          id: 'me',
          exists: () => true,
          data: () => ({ displayName: 'Me' }),
          metadata: { hasPendingWrites: false, fromCache: false },
        });
      }
    });
    expect(names.at(-1)).toBe('Me');
  });

  it('BOOT-SHARE-3 — another user\'s profile keeps its own subscription', () => {
    function Consumer() {
      useUserProfile('someone-else');
      return null;
    }
    render(
      <ViewerProfileProvider uid="me">
        <Consumer />
      </ViewerProfileProvider>,
    );
    expect(activeFor('users/someone-else')).toHaveLength(1);
  });

  it('BOOT-SHARE-3 — outside the provider useUserProfile subscribes itself', () => {
    function Consumer() {
      useUserProfile('me');
      return null;
    }
    render(
      <>
        <Consumer />
        <Consumer />
      </>,
    );
    expect(activeFor('users/me')).toHaveLength(2);
  });
});
