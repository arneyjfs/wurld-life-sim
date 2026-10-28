import { useState } from 'react';
import { Loader } from 'lucide-react';
import { cn } from '@/lib/cn';
import { dirOf } from '@/lib/textDirection';
import { useT } from '@/i18n';
import { useUIStore } from '@/store/uiStore';
import { toUserMessage } from '@/lib/errors';
import * as log from '@/lib/log';
import { FlashcardIcon } from '@/components/FlashcardIcon';
import { usePracticeFlashcards } from './practiceFlashcardsCtx';

type Props = {
  phrase: string;
  /** Translation the question already knows (PRACTICE-SAVE-12). */
  translation?: string;
  /** Practice sentence the phrase sits in (PRACTICE-SAVE-15). */
  context?: string;
  /** Show the translation inline next to the button. Default true. */
  showGloss?: boolean;
  /** `inverted` sits on the dark word-chip tooltip. */
  tone?: 'default' | 'inverted';
  className?: string;
};

/**
 * PRACTICE-SAVE-10 — the in-place add-to-flashcards button a practice word or
 * phrase carries once the question is answered, with its translation inline
 * when one is known. `data-state` is `add` / `saving` / `added`.
 */
export function PracticeSaveButton({
  phrase,
  translation,
  context,
  showGloss = true,
  tone = 'default',
  className,
}: Props) {
  const t = useT();
  const pushToast = useUIStore((s) => s.pushToast);
  const flashcards = usePracticeFlashcards();
  const [saving, setSaving] = useState(false);
  if (!flashcards || !phrase.trim()) return null;

  const added = flashcards.isAdded(phrase);
  const gloss = translation?.trim() || flashcards.deckTranslation(phrase);
  const state = added ? 'added' : saving ? 'saving' : 'add';

  async function onSave() {
    if (!flashcards || added || saving) return;
    setSaving(true);
    try {
      await flashcards.save({ phrase, translation: gloss, context });
    } catch (err) {
      log.error(err, { action: 'saveConcept', surface: 'practiceSaveButton' }); // OBS-COVER-7
      pushToast({ kind: 'error', message: toUserMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className={cn('inline-flex items-center gap-2 shrink-0', className)}>
      {showGloss && gloss && (
        <span
          dir={dirOf(gloss)}
          className="text-xs text-(--color-fg-muted) text-right"
          data-testid="PracticeSave-Gloss"
        >
          {gloss}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void onSave();
        }}
        disabled={added || saving}
        data-testid="PracticeSave"
        data-phrase={phrase}
        data-state={state}
        aria-label={added ? t('practice.inFlashcards') : t('practice.addToFlashcards')}
        title={added ? t('practice.inFlashcards') : t('practice.addToFlashcards')}
        className={cn(
          'setup-success-pop shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors',
          tone === 'inverted' && 'w-6 h-6 text-(--color-bg)',
          tone === 'default' &&
            (added ? 'text-(--color-success)' : 'text-(--color-accent) hover:bg-(--color-accent)/10'),
        )}
      >
        {saving ? <Loader size={16} className="animate-spin" /> : <FlashcardIcon added={added} size={18} tone="inherit" />}
      </button>
    </span>
  );
}
