import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdateAndApply, decideUpdateBanner, queryWorkerBuild } from './swUpdate';

// OBS-UPDATE-4 — the "update available" banner fires IFF a new worker is
// waiting AND the page is controlled AND we haven't already prompted for the
// loaded build. Guards the two reported bugs: firing when no restart was
// needed, and re-firing on every reload for the same pending update.
describe('decideUpdateBanner (OBS-UPDATE-4)', () => {
  const base = {
    hasWaitingWorker: true,
    hasController: true,
    currentBuild: 'abc123',
    notifiedBuild: null as string | null,
    waitingBuild: null as string | null,
  };

  // OBS-UPDATE-8 — a rebuild of the running commit is a byte-different worker
  // (`__BUILD_TIME__` is compiled in), not a new version. Two beta deploys
  // from one sha produced a banner that "updated" to the identical version.
  it('OBS-UPDATE-8 — does NOT show when the waiting worker IS the running build (a same-commit rebuild)', () => {
    expect(decideUpdateBanner({ ...base, waitingBuild: 'abc123' })).toBe(false);
  });

  it('OBS-UPDATE-8 — shows when the waiting worker reports a different build', () => {
    expect(decideUpdateBanner({ ...base, waitingBuild: 'def456' })).toBe(true);
  });

  it('OBS-UPDATE-8 — a worker that did not answer counts as a different build (fail-open)', () => {
    // A worker built before the GET_VERSION handler existed cannot answer;
    // the pre-8 behaviour (prompt) is the right default for it.
    expect(decideUpdateBanner({ ...base, waitingBuild: null })).toBe(true);
  });

  it('shows when a new worker is waiting, the page is controlled, and this build is un-notified', () => {
    expect(decideUpdateBanner(base)).toBe(true);
  });

  it('does NOT show when no worker is waiting (nothing to restart into)', () => {
    expect(decideUpdateBanner({ ...base, hasWaitingWorker: false })).toBe(false);
  });

  it('does NOT show when the page is uncontrolled (first-ever install, not an update)', () => {
    expect(decideUpdateBanner({ ...base, hasController: false })).toBe(false);
  });

  it('does NOT re-show once we have notified for the current build (no per-reload spam)', () => {
    expect(decideUpdateBanner({ ...base, notifiedBuild: 'abc123' })).toBe(false);
  });

  it('shows again after the app actually updates (loaded build changed since we last notified)', () => {
    // We notified while on the old build; the page is now the new build with a
    // further update waiting → the per-build marker no longer matches → show.
    expect(decideUpdateBanner({ ...base, currentBuild: 'def456', notifiedBuild: 'abc123' })).toBe(
      true,
    );
  });
});

