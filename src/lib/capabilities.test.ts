// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canInstallPWA,
  canPlayAudio,
  canUseClipboard,
  canUseContacts,
  canUseHaptics,
  canUseNativeCamera,
  canUseNotifications,
  canLeaveAppViaHistory,
  canShare,
  getCapabilities,
  prefersShareSheetForSave,
  canUseAppleIap,
  canUsePlayBilling,
  canUseWebCheckout,
  canLinkToWebPurchase,
  appUpdateChannel,
  canUseNativeHttpUpload,
} from './capabilities';

describe('capabilities (browser runtime, web)', () => {
  it('IMG-NATIVE-UPLOAD-1 — canUseNativeHttpUpload is false on web (WebView XHR/fetch path)', () => {
    expect(canUseNativeHttpUpload()).toBe(false);
  });

  it('disables native-only capabilities', () => {
    expect(canUseContacts()).toBe(false);
    expect(canUseNativeCamera()).toBe(false);
  });

  it('checks web API presence for non-native capabilities', () => {
    // jsdom exposes navigator + window + Audio.
    expect(canPlayAudio()).toBe(true);
    expect(canUseNotifications()).toBe(typeof globalThis.Notification !== 'undefined');
  });

  it('haptics false on non-Android web (jsdom UA defaults are not Android)', () => {
    expect(canUseHaptics()).toBe(false);
  });

  it('share + clipboard track navigator features', () => {
    expect(canShare()).toBe(typeof navigator.share === 'function');
    expect(canUseClipboard()).toBe('clipboard' in navigator);
  });

  // Regression: the previous gate was `'BeforeInstallPromptEvent' in window`
  // which is always false (the global class isn't exposed on window, only
  // the event type string is). The row never showed in browser runtime as
  // a result. Now `canInstallPWA()` returns true whenever we're in browser
  // runtime and not flagged as installed — the click handler decides
  // whether to fire a captured prompt (Chromium) or show an "Add to Home
  // Screen" hint (iOS Safari / Firefox).
  it('canInstallPWA: true in browser runtime when not installed', () => {
    expect(canInstallPWA()).toBe(true);
  });

  it('aggregate object has every key as boolean', () => {
    const caps = getCapabilities();
    for (const v of Object.values(caps)) {
      expect(typeof v).toBe('boolean');
    }
  });
});

// IMG-VIEWER-3 / VID-SAVE-1 — Save goes through the share sheet on mobile.
describe('prefersShareSheetForSave', () => {
  function stubPointer(touch: boolean) {
    return vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
      matches: touch && q.includes('pointer: coarse'),
      media: q,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));
  }
  afterEach(() => vi.restoreAllMocks());

  it('IMG-VIEWER-3 — a touch-primary web runtime (phone) prefers the share sheet for Save', () => {
    stubPointer(true);
    expect(prefersShareSheetForSave()).toBe(true);
  });

  it('IMG-VIEWER-3 — a mouse/hover desktop web runtime keeps the download', () => {
    stubPointer(false);
    expect(prefersShareSheetForSave()).toBe(false);
  });

  it('IMG-VIEWER-3 — a native runtime always prefers the share sheet', async () => {
    const { Capacitor } = await import('@capacitor/core');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    stubPointer(false);
    expect(prefersShareSheetForSave()).toBe(true);
  });
});

describe('canLeaveAppViaHistory (NAV-STACK-6)', () => {
  function setStandalone(v: boolean | undefined) {
    Object.defineProperty(window.navigator, 'standalone', { value: v, configurable: true });
  }
  afterEach(() => {
    setStandalone(undefined);
    vi.restoreAllMocks();
  });

  it('NAV-STACK-6 — a browser tab can leave (people genuinely navigate away)', () => {
    setStandalone(undefined);
    expect(canLeaveAppViaHistory()).toBe(true);
  });

  it('NAV-STACK-6 — the iOS home-screen app cannot (the blank Safari page)', () => {
    setStandalone(true);
    expect(canLeaveAppViaHistory()).toBe(false);
  });

  it('NAV-STACK-6 — a native build is not the web floor guard\'s business', async () => {
    const { Capacitor } = await import('@capacitor/core');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    setStandalone(true);
    expect(canLeaveAppViaHistory()).toBe(true);
  });
});

// BILL-MANAGE-1 — the purchase surface is chosen by where the app RUNS
// (docs/specs/billing.md). One predicate per surface, mutually exclusive.
describe('BILL-MANAGE-1 — purchase-surface predicates', () => {
  afterEach(() => vi.restoreAllMocks());

  async function stubPlatform(native: boolean, platform: 'ios' | 'android' | 'web') {
    const { Capacitor } = await import('@capacitor/core');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(native);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
  }

  it('BILL-MANAGE-1 — iOS native uses Apple IAP, and only that', async () => {
    await stubPlatform(true, 'ios');
    expect([canUseAppleIap(), canUsePlayBilling(), canUseWebCheckout()]).toEqual([true, false, false]);
  });

  it('BILL-MANAGE-1 — Android native uses Play Billing, and only that', async () => {
    await stubPlatform(true, 'android');
    expect([canUseAppleIap(), canUsePlayBilling(), canUseWebCheckout()]).toEqual([false, true, false]);
  });

  it('BILL-MANAGE-1 — the web / PWA uses web checkout, and only that', async () => {
    await stubPlatform(false, 'web');
    expect([canUseAppleIap(), canUsePlayBilling(), canUseWebCheckout()]).toEqual([false, false, true]);
  });
});

describe('NATIVE-STORE-1 — canLinkToWebPurchase', () => {
  afterEach(() => vi.restoreAllMocks());

  async function stubPlatform(native: boolean, platform: 'ios' | 'android' | 'web') {
    const { Capacitor } = await import('@capacitor/core');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(native);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
  }

  it('NATIVE-STORE-1 — false in the iOS shell (App Store 3.1.1)', async () => {
    await stubPlatform(true, 'ios');
    expect(canLinkToWebPurchase()).toBe(false);
  });

  it('NATIVE-STORE-1 — false in the Android shell (Play payments policy)', async () => {
    await stubPlatform(true, 'android');
    expect(canLinkToWebPurchase()).toBe(false);
  });

  it('NATIVE-STORE-1 — true in a browser tab / PWA', async () => {
    await stubPlatform(false, 'web');
    expect(canLinkToWebPurchase()).toBe(true);
  });
});

describe('BOOT-GATE-3 — appUpdateChannel', () => {
  afterEach(() => vi.restoreAllMocks());

  async function stubPlatform(native: boolean, platform: 'ios' | 'android' | 'web') {
    const { Capacitor } = await import('@capacitor/core');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(native);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue(platform);
  }

  it('BOOT-GATE-3 — iOS shell updates from the App Store', async () => {
    await stubPlatform(true, 'ios');
    expect(appUpdateChannel()).toBe('app-store');
  });

  it('BOOT-GATE-3 — Android shell updates from Google Play', async () => {
    await stubPlatform(true, 'android');
    expect(appUpdateChannel()).toBe('play-store');
  });

  it('BOOT-GATE-3 — browser and PWA update by reloading', async () => {
    await stubPlatform(false, 'web');
    expect(appUpdateChannel()).toBe('web-reload');
  });
});
