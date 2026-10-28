import { Loader } from 'lucide-react';
import { cn } from '@/lib/cn';
import { dirOf } from '@/lib/textDirection';
import { TTSButton } from '@/components/TTSButton';
import { FlashcardIcon } from '@/components/FlashcardIcon';
import { preventComposerFocusSteal } from '@/components/MessageInput/preventFocusSteal';
import { useT } from '@/i18n';

type Props = {
  /** The tapped underlined word. */
  word: string;
  /** Native-language translation for the word (from message.translations.wordTranslations). */
  translation?: string;
  /** Whether this side of the chat is "mine" (drives text color contrast). */
  mine: boolean;
  /**
   * "Save to flashcards" button state. The button is a toggle: tapping
   * it when `saved=false` saves; tapping again (still `saved=true`) deletes
   * the just-saved card. `saving` covers BOTH directions of the toggle.
   */
  saved: boolean;
  saving: boolean;
  /**
   * Use the smaller bottom margin (1.5 spacing units) instead of the
   * default `mb-5`. Set when a row below the popover (e.g. the native
   * translation row) already adds vertical spacing — the larger margin
   * is only needed when the popover is the LAST visible row and has
   * to clear the absolute-positioned `MetaOverlay` timestamp itself.
   */
  compactMarginBottom?: boolean;
  /**
   * Explicit final width in px (MSG-VOCAB-4). When the slot has measured
   * the card's settled full-open width, it pins the card to that fixed
   * width so the content wraps to its FINAL form from frame 1 — the
   * growing grid clip then reveals it without the text re-wrapping
   * mid-animation. `null`/undefined → fall back to the intrinsic
   * `min-w-full w-max max-w-[260px]` sizing (pre-measure / measurement
   * unavailable).
   */
  pinnedWidth?: number | null;
  /**
   * MSG-VOCAB-9 — the practice language the tapped word is written in. When
   * set (and it has a `ttsCode`), a speak button at the card's left edge reads
   * JUST `word` in it. Absent → no speak button.
   */
  speakLanguage?: string;
  /** MSG-VOCAB-9.2 — playback-key scope (message id / `<id>#<variant>` /
   *  bubble id); the key is `vocab:<scope>:<word lowercased>`. */
  speakScope?: string;
  onSave: () => void;
  /**
   * MSG-VOCAB-13 / EXPLAIN-PHRASE-1 — the phrase explainer. When set, the
   * card's LEFT slot is a `?` button that calls it. Only chat bubbles pass
   * one; the review dock and the life sim do not, so their cards have no `?`.
   */
  onExplain?: () => void;
  /** EXPLAIN-PHRASE-2 — the explanation is generating: the `?` spins. */
  explaining?: boolean;
};

/** MSG-VOCAB-14.1 — the `?` and save circles: an accent wash on a received
 *  bubble (the hover grey vanished on its #f7f7f7), white at 15% on mine. */
const CIRCLE = 'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0';
const CIRCLE_MINE = 'bg-white/15 hover:bg-white/25 text-white';
const CIRCLE_THEIRS = 'bg-(--color-vocab-circle-theirs) hover:bg-(--color-accent)/20 text-(--color-icon-accent)';

/**
 * Inline popover shown below the tapped underlined word in a chat bubble.
 * Source: components/MessageBubble.tsx:1002-1019 (`renderActiveWordTooltip`).
 *
 * Intentionally minimal: `[?] word 🔈: translation [save]`. The `?` on the left
 * opens the phrase explainer (MSG-VOCAB-13, chat only); the bare speaker after
 * the word reads just the word (MSG-VOCAB-9, when a practice language is
 * passed); the circular save-to-flashcards button on the right
 * (`<FlashcardIcon>`, CARDS-ICON-*) swaps to its added glyph once saved. NO
 * language flag, NO part-of-speech.
 *
 * No self-driven enter / exit animation: the surrounding `WordPopoverSlot`
 * collapses both grid axes (rows AND columns) over 200ms, which controls
 * the popover's appearance and disappearance. The popover content stays
 * mounted at full opacity throughout the exit — `WordPopoverSlot`'s
 * `cachedWord` state keeps the last word in the DOM until `useExitTransition`
 * unmounts the wrapper.
 */
