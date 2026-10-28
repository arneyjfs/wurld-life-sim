import { readLanguageRow } from '@/lib/languageKeys';
import { sameTranslationLanguage } from '@/lib/translationKeys';
import type { Message } from '@/types/firestore';

/**
 * EXPLAIN-ORIG-1/3/4 — the original the review is judged against, when it is a
 * language neither card below shows. Null when there is nothing new to show.
 * Spec: docs/specs/explain.md §1.
 */
export function originalDisclosureSource(
  message: Message | null,
  practiceLanguage: string,
  nativeLanguage: string,
): { language: string; text: string } | null {
  const language = message?.originalLanguage;
  if (!message || !language) return null;
  if (sameTranslationLanguage(language, practiceLanguage)) return null;
  if (sameTranslationLanguage(language, nativeLanguage)) return null;
  // EXPLAIN-ORIG-3 — the original-language ROW (what the explain prompt
  // reviews against, SRV-PROMPT-6), never `message.originalText`.
  const text = readLanguageRow(message.translations, language)?.text;
  if (!text || !text.trim()) return null;
  return { language, text };
}
