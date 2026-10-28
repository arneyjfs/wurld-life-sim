/**
 * Tap the in-app back arrow (`data-testid="nav-back"`) and make sure the tap
 * actually reached the page.
 *
 * MEASURED 2026-09-30 (docs/specs/navigation.md, NAV-BACK-2 "harness note"):
 * on webkit-mobile, about 1 run in 15 of a click made right after a cold
 * `page.goto()` never reaches the document. Playwright reports the click as
 * done, but no `click` event arrives even at a capture listener on `window`,
 * so `useAppBack` never runs and the URL never changes. An instrumented run
 * recorded the boot seeding, the router's stamp, and then nothing at all for
 * 15 seconds. It happens on the base commit too; it is not an app behaviour.
 *
 * So this helper counts the arrow taps the page actually receives, and taps
 * again only while that count is still ZERO. A tap that did land is never
 * repeated, so a slow pop can never turn into a double back: a real
 * regression (the tap lands and back does nothing) still fails the caller's
 * own URL assertion.
 */
import { expect, test, type Page } from '@playwright/test';

type TapWindow = { __navBackTaps?: number; __navBackHook?: boolean };

export async function tapNavBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as TapWindow;
    w.__navBackTaps = 0;
    if (w.__navBackHook) return;
    w.__navBackHook = true;
    window.addEventListener(
      'click',
      (e) => {
        const t = e.target as Element | null;
        if (t?.closest?.('[data-testid="nav-back"]')) w.__navBackTaps = (w.__navBackTaps ?? 0) + 1;
      },
      true,
    );
  });
  // Tap only the arrow of the page the URL names, once it is on screen alone.
  // React Router renders a navigation inside startTransition, so while the
  // next screen's lazy chunk loads (BOOT-SPLIT-2: prefetched on idle, so only
  // under load) the URL has already moved but the OLD page is still the one
  // slot on screen, with the only `nav-back` in the DOM. That arrow resolves
  // back from its own location, so after a push from /tips to a Try-it screen
  // it climbed /tips → / (a chromium flake under load in the 0.3.1 release
  // run; reproduced 8/8 at 6x CPU throttle). The URL changing is not the new
  // page being shown.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const slots = [...document.querySelectorAll('[data-testid="nav-slot"]')];
          return (
            slots.length === 1 &&
            slots[0]?.getAttribute('data-nav-path') === location.pathname &&
            slots[0]?.querySelector('[data-testid="nav-back"]') !== null
          );
        }),
      { message: 'the page the URL names is not settled on screen with its back arrow', timeout: 20_000 },
    )
    .toBe(true);
  const taps = () => page.evaluate(() => (window as unknown as TapWindow).__navBackTaps ?? 0);
  let attempts = 0;
  await expect(async () => {
    if ((await taps()) === 0) {
      attempts += 1;
      await page.getByTestId('nav-back').click({ timeout: 5_000 });
    }
    expect(await taps(), 'the back-arrow tap never reached the page').toBeGreaterThan(0);
  }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });
  // Kept visible in the report: a re-tap is the harness defect above, and
  // how often it happens is the evidence that it is still that and nothing new.
  if (attempts > 1) {
    test.info().annotations.push({ type: 'nav-back-retap', description: `${attempts} taps` });
    console.log(`NAVBACK-RETAP ${attempts} taps (${test.info().title})`);
  }
}
