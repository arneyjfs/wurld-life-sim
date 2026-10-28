import { expect, type Page } from '@playwright/test';

/** SETTINGS-GROUP-1 keys (docs/specs/settings-screen.md). */
export type SettingsGroupKey = 'languages' | 'learning' | 'app' | 'help';

/**
 * SETTINGS-GROUP-2 — a collapsed group's members are not mounted, so a spec
 * opens the group before it reaches for anything inside. Idempotent: an open
 * group (a default, or remembered per device, SETTINGS-GROUP-4) stays open.
 */
export async function openSettingsGroup(page: Page, key: SettingsGroupKey) {
  const toggle = page.getByTestId(`settings-group-${key}-toggle`);
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/**
 * SETTINGS-HELP-2 — Account deletion is one disclosure below Help & about.
 * Opens both, so `delete-account-button` is mounted.
 */
export async function openAccountDeletion(page: Page) {
  await openSettingsGroup(page, 'help');
  const toggle = page.getByTestId('settings-account-deletion-toggle');
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}
