import { describe, expect, it } from 'vitest';
import { resolveSystemLanguage } from './systemLanguage';

describe('resolveSystemLanguage — LIFE-LANG-7', () => {
  it('LIFE-LANG-7 — UI locale in the native language → returns the native NAME (exact, so no warning)', () => {
    expect(
      resolveSystemLanguage({
        activeLocale: 'en',
        nativeLanguage: 'English (American)',
        practiceLanguage: 'French',
      }),
    ).toBe('English (American)');
  });

  it('LIFE-LANG-7 — UI locale in the practice language → returns the practice NAME (exact immersion match)', () => {
    expect(
      resolveSystemLanguage({
        activeLocale: 'fr',
        nativeLanguage: 'English (American)',
        practiceLanguage: 'French',
      }),
    ).toBe('French');
  });

  it('LIFE-LANG-7 — UI locale in a THIRD language → the locale English exonym', () => {
    expect(
      resolveSystemLanguage({
        activeLocale: 'de',
        nativeLanguage: 'English (American)',
        practiceLanguage: 'French',
      }),
    ).toBe('German');
  });

  it('LIFE-LANG-7 — an unmappable locale falls back to the native language', () => {
    expect(
      resolveSystemLanguage({
        activeLocale: 'zz-not-a-locale',
        nativeLanguage: 'English (American)',
        practiceLanguage: 'French',
      }),
    ).toBe('English (American)');
  });

  it('LIFE-LANG-7 — plain "English" native + en locale resolves to "English" (via the exonym fallback)', () => {
    // "English" isn't a chat-language NAME, so the native/practice
    // preference misses; the locale exonym for `en` IS "English", which
    // still equals the native name → no setup warning fires.
    expect(
      resolveSystemLanguage({
        activeLocale: 'en',
        nativeLanguage: 'English',
        practiceLanguage: 'French',
      }),
    ).toBe('English');
  });
});
