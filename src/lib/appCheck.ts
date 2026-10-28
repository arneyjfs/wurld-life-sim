import type { FirebaseApp } from 'firebase/app';
import type { AppCheck } from 'firebase/app-check';
import { config, type AppCheckProviderKind } from './config';
import * as log from './log';

/**
 * Firebase App Check — client attestation.
 *
 * Spec: `docs/specs/app-check.md` (APPCHECK-1..5). Cross-ref `cold-boot.md`
 * BOOT-INIT-* — this runs inside the Firebase boot sequence.
 *
 * ── The one property that matters ────────────────────────────────────────
 * With no reCAPTCHA site key configured — which is EVERY build today, because
 * creating a key needs the Firebase console — this module does nothing. It
 * does not import the App Check SDK, does not construct a provider, does not
 * call `initializeAppCheck`, and hands back no headers. That inertness is
 * key-driven, not flag-driven (APPCHECK-1): there is no second switch that can
 * fall out of sync with the key's presence.
 *
 * ── Why a dynamic import ────────────────────────────────────────────────
 * A static `import 'firebase/app-check'` would register the App Check
 * component with the Firebase app container on every boot and ship the
 * reCAPTCHA plumbing to every user, to do nothing. Importing it only on the
 * key-present path means the shipped configuration never even fetches the
 * chunk — a stronger form of "inert" than "we don't call the function" — and
 * it makes `initAppCheck` naturally non-blocking (APPCHECK-4), which is a hard
 * requirement: a cold start on EDGE must not wait on attestation, and a throw
 * here must never reject the boot path.
 */

export type { AppCheckProviderKind };

/** The header Firebase's backends (and our Cloud Functions) read the token from. */
export const APP_CHECK_HEADER = 'X-Firebase-AppCheck';

export interface AppCheckInput {
  siteKey: string | undefined;
  provider: AppCheckProviderKind;
  useEmulators: boolean;
  e2eTest: boolean;
  hasWindow: boolean;
}

export type AppCheckDecision =
  | {
      init: false;
      reason: 'no-site-key' | 'emulator-harness' | 'e2e-build' | 'no-window';
    }
  | { init: true; siteKey: string; provider: AppCheckProviderKind };

/**
 * APPCHECK-1/2/3/4 — the whole "should App Check run?" question as one pure
 * function, so the answer is a table in a test rather than a set of `if`s
 * spread through a side-effecting init.
 *
 * Order is deliberate:
 *   1. `no-window`  — a non-browser host (SSR, a node import of this module)
 *                     cannot run reCAPTCHA at all.
 *   2. `no-site-key`— the normal, shipped case.
 *   3. harness flags— a key that leaks into an emulator / E2E build must NOT
 *                     turn into a token demand: reCAPTCHA cannot attest a
 *                     headless browser and the Emulator Suite has no App Check
 *                     backend, so the harness would fail for a reason that has
 *                     nothing to do with the code under test.
 */
export function decideAppCheck(input: AppCheckInput): AppCheckDecision {
  if (!input.hasWindow) return { init: false, reason: 'no-window' };
  const siteKey = input.siteKey?.trim();
  if (!siteKey) return { init: false, reason: 'no-site-key' };
  if (input.useEmulators) return { init: false, reason: 'emulator-harness' };
  if (input.e2eTest) return { init: false, reason: 'e2e-build' };
  return { init: true, siteKey, provider: input.provider };
}

let started = false;
let instance: AppCheck | null = null;
/** Captured from the dynamically-imported SDK alongside the instance, so the
 *  token path never has to re-enter the import machinery. Non-null iff
 *  `instance` is. */
let fetchToken: ((appCheck: AppCheck) => Promise<{ token: string }>) | null = null;
/** Resolves when the init attempt has settled (successfully or not). `null`
 *  while inert, which is what lets `appCheckHeaders()` return synchronously
 *  fast in the shipped configuration. */
let ready: Promise<void> | null = null;
/** What `initAppCheck` decided, for diagnostics. Recorded rather than logged —
 *  see the comment in `initAppCheck`. */
let lastDecision: AppCheckDecision | null = null;

