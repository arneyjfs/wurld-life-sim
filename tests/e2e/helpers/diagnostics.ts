/**
 * Failure diagnostics for the E2E harness — LIFE-FLOW-7.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * `LIFE-FLOW-7` cost two full emulator runs to get as far as "the screen
 * remounted", and the only reason it got that far is that Playwright happens
 * to dump an accessibility snapshot into `error-context.md`. Two signals that
 * would have named the cause on the first run were both being thrown away:
 *
 *   1. **The page console.** `src/lib/log.ts` routes `log.warn` to
 *      `console.warn` in dev, which is what the E2E runs, so
 *      `[useDocSnapshot] schema drift` and `[useCollectionSnapshot] listener
 *      error` are already emitted at exactly the moment they matter. Nothing
 *      in the harness listened, so they went to the void.
 *
 *   2. **The unmount itself.** A screen leaving the DOM mid-test is invisible
 *      to assertions — by the time anything fails, the screen has remounted
 *      and looks ordinary. What was on screen INSTEAD, for those few frames,
 *      is the whole diagnosis: `AppRoutes` is a `switch (gate.phase)` where
 *      `case 'app'` is the only arm that renders the shell, so whatever
 *      replaced it names the phase the gate flipped to.
 *
 * Both are test-side only. Nothing here requires a product change, which
 * matters because the product change this is meant to inform has not been
 * decided yet (see the LIFE-FLOW-7 row in docs/specs/life-sim.md).
 *
 * ⚠ `tests/e2e` is excluded from `tsc -b` AND from ESLint, so this file has no
 * static gate at all — it is only ever checked by a live run. Keep it simple.
 */
import { writeFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';

/** Cap so a console-spamming page cannot balloon the attachment. */
const MAX_LINES = 2_000;

export type ConsoleCapture = {
  readonly lines: string[];
  /** Drop everything captured so far — call per test in a serial block, or
   *  the attachment is the whole file's history rather than this test's. */
  reset(): void;
};

/**
 * Buffer `console.*` and uncaught page errors. Attach with
 * `attachDiagnostics`; on its own this only collects.
 */
export function captureConsole(page: Page): ConsoleCapture {
  const lines: string[] = [];
  const push = (line: string) => {
    if (lines.length < MAX_LINES) lines.push(line);
  };
  page.on('console', (msg) => {
    push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err: unknown) => {
    const e = err as { stack?: string } | undefined;
    push(`[pageerror] ${e?.stack ?? String(err)}`);
  });
  return {
    lines,
    reset: () => {
      lines.length = 0;
    },
  };
}

/**
 * Record every time `[data-testid="<testid>"]` enters or leaves the DOM, with
 * the testids that were present at that instant.
 *
 * Installed via `addInitScript`, so it re-arms on every navigation and the log
 * is per-navigation — which is per-test for specs that `goto` once.
 *
 * The "what else was on screen" list is the payload. A screen that vanishes
 * and comes back tells you nothing; a screen that vanishes while
 * `ProfileCompletion-*` / `PermissionsWalkthrough-*` / a bare spinner is
 * mounted tells you which `decideGate` branch evicted it.
 */
export async function watchMount(page: Page, testid: string): Promise<void> {
  await page.addInitScript((id: string) => {
    const w = window as unknown as { __mountLog?: unknown[] };
    w.__mountLog = [];
    let present: boolean | null = null;
    const tick = () => {
      const now = !!document.querySelector(`[data-testid="${id}"]`);
      if (now === present) return;
      present = now;
      w.__mountLog!.push({
        t: Date.now(),
        mounted: now,
        // Bounded: enough to identify the screen, not the whole tree.
        testids: Array.from(document.querySelectorAll('[data-testid]'))
          .slice(0, 40)
          .map((el) => el.getAttribute('data-testid')),
      });
    };
    const start = () => {
      tick();
      new MutationObserver(tick).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }, testid);
}

/** Read back what `watchMount` recorded for the current navigation. */
export async function readMountLog(page: Page): Promise<unknown[]> {
  try {
    return await page.evaluate(
      () => (window as unknown as { __mountLog?: unknown[] }).__mountLog ?? [],
    );
  } catch {
    // Page closed / navigating — a missing log must never mask the real failure.
    return [];
  }
}

/**
 * Attach the captured diagnostics to a FAILED test. No-op on success, so a
 * green run carries no extra weight in the report.
 *
 * Call from `afterEach`. Never throws: a diagnostic that fails the test it is
 * diagnosing is worse than no diagnostic.
 */
export async function attachDiagnostics(
  testInfo: TestInfo,
  page: Page,
  consoleCapture: ConsoleCapture,
): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) return;

  /**
   * ⚠ WRITE THE FILE, THEN ATTACH THE PATH — do NOT attach a `body`.
   *
   * The first version of this used `testInfo.attach(name, { body })`, which
   * hands the bytes to the REPORTER. The `list` reporter (what the gate and
   * every ad-hoc run use) keeps no attachment store, so the diagnostics
   * evaporated: a 15-minute hunt reproduced the failure three times and
   * produced `error-context.md` and a screenshot, and not one byte of the
   * console or mount log that the run existed to capture.
   *
   * `testInfo.outputPath()` is the per-test directory Playwright already
   * preserves on failure — the one the screenshot lands in — so a file
   * written there survives regardless of reporter, and the `path` form of
   * `attach` still registers it for the HTML report when one is used.
   */
  const dump = async (name: string, contentType: string, body: string) => {
    const path = testInfo.outputPath(name);
    writeFileSync(path, body, 'utf8');
    await testInfo.attach(name, { path, contentType });
  };

  try {
    if (consoleCapture.lines.length > 0) {
      await dump('page-console.txt', 'text/plain', consoleCapture.lines.join('\n'));
    }
    const mounts = await readMountLog(page);
    if (mounts.length > 0) {
      await dump('mount-log.json', 'application/json', JSON.stringify(mounts, null, 2));
    }
  } catch {
    /* diagnostics are best-effort by construction */
  }
}
