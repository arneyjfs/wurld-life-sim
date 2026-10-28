/**
 * Firestore fatal-error self-heal (OBS-FIRESTORE-1).
 *
 * iOS/WebKit can sever Firestore's IndexedDB connection on a background→
 * foreground resume ("Connection to Indexed Database server lost"), which trips
 * Firestore's INTERNAL ASSERTION (id b815 / "AsyncQueue is already failed") and
 * leaves the client's async queue PERMANENTLY failed for the session — live
 * listeners stop firing, the optimistic send bubble never reconciles, direct
 * client writes throw — until the page reloads. The SDK exposes no hook to
 * recover the queue in place (cross-refs firebase-js-sdk #2581 / #8250), so we
 * detect the fatal error globally and self-heal:
 *
 *   - Fresh incident → a plain RELOAD re-opens the (intact) IndexedDB cache, so
 *     offline still loads from cache and the live connection re-establishes.
 *   - Recurs right after a reload (genuine corruption, not just a dropped
 *     connection) → terminate + clearIndexedDbPersistence + reload. The cache
 *     is wiped and re-syncs from the server. Last resort.
 *   - Still failing after a clear → stop (never loop); a later, separate
 *     incident may retry.
 *
 * Disabling LRU GC (firebase.ts, CACHE_SIZE_UNLIMITED) removes the most common
 * trigger; this is the backstop for the residual. Decision is the pure
 * `decideRecoveryAction` (unit-tested); the executor does the side effects.
 */
import { onLog } from 'firebase/app';
import { clearIndexedDbPersistence, terminate, type Firestore } from 'firebase/firestore';
import { markFirestoreShutDown } from '@/lib/firestoreShutdown';
import * as log from './log';

/** Substrings marking a Firestore async-queue-fatal error — the queue is dead
 *  and only a reload recovers (NOT a transient/retryable error). */
export const FIRESTORE_FATAL_PATTERNS = [
  'INTERNAL ASSERTION FAILED',
  'AsyncQueue is already failed',
  'Failed to delete record from object store',
  // OBS-FIRESTORE-3 — the SDK logs this exactly when an operation throws inside
  // its async queue, which marks the queue failed for good (the queue stores the
  // error and every later enqueue short-circuits on it). The wrapped error need
  // not be an assertion: an IndexedDB "Connection ... lost" DOMException fails
  // the queue just as dead.
  'INTERNAL UNHANDLED ERROR',
];

/** True iff `message` looks like a Firestore async-queue-fatal error. */
export function isFatalFirestoreError(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  return FIRESTORE_FATAL_PATTERNS.some((p) => message.includes(p));
}

type Stage = 'reloaded' | 'cleared';
type RecoveryState = { ts: number; stage: Stage };
export type RecoveryAction = 'reload' | 'clear-and-reload' | 'give-up';

const STATE_KEY = 'wurld.fsRecovery.v1';
/** A fatal error within this window of a prior recovery = the SAME incident
 *  (the recovery didn't take) → escalate. Beyond it = a fresh incident →
 *  reload again. Bounds the escalation so we never reload-loop. */
export const SAME_INCIDENT_MS = 60_000;

/**
 * Pure: given the last recovery we recorded (or null) and the current time,
 * decide the next action. Fresh incident → reload; a fast recurrence after a
 * reload → clear-and-reload; after a clear → give up.
 */
export function decideRecoveryAction(prev: RecoveryState | null, now: number): RecoveryAction {
  if (!prev || now - prev.ts > SAME_INCIDENT_MS) return 'reload';
  if (prev.stage === 'reloaded') return 'clear-and-reload';
  return 'give-up';
}

function readState(): RecoveryState | null {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { ts?: unknown; stage?: unknown };
    return typeof p.ts === 'number' && (p.stage === 'reloaded' || p.stage === 'cleared')
      ? { ts: p.ts, stage: p.stage }
      : null;
  } catch {
    return null;
  }
}

function writeState(stage: Stage, now: number): void {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ ts: now, stage }));
  } catch {
    /* sessionStorage unavailable — recovery still reloads, just without the guard */
  }
}

let recovering = false;

/** How long a recovery step may take before we stop waiting on it. */
export const RECOVERY_STEP_TIMEOUT_MS = 3_000;

/** Await `p`, but never longer than `ms`. A dead async queue can leave
 *  `terminate` / `clearIndexedDbPersistence` pending forever; the caller must
 *  still reach its reload. Resolves (never rejects) either way. */
