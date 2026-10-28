/**
 * E2E: LIFE-WORLD-9 — overview WurldCard scene thumbnail (@standard).
 *
 * Seeds two worlds via the admin SDK (no onboarding, no Gemini):
 *   - THUMB world: has currentBackdrop + a persisted scene doc whose
 *     svgInline carries a distinctive fill. Fresh browser context ⇒
 *     localStorage is empty ⇒ the banner can only come from the
 *     Firestore mirror — the exact post-condition under test.
 *   - FRESH world: no currentBackdrop ⇒ the card must stay bannerless.
 *
 * Every Gemini request (geminiGenerate + geminiStreamV2) is
 * intercepted and counted; the run must end with ZERO calls
 * (thumbnail is read-only reuse).
 *
 * Phone prefix: +1000062_A.
 */
import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';
import {
  provisionTestUser,
  signInBrowser,
  type AuthenticatedUser,
} from '../helpers/auth';
import { cleanupTestUsers, getAdminFirestore } from '../helpers/firebase-admin';
import { captureBeat } from '../helpers/screenshots';
import { enableWurlds } from '../helpers/betaFlags';

const USER_A = {
  phone: process.env.TEST_PHONE_LIFE_THUMB || '+10000620001',
  displayName: 'Life Thumb',
  nativeLanguage: 'English (British)',
  practiceLanguage: 'French',
  difficulty: 3,
};

const THUMB_WORLD_ID = 'w-e2e-thumb';
const FRESH_WORLD_ID = 'w-e2e-fresh';

/** Distinctive fill so the assertion proves the banner shows THIS
 *  persisted SVG, not a bundled fallback silhouette. */
const SEEDED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><rect width="1200" height="800" fill="#123456"/></svg>';

let userA: AuthenticatedUser;
let context: BrowserContext;
let page: Page;
const geminiCalls: string[] = [];

async function wipeWorlds(uid: string): Promise<void> {
  const db = getAdminFirestore();
  const worlds = await db.collection(`users/${uid}/lifeWorlds`).get();
  for (const w of worlds.docs) {
    for (const sub of ['backdrops', 'events', 'npcs', 'scenes']) {
      const docs = await w.ref.collection(sub).get();
      const batch = db.batch();
      docs.forEach((d) => batch.delete(d.ref));
      if (!docs.empty) await batch.commit();
    }
    await w.ref.delete();
  }
}

/** Minimal ZLifeWorld-valid doc. updatedAt is REQUIRED — the overview
 *  query is orderBy('updatedAt','desc') and Firestore excludes docs
 *  missing the orderBy field. */
function worldDoc(id: string, characterName: string, updatedAt: Date) {
  return {
    id,
    characterName,
    practiceLanguage: 'French',
    nativeLanguage: 'English (British)',
    difficulty: 3,
    worldSeedKey: 'city_life',
    worldMode: 'realistic',
    createdAt: updatedAt,
    updatedAt,
  };
}

