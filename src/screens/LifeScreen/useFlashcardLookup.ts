/**
 * LIFE-EX-VOCAB-1 + LIFE-BUBBLE-7: the user's flashcard deck as a
 * normalised-phrase → card lookup, filtered to the world's practice
 * language (a card for a different language shouldn't match this
 * world). Keyed by lowercased + trimmed phrase so lookups are O(1).
 *
 * Consumers: ActionBar chips that match a saved phrase render as
 * vocab cards; bubble word-saves derive their saved/unsaved state
 * (and the card id for unsave) from the same map.
 *
 * Extracted from LifeScreen.tsx in Phase E — the screen sits at the
 * 600-LOC lint cap; this is pure derived state with no UI.
 */
import { useMemo } from 'react';
import { useFlashcards } from '@/hooks/useFlashcards';
import type { LifeWorld } from '@/types/firestore';
import type { FlashcardMatch } from './ActionBar';

export function useFlashcardLookup(
  uid: string | null,
  world: LifeWorld | null,
): ReadonlyMap<string, FlashcardMatch> {
  const flashcards = useFlashcards(uid);
  return useMemo(() => {
    const m = new Map<string, FlashcardMatch>();
    if (!world) return m;
    const lang = world.practiceLanguage;
    for (const card of flashcards.data ?? []) {
      const cardLang = card.practiceLanguage;
      if (cardLang && lang && cardLang !== lang) continue;
      const phrase = card.phrase ?? '';
      const translation = card.translation ?? '';
      if (!phrase.trim() || !translation.trim()) continue;
      m.set(phrase.trim().toLowerCase(), {
        id: card.id,
        phrase,
        translation,
        context: card.context ?? null,
      });
    }
    return m;
  }, [flashcards.data, world]);
}
