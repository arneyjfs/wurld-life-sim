/**
 * Helpers for Firestore translation-field keys.
 *
 * Mirrors source services/languageKeys.ts. History (from source):
 *
 *   Pre-b67: every translation was stored under `translations.{Language}` —
 *   e.g. `translations.German`. That collapsed annotations into ONE native-
 *   language per practice language per chat: two German learners with
 *   different natives trampled each other.
 *
 *   b67+: annotated translations are keyed `{practice}Annotated{Native}` —
 *   e.g. `germanAnnotatedEnglish`. Bare-practice keys still exist for
 *   un-annotated (native-mode) reads.
 */

import { annotatedKey, translationKey } from './translationKeys';

/**
 * MSG-KEY-10 — storage keys are BASE-language keys. `normaliseLangKeyPart` and
 * `annotatedKey` are the base-key versions from `translationKeys.ts` (the one
 * key function, parity-held against the server's twin); they are re-exported
 * here so existing importers keep their import path.
 */
export { annotatedKey, normaliseLangKeyPart } from './translationKeys';

/**
 * MSG-KEY-10.4 — read one bare row: `translations[translationKey(lang)]`.
 * The base key is the ONLY key a row lives under (the regional-alias
 * transition layer was retired 2026-09-29 after the data migration).
 */
export function readLanguageRow<T>(
  translations: Readonly<Record<string, T>> | undefined | null,
  language: string | undefined | null,
): T | undefined {
  if (!translations || !language) return undefined;
  const baseKey = translationKey(language);
  if (!baseKey) return undefined;
  return translations[baseKey];
}

/**
 * MSG-KEY-10.4 — read one ANNOTATED row from the base annotated key.
 * Does NOT fall back to the bare practice key; `readAnnotatedTranslation` does.
 */
export function readAnnotatedRow<T>(
  translations: Readonly<Record<string, T>> | undefined | null,
  practiceLanguage: string,
  nativeLanguage: string,
): T | undefined {
  if (!translations || !practiceLanguage || !nativeLanguage) return undefined;
  return translations[annotatedKey(practiceLanguage, nativeLanguage)];
}

/**
 * Where a practice row's content came from.
 *
 *   'annotated' — the per-native annotated key. The real thing: carries the
 *                 vocab list, so the row has tappable underlines.
 *   'bare'      — the bare practice-language key. Correct WORDS, but no vocab,
 *                 because it was produced for someone who reads that language
 *                 natively. A stand-in, not an answer.
 *   'missing'   — neither key is present.
 *
 * The distinction is load-bearing and used to be invisible, which cost a real
 * bug (MSG-KEY-9). A reader whose chat partner is NATIVE in their practice
 * language already has the bare key on every message, so switching practice
 * INTO that language rendered a complete-looking row instantly — right words,
 * no underlines, no indication anything more was coming — while the annotated
 * job ran unnoticed in the background. "Have the language" and "have the row
 * this reader needs" are different questions, and only the second one matters.
 */
export type PracticeRowSource = 'annotated' | 'bare' | 'missing';

export function practiceRowSource(
  translations: Record<string, unknown> | undefined | null,
  practiceLanguage: string,
  nativeLanguage: string,
): PracticeRowSource {
  if (!translations) return 'missing';
  // Read the SAME entry `readAnnotatedTranslation` renders, so the
  // classification describes what is on screen.
  const entry = readAnnotatedRow(translations, practiceLanguage, nativeLanguage) as
    | { text?: string }
    | undefined;
  if (entry?.text) return 'annotated';
  const bare = readLanguageRow(translations, practiceLanguage) as { text?: string } | undefined;
  return bare?.text ? 'bare' : 'missing';
}

/**
 * Read the annotated translation entry from a message's translations map.
 * Prefers the per-native annotated key (b67+), falls back to the bare
 * practice-language key (pre-b67, and the interim window described above).
 *
 * Callers that RENDER the result should also ask `practiceRowSource`: the
 * fallback is legitimate as an interim, and misleading as a final answer.
 */
export function readAnnotatedTranslation<T>(
  translations: Record<string, T> | undefined | null,
  practiceLanguage: string,
  nativeLanguage: string,
): T | undefined {
  if (!translations) return undefined;
  return (
    readAnnotatedRow(translations, practiceLanguage, nativeLanguage) ??
    readLanguageRow(translations, practiceLanguage)
  );
}

/**
 * Is a given `translationErrors` key one the VIEWER needs?
 *
 * Applies to whoever is rendering the bubble — sender or recipient —
 * since both see the message and both have their own native/practice
 * language pair. The pipeline produces translations for EVERY chat
 * member's pair, so a `translationErrors` map can contain keys that
 * only matter to a different member. Surfacing those as a retry to
 * THIS viewer is noise — the viewer can't tell from their own bubble
 * whether the other side's rendering is broken.
 *
 * Viewer-relevant keys are: the viewer's native language, the viewer's
 * practice language, and the annotated `${practice}Annotated${native}`
 * form used for the bilingual practice row in the viewer's bubble.
 *
 * Used by MessageItem to decide whether to render the "Translation
 * failed · Retry" row beneath the bubble (and, for recipients, to flip
 * the bubble out of its in-flight shimmer into an italic+muted
 * originalText fallback so there's SOMETHING to read while waiting on
 * the retry).
 */
export function isViewerRelevantTranslationKey(
  key: string,
  nativeLanguage: string | undefined | null,
  practiceLanguage: string | undefined | null,
): boolean {
  if (!key) return false;
  // MSG-KEY-10.4 — error rows live under the base key, like every other row.
  for (const lang of [nativeLanguage, practiceLanguage]) {
    if (!lang) continue;
    if (key === translationKey(lang)) return true;
  }
  if (nativeLanguage && practiceLanguage) {
    if (key === annotatedKey(practiceLanguage, nativeLanguage)) return true;
  }
  return false;
}
