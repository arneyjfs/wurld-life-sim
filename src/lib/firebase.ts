import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  type Auth,
} from 'firebase/auth';
import {
  CACHE_SIZE_UNLIMITED,
  connectFirestoreEmulator,
  disableNetwork,
  doc,
  enableNetwork,
  getDocFromServer,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentSingleTabManager,
  type Firestore,
} from 'firebase/firestore';
import {
  connectStorageEmulator,
  getStorage,
  type FirebaseStorage,
} from 'firebase/storage';
import { config } from './config';
import * as log from './log';
import {
  PUSH_TAP_PROBE_MS,
  absenceAtTap,
  probeThenRebuild,
  pushTapReconnect,
  type PushTapProbeResult,
  type PushTapReconnect,
} from './pushPreview';
import { installFirestoreRecovery } from './firestoreRecovery';
import {
  installFetchGuard,
  uninstallFetchGuard,
} from './bootFetchGuard';
import { initAppCheck } from './appCheck';

// ---------------------------------------------------------------------------
// Cold-boot mitigations
// ---------------------------------------------------------------------------
// Three separate stalls hit cold-boot on slow networks (EDGE / 3G), each
// adding 20-70s before the UI could render. Diagnosed via timing logs; root
// causes and mitigations:
//
//   1. Firestore SDK lazy init waits 10s × backoff retries before falling
//      back to cache. Every queued op stalls. → Mitigate by spoofing
//      navigator.onLine = false at boot; the SDK's connectivity monitor
//      sees offline, skips the watch stream, and cache reads return
//      instantly.
//
//   2. getAuth() wires a browserPopupRedirectResolver by default, which on
//      mobile browsers triggers a proactive iframe load from apis.google.com
//      to prepare OAuth popup flows. _initializeWithPersistence awaits this
//      before initializeCurrentUser. → Mitigate by using initializeAuth
//      directly with no popupRedirectResolver. We use phone auth, never
//      OAuth popups.
//
//   3. Auth's _initializeCurrentUser then calls accounts:lookup on
//      identitytoolkit.googleapis.com to validate the cached ID token,
//      which hangs ~60s on EDGE. fetch ignores navigator.onLine. → Mitigate
//      by intercepting window.fetch and rejecting accounts:lookup with
//      TypeError. Auth maps that to NETWORK_REQUEST_FAILED and explicitly
//      keeps the cached user. Firestore lazy-refreshes the token later
//      when it actually needs to talk to the server.
//
// Combined, cold-boot from boot to first paint drops from ~70s to a few
// hundred ms on EDGE.

// --- fetch guard (mitigation 3) -------------------------------------------
// Logic lives in `bootFetchGuard.ts` so it's testable in isolation; we
// install BEFORE any Firebase module touches `fetch`.
// Skipped under the emulator harness: the guard + the navigator.onLine spoof
// below exist to survive slow REAL-network cold-boot; against a local emulator
// they'd needlessly fight the (instant) localhost connection.
if (!config.useEmulators) installFetchGuard();

export const firebaseApp: FirebaseApp = initializeApp(config.firebase);

// --- App Check (APPCHECK-4) -----------------------------------------------
// Synchronous, non-awaited, cannot throw. With no VITE_FIREBASE_APPCHECK_SITE_KEY
// — the shipped state — it returns having imported nothing, so the BOOT-INIT
// sequence below is unchanged. See docs/specs/app-check.md.
initAppCheck(firebaseApp);

// --- Auth init (mitigation 2) ---------------------------------------------
export const auth: Auth = initializeAuth(firebaseApp, {
  persistence: [
    indexedDBLocalPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
  ],
});

