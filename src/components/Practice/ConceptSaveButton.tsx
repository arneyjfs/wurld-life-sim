import { useState } from 'react';
import { Loader } from 'lucide-react';
import { FlashcardIcon } from '@/components/FlashcardIcon';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useUIStore } from '@/store/uiStore';
import { addFlashCard } from '@/lib/flashcards';
import { toUserMessage } from '@/lib/errors';
import * as log from '@/lib/log';
import type { SaveableConcept } from './SaveConceptsSection';

type Props = {
  uid?: string;
  practiceLanguage?: string;
  nativeLanguage?: string;
  concept: SaveableConcept;
  /** Visual size — `sm` is the inline-with-results variant; `md` is the
   *  standalone compact card. Default `sm`. */
  size?: 'sm' | 'md';
  /** When true, persist state externally — accept savedExternal +
   *  onSaved so a parent like a "Save all" handler can coordinate
   *  several buttons. Default behaviour is self-contained per button. */
  savedExternal?: boolean;
  onSaved?: (id: string) => void;
};

/**
 * Single-concept save button. Uses the shared `<FlashcardIcon>`
 * (PRACTICE-SUM-6.5, CARDS-ICON-1) so the affordance reads the same as every other
 * "save / open flashcards" surface in the app.
 *
 * Self-contained save state: each instance tracks its own
 * `saved`/`saving` flag so a parent doesn't have to thread a map of
 * ids. For batch coordination (Save-all), the parent passes
 * `savedExternal` + `onSaved`.
 */
export function ConceptSaveButton({
  uid,
  practiceLanguage,
  nativeLanguage,
  concept,
  size = 'sm',
  savedExternal,
  onSaved,
}: Props) {
  const t = useT();
  const pushToast = useUIStore((s) => s.pushToast);
  const [savedLocal, setSavedLocal] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = savedExternal ?? savedLocal;

  async function save() {
    if (!uid || !practiceLanguage || !nativeLanguage) return;
    if (saved || saving) return;
    setSaving(true);
    try {
      await addFlashCard(uid, {
        phrase: concept.phrase,
        translation: concept.translation,
        practiceLanguage,
        nativeLanguage,
        ...(concept.context ? { context: concept.context } : {}),
      });
      setSavedLocal(true);
      onSaved?.(concept.id);
    } catch (err) {
      log.error(err, { action: 'saveConcept', surface: 'conceptSaveButton' }); // OBS-COVER-7
      pushToast({ kind: 'error', message: toUserMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  const sizePx = size === 'sm' ? 12 : 14;
  return (
    <button
      type="button"
      onClick={() => void save()}
      disabled={saved || saving}
      data-testid={`ConceptSaveButton-${concept.id}`}
      aria-label={t('practice.summary.saveOneCta')}
      className={cn(
        'shrink-0 inline-flex items-center gap-1 rounded-full font-semibold transition',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-xs',
        saved
          ? 'bg-(--color-success)/15 text-(--color-success)'
          : 'bg-gradient-accent text-white shadow-[0_2px_6px_-2px_rgba(115,64,245,0.45)]',
      )}
    >
      {saved ? (
        <>
          <FlashcardIcon added tone="inherit" size={sizePx} /> {t('practice.summary.saved')}
        </>
      ) : saving ? (
        <Loader size={sizePx} className="animate-spin" />
      ) : (
        <>
          <FlashcardIcon size={sizePx} /> {t('practice.summary.saveOneCta')}
        </>
      )}
    </button>
  );
}
