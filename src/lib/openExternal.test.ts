// @vitest-environment jsdom
/**
 * CHROME-LINK-1..4 (docs/specs/app-chrome.md §3b) — one helper for every URL
 * that leaves the app: the in-app browser on native, the system for store /
 * mailto / tel / settings URLs, and the browser default on the web.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const caps = vi.hoisted(() => ({ native: false }));
vi.mock('@/lib/capabilities', () => ({
  canUseInAppBrowser: () => caps.native,
}));

const rt = vi.hoisted(() => ({ runtime: 'browser' as string }));
vi.mock('@/lib/runtime', () => ({ getRuntime: () => rt.runtime }));

const browser = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@capacitor/browser', () => ({ Browser: browser }));

import { onExternalLinkClick, openExternal, opensInSystem } from './openExternal';

let winOpen: ReturnType<typeof vi.spyOn>;
let assign: ReturnType<typeof vi.fn>;
const realLocation = window.location;

beforeEach(() => {
  caps.native = false;
  rt.runtime = 'browser';
  browser.open.mockReset().mockResolvedValue(undefined);
  winOpen = vi.spyOn(window, 'open').mockReturnValue(null);
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, assign },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--color-bg');
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('opensInSystem', () => {
  it.each([
    'https://apps.apple.com/app/id123',
    'https://itunes.apple.com/app/id123',
    'https://play.google.com/store/apps/details?id=com.wurld.app',
    'itms-apps://apps.apple.com/account/subscriptions',
    'market://details?id=com.wurld.app',
    'app-settings:',
    'mailto:support@wurld.chat',
    'tel:+15551234567',
    'sms:+15551234567',
    'https://wa.me/15551234567?text=hi',
    'https://api.whatsapp.com/send?phone=15551234567',
  ])('CHROME-LINK-3 — %s goes to the system', (url) => {
    expect(opensInSystem(url)).toBe(true);
  });

  it.each(['https://wurld.chat/privacy', 'http://example.com/a', 'https://github.com/x/y'])(
    'CHROME-LINK-2 — %s is eligible for the in-app browser',
    (url) => {
      expect(opensInSystem(url)).toBe(false);
    },
  );
});

describe('openExternal', () => {
  it('CHROME-LINK-2 — native: a web page opens in the in-app browser (Browser.open)', async () => {
    caps.native = true;
    await openExternal('https://wurld.chat/terms');
    expect(browser.open).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://wurld.chat/terms' }));
    expect(winOpen).not.toHaveBeenCalled();
  });

  it('CHROME-LINK-2 — native: if Browser.open rejects, the system route still opens it', async () => {
    caps.native = true;
    browser.open.mockRejectedValue(new Error('not implemented'));
    await openExternal('https://wurld.chat/terms');
    expect(winOpen).toHaveBeenCalledWith('https://wurld.chat/terms', '_blank', 'noopener,noreferrer');
  });

  it('CHROME-LINK-3 — native: a store URL goes to the system, never the in-app browser', async () => {
    caps.native = true;
    await openExternal('https://apps.apple.com/account/subscriptions');
    expect(browser.open).not.toHaveBeenCalled();
    expect(winOpen).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions', '_blank', 'noopener,noreferrer');
  });

  it('CHROME-LINK-3 — native: mailto goes to the system via location.assign', async () => {
    caps.native = true;
    await openExternal('mailto:support@wurld.chat');
    expect(browser.open).not.toHaveBeenCalled();
    expect(winOpen).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('mailto:support@wurld.chat');
  });

  it('CHROME-LINK-4 — web: window.open in a new tab, never Browser.open', async () => {
    await openExternal('https://wurld.chat/privacy');
    expect(browser.open).not.toHaveBeenCalled();
    expect(winOpen).toHaveBeenCalledWith('https://wurld.chat/privacy', '_blank', 'noopener,noreferrer');
  });
});

describe('Custom Tabs toolbar colour', () => {
  it('CHROME-LINK-6 — Android: toolbarColor is the resolved --color-bg', async () => {
    caps.native = true;
    rt.runtime = 'native-android';
    document.documentElement.style.setProperty('--color-bg', '#11101a');
    await openExternal('https://wurld.chat/terms');
    expect(browser.open).toHaveBeenCalledWith({ url: 'https://wurld.chat/terms', toolbarColor: '#11101a' });
  });

  it('CHROME-LINK-6 — Android: an rgb() token is normalised to #rrggbb', async () => {
    caps.native = true;
    rt.runtime = 'native-android';
    document.documentElement.style.setProperty('--color-bg', 'rgb(255, 255, 255)');
    await openExternal('https://wurld.chat/terms');
    expect(browser.open).toHaveBeenCalledWith({ url: 'https://wurld.chat/terms', toolbarColor: '#ffffff' });
  });

  it('CHROME-LINK-6 — Android: an unresolvable token omits toolbarColor (plugin default)', async () => {
    caps.native = true;
    rt.runtime = 'native-android';
    await openExternal('https://wurld.chat/terms');
    expect(browser.open).toHaveBeenCalledWith({ url: 'https://wurld.chat/terms' });
  });

  it('CHROME-LINK-6 — iOS: no toolbarColor (SFSafariViewController unchanged)', async () => {
    caps.native = true;
    rt.runtime = 'native-ios';
    document.documentElement.style.setProperty('--color-bg', '#11101a');
    await openExternal('https://wurld.chat/terms');
    expect(browser.open).toHaveBeenCalledWith({ url: 'https://wurld.chat/terms' });
  });
});

describe('onExternalLinkClick', () => {
  function click() {
    return { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  }

  it('CHROME-LINK-1 — native: intercepts a web link and opens it in-app', () => {
    caps.native = true;
    const e = click();
    onExternalLinkClick(e, 'https://wurld.chat/terms');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(browser.open).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://wurld.chat/terms' }));
  });

  it('CHROME-LINK-3 — native: a mailto anchor is left to the system (no preventDefault)', () => {
    caps.native = true;
    const e = click();
    onExternalLinkClick(e, 'mailto:support@wurld.chat');
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(browser.open).not.toHaveBeenCalled();
  });

  it('CHROME-LINK-4 — web: the anchor keeps its default behaviour', () => {
    const e = click();
    onExternalLinkClick(e, 'https://wurld.chat/terms');
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(browser.open).not.toHaveBeenCalled();
    expect(winOpen).not.toHaveBeenCalled();
  });
});
