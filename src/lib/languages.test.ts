/**
 * Sanity tests for the localisation helper. Intl.DisplayNames data
 * comes from ICU — these tests guard against:
 *  - regressions in the qualifier-vs-no-qualifier code-selection logic,
 *  - silent fallbacks when a name isn't in SUPPORTED_LANGUAGES,
 *  - English locales being treated as a no-op (the canonical name IS
 *    the display form).
 *
 * Exact display strings vary slightly across Node/ICU versions, so
 * assertions check for diagnostic substrings rather than full equality
 * — except where ICU output is known-stable for the major locales.
 */
import { describe, expect, it } from 'vitest';
import {
  proseLanguageName,
  SUPPORTED_LANGUAGES,
  getSpeechLanguageCode,
  getTTSCode,
  isSpeechSupported,
  localizedLanguageName,
} from './languages';

/**
 * Canonical Gemini TTS (Cloud Text-to-Speech surface) locale set —
 * 24 GA + 64 Preview = 88. Frozen from Google's docs
 * (docs.cloud.google.com/text-to-speech/docs/gemini-tts) so a drift in
 * SUPPORTED_LANGUAGES' ttsCode values (wrong code, wrong casing) fails
 * loudly. See docs/specs/tts.md TTS-LANG-2.
 *
 * Note the two intentionally inconsistent-casing codes Google ships
 * verbatim: `cmn-tw` (lowercase region) and `jv-JV`.
 */
const GEMINI_TTS_LOCALES = new Set<string>([
  // GA (24)
  'ar-EG', 'bn-BD', 'nl-NL', 'en-IN', 'en-US', 'fr-FR', 'de-DE', 'hi-IN',
  'id-ID', 'it-IT', 'ja-JP', 'ko-KR', 'mr-IN', 'pl-PL', 'pt-BR', 'ro-RO',
  'ru-RU', 'es-ES', 'ta-IN', 'te-IN', 'th-TH', 'tr-TR', 'uk-UA', 'vi-VN',
  // Preview (64)
  'af-ZA', 'sq-AL', 'am-ET', 'ar-001', 'hy-AM', 'az-AZ', 'eu-ES', 'be-BY',
  'bg-BG', 'my-MM', 'ca-ES', 'ceb-PH', 'cmn-CN', 'cmn-tw', 'hr-HR', 'cs-CZ',
  'da-DK', 'en-AU', 'en-GB', 'et-EE', 'fil-PH', 'fi-FI', 'fr-CA', 'gl-ES',
  'ka-GE', 'el-GR', 'gu-IN', 'ht-HT', 'he-IL', 'hu-HU', 'is-IS', 'jv-JV',
  'kn-IN', 'kok-IN', 'lo-LA', 'la-VA', 'lv-LV', 'lt-LT', 'lb-LU', 'mk-MK',
  'mai-IN', 'mg-MG', 'ms-MY', 'ml-IN', 'mn-MN', 'ne-NP', 'nb-NO', 'nn-NO',
  'or-IN', 'ps-AF', 'fa-IR', 'pt-PT', 'pa-IN', 'sr-RS', 'sd-IN', 'si-LK',
  'sk-SK', 'sl-SI', 'es-419', 'es-MX', 'sw-KE', 'sv-SE', 'ur-PK',
]);

