import { createContext, useContext } from 'react';

export type PracticeSaveInput = {
  phrase: string;
  /** Known native translation; fetched on save when absent (PRACTICE-SAVE-12). */
  translation?: string;
  /** Longer practice sentence the phrase sits in (PRACTICE-SAVE-15). */
  context?: string;
};

export type PracticeFlashcards = {
  /** PRACTICE-SAVE-13 — in the deck, or saved earlier this session. */
  isAdded: (phrase: string) => boolean;
  /** PRACTICE-SAVE-12 — the deck's translation for a phrase, if any. */
  deckTranslation: (phrase: string) => string | undefined;
  /** Writes the card (fetching the translation first when unknown). Throws on failure. */
  save: (input: PracticeSaveInput) => Promise<void>;
};

export const PracticeFlashcardsCtx = createContext<PracticeFlashcards | null>(null);

/** Null outside a practice session — callers then render no save affordance. */
export function usePracticeFlashcards(): PracticeFlashcards | null {
  return useContext(PracticeFlashcardsCtx);
}
