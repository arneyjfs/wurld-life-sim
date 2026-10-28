/**
 * HARNESS-PROD-1 (docs/specs/test-harness.md) — where a test's custom token is
 * exchanged for an ID token, decided from the environment alone.
 *
 * Under the emulator (`FIREBASE_AUTH_EMULATOR_HOST`, set by
 * `firebase emulators:exec`) the exchange goes to the Auth emulator, which
 * accepts any API key. Anything else would reach the REAL Identity Toolkit,
 * i.e. prod Auth (`demo-wurlds`); that is allowed only when the caller opts in
 * with `E2E_ALLOW_PROD=1` (the manual `test:e2e:prod-smoke`) AND names the key
 * in `FIREBASE_API_KEY`. There is no built-in key: a helper run outside the
 * emulator used to fall back to the prod web key and silently sign test users
 * into prod (audit ENV-12).
 */
export function identityToolkitSignInUrl(env: Record<string, string | undefined>): string {
  const path = 'identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken';
  const emulatorHost = env.FIREBASE_AUTH_EMULATOR_HOST;
  if (emulatorHost) {
    return `http://${emulatorHost}/${path}?key=${env.FIREBASE_API_KEY || 'emulator-any-key'}`;
  }
  if (env.E2E_ALLOW_PROD !== '1') {
    throw new Error(
      'HARNESS-PROD-1: FIREBASE_AUTH_EMULATOR_HOST is not set, so this token exchange would hit PROD Auth. ' +
        'Run under `firebase emulators:exec` (npm run test:e2e:emulator), or set E2E_ALLOW_PROD=1 for a deliberate prod smoke.',
    );
  }
  if (!env.FIREBASE_API_KEY) {
    throw new Error('HARNESS-PROD-1: E2E_ALLOW_PROD=1 but FIREBASE_API_KEY is not set (tests/e2e/.env.test).');
  }
  return `https://${path}?key=${env.FIREBASE_API_KEY}`;
}

/** The Functions emulator, as firebase.integration.json declares it. */
export const FUNCTIONS_EMULATOR_URL = 'http://127.0.0.1:5001/demo-wurlds/us-central1';

/**
 * HARNESS-PROD-1 — the Node-side Cloud Functions base URL. Under the emulator
 * harness it is ALWAYS the Functions emulator: an emulator-minted ID token sent
 * to the deployed beta functions is a 401 at best (translation-waterfall.spec
 * did exactly that) and a call into the real backend at worst. Outside the
 * emulator: `FUNCTIONS_URL`, else the beta functions (the prod-config harness).
 */
export function functionsBaseUrl(env: Record<string, string | undefined>): string {
  // Either variable is exported by `firebase emulators:exec`; the specs used
  // FIRESTORE_EMULATOR_HOST as the signal, the token exchange the Auth one.
  if (env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST) {
    return env.FUNCTIONS_EMULATOR_URL || FUNCTIONS_EMULATOR_URL;
  }
  return env.FUNCTIONS_URL || 'https://us-central1-wurld-beta.cloudfunctions.net';
}
