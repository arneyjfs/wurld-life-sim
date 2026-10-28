/**
 * E2E: /wurlds surface — REAL Gemini smoke test.
 *
 * Unlike life-flow.spec.ts (mocked Gemini), this spec lets the
 * Gemini calls go all the way through to the live geminiGenerate
 * Cloud Function. One opening-beat round-trip per run; budget
 * is ~$0.05-0.15 of Gemini cost per execution.
 *
 * Purpose: catch regressions where the SI / response schema / mock
 * fixtures drift out of sync with what the real model produces.
 * Don't add chip-pick flows here — those would burn additional
 * tokens with low marginal coverage.
 *
 * Phone prefix: +1000061_A.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  provisionTestUser,
  signInBrowser,
  type AuthenticatedUser,
} from '../helpers/auth';
import { cleanupTestUsers, getAdminFirestore } from '../helpers/firebase-admin';
import { captureBeat } from '../helpers/screenshots';
import { enableWurlds } from '../helpers/betaFlags';

const USER_A = {
  phone: process.env.TEST_PHONE_LIFE_REAL_A || '+10000610001',
  displayName: 'Life Real Alice',
  nativeLanguage: 'English (British)',
  practiceLanguage: 'French',
  difficulty: 3,
};

let userA: AuthenticatedUser;
let context: BrowserContext;
let page: Page;

async function wipeLifeData(uid: string): Promise<void> {
  const db = getAdminFirestore();
  for (const col of ['lifeWorld', 'lifeEvents', 'lifeNpcs', 'lifeBackdrops']) {
    const snap = await db.collection(`users/${uid}/${col}`).get();
    const batch = db.batch();
    snap.forEach((d) => batch.delete(d.ref));
    if (!snap.empty) await batch.commit();
  }
}

test.describe.serial('life-sim real-Gemini smoke', () => {
  // A real-Gemini smoke: under GEMINI_STUB the stub answers no life-sim beat,
  // so the first chip never arrives. Run it on the emulator with a real key.
  test.skip(process.env.GEMINI_STUB === '1', 'needs real Gemini');
  // The emulated functions read GEMINI_API_KEY from functions/.secret.local
  // (docs/setup.md). Without it every call fails, so skip rather than fail.
  test.skip(
    !existsSync(path.resolve(__dirname, '../../../functions/.secret.local')),
    'needs functions/.secret.local with GEMINI_API_KEY',
  );
  test.beforeAll(async ({ browser }) => {
    userA = await provisionTestUser(USER_A);
    await wipeLifeData(userA.uid);
    context = await browser.newContext({
      viewport: { width: 414, height: 896 },
    });
    // SETTINGS-BETA-4 / NAV-BETA-1 — `/wurlds` is gated on `lifeSimBeta`.
    await enableWurlds(context);
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
    await cleanupTestUsers(userA?.uid);
  });

  test('opening beat lands from a real Gemini call', async ({}, testInfo) => {
    test.setTimeout(180_000); // SVG gen + lifeStep — generous.
    await signInBrowser(page, userA);
    await page.goto('/wurlds');
    await page.waitForLoadState('domcontentloaded');

    // ⚠ **An empty Wurlds does NOT auto-redirect to onboarding**, and this
    // spec asserted for months that it did — it predates the overview card
    // (`LifeOverviewScreen` / `life-overview-card.spec.ts`), which made
    // `/wurlds` a real screen with its own empty state and a Create button.
    // `routes.tsx:201` redirects only the bare alias, never `/wurlds` itself.
    //
    // The stale expectation cost the full 15s and then failed on both browser
    // projects, which read as a Wurlds regression rather than as a test that
    // had not been updated with the screen it walks through.
    await page.waitForURL((url) => url.pathname === '/wurlds', {
      timeout: 15_000,
    });
    await page.getByTestId('LifeOverview-Create').click();
    await page.waitForURL((url) => url.pathname === '/wurlds/start', {
      timeout: 15_000,
    });
    await captureBeat(page, testInfo, 'real-onboard');

    // Pick a realistic vibe so the opening beat exercises the
    // bilingual + practicePrompt paths organically.
    //
    // ⚠ LIFE-ONBOARD-15 made FANTASY the default mode and `city_life` is a
    // REALISTIC seed, so it is not on screen at load — the same trap
    // `life-flow.spec.ts` already documents. Switch modes first, and assert
    // the chip with a SHORT timeout so a future filtering change fails in
    // seconds with a readable message rather than burning the 180s budget on
    // a chip that was never going to appear.
    await page.getByTestId('LifeStart-Mode-realistic').click();
    await expect(page.getByTestId('LifeStart-Seed-city_life')).toBeVisible({
      timeout: 5_000,
    });
    await page.getByTestId('LifeStart-Seed-city_life').click();
    // The seed creates a world → navigates to /wurlds/:worldId (never bare
    // /wurlds), so match the world route, not exact equality.
    await page.waitForURL((url) => /^\/wurlds\/w-/.test(url.pathname), {
      timeout: 30_000,
    });

    // Wait for the opening beat to land. The DialogueArea appears
    // immediately; we wait for the chip grid to populate as the
    // signal that lifeStep has resolved.
    const firstChip = page.getByTestId(/LifeScreen-Choice-/);
    await expect(firstChip.first()).toBeVisible({ timeout: 120_000 });
    await captureBeat(page, testInfo, 'real-opening-beat');

    // Spot-check the beats render in both languages (the bilingual
    // contract is load-bearing for the UI).
    const bubbles = page.getByTestId(/LifeScreen-Bubble-/);
    await expect(bubbles.first()).toBeVisible();
    const bubbleCount = await bubbles.count();
    expect(bubbleCount).toBeGreaterThan(0);
  });
});
