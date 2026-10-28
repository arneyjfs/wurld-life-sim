import { Browser } from '@capacitor/browser';
import { canUseInAppBrowser } from '@/lib/capabilities';
import { getRuntime } from '@/lib/runtime';
import { resolveCssVar, toHexColor } from '@/lib/statusBar';

/**
 * CHROME-LINK-1..4 (docs/specs/app-chrome.md §3b) — the one way to open a URL
 * that leaves the app.
 *
 *   - Native shell, ordinary web page → the in-app browser (`@capacitor/browser`:
 *     SFSafariViewController on iOS, Chrome Custom Tabs on Android), so the
 *     user is never thrown out to Safari / Chrome for a privacy policy.
 *   - Store, OS-settings, mailto / tel / sms, WhatsApp links → the system, on
 *     every runtime.
 *     An in-app browser can neither open the App Store nor a mail composer.
 *   - Web (tab + PWA) → unchanged: a new tab.
 */

const SYSTEM_SCHEMES = new Set([
  'mailto:',
  'tel:',
  'sms:',
  'itms-apps:',
  'itms-appss:',
  'itms-services:',
  'market:',
  'app-settings:',
]);

const STORE_HOSTS = new Set(['apps.apple.com', 'itunes.apple.com', 'play.google.com']);

/** CHROME-LINK-3 — links an installed app claims (CONTACTS-INVITE-4's
 *  WhatsApp invite). An in-app browser would not hand them to the app. */
const APP_LINK_HOSTS = new Set(['wa.me', 'api.whatsapp.com']);

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isHttp(u: URL): boolean {
  return u.protocol === 'http:' || u.protocol === 'https:';
}

/** CHROME-LINK-3 — must this URL go to the OS rather than an in-app browser? */
export function opensInSystem(url: string): boolean {
  const u = parse(url);
  if (!u) return true;
  if (SYSTEM_SCHEMES.has(u.protocol)) return true;
  if (!isHttp(u)) return true;
  const host = u.hostname.toLowerCase();
  return STORE_HOSTS.has(host) || APP_LINK_HOSTS.has(host);
}

/** Hand the URL to the OS (or, on the web, the browser). */
function openInSystem(url: string): void {
  const u = parse(url);
  if (u && isHttp(u)) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  window.location.assign(url);
}

/** True when `openExternal` would do something other than the anchor default. */
function wantsInAppBrowser(url: string): boolean {
  return canUseInAppBrowser() && !opensInSystem(url);
}

/**
 * CHROME-LINK-6 — Android Custom Tabs: tint the toolbar with the current page
 * colour (`--color-bg`). Omitted when it cannot be resolved, and on iOS.
 */
function browserOptions(url: string): { url: string; toolbarColor?: string } {
  if (getRuntime() !== 'native-android') return { url };
  const toolbarColor = toHexColor(resolveCssVar('--color-bg'));
  return toolbarColor ? { url, toolbarColor } : { url };
}

/** CHROME-LINK-1 — open a URL that leaves the app. Never throws. */
export async function openExternal(url: string): Promise<void> {
  if (wantsInAppBrowser(url)) {
    try {
      await Browser.open(browserOptions(url));
      return;
    } catch {
      // CHROME-LINK-2 — plugin missing from a stale native build: fall through
      // to the system route rather than doing nothing.
    }
  }
  openInSystem(url);
}

type ClickLike = { preventDefault(): void };

/**
 * CHROME-LINK-1 — `onClick` for an external `<a href target="_blank">`. The
 * anchor stays a real link (role, long-press preview, cmd-click on desktop);
 * this only takes over where the in-app browser should open it. Everywhere
 * else the browser / OS default runs untouched (CHROME-LINK-3/4).
 */
export function onExternalLinkClick(e: ClickLike, href: string): void {
  if (!wantsInAppBrowser(href)) return;
  e.preventDefault();
  void openExternal(href);
}
