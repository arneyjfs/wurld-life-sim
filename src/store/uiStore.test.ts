/**
 * uiStore tests — covers the parts of the store that other features
 * depend on. The toasts + modal + viewMode paths are exercised through
 * their component callers; this file pins the surfaces that don't
 * have a natural component-level test fixture.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from './uiStore';

beforeEach(() => {
  // Reset every field touched by these tests to its initial value so
  // the store doesn't leak between cases (zustand stores are module
  // singletons under vitest).
  useUIStore.setState({ pendingScrollTarget: null, toasts: [] });
});

describe('uiStore — toasts cap (UI-TOAST-1/2: drop-oldest, newest-wins)', () => {
  it('caps at 2; a 3rd+ push KICKS the oldest (keeps the 2 most-recent)', () => {
    const { pushToast } = useUIStore.getState();
    for (let i = 1; i <= 5; i++) pushToast({ kind: 'info', message: `t${i}` });
    // Only the two newest survive; t1..t3 were kicked, not queued.
    expect(useUIStore.getState().toasts.map((t) => t.message)).toEqual(['t4', 't5']);
  });

  it('dismissToast removes by id', () => {
    const { pushToast, dismissToast } = useUIStore.getState();
    pushToast({ kind: 'info', message: 't1' });
    pushToast({ kind: 'info', message: 't2' });
    const headId = useUIStore.getState().toasts[0]!.id;
    dismissToast(headId);
    expect(useUIStore.getState().toasts.map((t) => t.message)).toEqual(['t2']);
  });
});

describe('uiStore — pendingScrollTarget', () => {
  it('starts null', () => {
    expect(useUIStore.getState().pendingScrollTarget).toBeNull();
  });

  it('setPendingScrollTarget writes the value', () => {
    useUIStore.getState().setPendingScrollTarget({
      chatId: 'chat-1',
      messageId: 'msg-42',
    });
    expect(useUIStore.getState().pendingScrollTarget).toEqual({
      chatId: 'chat-1',
      messageId: 'msg-42',
    });
  });

  it('setPendingScrollTarget(null) clears the field', () => {
    useUIStore.getState().setPendingScrollTarget({
      chatId: 'c', messageId: 'm',
    });
    useUIStore.getState().setPendingScrollTarget(null);
    expect(useUIStore.getState().pendingScrollTarget).toBeNull();
  });

  it('later writes replace earlier writes (single-target semantics)', () => {
    // The store holds AT MOST one pending target. A new request from
    // any caller overwrites a previous unresolved one — typical
    // scenario: user taps a reply preview, then taps another reply
    // preview before MessageList has finished delivering the first.
    useUIStore.getState().setPendingScrollTarget({
      chatId: 'c', messageId: 'first',
    });
    useUIStore.getState().setPendingScrollTarget({
      chatId: 'c', messageId: 'second',
    });
    expect(useUIStore.getState().pendingScrollTarget?.messageId).toBe('second');
  });
});
