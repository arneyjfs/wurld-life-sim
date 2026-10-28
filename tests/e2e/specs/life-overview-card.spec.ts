/**
 * E2E: LIFE-WORLD-17 + LIFE-BACKDROP-26 — what the two chrome surfaces say
 * about WHERE the player is (@standard).
 *
 * Both invariants are reads off stored fields, so both are seeded via the
 * admin SDK — no onboarding, no Gemini, no engine. That is the point: the
 * defects these cover were both a stored field never reaching the DOM, and a
 * spec that generated the data would be asserting the generator.
 *
 *   - RICH world: a full saga (title + titleNative + playerFacingTeaser), a
 *     persisted backdrop, and `currentLocationLabelNative`. Every affordance
 *     present.
 *   - LEGACY world: a saga with only a title, and a location with no native.
 *     Every affordance ABSENT — the half that stops a "render it always" fix
 *     from passing.
 *
 * Phone prefix: +1000063_A.
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
import { installLifeMock, minimalBackdropSvg } from '../helpers/lifeMock';

const USER_A = {
  phone: process.env.TEST_PHONE_LIFE_CARD || '+10000630001',
  displayName: 'Life Card',
  nativeLanguage: 'English (British)',
  practiceLanguage: 'French',
  difficulty: 3,
};

const RICH_WORLD_ID = 'w-e2e-card-rich';
const LEGACY_WORLD_ID = 'w-e2e-card-legacy';

const TEASER =
  'A third-floor flat with unreliable heating, and neighbours who have not introduced themselves yet.';
const TITLE = 'Le Pain Perdu';
const TITLE_NATIVE = 'The Lost Bread';
const PLACE = 'Le Vieux-Port';
const PLACE_NATIVE = 'The Old Port';

/** Distinctive fill: the ribbon only renders over a REAL backdrop, so the
 *  LIFE-BACKDROP-26 half depends on this resolving from the Firestore mirror
 *  rather than the planet placeholder (LIFE-BACKDROP-16). */
const SEEDED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><rect width="1200" height="800" fill="#1d3f5e"/></svg>';

let userA: AuthenticatedUser;
let context: BrowserContext;
let page: Page;

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

/** Minimal ZLifeWorld-valid doc. `updatedAt` is REQUIRED — the overview query
 *  is orderBy('updatedAt','desc') and Firestore excludes docs missing it. */
function worldDoc(id: string, characterName: string, updatedAt: Date) {
  return {
    id,
    characterName,
    practiceLanguage: 'French',
    nativeLanguage: 'English (British)',
    systemLanguage: 'English (British)',
    difficulty: 3,
    worldSeedKey: 'city_life',
    worldMode: 'realistic',
    createdAt: updatedAt,
    updatedAt,
  };
}

