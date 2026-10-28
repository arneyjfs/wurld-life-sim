import { useI18nStore } from '@/i18n/store';
import { SUPPORTED_LOCALES } from '@/i18n/supported';

/** The English NAME of the user's current app/display language (i18n UI
 *  locale), e.g. 'fr' → "French" — sent to the server so tutor explanations
 *  render in the language the user reads the app in (TUTOR-ACTION-7). Returns
 *  undefined if the locale isn't recognised (server falls back to native). */
export function currentAppLanguageName(): string | undefined {
  const locale = useI18nStore.getState().locale;
  return SUPPORTED_LOCALES.find((l) => l.code === locale)?.englishName;
}
