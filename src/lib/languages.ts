/**
 * Language list aligned to Gemini TTS (Cloud Text-to-Speech surface)
 * supported locales.
 *
 * ttsCode: canonical BCP-47 code. Doubles as (a) the Gemini TTS
 *   `language_code` AND (b) the source for display localisation
 *   (`localizedLanguageName`), so it is ALWAYS present — even for
 *   languages Gemini TTS can't speak.
 * ttsUnsupported: true = text is supported but Gemini TTS cannot
 *   speak this language. Speech affordances are gated off; use
 *   `getSpeechLanguageCode()` (NOT `getTTSCode()`) for the speech gate.
 *   See docs/specs/tts.md TTS-LANG-1/2.
 * ttsPreview: true = Preview status, false/absent = GA.
 * region: hint for LLM translation accuracy.
 */

export type LanguageInfo = {
  name: string;
  flag: string;
  ttsCode: string;
  /** Text-supported but NOT Gemini-TTS-speakable. Gates speech off. */
  ttsUnsupported?: boolean;
  ttsPreview?: boolean;
  region?: string;
  experimental?: boolean;
};

export const SUPPORTED_LANGUAGES: LanguageInfo[] = [
  { name: 'Afrikaans',               flag: '\u{1F1FF}\u{1F1E6}', ttsCode: 'af-ZA', ttsPreview: true },
  { name: 'Albanian',                flag: '\u{1F1E6}\u{1F1F1}', ttsCode: 'sq-AL', ttsPreview: true },
  { name: 'Amharic',                 flag: '\u{1F1EA}\u{1F1F9}', ttsCode: 'am-ET', ttsPreview: true },
  { name: 'Arabic (Egypt)',          flag: '\u{1F1EA}\u{1F1EC}', ttsCode: 'ar-EG' },
  { name: 'Arabic (Saudi)',          flag: '\u{1F1F8}\u{1F1E6}', ttsCode: 'ar-001', ttsPreview: true, region: 'Saudi/Gulf' },
  { name: 'Armenian',                flag: '\u{1F1E6}\u{1F1F2}', ttsCode: 'hy-AM', ttsPreview: true },
  { name: 'Azerbaijani',             flag: '\u{1F1E6}\u{1F1FF}', ttsCode: 'az-AZ', ttsPreview: true },
  { name: 'Basque',                  flag: '\u{1F1EA}\u{1F1F8}', ttsCode: 'eu-ES', ttsPreview: true },
  { name: 'Belarusian',              flag: '\u{1F1E7}\u{1F1FE}', ttsCode: 'be-BY', ttsPreview: true },
  { name: 'Bengali',                 flag: '\u{1F1E7}\u{1F1E9}', ttsCode: 'bn-BD', region: 'Bangladesh' },
  { name: 'Bulgarian',               flag: '\u{1F1E7}\u{1F1EC}', ttsCode: 'bg-BG', ttsPreview: true },
  { name: 'Burmese',                 flag: '\u{1F1F2}\u{1F1F2}', ttsCode: 'my-MM', ttsPreview: true },
  { name: 'Catalan',                 flag: '\u{1F1EA}\u{1F1F8}', ttsCode: 'ca-ES', ttsPreview: true },
  { name: 'Chinese (Mandarin)',      flag: '\u{1F1E8}\u{1F1F3}', ttsCode: 'cmn-CN', ttsPreview: true, region: 'Mainland China Simplified' },
  { name: 'Chinese (Taiwan)',        flag: '\u{1F1F9}\u{1F1FC}', ttsCode: 'cmn-tw', ttsPreview: true, region: 'Taiwan Traditional' },
  { name: 'Croatian',                flag: '\u{1F1ED}\u{1F1F7}', ttsCode: 'hr-HR', ttsPreview: true },
  { name: 'Czech',                   flag: '\u{1F1E8}\u{1F1FF}', ttsCode: 'cs-CZ', ttsPreview: true },
  { name: 'Danish',                  flag: '\u{1F1E9}\u{1F1F0}', ttsCode: 'da-DK', ttsPreview: true },
  { name: 'Dutch',                   flag: '\u{1F1F3}\u{1F1F1}', ttsCode: 'nl-NL', region: 'Netherlands' },
  { name: 'English (American)',      flag: '\u{1F1FA}\u{1F1F8}', ttsCode: 'en-US', region: 'American' },
  { name: 'English (Australian)',    flag: '\u{1F1E6}\u{1F1FA}', ttsCode: 'en-AU', ttsPreview: true, region: 'Australian' },
  { name: 'English (British)',       flag: '\u{1F1EC}\u{1F1E7}', ttsCode: 'en-GB', ttsPreview: true, region: 'British' },
  { name: 'English (Indian)',        flag: '\u{1F1EE}\u{1F1F3}', ttsCode: 'en-IN', region: 'Indian' },
  { name: 'Estonian',                flag: '\u{1F1EA}\u{1F1EA}', ttsCode: 'et-EE', ttsPreview: true },
  { name: 'Filipino',                flag: '\u{1F1F5}\u{1F1ED}', ttsCode: 'fil-PH', ttsPreview: true },
  { name: 'Finnish',                 flag: '\u{1F1EB}\u{1F1EE}', ttsCode: 'fi-FI', ttsPreview: true },
  { name: 'French',                  flag: '\u{1F1EB}\u{1F1F7}', ttsCode: 'fr-FR', region: 'France' },
  { name: 'French (Canadian)',       flag: '\u{1F1E8}\u{1F1E6}', ttsCode: 'fr-CA', ttsPreview: true, region: 'Canadian/Québécois' },
  { name: 'Galician',                flag: '\u{1F1EA}\u{1F1F8}', ttsCode: 'gl-ES', ttsPreview: true },
  { name: 'Georgian',                flag: '\u{1F1EC}\u{1F1EA}', ttsCode: 'ka-GE', ttsPreview: true },
  { name: 'German',                  flag: '\u{1F1E9}\u{1F1EA}', ttsCode: 'de-DE' },
  { name: 'Greek',                   flag: '\u{1F1EC}\u{1F1F7}', ttsCode: 'el-GR', ttsPreview: true },
  { name: 'Gujarati',                flag: '\u{1F1EE}\u{1F1F3}', ttsCode: 'gu-IN', ttsPreview: true },
  { name: 'Haitian Creole',          flag: '\u{1F1ED}\u{1F1F9}', ttsCode: 'ht-HT', ttsPreview: true },
  { name: 'Hebrew',                  flag: '\u{1F1EE}\u{1F1F1}', ttsCode: 'he-IL', ttsPreview: true },
  { name: 'Hindi',                   flag: '\u{1F1EE}\u{1F1F3}', ttsCode: 'hi-IN' },
  { name: 'Hungarian',               flag: '\u{1F1ED}\u{1F1FA}', ttsCode: 'hu-HU', ttsPreview: true },
  { name: 'Icelandic',               flag: '\u{1F1EE}\u{1F1F8}', ttsCode: 'is-IS', ttsPreview: true },
  { name: 'Indonesian',              flag: '\u{1F1EE}\u{1F1E9}', ttsCode: 'id-ID' },
  { name: 'Irish (Gaeilge)',         flag: '\u{1F1EE}\u{1F1EA}', ttsCode: 'ga-IE', ttsUnsupported: true, experimental: true },
  { name: 'Scottish Gaelic',         flag: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', ttsCode: 'gd-GB', ttsUnsupported: true, experimental: true },
  { name: 'Italian',                 flag: '\u{1F1EE}\u{1F1F9}', ttsCode: 'it-IT' },
  { name: 'Japanese',                flag: '\u{1F1EF}\u{1F1F5}', ttsCode: 'ja-JP' },
  { name: 'Javanese',                flag: '\u{1F1EE}\u{1F1E9}', ttsCode: 'jv-JV', ttsPreview: true },
  { name: 'Kannada',                 flag: '\u{1F1EE}\u{1F1F3}', ttsCode: 'kn-IN', ttsPreview: true },
  { name: 'Konkani',                 flag: '\u{1F1EE}\u{1F1F3}', ttsCode: 'kok-IN', ttsPreview: true },
  { name: 'Korean',                  flag: '\u{1F1F0}\u{1F1F7}', ttsCode: 'ko-KR' },
  { name: 'Lao',                     flag: '\u{1F1F1}\u{1F1E6}', ttsCode: 'lo-LA', ttsPreview: true },
  { name: 'Latvian',                 flag: '\u{1F1F1}\u{1F1FB}', ttsCode: 'lv-LV', ttsPreview: true },
  { name: 'Lithuanian',              flag: '\u{1F1F1}\u{1F1F9}', ttsCode: 'lt-LT', ttsPreview: true },
  { name: 'Luxembourgish',           flag: '\u{1F1F1}\u{1F1FA}', ttsCode: 'lb-LU', ttsPreview: true },
  { name: 'Macedonian',              flag: '\u{1F1F2}\u{1F1F0}', ttsCode: 'mk-MK', ttsPreview: true },
  { name: 'Malagasy',                flag: '\u{1F1F2}\u{1F1EC}', ttsCode: 'mg-MG', ttsPreview: true },
  { name: 'Malay',                   flag: '\u{1F1F2}\u{1F1FE}', ttsCode: 'ms-MY', ttsPreview: true },
  { name: 'Malayalam',               flag: '\u{1F1EE}\u{1F1F3}', ttsCode: 'ml-IN', ttsPreview: true },
  { name: 'Marathi',                 flag: '\u{1F1EE}\u{1F1F3}', ttsCode: 'mr-IN' },
  { name: 'Mongolian',               flag: '\u{1F1F2}\u{1F1F3}', ttsCode: 'mn-MN', ttsPreview: true },
  { name: 'Nepali',                  flag: '\u{1F1F3}\u{1F1F5}', ttsCode: 'ne-NP', ttsPreview: true },
  { name: 'Norwegian',               flag: '\u{1F1F3}\u{1F1F4}', ttsCode: 'nb-NO', ttsPreview: true },
  { name: 'Odia',                    flag: '\u{1F1EE}\u{1F1F3}', ttsCode: 'or-IN', ttsPreview: true },
  { name: 'Pashto',                  flag: '\u{1F1E6}\u{1F1EB}', ttsCode: 'ps-AF', ttsPreview: true },
  { name: 'Persian',                 flag: '\u{1F1EE}\u{1F1F7}', ttsCode: 'fa-IR', ttsPreview: true },
  { name: 'Polish',                  flag: '\u{1F1F5}\u{1F1F1}', ttsCode: 'pl-PL' },
  { name: 'Portuguese (Brazilian)',  flag: '\u{1F1E7}\u{1F1F7}', ttsCode: 'pt-BR', region: 'Brazilian' },
  { name: 'Portuguese (European)',   flag: '\u{1F1F5}\u{1F1F9}', ttsCode: 'pt-PT', ttsPreview: true, region: 'European/Portugal' },
  { name: 'Punjabi',                 flag: '\u{1F1EE}\u{1F1F3}', ttsCode: 'pa-IN', ttsPreview: true },
  { name: 'Romanian',                flag: '\u{1F1F7}\u{1F1F4}', ttsCode: 'ro-RO' },
  { name: 'Russian',                 flag: '\u{1F1F7}\u{1F1FA}', ttsCode: 'ru-RU' },
  { name: 'Serbian',                 flag: '\u{1F1F7}\u{1F1F8}', ttsCode: 'sr-RS', ttsPreview: true },
  { name: 'Sindhi',                  flag: '\u{1F1F5}\u{1F1F0}', ttsCode: 'sd-IN', ttsPreview: true },
  { name: 'Sinhala',                 flag: '\u{1F1F1}\u{1F1F0}', ttsCode: 'si-LK', ttsPreview: true },
  { name: 'Slovak',                  flag: '\u{1F1F8}\u{1F1F0}', ttsCode: 'sk-SK', ttsPreview: true },
  { name: 'Slovenian',               flag: '\u{1F1F8}\u{1F1EE}', ttsCode: 'sl-SI', ttsPreview: true },
  { name: 'Spanish',                 flag: '\u{1F1EA}\u{1F1F8}', ttsCode: 'es-ES', region: 'Spain/Castilian' },
  { name: 'Spanish (Latin America)', flag: '\u{1F30E}',          ttsCode: 'es-419', ttsPreview: true, region: 'Latin American' },
  { name: 'Spanish (Mexico)',        flag: '\u{1F1F2}\u{1F1FD}', ttsCode: 'es-MX', ttsPreview: true, region: 'Mexican' },
  { name: 'Swahili',                 flag: '\u{1F1F0}\u{1F1EA}', ttsCode: 'sw-KE', ttsPreview: true },
  { name: 'Swedish',                 flag: '\u{1F1F8}\u{1F1EA}', ttsCode: 'sv-SE', ttsPreview: true },
  { name: 'Tamil',                   flag: '\u{1F1EE}\u{1F1F3}', ttsCode: 'ta-IN' },
  { name: 'Telugu',                  flag: '\u{1F1EE}\u{1F1F3}', ttsCode: 'te-IN' },
  { name: 'Thai',                    flag: '\u{1F1F9}\u{1F1ED}', ttsCode: 'th-TH' },
  { name: 'Turkish',                 flag: '\u{1F1F9}\u{1F1F7}', ttsCode: 'tr-TR' },
  { name: 'Ukrainian',               flag: '\u{1F1FA}\u{1F1E6}', ttsCode: 'uk-UA' },
  { name: 'Urdu',                    flag: '\u{1F1F5}\u{1F1F0}', ttsCode: 'ur-PK', ttsPreview: true },
  { name: 'Vietnamese',              flag: '\u{1F1FB}\u{1F1F3}', ttsCode: 'vi-VN' },
];

/** Map from language name to LanguageInfo for quick lookup */
export const LANGUAGE_MAP: Record<string, LanguageInfo> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((l) => [l.name, l]),
);

