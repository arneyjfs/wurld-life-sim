// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseApp } from 'firebase/app';

/**
 * docs/specs/app-check.md — APPCHECK-1..5.
 *
 * The load-bearing test in this file is the FIRST one. App Check ships with no
 * reCAPTCHA site key anywhere in the repo, so "does nothing without a key" is
 * not a nice-to-have property — it is the only reason this code is safe to
 * merge. If `initAppCheck` ever runs unconditionally, `APPCHECK-1` must go red.
 */

const mocks = vi.hoisted(() => ({
  initializeAppCheck: vi.fn(),
  ReCaptchaEnterpriseProvider: vi.fn(),
  ReCaptchaV3Provider: vi.fn(),
  getToken: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  config: {
    appCheckSiteKey: undefined as string | undefined,
    appCheckProvider: 'enterprise' as 'enterprise' | 'v3',
    useEmulators: false,
    e2eTest: false,
  },
}));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: mocks.initializeAppCheck,
  ReCaptchaEnterpriseProvider: mocks.ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider: mocks.ReCaptchaV3Provider,
  getToken: mocks.getToken,
}));

vi.mock('./config', () => ({ config: mocks.config }));

vi.mock('./log', () => ({
  info: mocks.logInfo,
  warn: mocks.logWarn,
  error: mocks.logError,
}));

const APP = {} as FirebaseApp;

