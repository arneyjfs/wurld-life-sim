/**
 * Service-worker update-prompt decision logic (OBS-UPDATE-*).
 *
 * Kept as a PURE function + thin localStorage wrappers so the "when do we show
 * the update-available banner" rule is unit-testable in isolation — the bug it
 * fixes (the banner firing when no restart was needed, and re-firing on every
 * reload) lived in ad-hoc component logic that couldn't be tested.
 *
 * The contract: the "A new version is available — reload" banner fires IFF
 *   1. a new worker is installed + WAITING (a restart would swap the build), AND
 *   2. the page is already CONTROLLED by a worker (`navigator.serviceWorker
 *      .controller` present) — otherwise this is a first-ever install, not an
 *      update that "needs a restart to take effect", AND
 *   3. we have NOT already notified the user for the currently-loaded build, AND
 *   4. the waiting worker is a DIFFERENT build from the one running
 *      (OBS-UPDATE-8 — it says which, see `queryWorkerBuild`).
 *
 * (3) is the anti-spam clause. An un-accepted waiting worker PERSISTS across
 * in-tab reloads / resumes (OBS-UPDATE-2: a refresh doesn't reliably swap the
 * worker), so without it the banner re-appears on every load for the same
 * pending update. We key the "already notified" marker on the loaded build's
 * git SHA (`frontendBuild.gitSha`, OBS-VERSION-1), so it resets automatically
 * the moment the app actually updates to a new build.
 */
import { frontendBuild } from './buildInfo';

/** localStorage key holding the git SHA of the build we last showed the
 *  update-available banner for. */
export const SW_UPDATE_NOTIFIED_KEY = 'wurld.swUpdate.notifiedBuild';

export interface UpdateBannerInputs {
  /** A freshly-installed worker is in the `waiting` state. */
  hasWaitingWorker: boolean;
  /** `navigator.serviceWorker.controller != null` — the page is controlled by
   *  a worker, so a waiting worker is a genuine UPDATE (not a first install). */
  hasController: boolean;
  /** git SHA of the build currently running in the page (`frontendBuild.gitSha`). */
  currentBuild: string;
  /** git SHA we last showed the banner for (from localStorage), or null. */
  notifiedBuild: string | null;
  /** OBS-UPDATE-8 — git SHA the waiting worker reports for ITSELF
   *  (`queryWorkerBuild`), or null when it did not answer: a worker built
   *  before the handler existed, or a timeout. Null counts as a different
   *  build — the pre-8 behaviour. */
  waitingBuild: string | null;
}

/**
 * Pure decision: should the "update available — reload" banner be shown now?
 * See the module contract above. Returns false unless every condition holds.
 */
export function decideUpdateBanner(i: UpdateBannerInputs): boolean {
  if (!i.hasWaitingWorker) return false; // nothing new installed to restart into
  if (!i.hasController) return false; // first-ever install, not an update
  // OBS-UPDATE-8 — a rebuild of the running commit (`__BUILD_TIME__` is
  // compiled in, so every rebuild is a byte-different worker) is not a new
  // version: it would "update" to the identical version line.
  if (i.waitingBuild !== null && i.waitingBuild === i.currentBuild) return false;
  if (i.notifiedBuild === i.currentBuild) return false; // already prompted for this build → no per-reload spam
  return true;
}

/**
 * OBS-UPDATE-8 — ask a worker which build it is.
 *
 * The page cannot read a worker's build from the registration, and a rebuild
 * of the same commit is a byte-different script the browser dutifully
 * installs. So it asks: a `GET_VERSION` message carrying a MessageChannel
 * port, which the shipped worker answers with `{ type: 'VERSION', version,
 * gitSha }` from its build-time tokens (`public/firebase-messaging-sw.js`).
 *
 * Resolves the git SHA, or null when the worker does not answer within
 * `timeoutMs` (a worker built before the handler existed, or gone), replies
 * with something else, or cannot be posted to. Never rejects: callers treat
 * null as "a different build" and prompt, the behaviour before OBS-UPDATE-8.
 */
/** The one method of a worker this needs — a `ServiceWorker`, or a test fake. */
type MessageTarget = { postMessage: (message: unknown, transfer: Transferable[]) => void };

export function queryWorkerBuild(
  worker: MessageTarget | null | undefined,
  timeoutMs = 1500,
): Promise<string | null> {
  if (!worker || typeof MessageChannel === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const done = (build: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        channel.port1.close();
      } catch {
        /* a closed port is fine */
      }
      resolve(build);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    channel.port1.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: unknown; gitSha?: unknown } | null;
      done(data && data.type === 'VERSION' && typeof data.gitSha === 'string' ? data.gitSha : null);
    };
    try {
      worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    } catch {
      done(null);
    }
  });
}

/** Read the build we last notified for. Safe if localStorage is unavailable. */
export function readNotifiedBuild(): string | null {
  try {
    return localStorage.getItem(SW_UPDATE_NOTIFIED_KEY);
  } catch {
    return null;
  }
}