test.describe.serial('@standard LIFE-WORLD-17 / LIFE-BACKDROP-26 — card + ribbon', () => {
  test.beforeAll(async ({ browser }) => {
    userA = await provisionTestUser(USER_A);
    await wipeWorlds(userA.uid);
    const db = getAdminFirestore();

    // label 'Le Vieux-Port' → descriptorCacheKey 'le_vieuxport' (lowercase,
    // spaces→_, non-[a-z0-9_] dropped). The backdrop doc id below MUST stay in
    // sync with the label or the ribbon never comes up — and the collection is
    // `backdrops`, not `scenes` (LIFE-BACKDROP-22 renamed it; `scenes` is now
    // the scene-outline collection and `readPersistentBackdrop` never looks
    // there). Seeding the wrong one fails silently: the read misses, the app
    // renders a silhouette, and the ribbon is suppressed by LIFE-BACKDROP-16
    // with nothing to say why.
    await db.doc(`users/${userA.uid}/lifeWorlds/${RICH_WORLD_ID}`).set({
      ...worldDoc(RICH_WORLD_ID, 'Rich Hero', new Date('2026-08-05T12:00:00Z')),
      saga: { title: TITLE, titleNative: TITLE_NATIVE, playerFacingTeaser: TEASER, tone: 'wry' },
      currentLocationLabel: PLACE,
      currentLocationLabelNative: PLACE_NATIVE,
      currentBackdrop: {
        locationType: 'harbour',
        vibe: 'modern_city',
        persistent: true,
        label: PLACE,
        labelNative: PLACE_NATIVE,
      },
    });
    await db
      .doc(`users/${userA.uid}/lifeWorlds/${RICH_WORLD_ID}/backdrops/le_vieuxport`)
      .set({
        id: 'le_vieuxport',
        descriptor: 'le_vieuxport',
        svgInline: SEEDED_SVG,
        locationLabel: PLACE,
        createdAt: new Date(),
        lastVisitedAt: new Date(),
      });

    // Legacy: a saga from before titleNative/playerFacingTeaser were written.
    await db.doc(`users/${userA.uid}/lifeWorlds/${LEGACY_WORLD_ID}`).set({
      ...worldDoc(LEGACY_WORLD_ID, 'Legacy Face', new Date('2026-08-05T11:00:00Z')),
      saga: { title: 'Une vie ordinaire', titleNative: '', playerFacingTeaser: '', tone: '' },
    });

    context = await browser.newContext({ viewport: { width: 414, height: 896 } });
    // SETTINGS-BETA-4 / NAV-BETA-1 — `/wurlds` is gated on `lifeSimBeta`.
    await enableWurlds(context);
    // No Gemini may fire from the overview (LIFE-WORLD-9's zero-gen property,
    // which this spec rides on): a 500 makes an accidental call loud rather
    // than letting it quietly satisfy an assertion.
    const block = async (route: Route) =>
      route.fulfill({ status: 500, contentType: 'text/plain', body: 'unexpected Gemini call' });
    await context.route('**/geminiGenerate', block);
    await context.route('**/geminiStreamV2', block);
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
    if (userA) await wipeWorlds(userA.uid);
    await cleanupTestUsers(userA?.uid);
  });

  test('LIFE-WORLD-17 — the card shows the title, its translation and the story teaser; a legacy saga shows neither', async ({}, testInfo) => {
    await signInBrowser(page, userA);
    await page.goto('/wurlds');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForURL((url) => url.pathname === '/wurlds', { timeout: 10_000 });

    const rich = page.getByTestId('LifeOverview-WorldCard').filter({ hasText: 'Rich Hero' });
    const legacy = page.getByTestId('LifeOverview-WorldCard').filter({ hasText: 'Legacy Face' });
    await expect(rich).toBeVisible({ timeout: 15_000 });
    await expect(legacy).toBeVisible();

    // POST-CONDITION 1: the practice-language name AND its translation.
    await expect(rich.getByText(TITLE, { exact: true })).toBeVisible();
    await expect(rich.getByTestId('LifeOverview-WorldCard-TitleNative')).toHaveText(
      TITLE_NATIVE,
    );

    // POST-CONDITION 2: the STORY LINE is the saga's teaser, not the pending
    // stub. This is the reported defect — every card read "Your story is being
    // written…" because nothing ever wrote a teaser.
    await expect(rich.getByText(TEASER)).toBeVisible();

    // POST-CONDITION 3: a legacy saga gets NO native line — the half that
    // stops "render it unconditionally" from passing.
    await expect(legacy.getByTestId('LifeOverview-WorldCard-TitleNative')).toHaveCount(0);

    await captureBeat(page, testInfo, 'overview-card-title-native');
  });

  test('LIFE-BACKDROP-26 — tapping the location ribbon reveals the native place name', async ({}, testInfo) => {
    // The opening node carries the backdropIntent, so this drives the REAL
    // path — model field → ZBackdropIntent → LifeScreen → ribbon — rather than
    // reading back the doc the test itself seeded. `locationLabelNative` is on
    // the intent, which is the seam LIFE-BACKDROP-26 adds.
    await installLifeMock(page, {
      steps: [
        {
          node: {
            kind: 'branch',
            beats: [
              {
                speaker: 'narrator',
                practiceText: '',
                nativeText: 'The harbour is loud with gulls and diesel.',
              },
            ],
            backdropIntent: {
              locationType: 'harbour',
              vibe: 'modern_city',
              persistent: true,
              locationLabel: PLACE,
              locationLabelNative: PLACE_NATIVE,
            },
          },
          options: [
            { id: 'walk', practiceText: 'Longer le quai', nativeText: 'Walk the quay' },
            { id: 'wait', practiceText: 'Attendre', nativeText: 'Wait' },
          ],
        },
      ],
      scenes: [minimalBackdropSvg(), minimalBackdropSvg()],
    });
    await page.goto(`/wurlds/${RICH_WORLD_ID}`);
    await page.waitForLoadState('domcontentloaded');

    // A seeded world with a saga and 0 events opens on the intro overlay
    // (LIFE-FLOW-5). It sits OVER the stage, so the ribbon is in the DOM but
    // not clickable until Begin dismisses it — an assertion made without this
    // passes on text and then fails on the tap, for a reason that has nothing
    // to do with the invariant.
    await page.getByTestId('LifeScreen-WorldIntro-Begin').click({ timeout: 20_000 });

    // The ribbon is suppressed until a REAL backdrop paints (LIFE-BACKDROP-16),
    // so waiting for the practice label also proves a scene resolved.
    const ribbon = page.getByTestId('LifeScreen-LocationRibbon');
    await expect(ribbon).toHaveText(PLACE, { timeout: 20_000 });

    // POST-CONDITION 1: it is an affordance, not decoration.
    await expect(ribbon).toHaveAttribute('aria-label', PLACE_NATIVE);

    // POST-CONDITION 2: the tap swaps the text to the system language.
    await ribbon.click();
    await expect(ribbon).toHaveText(PLACE_NATIVE);
    await captureBeat(page, testInfo, 'location-ribbon-revealed');

    // POST-CONDITION 3: it is a REVEAL, not a toggle — the story's own words
    // come back on their own. RIBBON_REVEAL_MS is 2500.
    await expect(ribbon).toHaveText(PLACE, { timeout: 8_000 });
  });
});