/** Get flag emoji for a language name. Falls back to a globe. */
export function getLanguageFlag(name: string | undefined | null): string {
  if (!name) return '🌐';
  return LANGUAGE_MAP[name]?.flag ?? '🌐';
}

/**
 * Get the canonical BCP-47 code for a language name. Present for EVERY
 * supported language (used for display localisation + as the would-be
 * TTS code). NOT a speech-support gate — a language can have a ttsCode
 * but be `ttsUnsupported`. For the speech gate, use
 * `getSpeechLanguageCode()`.
 */
export function getTTSCode(name: string): string | undefined {
  return LANGUAGE_MAP[name]?.ttsCode;
}

/**
 * Get the Gemini-TTS language code IFF the language is speakable.
 * Returns undefined when the language is text-only (`ttsUnsupported`)
 * or unknown. This is the canonical speech-support gate — every TTS
 * surface (speak buttons, practice listen questions, read-aloud,
 * life-sim dialogue) calls this, NOT `getTTSCode`. See
 * docs/specs/tts.md TTS-LANG-1.
 */
export function getSpeechLanguageCode(name: string): string | undefined {
  const info = LANGUAGE_MAP[name];
  if (!info || info.ttsUnsupported) return undefined;
  return info.ttsCode;
}

/** Whether a language has Gemini TTS speech support. */
export function isSpeechSupported(name: string): boolean {
  return getSpeechLanguageCode(name) !== undefined;
}

