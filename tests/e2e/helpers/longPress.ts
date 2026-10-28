/**
 * Long-press helper for E2E tests.
 *
 * The app's useLongPress hook (src/hooks/useLongPress.ts) listens for
 * onPointerDown / Move / Up with a 450ms threshold. Playwright's mouse
 * API fires synthetic pointer events that React can pick up, so we
 * just need to:
 *   1. move to the centre of the locator's bounding box
 *   2. press the left button
 *   3. hold past the 450ms threshold (we wait 700ms for headroom)
 *   4. release
 *
 * The hook also cancels if the pointer moves more than `cancelDistance`
 * (default 8px) — we explicitly hold the cursor still by re-calling
 * move() on the same coords if you need to compensate for any small
 * drift; in practice the click() flow stays stationary.
 */

import { Locator, Page } from '@playwright/test';

const DEFAULT_HOLD_MS = 700;

export async function longPressBubble(
  page: Page,
  bubble: Locator,
  holdMs = DEFAULT_HOLD_MS,
): Promise<void> {
  await bubble.scrollIntoViewIfNeeded();
  const box = await bubble.boundingBox();
  if (!box) throw new Error('longPressBubble: bubble has no bounding box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Hold past the 450ms threshold without moving the cursor.
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}
