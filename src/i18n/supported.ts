/**
 * Supported UI locales. Distinct from the chat-translation language list in
 * `src/lib/languages.ts` — that one is for the message-translation pipeline
 * (which Gemini-TTS voice to pick, what `practiceLanguage` accepts on the
 * profile). This one drives the application chrome itself: which JSON
 * messages file to load, what text to show in the locale picker, and which
 * direction (`ltr` / `rtl`) the document tree should flow.
 *
 * Locale codes are BCP-47, mapped to a flat file name in `./locales/`. We
 * use language-only codes (`fr`, `de`) for languages with one canonical UI
 * variant; for languages with meaningful regional UI splits we keep the
 * region tag (`pt-BR` ≠ `pt-PT`, `zh-CN` ≠ `zh-TW`, `es-MX` ≠ `es-ES`).
 *
 * The picker shows `nativeName` (= what a speaker of that language calls it)
 * first, with `englishName` as the sublabel. This is the de-facto industry
 * pattern — a user looking for their own language scans for the script /
 * autonym, not the English exonym.
 *
 * RTL flag drives `<html dir="rtl">` for Arabic, Hebrew, Persian, Urdu, etc.
 * Mid-render flips between LTR and RTL trigger a brief reflow — this gets
 * applied once at locale-switch time, not per component.
 */

export type SupportedLocale = {
  /** BCP-47 code. Used as the locale file name (`./locales/{code}.ts`). */
  code: string;
  /** Autonym — what speakers of this language call it. */
  nativeName: string;
  /** English exonym — sublabel in the picker. */
  englishName: string;
  /** Document writing direction. */
  dir: 'ltr' | 'rtl';
  /** Regional flag emoji (or `🌎` for region-neutral variants). */
  flag: string;
};