/** Strip parenthetical qualifiers — "English (British)" → "English". */
export function getBaseLanguageName(name: string): string {
  return name.replace(/\s*\(.*\)$/, '');
}

/**
 * LANG-RESOLVE-8 — a language name for PROSE, region dropped unless it is the
 * point. "English (British)" reads as "English" in a sentence, EXCEPT when
 * `others` holds a different variant of the same base ("English",
 * "English (American)"): there the region is the only thing that makes the
 * sentence true. Variants are distinct in this app, so the honest sentence
 * names the variant. (First written for LANG-RESOLVE-8's override sheet; now
 * used by every sentence that names a language, e.g. LANG-LEARNWITH.)
 *
 * The result is a canonical name: pass it to `localizedLanguageName` like any
 * other (the no-qualified-language-in-prose guard accepts this helper in place
 * of `getBaseLanguageName`).
 */
export function proseLanguageName(language: string, others: readonly string[]): string {
  const base = getBaseLanguageName(language);
  if (base === language) return language;
  const collides = others.some(
    (other) => other !== language && getBaseLanguageName(other) === base,
  );
  return collides ? language : base;
}

/** Get region hint for a language name (e.g. "British", "Australian") */
export function getLanguageRegion(name: string): string | undefined {
  return LANGUAGE_MAP[name]?.region;
}

