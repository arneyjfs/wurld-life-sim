/**
 * LIFE-BUBBLE-7: case-tolerant lookup of a tapped word's native
 * gloss in a bubble's `wordTranslations` map.
 *
 * `AnnotatedText` lowercases the word it reports on tap (chat
 * contract), but the life model authors `wordTranslations` keys with
 * narrative casing ("Salut"). Chat's own lookup chain is
 * `map[word.toLowerCase()] ?? map[word]` (BubbleRows.tsx); life adds
 * a final case-insensitive scan because its keys are model-authored
 * per beat, not normalised by a server pipeline.
 *
 * Lives in its own module (not useLifeWordSave.ts) so the render path
 * (BubbleVocabText) can import it without dragging `@/lib/flashcards`
 * — and its Firebase initialisation — into component unit tests.
 */
export function glossFor(
  source: { wordTranslations?: Record<string, string> },
  word: string,
): string | undefined {
  const map = source.wordTranslations;
  if (!map) return undefined;
  const direct = map[word] ?? map[word.toLowerCase()];
  if (direct) return direct;
  const lower = word.toLowerCase();
  const key = Object.keys(map).find((k) => k.toLowerCase() === lower);
  return key ? map[key] : undefined;
}
