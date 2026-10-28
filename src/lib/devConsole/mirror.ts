/**
 * DEVCON-CON-7 — the bridge from `lib/log.ts` into the dev-console buffer.
 *
 * THE BUG THIS EXISTS FOR, reported 2026-08-03: on the deployed beta build the
 * network tab worked and the console tab stayed empty. Not a rendering fault —
 * there was genuinely nothing to render.
 *
 * `consoleCapture` patches `console.*`, and `log.ts` only calls `console.*`
 * when `config.env === 'dev'`; on beta and prod it routes to Sentry
 * breadcrumbs instead. So the interceptor was installed and correct, and had
 * nothing to intercept. The network tab was unaffected because it patches
 * `fetch`, which does not care what environment it is in.
 *
 * The fix is NOT to make `log.ts` call `console.*` off dev — that would put
 * every app log into the real browser console for every user on a production
 * build, which is a different product decision wearing a bug fix's clothes.
 * Instead `log.ts` feeds the buffer directly, and only while the developer has
 * the panel switched on.
 *
 * Two properties this must have, both of which the direct route gives free:
 *  - **No double entries in dev.** Dev already reaches the buffer through the
 *    `console.*` patch, so the mirror stands down there (`log.ts` decides).
 *  - **No cost when the panel is off.** `consolePatch === null` until the beta
 *    flag flips, so this is one store read and a return.
 *
 * Spec: docs/specs/dev-console.md §3.
 */
import { redact } from './redact';
import { useDevConsoleStore } from './devConsoleStore';
import type { ConsoleLevel } from './types';

/**
 * Push one line into the console buffer, if and only if capture is installed.
 *
 * Never throws: a logger that can fail is worse than no logger, and this sits
 * on the path of every `log.info` in the app.
 */
export function mirrorToDevConsole(level: ConsoleLevel, text: string): void {
  try {
    const store = useDevConsoleStore.getState();
    if (store.consolePatch === null) return;
    store.pushConsole(level, redact(text));
  } catch {
    // Deliberately silent. Reporting a failure here would mean logging from
    // inside the logger.
  }
}
