/**
 * LIFE-UI-3 + LIFE-EX-VOCAB-1: chip grid + free-text composer.
 * Chips that match a saved flashcard render with a vocab-card
 * affordance and open a card preview on tap rather than firing
 * the choice directly.
 *
 * Spec: docs/specs/life-sim.md §8 (LIFE-UI-3), §10 (LIFE-EX-VOCAB-1).
 */
import { useState } from 'react';
import { useOverlayBack } from '@/hooks/useOverlayBack';
import { BookOpen, Send, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  OPTION_BAR_CLASS,
  OPTION_CHIP_MIN_H,
  OPTION_GRID_CLASS,
  OPTION_GRID_MIN_H,
} from './optionRowMetrics';
import { dirOf } from '@/lib/textDirection';
import { useT } from '@/i18n';

export type Choice = {
  id: string;
  practiceText: string;
  nativeText?: string | null;
  emoji?: string | null;
};

/** LIFE-LANG-1/3: which single language (or both) a chip's face
 *  shows. 'both' = practice main + native sub; 'practice' = practice
 *  main only; 'native' = native main only (falls back to practiceText
 *  when nativeText is empty — a chip never renders blank). */
export type ChipDisplay = 'both' | 'practice' | 'native';

/** Matched flashcard for a chip — drives the vocab-card render.
 *  LIFE-BUBBLE-7 also derives bubble word-save state from this map;
 *  `id` lets an unsave route to `deleteFlashcard`. */
export type FlashcardMatch = {
  id: string;
  phrase: string;
  translation: string;
  context?: string | null;
};

type Props = {
  choices: Choice[];
  onPick: (choiceId: string) => void;
  /** LIFE-NODE-4: submit handler for the ✏️ "write your own"
   *  composer. The composer renders ONLY while `composerOpen` —
   *  there is no always-visible composer. */
  onFreeText?: (text: string) => void;
  /** LIFE-NODE-4: when true, the chip grid is replaced by the
   *  inline composer. Opened by the client ✏️ chip. */
  composerOpen?: boolean;
  /** Dismiss the composer without submitting (back to chips). */
  onComposerCancel?: () => void;
  /** Placeholder + button label vary by language; the caller
   *  provides them via i18n. */
  freeTextPlaceholder?: string;
  disabled?: boolean;
  /** LIFE-LANG-1/3: chip display language. Graded turns pin it per
   *  kind (comprehension → 'native', fill-blank → 'practice');
   *  CYOA turns follow the wurld's viewMode. Defaults to 'both'.
   *  REPLACES the old boolean `hideChipNative`. */
  chipDisplay?: ChipDisplay;
  /** LIFE-EX-VOCAB-1: lookup keyed by normalised practiceText
   *  (lowercased + trimmed). When a chip's normalised practiceText
   *  is in this map, the chip renders as a vocab card and tap
   *  opens a preview popover instead of firing onPick. */
  flashcardLookup?: ReadonlyMap<string, FlashcardMatch>;
  /** LIFE-UI-12: reserve the two skeleton rows on the grid, so a turn that
   *  comes back with fewer chips than the skeleton showed does not shrink the
   *  block. Set on the CYOA options path (the one the skeleton stands in for);
   *  left off for graded chips and the single Continue chip, which the
   *  skeleton never represented. */
  reserveGrid?: boolean;
};

