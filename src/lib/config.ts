/**
 * Typed, validated env config. The ONLY place `import.meta.env.VITE_*` is read.
 * Validated at module load; throws on missing required vars so a misconfigured
 * build crashes loud and early rather than silently producing a broken bundle.
 */

export type AppEnv = 'dev' | 'beta' | 'prod';

type RawEnv = Record<string, string | undefined>;

function read(env: RawEnv, key: string): string | undefined {
  const v = env[key];
  return v && v.length > 0 ? v : undefined;
}

function required(env: RawEnv, key: string): string {
  const v = read(env, key);
  if (!v) throw new Error(`[config] missing required env var ${key}`);
  return v;
}

function parseEnv(value: string | undefined): AppEnv {
  if (value === 'beta' || value === 'prod') return value;
  return 'dev';
}

/** Which reCAPTCHA flavour the App Check site key belongs to. See
 *  `docs/specs/app-check.md` APPCHECK-3 — the kind is NOT inferable from the
 *  key string, and guessing wrong yields a client that cannot attest at all. */
export type AppCheckProviderKind = 'enterprise' | 'v3';

function parseAppCheckProvider(value: string | undefined): AppCheckProviderKind {
  // Default to Enterprise: that's the flavour the Firebase console steers you
  // to when registering a web app for App Check today. `v3` is the opt-out for
  // a legacy reCAPTCHA v3 key.
  return value === 'v3' ? 'v3' : 'enterprise';
}

export interface AppConfig {
  env: AppEnv;
  firebase: {
    apiKey: string;
    authDomain: string;
    storageBucket: string;
    projectId: string;
    messagingSenderId: string;
    appId: string;
    measurementId: string | undefined;
  };
  functionsUrl: string;
  /** `VITE_FUNCTIONS_URL` as configured: the upstream the dev proxy forwards
   *  to, so it names the real deployment even when `functionsUrl` is the
   *  proxy path. BILL-MANAGE-3.3 reads the Stripe mode from it. */
  functionsTargetUrl: string;
  fcmVapidKey: string | undefined;
  sentryDsn: string | undefined;
  /** reCAPTCHA site key for Firebase App Check (`docs/specs/app-check.md`).
   *
   *  **OPTIONAL, and absent is the normal case.** Deliberately read via
   *  `read()` and NOT `required()`: no key exists yet (creating one needs the
   *  Firebase console), and `required()` would throw at module load and brick
   *  every build. The key IS the on-switch — APPCHECK-1 — so there is no
   *  separate flag that can disagree with it. Public, like `apiKey` and the
   *  Sentry DSN: it ships in the client bundle by design. */
  appCheckSiteKey: string | undefined;
  /** Which reCAPTCHA flavour `appCheckSiteKey` is. Ignored entirely when the
   *  key is absent. APPCHECK-3. */
  appCheckProvider: AppCheckProviderKind;
  /** When true, expose window.__testSignIn / __testSignOut for Playwright
   *  E2E tests. Source had EXPO_PUBLIC_E2E_TEST; ours uses VITE_E2E_TEST.
   *  Defaults to false; must be opted-in by the dev-server invocation. */
  e2eTest: boolean;
  /** When true, the client SDK connects to the local Firebase Emulator Suite
   *  (Auth + Firestore) instead of the real backend — used by the emulator
   *  E2E harness to remove real-Firestore WebChannel congestion (the live-tail
   *  churn flakiness). Gated entirely behind `VITE_USE_EMULATORS=true`, so it's
   *  inert in every prod/beta/normal-dev build. Gemini stays REAL: only the
   *  data substrate is emulated; the emulated Cloud Functions still call the
   *  real Gemini API at critical gates. */
  useEmulators: boolean;
}

function buildConfig(env: RawEnv): AppConfig {
  // In Vite dev mode we route onRequest function calls through a
  // server-side proxy at `/__functions/*` (see vite.config.ts) so
  // they're same-origin from the browser's POV. This avoids the CORS
  // wall the Cloud Functions throw when the app is loaded from a LAN
  // IP for on-device testing (e.g. http://192.168.x.y:5174 on iPhone).
  // The env var still has to be set so the Vite proxy knows its target.
  // In prod/beta builds we hit the real URL directly.
  //
  // The proxy path is built as a FULLY-QUALIFIED URL against
  // window.location.origin rather than left relative — iOS WebView
  // occasionally errors with "bad URL" on relative-URL fetches in
  // certain worker / SDK contexts. An absolute URL removes the
  // ambiguity without changing what the proxy does.
  const rawFunctionsUrl = required(env, 'VITE_FUNCTIONS_URL');
  const isViteDev =
    typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;
  const proxyFunctionsUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/__functions`
      : '/__functions';
  return {
    env: parseEnv(read(env, 'VITE_ENV')),
    firebase: {
      apiKey: required(env, 'VITE_FIREBASE_API_KEY'),
      authDomain: required(env, 'VITE_FIREBASE_AUTH_DOMAIN'),
      projectId: required(env, 'VITE_FIREBASE_PROJECT_ID'),
      storageBucket: required(env, 'VITE_FIREBASE_STORAGE_BUCKET'),
      messagingSenderId: required(env, 'VITE_FIREBASE_MESSAGING_SENDER_ID'),
      appId: required(env, 'VITE_FIREBASE_APP_ID'),
      measurementId: read(env, 'VITE_FIREBASE_MEASUREMENT_ID'),
    },
    functionsUrl: isViteDev ? proxyFunctionsUrl : rawFunctionsUrl,
    functionsTargetUrl: rawFunctionsUrl,
    fcmVapidKey: read(env, 'VITE_FCM_VAPID_KEY'),
    sentryDsn: read(env, 'VITE_SENTRY_DSN'),
    appCheckSiteKey: read(env, 'VITE_FIREBASE_APPCHECK_SITE_KEY'),
    appCheckProvider: parseAppCheckProvider(
      read(env, 'VITE_FIREBASE_APPCHECK_PROVIDER'),
    ),
    e2eTest: read(env, 'VITE_E2E_TEST') === 'true',
    useEmulators: read(env, 'VITE_USE_EMULATORS') === 'true',
  };
}

export const config: AppConfig = buildConfig(
  import.meta.env as unknown as RawEnv,
);

/**
 * Compile-time twin of `config.e2eTest` for test seams that must be
 * TREE-SHAKEN from production builds. Vite replaces
 * `import.meta.env.VITE_E2E_TEST` with a literal, so `if (!E2E_TEST_BUILD)`
 * folds to a constant and the seam's body is dropped from bundles built
 * without the flag (`config.e2eTest` reads the whole env object at runtime,
 * which the bundler cannot fold).
 */
export const E2E_TEST_BUILD: boolean = import.meta.env.VITE_E2E_TEST === 'true';

/** Test-only: build a config from arbitrary env vars. Not used in app code. */
export function _buildConfigForTest(env: RawEnv): AppConfig {
  return buildConfig(env);
}
