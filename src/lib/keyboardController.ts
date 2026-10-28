import { Keyboard } from '@capacitor/keyboard';
import * as log from './log';
import { isNative } from './runtime';

/**
 * COMP-KB-15..19 — the single source of truth for "is the soft keyboard up,
 * and how tall is it". See docs/specs/composer.md §4.
 *
 * ONE module singleton owns the `--kb-h` CSS variable. `useKeyboardState()` is
 * a `useSyncExternalStore` subscriber over this module and writes nothing, so
 * mounting the hook in five places produces five subscribers and still exactly
 * one writer.
 *
 * Source precedence (COMP-KB-15) — the highest available wins outright, the
 * lower ones are never consulted:
 *
 *   1. native      — Capacitor `Keyboard` will/did show+hide events. The OS
 *                    hands us the height directly, ahead of its own animation.
 *   2. virtual-kb  — Chromium's `navigator.virtualKeyboard` `geometrychange`.
 *   3. viewport    — focus-gated `visualViewport` math. WebKit ships no API,
 *                    so iOS Safari / iOS PWA land here and carry all the
 *                    guards below.
 *   4. none        — a device with a physical keyboard and no virtual one
 *                    (COMP-KB-18): always 0, whatever the viewport does.
 *
 * The previous design ran the viewport heuristic on EVERY runtime, including
 * native — where `keyboardInset.ts` was simultaneously writing `--kb-h` from
 * the Capacitor events. Two writers of one variable with different values and
 * different timing is unowned behaviour; precedence removes the conflict by
 * construction instead of by tuning.
 */

export type KeyboardState = { visible: boolean; height: number };

export type KeyboardSource = 'native' | 'virtual-keyboard' | 'viewport' | 'none';

/** `visible` flips here, not at 0 — small offsets are scroll-bounce noise. */
const VISIBLE_THRESHOLD_PX = 100;
/** COMP-KB-9 — swallow the transient taller-then-shorter open sequence. */
const SETTLE_MS = 50;
/** COMP-KB-7 — a blur predicts the close this long before we trust it. Long
 *  enough to survive a programmatic blur→refocus (the post-send rAF is 16-32ms). */
const PREDICT_CLOSE_MS = 50;
/** COMP-KB-13 — re-measure after the open settles to catch a late accessory bar. */
const OPEN_CONFIRM_DELAYS_MS = [150, 350];
/** COMP-KB-12 — re-measure after a resume, a few times, so a still-restoring
 *  viewport settles. */
const RESUME_REMEASURE_MS = [120, 350];

let installed = false;
let source: KeyboardSource = 'none';
let state: KeyboardState = { visible: false, height: 0 };
let lastWritten: number | null = null;
const subscribers = new Set<() => void>();

/**
 * COMP-KB-20 — E2E keyboard simulation hook. Permanent, and only ever driven
 * by a Playwright spec.
 *
 * There is no soft keyboard in a headless browser, so the specs that assert
 * the composer rises (SCROLL-INV-6, COMP-IMG-4) simulate one by writing
 * `--kb-h` and reading the resulting padding. That was a valid simulation
 * until COMP-KB-15 made this module the SINGLE writer of that variable: now
 * any recompute — a `visualViewport` resize, a route change firing
 * `resetKeyboardState` (COMP-KB-19) — overwrites the spec's value with 0
 * mid-test. It presented as two webkit-mobile specs failing in the full gate
 * and passing in isolation, because a stray recompute needs a busy suite to
 * land in the window.
 *
 * A test that fights the owner of the state it is asserting is not a test of
 * anything. Pinning makes the simulation authoritative instead: while pinned,
 * every source is inert and `--kb-h` holds. The alternative — teaching each
 * spec to re-assert the value after every possible recompute — is the same
 * race with more code.
 */
let pinnedInset: number | null = null;

// ── viewport-source state ──────────────────────────────────────────────
/** The "no keyboard" viewport reference. Unlike the previous max-ever
 *  tracker this SHRINKS too — see COMP-KB-17. */
let baselineH = 0;
let lastCommittedInset = 0;
let settleTimer: number | null = null;
let confirmTimers: number[] = [];
let closeTimer: number | null = null;
/**
 * COMP-KB-17 guard. The baseline may only SHRINK once we're confident the
 * keyboard has finished sliding away — during the close animation the viewport
 * is still occluded, and re-baselining to that value would teach the controller
 * that the occluded height IS the no-keyboard height, after which the next open
 * computes an inset of 0 and the composer sits BEHIND the keyboard. Growth is
 * always allowed; only downward moves wait for this deadline.
 */
