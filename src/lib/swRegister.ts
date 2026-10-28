import * as log from './log';
import { isNative } from './runtime';
import { getSwUnregistered, setSwUnregistered } from './liveUpdate/state';

/**
 * BOOT-SHELL-4/5 — the app's ONE service-worker registration
 * (docs/specs/cold-boot.md §3c).
 *
 * OTA-13 (docs/specs/live-updates.md) — **never in a native shell.** iOS
 * WKWebView on `capacitor://localhost` has no service worker, but Android's
 * WebView does on `https://localhost`, and Capacitor routes the worker's
 * fetches through the same local server — so a registered worker precached
 * the shell and served the PREVIOUS bundle for one launch after every swap
 * (and, by the same mechanism, after every Play store update). Worse, that
 * masked page is our code calling `notifyAppReady()`, which would mark a
 * bundle that never ran as good. The shell's files are local and push is the
 * FCM plugin on both platforms (NOTIF-8.1), so nothing is lost:
 * `registerServiceWorker()` returns `null` at once on native, and
 * `unregisterServiceWorkersOnce()` removes whatever a pre-OTA build left
 * behind, once, before the first live-update check.
 *
 * Registration used to live inside `UpdateAvailableToast`, a React component
 * mounted at the bottom of the tree. That made the shell precache wait for
 * React to mount and the providers to settle — so a first visit didn't become
 * offline-capable until the app had already rendered, and the "is there a new
 * build?" check couldn't run any earlier either. It is a boot concern, so it
 * runs from `main.tsx`.
 *
 * Everything else that needs the registration — the update prompt
 * (`UpdateAvailableToast`), FCM `getToken` (`notifications/setup.ts`) — reads
 * it from here. A second `register()` for the same script would race the first
 * and can leave two workers contending over the same scope.
 *
 * Deferred to `load`: on a FIRST visit the install handler fetches the whole
 * precache manifest, and we don't want those competing with the bytes the user
 * is waiting on. On every subsequent visit the worker is already installed, so
 * this is near-free.
 */

const SW_PATH = '/firebase-messaging-sw.js';

let registration: ServiceWorkerRegistration | null = null;
let inFlight: Promise<ServiceWorkerRegistration | null> | null = null;

function afterLoad(): Promise<void> {
  if (typeof document === 'undefined' || document.readyState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    window.addEventListener('load', () => resolve(), { once: true });
  });
}

function settle(reg: ServiceWorkerRegistration | null) {
  registration = reg;
}

/**
 * Register the service worker. Idempotent and concurrency-safe — every caller
 * gets the same registration (BOOT-SHELL-5). Never throws: a boot path must
 * not be able to fail because a worker didn't install.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    // OTA-13 — a native shell never registers a worker; before the `load`
    // wait, so nothing in the shell ever sits behind it.
    if (isNative()) {
      settle(null);
      return null;
    }
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
      settle(null);
      return null;
    }
    await afterLoad();
    try {
      const reg = await navigator.serviceWorker.register(SW_PATH, {
        // BOOT-SHELL-8's page-side half: never let the HTTP cache answer the
        // update check for the worker script itself.
        updateViaCache: 'none',
      });
      settle(reg ?? null);
      // BOOT-SHELL-3 — freshness check AFTER the app is interactive. The
      // browser usually does this on navigation, but it throttles; an explicit
      // nudge means a device can't sit on an old build indefinitely.
      try {
        await reg?.update();
      } catch {
        /* offline, or the check was throttled — retried next boot */
      }
      return reg ?? null;
    } catch (err) {
      log.warn('serviceWorker register failed', { err });
      // BOOT-SHELL-11 — a shell-less install REJECTS, and that rejects
      // `register()` for the new generation. The previous worker is still
      // installed and in control, though, so fall back to it: returning null
      // would take the update prompt and the push token's registration away
      // from a page whose service worker is working fine.
      try {
        const existing = await navigator.serviceWorker.getRegistration(SW_PATH);
        settle(existing ?? null);
        return existing ?? null;
      } catch {
        settle(null);
        return null;
      }
    }
  })();
  return inFlight;
}

/** The boot registration, or null if it hasn't landed (or failed). */
export function getServiceWorkerRegistration(): ServiceWorkerRegistration | null {
  return registration;
}

/**
 * Resolves with the boot registration once it lands.
 *
 * If boot registration hasn't been kicked off (a test, or an entry point that
 * isn't `main.tsx`), this starts it rather than waiting forever — a consumer
 * awaiting this must never be able to hang.
 */
export function whenServiceWorkerReady(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return Promise.resolve(registration);
  if (inFlight) return inFlight;
  return registerServiceWorker();
}

let unregisterOnce: Promise<void> | null = null;

/**
 * OTA-13 — the one-time cleanup in a native shell: unregister every service
 * worker a pre-OTA build registered and delete every CacheStorage cache it
 * filled, then record `wurld.ota.swUnregistered = '1'` so later boots skip it.
 * iOS has no `navigator.serviceWorker` on `capacitor://`; the step is still
 * recorded as done there. Always resolves; a failure leaves the flag unset so
 * the next boot retries. The live-update runner awaits this before its first
 * check, so a worker can never mask the first bundle swap.
 */
export function unregisterServiceWorkersOnce(): Promise<void> {
  if (unregisterOnce) return unregisterOnce;
  unregisterOnce = (async () => {
    try {
      if (!isNative()) return;
      const alreadyDone = await getSwUnregistered();
      // The sweep runs on EVERY native boot, not only the first: the worker
      // the first pass unregisters keeps serving the page that unregistered
      // it until that page unloads, and a `caches.open()` from one of its
      // last fetches recreates the cache name (seen on the emulator, §7 step
      // 1: an empty `wurld-precache-*` after the cleanup). On empty storage
      // both calls are near-free; the flag only keeps the log and the write
      // to the first pass.
      if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      }
      if (typeof caches !== 'undefined' && caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      if (alreadyDone) return;
      await setSwUnregistered();
      log.info('OTA-13: service-worker cleanup done');
    } catch (err) {
      log.warn('OTA-13: service-worker cleanup failed; will retry next boot', { err });
    }
  })();
  return unregisterOnce;
}
