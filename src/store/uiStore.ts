import { create } from 'zustand';

type UIState = {
  /** Toast queue (consumed by a top-level Toaster). */
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  /** Clear every queued toast. Toaster wires this to route changes so
   *  a toast triggered on one screen doesn't outlive navigation to
   *  another (e.g. "Translations visible" hanging around after the
   *  user has already left the chat). */
  dismissAllToasts: () => void;

  /** Modal stack — outermost element renders on top. */
  modal: ModalDescriptor | null;
  openModal: (modal: ModalDescriptor) => void;
  closeModal: () => void;

  // (The MSG-VIEW-7 `viewSettings` mirror that lived here is gone —
  // BOOT-SHARE-5: bubbles read `ChatViewSettingsContext`, published by
  // ChatScreen in the same render as the header.)

  /**
   * Requested chat-scroll target. Any feature that wants to land the
   * user on a specific message in a chat sets this — the MessageList
   * inside that chat sees it on render, paginates older messages until
   * the row is in the loaded window, scrolls it into view, flashes the
   * bubble briefly, then clears the field.
   *
   * Lives in the store (not a component prop) because the requester
   * may be outside the chat's component tree — e.g. the image viewer
   * portal, the chat-info Media gallery, a push-notification deep
   * link. Survives navigation between screens.
   *
   * Set to `null` to cancel an in-flight request before it resolves.
   *
   * Optional `createdAtMs` — when the caller already knows the target
   * message's timestamp (chat-info Media gallery does, because it's
   * on every ChatMediaItem), passing it lets `useMessages` start
   * directly in anchored mode on chat mount. Without it, the chat
   * subscribes to the live tail first AND THEN re-subscribes to the
   * anchored query after a getDoc fetch — two round-trips. Skipping
   * it is harmless for nearby targets (e.g. reply-preview taps where
   * the original is usually in the current window already).
   */
  pendingScrollTarget: {
    chatId: string;
    messageId: string;
    createdAtMs?: number;
  } | null;
  setPendingScrollTarget: (
    target: {
      chatId: string;
      messageId: string;
      createdAtMs?: number;
    } | null,
  ) => void;
};

export type ToastKind = 'info' | 'success' | 'error';

export type ToastAction = {
  /** Localised label shown on the action button (e.g. "Undo"). */
  label: string;
  /** Invoked when the user taps the action. The toast auto-dismisses
   *  AFTER the handler runs so the caller can chain its own toast. */
  onClick: () => void;
};

export type Toast = {
  id: string;
  kind: ToastKind;
  message: string;
  /** Optional second line rendered smaller + muted below `message`
   *  (e.g. the swipe-to-peek hint on the translations-hidden toast,
   *  MSG-VIEW-7). */
  subtitle?: string;
  /** CARDS-LIST-9 / CARDS-ARCHIVE-4 reuse: inline action button (e.g.
   *  Undo on "Marked as learnt"). When set the toast renders the label
   *  to the right of the message and invokes `onClick` on tap. */
  action?: ToastAction;
};

export type ModalDescriptor =
  | { kind: 'explainWord'; chatId: string; messageId: string; word: string }
  | { kind: 'reactions'; chatId: string; messageId: string }
  | { kind: 'messageActions'; chatId: string; messageId: string };

let toastSeq = 0;

/** UI-TOAST-1: at most this many toasts exist at once. A push beyond the cap
 *  KICKS the oldest (newest-wins sliding window) — NOT queued behind. */
const MAX_TOASTS = 2;

export const useUIStore = create<UIState>((set) => ({
  toasts: [],
  pushToast: (toast) =>
    set((s) => ({
      // Append, then drop the oldest if we exceed the cap — the new toast
      // shows immediately and the first one is kicked (UI-TOAST-1).
      toasts: [...s.toasts, { ...toast, id: `t${++toastSeq}` }].slice(-MAX_TOASTS),
    })),
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  dismissAllToasts: () => set({ toasts: [] }),

  modal: null,
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: null }),

  pendingScrollTarget: null,
  setPendingScrollTarget: (target) => set({ pendingScrollTarget: target }),
}));
