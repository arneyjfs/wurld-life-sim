import { Check, X } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { dirOf } from '@/lib/textDirection';
import { ConceptSaveButton } from '@/components/Practice/ConceptSaveButton';
import type { SaveableConcept } from '@/components/Practice/SaveConceptsSection';
import type { PractisedWord } from '@/lib/life/vocabRecap';

/**
 * LIFE-VOCAB-RECAP-4 — "Words you practised" as FLASHCARD ROWS, not chips.
 *
 * Reported 2026-07-31: the chapter summary should render this section the way
 * practice mode's `SessionSummary` does — right/wrong hints and a save button
 * per row — rather than as an undifferentiated chip cloud.
 *
 * The data was already there: `PractisedWord` has carried `correct` and
 * `translation` since LIFE-VOCAB-RECAP-1. The chip list simply threw both away
 * — every word looked identical whether the player nailed it or missed it, and
 * there was no way to keep one. A summary that cannot tell you what you got
 * wrong is a list, not a summary.
 *
 * Deliberately mirrors `SessionSummary`'s row markup (same success/danger
 * tinting, same `phrase · translation` primary line, same `ConceptSaveButton`)
 * so the two summaries read as one product rather than two.
 *
 * A word with no gloss is NOT saveable — a flashcard whose back is empty is
 * worse than no flashcard. Those rows still render (the outcome is worth
 * seeing); they just carry no button.
 */
export function ChapterResultsList({
  words,
  uid,
  practiceLanguage,
  nativeLanguage,
  title,
  savedIds,
  onSaved,
  // Keeps the ORIGINAL testid: the section is still "Words you practised",
  // only its rendering changed, and `life-flow.spec.ts` selects on it.
  testid = 'LifeScreen-VocabRecap',
}: {
  words: PractisedWord[];
  uid?: string;
  practiceLanguage?: string;
  nativeLanguage?: string;
  title?: string;
  savedIds?: Set<string>;
  onSaved?: (id: string) => void;
  testid?: string;
}) {
  const t = useT();
  if (words.length === 0) return null;
  return (
    <div data-testid={testid}>
      <div className="text-[10px] uppercase font-semibold tracking-wider text-(--color-fg-muted)">
        {title ?? t('life.vocabRecap.title')}
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {words.map((w) => {
          const key = w.text.toLowerCase();
          const concept: SaveableConcept | null = w.translation
            ? { id: key, phrase: w.text, translation: w.translation }
            : null;
          return (
            <li
              key={key}
              data-testid={`${testid}-Row`}
              data-correct={w.correct === null ? 'untested' : String(w.correct)}
              className={cn(
                'flex items-start gap-2 p-2 rounded-xl border',
                // `correct: null` = the word was SAVED but never graded, so it
                // gets the neutral surface — claiming either outcome would be
                // a lie about something the player never answered.
                w.correct === null
                  ? 'border-(--color-border) bg-(--color-bg-elevated)'
                  : w.correct
                    ? 'border-(--color-success)/30 bg-(--color-success)/5'
                    : 'border-(--color-danger)/30 bg-(--color-danger)/5',
              )}
            >
              <div className="shrink-0 mt-0.5">
                {w.correct === null ? (
                  <span className="block w-4 h-4 rounded-full border border-(--color-border)" />
                ) : w.correct ? (
                  <Check size={16} className="text-(--color-success)" />
                ) : (
                  <X size={16} className="text-(--color-danger)" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div dir={dirOf(w.text)} className="text-sm font-medium truncate">
                  {w.text}
                  {w.translation && (
                    <>
                      <span className="text-(--color-fg-muted) font-normal"> · </span>
                      <span
                        dir={dirOf(w.translation)}
                        className="text-(--color-fg-muted) font-normal"
                      >
                        {w.translation}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {concept && (
                <ConceptSaveButton
                  uid={uid}
                  practiceLanguage={practiceLanguage}
                  nativeLanguage={nativeLanguage}
                  concept={concept}
                  savedExternal={savedIds?.has(key)}
                  onSaved={onSaved}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
