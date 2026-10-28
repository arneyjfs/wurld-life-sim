/**
 * Public surface for the i18n layer.
 *
 *   import { useT, setLocale, getLocale } from '@/i18n';
 *
 *   function MyComponent() {
 *     const t = useT();
 *     return <button>{t('common.confirm')}</button>;
 *   }
 *
 *   // Imperative path (toasts / errors composed in a non-React context):
 *   import { tImperative } from '@/i18n';
 *   pushToast({ kind: 'error', message: tImperative('common.errorGeneric') });
 *
 *  Conventions:
 *   - `t(key, params?)` substitutes `{name}` placeholders in the message.
 *   - Missing keys fall through to the English source-of-truth, then to the
 *     literal key path as a last-resort. The fallthrough avoids blanking
 *     the UI when a locale file is incomplete.
 *   - For dates/numbers, use `Intl.*` directly or the wrappers in
 *     `./format.ts`. We do NOT bake plurals into `t()` — call
 *     `Intl.PluralRules` at the call site if you need them (rare in this
 *     UI; defer until we see real demand).
 */

import { useMemo } from 'react';
import { useI18nStore } from './store';
import en, { type MessageKey, type Messages } from './locales/en';
import * as log from '@/lib/log';

export type { MessageKey, Messages };
export type TParams = Record<string, string | number>;
export { SUPPORTED_LOCALES, findLocale, isRTL, resolveLocale } from './supported';
export type { SupportedLocale } from './supported';

const PLACEHOLDER_RE = /\{(\w+)\}/g;

function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER_RE, (_, k: string) => {
    const v = params[k];
    return v === undefined ? `{${k}}` : String(v);
  });
}

function lookup(messages: Messages, key: MessageKey, params?: TParams): string {
  const fromActive = messages[key] as string | undefined;
  if (fromActive !== undefined) return interpolate(fromActive, params);
  const fromEn = en[key];
  if (fromEn !== undefined) {
    log.warn('i18n: missing key in active locale, fell back to English', { key });
    return interpolate(fromEn, params);
  }
  // Hard miss — the key doesn't exist in either active or English.
  // Return the key path so the UI doesn't crash; Sentry breadcrumb so
  // the gap is visible.
  log.warn('i18n: unknown key', { key });
  return key;
}

/**
 * React hook returning a `t()` bound to the active locale. Re-renders the
 * caller when the active locale changes. Memoised against the message
 * map so identical sequences of `t()` calls don't reallocate the wrapper.
 */
export function useT(): (key: MessageKey, params?: TParams) => string {
  const messages = useI18nStore((s) => s.messages);
  return useMemo(() => {
    return (key: MessageKey, params?: TParams) => lookup(messages, key, params);
  }, [messages]);
}

/**
 * Imperative `t()` for places we can't easily call a hook — outside the
 * React tree (e.g. inside a Zustand reducer, a `pushToast` call in a
 * `.ts` lib file, or a Cloud Function callback). Reads the live store,
 * so it tracks locale changes — but the caller doesn't re-render. Use
 * `useT()` from components.
 */
export function tImperative(key: MessageKey, params?: TParams): string {
  return lookup(useI18nStore.getState().messages, key, params);
}

/** Current active locale code. */
export function getLocale(): string {
  return useI18nStore.getState().locale;
}

/** Switch locale at runtime. Resolves to the actually-applied code (the
 *  fallback chain in `resolveLocale` may return something different from
 *  the candidate). Persisted via `prefs`. */
export function setLocale(code: string): Promise<string> {
  return useI18nStore.getState().setLocale(code);
}

/**
 * Boot-time locale resolution. Call once early in App.tsx (mounted via
 * useEffect) so prefs / nativeLanguage / navigator.language all get a
 * chance to vote before the first user-visible render.
 */
export function initI18n(opts?: {
  nativeLanguageHint?: string | null;
}): Promise<string> {
  return useI18nStore.getState().init(opts);
}