async function settleWithin(
  label: string,
  p: Promise<unknown>,
  ms: number = RECOVERY_STEP_TIMEOUT_MS,
): Promise<void> {
  let timer: number | undefined;
  await Promise.race([
    p.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = window.setTimeout(() => {
        log.warn('firestore recovery step did not settle — continuing', { step: label, ms });
        resolve();
      }, ms);
    }),
  ]);
  if (timer !== undefined) window.clearTimeout(timer);
}

/** Recover from a fatal Firestore queue error. Idempotent within a tick (the
 *  dead queue re-throws on every subsequent enqueue, so multiple fatals fire). */
export async function recoverFromFatalFirestore(db: Firestore): Promise<void> {
  if (recovering) return;
  recovering = true;
  const now = Date.now();
  const action = decideRecoveryAction(readState(), now);

  if (action === 'give-up') {
    log.error(new Error('firestore unrecoverable after IndexedDB clear'), {
      action: 'firestoreRecovery',
    });
    recovering = false; // allow a future, separate incident to retry
    return;
  }

  // OBS-FIRESTORE-4 — report every self-heal, not only the give-up. A
  // successful heal ended at `log.warn`, which never reaches Sentry, so
  // "the fatal never happened" and "it happened and we recovered" were
  // indistinguishable in telemetry. That ambiguity is precisely what made the
  // 2026-10-02 boot hang undiagnosable after the fact.
  log.error(new Error(`firestore async queue failed — self-heal: ${action}`), {
    action: 'firestoreRecovery',
    recoveryAction: action,
  });

  if (action === 'clear-and-reload') {
    writeState('cleared', now);
    log.warn('firestore fatal recurred — clearing IndexedDB cache + reloading');
    // OBS-FIRESTORE-5 — BOUND, not just try/catch. `try/catch` catches a
    // REJECTION; it does nothing for a promise that never settles. Both of
    // these enqueue on the very async queue that is already dead, so either can
    // hang — and `recovering` is latched true above, so nothing retries and the
    // reload below is never reached. That is a hang inside the thing whose job
    // is preventing hangs, and it presents exactly like the bug this module
    // exists to fix (owner report 2026-10-02: white screen + spinner after
    // sign-in, cured only by force-quit).
    // OBS-FIRESTORE-6 — before `terminate`, so no hook re-subscribes to the
    // dead client while we wait (a sync throw there is a render crash loop).
    markFirestoreShutDown();
    await settleWithin('terminate', terminate(db));
    await settleWithin('clearIndexedDbPersistence', clearIndexedDbPersistence(db));
    window.location.reload();
    return;
  }

  // 'reload' — the common case: a dropped IDB connection on resume. A reload
  // re-opens the intact cache (offline still loads, connection restored). Small
  // delay so Sentry can flush the captured event before we navigate.
  writeState('reloaded', now);
  log.warn('firestore fatal — reloading to recover');
  window.setTimeout(() => window.location.reload(), 250);
}

/** Install global listeners that self-heal a fatal Firestore queue error.
 *  Only meaningful on the persistent-cache (IndexedDB) path. */
export function installFirestoreRecovery(db: Firestore): void {
  if (typeof window === 'undefined') return;
  const handle = (message: unknown) => {
    if (isFatalFirestoreError(message)) void recoverFromFatalFirestore(db);
  };
  // OBS-FIRESTORE-3 — the SDK's OWN error log, as well as the global events
  // below. The SDK logs every internal assertion and every async-queue failure
  // before it throws ("just in case the exception is swallowed", its own
  // comment), and the app DOES swallow it: `useCollectionSnapshot`'s cache read
  // ends in `.catch(() => {})`, and most write paths catch and toast. A fatal
  // that surfaces through a handled promise never reaches `error` /
  // `unhandledrejection`, so the queue stayed dead — every listener frozen, the
  // chat list included — until the user restarted the app (owner report
  // 2026-10-01: "the new chatlist entry now doesn't show at all until an app
  // restart", with no other chat updating either).
  //
  // `onLog` binds to the logger instances that exist when it is called, so this
  // must run after `firebase/firestore` has loaded — `firebase.ts` calls it after
  // `initializeFirestore`.
  onLog(({ message }) => handle(message), { level: 'error' });
  window.addEventListener('error', (e: ErrorEvent) => {
    handle((e.error as { message?: unknown } | undefined)?.message ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r: unknown = e.reason;
    handle(typeof r === 'string' ? r : (r as { message?: unknown } | null)?.message);
  });
}
