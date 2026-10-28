# E2E tests

Playwright specs that exercise the full stack — real Firestore, real Cloud Functions, real Firebase Auth. Adapted from the source app's `tests/e2e/`.

## One-time setup

```bash
cd tests/e2e
npm install
cp .env.test.example .env.test
```

Then edit `.env.test`:

- `GOOGLE_APPLICATION_CREDENTIALS` → path to a Firebase service account JSON for the `wurld-e27d8` project (or `wurld-beta` if you want isolated test data).
- `FIREBASE_API_KEY` → web API key (visible in Firebase console under project settings).
- `FUNCTIONS_URL` → defaults to `wurld-beta` to keep test traffic off prod.

You'll also need Java installed (for the Auth emulator) and the `firebase` CLI on PATH.

## Running

```bash
# From tests/e2e/
npm test                  # full suite
npm run test:headed       # see what the browser is doing
npm run test:ui           # Playwright's interactive UI
npm run test:debug        # step-debugger

# Just the smoke test (validates auth bridge works)
npx playwright test smoke

# Skip the Auth emulator (uses real phone numbers configured in Firebase console)
npm run test:no-emulator
```

The Vite dev server is started automatically by Playwright with `VITE_E2E_TEST=true` — this is the only mode where `window.__testSignIn` is exposed. If the dev server is already running, Playwright reuses it; just make sure you started it with `VITE_E2E_TEST=true` (`VITE_E2E_TEST=true npm run dev`).

## Specs

- `smoke.spec.ts` — provision a user via Admin SDK, sign in via `__testSignIn`, verify the app advances past LoginScreen. The "does the test infrastructure work at all" check.
- `message-send.spec.ts` — full 2-user send/receive with pipeline waiting. Adapted from source.

Specs not yet ported:

- `auth-flow.spec.ts` — phone-auth UI flow against the Auth emulator.
- `sender-review.spec.ts` — pending-review accept/dismiss flow.
- `pipeline-backend.spec.ts` — backend-only pipeline HTTP test.
- `offline-mode.spec.ts` — OfflineBar + cache reconnect.
- `photo-upload.spec.ts` — image upload end-to-end.
- `translation-waterfall.spec.ts` — pipeline stage timing assertions.

Selectors in source target the Expo screen tree. Most of them won't match the Capacitor port without adaptation; see `message-send.spec.ts` for the pattern (use `getByRole('textbox', { name: /Type in/i })` instead of source's text-id selectors).

## Architecture

The bridge between Playwright and the real Firebase setup:

1. **Admin SDK** (Node side) — creates a test user, generates a custom auth token, exchanges it for a real ID token via the Identity Toolkit REST API.
2. **`window.__testSignIn(customToken)`** (browser side) — `lib/testHooks.ts` exposes this when `VITE_E2E_TEST=true`. It calls `signInWithCustomToken(auth, token)` against the real Firebase Auth instance.
3. **Real Auth + real Firestore + real Cloud Functions** — the tokens minted via the Admin SDK are accepted by everything as if a real phone-auth user signed in.
4. **Auth emulator** runs separately (only needed by `auth-flow.spec.ts`); the browser doesn't connect to it, the emulator REST API is used to fetch verification codes during the test.

Cleanup runs in `test.afterAll` — `cleanupTestUsers(uidA, uidB)` deletes the direct chat, both users' Firestore profiles, their contacts subcollections, and the Auth records.
