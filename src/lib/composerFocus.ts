/**
 * Imperative composer-focus registry (COMP-REPLY-1).
 *
 * The chat composer (MessageInput) registers a focus function; message-row
 * gesture handlers (swipe-to-reply, the reply action-menu item) call
 * `focusComposer()` SYNCHRONOUSLY inside the user-gesture handler so the iOS
 * soft keyboard rises.
 *
 * Why a registry and not the reply-target effect: on iOS WKWebView the soft
 * keyboard only rises from a `focus()` issued synchronously inside the live
 * user-gesture activation window. The composer's reply-target `useEffect`
 * focuses inside a `requestAnimationFrame` (post-commit) — that runs AFTER the
 * gesture's activation closes, so it focuses the textarea but the iOS keyboard
 * stays down. A direct synchronous call from the gesture handler is the only
 * thing that raises it. The rAF effect remains as the same-target-re-stamp
 * guard + web/Android fallback.
 *
 * Singleton by design: exactly one composer is mounted per chat screen.
 * MessageInput registers on mount and clears on unmount / when review-locked
 * (so a disabled composer is never focused).
 */
export type ComposerFocusOptions = {
  /** COMP-EDIT-FOCUS — place the caret after the last character. */
  caretAtEnd?: boolean;
  /** COMP-KB-25.2 — restore this selection (start, end). */
  selection?: [number, number];
};

let focusFn: ((opts?: ComposerFocusOptions) => void) | null = null;
// Bumped each time the composer unregisters (unmount, chat change), so a
// COMP-KB-25 hold taken before can tell it belongs to a composer that is gone.
let generation = 0;

export function registerComposerFocus(fn: ((opts?: ComposerFocusOptions) => void) | null): void {
  if (fn === null) generation += 1;
  focusFn = fn;
}

export function composerGeneration(): number {
  return generation;
}

/** Focus the chat composer if one is registered + enabled. No-op otherwise. */
export function focusComposer(opts?: ComposerFocusOptions): void {
  focusFn?.(opts);
}

/**
 * The composer's registered focus: a synchronous `focus()` (so it stays inside
 * the caller's gesture) and, for COMP-EDIT-FOCUS, the caret moved after the
 * text the textarea holds right now — the caller commits the edit draft first.
 */
export function focusTextarea(el: HTMLTextAreaElement | null, opts?: ComposerFocusOptions): void {
  if (!el) return;
  el.focus();
  if (opts?.caretAtEnd) {
    const end = el.value.length;
    el.setSelectionRange(end, end);
  } else if (opts?.selection) {
    const max = el.value.length;
    el.setSelectionRange(Math.min(opts.selection[0], max), Math.min(opts.selection[1], max));
  }
}

/**
 * COMP-IMG-9 — is the user typing in the chat composer right now? The
 * attach button keeps composer focus on a tap (COMP-KB-23), so asking at the
 * tap tells the review whether to hand focus to its caption.
 */
let focusedFn: (() => boolean) | null = null;

export function registerComposerFocused(fn: (() => boolean) | null): void {
  focusedFn = fn;
}

export function isComposerFocused(): boolean {
  return focusedFn?.() ?? false;
}
