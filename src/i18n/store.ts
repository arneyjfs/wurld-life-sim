import { create } from 'zustand';
import { prefs } from '@/lib/prefs';
import en, { type Messages } from './locales/en';
import { findLocale, resolveLocale } from './supported';
import * as log from '@/lib/log';

const PREFS_KEY = 'wurld:ui-locale';

type State = {
  /** Active BCP-47 code. Always present — defaults to `en` so the first
   *  render has SOMETHING to display even before async resolution finishes. */
  locale: string;
  /** Resolved messages for the active locale. Other-locale files are
   *  Partial<Messages>; the `t()` helper falls back to the English value
   *  when a key is missing. Stored as the merged map so lookups are O(1)
   *  without an extra fallback step. */
  messages: Messages;
  /** True while a setLocale dynamic import is in flight. UI can branch on
   *  this for a brief skeleton if locale-swap latency matters; today we
   *  keep the previous strings on screen during the swap. */
  loading: boolean;
};

type Actions = {
  /** Load and apply a locale. Persists to prefs, sets `<html lang/dir>`,
   *  notifies subscribers. Safe to call repeatedly with the same code —
   *  early-outs after the first load.
   *
   *  Returns the resolved code (i.e. after the fallback chain in
   *  `resolveLocale`) so callers can confirm what was actually applied
   *  if they passed a candidate that didn't match exactly. */
  setLocale: (code: string) => Promise<string>;
  /** Resolve the initial locale on app boot. Order:
   *    1. prefs(PREFS_KEY)            — explicit user choice wins
   *    2. profile.nativeLanguage hint — passed in if signed in
   *    3. navigator.language          — system locale
   *    4. 'en'                        — final fallback
   *  Use `init({ nativeLanguageHint })` from main.tsx or App.tsx. */
  init: (opts?: { nativeLanguageHint?: string | null }) => Promise<string>;
};

/**
 * Loaders are statically declared so Vite can chunk each locale file
 * separately. Picking a locale at runtime triggers exactly one network
 * fetch (the chosen locale's chunk); the others stay off the wire.
 *
 * Using `import.meta.glob` rather than a hand-rolled switch so a new
 * locale file in `./locales/` is wired in automatically.
 */
const loaders = import.meta.glob<{ default: Partial<Messages> }>(
  './locales/*.ts',
);

type LocaleLoader = () => Promise<{ default: Partial<Messages> }>;

let loaderOverride: ((code: string) => ReturnType<LocaleLoader>) | null = null;
/** Test seam: replace every locale load with this. `null` restores the glob. */
export function _setLocaleLoaderForTests(fn: ((code: string) => ReturnType<LocaleLoader>) | null): void {
  loaderOverride = fn;
}

function loaderFor(code: string): LocaleLoader | null {
  if (loaderOverride) {
    const fn = loaderOverride;
    return () => fn(code);
  }
  return loaders[`./locales/${code}.ts`] ?? null;
}

/**
 * I18N-EDGE-2.1 — what to do when a locale chunk fails to load. Loaded lazily
 * so the service-worker update path never lands in the boot bundle; `null`
 * restores the default (tests inject their own).
 */
type Recovery = (code: string) => Promise<void>;
let recoveryOverride: Recovery | null = null;
export function setLocaleLoadRecovery(fn: Recovery | null): void {
  recoveryOverride = fn;
}
function recover(code: string): void {
  const run: Promise<void> = recoveryOverride
    ? recoveryOverride(code)
    : import('./localeRecovery').then((m) => m.recoverFromLocaleLoadFailure(code));
  run.catch((err: unknown) => log.warn('i18n: locale recovery failed', { err, code }));
}

