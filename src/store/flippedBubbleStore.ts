import { create } from 'zustand';

/**
 * Spec: docs/specs/message-pipeline.md — MSG-VIEW-3.
 *
 * Per-bubble "flip" reveal state for `viewMode === 'hidden'`. When
 * the user taps (or RTL-swipes) a bubble in hidden mode, its id goes
 * into the active set; tapping the same bubble again removes it.
 *
 * Multiple bubbles may be flipped at once. Users want to peek at
 * several native rows in a row to compare translations across a
 * conversation thread; an exclusive-flip rule made them repeatedly
 * re-tap. Reset happens on chat (re-)entry — `MessageList` calls
 * `close()` from a `chatId` effect on every mount.
 *
 * Session-only — no persistence layer. Flips never survive a tab
 * reload or a hard navigation.
 */

type FlippedBubbleState = {
  /** Set of currently-flipped message ids. Empty set ⇒ nothing
   *  flipped. */
  activeIds: Set<string>;
  /** Toggle a single bubble's flip state. Adds to the set if absent,
   *  removes if present. Mutates by replacing the Set reference so
   *  shallow-equal selectors (`useIsFlipped`) re-subscribe correctly. */
  toggle: (messageId: string) => void;
  /** Clear every flip. Called by MessageList on chat (re-)entry so
   *  flips from a prior chat session don't leak in. */
  close: () => void;
};

export const useFlippedBubbleStore = create<FlippedBubbleState>((set, get) => ({
  activeIds: new Set<string>(),
  toggle: (messageId) => {
    const current = get().activeIds;
    const next = new Set(current);
    if (next.has(messageId)) {
      next.delete(messageId);
    } else {
      next.add(messageId);
    }
    set({ activeIds: next });
  },
  close: () => {
    // Skip the write if already empty so a no-op `close()` (e.g. from
    // a chat-mount effect on a fresh store) doesn't wake subscribers.
    if (get().activeIds.size === 0) return;
    set({ activeIds: new Set<string>() });
  },
}));

/** Convenience selector: is the bubble for `messageId` currently flipped? */
export function useIsFlipped(messageId: string): boolean {
  return useFlippedBubbleStore((s) => s.activeIds.has(messageId));
}