/**
 * Localised display form of a language name for a UI locale. Uses
 * `Intl.DisplayNames` — gives us "français" / "Französisch" / "日本語"
 * for free from ICU, across all 80 supported UI locales, no manual
 * translation table required.
 *
 * IMPORTANT: the input `name` is the CANONICAL English database key
 * (e.g. "French", "Spanish (Latin America)"). This function never
 * changes that — it returns a DISPLAY string for the current UI
 * locale. Use the original `name` everywhere you read/write to
 * Firestore.
 *
 * Two output styles, picked by `opts.style`:
 *
 *  - `'sentence'` (DEFAULT) — the locale's linguistically-correct
 *    form for embedding in a translated template (lowercase mid-
 *    sentence in French/Italian/Spanish; capitalised in German;
 *    no parens added if ICU didn't add them). Use this for the
 *    composer placeholder "Écris en {language}…", the chat header's
 *    "Learning {language}…" subline, and similar mid-sentence
 *    interpolations.
 *
 *  - `'label'` — UI-friendly stand-alone form: Title Case + the
 *    regional qualifier wrapped in parens. Example: French UI,
 *    "English (British)" → "Anglais (Britannique)" (the user-stated
 *    UI convention, overriding the French linguistic norm of
 *    lowercase + no-parens). Use this for picker rows, filter chips,
 *    and other places where the language name stands alone as a
 *    label, not as a word inside a sentence.
 *
 * Bare base names: this function also accepts the unqualified form
 * ("English") — produced by `getBaseLanguageName` callers that
 * strip the parenthetical first. LANGUAGE_MAP only carries the
 * qualified variants ("English (British)", "English (American)", …),
 * so we fall back to a prefix lookup: any variant whose `name`
 * starts with `"{input} ("` works, since they all share the same
 * language subtag.
 *
 * Fallback chain: Intl-localised → English `name` (when Intl returns
 * the input code unchanged, signalling it couldn't localise) →
 * the raw input (when the name isn't in our SUPPORTED_LANGUAGES list
 * at all, e.g. a legacy doc with a typo'd language).
 */
