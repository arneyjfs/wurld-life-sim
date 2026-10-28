import baseConfig from './playwright.config';
import { defineConfig } from '@playwright/test';
import path from 'node:path';

/**
 * Emulator E2E config (Phase 3 of the test-harness redesign — see
 * docs/specs/test-harness.md).
 *
 * Runs the SAME specs/projects as the base config, but against the local
 * Firebase Emulator Suite (Auth + Firestore + Functions) instead of real
 * Firestore — the root fix for the WebChannel-congestion live-tail churn that
 * flakes the real-backend suite. The emulator delivers snapshots instantly and
 * locally, so there's no socket-cap congestion and no live-tail shift mid-test.
 *
 * Gemini is deliberately NOT stubbed: the emulated Cloud Functions still call
 * the real Gemini API (functions/.secret.local supplies the key; GEMINI_STUB
 * is left UNSET by the `test:e2e:emulator` script). So push-time gates test
 * real translation responses — only the data substrate is emulated.
 *
 * Lifecycle: `npm run test:e2e:emulator` wraps this in
 * `firebase emulators:exec --config firebase.integration.json`, which boots
 * Auth(:9099)+Firestore(:8080)+Functions(:5001) and exports
 * FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST so the Admin SDK
 * (seeding + token mint in helpers/firebase-admin.ts) auto-targets the
 * emulator. The browser is pointed at the emulator by VITE_USE_EMULATORS
 * (src/lib/firebase.ts) + the Vite proxy aimed at the Functions emulator.
 *
 * Distinct port 5188 (vs the real-backend 5187) so the two never collide and
 * `reuseExistingServer` can't attach to the wrong substrate.
 */

// Hardcoded (NOT process.env.E2E_BASE_URL): .env.test pins E2E_BASE_URL to the
// real-backend 5187, which would make Playwright probe 5187 for readiness while
// the webServer starts vite on 5188 — a port mismatch that times out the
// webServer forever. The emulator harness owns its own port.
const EMULATOR_BASE_URL = 'http://localhost:5188';

// Marker read by specs (e.g. multi-send tests) that must skip under the
// emulator: the emulated Cloud Functions call REAL Gemini, so a send's
// pipeline RPC (analyze + per-language translate) can take >60s — several
// serialized UI sends in one test then blow the 120s timeout. Those specs
// stay active against the fast real backend.
process.env.E2E_EMULATOR = 'true';

// HARNESS-CI-2: CI runs an indivisible long-pole spec on a runner of its own
// and passes its glob here so the --shard=N/3 runners skip it.
const extraIgnore = (process.env.E2E_TEST_IGNORE ?? '').split(',').filter(Boolean);