let baselineShrinkAllowedAt = 0;
const BASELINE_SHRINK_GUARD_MS = 400;

/** COMP-KB-16 — only these can raise a soft keyboard. */
export function isInputLike(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'image', 'range', 'color'].includes(
      type,
    );
  }
  return el.isContentEditable;
}

function hasFocusedInput(): boolean {
  if (typeof document === 'undefined') return false;
  return isInputLike(document.activeElement);
}

/**
 * COMP-KB-18 — a fine pointer + hover and zero touch points means a physical
 * keyboard and no virtual one, so viewport changes are window resizes, never
 * keyboard events. Touch laptops / Windows tablets DO have a soft keyboard but
 * they are Chromium, so they take the `virtual-keyboard` source and never
 * reach this gate.
 */
function hasNoSoftKeyboard(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const finePointer = window.matchMedia('(pointer: fine) and (hover: hover)').matches;
  const noTouch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) === 0;
  return finePointer && noTouch;
}

function notify(): void {
  for (const cb of subscribers) cb();
}

/**
 * The one place `--kb-h` is written. COMP-KB-16 is enforced HERE rather than at
 * each call site, so no source — not even an authoritative OS event — can leave
 * a keyboard inset applied while nothing is focused.
 */
function commit(rawInset: number): void {
  if (pinnedInset !== null) return; // COMP-KB-20 — a spec owns the value.
  const inset = hasFocusedInput() ? Math.max(0, rawInset) : 0;
  if (typeof document !== 'undefined' && lastWritten !== inset) {
    document.documentElement.style.setProperty('--kb-h', `${inset}px`);
    lastWritten = inset;
  }
  const visible = inset > VISIBLE_THRESHOLD_PX;
  if (state.visible === visible && Math.abs(state.height - inset) < 0.5) return;
  state = { visible, height: inset };
  notify();
}

function clearSettle(): void {
  if (settleTimer != null) window.clearTimeout(settleTimer);
  settleTimer = null;
}

function clearConfirmTimers(): void {
  confirmTimers.forEach((t) => window.clearTimeout(t));
  confirmTimers = [];
}

function clearCloseTimer(): void {
  if (closeTimer != null) window.clearTimeout(closeTimer);
  closeTimer = null;
}

/**
 * COMP-KB-19 — force the closed state. A keyboard never survives a route
 * change, a backgrounded document, a page-hide or a sign-out, so asserting 0
 * at those points is always correct and removes any need for the UI to recover
 * from a stale value later.
 */
export function resetKeyboardState(_reason?: string): void {
  if (pinnedInset !== null) return; // COMP-KB-20 — a spec owns the value.
  clearSettle();
  clearConfirmTimers();
  clearCloseTimer();
  lastCommittedInset = 0;
  // Written unconditionally (not gated on `lastWritten`): a reset is rare, and
  // the invariant "after a reset the variable IS 0px" must hold even if some
  // other code path wrote the variable behind our back.
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--kb-h', '0px');
    lastWritten = 0;
  }
  if (state.visible || state.height !== 0) {
    state = { visible: false, height: 0 };
    notify();
  }
}

// ── viewport source (precedence 3) ─────────────────────────────────────

function currentViewportH(): number {
  if (typeof window === 'undefined') return 0;
  return window.visualViewport?.height ?? window.innerHeight;
}

/**
 * COMP-KB-2 / COMP-KB-11 — three formulas, max, clamped to the baseline.
 * `vv.offsetTop` is deliberately absent from the max: iOS briefly sets it to
 * the page-scroll that lifted the focused input, which EXCEEDS the keyboard
 * height and is zeroed by the COMP-KB-10 snap-back on the next frame.
 */
function computeInset(): number {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return 0;
  const classic = Math.max(
    0,
    Math.min(window.innerHeight, baselineH) - vv.height - vv.offsetTop,
  );
  const fromBaseline = Math.max(0, baselineH - vv.height);
  const fromInnerHeight = Math.max(0, baselineH - window.innerHeight);
  return Math.min(Math.max(classic, fromBaseline, fromInnerHeight), baselineH);
}

