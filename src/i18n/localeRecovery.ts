/**
 * I18N-EDGE-2.1 — a locale chunk that fails to load is almost always a STALE
 * app (docs/specs/i18n.md): the bundle it runs asks for a chunk name an
 * earlier deploy produced, and hosting now answers that path with index.html.
 * Updating to the current build is the fix; the choice has already been saved
 * (`setLocale` persists first), so the reloaded app boots into it.
 *
 * At most one attempt per locale per session: a genuinely missing file or a
 * failure the update cannot fix must not become a reload loop. After that the
 * I18N-EDGE-2 English fallback stands.
 */
import { checkForUpdateAndApply, type UpdateCheckOutcome } from '@/lib/swUpdate';
import { whenServiceWorkerReady } from '@/lib/swRegister';
import * as log from '@/lib/log';

type Deps = {
  online: () => boolean;
  /** Activate a waiting worker and reload; resolves 'updated' when it did. */
  checkForUpdate: () => Promise<UpdateCheckOutcome>;
  reload: () => void;
};

const defaultDeps: Deps = {
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  checkForUpdate: () =>
    checkForUpdateAndApply({
      getRegistration: whenServiceWorkerReady,
      reload: () => window.location.reload(),
    }),
  reload: () => window.location.reload(),
};

const attemptKey = (code: string) => `wurld:i18n:recovery:${code}`;

function alreadyAttempted(code: string): boolean {
  try {
    return sessionStorage.getItem(attemptKey(code)) === '1';
  } catch {
    // No sessionStorage (private mode): refuse rather than risk a loop.
    return true;
  }
}

function markAttempted(code: string): void {
  try {
    sessionStorage.setItem(attemptKey(code), '1');
  } catch {
    /* alreadyAttempted() already refuses in this case */
  }
}

export async function recoverFromLocaleLoadFailure(code: string, deps: Deps = defaultDeps): Promise<void> {
  if (!deps.online()) return;
  if (alreadyAttempted(code)) {
    // I18N-EDGE-2.2 — the update/reload did not fix it (or there is no
    // sessionStorage to allow one): the user is stuck in English. Report it.
    log.error(new Error(`i18n: locale chunk still fails to load after recovery`), {
      action: 'i18n.localeRecovery',
      code,
    });
    return;
  }
  markAttempted(code);
  log.warn('i18n: locale chunk failed to load; updating and reloading', { code });
  const outcome = await deps.checkForUpdate().catch((): UpdateCheckOutcome => 'unsupported');
  // 'updated' has already reloaded into the new build. Otherwise there was no
  // worker to swap (a browser tab, or no update pending): a plain reload still
  // fetches the current index.html and its current chunk names.
  if (outcome !== 'updated') deps.reload();
}