describe('TTS-LANG-2 — every speakable ttsCode is a real Gemini TTS locale', () => {
  it('all non-ttsUnsupported languages map to a frozen Gemini TTS locale (exact casing)', () => {
    const offenders = SUPPORTED_LANGUAGES.filter(
      (l) => !l.ttsUnsupported && !GEMINI_TTS_LOCALES.has(l.ttsCode),
    ).map((l) => `${l.name} → ${l.ttsCode}`);
    expect(offenders).toEqual([]);
  });

  it('every language still carries a non-empty ttsCode (display localisation depends on it)', () => {
    const missing = SUPPORTED_LANGUAGES.filter((l) => !l.ttsCode).map((l) => l.name);
    expect(missing).toEqual([]);
  });

  it('the known speech-unsupported languages are flagged, not mis-coded', () => {
    // Irish + Scottish Gaelic: text-supported, NOT Gemini-TTS-speakable.
    // They keep a valid BCP-47 ttsCode (for display) but ttsUnsupported.
    const irish = SUPPORTED_LANGUAGES.find((l) => l.name === 'Irish (Gaeilge)');
    const gaelic = SUPPORTED_LANGUAGES.find((l) => l.name === 'Scottish Gaelic');
    expect(irish?.ttsUnsupported).toBe(true);
    expect(gaelic?.ttsUnsupported).toBe(true);
    // And they're correctly NOT in the Gemini locale set.
    expect(GEMINI_TTS_LOCALES.has(irish!.ttsCode)).toBe(false);
    expect(GEMINI_TTS_LOCALES.has(gaelic!.ttsCode)).toBe(false);
  });
});

describe('TTS-LANG-1 — getSpeechLanguageCode is the speech gate', () => {
  it('returns the ttsCode for a speakable language', () => {
    expect(getSpeechLanguageCode('French')).toBe('fr-FR');
    expect(getSpeechLanguageCode('English (British)')).toBe('en-GB');
  });

  it('returns undefined for a text-only (ttsUnsupported) language, even though getTTSCode still returns the BCP-47 code', () => {
    expect(getTTSCode('Irish (Gaeilge)')).toBe('ga-IE'); // display code present
    expect(getSpeechLanguageCode('Irish (Gaeilge)')).toBeUndefined(); // speech gated
    expect(getSpeechLanguageCode('Scottish Gaelic')).toBeUndefined();
  });

  it('returns undefined for an unknown language', () => {
    expect(getSpeechLanguageCode('Klingon')).toBeUndefined();
  });

  it('isSpeechSupported mirrors the gate', () => {
    expect(isSpeechSupported('French')).toBe(true);
    expect(isSpeechSupported('Irish (Gaeilge)')).toBe(false);
    expect(isSpeechSupported('Klingon')).toBe(false);
  });
});