// --- Emulator wiring (test harness only) ----------------------------------
// VITE_USE_EMULATORS routes the client SDK at the local Emulator Suite so the
// browser E2E runs on a deterministic, congestion-free data substrate (no
// real-Firestore WebChannel long-poll → no live-tail churn). MUST run before
// any auth/Firestore op. Gemini is unaffected: the emulated Cloud Functions
// still call the real API. `connectFirestoreEmulator(db, …)` is issued right
// after `db` is created below.
if (config.useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

// --- boot offline window (mitigation 1) -----------------------------------
const POST_AUTH_GRACE_MS = 300;
// With the popup-redirect resolver removed Auth fires almost immediately
// (fetch guard catches accounts:lookup within ~10ms). The safety timeout
// only fires if Auth fails to initialise at all — keep it generous enough
// to absorb a slow IndexedDB init on first-ever launch.
const MAX_BOOT_OFFLINE_MS = 3000;
let realOnLine = true;
let bootOfflineActive = false;
let suppressNextOnlineNudge = false;

if (!config.useEmulators && typeof navigator !== 'undefined' && typeof window !== 'undefined') {
  realOnLine = navigator.onLine;
  try {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });
    bootOfflineActive = true;
    suppressNextOnlineNudge = true;
    window.dispatchEvent(new Event('offline'));
    suppressNextOnlineNudge = false;
  } catch {
    // navigator.onLine may be non-configurable on some browsers. The fetch
    // guard alone still gives us the fast-auth win; just skip the spoof.
  }

  const restore = (reason: string) => {
    // Always uninstall the fetch guard — even if the navigator.onLine spoof
    // didn't take, the guard is what gets Auth firing fast.
    uninstallFetchGuard();
    if (!bootOfflineActive) {
      log.info('[boot] window closed', { reason });
      return;
    }
    bootOfflineActive = false;
    try {
      Object.defineProperty(navigator, 'onLine', {
        value: realOnLine,
        writable: true,
        configurable: true,
      });
    } catch {
      // property became non-configurable; nothing we can do
    }
    if (realOnLine && typeof window !== 'undefined') {
      // Suppress the corresponding nudge so disableNetwork doesn't reject
      // CacheWarmer's in-flight reads. The SDK detects the property restore
      // via its own connectivity monitor — the dispatch is just to keep
      // external listeners (OfflineBar) in sync.
      //
      // The `typeof window` guard handles the test-teardown race: the
      // boot's 3s timeout can fire after the jsdom environment has been
      // disposed, leaving `window` undefined in the surviving node host.
      // No external listeners exist post-teardown to nudge anyway.
      suppressNextOnlineNudge = true;
      window.dispatchEvent(new Event('online'));
      suppressNextOnlineNudge = false;
    }
    log.info('[boot] window closed', { reason, realOnLine });
  };

  // Close the window as soon as Auth has resolved. With the fetch guard
  // intercepting accounts:lookup, Auth catches the synthetic
  // network-request-failed and fires onAuthStateChanged with the cached
  // user immediately.
  const unsubAuth = onAuthStateChanged(auth, () => {
    unsubAuth();
    window.setTimeout(() => restore('auth-ready'), POST_AUTH_GRACE_MS);
  });

  // Safety net: bound the window in case Auth never fires.
  window.setTimeout(() => restore('timeout'), MAX_BOOT_OFFLINE_MS);
}

/**
 * True while the boot-offline override is forcing navigator.onLine = false.
 * UI that surfaces offline state (e.g. OfflineBar) should treat this window
 * as "online unknown" rather than flashing an offline banner.
 */
export function isBootOfflineWindow(): boolean {
  return bootOfflineActive;
}

// Single-tab manager — Capacitor only ever has one WebView, so the
// multi-tab primary-lease election just adds overhead. forceOwnership
// makes the takeover deterministic if the page reloads.
//
// Under the emulator harness use an in-MEMORY cache, not IndexedDB: each test
// navigation should start from clean state (no cross-navigation cache carrying
// a prior run's docs), and persistent cache + the emulator add needless
// IndexedDB churn. The persistent single-tab cache is the production path.
export const db: Firestore = initializeFirestore(firebaseApp, {
  // TEST HARNESS ONLY — force long-polling against the emulator.
  //
  // The SDK's default is to auto-detect the transport: it opens a WebChannel
  // and probes whether the environment can stream, falling back to long-poll
  // if not. In WebKit against the local emulator that probe is slow — the
  // FIRST snapshot for a collection took 20-40s, against ~1s in Chromium, so
  // the chat list arrived empty, `chat.practiceLanguages` was unreadable, and
  // a spread of @critical specs failed on webkit-mobile for what looked like
  // unrelated reasons. Forcing the transport skips the probe entirely.
  //
  // Deliberately NOT applied to production: real Firestore streams fine and
  // WebChannel is the faster path there. This narrows the harness's substrate
  // difference, it does not change what ships.
  ...(config.useEmulators ? { experimentalForceLongPolling: true } : {}),
  localCache: config.useEmulators
    ? memoryLocalCache()
    : persistentLocalCache({
        tabManager: persistentSingleTabManager({ forceOwnership: true }),
        // Disable LRU garbage collection: the iOS/WebKit b815 "Failed to delete
        // record from object store" crash fires from the GC's IndexedDB delete
        // (which then poisons the whole async queue). With GC off, the cache
        // grows and the OS evicts it under storage pressure instead. The
        // residual async-queue-fatal case is self-healed by
        // installFirestoreRecovery below. OBS-FIRESTORE-1.
        cacheSizeBytes: CACHE_SIZE_UNLIMITED,
      }),
});

