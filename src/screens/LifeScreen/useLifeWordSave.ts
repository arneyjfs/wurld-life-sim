/**
 * LIFE-BUBBLE-7: save/unsave a tapped vocab word from a life bubble
 * as a flashcard.
 *
 * Deliberately NOT chat's `useMessageActions.saveFlashcardWord` —
 * that hook is coupled to a chat message (sourceMessageId/sourceChatId,
 * per-message recycled state). This one is world-scoped:
 *
 *   - Save: `addFlashCard` (shared write path, PRACTICE-SAVE-3) with
 *     the story context stamped: `"<practiceText>" — <speaker>,
 *     <location>` so card reviews recall the scene.
 *   - Saved detection: live from the already-loaded deck lookup
 *     (normalised-phrase keyed) — survives remounts + resume and
 *     syncs across devices, unlike chat's per-session Set.
 *   - Unsave: `deleteFlashcard` via the lookup match's card id. The
 *     cancellation registry inside lib/flashcards drops any in-flight
 *     topic-classify write for the deleted card.
 *   - `isSaving` covers both directions of the toggle.
 */
import { useState } from 'react';
import { useT } from '@/i18n';
import { toUserMessage } from '@/lib/errors';
import { addFlashCard, deleteFlashcard } from '@/lib/flashcards';
import * as log from '@/lib/log';
import { useUIStore } from '@/store/uiStore';
import type { LifeWorld } from '@/types/firestore';
import type { FlashcardMatch } from './ActionBar';
import { glossFor } from './wordGloss';

/** Structural subset of DialogueArea's `Bubble` that the save path
 *  needs. Declared here (not imported) to keep this module free of
 *  component imports. */
export type SaveableBubble = {
  speaker: 'narrator' | 'npc' | 'user';
  speakerName?: string | null;
  practiceText: string;
  wordTranslations?: Record<string, string>;
};

export type LifeWordSave = {
  /** True when the word (case-insensitive) is in the user's deck. */
  isSaved: (word: string) => boolean;
  /** True while the toggle for this word is in flight. */
  isSaving: (word: string) => boolean;
  /** Save when unsaved; delete the matched card when saved. */
  toggleSave: (bubble: SaveableBubble, word: string) => void;
};

export function useLifeWordSave(args: {
  uid: string | null;
  world: LifeWorld | null;
  /** Current location-ribbon label — stamped into the card context. */
  locationLabel: string;
  /** LifeScreen's normalised-phrase → card lookup (LIFE-EX-VOCAB-1
   *  map, carrying the card id for unsave). */
  flashcardLookup: ReadonlyMap<string, FlashcardMatch>;
}): LifeWordSave {
  const { uid, world, locationLabel, flashcardLookup } = args;
  const t = useT();
  const pushToast = useUIStore((s) => s.pushToast);
  const [savingWord, setSavingWord] = useState<string | null>(null);

  const norm = (word: string) => word.trim().toLowerCase();
  const matchFor = (word: string): FlashcardMatch | null =>
    flashcardLookup.get(norm(word)) ?? null;

  function isSaved(word: string): boolean {
    return matchFor(word) !== null;
  }

  function isSaving(word: string): boolean {
    return savingWord === norm(word);
  }

  function toggleSave(bubble: SaveableBubble, word: string): void {
    void run(bubble, word);
  }

  async function run(bubble: SaveableBubble, word: string): Promise<void> {
    if (!uid || !world) return;
    const key = norm(word);
    if (!key || savingWord === key) return;
    const match = matchFor(word);
    const translation = glossFor(bubble, key) ?? '';
    // Nothing to save: unsaved word with no gloss (addFlashCard
    // requires a non-empty translation).
    if (!match && !translation.trim()) return;
    setSavingWord(key);
    try {
      if (match) {
        await deleteFlashcard({ uid, cardId: match.id });
        pushToast({ kind: 'info', message: t('life.vocab.removed') });
      } else {
        const speaker =
          bubble.speaker === 'user'
            ? world.characterName
            : bubble.speakerName ?? t('life.vocab.narrator');
        await addFlashCard(uid, {
          phrase: word,
          translation,
          practiceLanguage: world.practiceLanguage,
          nativeLanguage: world.nativeLanguage,
          context: `"${bubble.practiceText}" — ${speaker}, ${locationLabel}`,
        });
        pushToast({ kind: 'success', message: t('life.vocab.saved') });
      }
    } catch (err) {
      log.error(err, { action: 'lifeWordSave' });
      pushToast({ kind: 'error', message: toUserMessage(err) });
    } finally {
      setSavingWord((prev) => (prev === key ? null : prev));
    }
  }

  return { isSaved, isSaving, toggleSave };
}
