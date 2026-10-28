/**
 * Screenshot capture helper for beat-based visual review.
 *
 * Specs call `captureBeat(page, 'beat-name')` at named moments
 * ("optimistic", "translation-arrived", "menu-open", "modal-closed"...).
 * Files land at:
 *
 *   screenshots/<run-id>/<spec-file>/<beat>.png
 *
 * After the run, the agent reads every PNG with the Read tool — Claude
 * is multimodal — and looks for visual bugs (off-by-1, dark-mode
 * regressions, animation flashes). See docs/TESTING_PLAN.md "Visual
 * review" for the checklist.
 *
 * `run-id` defaults to a timestamp; pass RUN_ID=<x> for a stable
 * directory (handy when bisecting a regression: RUN_ID=baseline before,
 * RUN_ID=fix after, then diff).
 */
import type { Page, TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

const RUN_ID = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOTS_ROOT = join(process.cwd(), '..', '..', 'screenshots', RUN_ID);

/**
 * Capture a full-page screenshot tagged by spec + beat. Idempotent
 * directory creation. Records the path on `testInfo` so the HTML
 * reporter surfaces it.
 */
export async function captureBeat(
  page: Page,
  testInfo: TestInfo,
  beat: string,
  opts: { fullPage?: boolean } = {},
): Promise<string> {
  const specFile = basename(testInfo.file, '.spec.ts');
  const dir = join(SCREENSHOTS_ROOT, specFile);
  mkdirSync(dir, { recursive: true });
  // Beat names that include `/` should never reach the filesystem —
  // sanitise once defensively.
  const safeBeat = beat.replace(/[^a-z0-9-_]/gi, '_');
  const file = join(dir, `${safeBeat}.png`);
  // Brief settle so animations finish before the snap. We've seen
  // captures land mid-fade-in otherwise.
  await page.waitForTimeout(150);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false });
  // Attach to the test report so the HTML viewer renders inline.
  await testInfo.attach(`beat:${beat}`, { path: file, contentType: 'image/png' });
  return file;
}

/** Capture both light and dark variants of the same beat — useful for
 *  visual review since most dark-mode bugs only show in one mode. */
export async function captureBeatBothThemes(
  page: Page,
  testInfo: TestInfo,
  beat: string,
  opts: { fullPage?: boolean } = {},
): Promise<{ light: string; dark: string }> {
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    try {
      localStorage.setItem('wurld:theme', 'light');
    } catch {
      /* private mode / unavailable */
    }
  });
  const light = await captureBeat(page, testInfo, `${beat}-light`, opts);
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    try {
      localStorage.setItem('wurld:theme', 'dark');
    } catch {
      /* private mode / unavailable */
    }
  });
  const dark = await captureBeat(page, testInfo, `${beat}-dark`, opts);
  return { light, dark };
}

/**
 * Path resolver — handy for downstream tools that want to read the
 * captured PNGs (e.g. an LLM visual-review script). Returns the
 * absolute path the captures landed under for THIS run.
 */
export function runScreenshotsDir(): string {
  return SCREENSHOTS_ROOT;
}

void dirname; // exported for future use; keeps import tidy