// Route Firestore at the emulator BEFORE any read/write (test harness only).
if (config.useEmulators) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
} else {
  // Persistent (IndexedDB) cache path only: self-heal the iOS/WebKit
  // async-queue-fatal crash (b815) by reloading. The emulator path uses an
  // in-memory cache, so it can't hit it. OBS-FIRESTORE-1.
  installFirestoreRecovery(db);
}

/** Firebase Storage handle. Currently used only by the life-sim
 *  delete-and-restart flow to wipe the `lifeAssets/{uid}/` prefix —
 *  uploads still go through a Cloud Function signed-URL path. */
export const storage: FirebaseStorage = getStorage(firebaseApp);

// Route Storage at the emulator too (test harness only) so image-upload
// specs don't reach prod storage. Same flag gate as Auth/Firestore above.
if (config.useEmulators) {
  connectStorageEmulator(storage, '127.0.0.1', 9199);
}

// ---------------------------------------------------------------------------
// Firestore network nudge
// ---------------------------------------------------------------------------
// Firestore SDK has its own auto-reconnect, but on mobile network handoff
// (EDGE→5G, Wi-Fi→cellular, etc) its watch stream can sit on a dead socket
// for 30s+ before retrying. Explicit disable/enable cycle drops the stale
// stream and forces a clean reconnect, so the user's snapshot listeners
// re-fire with fresh data as soon as the OS reports we're back online.

let nudgeInFlight = false;
let lastNudgeMs = 0;
const NUDGE_COOLDOWN_MS = 3_000;

async function nudgeFirestore(reason: string): Promise<void> {
  if (nudgeInFlight) return;
  if (Date.now() - lastNudgeMs < NUDGE_COOLDOWN_MS) return;
  nudgeInFlight = true;
  lastNudgeMs = Date.now();
  try {
    await disableNetwork(db);
    await enableNetwork(db);
    log.info('firestore nudged', { reason });
  } catch (err) {
    log.warn('firestore nudge failed', { reason, err });
  } finally {
    nudgeInFlight = false;
  }
}

// NOTIF-17.4 — how long the page was last away, for the push-tap nudge.
let hiddenSinceMs = 0;
let lastHiddenSpanMs = 0;
let lastShownAtMs = 0;
if (typeof document !== 'undefined') {
  if (document.visibilityState === 'hidden') hiddenSinceMs = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenSinceMs = Date.now();
    } else if (document.visibilityState === 'visible' && hiddenSinceMs) {
      lastHiddenSpanMs = Date.now() - hiddenSinceMs;
      lastShownAtMs = Date.now();
      hiddenSinceMs = 0;
    }
  });
}

/** OBS-FIRESTORE-4 — reconnect the watch stream now (cooldown still applies). */
export function nudgeFirestoreNow(reason: string): Promise<void> {
  return nudgeFirestore(reason);
}

/** NOTIF-17.6 — a tap this soon after page load, with no absence, launched the app. */
const COLD_START_TAP_MS = 15_000;

export type PushTapConnection = {
  mode: PushTapReconnect;
  absenceMs: number;
  coldStart: boolean;
  /** Resolves once the stream is known alive or has been rebuilt; null for `none`. */
  done: Promise<PushTapProbeResult> | null;
};

/**
 * NOTIF-17.5 — on a notification tap, leave the realtime connection alone,
 * check it with a one-read probe, or rebuild it at once (`nudgeFirestore`).
 */