/** Why App Check is (or isn't) running. `null` before `initAppCheck` has been
 *  called. Read it from a console/dev surface when a configured site key
 *  appears not to take effect. */
export function appCheckStatus(): AppCheckDecision | null {
  return lastDecision;
}

/**
 * APPCHECK-4 — kick off App Check. Returns `void`, **synchronously**, always.
 *
 * Called from `firebase.ts` immediately after `initializeApp`. It is never
 * awaited and can never throw: any failure is caught, logged and swallowed,
 * because a broken site key must cost attestation, not the app.
 */
export function initAppCheck(app: FirebaseApp): void {
  if (started) return;
  started = true;

  const decision = decideAppCheck({
    siteKey: config.appCheckSiteKey,
    provider: config.appCheckProvider,
    useEmulators: config.useEmulators,
    e2eTest: config.e2eTest,
    hasWindow: typeof window !== 'undefined',
  });

  lastDecision = decision;

  if (!decision.init) {
    // Deliberately SILENT.
    //
    // 1. There is nothing to report: with no site key this is the expected,
    //    healthy, every-boot state, and OBS-4 keeps breadcrumbs for decision
    //    points, not for non-events.
    // 2. It would CRASH. `initAppCheck` runs during `firebase.ts`'s module
    //    evaluation, and `log.ts` sits on a cycle (log → analytics →
    //    firebase → appCheck → log). Calling it here dereferences a
    //    half-initialised module: "Cannot access '__vite_ssr_import__' before
    //    initialization", which takes out every module that transitively
    //    imports firebase.ts. The logs in `load()` below are safe because
    //    they run after `await import(...)`, i.e. off the synchronous
    //    module-init path. Do not "helpfully" add a log line here.
    return;
  }

  ready = load(app, decision.siteKey, decision.provider);
}

async function load(
  app: FirebaseApp,
  siteKey: string,
  provider: AppCheckProviderKind,
): Promise<void> {
  try {
    const sdk = await import('firebase/app-check');
    instance = sdk.initializeAppCheck(app, {
      provider:
        provider === 'v3'
          ? new sdk.ReCaptchaV3Provider(siteKey)
          : new sdk.ReCaptchaEnterpriseProvider(siteKey),
      // Keep a fresh token in the background so a send never pays for a
      // round-trip to reCAPTCHA on the critical path.
      isTokenAutoRefreshEnabled: true,
    });
    fetchToken = (appCheck) => sdk.getToken(appCheck, /* forceRefresh */ false);
    log.info('[appcheck] initialised', { provider });
  } catch (err) {
    // Chunk-load failure, an invalid site key, a provider the browser can't
    // run — all land here. APPCHECK-4: the boot path does not care.
    instance = null;
    fetchToken = null;
    log.error(err, { action: 'appCheck', stage: 'init', provider }); // OBS-COVER-6
  }
}

/**
 * APPCHECK-5 — headers to merge into an outbound Cloud Function request.
 *
 * Fail-open by contract: `{}` when App Check is inert, when init failed, or
 * when the token fetch rejects (offline, reCAPTCHA blocked by an extension,
 * quota). Never throws. A client cannot tell a blocked legitimate user from an
 * attacker, so it always sends what it has and lets exactly one place — the
 * server's `APP_CHECK_ENFORCEMENT` — decide what an unattested request is
 * worth.
 *
 * ⚠ NOT YET WIRED. The call site is `callHttp` in `src/lib/endpoints.ts`, the
 * single funnel for every Cloud Function request; see `docs/specs/app-check.md`
 * §1 "Not yet wired".
 */
let tokenFailureReported = false;

export async function appCheckHeaders(): Promise<Record<string, string>> {
  if (ready) await ready;
  if (!instance || !fetchToken) return {};
  try {
    const { token } = await fetchToken(instance);
    if (!token) return {};
    return { [APP_CHECK_HEADER]: token };
  } catch (err) {
    log.warn('[appcheck] token fetch failed; sending unattested', { err });
    // OBS-COVER-6 — one event per session, not one per outbound request.
    if (!tokenFailureReported) {
      tokenFailureReported = true;
      log.error(err, { action: 'appCheck', stage: 'token' });
    }
    return {};
  }
}
