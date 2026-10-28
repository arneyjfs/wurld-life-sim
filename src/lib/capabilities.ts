import { Capacitor } from '@capacitor/core';
import { getRuntime, type Runtime } from './runtime';

/**
 * Capabilities are the ONLY allowed source of "what can this runtime do?"
 * answers. Components MUST NOT branch on getRuntime() directly; they call
 * these predicates.
 *
 * Each predicate returns a boolean derived from:
 *   1) getRuntime()             — coarse-grained runtime gate
 *   2) feature detection        — fine-grained browser/OS gate
 *   3) plugin/SDK availability  — for native, the plugin module is present
 *
 * If a capability can change at runtime (permission revoked, install prompt
 * fires, display-mode change), expose via useCapabilities() instead.
 */

function rt(): Runtime {
  return getRuntime();
}

function isNativeR(r: Runtime = rt()): boolean {
  return r === 'native-ios' || r === 'native-android';
}

function isPwaOrNativeR(r: Runtime = rt()): boolean {
  return isNativeR(r) || r === 'pwa-installed';
}

const hasNavigator = typeof navigator !== 'undefined';
const hasWindow = typeof window !== 'undefined';

// ---- predicates ----

export function canShare(): boolean {
  return isNativeR() || (hasNavigator && typeof navigator.share === 'function');
}

export function canUseHardwareBackButton(): boolean {
  // Only Android has a hardware/gesture back button to listen on. iOS uses
  // the navigation bar; web has the browser back button (handled by the
  // router). Predicate hides the runtime gate from useAndroidBackButton.
  return rt() === 'native-android';
}

export function canUseContacts(): boolean {
  // @capacitor-community/contacts on native. No production-ready web fallback.
  return isNativeR();
}

export function canUseNativeCamera(): boolean {
  // Capacitor Camera plugin. Web falls back to <input type=file>.
  return isNativeR();
}

export function canUseHaptics(): boolean {
  if (isNativeR()) return true;
  if (!hasNavigator || !('vibrate' in navigator)) return false;
  // Web Vibration API — Android Chrome only in practice. iOS Safari ignores it.
  return /Android/.test(navigator.userAgent);
}

/**
 * CHROME-LINK-2 (docs/specs/app-chrome.md) — open web pages in the in-app
 * browser (`@capacitor/browser`: SFSafariViewController on iOS, Chrome Custom
 * Tabs on Android) instead of handing them to the system browser. Both shells.
 */
export function canUseInAppBrowser(): boolean {
  return isNativeR();
}

/**
 * CHROME-KB-1/3 — hide the keyboard accessory bar and set the keyboard's
 * appearance. `@capacitor/keyboard` implements both on iOS only; Android's IME
 * follows the system, so this stays false there.
 */
export function canStyleNativeKeyboard(): boolean {
  return rt() === 'native-ios';
}

/**
 * CHROME-STATUSTAP-1 — the iOS shell dispatches `statusTap` on window when the
 * status bar is tapped. Android has no equivalent gesture.
 */
export function canUseStatusBarTap(): boolean {
  return rt() === 'native-ios';
}

