import { create } from 'zustand';

/**
 * Cross-message coordination of the single currently-open vocab popover.
 *
 * Each MessageItem maintains its own activeWord locally for layout
 * purposes (it drives a CSS grid-row transition inside the bubble), but
 * the chat as a whole should only ever show ONE open popover. Opening
 * a word in message A closes the open word in message B; long-pressing
 * any message to open the actions menu also closes whatever was open.
 *
 * The key is `${messageId}:${word}` so two messages that happen to use
 * the same word don't share state.
 */
type VocabState = {
  /** `${messageId}:${word}` of the currently-open popover, or null. */
  activeKey: string | null;
  /** Open the popover for `(messageId, word)`. Replaces any existing one. */
  open: (messageId: string, word: string) => void;
  /** Toggle — if `(messageId, word)` is the active one, close it; else open. */
  toggle: (messageId: string, word: string) => void;
  /** Close any open popover. Called by long-press handlers etc. */
  close: () => void;
};

export const useVocabStore = create<VocabState>((set, get) => ({
  activeKey: null,
  open: (messageId, word) => set({ activeKey: `${messageId}:${word}` }),
  toggle: (messageId, word) => {
    const next = `${messageId}:${word}`;
    set({ activeKey: get().activeKey === next ? null : next });
  },
  close: () => set({ activeKey: null }),
}));

/** Convenience selector: derive the locally-active word for a given
 *  message, or null if some other message owns the popover. */
export function useActiveWordFor(messageId: string): string | null {
  const activeKey = useVocabStore((s) => s.activeKey);
  if (!activeKey) return null;
  const prefix = `${messageId}:`;
  if (!activeKey.startsWith(prefix)) return null;
  return activeKey.slice(prefix.length);
}
