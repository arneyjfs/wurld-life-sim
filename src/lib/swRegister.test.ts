// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `log` pulls in Sentry + the env-validated config; the repo convention is to
// stub it in lib unit tests (see clearNotifications.test.ts).
vi.mock('./log', () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }));

// OTA-13 — the runtime (web by default) and the one-time-cleanup flag in
// Capacitor Preferences (`wurld.ota.swUnregistered`), both mutable per test.
const rt = vi.hoisted(() => ({ native: false }));
vi.mock('./runtime', () => ({
  isNative: () => rt.native,
  getRuntime: () => (rt.native ? 'native-android' : 'browser'),
}));
const ota = vi.hoisted(() => ({
  flag: false,
  get: vi.fn(async () => ota.flag),
  set: vi.fn(async () => {
    ota.flag = true;
  }),
}));
vi.mock('./liveUpdate/state', () => ({
  getSwUnregistered: () => ota.get(),
  setSwUnregistered: () => ota.set(),
}));

/**
 * BOOT-SHELL-4/5 — service-worker registration ownership
 * (docs/specs/cold-boot.md §3c).
 *
 * Registration must be a BOOT concern, not a React one: gating it behind a
 * component mount means the shell isn't precached until the app has already
 * rendered, so the very first offline-capable boot is delayed by a whole
 * render+auth cycle. And there must be exactly ONE registration — a second
 * `register()` for the same script races the first.
 */

const SW_PATH = '/firebase-messaging-sw.js';

type Reg = {
  waiting: object | null;
  update: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
};

let register: ReturnType<typeof vi.fn>;
let reg: Reg;

async function load() {
  vi.resetModules();
  return import('./swRegister');
}

beforeEach(() => {
  reg = { waiting: null, update: vi.fn(async () => {}), addEventListener: vi.fn() };
  register = vi.fn(async () => reg);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register,
      controller: null,
      addEventListener: vi.fn(),
      getRegistration: vi.fn(async () => undefined),
    },
  });
  Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
  rt.native = false;
  ota.flag = false;
  ota.get.mockClear();
  ota.set.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BOOT-SHELL-4 — registration happens at boot, not from the React tree', () => {
  it('BOOT-SHELL-4 — registers the SW without any React render', async () => {
    const { registerServiceWorker } = await load();
    await registerServiceWorker();
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]?.[0]).toBe(SW_PATH);
  });

  it('BOOT-SHELL-4 — registers with updateViaCache "none" so update checks hit the network', async () => {
    const { registerServiceWorker } = await load();
    await registerServiceWorker();
    expect(register.mock.calls[0]?.[1]).toMatchObject({ updateViaCache: 'none' });
  });

  it('BOOT-SHELL-4 — defers to the load event when the document is still loading', async () => {
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });
    const { registerServiceWorker } = await load();
    const pending = registerServiceWorker();
    // Must NOT have registered yet — the install's precache fetches would
    // compete with first paint on a first visit.
    expect(register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('load'));
    await pending;
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('BOOT-SHELL-3 — asks for an update check once registered', async () => {
    const { registerServiceWorker } = await load();
    await registerServiceWorker();
    expect(reg.update).toHaveBeenCalled();
  });

  it('BOOT-SHELL-4 — a failed registration is swallowed, never thrown at boot', async () => {
    register.mockRejectedValue(new Error('nope'));
    const { registerServiceWorker, getServiceWorkerRegistration } = await load();
    await expect(registerServiceWorker()).resolves.toBeNull();
    expect(getServiceWorkerRegistration()).toBeNull();
  });

  it('BOOT-SHELL-11 — a rejected register() still surfaces the ALREADY-ACTIVE worker', async () => {
    // BOOT-SHELL-11 makes a shell-less install reject, which rejects
    // `register()` for that generation — but the PREVIOUS worker is still
    // installed and in control. Returning null there would cost the page its
    // handle on it, and with it the update prompt (UpdateAvailableToast) and
    // the push token's `serviceWorkerRegistration`, for no reason.
    register.mockRejectedValue(new TypeError('install failed'));
    const existing = { waiting: null, update: vi.fn(async () => {}), addEventListener: vi.fn() };
    (navigator.serviceWorker.getRegistration as ReturnType<typeof vi.fn>).mockResolvedValue(
      existing,
    );
    const { registerServiceWorker, getServiceWorkerRegistration } = await load();
    await expect(registerServiceWorker()).resolves.toBe(existing);
    expect(getServiceWorkerRegistration()).toBe(existing);
  });

  it('BOOT-SHELL-4 — no-ops gracefully where service workers are unavailable', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: undefined,
    });
    const { registerServiceWorker } = await load();
    await expect(registerServiceWorker()).resolves.toBeNull();
  });
});

