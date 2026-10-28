import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * I18N-EDGE-2.1 (docs/specs/i18n.md) — a stale app picking a locale saves the
 * choice first, and a failed chunk load updates + reloads, at most once.
 */

const prefsSet = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('@/lib/prefs', () => ({
  prefs: { get: vi.fn(async () => null), set: (...a: unknown[]) => prefsSet(...a) },
}));

const logError = vi.fn();
const logWarn = vi.fn();
vi.mock('@/lib/log', () => ({
  error: (...a: unknown[]) => logError(...a),
  warn: (...a: unknown[]) => logWarn(...a),
}));

import { recoverFromLocaleLoadFailure } from './localeRecovery';
import {
  _setLocaleLoaderForTests,
  setLocaleLoadRecovery,
  useI18nStore,
} from './store';

function deps(over: Partial<Parameters<typeof recoverFromLocaleLoadFailure>[1]> = {}) {
  return {
    online: () => true,
    checkForUpdate: vi.fn(async () => 'up-to-date' as const),
    reload: vi.fn(),
    ...over,
  };
}

describe('I18N-EDGE-2.1 — recovery after a failed locale load', () => {
  beforeEach(() => sessionStorage.clear());

  it('I18N-EDGE-2.1 — a waiting update is applied (and that reloads)', async () => {
    const d = deps({ checkForUpdate: vi.fn(async () => 'updated' as const) });
    await recoverFromLocaleLoadFailure('fr', d);
    expect(d.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it('I18N-EDGE-2.1 — nothing to apply: reload once anyway (a stale browser tab)', async () => {
    const d = deps();
    await recoverFromLocaleLoadFailure('fr', d);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it('I18N-EDGE-2.1 — at most once per locale per session: no reload loop', async () => {
    const d = deps();
    await recoverFromLocaleLoadFailure('fr', d);
    await recoverFromLocaleLoadFailure('fr', d);
    expect(d.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(d.reload).toHaveBeenCalledTimes(1);
    // A different locale is its own attempt.
    await recoverFromLocaleLoadFailure('de', d);
    expect(d.reload).toHaveBeenCalledTimes(2);
  });

  it('I18N-EDGE-2.1 — offline: do nothing (I18N-EDGE-2 English fallback stands)', async () => {
    const d = deps({ online: () => false });
    await recoverFromLocaleLoadFailure('fr', d);
    expect(d.checkForUpdate).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
  });
});

describe('I18N-EDGE-2.1 — setLocale saves first and recovers on failure', () => {
  beforeEach(() => {
    prefsSet.mockClear();
    useI18nStore.setState({ locale: 'en', loading: false });
  });

  it('I18N-EDGE-2.1 — a failed load still persists the choice and hands off to recovery', async () => {
    const recovery = vi.fn(async () => undefined);
    setLocaleLoadRecovery(recovery);
    _setLocaleLoaderForTests(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    try {
      const result = await useI18nStore.getState().setLocale('fr');
      expect(result).toBe('en');
      expect(prefsSet).toHaveBeenCalledWith('wurld:ui-locale', 'fr');
      expect(recovery).toHaveBeenCalledWith('fr');
    } finally {
      _setLocaleLoaderForTests(null);
      setLocaleLoadRecovery(null);
    }
  });

  it('I18N-EDGE-2.1 — a successful load does not recover', async () => {
    const recovery = vi.fn(async () => undefined);
    setLocaleLoadRecovery(recovery);
    _setLocaleLoaderForTests(async () => ({ default: { 'settings.language.title': 'Langues' } }));
    try {
      expect(await useI18nStore.getState().setLocale('fr')).toBe('fr');
      expect(recovery).not.toHaveBeenCalled();
      expect(prefsSet).toHaveBeenCalledWith('wurld:ui-locale', 'fr');
    } finally {
      _setLocaleLoaderForTests(null);
      setLocaleLoadRecovery(null);
    }
  });
});

describe('I18N-EDGE-2.2 — a stale chunk is a warning; only an unrecovered one is an error', () => {
  beforeEach(() => {
    sessionStorage.clear();
    logError.mockClear();
    logWarn.mockClear();
    useI18nStore.setState({ locale: 'en', loading: false });
  });

  it('I18N-EDGE-2.2 — a failed load is logged as a warning, not reported as an error', async () => {
    setLocaleLoadRecovery(vi.fn(async () => undefined));
    _setLocaleLoaderForTests(() =>
      Promise.reject(new TypeError("'text/html' is not a valid JavaScript MIME type.")),
    );
    try {
      await useI18nStore.getState().setLocale('fr');
      expect(logError).not.toHaveBeenCalled();
      expect(logWarn).toHaveBeenCalledWith(
        'i18n: locale chunk failed to load',
        expect.objectContaining({ code: 'fr' }),
      );
    } finally {
      _setLocaleLoaderForTests(null);
      setLocaleLoadRecovery(null);
    }
  });

  it('I18N-EDGE-2.2 — the first failure reloads without reporting an error', async () => {
    await recoverFromLocaleLoadFailure('fr', deps());
    expect(logError).not.toHaveBeenCalled();
  });

  it('I18N-EDGE-2.2 — still failing after the one recovery reload IS reported', async () => {
    const d = deps();
    await recoverFromLocaleLoadFailure('fr', d);
    await recoverFromLocaleLoadFailure('fr', d);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'i18n.localeRecovery', code: 'fr' }),
    );
  });

  it('I18N-EDGE-2.2 — offline is not reported (nothing is broken)', async () => {
    await recoverFromLocaleLoadFailure('fr', deps({ online: () => false }));
    expect(logError).not.toHaveBeenCalled();
  });
});