describe('localizedLanguageName', () => {
  it('returns the English name unchanged when locale is English', () => {
    expect(localizedLanguageName('French', 'en')).toBe('French');
    expect(localizedLanguageName('French', 'en-US')).toBe('French');
    expect(localizedLanguageName('Spanish (Latin America)', 'en-GB')).toBe(
      'Spanish (Latin America)',
    );
  });

  it('returns the English name unchanged for unknown languages', () => {
    // `Klingon` is not in SUPPORTED_LANGUAGES — fall back to the input.
    expect(localizedLanguageName('Klingon', 'fr')).toBe('Klingon');
  });

  it('localises unqualified names to the generic form', () => {
    // "French" → "français" in French (no regional qualifier).
    expect(localizedLanguageName('French', 'fr')).toBe('français');
    expect(localizedLanguageName('German', 'de')).toBe('Deutsch');
    expect(localizedLanguageName('Japanese', 'ja')).toBe('日本語');
    expect(localizedLanguageName('Spanish', 'es')).toBe('español');
  });

  it('localises bare base names that lack the parenthetical', () => {
    // "English" alone isn't in LANGUAGE_MAP — the canonical entries are
    // "English (American)" etc. — but the prefix lookup should still
    // resolve it via any variant's language subtag. Catches the
    // composer-placeholder bug where `getBaseLanguageName` strips the
    // qualifier before we localise.
    expect(localizedLanguageName('English', 'fr')).toBe('anglais');
    expect(localizedLanguageName('English', 'de')).toBe('Englisch');
    expect(localizedLanguageName('Chinese', 'fr')).toBe('chinois');
    expect(localizedLanguageName('Portuguese', 'fr')).toBe('portugais');
    expect(localizedLanguageName('Arabic', 'fr')).toBe('arabe');
  });

  it('localises qualified names with the regional form (sentence)', () => {
    // Default style is sentence — ICU output as-is, no extra formatting.
    const out = localizedLanguageName('English (British)', 'fr');
    expect(out.toLowerCase()).toContain('anglais');
    expect(out.toLowerCase()).toContain('britannique');
  });

  it('preserves the regional flavour for Latin-American Spanish', () => {
    const out = localizedLanguageName('Spanish (Latin America)', 'fr');
    expect(out.toLowerCase()).toContain('espagnol');
    expect(out.toLowerCase()).toMatch(/amérique latine|latine/);
  });

  it('handles Chinese (Mandarin) via cmn-CN', () => {
    const out = localizedLanguageName('Chinese (Mandarin)', 'fr');
    expect(out.toLowerCase()).toContain('chinois');
  });

  it('handles locales the chat-language name is unrelated to', () => {
    // Ask for Korean displayed in Arabic UI — round-trip through ICU.
    const out = localizedLanguageName('Korean', 'ar');
    expect(out).not.toBe('Korean');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('localizedLanguageName — label style', () => {
  it('Title-cases the base form even when the locale is naturally lowercase', () => {
    expect(
      localizedLanguageName('French', 'fr', { style: 'label' }),
    ).toBe('Français');
    expect(
      localizedLanguageName('Spanish', 'fr', { style: 'label' }),
    ).toBe('Espagnol');
  });

  it('wraps the qualifier in parens with Title Case (Latin scripts)', () => {
    // The user-stated UI convention: "Anglais (Britannique)", not
    // ICU's natural "anglais britannique".
    expect(
      localizedLanguageName('English (British)', 'fr', { style: 'label' }),
    ).toBe('Anglais (Britannique)');
    expect(
      localizedLanguageName('English (American)', 'fr', { style: 'label' }),
    ).toBe('Anglais (Américain)');
    expect(
      localizedLanguageName('French (Canadian)', 'fr', { style: 'label' }),
    ).toBe('Français (Canadien)');
  });

  it('strips leading prepositions ICU sometimes emits before the qualifier', () => {
    // "espagnol du Mexique" → "Espagnol (Mexique)", not "(Du Mexique)".
    expect(
      localizedLanguageName('Spanish (Mexico)', 'fr', { style: 'label' }),
    ).toBe('Espagnol (Mexique)');
  });

  it('normalises ICU output that already had parens (Chinese in French)', () => {
    // French ICU gives "chinois (Chine)" — already bracketed. Re-emit
    // through the same formatter so the result is identical regardless
    // of which locale ICU chose to bracket.
    const out = localizedLanguageName('Chinese (Mandarin)', 'fr', {
      style: 'label',
    });
    expect(out.startsWith('Chinois')).toBe(true);
    expect(out).toContain('(');
    expect(out).toContain(')');
  });

  it('falls back to base-only when ICU has no regional flavour', () => {
    // German ICU gives "Englisch (Vereinigtes Königreich)" — already
    // formatted; we round-trip it. (Just verify it stays sensible.)
    const out = localizedLanguageName('English (British)', 'de', {
      style: 'label',
    });
    expect(out).toContain('Englisch');
  });

  it('no-op in English locales', () => {
    expect(
      localizedLanguageName('English (British)', 'en', { style: 'label' }),
    ).toBe('English (British)');
  });
});

describe('LANG-RESOLVE-8 — proseLanguageName keeps a region only where it disambiguates', () => {
  it('LANG-RESOLVE-8 — strips the region when nothing else shares the base', () => {
    expect(proseLanguageName('English (British)', ['Spanish', 'Italian'])).toBe('English');
    expect(proseLanguageName('German', ['Spanish'])).toBe('German');
  });

  it('LANG-RESOLVE-8 — keeps it when another variant of the same base is present', () => {
    expect(proseLanguageName('English (British)', ['English (American)', 'Spanish']))
      .toBe('English (British)');
    expect(proseLanguageName('English (British)', ['English', 'Spanish'])).toBe('English (British)');
    expect(proseLanguageName('English', ['English (British)'])).toBe('English');
  });

  it('LANG-RESOLVE-8 — the language itself in the list is not "another variant"', () => {
    expect(proseLanguageName('English (British)', ['English (British)', 'Spanish'])).toBe('English');
  });
});
