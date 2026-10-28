import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp } from 'firebase/app';
import { collection, collectionGroup, doc, getFirestore, limit, orderBy, query, where } from 'firebase/firestore';

/**
 * OBS-COVER-5 — listener errors: non-transient codes reach Sentry once per
 * (query, code), labelled with collection names only.
 * Spec: docs/specs/observability.md.
 */
const logMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('./log', () => logMock);

import {
  _resetListenerReportsForTests,
  collectionLabelOfPath,
  queryLabel,
  reportListenerError,
} from './firestoreListenerReport';

const db = getFirestore(initializeApp({ projectId: 'p', apiKey: 'k', appId: 'a' }, 'obs-cover-5'));
const fsErr = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  logMock.error.mockReset();
  logMock.warn.mockReset();
  _resetListenerReportsForTests();
});

describe('OBS-COVER-5 — labels carry collection names, never ids', () => {
  it('OBS-COVER-5 — a doc path keeps only the collection segments', () => {
    expect(collectionLabelOfPath('chats/abc123/messages/m9')).toBe('chats/messages');
    expect(collectionLabelOfPath('users/uid-1')).toBe('users');
  });

  it('OBS-COVER-5 — a real derived query is labelled from the SDK', () => {
    const q = query(collection(db, 'chats', 'chat-42', 'messages'), where('hasImage', '==', true), orderBy('createdAt'), limit(5));
    expect(queryLabel(q)).toBe('chats/messages');
    expect(queryLabel(q)).not.toContain('chat-42');
    expect(queryLabel(collection(db, 'users', 'u1', 'flashcards'))).toBe('users/flashcards');
    expect(queryLabel(collectionGroup(db, 'messages'))).toContain('messages');
    expect(queryLabel(doc(db, 'users', 'u1'))).toBe('users');
    expect(queryLabel(null)).toBe('unknown');
  });
});

describe('OBS-COVER-5 — reportListenerError', () => {
  it('OBS-COVER-5 — permission-denied is reported with action + collection label', () => {
    const err = fsErr('permission-denied');
    reportListenerError(err, { label: 'chats/messages', hook: 'useCollectionSnapshot' });
    expect(logMock.error).toHaveBeenCalledWith(err, expect.objectContaining({
      action: 'firestoreListen',
      collection: 'chats/messages',
      firestoreCode: 'permission-denied',
    }));
  });

  it.each(['unavailable', 'cancelled', 'deadline-exceeded'])('OBS-COVER-5 — transient %s stays a breadcrumb', (code) => {
    reportListenerError(fsErr(code), { label: 'chats', hook: 'useDocSnapshot' });
    expect(logMock.error).not.toHaveBeenCalled();
    expect(logMock.warn).toHaveBeenCalled();
  });

  it('OBS-COVER-5 — the re-attach loop does not report the same failure every 10s', () => {
    for (let i = 0; i < 5; i++) {
      reportListenerError(fsErr('failed-precondition'), { label: 'chats/messages', hook: 'useCollectionSnapshot' });
    }
    expect(logMock.error).toHaveBeenCalledTimes(1);
  });
});
