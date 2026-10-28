import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard, KeyboardStyle } from '@capacitor/keyboard';
import { App as CapApp } from '@capacitor/app';
import {
  Capacitor,
  SystemBars,
  SystemBarsStyle,
  type PluginListenerHandle,
} from '@capacitor/core';
import { canStyleNativeKeyboard } from './capabilities';

/**
 * Status-bar chrome controller. The native iOS / Android status bar sits
 * directly above the first paint of our React tree, so its background must
 * match whatever in-app element occupies the top safe-area row — otherwise
 * users see a colour seam (lighter chat-header grey vs darker system bar
 * was the original complaint in dark mode on iOS).
 *
 * Three surfaces are kept in sync:
 *   1. Native status bar background — Capacitor StatusBar.setBackgroundColor
 *      (iOS 17+ and Android < 15; no-op on Android 15+, where the system
 *      enforces edge-to-edge and ignores the colour). Capacitor's plugin
 *      handles iPhone notch / Dynamic Island automatically; the colour
 *      paints behind the system clock + icons.
 *   2. Native status bar icon style — StatusBar.setStyle(Light/Dark). The
 *      plugin's naming describes the BACKGROUND ("Dark" = dark bg → light
 *      icons), so we pass the resolved theme directly. Calling
 *      setBackgroundColor on iOS 17+ auto-updates the icon style when style
 *      is Default, but we set it explicitly for older iOS + Android.
 *   3. Web / PWA toolbar tint — `<meta name="theme-color">`. iOS Safari and
 *      Chromium read this for the address-bar / virtual-keyboard tint, and
 *      installed PWAs use it for the title bar. We mutate the existing
 *      <meta> in <head> so route + theme changes propagate.
 *
 * Colour values are resolved at runtime from the document's computed style
 * (e.g. `--color-bg-elevated`) so updates flow automatically when the user
 * toggles light/dark or the CSS tokens are tweaked — no duplicated hex.
 *
 * No-op outside of mutating <meta> when running in a non-DOM context (SSR);
 * the native StatusBar calls short-circuit on web/PWA via the Capacitor
 * isNativePlatform check.
 */

export type StatusBarStyle = 'light' | 'dark';

/** Read a CSS custom property from `<html>` computed style. */
export function resolveCssVar(varName: string): string | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return null;
  }
  const raw = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  return raw === '' ? null : raw;
}

/**
 * Normalise a CSS colour string (hex, rgb(), rgba()) into a #rrggbb hex
 * the Capacitor StatusBar plugin + <meta theme-color> both accept. Returns
 * null if the input can't be parsed — caller should bail rather than push
 * an invalid value to the plugin (Android throws on malformed hex).
 */
export function toHexColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim();
  // #rgb or #rrggbb already.
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
    if (v.length === 4) {
      // expand #rgb to #rrggbb
      const r = v[1];
      const g = v[2];
      const b = v[3];
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return v.toLowerCase();
  }
  // rgb(r, g, b) / rgba(r, g, b, a) — ignore alpha (status bar is opaque).
  const m = v.match(
    /^rgba?\(\s*(\d+)\s*[,\s]\s*(\d+)\s*[,\s]\s*(\d+)\s*(?:[,/]\s*[\d.]+\s*)?\)$/,
  );
  if (m && m[1] && m[2] && m[3]) {
    const r = Math.max(0, Math.min(255, parseInt(m[1], 10)));
    const g = Math.max(0, Math.min(255, parseInt(m[2], 10)));
    const b = Math.max(0, Math.min(255, parseInt(m[3], 10)));
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  return null;
}

/**
 * Update the `<meta name="theme-color">` content. Creates the tag if it's
 * missing (defensive — index.html ships with one, but a future template
 * change shouldn't break this). No-op on SSR.
 *
 * iOS PWA standalone caches the original `<meta name="theme-color">` value
 * at page-load time and ignores in-place `setAttribute` updates against the
 * SAME node (the status-bar tint stays stuck on the value present when the
 * PWA window was opened). Replacing the node — `remove()` + new element —
 * forces iOS to re-read theme-color on the next paint. Other browsers
 * (Chromium / Firefox) handle setAttribute fine; the replace is a no-op
 * cost for them.
 *
 * NOTE: in iOS PWA standalone, the dominant signal for the status-bar
 * appearance is `<meta name="apple-mobile-web-app-status-bar-style">`. With
 * `default` iOS draws its own opaque grey backdrop and IGNORES theme-color
 * entirely. We ship `black-translucent` (see index.html) so the WebView
 * paints under the system bar and the page background fills the status
 * zone — which also makes modal scrims fade smoothly under the bar. The
 * theme-color update here remains correct for in-Safari toolbar tint and
 * Chromium-based PWAs.
 */
export function setWebThemeColor(hex: string): void {
  if (typeof document === 'undefined') return;
  // Find ALL existing theme-color metas. index.html ships TWO — one
  // each for `prefers-color-scheme: light` and `dark` — and the
  // earlier "replace first match" implementation would only sweep
  // ONE of them, leaving the other (with a media query that may or
  // may not match) in the DOM. After a few cycles of open/close +
  // route changes, multiple theme-color metas would accumulate, and
  // Safari's selection rule (first applicable in document order) was
  // non-obviously winning the WRONG colour: e.g. after opening
  // ImageViewer from /chat/:id/info, the status bar zone stayed on
  // the chat-info page-bg instead of flipping to the viewer's black,
  // because the static `(light) #ffffff` meta from index.html was
  // still present and earlier in the DOM than our `#000000` append.
  //
  // Manage exactly ONE meta in JS by:
  //   1. Append the new no-media meta FIRST (must never have zero
  //      theme-color metas — Android Chrome PWA falls back to the
  //      manifest theme_color and flashes purple otherwise).
  //   2. Remove ALL OTHER theme-color metas — including the static
  //      light/dark pair from index.html, which only existed to give
  //      the initial paint a sensible tint before JS hydrated.
  const existing = document.head.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  // Short-circuit: if the only existing meta already matches AND
  // there are no stale siblings to clean up, leave the DOM alone.
  if (
    existing.length === 1 &&
    existing[0]!.getAttribute('content') === hex
  ) {
    return;
  }
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'theme-color');
  meta.setAttribute('content', hex);
  document.head.appendChild(meta);
  for (const el of existing) el.remove();
}

