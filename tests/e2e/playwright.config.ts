// ⚠️ THIS CONFIG TARGETS **PROD** Firestore/Functions (`demo-wurlds`) directly.
// It is NOT the `@critical` release gate. The gate is the Firebase Emulator
// Suite via `npm run test:e2e:emulator` (→ `playwright.emulator.config.ts`).
// Running `@critical` against THIS config hammers prod and yields *spurious*
// Firestore `unavailable` / `Missing or insufficient permissions` / webkit-
// mobile realtime failures + stale-test-data contention — NOT real regressions.
// `@standard`/`@full` legitimately use this config (real-backend CI). See
// docs/specs/test-harness.md + the gate-guard warning below.
import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Where to find a Chromium binary when Playwright's own pinned revision is not
 * on this machine. See the note at the `chromium` project below for why this
 * is auto-detected rather than opt-in.
 *
 * Order: explicit env var, then the agent-sandbox symlink. Returns `{}` on a
 * normal machine, which is a no-op.
 */
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';
function chromiumOverride(): { launchOptions?: { executablePath: string } } {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (explicit) return { launchOptions: { executablePath: explicit } };
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(SANDBOX_CHROMIUM)) {
    return { launchOptions: { executablePath: SANDBOX_CHROMIUM } };
  }
  return {};
}

// Load test environment variables. Copy .env.test.example → .env.test
// and fill in the real Firebase service-account path + functions URL.
dotenv.config({ path: path.resolve(__dirname, '.env.test') });

// E2E uses port 5187 — chosen for its unlikelihood of colliding with
// a developer's other Vite projects (5180 was a common second-Vite
// port that has been seen squatted by an unrelated app, causing
// reuseExistingServer to attach to the wrong server and the test
// hooks to be missing). The webServer config below spawns a
// dedicated Vite instance on this port with VITE_E2E_TEST=true so
// the __testSignIn / __testSignOut hooks land.
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5187';

// Gate guard: catch the exact trap of running the `@critical` GATE against
// prod via this config. `firebase emulators:exec` (used by
// `test:e2e:emulator`) sets FIRESTORE_EMULATOR_HOST; its absence + a
// `@critical` grep means someone is about to misread prod/webkit flake as a
// release regression. Warn loudly; don't fail (prod smoke is a valid manual use).
if (
  process.argv.some((a) => a.includes('@critical')) &&
  !process.env.FIRESTORE_EMULATOR_HOST
) {
  // eslint-disable-next-line no-console
  console.warn(
    '\n\x1b[33m⚠️  [wurld] Running @critical against PROD Firestore (demo-wurlds) via the bare playwright.config.ts.\n' +
      '   This is NOT the gate — expect spurious Firestore `unavailable` / permission / webkit-mobile failures.\n' +
      '   The real @critical gate is:  npm run test:e2e:emulator  (Firebase Emulator Suite + real Gemini).\n' +
      '   See docs/specs/test-harness.md.\x1b[0m\n',
  );
}

