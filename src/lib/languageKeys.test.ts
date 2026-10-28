import { describe, expect, it } from 'vitest';
import {
  annotatedKey,
  isViewerRelevantTranslationKey,
  normaliseLangKeyPart,
  readAnnotatedTranslation,
  readAnnotatedRow,
  readLanguageRow,
  practiceRowSource,
} from './languageKeys';

// Ported from source services/__tests__/languageKeys.test.ts. Same
// fixtures; the helper is supposed to be byte-compatible with the
// pre-cutover client so b67+ keys + the pre-b67 fallback both resolve.

describe('MSG-KEY-1 — normaliseLangKeyPart', () => {
  it('leaves plain names untouched', () => {
    expect(normaliseLangKeyPart('German')).toBe('German');
    expect(normaliseLangKeyPart('French')).toBe('French');
  });

  it('replaces parenthetical regional tags with underscore form', () => {
    expect(normaliseLangKeyPart('English (British)')).toBe('English_British');
    expect(normaliseLangKeyPart('English (American)')).toBe('English_American');
    expect(normaliseLangKeyPart('Portuguese (Brazilian)')).toBe('Portuguese_Brazilian');
    expect(normaliseLangKeyPart('Spanish (Latin America)')).toBe('Spanish_Latin_America');
  });

  it('collapses other whitespace to underscores', () => {
    expect(normaliseLangKeyPart('Simplified Chinese')).toBe('Simplified_Chinese');
  });

  it('handles empty input', () => {
    expect(normaliseLangKeyPart('')).toBe('');
  });
});

describe('MSG-KEY-1 — annotatedKey', () => {
  it('produces camelCase {practice}Annotated{Native}', () => {
    expect(annotatedKey('German', 'English')).toBe('germanAnnotatedEnglish');
    expect(annotatedKey('French', 'German')).toBe('frenchAnnotatedGerman');
  });

  it('MSG-KEY-10.2 — builds the annotated key from BASE keys (merged regional variants)', () => {
    expect(annotatedKey('English (British)', 'French')).toBe('englishAnnotatedFrench');
    expect(annotatedKey('Spanish', 'English (American)')).toBe('spanishAnnotatedEnglish');
    expect(annotatedKey('French (Canadian)', 'English (British)')).toBe('frenchAnnotatedEnglish');
  });

  it('MSG-KEY-10.1 — keeps the regional tag for variants that are NOT merged', () => {
    expect(annotatedKey('Portuguese (Brazilian)', 'English (British)')).toBe(
      'portuguese_BrazilianAnnotatedEnglish',
    );
    expect(annotatedKey('Chinese (Taiwan)', 'English')).toBe('chinese_TaiwanAnnotatedEnglish');
  });

  it('distinguishes pairs that differ only in native language', () => {
    expect(annotatedKey('German', 'English')).not.toBe(
      annotatedKey('German', 'French'),
    );
  });
});

describe('MSG-KEY-1 — readAnnotatedTranslation', () => {
  it('prefers the per-native key when present', () => {
    const translations = {
      germanAnnotatedEnglish: { text: 'new-shape' },
      German: { text: 'old-shape' },
    };
    expect(
      readAnnotatedTranslation(translations, 'German', 'English')?.text,
    ).toBe('new-shape');
  });

  it('falls back to the bare practice language for pre-migration messages', () => {
    const translations = {
      German: { text: 'old-shape' },
    };
    expect(
      readAnnotatedTranslation(translations, 'German', 'English')?.text,
    ).toBe('old-shape');
  });

  it('returns undefined when neither key is populated', () => {
    expect(readAnnotatedTranslation({}, 'German', 'English')).toBeUndefined();
    expect(readAnnotatedTranslation(null, 'German', 'English')).toBeUndefined();
    expect(readAnnotatedTranslation(undefined, 'German', 'English')).toBeUndefined();
  });

  it('MSG-KEY-10.4 — the BASE annotated key is read for every regional variant', () => {
    const translations = {
      germanAnnotatedEnglish: { text: 'base' },
    };
    expect(
      readAnnotatedTranslation(translations, 'German', 'English (British)')?.text,
    ).toBe('base');
    expect(
      readAnnotatedTranslation(translations, 'German', 'English (American)')?.text,
    ).toBe('base');
  });
});