export type StatusBarChrome = {
  /** Background hex (#rrggbb) painted behind the system status bar. */
  bg: string;
  /** Resolved theme — drives the icon style. */
  style: StatusBarStyle;
};

/**
 * Apply the full status-bar chrome update. Safe to call from React effects:
 * native calls are awaited internally but the function returns void so
 * effects don't need to track the promise.
 */
export function applyStatusBarChrome(chrome: StatusBarChrome): void {
  setWebThemeColor(chrome.bg);
  if (!Capacitor.isNativePlatform()) return;
  // Fire-and-forget — the plugin queues calls and the next applyStatusBarChrome
  // supersedes any in-flight work.
  void StatusBar.setStyle({
    style: chrome.style === 'dark' ? Style.Dark : Style.Light,
  });
  // Android 15+ ignores backgroundColor (plugin no-ops). On iOS the plugin
  // requires the WebView NOT to overlay the status bar for backgroundColor
  // to take visual effect; our capacitor.config.ts leaves overlay at its
  // default (true on iOS) — but the plugin internally paints a backdrop
  // behind the system bar even with overlay=true on iOS 17+, so the
  // colour still shows. If a future iOS regression flips this, call
  // setStatusBarOverlay(false) at boot.
  void StatusBar.setBackgroundColor({ color: chrome.bg }).catch(() => {
    // Plugin throws on malformed colour or unsupported platform — swallow.
  });
  applySystemBarsStyle(chrome.style);
}

/**
 * CHROME-SYSBAR-1..3 (docs/specs/app-chrome.md §5g) — Android only. Capacitor
 * core's `SystemBars` plugin re-applies ITS remembered style to the status AND
 * navigation bars on every `onConfigurationChanged`, defaulting to the OS
 * theme; `@capacitor/status-bar` styles the status bar only and remembers
 * nothing. So the app's style has to be handed to `SystemBars` too, or the
 * nav-bar icons follow the OS theme and the status icons flip back on the next
 * rotation / theme flip. No `bar` option → both bars.
 */
let lastSystemBarsStyle: StatusBarStyle | null = null;

function isAndroidShell(): boolean {
  return Capacitor.getPlatform() === 'android';
}

function pushSystemBarsStyle(style: StatusBarStyle): void {
  void SystemBars.setStyle({
    style: style === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
  }).catch(() => {
    /* CHROME-SYSBAR-3 — swallowed (stale native build) */
  });
}

function applySystemBarsStyle(style: StatusBarStyle): void {
  if (!isAndroidShell()) return;
  lastSystemBarsStyle = style;
  pushSystemBarsStyle(style);
}

/**
 * CHROME-SYSBAR-2 — re-apply the last pushed style on App `resume`. Returns
 * the teardown. No-op (and a no-op teardown) outside the Android shell.
 */
export function installSystemBarsResumeReassert(): () => void {
  if (!isAndroidShell()) return () => {};
  // Same race guard as useAndroidBackButton: addListener is async, so a
  // cleanup that runs first must still remove the handle when it arrives.
  let aborted = false;
  let sub: PluginListenerHandle | null = null;
  void CapApp.addListener('resume', () => {
    if (lastSystemBarsStyle) pushSystemBarsStyle(lastSystemBarsStyle);
  })
    .then((h) => {
      if (aborted) {
        void h.remove();
        return;
      }
      sub = h;
    })
    .catch(() => {
      /* CHROME-SYSBAR-3 — swallowed */
    });
  return () => {
    aborted = true;
    void sub?.remove();
    sub = null;
  };
}

/** Test seam: forget the remembered system-bar style. */
export function __resetSystemBarsForTests(): void {
  lastSystemBarsStyle = null;
}

/**
 * CHROME-KB-1 (docs/specs/app-chrome.md §3b) — boot-time native keyboard
 * chrome: hide the iOS input-accessory bar (the prev / next / Done strip). No
 * native chat app shows it. iOS shell only (`canStyleNativeKeyboard`); the
 * Android plugin implements neither call.
 */
export function installNativeKeyboardChrome(): void {
  if (!canStyleNativeKeyboard()) return;
  void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {
    /* CHROME-KB-3 — swallowed */
  });
}

/**
 * CHROME-KB-2 — the keyboard's appearance follows the resolved APP theme (not
 * the OS one, and not the image viewer's forced-black status bar). Called from
 * `useStatusBarChrome` whenever the theme resolves or changes.
 */
export function applyKeyboardChrome(theme: StatusBarStyle): void {
  if (!canStyleNativeKeyboard()) return;
  void Keyboard.setStyle({
    style: theme === 'dark' ? KeyboardStyle.Dark : KeyboardStyle.Light,
  }).catch(() => {
    /* CHROME-KB-3 — swallowed */
  });
}
