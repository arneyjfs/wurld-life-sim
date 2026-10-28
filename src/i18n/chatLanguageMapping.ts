/**
 * Map chat-language English NAMES (the form stored on
 * `profile.nativeLanguage` / `profile.learningLanguage`) to the
 * BCP-47 codes used by the UI-locale system in `./supported.ts`.
 *
 * The chat-language table at `src/lib/languages.ts` lives in
 * "Gemini-TTS-coded" form (`es-ES`, `cmn-CN`, `fil-PH`, `nb-NO`); the
 * UI-locale table uses base codes + a few regional splits (`es`,
 * `zh-CN`, `fil`, `no`, `pt-BR`/`pt-PT`). Those two lists overlap
 * heavily but aren't identical — this helper does the projection.
 *
 * Returns `null` when the chat language has no app translation yet.
 * Callers (the in-Settings "Use as display language" radio) use this
 * to gate the radio: `null` → disabled with a "falls back to English"
 * note.
 */

import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import { SUPPORTED_LOCALE_CODES } from './supported';

/**
 * Hand-tuned overrides for chat languages whose BCP-47 prefix doesn't
 * match a UI locale 1:1. Keep this list TIGHT — every entry here is a
 * decision we want a reviewer to be able to spot at a glance.
 *
 *  - `cmn-CN` / `cmn-TW` — Google's TTS uses the ISO 639-3 form for
 *    Mandarin; the UI ecosystem (Intl, manifest, browser locale) uses
 *    `zh-CN` / `zh-TW`.
 *  - `nb-NO` — TTS singles out Bokmål; the UI locale is the more
 *    general "Norwegian" (`no`), which most users + native speakers
 *    treat as the same thing.
 *  - The Indian-English / Australian-English / British-English entries
 *    all collapse to `en` — we don't have separate UI translations for
 *    those, and the BCP-47 fallback chain would do the right thing
 *    anyway.
 */
const TTS_TO_UI_OVERRIDES: Record<string, string> = {
  'cmn-CN': 'zh-CN',
  // Google ships the Taiwan code lowercase-region as `cmn-tw` (matched
  // verbatim in languages.ts after the TTS audit).
  'cmn-tw': 'zh-TW',
  'nb-NO': 'no',
  'en-US': 'en',
  'en-GB': 'en',
  'en-AU': 'en',
  'en-IN': 'en',
};

/**
 * Project a chat-language name to a UI-locale code. Returns `null` if
 * the language doesn't have an app translation.
 */
export function chatLanguageToUILocale(languageName: string | undefined | null): string | null {
  if (!languageName) return null;
  const entry = SUPPORTED_LANGUAGES.find((l) => l.name === languageName);
  if (!entry) return null;
  return ttsCodeToUILocale(entry.ttsCode);
}

function ttsCodeToUILocale(ttsCode: string): string | null {
  const override = TTS_TO_UI_OVERRIDES[ttsCode];
  if (override) return SUPPORTED_LOCALE_CODES.has(override) ? override : null;
  // Direct match (`pt-BR`, `es-MX`, `es-419`, `fr-CA`).
  if (SUPPORTED_LOCALE_CODES.has(ttsCode)) return ttsCode;
  // Fall through to base language (`es-ES` → `es`, `de-DE` → `de`).
  const base = ttsCode.split('-')[0]!;
  if (SUPPORTED_LOCALE_CODES.has(base)) return base;
  return null;
}