function scheduleOpenConfirm(): void {
  clearConfirmTimers();
  for (const delay of OPEN_CONFIRM_DELAYS_MS) {
    confirmTimers.push(
      window.setTimeout(() => {
        // COMP-KB-13 — upward only. The COMP-KB-9 QuickType overshoot is
        // transient-larger-then-smaller and has already collapsed by +150ms,
        // so an upward-only correction captures a late accessory bar without
        // re-introducing the overshoot.
        const inset = computeInset();
        if (inset > lastCommittedInset + 1) {
          lastCommittedInset = inset;
          commit(inset);
        }
      }, delay),
    );
  }
}

function measureViewport(): void {
  // COMP-KB-16 + COMP-KB-17. With nothing focused a keyboard is impossible, so
  // whatever the viewport currently is IS the no-keyboard reference. This one
  // branch is what makes a desktop window resize, a re-shown mobile URL bar, an
  // iPad split-view change and a resume-after-dismiss all no-ops instead of
  // phantom keyboards — and it is why the baseline can never get stuck high.
  if (!hasFocusedInput()) {
    // Re-baseline from a known-good no-keyboard observation… but only DOWNWARD
    // once the close animation can't still be occluding the viewport (see
    // BASELINE_SHRINK_GUARD_MS). Committing 0 is unconditional — that part is
    // the safety property and never waits.
    const cur = currentViewportH();
    baselineH =
      Date.now() >= baselineShrinkAllowedAt ? cur : Math.max(baselineH, cur);
    clearSettle();
    clearConfirmTimers();
    lastCommittedInset = 0;
    commit(0);
    return;
  }

  // The viewport can legitimately grow while typing (rotation, a collapsing
  // URL bar); track that upward so the inset doesn't go negative.
  const cur = currentViewportH();
  if (cur > baselineH) baselineH = cur;

  const inset = computeInset();
  if (inset <= lastCommittedInset) {
    // Decreasing or steady — commit immediately so the composer's lowering
    // stays in lockstep with the keyboard slide (COMP-KB-7's partner).
    clearSettle();
    clearConfirmTimers();
    lastCommittedInset = inset;
    commit(inset);
    return;
  }
  // COMP-KB-9 — increasing: settle-debounce so an intermediate (inflated)
  // value is never written as a transition target.
  clearSettle();
  settleTimer = window.setTimeout(() => {
    settleTimer = null;
    const settled = computeInset();
    lastCommittedInset = settled;
    commit(settled);
    if (settled > VISIBLE_THRESHOLD_PX) scheduleOpenConfirm();
  }, SETTLE_MS);
}

function installViewportSource(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  baselineH = currentViewportH();

  vv.addEventListener('resize', measureViewport);
  vv.addEventListener('scroll', measureViewport);
  // Android-Chrome fallback: some builds shrink `window.innerHeight` without
  // firing a visualViewport resize.
  window.addEventListener('resize', measureViewport);
  window.addEventListener('orientationchange', () => {
    // A rotation legitimately changes the no-keyboard viewport. Re-derive after
    // a beat so the resize lands first with the new dimensions.
    baselineH = 0;
    window.setTimeout(() => {
      baselineH = Math.max(baselineH, currentViewportH());
      measureViewport();
    }, 50);
  });

  measureViewport();
}

/**
 * COMP-KB-7 (predict-close) + COMP-KB-16 (focus backstop).
 *
 * Installed for EVERY source, not just the viewport one. On the viewport source
 * it's the fast path that beats iOS PWA's staggered close resizes. On the
 * native and virtual-keyboard sources it's the backstop for a MISSED hide
 * event — `keyboardWillHide`/`keyboardDidHide` are documented as unreliable on
 * some Android + Capacitor builds (capacitor-keyboard #186, #318), and before
 * COMP-KB-15 the duplicate viewport writer happened to cover that gap. Losing
 * focus without regaining it is proof the keyboard is closing, on every source.
 */
function installFocusBackstop(): void {
  document.addEventListener(
    'focusout',
    (e) => {
      if (!isInputLike(e.target)) return;
      // The viewport stays occluded through the close slide — hold off any
      // downward re-baseline until it has finished (COMP-KB-17 / B2).
      baselineShrinkAllowedAt = Date.now() + BASELINE_SHRINK_GUARD_MS;
      clearCloseTimer();
      closeTimer = window.setTimeout(() => {
        closeTimer = null;
        // Focus bounced to another input — the user is moving between fields.
        if (hasFocusedInput()) return;
        clearSettle();
        clearConfirmTimers();
        lastCommittedInset = 0;
        commit(0);
      }, PREDICT_CLOSE_MS);
    },
    true,
  );
  document.addEventListener(
    'focusin',
    (e) => {
      if (isInputLike(e.target)) clearCloseTimer();
    },
    true,
  );
}

