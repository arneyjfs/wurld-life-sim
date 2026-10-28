import type { BrowserContext, Page } from '@playwright/test';

/**
 * NAV-BETA-1 / SETTINGS-BETA-4 — seed beta flags before the app boots.
 *
 * Writes the `zustand/persist` record directly. This is byte-identical to what
 * the app's own `?betaFlag=<key>=<0|1>` hook writes (`src/lib/testHooks.ts`,
 * store `name: 'wurld-beta-flags'`, default `version: 0`) and avoids that
 * hook's mid-boot `location.reload()`, which can abort a concurrent
 * `page.goto` with an interrupted-navigation error — `installTestHooks()` runs
 * at module top of `src/main.tsx`, i.e. before the load event.
 *
 * ⚠ Seed on the CONTEXT where you can. `addInitScript` runs before every
 * subsequent navigation's own scripts, so a context-level seed covers pages
 * opened later; a page-level seed covers only that page.
 *
 * Why every Wurlds spec needs this as of 2026-09-22: the section went back
 * behind `lifeSimBeta`, and the gate is on the ROUTE as well as the tab
 * (`BetaRouteGate`), so an unseeded `goto('/wurlds')` now redirects to `/`.
 */
export async function enableBetaFlags(
  target: BrowserContext | Page,
  flags: string[],
): Promise<void> {
  await target.addInitScript((keys: string[]) => {
    try {
      const raw = localStorage.getItem('wurld-beta-flags');
      const parsed = raw ? JSON.parse(raw) : { state: { flags: {} }, version: 0 };
      const next = (parsed?.state?.flags ?? {}) as Record<string, boolean>;
      for (const key of keys) next[key] = true;
      localStorage.setItem(
        'wurld-beta-flags',
        JSON.stringify({ state: { flags: next }, version: parsed?.version ?? 0 }),
      );
    } catch {
      // Private mode / blocked storage — the spec that needs the flag will
      // fail on its own assertion, which is a clearer signal than throwing
      // inside an init script.
    }
  }, flags);
}

/** The common case: unlock the Wurlds section. */
export function enableWurlds(target: BrowserContext | Page): Promise<void> {
  return enableBetaFlags(target, ['lifeSimBeta']);
}