export function ActionBar({
  choices,
  onPick,
  onFreeText,
  composerOpen = false,
  onComposerCancel,
  freeTextPlaceholder,
  disabled = false,
  flashcardLookup,
  chipDisplay = 'both',
  reserveGrid = false,
}: Props) {
  const t = useT();
  // Free-text composer is ALWAYS rendered on non-graded turns
  // (callers gate this by passing onFreeText). The legacy
  // `__free__` marker chip is filtered out if the model still emits
  // one — we don't render it as a chip, we render the composer.
  const FREE_ID = '__free__';
  const chipChoices = choices.filter((c) => c.id !== FREE_ID);
  const [freeText, setFreeText] = useState('');
  const canSubmit = !!onFreeText && freeText.trim().length > 0 && !disabled;
  /** Currently-open vocab popover; null when no card preview is
   *  showing. The chip stays on-screen but is non-interactive while
   *  the popover overlays it. */
  const [popover, setPopover] = useState<{
    choice: Choice;
    match: FlashcardMatch;
  } | null>(null);

  function lookupMatch(c: Choice): FlashcardMatch | null {
    if (!flashcardLookup) return null;
    const key = c.practiceText.trim().toLowerCase();
    return flashcardLookup.get(key) ?? null;
  }

  function submitFreeText() {
    if (!canSubmit || !onFreeText) return;
    const value = freeText.trim();
    setFreeText('');
    onFreeText(value);
  }

  function handleChipTap(c: Choice) {
    if (disabled) return;
    const match = lookupMatch(c);
    if (match) {
      setPopover({ choice: c, match });
      return;
    }
    onPick(c.id);
  }

  return (
    <div
      // COMP-KB-14: `.pb-keyboard` rides the ✏️ free-text composer above the
      // soft keyboard (the same driver + util the chat composer uses). Keyboard
      // down → safe-area / floor padding; keyboard up → keyboard height.
      // LIFE-UI-12: the padding is a shared constant — the loading block
      // renders the SAME bar, so the two can never carry different seams.
      className={OPTION_BAR_CLASS}
      data-testid="LifeScreen-ActionBar"
    >
      {!composerOpen && (
      <div
        className={cn(OPTION_GRID_CLASS, reserveGrid && OPTION_GRID_MIN_H)}
        data-testid="LifeScreen-OptionsGrid"
      >
        {chipChoices.map((c, i) => {
          const match = lookupMatch(c);
          const isVocab = !!match;
          // LIFE-LANG-1/3: one language per chip face. 'native' falls
          // back to practiceText when the native label is empty so no
          // chip ever renders blank (LIFE-WIP-2).
          const mainText =
            chipDisplay === 'native' && c.nativeText && c.nativeText.trim()
              ? c.nativeText
              : c.practiceText;
          const subText =
            chipDisplay === 'both' && c.nativeText && c.nativeText.trim()
              ? c.nativeText
              : null;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => handleChipTap(c)}
              disabled={disabled}
              data-testid={`LifeScreen-Choice-${c.id}`}
              data-vocab={isVocab ? 'true' : undefined}
              // LIFE-UI-ANIM: option cards stagger IN on mount (a fresh option
              // set re-mounts on new ids) — fade + slide-up, reduced-motion off.
              style={{ animationDelay: `${i * 45}ms` }}
              className={cn(
                // LIFE-UI-10: floor at the two-line box so a one-line label
                // occupies the same height as the skeleton it replaced. Not a
                // fixed height — a longer label must still be readable.
                'flex flex-col items-start justify-center gap-0.5 px-3 py-2.5 rounded-2xl text-left relative',
                OPTION_CHIP_MIN_H,
                'transition-colors',
                'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:fill-mode-both motion-safe:duration-300',
                isVocab
                  ? 'border-gradient-accent'
                  : 'border border-(--color-border) bg-(--color-bg-elevated)',
                disabled
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-(--color-bg-hover) active:scale-[0.98]',
              )}
            >
              {isVocab && (
                <BookOpen
                  size={12}
                  className="absolute top-1.5 right-1.5 text-(--color-accent)"
                  aria-label={t('life.vocabChip.savedBadge')}
                />
              )}
              <div dir={dirOf(mainText)} className="flex items-center gap-1.5 text-sm font-medium text-(--color-fg) leading-snug">
                {c.emoji && <span className="text-base leading-none">{c.emoji}</span>}
                <span>{mainText}</span>
              </div>
              {subText && (
                <div dir={dirOf(subText)} className="text-[11px] text-(--color-fg-muted) leading-snug">
                  {subText}
                </div>
              )}
            </button>
          );
        })}
      </div>
      )}
      {popover && (
        <VocabPopover
          choice={popover.choice}
          match={popover.match}
          onClose={() => setPopover(null)}
          onUse={() => {
            const id = popover.choice.id;
            setPopover(null);
            onPick(id);
          }}
        />
      )}
      {composerOpen && onFreeText && (
        <form
          className="max-w-md mx-auto mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitFreeText();
          }}
          data-testid="LifeScreen-FreeText"
        >
          <input
            type="text"
            autoFocus
            value={freeText}
            dir={dirOf(freeText)}
            onChange={(e) => setFreeText(e.target.value)}
            disabled={disabled}
            placeholder={freeTextPlaceholder ?? t('life.freeText.placeholder')}
            className={cn(
              'flex-1 px-3 py-2 rounded-full text-sm border border-(--color-border) bg-(--color-bg-elevated)',
              'focus:outline-none focus:ring-2 focus:ring-(--color-accent)/40',
              disabled && 'opacity-50',
            )}
          />
          <button
            type="submit"
            disabled={!canSubmit}
            aria-label={t('life.freeText.send')}
            data-testid="LifeScreen-FreeText-Send"
            className={cn(
              'p-2 rounded-full flex-shrink-0',
              canSubmit
                ? 'bg-gradient-accent text-white'
                : 'bg-(--color-bg-hover) text-(--color-fg-muted) cursor-not-allowed',
            )}
          >
            <Send size={16} />
          </button>
          <button
            type="button"
            onClick={onComposerCancel}
            aria-label={t('life.writeYourOwn.cancel')}
            data-testid="LifeScreen-FreeText-Cancel"
            className="p-2 rounded-full flex-shrink-0 bg-(--color-bg-hover) text-(--color-fg-muted)"
          >
            <X size={16} />
          </button>
        </form>
      )}
    </div>
  );
}