export function reconnectForPushTap(reason: string, suspendsInBackground: boolean): PushTapConnection {
  const nowMs = Date.now();
  const absenceMs = absenceAtTap({ hiddenSinceMs, lastHiddenSpanMs, lastShownAtMs, nowMs });
  const coldStart = absenceMs === 0 && typeof performance !== 'undefined' && performance.now() < COLD_START_TAP_MS;
  const mode = pushTapReconnect(absenceMs, suspendsInBackground);
  const rebuild = () => nudgeFirestore(reason);
  let done: Promise<PushTapProbeResult> | null = null;
  if (mode === 'nudge') {
    done = rebuild().then(() => ({ rebuilt: true, probeMs: 0 }));
  } else if (mode === 'probe') {
    const uid = auth.currentUser?.uid;
    done = probeThenRebuild(
      () => (uid ? getDocFromServer(doc(db, 'users', uid)) : Promise.reject(new Error('signed out'))),
      rebuild,
      PUSH_TAP_PROBE_MS,
    );
  }
  return { mode, absenceMs, coldStart, done };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (suppressNextOnlineNudge) return;
    void nudgeFirestore('online');
  });

  // Network handoff is the EXACT case the nudge exists to handle —
  // a dead socket left over from the previous network's IP. The
  // browser's Network Information API tells us this directly:
  // `connection.change` fires on actual `type` / `effectiveType`
  // transitions (Wi-Fi ↔ cellular, 4G → 5G, etc). No proxy, no
  // visibility-based guessing, no false positives from focus flips.
  //
  // Supported on Chromium, Edge, Android (incl. Capacitor Android
  // WebView), Safari iOS. NOT supported on Safari macOS or Firefox
  // desktop — those fall through to the long-hidden visibility
  // fallback below.
  //
  // The previous implementation nudged on EVERY `visibilitychange →
  // visible` event, which fires whenever devtools steal focus, the
  // user alt-tabs, an OS notification overlays, etc. Each nudge
  // forced disableNetwork→enableNetwork, which forced EVERY active
  // onSnapshot listener to re-attach and re-emit every doc as
  // "added", cascading 9-10 spurious renders through ChatScreen and
  // producing a visible 1-2px flicker — for no benefit, since the
  // connection was never stale. Diagnosed 2026-06-04 from a Safari
  // macOS log showing `firestore nudged reason:visible` followed by
  // `contentChangesLen:15 contentChangeTypes:[added:..., added:...]`
  // × ~9.
  type NetworkInformation = {
    type?: string;
    effectiveType?: string;
    addEventListener?: (event: 'change', cb: () => void) => void;
  };
  const nav = navigator as Navigator & {
    connection?: NetworkInformation;
    mozConnection?: NetworkInformation;
    webkitConnection?: NetworkInformation;
  };
  const connection: NetworkInformation | undefined =
    nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  if (connection && typeof connection.addEventListener === 'function') {
    let lastType = connection.type;
    let lastEffectiveType = connection.effectiveType;
    connection.addEventListener('change', () => {
      const nextType = connection.type;
      const nextEffectiveType = connection.effectiveType;
      if (
        nextType === lastType &&
        nextEffectiveType === lastEffectiveType
      ) {
        return;
      }
      const prev = `${lastType ?? '?'}/${lastEffectiveType ?? '?'}`;
      const next = `${nextType ?? '?'}/${nextEffectiveType ?? '?'}`;
      lastType = nextType;
      lastEffectiveType = nextEffectiveType;
      void nudgeFirestore(`connection:${prev}→${next}`);
    });
  } else {
    // Safari macOS / Firefox desktop fallback. Use visibility AFTER
    // the page was hidden long enough to plausibly be on a stale
    // connection. 30s is the threshold below which "dead socket" is
    // implausible — short hidden windows (devtools focus, alt-tab)
    // are reliably suppressed.
    let lastHiddenMs = 0;
    const VISIBLE_NUDGE_HIDDEN_THRESHOLD_MS = 30_000;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        lastHiddenMs = Date.now();
        return;
      }
      if (document.visibilityState !== 'visible') return;
      const hiddenForMs = lastHiddenMs > 0 ? Date.now() - lastHiddenMs : 0;
      if (hiddenForMs < VISIBLE_NUDGE_HIDDEN_THRESHOLD_MS) return;
      void nudgeFirestore('visible');
    });
  }
}