describe('OBS-UPDATE-5 — checkForUpdateAndApply', () => {
  // REPORTED (2026-07-30): "I can manually hit check for updates, which
  // reloads, but I still need to kill the app to get it to be on the latest
  // hash." The row was `location.reload()` — no server check, no SKIP_WAITING
  // — so it reloaded into the same build off the old worker's precache.

  const makeWorker = () => ({ postMessage: vi.fn() });
  const reg = (waiting: unknown, update = vi.fn().mockResolvedValue(undefined)) =>
    ({ waiting, update }) as unknown as ServiceWorkerRegistration;

  beforeEach(() => {
    // controllerchange never fires in jsdom; the timeout path resolves.
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      serviceWorker: { addEventListener: vi.fn() },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('OBS-UPDATE-5 — ASKS THE SERVER, not just the local registration', () => {
    // The step the old code skipped that let a device sit on an old build: the
    // browser's own update check is throttled, so without this an untouched
    // install may never learn a deploy happened.
    const update = vi.fn().mockResolvedValue(undefined);
    const r = reg(null, update);
    return checkForUpdateAndApply({
      getRegistration: async () => r,
      reload: vi.fn(),
    }).then((outcome) => {
      expect(update).toHaveBeenCalledTimes(1);
      expect(outcome).toBe('up-to-date');
    });
  });

  it('OBS-UPDATE-5 — a WAITING worker is told to skip waiting, then we reload', async () => {
    const waiting = makeWorker();
    const reload = vi.fn();
    const outcome = await checkForUpdateAndApply({
      getRegistration: async () => reg(waiting),
      reload,
      timeoutMs: 0,
      queryTimeoutMs: 0,
    });
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('updated');
  });

  it('OBS-UPDATE-5 — nothing waiting → NO reload, and it says so', async () => {
    // Reloading here is what made the old button feel broken: it threw the
    // user's place away to land on the identical build.
    const reload = vi.fn();
    const outcome = await checkForUpdateAndApply({
      getRegistration: async () => reg(null),
      reload,
    });
    expect(reload).not.toHaveBeenCalled();
    expect(outcome).toBe('up-to-date');
  });

  it('OBS-UPDATE-5 — an OFFLINE check still applies a worker waiting from before', async () => {
    // update() rejecting must not be read as "up to date" — a worker
    // installed on an earlier check is still there and still applicable.
    const waiting = makeWorker();
    const update = vi.fn().mockRejectedValue(new Error('offline'));
    const reload = vi.fn();
    const outcome = await checkForUpdateAndApply({
      getRegistration: async () => reg(waiting, update),
      reload,
      timeoutMs: 0,
      queryTimeoutMs: 0,
    });
    expect(outcome).toBe('updated');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // OBS-UPDATE-8 — the same comparison the banner makes: "Check for updates"
  // must not reload the user into the build they are already running.
  describe('OBS-UPDATE-8 — a waiting worker of the running build', () => {
    const answering = (sha: string) => ({
      postMessage: vi.fn((msg: { type?: string }, transfer?: Transferable[]) => {
        if (msg?.type === 'GET_VERSION') {
          (transfer?.[0] as MessagePort | undefined)?.postMessage({ type: 'VERSION', version: 'x', gitSha: sha });
        }
      }),
    });

    it('reports up-to-date, posts no SKIP_WAITING and does not reload', async () => {
      const waiting = answering('abc123');
      const reload = vi.fn();
      const outcome = await checkForUpdateAndApply({
        getRegistration: async () => reg(waiting),
        reload,
        currentBuild: 'abc123',
        timeoutMs: 0,
      });
      expect(outcome).toBe('up-to-date');
      expect(waiting.postMessage).not.toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
      expect(reload).not.toHaveBeenCalled();
    });

    it('still applies a worker of a DIFFERENT build', async () => {
      const waiting = answering('def456');
      const reload = vi.fn();
      const outcome = await checkForUpdateAndApply({
        getRegistration: async () => reg(waiting),
        reload,
        currentBuild: 'abc123',
        timeoutMs: 0,
      });
      expect(outcome).toBe('updated');
      expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('still applies a worker that does not answer (fail-open, an older worker)', async () => {
      const waiting = makeWorker();
      const outcome = await checkForUpdateAndApply({
        getRegistration: async () => reg(waiting),
        reload: vi.fn(),
        currentBuild: 'abc123',
        timeoutMs: 0,
        queryTimeoutMs: 0,
      });
      expect(outcome).toBe('updated');
    });
  });

  it('OBS-UPDATE-5 — no service worker at all is reported, not silently reloaded', async () => {
    const reload = vi.fn();
    const outcome = await checkForUpdateAndApply({
      getRegistration: async () => null,
      reload,
    });
    expect(outcome).toBe('unsupported');
    expect(reload).not.toHaveBeenCalled();
  });
});


/**
 * OBS-UPDATE-6 — an INSTALLING worker is not "no update".
 *
 * `reg.update()` resolves once the check + fetch are under way; the new worker
 * can still be installing at that moment, and `reg.waiting` only fills once
 * installation FINISHES. Reading `waiting` immediately therefore reported
 * up-to-date for the one case the button exists to catch, while a new build
 * was literally downloading.
 */
describe('OBS-UPDATE-6 — waits out an installing worker', () => {
  type Listener = () => void;
  const makeWorker = (state: ServiceWorker['state']) => {
    const listeners: Listener[] = [];
    const w = {
      state,
      postMessage: vi.fn(),
      addEventListener: (_t: string, fn: Listener) => listeners.push(fn),
      /** Drive the state machine the way the browser would. */
      settle(next: ServiceWorker['state']) {
        w.state = next;
        listeners.forEach((fn) => fn());
      },
    };
    return w as unknown as ServiceWorker & { settle: (s: ServiceWorker['state']) => void };
  };

  it('reports up-to-date only AFTER the installing worker settles with nothing waiting', async () => {
    const installing = makeWorker('installing');
    const reg = {
      update: vi.fn(async () => {}),
      installing,
      waiting: null,
    } as unknown as ServiceWorkerRegistration;
    const p = checkForUpdateAndApply({
      getRegistration: async () => reg,
      reload: vi.fn(),
      installTimeoutMs: 50,
    });
    // A failed install is terminal and must not hang the button.
    installing.settle('redundant');
    await expect(p).resolves.toBe('up-to-date');
  });

  it('does not wait at all when a worker is ALREADY waiting', async () => {
    // The pre-existing path: nothing installing, so no delay is introduced.
    const waiting = makeWorker('installed');
    const reload = vi.fn();
    const reg = {
      update: vi.fn(async () => {}),
      installing: null,
      waiting,
    } as unknown as ServiceWorkerRegistration;
    const outcome = await checkForUpdateAndApply({
      getRegistration: async () => reg,
      reload,
      timeoutMs: 10,
      queryTimeoutMs: 0,
    });
    expect(outcome).toBe('updated');
    expect(reload).toHaveBeenCalled();
  });
});

/**
 * OBS-UPDATE-8 — asking a worker which build it is. The page cannot read a
 * worker's build from the registration, and a rebuild of the same commit is
 * a byte-different script, so it asks: `GET_VERSION` over a MessageChannel
 * port, answered by the shipped worker's `message` handler
 * (serviceWorker.version.test.ts executes that handler against the real file).
 */
describe('OBS-UPDATE-8 — queryWorkerBuild', () => {
  const answering = (reply: unknown) => ({
    postMessage: vi.fn((_msg: unknown, transfer?: Transferable[]) => {
      (transfer?.[0] as MessagePort | undefined)?.postMessage(reply);
    }),
  });

  it('asks GET_VERSION over a transferred port and resolves the git SHA', async () => {
    const w = answering({ type: 'VERSION', version: '0.3.1-beta.def456', gitSha: 'def456' });
    await expect(queryWorkerBuild(w)).resolves.toBe('def456');
    expect(w.postMessage).toHaveBeenCalledWith({ type: 'GET_VERSION' }, [expect.any(Object)]);
  });

  it('resolves null after the timeout when the worker never answers (built before the handler)', async () => {
    await expect(queryWorkerBuild({ postMessage: vi.fn() }, 20)).resolves.toBeNull();
  });

  it('resolves null for a malformed reply, a throwing worker, or no worker at all', async () => {
    await expect(queryWorkerBuild(answering({ type: 'VERSION' }), 20)).resolves.toBeNull();
    await expect(
      queryWorkerBuild({ postMessage: vi.fn(() => { throw new Error('worker gone'); }) }, 20),
    ).resolves.toBeNull();
    await expect(queryWorkerBuild(null)).resolves.toBeNull();
  });
});