export function WordPopover({
  word,
  translation,
  mine,
  saved,
  saving,
  compactMarginBottom,
  pinnedWidth,
  speakLanguage,
  speakScope,
  onSave,
  onExplain,
  explaining,
}: Props) {
  const t = useT();
  return (
    // Sizing: `min-w-full w-max max-w-[260px]` — push + fill + wrap:
    //  - `w-max` (width: max-content): card at intrinsic content width.
    //    Contributes max-content to bubble's intrinsic, so the bubble
    //    grows to fit cards whose content is wider than the existing
    //    message rows.
    //  - `min-w-full` (min-width: 100% of parent cell): card stretches
    //    to fill the cell when the cell is wider than card.max-content
    //    (i.e., when message rows are wider than the card content).
    //  - `max-w-[260px]`: caps the popover's preferred width so long
    //    translations (e.g. "are you winning (lit: ...)") wrap to
    //    multiple lines instead of single-line overflowing. Per CSS
    //    spec `min-width` wins over `max-width` — so when the bubble
    //    is wider than 260 (rows-driven fill case), `min-w-full` still
    //    stretches the card past 260 to fill the bubble. The 260 cap
    //    only kicks in when content alone would otherwise extend past
    //    260. Static throughout the animation: cell.width animates
    //    but the popover's width is determined by max(content cap,
    //    cell), constant in the push case.
    //
    // Earlier attempts: `100cqi` referencing a `[container-type:inline-
    // size]` slot decoupled card-width from the animating cell BUT
    // also blocked propagation of max-content up to bubble.intrinsic,
    // so the bubble stopped growing. Choosing push over static-width-
    // in-fill-case.
    //
    // Margins:
    //  - `mt-2` always.
    //  - Bottom is `mb-5` when this is the LAST visible row (popover
    //    sits directly above the absolute-positioned `MetaOverlay`
    //    timestamp and needs ~28px clearance to clear it).
    //  - Bottom collapses to `mb-1.5` (= `calc(var(--spacing) * 1.5)`)
    //    when there's a row below (e.g. native translation) — that
    //    row adds its own vertical spacing AND its trailing spacer
    //    handles timestamp clearance, so the popover only needs a
    //    small gap to the row beneath it.
    <div
      data-popover-card
      className={cn(
        'mt-2 px-2.5 py-2 rounded-xl border flex items-center justify-between gap-2 break-words',
        // MSG-VOCAB-4.1 — the FLOOR is unconditional: the card is never
        // narrower than its slot, pinned or not. A pin is measured once (per
        // open / word / translation), so a bubble that grows afterwards — a
        // late native row, an arrival-resize width pin releasing, a flip —
        // would otherwise leave the card inset inside it, reading as a
        // floating chip rather than one of the bubble's own rows. Making the
        // pin a PREFERRED width instead of a ceiling costs MSG-VOCAB-4
        // nothing: in the fill case the pin already equals the settled cell
        // width, so a 100% floor measured against the still-animating
        // (narrower) cell can never exceed it.
        'min-w-full',
        // Intrinsic PREFERRED sizing only when not pinned. When pinned
        // (MSG-VOCAB-4) the explicit px width below reproduces the same final
        // geometry the `w-max max-w-[260px]` chain settles to, but fixed from
        // frame 1 so the content never re-wraps during the clip.
        pinnedWidth == null && 'w-max max-w-[260px]',
        compactMarginBottom ? 'mb-1.5' : 'mb-5',
        mine
          ? 'border-white/30 text-white'
          : 'border-(--color-card-border) text-(--color-fg)',
      )}
      style={pinnedWidth != null ? { width: `${pinnedWidth}px` } : undefined}
    >
      {onExplain && (
        <button
          type="button"
          // EXPLAIN-PHRASE-2.4 — the same keyboard guard as the speak button;
          // the click stops here so the tap never reaches the bubble.
          {...preventComposerFocusSteal}
          onClick={(e) => {
            e.stopPropagation();
            if (!explaining) onExplain();
          }}
          aria-label={t('explain.phraseButton')}
          aria-busy={explaining || undefined}
          data-testid="word-popover-explain"
          className={cn(CIRCLE, mine ? CIRCLE_MINE : CIRCLE_THEIRS)}
        >
          {explaining ? (
            <Loader size={12} className="animate-spin" />
          ) : (
            // A bare glyph, not a circled icon: the button is already the circle.
            <span aria-hidden className="text-[13px] font-bold leading-none">?</span>
          )}
        </button>
      )}
      <div dir={dirOf(word)} className="text-[13px] flex-1 min-w-0 break-words">
        <span className="font-bold">{word}</span>
        {speakLanguage && (
          // MSG-VOCAB-9.4 / 9.5 — a bare icon in the text flow, between the
          // phrase and its colon. The guard sits on a wrapper because
          // TTSButton owns its <button>; the click stops here so the tap
          // never reaches the bubble.
          <span
            data-testid="word-popover-tts"
            // The tap target is 24px; the negative margins pull the glyph in
            // so it reads as one word-gap from the phrase and its colon.
            className="inline-flex align-middle -ml-0.5 -mr-1.5 -my-1"
            {...preventComposerFocusSteal}
            onClick={(e) => e.stopPropagation()}
          >
            <TTSButton
              text={word}
              language={speakLanguage}
              playbackKey={`vocab:${speakScope ?? ''}:${word.toLowerCase()}`}
              warmOnMount={false}
              variant="bare"
              size={24}
              className={mine ? 'text-white/85 hover:text-white' : 'text-(--color-fg)'}
            />
          </span>
        )}
        <span className="font-bold">:</span>{' '}
        <span className={cn(mine ? 'text-white/90' : 'text-(--color-fg)')}>
          {translation || 'Translation unavailable'}
        </span>
      </div>
      <button
        type="button"
        // MSG-VOCAB-5: preventDefault on mousedown keeps the composer
        // focused so saving a card doesn't dismiss the keyboard mid-typing.
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.stopPropagation();
          if (!saving) onSave();
        }}
        disabled={saving}
        aria-label={saved ? 'Remove from flashcards' : 'Save to flashcards'}
        aria-pressed={saved}
        className={cn(
          CIRCLE,
          mine ? CIRCLE_MINE : CIRCLE_THEIRS,
          saving && 'opacity-80 cursor-default',
        )}
      >
        {saving ? (
          <Loader size={12} className="animate-spin" />
        ) : (
          // MSG-VOCAB-14.2 — saved: the icon itself goes solid green.
          <FlashcardIcon
            added={saved}
            filled
            size={12}
            tone="inherit"
            className={saved ? 'text-(--color-flashcard-saved)' : undefined}
          />
        )}
      </button>
    </div>
  );
}
