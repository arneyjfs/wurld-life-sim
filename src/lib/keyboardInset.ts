import { Keyboard } from '@capacitor/keyboard';
import { installKeyboardController, isInputLike } from './keyboardController';
import { getRuntime, isNative } from './runtime';

/**
 * Dismiss the on-screen keyboard. On native we call the Capacitor RPC
 * because `.blur()` alone is unreliable on iOS — focus often bounces back
 * to the same input within the next frame, leaving the keyboard up. On
 * web/PWA `.blur()` on the active element is the only available lever.
 */
export function hideKeyboard(opts?: { blurOnly?: boolean }): void {
  // COMP-KB-6.3 — `blurOnly` (the drag dismissal): no native hide. UIKit's
  // endEditing cancels the pan the finger is still making, so the content
  // stops following it; unfocusing alone lowers the keyboard.
  if (isNative() && !opts?.blurOnly) {
    void Keyboard.hide().catch(() => {
      /* plugin throws if no input was focused — harmless */
    });
  }
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

/**
 * Boot-time keyboard wiring.
 *
 * Keyboard-height tracking itself lives in `keyboardController.ts` — COMP-KB-15
 * makes that the single writer of `--kb-h`, choosing the highest-precedence
 * source available (Capacitor events on native, `navigator.virtualKeyboard` on
 * Chromium, focus-gated `visualViewport` math elsewhere). This function only
 * does the things that are NOT height tracking:
 *
 *   - stamp `[data-platform]` on <html> for CSS branching;
 *   - install the controller;
 *   - install the iOS PWA scroll-into-view suppression (COMP-KB-10), which is
 *     a scroll-position fix, not a measurement.
 *
 * (Before COMP-KB-15 this function ALSO wrote `--kb-h` from the Capacitor
 * events while `useKeyboardState` independently wrote it from viewport math —
 * two writers, different values, last-one-wins. That is the conflict the
 * controller removes.)
 */
export function installKeyboardInset(): void {
  const runtime = getRuntime();
  const platform =
    runtime === 'native-ios' ? 'ios'
    : runtime === 'native-android' ? 'android'
    : 'web';
  document.documentElement.dataset.platform = platform;

  // COMP-KB-15 — the one writer of `--kb-h`.
  installKeyboardController();

  if (platform === 'web') {
    // ── iOS PWA "scroll input into view" suppression ───────────────
    // When Safari focuses an input near the bottom of the page it
    // scrolls the layout viewport up so the input clears the
    // keyboard. The composer is at the bottom of the flex chain via
    // .pb-keyboard padding, so it ALREADY rides above the keyboard
    // — we don't need (and don't want) iOS's scroll-up too. The
    // unwanted scroll creates a visible artifact: composer briefly
    // appears at the top of the screen during the keyboard
    // animation while the page is partially scrolled, before the
    // snap-back catches up.
    //
    // Mitigation: on input focusin, eagerly run window.scrollTo(0,0)
    // for ~300ms via rAF. This catches each frame's scroll attempt
    // before iOS can paint it. Once the keyboard fully opens and
    // iOS stops scrolling, the rAF loop exits.
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('scroll', () => {
        if (vv.offsetTop > 0) window.scrollTo(0, 0);
      });
      document.addEventListener('focusin', (e) => {
        if (!isInputLike(e.target)) return;
        // Suppress iOS's scroll-into-view for the duration of the
        // keyboard-open animation. rAF loop preempts each scroll
        // attempt before it can paint.
        const start = performance.now();
        const suppress = () => {
          if (window.scrollY !== 0) window.scrollTo(0, 0);
          if (vv.offsetTop !== 0) window.scrollTo(0, 0);
          if (performance.now() - start < 350) {
            requestAnimationFrame(suppress);
          }
        };
        requestAnimationFrame(suppress);
      });
    }
  }
  // Native height tracking is the controller's `native` source (COMP-KB-15) —
  // the Capacitor will/did show+hide listeners live there now, so there is
  // nothing platform-specific left to do here.
}