export type LocalizedLanguageNameStyle = 'sentence' | 'label';

export function localizedLanguageName(
  name: string,
  locale: string,
  opts: { style?: LocalizedLanguageNameStyle } = {},
): string {
  const style = opts.style ?? 'sentence';
  const info = findLanguageInfo(name);
  if (!info) return name;
  // No-op fast path: when the UI is in English (or a regional English
  // variant), the canonical English name IS the display form.
  if (locale === 'en' || locale.startsWith('en-')) return name;
  const callerHasQualifier = name.includes('(');
  const langSubtag = info.ttsCode.split('-')[0]!;
  try {
    const dn = new Intl.DisplayNames(locale, { type: 'language', fallback: 'code' });
    const baseLocalized = dn.of(langSubtag);
    if (!baseLocalized || baseLocalized === langSubtag) return name;

    if (style === 'sentence') {
      // Mid-sentence: ICU's natural form for the locale.
      if (callerHasQualifier) {
        const fullLocalized = dn.of(info.ttsCode);
        return fullLocalized && fullLocalized !== info.ttsCode
          ? fullLocalized
          : baseLocalized;
      }
      return baseLocalized;
    }

    // Label style: Title Case + bracketed qualifier.
    const titleBase = titleCaseFirst(baseLocalized);
    if (!callerHasQualifier) return titleBase;

    const fullLocalized = dn.of(info.ttsCode);
    if (
      !fullLocalized ||
      fullLocalized === info.ttsCode ||
      fullLocalized === baseLocalized
    ) {
      return titleBase;
    }
    // Extract the qualifier portion by removing the base substring.
    // Works regardless of word order: "anglais britannique" →
    // "britannique" (Latin scripts); "イギリス英語" → "イギリス" (CJK,
    // region prefix).
    let qualifier = fullLocalized.replace(baseLocalized, '').trim();
    // Drop parens that ICU may have already wrapped the qualifier in
    // (e.g. French "chinois (Chine)"), so the final format is
    // consistent across variants.
    qualifier = qualifier.replace(/^[([{]\s*/, '').replace(/\s*[)\]}]$/, '').trim();
    // Drop leading prepositions French/Spanish/Italian/Portuguese ICU
    // sometimes inserts ("d'Amérique latine" → "Amérique latine";
    // "du Mexique" → "Mexique"). Keeps the qualifier clean for the
    // Title-Case treatment that follows.
    qualifier = qualifier
      .replace(/^(d['’]|du |de la |de las |de los |de |del |della |dell['’]|dal |dei |dello |aux |au |do |da |della |la |le |les |il )/i, '')
      .trim();
    if (!qualifier) return titleBase;
    return `${titleBase} (${titleCaseFirst(qualifier)})`;
  } catch {
    return name;
  }
}

function findLanguageInfo(name: string): LanguageInfo | undefined {
  // 1. Exact match — the common case (DB stores canonical names).
  const exact = LANGUAGE_MAP[name];
  if (exact) return exact;
  // 2. Bare base name ("English", "Spanish", "Chinese", "French",
  //    "Portuguese", "Arabic") — produced when callers run
  //    `getBaseLanguageName` first. We don't store these in
  //    LANGUAGE_MAP because the canonical name is always qualified
  //    in our taxonomy, but we still want to localise them.
  const trimmed = name.trim();
  return SUPPORTED_LANGUAGES.find(
    (l) => l.name === trimmed || l.name.startsWith(`${trimmed} (`),
  );
}

function titleCaseFirst(s: string): string {
  if (!s) return s;
  // `toLocaleUpperCase()` is safe for cased scripts (Latin, Cyrillic,
  // Greek) and a no-op for caseless scripts (CJK, Arabic, Hebrew,
  // Thai), so we don't need a script check.
  return s[0]!.toLocaleUpperCase() + s.slice(1);
}
