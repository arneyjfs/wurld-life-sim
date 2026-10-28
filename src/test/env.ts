import { vi } from 'vitest';

// `src/lib/config.ts` validates its required VITE_* vars at module load and
// THROWS when any is missing. Vitest runs in mode `test`, which loads neither
// `.env.beta` nor `.env.production`, so on a fresh clone (or CI) the only
// source of those vars was a developer's gitignored `.env.local` — without it
// 65 test files failed to import at all, with the misleading message
// "There was an error when mocking a module". Stub placeholders here so the
// unit suite is hermetic and never depends on untracked local files.
//
// These are deliberately obvious non-secrets: unit tests must never reach a
// real backend. Anything that needs REAL config (the E2E suites) runs through
// Playwright with its own env, not through this setup file.
//
// The functions project loads this too: the client/server resolver parity
// harness (languageResolutionParity.test.ts) imports client modules, which
// pull in config.ts.
for (const [key, value] of Object.entries({
  VITE_FUNCTIONS_URL: 'https://functions.test.invalid',
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'wurld-test',
  VITE_FIREBASE_STORAGE_BUCKET: 'wurld-test.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:testappid',
})) {
  if (!import.meta.env[key]) vi.stubEnv(key, value);
}

// BILL-MANAGE-7 — the web price follows the browser's time zone (£ in London,
// € in Paris). Pin UTC so the suite prints the same `$2.99` on every machine.
process.env.TZ = 'UTC';
