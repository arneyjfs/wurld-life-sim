import { useMemo, useState } from 'react';
import { Loader } from 'lucide-react';
import { FlashcardIcon } from '@/components/FlashcardIcon';
import { CardListenButton } from '@/components/CardListenButton';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';
import { useUIStore } from '@/store/uiStore';
import { addFlashCard } from '@/lib/flashcards';
import { toUserMessage } from '@/lib/errors';
import * as log from '@/lib/log';

export type SaveableConcept = {
  /** Stable id so React keys are predictable + saved-set lookups are O(1). */
  id: string;
  phrase: string;
  translation: string;
  /** Optional context for the saved card (e.g. source sentence). */
  context?: string;
};

type Props = {
  uid?: string;
  practiceLanguage?: string;
  nativeLanguage?: string;
  /** The candidate concepts to surface. Caller dedupes against existing
   *  saved cards before passing in — this component is a presentation
   *  layer + write helper, not a dedup engine. */
  concepts: SaveableConcept[];
  /** Compact mode: a single-row per-question variant under a question
   *  ("New concept — Save"). Default is the full multi-item summary. */
  compact?: boolean;
};

/**
 * Per-concept save card + optional "Save all" CTA. Tracks which
 * concepts have been saved in local state so the user gets immediate
 * "Saved ✓" feedback without waiting for a Firestore round-trip.
 *
 * Used in two places:
 *   - LessonQuestion (compact=true): one concept per question, shown
 *     under the WHY block when `question.concept` exists.
 *   - SessionSummary (compact=false): batch list at the bottom of the
 *     summary screen.
 *
 * Why a single component instead of two? Both variants share the same
 * "save state per id" bookkeeping + the same write helper. Splitting
 * would duplicate that without buying anything.
 */
export function SaveConceptsSection({
  uid,
  practiceLanguage,
  nativeLanguage,
  concepts,
  compact = false,
}: Props) {
  const t = useT();
  const pushToast = useUIStore((s) => s.pushToast);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);

  const unsavedIds = useMemo(
    () => concepts.filter((c) => !savedIds.has(c.id)).map((c) => c.id),
    [concepts, savedIds],
  );

  async function save(c: SaveableConcept) {
    if (!uid || !practiceLanguage || !nativeLanguage) return;
    if (savedIds.has(c.id) || savingId === c.id) return;
    setSavingId(c.id);
    try {
      await addFlashCard(uid, {
        phrase: c.phrase,
        translation: c.translation,
        practiceLanguage,
        nativeLanguage,
        ...(c.context ? { context: c.context } : {}),
      });
      setSavedIds((prev) => {
        const next = new Set(prev);
        next.add(c.id);
        return next;
      });
    } catch (err) {
      log.error(err, { action: 'saveConcept', surface: 'saveConceptsSection' }); // OBS-COVER-7
      pushToast({ kind: 'error', message: toUserMessage(err) });
    } finally {
      setSavingId((prev) => (prev === c.id ? null : prev));
    }
  }

  async function saveAll() {
    if (!uid || !practiceLanguage || !nativeLanguage) return;
    for (const id of unsavedIds) {
      const c = concepts.find((x) => x.id === id);
      if (!c) continue;
      await save(c);
    }
  }

  if (concepts.length === 0) return null;

  if (compact) {
    // Single-row inline variant — used under a question after answer.
    const c = concepts[0]!;
    const isSaved = savedIds.has(c.id);
    const isSaving = savingId === c.id;
    return (
      <div
        className="flex items-center justify-between gap-2 p-3 rounded-2xl border border-(--color-accent)/30 bg-(--color-accent)/5"
        data-testid="SaveConcept-Inline"
      >
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wide text-(--color-accent)">
            {t('practice.summary.savedConcepts')}
          </div>
          <div className="text-sm font-medium truncate mt-0.5">
            {c.phrase}{' '}
            <span className="text-(--color-fg-muted)">= {c.translation}</span>
          </div>
        </div>
        {/* CARDS-TTS-1 */}
        <CardListenButton phrase={c.phrase} language={practiceLanguage} testId="SaveConcept-Inline-Listen" />
        <button
          type="button"
          onClick={() => void save(c)}
          disabled={isSaved || isSaving}
          data-testid="SaveConcept-Inline-Save"
          className={cn(
            'shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition',
            isSaved
              ? 'bg-(--color-success)/15 text-(--color-success)'
              : 'bg-gradient-accent text-white',
          )}
        >
          {isSaved ? (
            <>
              <FlashcardIcon added tone="inherit" size={12} /> {t('practice.summary.saved')}
            </>
          ) : isSaving ? (
            <Loader size={12} className="animate-spin" />
          ) : (
            <>
              <FlashcardIcon size={12} /> {t('practice.summary.saveOneCta')}
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <section
      className="border-t border-(--color-border) pt-4"
      data-testid="SaveConcept-Section"
    >
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold uppercase tracking-wide text-(--color-fg-muted)">
          {t('practice.summary.savedConcepts')}
        </h2>
        {unsavedIds.length > 0 && (
          <button
            type="button"
            onClick={() => void saveAll()}
            data-testid="SaveConcept-SaveAll"
            className="text-xs font-semibold text-(--color-accent) underline-offset-2 hover:underline"
          >
            {t('practice.summary.saveAllCta')}
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1.5 list-none p-0 m-0">
        {concepts.map((c) => {
          const isSaved = savedIds.has(c.id);
          const isSaving = savingId === c.id;
          return (
            <li
              key={c.id}
              className={cn(
                'flex items-center justify-between gap-2 p-2 rounded-xl border',
                isSaved
                  ? 'border-(--color-success)/30 bg-(--color-success)/5'
                  : 'border-(--color-border)',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{c.phrase}</div>
                <div className="text-xs text-(--color-fg-muted) truncate">
                  {c.translation}
                </div>
              </div>
              {/* CARDS-TTS-1 */}
              <CardListenButton phrase={c.phrase} language={practiceLanguage} testId={`SaveConcept-Listen-${c.id}`} />
              <button
                type="button"
                onClick={() => void save(c)}
                disabled={isSaved || isSaving}
                data-testid={`SaveConcept-${c.id}`}
                aria-label={t('practice.summary.saveOneCta')}
                className={cn(
                  'shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold',
                  isSaved
                    ? 'bg-(--color-success)/15 text-(--color-success)'
                    : 'border border-(--color-accent) text-(--color-accent)',
                )}
              >
                {isSaved ? (
                  <>
                    <FlashcardIcon added tone="inherit" size={12} /> {t('practice.summary.saved')}
                  </>
                ) : isSaving ? (
                  <Loader size={12} className="animate-spin" />
                ) : (
                  <>
                    <FlashcardIcon size={12} /> {t('practice.summary.saveOneCta')}
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