export default defineConfig({
  ...baseConfig,
  testIgnore: [/pwa-.*\.spec\.ts/, ...extraIgnore],
  /**
   * ONE retry, on THIS config only — for browser-level crashes, not assertions.
   *
   * MEASURED 2026-08-07. The gate failed on `chat-scroll` / media-gallery jump
   * (webkit-mobile) with `page.goto: WebKit encountered an internal error` —
   * a browser crash, not a failed expectation — after 32.9s. The same test
   * re-run alone passed 3/3 in 12-15s. The run before it lost `contacts-add-back`
   * the same way. Two gates, two load-induced webkit-mobile failures, both in
   * specs unrelated to the change under test, each costing a second 20-minute
   * gate to disprove.
   *
   * WHY NOT MORE WORKERS, OR FEWER: the base config is ALREADY `workers: 1` and
   * `fullyParallel: false`, so there is no test-level parallelism to cap. The
   * contention is the rest of the box — the emulator suite (a JVM Firestore, the
   * functions runtime, auth, storage), the Vite dev server, real Gemini calls in
   * flight, and WebKit's own multi-process browser — against 4 vCPUs.
   * `/proc/loadavg` read 4.33 mid-gate: saturated. There is no concurrency knob
   * that fixes an undersized box.
   *
   * WHY A RETRY IS NOT "flake, will retry" (the *Reliability principles* ban):
   * Playwright reports a test that fails then passes as **flaky**, not passed,
   * so the summary line still says so and `trace: 'on-first-retry'` (base
   * config) captures the crash. The failure stays visible and diagnosable; what
   * changes is that it no longer costs a full re-run to establish it was
   * environmental. A test that fails BOTH attempts still fails the gate.
   *
   * If the flaky count starts climbing, or a flake appears in a spec touching
   * the change under test, that is a real signal — investigate it, do not raise
   * this number.
   */
  retries: 1,
  use: {
    ...baseConfig.use,
    baseURL: EMULATOR_BASE_URL,
    /**
     * Without this, `page.route()` DOES NOT INTERCEPT on webkit-mobile.
     *
     * `public/firebase-messaging-sw.js` has a `fetch` handler and registers in
     * dev (`lib/swRegister.ts` registers it directly — vite-plugin-pwa's own
     * dev SW is off, but this one is served straight out of `public/`). WebKit
     * routes SW-mediated requests around Playwright's page-level interception;
     * Chromium catches them at the network layer. So every `page.route` in a
     * spec silently did nothing on webkit-mobile alone.
     *
     * That is worse than a failing assertion. `practice-session-llm.spec.ts`
     * cans a planner + generators precisely so it does not spend real Gemini
     * calls on the emulator — on webkit-mobile it was spending them anyway and
     * asserting against whatever came back, which is the exact failure mode
     * the spec's own header says the interception exists to prevent. It only
     * became visible because the calls started 400ing.
     *
     * Scoped to the emulator config on purpose: the `@full` tier's offline and
     * notification specs legitimately need a live worker, and they do not run
     * here. If a `@critical` spec ever needs one, take it per-test with
     * `test.use({ serviceWorkers: 'allow' })` rather than reopening this.
     */
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'npm run dev -- --port 5188 --strictPort',
    cwd: path.resolve(__dirname, '../..'),
    url: EMULATOR_BASE_URL,
    reuseExistingServer: true,
    // Generous: the first run with VITE_USE_EMULATORS invalidates Vite's
    // dep-optimize cache, so cold boot can take a while before the server
    // answers; subsequent runs are ~instant.
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_E2E_TEST: 'true',
      // Route the client SDK at the emulator (src/lib/config.ts → firebase.ts).
      VITE_USE_EMULATORS: 'true',
      // Pin the CLIENT's project id to the one the Admin SDK seeds into.
      //
      // In the Firestore emulator the project id IS the namespace. `npm run
      // dev` loads `.env.local`, and a machine whose `.env.local` carries a
      // stub project (`VITE_FIREBASE_PROJECT_ID=ci-stub`, as a CI-provisioned
      // checkout does) puts the browser in a DIFFERENT namespace from the
      // seeded data. Nothing errors: the client just reads an empty user doc,
      // the onboarding gate raises agreement gaps off a null profile, and
      // every spec wedges on "Before you start — Terms & privacy" with no
      // clue why. Pinning it here removes the whole failure mode, and it is
      // the same value `helpers/constants.ts` gives the Admin SDK.
      VITE_FIREBASE_PROJECT_ID:
        process.env.FIREBASE_PROJECT_ID || 'demo-wurlds',
      // HARNESS-ENV-1 — pin the app environment to `dev` too. `log.ts` only
      // writes to `console.*` when `config.env === 'dev'`, and specs that
      // assert on app logs (OBS-FIRESTORE-4's stall report, delete-account,
      // the prepend-gesture probe) read them from the page console. A cloud
      // checkout seeded with `cp .env.beta .env.local` carries
      // `VITE_ENV=beta`: the app logged to Sentry breadcrumbs only, and
      // those specs timed out waiting on lines that were never printed.
      VITE_ENV: 'dev',
      // Placeholder client config: the emulator ignores the key, and these
      // let a fresh clone (no .env.local) boot without src/lib/config.ts
      // throwing on a missing required var. A real .env.local still wins.
      VITE_FIREBASE_API_KEY: process.env.VITE_FIREBASE_API_KEY || 'demo-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'localhost',
      VITE_FIREBASE_STORAGE_BUCKET:
        process.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-wurlds.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '0',
      VITE_FIREBASE_APP_ID: process.env.VITE_FIREBASE_APP_ID || '1:0:web:0',
      // Vite proxy (/__functions → target) aimed at the Functions emulator.
      // process.env wins over .env.local in loadEnv (empty prefix), so this
      // overrides the beta URL .env.local carries.
      VITE_FUNCTIONS_URL:
        'http://127.0.0.1:5001/demo-wurlds/us-central1',
    },
  },
});