export const SUPPORTED_LOCALES: SupportedLocale[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', dir: 'ltr', flag: '🇺🇸' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', dir: 'ltr', flag: '🇪🇸' },
  { code: 'es-MX', nativeName: 'Español (México)', englishName: 'Spanish (Mexico)', dir: 'ltr', flag: '🇲🇽' },
  { code: 'es-419', nativeName: 'Español (Latinoamérica)', englishName: 'Spanish (Latin America)', dir: 'ltr', flag: '🌎' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', dir: 'ltr', flag: '🇫🇷' },
  { code: 'fr-CA', nativeName: 'Français (Canada)', englishName: 'French (Canadian)', dir: 'ltr', flag: '🇨🇦' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', dir: 'ltr', flag: '🇩🇪' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', dir: 'ltr', flag: '🇮🇹' },
  { code: 'pt-BR', nativeName: 'Português (Brasil)', englishName: 'Portuguese (Brazilian)', dir: 'ltr', flag: '🇧🇷' },
  { code: 'pt-PT', nativeName: 'Português (Portugal)', englishName: 'Portuguese (European)', dir: 'ltr', flag: '🇵🇹' },
  { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch', dir: 'ltr', flag: '🇳🇱' },
  { code: 'sv', nativeName: 'Svenska', englishName: 'Swedish', dir: 'ltr', flag: '🇸🇪' },
  { code: 'no', nativeName: 'Norsk', englishName: 'Norwegian', dir: 'ltr', flag: '🇳🇴' },
  { code: 'da', nativeName: 'Dansk', englishName: 'Danish', dir: 'ltr', flag: '🇩🇰' },
  { code: 'fi', nativeName: 'Suomi', englishName: 'Finnish', dir: 'ltr', flag: '🇫🇮' },
  { code: 'is', nativeName: 'Íslenska', englishName: 'Icelandic', dir: 'ltr', flag: '🇮🇸' },
  { code: 'pl', nativeName: 'Polski', englishName: 'Polish', dir: 'ltr', flag: '🇵🇱' },
  { code: 'cs', nativeName: 'Čeština', englishName: 'Czech', dir: 'ltr', flag: '🇨🇿' },
  { code: 'sk', nativeName: 'Slovenčina', englishName: 'Slovak', dir: 'ltr', flag: '🇸🇰' },
  { code: 'hu', nativeName: 'Magyar', englishName: 'Hungarian', dir: 'ltr', flag: '🇭🇺' },
  { code: 'ro', nativeName: 'Română', englishName: 'Romanian', dir: 'ltr', flag: '🇷🇴' },
  { code: 'bg', nativeName: 'Български', englishName: 'Bulgarian', dir: 'ltr', flag: '🇧🇬' },
  { code: 'hr', nativeName: 'Hrvatski', englishName: 'Croatian', dir: 'ltr', flag: '🇭🇷' },
  { code: 'sr', nativeName: 'Српски', englishName: 'Serbian', dir: 'ltr', flag: '🇷🇸' },
  { code: 'sl', nativeName: 'Slovenščina', englishName: 'Slovenian', dir: 'ltr', flag: '🇸🇮' },
  { code: 'mk', nativeName: 'Македонски', englishName: 'Macedonian', dir: 'ltr', flag: '🇲🇰' },
  { code: 'sq', nativeName: 'Shqip', englishName: 'Albanian', dir: 'ltr', flag: '🇦🇱' },
  { code: 'el', nativeName: 'Ελληνικά', englishName: 'Greek', dir: 'ltr', flag: '🇬🇷' },
  { code: 'lv', nativeName: 'Latviešu', englishName: 'Latvian', dir: 'ltr', flag: '🇱🇻' },
  { code: 'lt', nativeName: 'Lietuvių', englishName: 'Lithuanian', dir: 'ltr', flag: '🇱🇹' },
  { code: 'et', nativeName: 'Eesti', englishName: 'Estonian', dir: 'ltr', flag: '🇪🇪' },
  { code: 'be', nativeName: 'Беларуская', englishName: 'Belarusian', dir: 'ltr', flag: '🇧🇾' },
  { code: 'uk', nativeName: 'Українська', englishName: 'Ukrainian', dir: 'ltr', flag: '🇺🇦' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', dir: 'ltr', flag: '🇷🇺' },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', dir: 'ltr', flag: '🇹🇷' },
  { code: 'az', nativeName: 'Azərbaycanca', englishName: 'Azerbaijani', dir: 'ltr', flag: '🇦🇿' },
  { code: 'hy', nativeName: 'Հայերեն', englishName: 'Armenian', dir: 'ltr', flag: '🇦🇲' },
  { code: 'ka', nativeName: 'ქართული', englishName: 'Georgian', dir: 'ltr', flag: '🇬🇪' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', dir: 'rtl', flag: '🇸🇦' },
  { code: 'he', nativeName: 'עברית', englishName: 'Hebrew', dir: 'rtl', flag: '🇮🇱' },
  { code: 'fa', nativeName: 'فارسی', englishName: 'Persian', dir: 'rtl', flag: '🇮🇷' },
  { code: 'ur', nativeName: 'اردو', englishName: 'Urdu', dir: 'rtl', flag: '🇵🇰' },
  { code: 'ps', nativeName: 'پښتو', englishName: 'Pashto', dir: 'rtl', flag: '🇦🇫' },
  { code: 'sd', nativeName: 'سنڌي', englishName: 'Sindhi', dir: 'rtl', flag: '🇵🇰' },
  { code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', dir: 'ltr', flag: '🇮🇳' },
  { code: 'bn', nativeName: 'বাংলা', englishName: 'Bengali', dir: 'ltr', flag: '🇧🇩' },
  { code: 'pa', nativeName: 'ਪੰਜਾਬੀ', englishName: 'Punjabi', dir: 'ltr', flag: '🇮🇳' },
  { code: 'gu', nativeName: 'ગુજરાતી', englishName: 'Gujarati', dir: 'ltr', flag: '🇮🇳' },
  { code: 'mr', nativeName: 'मराठी', englishName: 'Marathi', dir: 'ltr', flag: '🇮🇳' },
  { code: 'ta', nativeName: 'தமிழ்', englishName: 'Tamil', dir: 'ltr', flag: '🇮🇳' },
  { code: 'te', nativeName: 'తెలుగు', englishName: 'Telugu', dir: 'ltr', flag: '🇮🇳' },
  { code: 'kn', nativeName: 'ಕನ್ನಡ', englishName: 'Kannada', dir: 'ltr', flag: '🇮🇳' },
  { code: 'ml', nativeName: 'മലയാളം', englishName: 'Malayalam', dir: 'ltr', flag: '🇮🇳' },
  { code: 'or', nativeName: 'ଓଡ଼ିଆ', englishName: 'Odia', dir: 'ltr', flag: '🇮🇳' },
  { code: 'si', nativeName: 'සිංහල', englishName: 'Sinhala', dir: 'ltr', flag: '🇱🇰' },
  { code: 'ne', nativeName: 'नेपाली', englishName: 'Nepali', dir: 'ltr', flag: '🇳🇵' },
  { code: 'km', nativeName: 'ខ្មែរ', englishName: 'Khmer', dir: 'ltr', flag: '🇰🇭' },
  { code: 'my', nativeName: 'မြန်မာ', englishName: 'Burmese', dir: 'ltr', flag: '🇲🇲' },
  { code: 'lo', nativeName: 'ລາວ', englishName: 'Lao', dir: 'ltr', flag: '🇱🇦' },
  { code: 'th', nativeName: 'ไทย', englishName: 'Thai', dir: 'ltr', flag: '🇹🇭' },
  { code: 'vi', nativeName: 'Tiếng Việt', englishName: 'Vietnamese', dir: 'ltr', flag: '🇻🇳' },
  { code: 'id', nativeName: 'Bahasa Indonesia', englishName: 'Indonesian', dir: 'ltr', flag: '🇮🇩' },
  { code: 'ms', nativeName: 'Bahasa Melayu', englishName: 'Malay', dir: 'ltr', flag: '🇲🇾' },
  { code: 'fil', nativeName: 'Filipino', englishName: 'Filipino', dir: 'ltr', flag: '🇵🇭' },
  { code: 'jv', nativeName: 'Basa Jawa', englishName: 'Javanese', dir: 'ltr', flag: '🇮🇩' },
  { code: 'zh-CN', nativeName: '简体中文', englishName: 'Chinese (Simplified)', dir: 'ltr', flag: '🇨🇳' },
  { code: 'zh-TW', nativeName: '繁體中文', englishName: 'Chinese (Traditional)', dir: 'ltr', flag: '🇹🇼' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', dir: 'ltr', flag: '🇯🇵' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean', dir: 'ltr', flag: '🇰🇷' },
  { code: 'mn', nativeName: 'Монгол', englishName: 'Mongolian', dir: 'ltr', flag: '🇲🇳' },
  { code: 'am', nativeName: 'አማርኛ', englishName: 'Amharic', dir: 'ltr', flag: '🇪🇹' },
  { code: 'sw', nativeName: 'Kiswahili', englishName: 'Swahili', dir: 'ltr', flag: '🇰🇪' },
  { code: 'af', nativeName: 'Afrikaans', englishName: 'Afrikaans', dir: 'ltr', flag: '🇿🇦' },
  { code: 'mg', nativeName: 'Malagasy', englishName: 'Malagasy', dir: 'ltr', flag: '🇲🇬' },
  { code: 'ht', nativeName: 'Kreyòl Ayisyen', englishName: 'Haitian Creole', dir: 'ltr', flag: '🇭🇹' },
  { code: 'ca', nativeName: 'Català', englishName: 'Catalan', dir: 'ltr', flag: '🇪🇸' },
  { code: 'gl', nativeName: 'Galego', englishName: 'Galician', dir: 'ltr', flag: '🇪🇸' },
  { code: 'eu', nativeName: 'Euskara', englishName: 'Basque', dir: 'ltr', flag: '🇪🇸' },
  { code: 'lb', nativeName: 'Lëtzebuergesch', englishName: 'Luxembourgish', dir: 'ltr', flag: '🇱🇺' },
  { code: 'ga', nativeName: 'Gaeilge', englishName: 'Irish', dir: 'ltr', flag: '🇮🇪' },
  { code: 'gd', nativeName: 'Gàidhlig', englishName: 'Scottish Gaelic', dir: 'ltr', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
];

export const SUPPORTED_LOCALE_CODES = new Set(SUPPORTED_LOCALES.map((l) => l.code));

export function findLocale(code: string): SupportedLocale | undefined {
  return SUPPORTED_LOCALES.find((l) => l.code === code);
}

/**
 * Best-effort BCP-47 fallback: given a tag like `en-US`, try the exact
 * match, then the language-only fallback (`en`), then `en` as the final
 * default.
 */
export function resolveLocale(candidate: string | null | undefined): string {
  if (!candidate) return 'en';
  if (SUPPORTED_LOCALE_CODES.has(candidate)) return candidate;
  const base = candidate.split('-')[0]!;
  if (SUPPORTED_LOCALE_CODES.has(base)) return base;
  return 'en';
}

export function isRTL(code: string): boolean {
  return findLocale(code)?.dir === 'rtl';
}