describe('MSG-KEY-9 — practiceRowSource', () => {
  // readAnnotatedTranslation falls back from the annotated key to the bare
  // practice key and returns an entry either way, which is correct for
  // READING and wrong for DECIDING. This says which one you got.
  it('annotated — the real row, with vocab', () => {
    expect(
      practiceRowSource(
        { spanishAnnotatedEnglish: { text: 'hola' }, Spanish: { text: 'hola' } },
        'Spanish',
        'English',
      ),
    ).toBe('annotated');
  });

  it('bare — the interim that hid the bug', () => {
    // The reported case: the chat partner reads Spanish natively, so bare
    // Spanish is on every message and looks like a complete practice row.
    expect(practiceRowSource({ Spanish: { text: 'hola' } }, 'Spanish', 'English')).toBe('bare');
  });

  it('missing — neither key present', () => {
    expect(practiceRowSource({ English: { text: 'hi' } }, 'Spanish', 'English')).toBe('missing');
  });

  it('an EMPTY annotated text is not an annotated row', () => {
    // A key that exists with empty text is a job that wrote nothing useful.
    // Treating its presence as success would suppress both the hint and the
    // reconciler on exactly the message that needs them.
    expect(
      practiceRowSource(
        { spanishAnnotatedEnglish: { text: '' }, Spanish: { text: 'hola' } },
        'Spanish',
        'English',
      ),
    ).toBe('bare');
  });

  it('handles a missing translations map', () => {
    expect(practiceRowSource(undefined, 'Spanish', 'English')).toBe('missing');
    expect(practiceRowSource(null, 'Spanish', 'English')).toBe('missing');
  });
});

describe('MSG-KEY-3 — isViewerRelevantTranslationKey', () => {
  const native = 'Spanish';
  const practice = 'English (British)';

  it('matches the sender\'s practice language (BASE key)', () => {
    expect(isViewerRelevantTranslationKey('English', native, practice)).toBe(true);
  });

  it('matches the sender\'s native language', () => {
    expect(isViewerRelevantTranslationKey(native, native, practice)).toBe(true);
  });

  it('matches the sender\'s annotated-practice key (BASE form)', () => {
    expect(isViewerRelevantTranslationKey('englishAnnotatedSpanish', native, practice)).toBe(true);
    // The pre-MSG-KEY-10 regional form is no longer a viewer key.
    expect(isViewerRelevantTranslationKey('english_BritishAnnotatedSpanish', native, practice)).toBe(false);
  });

  it('does NOT match other members\' languages — sender can\'t act on those', () => {
    expect(isViewerRelevantTranslationKey('French', native, practice)).toBe(false);
    expect(isViewerRelevantTranslationKey('German', native, practice)).toBe(false);
    // Annotated key for a DIFFERENT pair (other member's view) → not theirs.
    expect(
      isViewerRelevantTranslationKey('frenchAnnotatedGerman', native, practice),
    ).toBe(false);
  });

  it('handles missing native/practice without matching unrelated keys', () => {
    // The annotated-key branch needs BOTH halves of the pair, so it
    // shouldn't fire if either is missing.
    expect(
      isViewerRelevantTranslationKey('english_BritishAnnotatedSpanish', undefined, practice),
    ).toBe(false);
    expect(
      isViewerRelevantTranslationKey('english_BritishAnnotatedSpanish', native, undefined),
    ).toBe(false);
    expect(
      isViewerRelevantTranslationKey('English (British)', null, null),
    ).toBe(false);
  });

  it('returns false for empty key', () => {
    expect(isViewerRelevantTranslationKey('', native, practice)).toBe(false);
  });
});

