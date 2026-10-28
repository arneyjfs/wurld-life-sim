import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerComposerFocus, focusComposer, focusTextarea } from './composerFocus';

/**
 * Spec: docs/specs/composer.md COMP-REPLY-1 — the composer-focus registry that
 * lets a reply gesture (swipe / action-menu) focus the composer SYNCHRONOUSLY
 * inside the user gesture, so the iOS soft keyboard rises. (The keyboard-rise
 * itself is iOS-device-only; this pins the registry contract.)
 */
describe('composerFocus registry (COMP-REPLY-1)', () => {
  afterEach(() => registerComposerFocus(null));

  it('focusComposer() calls the registered focus fn', () => {
    const fn = vi.fn();
    registerComposerFocus(fn);
    focusComposer();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('focusComposer() is a no-op when nothing is registered', () => {
    registerComposerFocus(null);
    expect(() => focusComposer()).not.toThrow();
  });

  it('registering null clears focus (disabled / review-locked composer is never focused)', () => {
    const fn = vi.fn();
    registerComposerFocus(fn);
    registerComposerFocus(null); // composer became disabled, or unmounted
    focusComposer();
    expect(fn).not.toHaveBeenCalled();
  });

  it('a later registration replaces the earlier one (single composer)', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerComposerFocus(a);
    registerComposerFocus(b);
    focusComposer();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

/**
 * Spec: docs/specs/composer.md COMP-EDIT-FOCUS — choosing Edit focuses the
 * composer with the caret after the last character, synchronously.
 */
describe('composerFocus — caret at end (COMP-EDIT-FOCUS)', () => {
  afterEach(() => registerComposerFocus(null));

  it('COMP-EDIT-FOCUS — focusComposer forwards { caretAtEnd } to the registered fn', () => {
    const fn = vi.fn();
    registerComposerFocus(fn);
    focusComposer({ caretAtEnd: true });
    expect(fn).toHaveBeenCalledWith({ caretAtEnd: true });
  });

  // This file runs in the node project (no DOM): a minimal textarea stand-in
  // records the calls. The real-element behaviour is pinned in
  // MessageInput.test.tsx (jsdom) and edit-message.spec.ts (browsers).
  function fakeTextarea(value: string) {
    const calls: string[] = [];
    const el = {
      value,
      focus: vi.fn(() => calls.push('focus')),
      setSelectionRange: vi.fn((a: number, b: number) => calls.push(`select:${a}-${b}`)),
    };
    return { el: el as unknown as HTMLTextAreaElement, calls };
  }

  it('COMP-EDIT-FOCUS — focusTextarea focuses synchronously, then puts the caret after the last character', () => {
    const { el, calls } = fakeTextarea('Lets meet at the park');
    focusTextarea(el, { caretAtEnd: true });
    expect(calls).toEqual(['focus', 'select:21-21']);
  });

  it('COMP-REPLY-1 — focusTextarea without caretAtEnd leaves the selection alone', () => {
    const { el, calls } = fakeTextarea('abc');
    focusTextarea(el);
    expect(calls).toEqual(['focus']);
  });

  it('focusTextarea is a no-op for a missing element', () => {
    expect(() => focusTextarea(null, { caretAtEnd: true })).not.toThrow();
  });
});
