// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useFlippedBubbleStore, useIsFlipped } from './flippedBubbleStore';
import { renderHook } from '@testing-library/react';
import { act } from 'react';

/**
 * Spec: docs/specs/message-pipeline.md — MSG-VIEW-3.
 *
 * Multi-flip semantics — multiple bubbles may be flipped at once.
 * `toggle` adds/removes a single id; `close` clears the entire set.
 * MessageList calls `close()` on every chat (re-)entry.
 */

describe('MSG-VIEW-3 — useFlippedBubbleStore', () => {
  beforeEach(() => {
    useFlippedBubbleStore.setState({ activeIds: new Set<string>() });
  });

  it('MSG-VIEW-3 — starts with an empty active set', () => {
    expect(useFlippedBubbleStore.getState().activeIds.size).toBe(0);
  });

  it('MSG-VIEW-3 — toggle adds a single id to the set', () => {
    useFlippedBubbleStore.getState().toggle('msg-A');
    const ids = useFlippedBubbleStore.getState().activeIds;
    expect(ids.has('msg-A')).toBe(true);
    expect(ids.size).toBe(1);
  });

  it('MSG-VIEW-3 — toggle on the same id removes it (single-bubble open/close gesture)', () => {
    useFlippedBubbleStore.getState().toggle('msg-A');
    useFlippedBubbleStore.getState().toggle('msg-A');
    expect(useFlippedBubbleStore.getState().activeIds.size).toBe(0);
  });

  // Behaviour change vs the original (exclusive-flip) store. Multi-flip
  // is the whole point of the new store — keep this gate pinned.
  it('MSG-VIEW-3 — toggle on a different id PRESERVES the prior id (multi-flip)', () => {
    useFlippedBubbleStore.getState().toggle('msg-A');
    useFlippedBubbleStore.getState().toggle('msg-B');
    const ids = useFlippedBubbleStore.getState().activeIds;
    expect(ids.has('msg-A')).toBe(true);
    expect(ids.has('msg-B')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('MSG-VIEW-3 — three independent flips all coexist; toggling one off leaves the others alone', () => {
    useFlippedBubbleStore.getState().toggle('msg-A');
    useFlippedBubbleStore.getState().toggle('msg-B');
    useFlippedBubbleStore.getState().toggle('msg-C');
    useFlippedBubbleStore.getState().toggle('msg-B');
    const ids = useFlippedBubbleStore.getState().activeIds;
    expect(ids.has('msg-A')).toBe(true);
    expect(ids.has('msg-B')).toBe(false);
    expect(ids.has('msg-C')).toBe(true);
  });

  it('MSG-VIEW-3 — close clears every id regardless of what was set', () => {
    useFlippedBubbleStore.getState().toggle('msg-A');
    useFlippedBubbleStore.getState().toggle('msg-B');
    useFlippedBubbleStore.getState().close();
    expect(useFlippedBubbleStore.getState().activeIds.size).toBe(0);
  });

  it('MSG-VIEW-3 — close on already-empty state is idempotent + does NOT wake subscribers', () => {
    // The chat-mount reset effect fires `close()` unconditionally; on
    // a fresh store this should be a no-op (no new Set allocation,
    // no notification, no extra render).
    const prevRef = useFlippedBubbleStore.getState().activeIds;
    useFlippedBubbleStore.getState().close();
    expect(useFlippedBubbleStore.getState().activeIds).toBe(prevRef);
  });

  it('MSG-VIEW-3 — toggle replaces the Set reference so React selectors re-subscribe', () => {
    const prev = useFlippedBubbleStore.getState().activeIds;
    useFlippedBubbleStore.getState().toggle('msg-A');
    const next = useFlippedBubbleStore.getState().activeIds;
    expect(next).not.toBe(prev);
  });
});

describe('MSG-VIEW-3 — useIsFlipped selector', () => {
  beforeEach(() => {
    useFlippedBubbleStore.setState({ activeIds: new Set<string>() });
  });

  it('MSG-VIEW-3 — returns false when nothing is flipped', () => {
    const { result } = renderHook(() => useIsFlipped('msg-A'));
    expect(result.current).toBe(false);
  });

  it('MSG-VIEW-3 — returns true exactly for the messages in the active set', () => {
    act(() => {
      useFlippedBubbleStore.getState().toggle('msg-A');
      useFlippedBubbleStore.getState().toggle('msg-C');
    });
    const a = renderHook(() => useIsFlipped('msg-A')).result;
    const b = renderHook(() => useIsFlipped('msg-B')).result;
    const c = renderHook(() => useIsFlipped('msg-C')).result;
    expect(a.current).toBe(true);
    expect(b.current).toBe(false);
    expect(c.current).toBe(true);
  });

  it('MSG-VIEW-3 — re-renders when the relevant id flips state', () => {
    const { result, rerender } = renderHook(() => useIsFlipped('msg-A'));
    expect(result.current).toBe(false);
    act(() => {
      useFlippedBubbleStore.getState().toggle('msg-A');
    });
    rerender();
    expect(result.current).toBe(true);
    act(() => {
      useFlippedBubbleStore.getState().toggle('msg-A');
    });
    rerender();
    expect(result.current).toBe(false);
  });
});