// ── virtual-keyboard source (precedence 2) ─────────────────────────────

type VirtualKeyboard = EventTarget & {
  overlaysContent: boolean;
  boundingRect: DOMRectReadOnly;
};

function getVirtualKeyboard(): VirtualKeyboard | null {
  if (typeof navigator === 'undefined') return null;
  const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboard }).virtualKeyboard;
  return vk && typeof vk.addEventListener === 'function' ? vk : null;
}

function installVirtualKeyboardSource(vk: VirtualKeyboard): void {
  vk.overlaysContent = true;
  vk.addEventListener('geometrychange', () => {
    commit(vk.boundingRect?.height ?? 0);
  });
  commit(vk.boundingRect?.height ?? 0);
}

// ── native source (precedence 1) ───────────────────────────────────────

type ImeReport = { visible: boolean; height: number };

/**
 * COMP-KB-26.4 breadcrumb. `log` is a static import: it is in the boot chunk
 * anyway (main.tsx), and a lazy import of a statically imported module is
 * refused by BOOT-SPLIT-4.
 */
function reportReconcile(from: number, to: number, cause: 'report' | 'focus' | 'resume'): void {
  log.info('kb-reconcile', { from, to, cause });
}

/**
 * COMP-KB-26 — the Android shell's keyboard report. `MainActivity` writes it on
 * every window-inset change, animated or not; the iOS shell never does, so this
 * is null there and every COMP-KB-26 path is inert.
 */
function lastImeReport(): ImeReport | null {
  const r = (window as unknown as { __wurldIme?: ImeReport }).__wurldIme;
  return r && typeof r.height === 'number' ? r : null;
}

/** COMP-KB-26.2/26.3 — commit the last report, logging when it corrects us. */
function reapplyImeReport(cause: 'focus' | 'resume'): void {
  const r = lastImeReport();
  if (!r?.visible || !hasFocusedInput()) return;
  const from = state.height;
  commit(r.height);
  if (Math.abs(state.height - from) >= 1) reportReconcile(from, state.height, cause);
}

function installNativeSource(): void {
  void Keyboard.addListener('keyboardWillShow', (e) => commit(e.keyboardHeight));
  void Keyboard.addListener('keyboardWillHide', () => commit(0));
  // COMP-KB-1 — `will*` is unreliable on some Android + Capacitor builds
  // (capacitor-keyboard #186, #318). The `did*` variants always fire, so they
  // recover a missed rise; when `will` did fire they are a no-op re-write.
  void Keyboard.addListener('keyboardDidShow', (e) => commit(e.keyboardHeight));
  void Keyboard.addListener('keyboardDidHide', () => commit(0));

  // COMP-KB-26.1 — the plugin only reports ANIMATED keyboard changes on
  // Android, so a height change (emoji panel, clipboard row, another keyboard)
  // or a keyboard restored without an animation never reached us. The shell's
  // report covers every inset change.
  window.addEventListener('wurld:ime', (e) => {
    const r = (e as CustomEvent<ImeReport>).detail;
    if (!r || typeof r.height !== 'number') return;
    const from = state.height;
    commit(r.visible ? r.height : 0);
    // COMP-KB-26.4 — only a change to an inset that was already up is
    // something the plugin events miss; an open or close races them by a frame.
    if (from > VISIBLE_THRESHOLD_PX && state.height > VISIBLE_THRESHOLD_PX && Math.abs(state.height - from) >= 1) {
      reportReconcile(from, state.height, 'report');
    }
  });
  // COMP-KB-26.2 — a refocus after COMP-KB-7's predict-close, with a keyboard
  // that never left, changes no inset and so sends no report.
  document.addEventListener(
    'focusin',
    (e) => {
      if (isInputLike(e.target)) reapplyImeReport('focus');
    },
    true,
  );
}

// ── install ────────────────────────────────────────────────────────────

