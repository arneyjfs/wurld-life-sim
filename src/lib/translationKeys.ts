/**
 * MSG-KEY-10 — translation storage keys are BASE-language keys.
 *
 * Regional variants of one written standard share ONE translation: a French
 * message read by a British and an American English reader costs one job, and
 * a new member reuses the translations already there. The user's own setting
 * and every language name a PROMPT sees stay regional (so analysis still
 * corrects a learner toward their own variant); only the storage key changes.
 *
 * TWIN of functions/src/translationKeys.ts. `translationKeys.parity.test.ts` holds
 * the two tables and every output identical — edit both or the build fails.
 *
 * The merge table is EXPLICIT, never 'strip the brackets': stripping would put
 * Simplified and Traditional Chinese, Brazilian and European Portuguese and
 * Egyptian and Gulf Arabic under one key, and serve a reader the wrong script
 * or dialect (the bug `canonicalizeLanguageName` shipped, MSG-KEY-10.4).
 */

/** key → its members. A name in no group is its own key. */
export const TRANSLATION_KEY_GROUPS: Readonly<Record<string, readonly string[]>> = {
  English: ['English (American)', 'English (British)', 'English (Australian)', 'English (Indian)'],
  French: ['French', 'French (Canadian)'],
  'Spanish (Latin America)': ['Spanish (Latin America)', 'Spanish (Mexico)'],
};

/** MSG-KEY-10.3 — the variant a shared job is written in when neither the
 *  sender nor a majority decides it. */
export const GROUP_DEFAULT_VARIANT: Readonly<Record<string, string>> = {
  English: 'English (British)',
  French: 'French',
  'Spanish (Latin America)': 'Spanish (Latin America)',
};

/** Names the model or older data have used for a language, mapped to the
 *  stored name. Carried over from `canonicalizeLanguageName`, which accepted
 *  them. */
const NAME_ALIASES: Readonly<Record<string, string>> = {
  gaelic: 'Scottish Gaelic',
  'scots gaelic': 'Scottish Gaelic',
  gaidhlig: 'Scottish Gaelic',
  'gàidhlig': 'Scottish Gaelic',
};

const KEY_BY_MEMBER: ReadonlyMap<string, string> = new Map(
  Object.entries(TRANSLATION_KEY_GROUPS).flatMap(([key, members]) =>
    members.map((m) => [m.toLowerCase(), key] as const),
  ),
);

/** The group key a name belongs to, or the (trimmed, alias-resolved) name. */
export function translationKey(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  const low = trimmed.toLowerCase();
  const aliased = NAME_ALIASES[low];
  if (aliased) return aliased;
  return KEY_BY_MEMBER.get(low) ?? trimmed;
}

/** MSG-KEY-10.4 — the one definition of 'the same language' for translation. */
export function sameTranslationLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = translationKey(a);
  return ka.length > 0 && ka === translationKey(b);
}

/** Normalise a language name for use as part of a camelCase key:
 *  "English (British)" → "English_British". */
export function normaliseLangKeyPart(lang: string): string {
  return (lang || '')
    .replace(/\s*\(\s*([^)]+?)\s*\)/g, (_m, tag: string) => `_${tag.replace(/\s+/g, '_')}`)
    .replace(/\s+/g, '_');
}

function camelJoin(practicePart: string, nativePart: string): string {
  const p = normaliseLangKeyPart(practicePart);
  const n = normaliseLangKeyPart(nativePart);
  return `${p.charAt(0).toLowerCase() + p.slice(1)}Annotated${n.charAt(0).toUpperCase() + n.slice(1)}`;
}

/** MSG-KEY-10.2 — `{practice}Annotated{Native}` over BASE keys:
 *  ("French", "English (British)") → "frenchAnnotatedEnglish". */
export function annotatedKey(practiceLanguage: string, nativeLanguage: string): string {
  return camelJoin(translationKey(practiceLanguage), translationKey(nativeLanguage));
}