test.describe.serial('@standard LIFE-WORLD-9 — overview scene thumbnail', () => {
  test.beforeAll(async ({ browser }) => {
    userA = await provisionTestUser(USER_A);
    await wipeWorlds(userA.uid);
    const db = getAdminFirestore();

    // World WITH a persisted backdrop. label 'Cafe Lumiere' →
    // descriptorCacheKey 'cafe_lumiere' (lowercase, spaces→_, ASCII
    // only) → backdropDocId 'cafe_lumiere' (no '::' to rewrite). The
    // backdrop doc id below MUST stay in sync with the label.
    //
    // The COLLECTION is `backdrops`. This seeded `scenes` until 2026-08-05 —
    // the collection LIFE-BACKDROP-22 renamed away from, and now the
    // scene-OUTLINE collection, which `readPersistentBackdrop` never reads.
    // The resolution ladder therefore fell through to the bundled café
    // silhouette and POST-CONDITION 1 asserted `#123456` against artwork that
    // never contained it. Caught by the emulator run for LIFE-BACKDROP-26,
    // which needed the same seed and hit the same wall.
    await db.doc(`users/${userA.uid}/lifeWorlds/${THUMB_WORLD_ID}`).set({
      ...worldDoc(THUMB_WORLD_ID, 'Thumb Hero', new Date('2026-07-14T12:00:00Z')),
      currentBackdrop: {
        locationType: 'cafe',
        vibe: 'modern_city',
        persistent: true,
        label: 'Cafe Lumiere',
      },
    });
    await db
      .doc(`users/${userA.uid}/lifeWorlds/${THUMB_WORLD_ID}/backdrops/cafe_lumiere`)
      .set({
        id: 'cafe_lumiere',
        descriptor: 'cafe_lumiere',
        svgInline: SEEDED_SVG,
        locationLabel: 'Cafe Lumiere',
        createdAt: new Date(),
        lastVisitedAt: new Date(),
      });

    // Fresh world: no currentBackdrop → the card must stay bannerless.
    await db
      .doc(`users/${userA.uid}/lifeWorlds/${FRESH_WORLD_ID}`)
      .set(worldDoc(FRESH_WORLD_ID, 'Fresh Face', new Date('2026-07-14T11:00:00Z')));

    context = await browser.newContext({
      viewport: { width: 414, height: 896 },
    });
    // SETTINGS-BETA-4 / NAV-BETA-1 — `/wurlds` is gated on `lifeSimBeta`.
    await enableWurlds(context);
    // ZERO-GEN GUARD: count every Gemini request. None may fire —
    // fulfilling with 500 makes an accidental call loud. Both
    // endpoints (generate + stream) are covered; the glob matches the
    // Vite same-origin proxy path (/__functions/<name>) AND the direct
    // cloudfunctions.net URL.
    const countGemini = async (route: Route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        category?: string;
      };
      geminiCalls.push(body.category ?? 'unknown');
      await route.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: 'life-overview-thumbnail: unexpected Gemini call',
      });
    };
    await context.route('**/geminiGenerate', countGemini);
    await context.route('**/geminiStreamV2', countGemini);
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
    if (userA) await wipeWorlds(userA.uid);
    await cleanupTestUsers(userA?.uid);
  });

  test('LIFE-WORLD-9 — persisted scene renders as the card banner; fresh world stays compact; zero Gemini calls', async ({}, testInfo) => {
    await signInBrowser(page, userA);
    await page.goto('/wurlds');
    await page.waitForLoadState('domcontentloaded');
    // LIFE-WORLD-3: /wurlds always lands on the overview.
    await page.waitForURL((url) => url.pathname === '/wurlds', {
      timeout: 10_000,
    });

    const thumbCard = page
      .getByTestId('LifeOverview-WorldCard')
      .filter({ hasText: 'Thumb Hero' });
    const freshCard = page
      .getByTestId('LifeOverview-WorldCard')
      .filter({ hasText: 'Fresh Face' });
    await expect(thumbCard).toBeVisible({ timeout: 15_000 });
    await expect(freshCard).toBeVisible();

    // POST-CONDITION 1: the banner contains the PERSISTED SVG bytes
    // (distinctive fill) — proof the Firestore svgInline path resolved,
    // not merely that a banner div exists.
    const banner = thumbCard.getByTestId('LifeOverview-WorldCard-Thumb');
    await expect(banner.locator('svg')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => banner.innerHTML(), { timeout: 15_000 })
      .toContain('#123456');

    // POST-CONDITION 2: fresh world → no banner element at all.
    await expect(
      freshCard.getByTestId('LifeOverview-WorldCard-Thumb'),
    ).toHaveCount(0);

    await captureBeat(page, testInfo, 'overview-thumbnails');

    // POST-CONDITION 3: zero Gemini traffic from the overview.
    expect(geminiCalls).toEqual([]);
  });
});