export default defineConfig({
  testDir: './specs',
  // `pwa-*.spec.ts` asserts the service-worker precache (BOOT-SHELL-*), which
  // only exists in a production build. This config serves `vite dev`, where
  // vite-plugin-pwa never runs injectManifest — so those specs belong to
  // playwright.pwa.config.ts (`npm run test:e2e:pwa`) and must not run here.
  testIgnore: /pwa-.*\.spec\.ts/,
  fullyParallel: false, // E2E tests share Firebase state — serialise
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    // HARNESS-SELECT-2 — `npm run test:e2e:record-map` writes test-map.json.
    ...(process.env.E2E_RECORD_MAP ? [['./testMapReporter.ts'] as ['./testMapReporter.ts']] : []),
  ],
  timeout: 120_000, // pipeline calls can be slow
  expect: { timeout: 30_000 },

  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    // Diagnostic knob: E2E_REDUCED_MOTION=1 sets prefers-reduced-motion so the
    // nav parallax (NAV-ANIM-2/3) does an instant single-slot swap instead of
    // the dual-mount transition — used to isolate parallax-caused scroll flake.
    reducedMotion: process.env.E2E_REDUCED_MOTION === '1' ? 'reduce' : 'no-preference',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Escape hatch for a sandbox / CI image that ships a Chromium build
        // Playwright's pinned revision does not match — the launch then fails
        // with "Executable doesn't exist at .../chromium_headless_shell-<rev>"
        // on EVERY spec, which reads like a suite-wide regression and is
        // nothing of the sort. It is a particularly expensive misread: the
        // whole chromium project reports failed rather than skipped, so a
        // 9-minute gate ends 19-red with every webkit twin green, and the
        // signature is only obvious once you open one of the failures.
        //
        // AUTO-DETECTED, not merely opt-in. It used to require setting
        // PLAYWRIGHT_CHROMIUM_PATH by hand, which is a thing you only know to
        // do AFTER losing a run to it. `chromiumOverride()` resolves the env
        // var first, then falls back to the sandbox's own symlink if it
        // exists. A developer machine has no /opt/pw-browsers, so this stays a
        // no-op there and Playwright resolves its own browser exactly as
        // before.
        ...chromiumOverride(),
      },
    },
    // Mobile-Safari (WebKit) at iPhone 13 viewport. Added for the
    // scroll-anchoring suite (chat-scroll-anchoring.spec.ts) which
    // reproduces iOS-PWA-only flake patterns. The desktop chromium
    // run is structurally fine but cannot exercise WebKit's
    // overflow-anchor semantics, momentum-revert behaviour, or the
    // touch-event paths the iOS WebView uses.
    //
    // Run just this project's tests:
    //   npx playwright test --project=webkit-mobile
    //   npx playwright test --grep @scroll-anchoring --project=webkit-mobile
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13'] },
      // HARNESS-WEBKIT-1 (docs/specs/test-harness.md) — run ONLY the specs
      // WebKit can actually falsify. This project used to run the whole
      // @critical set, re-executing ~188 chromium tests of deterministic logic
      // (translation keys, billing, admin, pipeline shape) that cannot differ
      // between engines — doubling wall-clock AND real-Gemini spend for no
      // signal.
      //
      // A spec earns a place here only by asserting behaviour in one of the
      // three classes desktop chromium structurally cannot reach:
      //   1. scroll anchoring  — WebKit has no overflow-anchor (bug 171099)
      //   2. momentum/inertia  — iOS overrides sync scrollTop writes mid-glide
      //   3. touch + visualViewport — real touch paths, keyboard geometry
      //
      // Importing a scroll helper is NOT enough. Add a spec here only with a
      // reason, and prefer the @full tier or docs/ios-device-checklist.md for
      // anything that does not meet the bar.
      testMatch: [
        // 1 — scroll anchoring / prepend / drift
        '**/chat-scroll.spec.ts',
        '**/chat-scroll-anchoring.spec.ts',
        '**/chat-scroll-prepend-gesture.spec.ts',
        '**/scroll-overflow-surfaces.spec.ts',
        '**/settings-reload-scroll.spec.ts',
        // 2 — momentum-sensitive list behaviour
        '**/bubble-enter.spec.ts',
        '**/reply-preview-bar.spec.ts',
        // 3 — touch paths + visual viewport
        '**/keyboard-behavior.spec.ts',
        '**/reactions-long-press.spec.ts',
        '**/image-tap-instant-open.spec.ts',
        // IMG-VIEWER-14/16 — reported on iPhone: the ancestor-scroll of a
        // hidden filmstrip and the decoded-image reuse on swipe-back are both
        // engine-specific (WebKit's scrollIntoView + memory cache).
        '**/image-viewer-swipe.spec.ts',
        // transition/animation timing, which differs with WebKit compositing
        '**/nav-tabbar-transitions.spec.ts',
        '**/nav-pop-no-double-animate.spec.ts',
      ],
    },
  ],

  // Vite dev server with VITE_E2E_TEST=true so the app exposes
  // `window.__testSignIn` / `__testSignOut` (see src/lib/testHooks.ts).
  // Comment this out when running against a deployed URL.
  webServer: BASE_URL.includes('localhost')
    ? {
        command: 'npm run dev -- --port 5187 --strictPort',
        cwd: path.resolve(__dirname, '../..'),
        url: BASE_URL,
        // Reuse OK because port 5187 is reserved for wurld E2E — if it
        // already has a server, that server was started by a previous
        // Playwright run with VITE_E2E_TEST already set.
        reuseExistingServer: true,
        timeout: 60_000,
        env: {
          ...process.env,
          VITE_E2E_TEST: 'true',
        },
      }
    : undefined,
});