describe('MSG-KEY-10.4 — reads use the base key only (regional aliases retired 2026-09-29)', () => {
  it('MSG-KEY-10.4 — an American reader\'s native row reads the BASE English key', () => {
    const translations = { English: { text: 'hello' }, French: { text: 'bonjour' } };
    expect(readLanguageRow(translations, 'English (American)')?.text).toBe('hello');
  });

  it('MSG-KEY-10.4 — a regional key is NOT read: only the base key is a row', () => {
    // After the migration no document holds a regional key; a reader that
    // still fell back to one would silently keep the transition layer alive.
    const translations = { 'English (British)': { text: 'hello, mate' }, French: { text: 'salut' } };
    expect(readLanguageRow(translations, 'English (American)')).toBeUndefined();
    expect(readLanguageRow(translations, 'English (British)')).toBeUndefined();
  });

  it('MSG-KEY-10.1 — never crosses an UNmerged group (Taiwan never reads Mandarin)', () => {
    const translations = { 'Chinese (Mandarin)': { text: '你好' } };
    expect(readLanguageRow(translations, 'Chinese (Taiwan)')).toBeUndefined();
    expect(readLanguageRow({ Spanish: { text: 'coche' } }, 'Spanish (Latin America)')).toBeUndefined();
  });

  it('MSG-KEY-10.4 — ungrouped names read themselves', () => {
    expect(readLanguageRow({ German: { text: 'hallo' } }, 'German')?.text).toBe('hallo');
    expect(readLanguageRow(null, 'German')).toBeUndefined();
  });

  it('MSG-KEY-10.4 — practice row prefers the base annotated key', () => {
    const translations = {
      frenchAnnotatedEnglish: { text: 'base-annotated' },
      French: { text: 'bare' },
    };
    expect(readAnnotatedTranslation(translations, 'French', 'English (American)')?.text).toBe(
      'base-annotated',
    );
  });

  it('MSG-KEY-10.4 — a regional annotated key is NOT read; the bare base key is the fallback', () => {
    const translations = {
      frenchAnnotatedEnglish_British: { text: 'legacy-annotated' },
      French: { text: 'bare' },
    };
    expect(readAnnotatedTranslation(translations, 'French', 'English (British)')?.text).toBe('bare');
    expect(readAnnotatedRow(translations, 'French', 'English (British)')).toBeUndefined();
  });

  it('MSG-KEY-10.4 — a Canadian-French learner\'s practice row reads the base French bare key', () => {
    expect(
      readAnnotatedTranslation({ French: { text: 'bare' } }, 'French (Canadian)', 'English (British)')?.text,
    ).toBe('bare');
  });
});

describe('MSG-KEY-9 × MSG-KEY-10.4 — practiceRowSource over base keys', () => {
  it('MSG-KEY-10.4 — base annotated key → annotated', () => {
    expect(
      practiceRowSource({ frenchAnnotatedEnglish: { text: 'x' } }, 'French', 'English (British)'),
    ).toBe('annotated');
  });

  it('MSG-KEY-10.4 — a regional annotated key does not count as annotated', () => {
    const t = { frenchAnnotatedEnglish_British: { text: 'x' }, French: { text: 'y' } };
    expect(practiceRowSource(t, 'French', 'English (British)')).toBe('bare');
  });

  it('MSG-KEY-9.1 — base bare key only → bare (the interim, meaning unchanged)', () => {
    expect(practiceRowSource({ French: { text: 'y' } }, 'French (Canadian)', 'English (American)')).toBe(
      'bare',
    );
  });

  it('MSG-KEY-9.1 — an EMPTY base annotated text is still not annotated', () => {
    expect(
      practiceRowSource({ frenchAnnotatedEnglish: { text: '' }, French: { text: 'y' } }, 'French', 'English (British)'),
    ).toBe('bare');
  });

  it('MSG-KEY-9.1 — neither → missing', () => {
    expect(practiceRowSource({ English: { text: 'hi' } }, 'French', 'English (British)')).toBe('missing');
  });
});

describe('MSG-KEY-3 × MSG-KEY-10.4 — translationErrors surface under base keys only', () => {
  const native = 'English (British)';
  const practice = 'French';

  it('MSG-KEY-10.4 — base native key error is viewer-relevant', () => {
    expect(isViewerRelevantTranslationKey('English', native, practice)).toBe(true);
    expect(isViewerRelevantTranslationKey('English', 'English (American)', practice)).toBe(true);
  });

  it('MSG-KEY-10.4 — a regional error key is not this viewer\'s row', () => {
    expect(isViewerRelevantTranslationKey('English (British)', native, practice)).toBe(false);
    expect(isViewerRelevantTranslationKey('frenchAnnotatedEnglish_British', native, practice)).toBe(false);
  });

  it('MSG-KEY-10.4 — the base annotated error key is viewer-relevant', () => {
    expect(isViewerRelevantTranslationKey('frenchAnnotatedEnglish', native, practice)).toBe(true);
  });

  it('MSG-KEY-10.4 — base practice key error is relevant for a regional practice variant', () => {
    expect(isViewerRelevantTranslationKey('French', 'English', 'French (Canadian)')).toBe(true);
  });

  it('MSG-KEY-3 — still rejects another member\'s keys', () => {
    expect(isViewerRelevantTranslationKey('Spanish', native, practice)).toBe(false);
    expect(isViewerRelevantTranslationKey('frenchAnnotatedSpanish', native, practice)).toBe(false);
  });
});
