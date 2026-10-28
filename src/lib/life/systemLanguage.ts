/**
 * LIFE-LANG-7: resolve a wurld's SYSTEM LANGUAGE — the language its
 * NARRATION is written in — from the ACTIVE i18n UI locale at world
 * creation.
 *
 * The system language is captured as a language NAME the model
 * understands (e.g. "English", "Spanish", "Chinese (Mandarin)"). We
 * PREFER the user's own `nativeLanguage` / `practiceLanguage` name
 * strings when the active locale maps to one of them, so the
 * downstream string comparisons are EXACT:
 *   - `systemLanguage === practiceLanguage` gates immersion vocab on
 *     narration (LIFE-LANG-8/10),
 *   - `systemLanguage !== nativeLanguage` gates the setup warning
 *     (LIFE-LANG-7).
 * A user running the app in a THIRD language (neither their native
 * nor practice tongue) gets that locale's English exonym; anything
 * unmappable falls back to `nativeLanguage`.
 *
 * Spec: docs/specs/life-sim.md §9.6 (LIFE-LANG-7).
 */
import { chatLanguageToUILocale } from '@/i18n/chatLanguageMapping';
import { findLocale } from '@/i18n/supported';

export function resolveSystemLanguage(opts: {
  /** Active BCP-47 UI locale code (`useI18nStore().locale`). */
  activeLocale: string;
  /** The user's native-language NAME (profile.nativeLanguage). */
  nativeLanguage: string;
  /** The world's practice-language NAME (profile.learningLanguage). */
  practiceLanguage: string;
}): string {
  const { activeLocale, nativeLanguage, practiceLanguage } = opts;
  // Prefer the user's OWN language names so `=== nativeLanguage` /
  // `=== practiceLanguage` comparisons downstream are exact.
  if (chatLanguageToUILocale(nativeLanguage) === activeLocale) {
    return nativeLanguage;
  }
  if (chatLanguageToUILocale(practiceLanguage) === activeLocale) {
    return practiceLanguage;
  }
  // A third UI language: the locale table's English exonym is a name
  // the model understands; unmappable → fall back to native.
  return findLocale(activeLocale)?.englishName ?? nativeLanguage;
}