describe('BOOT-SHELL-5 — exactly one registration', () => {
  it('BOOT-SHELL-5 — calling registerServiceWorker twice registers once', async () => {
    const { registerServiceWorker } = await load();
    await registerServiceWorker();
    await registerServiceWorker();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('BOOT-SHELL-5 — concurrent callers share one in-flight registration', async () => {
    const { registerServiceWorker } = await load();
    const [a, b] = await Promise.all([registerServiceWorker(), registerServiceWorker()]);
    expect(register).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it('BOOT-SHELL-5 — later consumers reuse the boot registration', async () => {
    const { registerServiceWorker, getServiceWorkerRegistration } = await load();
    await registerServiceWorker();
    // Push setup + the update toast both read this instead of registering again.
    expect(getServiceWorkerRegistration()).toBe(reg);
  });

  it('BOOT-SHELL-5 — whenServiceWorkerReady resolves with the boot registration', async () => {
    const { registerServiceWorker, whenServiceWorkerReady } = await load();
    const ready = whenServiceWorkerReady();
    await registerServiceWorker();
    await expect(ready).resolves.toBe(reg);
  });
});

/**
 * OTA-13 (docs/specs/live-updates.md) — a native shell never registers the
 * service worker, and the first OTA-capable build unregisters any existing one
 * and deletes its caches ONCE. Android's WebView supports workers on
 * `https://localhost` (Capacitor routes their fetches through the local
 * server), so without this the worker's precache would mask every bundle swap
 * for one launch and let a bundle that never ran call `notifyAppReady()`.
 */
describe('OTA-13 — no service worker in a native shell', () => {
  it('OTA-13 — registerServiceWorker() resolves null at once on native, without waiting for load', async () => {
    rt.native = true;
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'loading' });
    const { registerServiceWorker, getServiceWorkerRegistration } = await load();
    // No `load` event is ever dispatched here: on native the early return must
    // not sit behind the web path's deferral.
    await expect(registerServiceWorker()).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
    expect(getServiceWorkerRegistration()).toBeNull();
  });

  it('OTA-13 — whenServiceWorkerReady() resolves null on native (push setup never registers one either)', async () => {
    rt.native = true;
    const { whenServiceWorkerReady } = await load();
    await expect(whenServiceWorkerReady()).resolves.toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  describe('unregisterServiceWorkersOnce', () => {
    let unregisterA: ReturnType<typeof vi.fn>;
    let unregisterB: ReturnType<typeof vi.fn>;
    let getRegistrations: ReturnType<typeof vi.fn>;
    let cacheKeys: ReturnType<typeof vi.fn>;
    let cacheDelete: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      rt.native = true;
      unregisterA = vi.fn(async () => true);
      unregisterB = vi.fn(async () => true);
      getRegistrations = vi.fn(async () => [{ unregister: unregisterA }, { unregister: unregisterB }]);
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { register, getRegistrations, getRegistration: vi.fn(async () => undefined) },
      });
      cacheKeys = vi.fn(async () => ['wurld-precache-abc', 'wurld-runtime']);
      cacheDelete = vi.fn(async () => true);
      vi.stubGlobal('caches', { keys: cacheKeys, delete: cacheDelete });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('OTA-13 — unregisters every registration, deletes every cache, then sets the flag', async () => {
      const { unregisterServiceWorkersOnce } = await load();
      await expect(unregisterServiceWorkersOnce()).resolves.toBeUndefined();
      expect(getRegistrations).toHaveBeenCalledTimes(1);
      expect(unregisterA).toHaveBeenCalledTimes(1);
      expect(unregisterB).toHaveBeenCalledTimes(1);
      expect(cacheDelete.mock.calls.map((c) => c[0])).toEqual(['wurld-precache-abc', 'wurld-runtime']);
      expect(ota.set).toHaveBeenCalledTimes(1);
      expect(ota.flag).toBe(true);
    });

    it('OTA-13 — once the flag is set, later boots still sweep (a dying worker can recreate a cache) but do not re-record', async () => {
      // Seen on the emulator (§7 step 1): the worker the first pass
      // unregistered served the rest of that page's fetches and
      // `caches.open()` brought an empty `wurld-precache-*` back.
      ota.flag = true;
      const { unregisterServiceWorkersOnce } = await load();
      await unregisterServiceWorkersOnce();
      expect(getRegistrations).toHaveBeenCalledTimes(1);
      expect(cacheDelete.mock.calls.map((c) => c[0])).toEqual(['wurld-precache-abc', 'wurld-runtime']);
      expect(ota.set).not.toHaveBeenCalled();
    });

    it('OTA-13 — web: a no-op that leaves the registration and the flag alone', async () => {
      rt.native = false;
      const { unregisterServiceWorkersOnce } = await load();
      await unregisterServiceWorkersOnce();
      expect(getRegistrations).not.toHaveBeenCalled();
      expect(ota.get).not.toHaveBeenCalled();
      expect(ota.set).not.toHaveBeenCalled();
    });

    it('OTA-13 — iOS (no navigator.serviceWorker): resolves and records the cleanup as done', async () => {
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
      vi.stubGlobal('caches', undefined);
      const { unregisterServiceWorkersOnce } = await load();
      await expect(unregisterServiceWorkersOnce()).resolves.toBeUndefined();
      expect(ota.set).toHaveBeenCalledTimes(1);
    });

    it('OTA-13 — a failing unregister resolves (never throws into boot) and leaves the flag unset for a retry', async () => {
      getRegistrations.mockRejectedValue(new Error('SecurityError'));
      const { unregisterServiceWorkersOnce } = await load();
      await expect(unregisterServiceWorkersOnce()).resolves.toBeUndefined();
      expect(ota.set).not.toHaveBeenCalled();
    });

    it('OTA-13 — idempotent within a page: concurrent callers share one pass', async () => {
      const { unregisterServiceWorkersOnce } = await load();
      await Promise.all([unregisterServiceWorkersOnce(), unregisterServiceWorkersOnce()]);
      expect(getRegistrations).toHaveBeenCalledTimes(1);
      expect(ota.set).toHaveBeenCalledTimes(1);
    });
  });
});