export function prefersEnterToSend(): boolean {
  // Desktop-like = a fine pointer AND hover, i.e. a mouse + a physical
  // keyboard. There, Enter sends and Shift+Enter is a newline (the
  // chat-app convention). Touch devices (phones/tablets — coarse pointer,
  // no hover) get Enter = newline and send via the button (COMP-SEND-3).
  // Re-evaluated per call (matchMedia is live), so attaching/detaching a
  // keyboard is honoured without a reload.
  if (!hasWindow || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/**
 * NAV-STACK-6 — may a platform back pop past the app's first history entry?
 *
 * False only in the iOS home-screen app (`navigator.standalone`, an iOS-only
 * property): there, popping past the app lands on a blank Safari page, never
 * what the user meant. A browser tab can leave (people navigate away on the
 * web), the Android installed app can leave (back-at-home exits it — that IS
 * its convention), and a native build handles back itself.
 */
export function canLeaveAppViaHistory(): boolean {
  if (isNativeR()) return true;
  if (!hasWindow) return true;
  return (window.navigator as { standalone?: boolean }).standalone !== true;
}

/**
 * IMG-VIEWER-3 / VID-SAVE-1 — should the viewer's Save open the OS share sheet
 * (whose "Save Image" / "Save Video" lands in Photos / Gallery) instead of a
 * file download? A file download on a phone opens a browser viewer rather than
 * saving. True on native, and on a touch-primary web runtime (coarse pointer,
 * no hover — the inverse of `prefersEnterToSend`). Tablets are included on
 * purpose: they have the same Photos-vs-Files problem. Mouse/trackpad desktops
 * keep the anchor download. Re-evaluated per call (matchMedia is live).
 */
export function prefersShareSheetForSave(): boolean {
  if (isNativeR()) return true;
  if (!hasWindow || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

// localStorage flag set when we observe the `appinstalled` event, so we can
// remember "already installed" across reloads in browsers without
// getInstalledRelatedApps support (Safari, Firefox).
const APPINSTALLED_FLAG = 'wurld:pwa-installed';

function appInstalledFlagSet(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(APPINSTALLED_FLAG) === '1';
  } catch {
    return false;
  }
}

// Hint that the PWA is already installed on this device. We can't synchronously
// query getInstalledRelatedApps() (async), so the boot-time signal is the
// persisted appinstalled flag. useCapabilities refreshes once the async probe
// resolves.
function probablyInstalled(): boolean {
  return appInstalledFlagSet();
}

// Captured BeforeInstallPromptEvent. Chromium fires this in browser
// runtime when the PWA is installable; we buffer it so the install
// affordance can fire .prompt() on a real user gesture. iOS Safari /
// Firefox never fire it — for those we show an "Add to Home Screen"
// hint instead of a programmatic prompt.
//
// Use `getDeferredInstallPrompt()` to consume; once consumed (or once
// `appinstalled` fires) the buffer is cleared.
let deferredPrompt: Event | null = null;

if (hasWindow) {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });
}

export function getDeferredInstallPrompt(): Event | null {
  return deferredPrompt;
}

export function clearDeferredInstallPrompt(): void {
  deferredPrompt = null;
}

export function canInstallPWA(): boolean {
  if (isNativeR()) return false;
  if (rt() === 'pwa-installed') return false;
  if (probablyInstalled()) return false;
  // Show the install affordance in any browser runtime where the app
  // isn't already installed. The click handler decides whether to
  // fire the captured `beforeinstallprompt` event (Chromium) or show
  // an "Add to Home Screen" hint (iOS Safari / Firefox). The previous
  // `'BeforeInstallPromptEvent' in window` check was wrong — that
  // global isn't exposed on the window object, only the event type
  // string is, so the predicate was always false and the row never
  // surfaced.
  return rt() === 'browser';
}

export function canShowOpenInApp(): boolean {
  return rt() === 'browser' && probablyInstalled();
}

export function canShowBadge(): boolean {
  // NOTIF-12 — native sets the icon badge through @capawesome/capacitor-badge
  // (WKWebView / Android WebView have no navigator.setAppBadge).
  if (isNativeR()) return true;
  if (!isPwaOrNativeR()) return false;
  return hasNavigator && 'setAppBadge' in navigator;
}

/** NOTIF-12 — the badge goes through the native plugin, not the Badging API. */
export function usesNativeBadge(): boolean {
  return isNativeR();
}

/** Android notification channels (O+) and the local `WurldNotifications`
 *  plugin that owns them (NOTIF-13). iOS has no channel concept. */
export function canUseNotificationChannels(): boolean {
  return rt() === 'native-android';
}

/** NOTIF-14.3 — message notifications are drawn by the app's own native
 *  messaging service (Android), so its token is declared in
 *  `androidFcmTokens` and the on-screen chat is reported to it. */
export function canDrawNativeChatNotifications(): boolean {
  return rt() === 'native-android';
}

/** NOTIF-17.5 — the OS freezes the page a few seconds after it leaves the
 *  screen, so its realtime socket is dead after a long absence: the iOS shell
 *  and iOS / iPadOS web (an iPad's Safari reports a Mac with touch). */
export function suspendsInBackground(): boolean {
  if (rt() === 'native-ios') return true;
  if (isNativeR() || !hasNavigator) return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** NOTIF-13.3 — the app can open its own notification settings page (Android
 *  only: iOS has no public deep link to it, the web none at all). */
export function canOpenNotificationSettings(): boolean {
  return rt() === 'native-android';
}

export function canUseFileSystemAccess(): boolean {
  return !isNativeR() && hasWindow && 'showOpenFilePicker' in window;
}

export function canUseBackgroundSync(): boolean {
  return (
    !isNativeR() &&
    hasNavigator &&
    'serviceWorker' in navigator &&
    hasWindow &&
    'SyncManager' in window
  );
}

export function supportsWebShareTarget(): boolean {
  const r = rt();
  return r === 'pwa-installed' || r === 'browser';
}

export function canUseNotifications(): boolean {
  if (isNativeR()) return true;
  if (!hasWindow || !('Notification' in window)) return false;
  // iOS Safari < 16.4 in PWA can't, but rather than UA-sniffing OS version,
  // we attempt registration and gracefully handle the throw in setup.ts.
  return true;
}

export function canUseClipboard(): boolean {
  return isNativeR() || (hasNavigator && 'clipboard' in navigator);
}

/**
 * IMG-NATIVE-UPLOAD-1 (docs/specs/image-messages.md §6b) — binary uploads to
 * the GCS session URL go through the native HTTP stack (CapacitorHttp), not
 * the WebView. The iOS page origin is `capacitor://localhost`, for which GCS
 * returns no CORS headers, so a WebView PUT can never succeed there. Android
 * shares the path so both shells run one tested transport.
 */
export function canUseNativeHttpUpload(): boolean {
  // Capacitor directly, not getRuntime(): upload code also runs under node
  // (no `window`) in the unit suite, where the runtime probe would throw.
  return Capacitor.isNativePlatform();
}

/**
 * AUTH-ACCOUNT-2 — Sign in with Apple is offered on the web and in the iOS
 * shell (App Store guideline 4.8 requires it once Google is offered there).
 * Not in the Android shell: Apple there is a web OAuth detour through the
 * plugin, and nothing requires it.
 */
export function canUseAppleSignIn(): boolean {
  return rt() !== 'native-android';
}

/**
 * AUTH-ACCOUNT-10.3 — the Android shell's Google sign-in goes through Credential
 * Manager, which fails without current Play services or a Google account on the
 * phone; the plugin's legacy GoogleSignIn picker is the fallback. iOS has no
 * Credential Manager, so nothing to fall back from.
 */
export function canFallBackToLegacyGoogleSignIn(): boolean {
  return rt() === 'native-android';
}

/** True on a native Capacitor runtime (iOS/Android shell), false on web/PWA.
 *  Lets non-allowlisted modules (e.g. lib/clipboard) pick the native plugin
 *  vs a web strategy without importing Capacitor.isNativePlatform directly. */
export function isNativeRuntime(): boolean {
  return isNativeR();
}

/**
 * BILL-MANAGE-1 (docs/specs/billing.md) — where Plus is SOLD is chosen by where
 * the app is running, never by where the user's Plus came from. Exactly one of
 * these three is true in any runtime.
 *
 * - Apple IAP (StoreKit 2 via `@capgo/native-purchases`) in the iOS shell.
 * - Google Play Billing (same plugin) in the Android shell.
 * - Stripe Checkout everywhere else: browser tab AND installed PWA. A PWA is
 *   not a store app, so neither store's rules reach it.
 */
export function canUseAppleIap(): boolean {
  return rt() === 'native-ios';
}

export function canUsePlayBilling(): boolean {
  return rt() === 'native-android';
}

export function canUseWebCheckout(): boolean {
  return !isNativeR();
}

/**
 * NATIVE-STORE-1 (docs/specs/native-shell.md) / BILL-MANAGE-3.4 — may this
 * runtime show or open ANY web purchase or subscription-management page
 * (Stripe Checkout, the Customer Portal, a web pricing link)? False in both
 * store shells: App Store 3.1.1 / 3.1.3(b) and Play's payments policy forbid
 * steering a store-app user to buy or manage outside the store.
 *
 * Distinct from `canUseWebCheckout` (the runtime's purchase SURFACE): if a
 * sanctioned link-out is ever enabled (BILL-MANAGE-4), only this one changes.
 */
export function canLinkToWebPurchase(): boolean {
  return !isNativeR();
}

/**
 * BOOT-GATE-3 (docs/specs/cold-boot.md) — where a build below the version
 * floor gets its update. The shells update from their store; a browser tab and
 * an installed PWA update by activating the waiting service worker / reloading
 * (OBS-UPDATE-5), since a PWA is served by us, not a store.
 */
export type AppUpdateChannel = 'app-store' | 'play-store' | 'web-reload';

export function appUpdateChannel(): AppUpdateChannel {
  const r = rt();
  if (r === 'native-ios') return 'app-store';
  if (r === 'native-android') return 'play-store';
  return 'web-reload';
}

export function canUseWindowControlsOverlay(): boolean {
  return (
    rt() === 'pwa-installed' &&
    hasWindow &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: window-controls-overlay)').matches
  );
}

export function canPlayAudio(): boolean {
  return hasWindow && typeof Audio !== 'undefined';
}

export function canUseIdleDetection(): boolean {
  return !isNativeR() && hasWindow && 'IdleDetector' in window;
}

let transcodeProbe: Promise<boolean> | null = null;

/**
 * VID-ENC-3 — can this runtime transcode a picked video for sending (WebCodecs
 * `VideoEncoder` + the `videoCodecs()` pair encodable at 720p)? Memoised.
 * Never throws; false in jsdom/SSR. `videoTranscode` (and so mediabunny) is
 * reached ONLY through this dynamic import, keeping it out of the main bundle.
 */
export function canTranscodeVideo(): Promise<boolean> {
  if (!transcodeProbe) {
    transcodeProbe = (async () => {
      if (typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === 'undefined') {
        return false;
      }
      try {
        const { canEncodeForSend } = await import('@/lib/videoTranscode');
        return await canEncodeForSend();
      } catch {
        return false;
      }
    })();
  }
  return transcodeProbe;
}

// ---- aggregate ----

export interface Capabilities {
  share: boolean;
  contacts: boolean;
  nativeCamera: boolean;
  haptics: boolean;
  installPWA: boolean;
  openInApp: boolean;
  badge: boolean;
  fileSystemAccess: boolean;
  backgroundSync: boolean;
  webShareTarget: boolean;
  notifications: boolean;
  clipboard: boolean;
  windowControlsOverlay: boolean;
  audio: boolean;
  idleDetection: boolean;
}

export function getCapabilities(): Capabilities {
  return {
    share: canShare(),
    contacts: canUseContacts(),
    nativeCamera: canUseNativeCamera(),
    haptics: canUseHaptics(),
    installPWA: canInstallPWA(),
    openInApp: canShowOpenInApp(),
    badge: canShowBadge(),
    fileSystemAccess: canUseFileSystemAccess(),
    backgroundSync: canUseBackgroundSync(),
    webShareTarget: supportsWebShareTarget(),
    notifications: canUseNotifications(),
    clipboard: canUseClipboard(),
    windowControlsOverlay: canUseWindowControlsOverlay(),
    audio: canPlayAudio(),
    idleDetection: canUseIdleDetection(),
  };
}

export function markPwaInstalled(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(APPINSTALLED_FLAG, '1');
  } catch {
    // localStorage may be disabled / full; fall back to in-memory only.
  }
}

export async function probeRelatedInstalledApps(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; url?: string }>>;
  };
  if (typeof nav.getInstalledRelatedApps !== 'function') return false;
  try {
    const apps = await nav.getInstalledRelatedApps();
    if (apps.length > 0) {
      markPwaInstalled();
      return true;
    }
  } catch {
    // Privacy-restricted contexts can reject; treat as "unknown, not installed".
  }
  return false;
}

// Re-export for the two allowlisted consumers (notifications/setup.ts,
// notifications/routing.ts, useKeyboardState.ts) — anyone else must use the
// predicates above.
export { Capacitor };