/** LIFE-EX-VOCAB-1: card preview shown when the player taps a chip
 *  whose practiceText matches a saved flashcard. Backdrop tap or
 *  the close button dismisses without firing the choice; the "Use"
 *  button fires it. Render scope is local — no portal, no escape
 *  hatch. The backdrop overlays the chip grid (z-50) while
 *  remaining contained within the ActionBar's stacking context. */
function VocabPopover({
  choice,
  match,
  onClose,
  onUse,
}: {
  choice: Choice;
  match: FlashcardMatch;
  onClose: () => void;
  onUse: () => void;
}) {
  const t = useT();
  // NAV-OVERLAY-2 — Android back closes this overlay before it leaves the page.
  useOverlayBack(true, onClose);
  return (
    <div
      data-testid="LifeScreen-VocabPopover"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
    >
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md mx-3 mb-3 sm:mb-0 rounded-2xl bg-(--color-bg-elevated) border border-(--color-border) shadow-xl p-4 animate-in fade-in slide-in-from-bottom-3 duration-200">
        <button
          type="button"
          onClick={onClose}
          data-testid="LifeScreen-VocabPopover-Close"
          aria-label={t('common.close')}
          className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-(--color-bg-hover) text-(--color-fg-muted)"
        >
          <X size={16} />
        </button>
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--color-fg-muted)">
          <BookOpen size={12} className="text-(--color-accent)" />
          {t('life.vocabChip.popover.title')}
        </div>
        <div className="mt-2 text-lg font-semibold text-gradient-accent">
          {match.phrase}
        </div>
        <div className="mt-0.5 text-sm text-(--color-fg)">
          {match.translation}
        </div>
        {match.context && (
          <div className="mt-3 text-xs italic text-(--color-fg-muted) border-l-2 border-(--color-accent)/40 pl-2">
            {match.context}
          </div>
        )}
        <button
          type="button"
          onClick={onUse}
          data-testid="LifeScreen-VocabPopover-Use"
          className="mt-4 w-full py-2.5 rounded-full bg-gradient-accent text-white text-sm font-semibold"
        >
          {t('life.vocabChip.popover.use', { chip: choice.practiceText })}
        </button>
      </div>
    </div>
  );
}