/** Lets every pending microtask (incl. a dynamic import) settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function loadModule() {
  vi.resetModules();
  return import('./appCheck');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.appCheckSiteKey = undefined;
  mocks.config.appCheckProvider = 'enterprise';
  mocks.config.useEmulators = false;
  mocks.config.e2eTest = false;
  mocks.initializeAppCheck.mockReturnValue({ kind: 'app-check-instance' });
  mocks.getToken.mockResolvedValue({ token: 'attestation-token' });
});

describe('appCheck — client', () => {
  // ── APPCHECK-1: inert without a key ──────────────────────────────────
  it('APPCHECK-1 — with no site key, initAppCheck initialises nothing', async () => {
    const { initAppCheck } = await loadModule();

    initAppCheck(APP);
    await settle();

    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
    expect(mocks.ReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
    expect(mocks.ReCaptchaV3Provider).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it('APPCHECK-1 — with no site key, appCheckHeaders resolves to no headers', async () => {
    const { initAppCheck, appCheckHeaders } = await loadModule();

    initAppCheck(APP);
    await settle();

    await expect(appCheckHeaders()).resolves.toEqual({});
  });

  it('APPCHECK-1 — appCheckHeaders is safe before initAppCheck has ever been called', async () => {
    const { appCheckHeaders } = await loadModule();

    await expect(appCheckHeaders()).resolves.toEqual({});
  });

  it('APPCHECK-4 — the inert path logs NOTHING synchronously (log.ts is on an import cycle)', async () => {
    // Regression guard. `initAppCheck` runs during `firebase.ts`'s module
    // evaluation, and `lib/log.ts` sits on the cycle
    // log → analytics → firebase → appCheck → log. A log call here
    // dereferences a half-initialised module and takes out every test file
    // that transitively imports firebase.ts (73 of them, observed).
    const { initAppCheck } = await loadModule();

    initAppCheck(APP);

    expect(mocks.logInfo).not.toHaveBeenCalled();
    expect(mocks.logWarn).not.toHaveBeenCalled();
  });

  it('APPCHECK-1 — the inert reason is recorded for diagnostics instead', async () => {
    const { initAppCheck, appCheckStatus } = await loadModule();

    initAppCheck(APP);

    expect(appCheckStatus()).toEqual({ init: false, reason: 'no-site-key' });
  });

  // ── APPCHECK-2: the harnesses opt out even WITH a key ────────────────
  it('APPCHECK-2 — VITE_USE_EMULATORS=true ignores a configured site key', async () => {
    mocks.config.appCheckSiteKey = 'site-key';
    mocks.config.useEmulators = true;
    const { initAppCheck, appCheckHeaders } = await loadModule();

    initAppCheck(APP);
    await settle();

    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
    await expect(appCheckHeaders()).resolves.toEqual({});
  });

  it('APPCHECK-2 — VITE_E2E_TEST=true ignores a configured site key', async () => {
    mocks.config.appCheckSiteKey = 'site-key';
    mocks.config.e2eTest = true;
    const { initAppCheck, appCheckHeaders } = await loadModule();

    initAppCheck(APP);
    await settle();

    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
    await expect(appCheckHeaders()).resolves.toEqual({});
  });

  // ── APPCHECK-3: with a key, it initialises ───────────────────────────
  it('APPCHECK-3 — with a site key, initialises once with the enterprise provider and auto-refresh', async () => {
    mocks.config.appCheckSiteKey = 'site-key';
    const { initAppCheck } = await loadModule();

    initAppCheck(APP);
    await settle();

    expect(mocks.ReCaptchaEnterpriseProvider).toHaveBeenCalledWith('site-key');
    expect(mocks.ReCaptchaV3Provider).not.toHaveBeenCalled();
    expect(mocks.initializeAppCheck).toHaveBeenCalledTimes(1);
    expect(mocks.initializeAppCheck).toHaveBeenCalledWith(
      APP,
      expect.objectContaining({ isTokenAutoRefreshEnabled: true }),
    );
  });

  it('APPCHECK-3 — provider=v3 uses the reCAPTCHA v3 provider', async () => {
    mocks.config.appCheckSiteKey = 'site-key';
    mocks.config.appCheckProvider = 'v3';
    const { initAppCheck } = await loadModule();

    initAppCheck(APP);
    await settle();

    expect(mocks.ReCaptchaV3Provider).toHaveBeenCalledWith('site-key');
    expect(mocks.ReCaptchaEnterpriseProvider).not.toHaveBeenCalled();
    expect(mocks.initializeAppCheck).toHaveBeenCalledTimes(1);
  });

  it('APPCHECK-3 — a repeated initAppCheck call does not re-initialise', async () => {
    mocks.config.appCheckSiteKey = 'site-key';
    const { initAppCheck } = await loadModule();

    initAppCheck(APP);
    initAppCheck(APP);
    await settle();
    initAppCheck(APP);
    await settle();

    expect(mocks.initializeAppCheck).toHaveBeenCalledTimes(1);
  });

  // ── APPCHECK-4: non-blocking, never fails the boot path ──────────────
  it('APPCHECK-4 — initAppCheck returns void synchronously', async () => {
    mocks.config.appCheckSiteKey = 'site-key';
    const { initAppCheck } = await loadModule();

    expect(initAppCheck(APP)).toBeUndefined();
    // Nothing has touched the SDK yet — the import has not resolved.
    expect(mocks.initializeAppCheck).not.toHaveBeenCalled();
    await settle();
  });

  it('APPCHECK-4 — an SDK that throws does not fail the boot path', async () => {
    mocks.config.appCheckSiteKey = 'site-key';
    mocks.initializeAppCheck.mockImplementation(() => {
      throw new Error('reCAPTCHA site key is invalid');
    });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { initAppCheck, appCheckHeaders } = await loadModule();

    expect(() => initAppCheck(APP)).not.toThrow();
    await settle();
    process.off('unhandledRejection', unhandled);

    expect(unhandled).not.toHaveBeenCalled();
    // OBS-COVER-6 — the init failure is an event, with the original error.
    expect(mocks.logError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'reCAPTCHA site key is invalid' }),
      expect.objectContaining({ action: 'appCheck', stage: 'init' }),
    );
    // And the app keeps working: fail-open, no token.
    await expect(appCheckHeaders()).resolves.toEqual({});
  });

  // ── APPCHECK-5: fail-open token attach ───────────────────────────────
  it('APPCHECK-5 — appCheckHeaders returns the attestation header once initialised', async () => {
    mocks.config.appCheckSiteKey = 'site-key';
    const { initAppCheck, appCheckHeaders } = await loadModule();

    initAppCheck(APP);
    await settle();

    await expect(appCheckHeaders()).resolves.toEqual({
      'X-Firebase-AppCheck': 'attestation-token',
    });
  });

  it('APPCHECK-5 — appCheckHeaders awaits an in-flight init rather than missing the token', async () => {
    mocks.config.appCheckSiteKey = 'site-key';
    const { initAppCheck, appCheckHeaders } = await loadModule();

    initAppCheck(APP);
    // No settle() — the dynamic import is still in flight.
    await expect(appCheckHeaders()).resolves.toEqual({
      'X-Firebase-AppCheck': 'attestation-token',
    });
  });

  it('APPCHECK-5 — appCheckHeaders returns no headers when getToken rejects', async () => {
    mocks.config.appCheckSiteKey = 'site-key';
    mocks.getToken.mockRejectedValue(new Error('app-check/fetch-network-error'));
    const { initAppCheck, appCheckHeaders } = await loadModule();

    initAppCheck(APP);
    await settle();

    await expect(appCheckHeaders()).resolves.toEqual({});
    // OBS-COVER-6 — reported once per session; every request would otherwise
    // file an event while reCAPTCHA is blocked.
    await expect(appCheckHeaders()).resolves.toEqual({});
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    expect(mocks.logError.mock.calls[0]?.[1]).toMatchObject({ action: 'appCheck', stage: 'token' });
    expect(mocks.logWarn).toHaveBeenCalled();
  });

  it('APPCHECK-5 — appCheckHeaders returns no headers when getToken yields an empty token', async () => {
    mocks.config.appCheckSiteKey = 'site-key';
    mocks.getToken.mockResolvedValue({ token: '' });
    const { initAppCheck, appCheckHeaders } = await loadModule();

    initAppCheck(APP);
    await settle();

    await expect(appCheckHeaders()).resolves.toEqual({});
  });
});

describe('appCheck — module shape', () => {
  // A source-level guard, in the style of src/lib/__tests__/*.static.test.ts.
  //
  // "Never calls initializeAppCheck" is asserted above at runtime. This asserts
  // the strictly stronger bundle property APPCHECK-1/4 claims: with no site key
  // the SDK is not even FETCHED. That cannot be observed through a vi.mock —
  // the mock resolves from the registry whether or not the real chunk would
  // have loaded — so the shape of the import is what gets checked. Swap the
  // dynamic `await import()` for a top-level value import and this goes red.
  const SRC = readFileSync(join(__dirname, 'appCheck.ts'), 'utf8');

  it('APPCHECK-1 — firebase/app-check is imported dynamically, on the key-present path only', () => {
    expect(SRC).toContain("await import('firebase/app-check')");
  });

  it('APPCHECK-1 — firebase/app-check has no top-level VALUE import', () => {
    const topLevel = SRC.split('\n').filter(
      (line) =>
        /^import\b/.test(line) &&
        line.includes('firebase/app-check') &&
        !/^import\s+type\b/.test(line),
    );
    expect(topLevel).toEqual([]);
  });
});

describe('decideAppCheck — the pure decision', () => {
  const base = {
    siteKey: 'site-key',
    provider: 'enterprise' as const,
    useEmulators: false,
    e2eTest: false,
    hasWindow: true,
  };

  it('APPCHECK-1 — an absent site key is the inert case', async () => {
    const { decideAppCheck } = await loadModule();
    expect(decideAppCheck({ ...base, siteKey: undefined })).toEqual({
      init: false,
      reason: 'no-site-key',
    });
  });

  it('APPCHECK-1 — a blank/whitespace site key counts as absent', async () => {
    const { decideAppCheck } = await loadModule();
    expect(decideAppCheck({ ...base, siteKey: '   ' })).toEqual({
      init: false,
      reason: 'no-site-key',
    });
  });

  it('APPCHECK-2 — the emulator harness opts out', async () => {
    const { decideAppCheck } = await loadModule();
    expect(decideAppCheck({ ...base, useEmulators: true })).toEqual({
      init: false,
      reason: 'emulator-harness',
    });
  });

  it('APPCHECK-2 — an E2E build opts out', async () => {
    const { decideAppCheck } = await loadModule();
    expect(decideAppCheck({ ...base, e2eTest: true })).toEqual({
      init: false,
      reason: 'e2e-build',
    });
  });

  it('APPCHECK-4 — a non-browser host opts out', async () => {
    const { decideAppCheck } = await loadModule();
    expect(decideAppCheck({ ...base, hasWindow: false })).toEqual({
      init: false,
      reason: 'no-window',
    });
  });

  it('APPCHECK-3 — a key plus a browser initialises with the named provider', async () => {
    const { decideAppCheck } = await loadModule();
    expect(decideAppCheck(base)).toEqual({
      init: true,
      siteKey: 'site-key',
      provider: 'enterprise',
    });
    expect(decideAppCheck({ ...base, provider: 'v3' })).toEqual({
      init: true,
      siteKey: 'site-key',
      provider: 'v3',
    });
  });

  it('APPCHECK-3 — the site key is trimmed before use', async () => {
    const { decideAppCheck } = await loadModule();
    expect(decideAppCheck({ ...base, siteKey: '  padded-key  ' })).toEqual({
      init: true,
      siteKey: 'padded-key',
      provider: 'enterprise',
    });
  });
});