/** Record that we've shown the banner for `build`, so reloads on the same build
 *  don't re-prompt (resets when the loaded build changes). */
export function markUpdateBannerShown(build: string): void {
  try {
    localStorage.setItem(SW_UPDATE_NOTIFIED_KEY, build);
  } catch {
    /* ignore — non-persisted dedupe just means it may re-show next load */
  }
}

/**
 * OBS-UPDATE-5 — "Check for updates", as an action that can actually update.
 *
 * The Settings row used to be `location.reload()`. That asks the SERVER
 * nothing and tells the WORKER nothing: a reload is a navigation, the old
 * worker is still the controller, and BOOT-SHELL-1 serves navigations
 * cache-first out of that worker's precache — so the user reliably reloaded
 * into the build they were already running. Reported as "I can manually hit
 * check for updates, which reloads, but I still need to kill the app to get
 * it to be on the latest hash." Killing the app worked because closing every
 * client is the other way a waiting worker activates (OBS-UPDATE-2).
 *
 * The three steps a real check needs, in order:
 *   1. `registration.update()` — ask the server whether the SW script changed.
 *      Without this a device that has not been nudged can sit on an old build
 *      indefinitely; the browser's own check is throttled.
 *   2. If that leaves a worker WAITING, post `SKIP_WAITING` so it activates.
 *      This is the step the old code skipped entirely.
 *   3. Reload only AFTER the new worker is in control, so the navigation is
 *      served by the new precache.
 *
 * Returns what happened so the caller can tell the user, rather than
 * reloading and leaving them to compare hashes.
 */
export type UpdateCheckOutcome = 'updated' | 'up-to-date' | 'unsupported';

export async function checkForUpdateAndApply(deps: {
  /** The boot registration (`whenServiceWorkerReady()`). */
  getRegistration: () => Promise<ServiceWorkerRegistration | null>;
  reload: () => void;
  /** Ceiling on waiting for an `installing` worker to finish installing.
   *  Generous: this is a real download, and the alternative to waiting is
   *  telling the user they are up to date while it lands. */
  installTimeoutMs?: number;
  /** Ceiling on the wait for `controllerchange`; past it we reload anyway,
   *  since `skipWaiting()` has already made the new worker active and a
   *  navigation is served by the ACTIVE worker even without a claim. */
  timeoutMs?: number;
  /** OBS-UPDATE-8 — the running build the waiting worker is compared against;
   *  defaults to `frontendBuild.gitSha`. */
  currentBuild?: string;
  /** OBS-UPDATE-8 — ceiling on the worker's GET_VERSION answer. */
  queryTimeoutMs?: number;
}): Promise<UpdateCheckOutcome> {
  const reg = await deps.getRegistration();
  if (!reg) return 'unsupported';
  try {
    await reg.update();
  } catch {
    // Offline or throttled. A worker may still be waiting from an earlier
    // check, so fall through rather than reporting up-to-date.
  }
  // OBS-UPDATE-6 — an INSTALLING worker is not "no update".
  //
  // `reg.update()` resolves once the update check + fetch have been kicked
  // off; the new worker can still be in `installing` at that moment, and
  // `reg.waiting` is only populated once installation FINISHES. Reading
  // `waiting` immediately therefore reports 'up-to-date' for the one case the
  // button exists to catch — a real update that happens to still be
  // installing — and the user is told they are current while a new build is
  // literally downloading. Reported 2026-08-01: "I go to update it knowing
  // there is a new version, it still says there's no update."
  //
  // So if something is installing, wait for it to settle. `installed` is the
  // state that fills `reg.waiting`; `activated` means it took over without
  // waiting (no previous controller) and `redundant` means the install failed
  // — both are terminal and neither should hang the button.
  const installing = reg.installing;
  if (installing && !reg.waiting) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const onState = () => {
        const st = installing.state;
        if (st === 'installed' || st === 'activated' || st === 'redundant') done();
      };
      try {
        installing.addEventListener('statechange', onState);
      } catch {
        /* no listener support — the timeout still resolves */
      }
      // Re-check synchronously: the state can have moved between the read
      // above and the listener attaching.
      onState();
      setTimeout(done, deps.installTimeoutMs ?? 10_000);
    });
  }

  const waiting = reg.waiting;
  if (!waiting) return 'up-to-date';

  // OBS-UPDATE-8 — the same comparison the banner makes: a rebuild of the
  // running build is not an update, and applying it would reload the user
  // into the version they already have. Left waiting, it activates on the
  // next cold start (OBS-UPDATE-2) with nothing to see.
  const waitingBuild = await queryWorkerBuild(waiting, deps.queryTimeoutMs);
  if (waitingBuild !== null && waitingBuild === (deps.currentBuild ?? frontendBuild.gitSha)) {
    return 'up-to-date';
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
    } catch {
      /* no controller support — the timeout below still resolves */
    }
    waiting.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(done, deps.timeoutMs ?? 3000);
  });

  deps.reload();
  return 'updated';
}
