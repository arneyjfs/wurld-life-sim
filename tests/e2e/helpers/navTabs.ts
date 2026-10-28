/**
 * NAV-PRACTICE-1 / NAV-CHROME-1 (docs/specs/navigation.md) — the top-level
 * tab for a section, whichever chrome the viewport shows: the bottom tab bar
 * on a phone (`TabBar-tab-{id}`), the side rail from `lg` up
 * (`NavRail-tab-{id}`). Only one is visible at a time.
 */
import type { Locator, Page } from '@playwright/test';

export function navTab(page: Page, id: string): Locator {
  return page
    .locator(`[data-testid="TabBar-tab-${id}"]:visible, [data-testid="NavRail-tab-${id}"]:visible`)
    .first();
}