export const useI18nStore = create<State & Actions>((set, get) => ({
  locale: 'en',
  messages: en,
  loading: false,

  async setLocale(code) {
    const resolved = resolveLocale(code);
    if (get().locale === resolved) return resolved;

    if (resolved === 'en') {
      set({ locale: 'en', messages: en, loading: false });
      applyDocumentLang('en');
      void prefs.set(PREFS_KEY, 'en');
      return 'en';
    }

    const loader = loaderFor(resolved);
    if (!loader) {
      // No file for this locale yet — keep current strings, but persist
      // the user's preference so when the file ships later it auto-
      // activates on next boot. Log so the gap is visible in Sentry
      // breadcrumbs.
      log.warn('i18n: locale not bundled, falling back', { requested: code, resolved });
      return get().locale;
    }

    // I18N-EDGE-2.1 — save the choice BEFORE loading, so a reload that
    // recovers from a stale chunk boots straight into it.
    void prefs.set(PREFS_KEY, resolved);
    set({ loading: true });
    try {
      const mod = await loader();
      // Shallow-merge over English so untranslated keys fall through to
      // the source-of-truth rather than rendering the raw key path.
      const merged: Messages = { ...en, ...(mod.default ?? {}) } as Messages;
      set({ locale: resolved, messages: merged, loading: false });
      applyDocumentLang(resolved);
      return resolved;
    } catch (err) {
      // I18N-EDGE-2.2 — a breadcrumb, not a Sentry error: the stale-chunk case
      // is expected after every deploy and recover() handles it. recover()
      // reports the failure that survives its one reload.
      log.warn('i18n: locale chunk failed to load', {
        code: resolved,
        err: err instanceof Error ? err.message : String(err),
      });
      set({ loading: false });
      // I18N-EDGE-2.1 — almost always a stale app asking for a chunk name an
      // earlier deploy produced. Update and reload, once.
      recover(resolved);
      return get().locale;
    }
  },

  async init({ nativeLanguageHint } = {}) {
    let candidate: string | null | undefined = await prefs.get(PREFS_KEY);
    if (!candidate && nativeLanguageHint) {
      candidate = mapNativeLanguageNameToCode(nativeLanguageHint);
    }
    if (!candidate && typeof navigator !== 'undefined') {
      candidate = navigator.language;
    }
    return get().setLocale(candidate ?? 'en');
  },
}));

function applyDocumentLang(code: string) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = code;
  document.documentElement.dir = findLocale(code)?.dir ?? 'ltr';
}

/**
 * `profile.nativeLanguage` is stored as the English NAME (`"Spanish"`)
 * not a BCP-47 code, so map it back. This is best-effort — when no
 * match the caller falls through to `navigator.language` next.
 */
function mapNativeLanguageNameToCode(englishName: string): string | null {
  // Imported lazily to dodge a cycle: `lib/languages` doesn't import i18n
  // but i18n's static imports load on module init, which would otherwise
  // run before the React tree mounts and could deadlock if the languages
  // module ever grows a runtime dependency.
  // Lazy-require pattern in TS-with-ESM: a dynamic import in the init()
  // call site rather than here keeps this fn pure. So: caller-side
  // mapping. For now we do a tiny inline guess.
  const lower = englishName.toLowerCase();
  // Minimal hand mapping covering the most common cases. The full table
  // is in `src/lib/languages.ts` (LanguageInfo[]) which carries the
  // ttsCode; we project that to a UI-locale base code.
  const naive: Record<string, string> = {
    english: 'en',
    spanish: 'es',
    'spanish (latin america)': 'es-419',
    'spanish (mexico)': 'es-MX',
    french: 'fr',
    'french (canadian)': 'fr-CA',
    german: 'de',
    italian: 'it',
    'portuguese (brazilian)': 'pt-BR',
    'portuguese (european)': 'pt-PT',
    dutch: 'nl',
    polish: 'pl',
    russian: 'ru',
    ukrainian: 'uk',
    turkish: 'tr',
    arabic: 'ar',
    'arabic (egypt)': 'ar',
    'arabic (saudi)': 'ar',
    hebrew: 'he',
    persian: 'fa',
    'chinese (mandarin)': 'zh-CN',
    'chinese (taiwan)': 'zh-TW',
    japanese: 'ja',
    korean: 'ko',
    hindi: 'hi',
    indonesian: 'id',
    vietnamese: 'vi',
    thai: 'th',
    swedish: 'sv',
    norwegian: 'no',
    danish: 'da',
    finnish: 'fi',
  };
  return naive[lower] ?? null;
}