/** Idempotent. Safe to call from boot AND lazily from the first subscriber. */
export function installKeyboardController(): void {
  if (installed) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;

  const vk = getVirtualKeyboard();
  if (isNative()) {
    source = 'native';
    installNativeSource();
  } else if (vk) {
    source = 'virtual-keyboard';
    installVirtualKeyboardSource(vk);
  } else if (hasNoSoftKeyboard()) {
    source = 'none';
  } else {
    source = 'viewport';
    installViewportSource();
  }
  // COMP-KB-16 — every source gets the focus backstop, including native.
  installFocusBackstop();

  // COMP-KB-20 — the E2E keyboard-simulation hook. Attached unconditionally
  // for the same reason `useFlipHeight`'s `window.__measure` is: a hook that
  // only exists under a build flag is a hook the gate can silently lose.
  // Inert until a spec calls it.
  (window as unknown as { __kb?: (px: number | null) => void }).__kb =
    pinKeyboardInsetForTest;

  // COMP-KB-19 — reset points shared by every source.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      resetKeyboardState('document-hidden');
      return;
    }
    // COMP-KB-12 — on resume the OS may have dismissed the keyboard while the
    // WebView was frozen, with no event delivered. Re-measure a few times so a
    // still-restoring viewport settles.
    if (source !== 'viewport') {
      if (!hasFocusedInput()) resetKeyboardState('resume-no-focus');
      // COMP-KB-26.3 — Android can restore the keyboard without animating it,
      // so no plugin event undoes the hard reset above.
      else if (source === 'native') reapplyImeReport('resume');
      return;
    }
    clearSettle();
    clearConfirmTimers();
    measureViewport();
    for (const delay of RESUME_REMEASURE_MS) window.setTimeout(measureViewport, delay);
  });
  window.addEventListener('pagehide', () => resetKeyboardState('pagehide'));

  // Guarantee the variable exists from boot even for the `none` source, so no
  // consumer ever reads an empty `var(--kb-h)`.
  if (lastWritten === null) commit(0);
}

/**
 * COMP-KB-19 — re-assert the truth without asserting a lie.
 *
 * Used for transitions where the keyboard is USUALLY gone but might legitimately
 * still be up (a route change). Nothing focused → collapse to closed. Something
 * focused → RE-MEASURE rather than leave the previous screen's value in place.
 *
 * The re-measure matters because React runs child effects before parent ones:
 * a destination screen that autofocuses an input on mount has already taken
 * focus by the time this runs, so a bare "reset if unfocused" check would be a
 * no-op and carry the previous screen's inset straight through. Re-measuring
 * collapses it to the truth (the new keyboard hasn't opened yet) and lets the
 * normal open path raise it again.
 */
export function refreshKeyboardState(reason?: string): void {
  if (!hasFocusedInput()) {
    resetKeyboardState(reason);
    return;
  }
  if (source === 'viewport') measureViewport();
}

/** Subscribe to keyboard-state changes. Installs the controller on first use. */
export function subscribeKeyboard(cb: () => void): () => void {
  installKeyboardController();
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** Identity-stable snapshot for `useSyncExternalStore`. */
export function getKeyboardSnapshot(): KeyboardState {
  return state;
}

/** SSR / non-DOM snapshot — always closed. */
export function getKeyboardServerSnapshot(): KeyboardState {
  return CLOSED;
}

const CLOSED: KeyboardState = { visible: false, height: 0 };

/** Which source won precedence. Exposed for diagnostics + tests. */
export function getKeyboardSource(): KeyboardSource {
  return source;
}

/**
 * COMP-KB-20 — pin `--kb-h` for an E2E keyboard simulation, or release it.
 *
 * Exposed on `window.__kb` (see `installKeyboardController`) because the specs
 * reach it through `page.evaluate`, and imported directly by unit tests.
 * Pass a number to pin, `null` to release and re-derive from the real sources.
 */
export function pinKeyboardInsetForTest(px: number | null): void {
  pinnedInset = px;
  if (typeof document === 'undefined') return;
  if (px === null) {
    // Release: drop back to the truth the controller can actually see. With no
    // real keyboard in a headless browser that is 0, which is also what every
    // spec's own teardown asks for.
    lastWritten = null;
    commit(0);
    return;
  }
  const inset = Math.max(0, px);
  document.documentElement.style.setProperty('--kb-h', `${inset}px`);
  lastWritten = inset;
  state = { visible: inset > VISIBLE_THRESHOLD_PX, height: inset };
  notify();
}
