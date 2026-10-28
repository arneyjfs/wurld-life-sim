/**
 * Cold-boot fetch guard for Firebase Auth's `accounts:lookup` token-
 * validation RPC.
 *
 * On EDGE / 3G that fetch hangs ~60s before the socket times out, blocking
 * Firebase Auth's `_initializeCurrentUser` — and Firestore's async queue
 * sits behind Auth, so even `getDocsFromCache` stalls. Spoofing
 * `navigator.onLine = false` doesn't help because `fetch` ignores it and
 * dispatches the request regardless.
 *
 * The fix: install a `window.fetch` wrapper at module top, BEFORE any
 * Firebase module runs. When the URL contains `/accounts:lookup` and the
 * guard is active, reject immediately with `TypeError`. Auth maps `TypeError`
 * to `auth/network-request-failed`, which its init handler explicitly
 * treats as "keep the cached user" (other errors sign the user out). The
 * stale ID token gets refreshed lazily by Firestore on its first server
 * request, after cache reads have already painted.
 *
 * Scope: ONLY `/accounts:lookup` is blocked. Sign-in flows
 * (`accounts:signInWith*`, `accounts:sendOobCode`) hit different paths and
 * are untouched, as is token refresh via `securetoken.googleapis.com`.
 */

const BLOCKED_URL_FRAGMENT = '/accounts:lookup';

let active = false;
let originalFetch: typeof globalThis.fetch | null = null;

function extractUrl(input: RequestInfo | URL): string {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return (input as Request).url ?? '';
  } catch {
    return '';
  }
}

export function installFetchGuard(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  if (active) return;
  originalFetch = window.fetch.bind(window);
  active = true;
  window.fetch = function bootGuardedFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (active && extractUrl(input).includes(BLOCKED_URL_FRAGMENT)) {
      // `TypeError` specifically — Firebase Auth's fetch wrapper maps this
      // to `auth/network-request-failed`, which its init code treats as
      // "keep the cached user" rather than signing the user out.
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return originalFetch!(input, init);
  };
}

export function uninstallFetchGuard(): void {
  if (!active) return;
  active = false;
  if (originalFetch && typeof window !== 'undefined') {
    window.fetch = originalFetch;
    originalFetch = null;
  }
}

export function isFetchGuardActive(): boolean {
  return active;
}
