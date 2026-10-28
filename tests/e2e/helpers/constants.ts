import { functionsBaseUrl } from './harnessTarget';
/**
 * E2E test constants. Adapted from source tests/e2e/helpers/constants.ts.
 * Vite dev server defaults to port 5173 (source used Expo 8081).
 */

export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5180';
export const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || 'demo-wurlds';
// HARNESS-PROD-1 — the Functions emulator under `emulators:exec`, else
// FUNCTIONS_URL / the beta functions (helpers/harnessTarget.ts).
export const FUNCTIONS_URL = functionsBaseUrl(process.env);

// Auth Emulator (defaults match source).
export const USE_EMULATOR = process.env.USE_AUTH_EMULATOR !== 'false';
export const AUTH_EMULATOR_HOST =
  process.env.AUTH_EMULATOR_HOST || '127.0.0.1';
export const AUTH_EMULATOR_PORT = parseInt(
  process.env.AUTH_EMULATOR_PORT || '9099',
  10,
);
export const AUTH_EMULATOR_URL =
  process.env.AUTH_EMULATOR_URL ||
  `http://${AUTH_EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`;

// Test phone numbers — emulator accepts any; without it requires
// Firebase Console-registered test numbers.
export const TEST_PHONE_A = process.env.TEST_PHONE_A || '+10000000001';
export const TEST_PHONE_B = process.env.TEST_PHONE_B || '+10000000002';
export const TEST_VERIFICATION_CODE =
  process.env.TEST_VERIFICATION_CODE || '123456';

export const TEST_USER_A = {
  phone: TEST_PHONE_A,
  displayName: 'Test Alice',
  nativeLanguage: 'English (British)',
  practiceLanguage: 'French',
  difficulty: 2,
};

export const TEST_USER_B = {
  phone: TEST_PHONE_B,
  displayName: 'Test Bob',
  nativeLanguage: 'English (British)',
  practiceLanguage: 'Spanish',
  difficulty: 2,
};

// Timeouts
export const PIPELINE_TIMEOUT_MS = 45_000;
export const TRANSLATION_TIMEOUT_MS = 30_000;
export const UI_SETTLE_MS = 2_000;
export const SPINNER_GONE_TIMEOUT_MS = 30_000;

/**
 * True when the emulated Cloud Functions answer from `functions/src/geminiStub.ts`
 * instead of the real model (`npm run test:e2e:emulator:ci`, and CI). A spec
 * whose post-condition IS the model's output (analysis shape, deterministic
 * language detection, a streamed explanation) cannot pass against canned
 * answers and skips itself with this flag; it still runs in the real-Gemini
 * gate (`npm run test:e2e:emulator`, the pre-push hook on main).
 */
export const GEMINI_STUBBED = process.env.GEMINI_STUB === '1';
