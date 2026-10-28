/**
 * LIFE-BUBBLE-7: the tappable-vocab primary-text row shared by all
 * three bubble treatments (narrator / npc / user).
 *
 * The caller passes the line it resolved for the active view mode
 * (`bubbleTexts()`'s `primary`, LIFE-LANG-3). Annotations attach to
 * `practiceText` ONLY: when the rendered line IS the practiceText,
 * the beat's complexWords render underlined through the chat
 * surface's presentational `AnnotatedText` (tap reports the
 * lowercased word); the single-open popover is coordinated through
 * the global `vocabStore` (bubble ids are the store keys — same
 * contract chat message ids use); the chat `WordPopover` renders
 * below the text with the word's native gloss + the save toggle.
 *
 * Renders plain (no buttons, no underlines) when ANY of: `wordSave`
 * absent (also how callers suppress taps, e.g. the comprehension-
 * source leak gate), the bubble carries no complexWords, or the
 * rendered line is NOT the practiceText (native-only primary,
 * LIFE-LANG-3).
 */
import { useEffect, useState } from 'react';
import { AnnotatedText } from '@/components/Message/AnnotatedText';
import { WordPopover } from '@/components/Message/WordPopover';
import { dirOf } from '@/lib/textDirection';
import { useActiveWordFor, useVocabStore } from '@/store/vocabStore';
import { useExitTransition } from '@/hooks/useExitTransition';
import type { LifeWordSave } from './useLifeWordSave';
import { glossFor } from './wordGloss';
import { prefersReducedMotion } from './nodeEngineGlide';

/** Popover height-reveal duration — matches the chat bubble's word popover. */
const POPOVER_MS = 200;

/** Structural subset of DialogueArea's `Bubble` this row needs.
 *  Declared here (not imported from DialogueArea) so there is no
 *  DialogueArea ↔ BubbleVocabText import cycle. */
export type VocabBubble = {
  id: string;
  speaker: 'narrator' | 'npc' | 'user';
  speakerName?: string | null;
  practiceText: string;
  complexWords?: string[];
  wordTranslations?: Record<string, string>;
};

type Props = {
  bubble: VocabBubble;
  /** The line to render — the caller's viewMode-resolved `primary`
   *  (`bubbleTexts()`). Annotations activate only when this equals
   *  `bubble.practiceText`. */
  text: string;
  /** Contrast flag for AnnotatedText underline + WordPopover colors:
   *  true on the gradient user bubble (white text), false on npc +
   *  narrator surfaces. */
  mine: boolean;
  /** Save/unsave wiring from useLifeWordSave. Absent → plain text
   *  (also how callers suppress taps, e.g. the comprehension-source
   *  leak gate). */
  wordSave?: LifeWordSave;
  /** Class for the text row — pass the exact class string the
   *  pre-Phase-E row used so bubble geometry doesn't change. */
  className?: string;
  /** LIFE-LANG-10: the beat line the `complexWords` annotate. Defaults
   *  to `bubble.practiceText` (npc/user dialogue). An IMMERSION narrator
   *  beat (systemLanguage == practiceLanguage) carries its narration in
   *  `nativeText`, so `SystemCueView` passes `vocabTarget=nativeText`.
   *  Taps activate only when the rendered `text` IS this line. */
  vocabTarget?: string;
  /** MSG-VOCAB-9 — the practice language; the word card's speak button
   *  reads the tapped word in it. Absent → no speak button. */
  practiceLanguage?: string;
};

export function BubbleVocabText({
  bubble,
  text,
  mine,
  wordSave,
  className,
  vocabTarget,
  practiceLanguage,
}: Props) {
  const activeWord = useActiveWordFor(bubble.id);
  const toggle = useVocabStore((s) => s.toggle);
  // LIFE-BUBBLE-7 ∩ LIFE-LANG-3/10: annotations attach to the beat's
  // annotated line only — practiceText for dialogue (default), or
  // nativeText for an immersion narrator beat. A native-only primary
  // that isn't the annotated line renders plain.
  const annotatedLine = vocabTarget ?? bubble.practiceText;
  const isAnnotatedLine = text === annotatedLine;
  const tappable =
    isAnnotatedLine && !!wordSave && (bubble.complexWords?.length ?? 0) > 0;
  // LIFE-BUBBLE-7 (v2.1): the popover opens/closes on a grid-rows height glide
  // — the SAME `useExitTransition` + 0fr↔1fr auto-height animation the chat
  // bubble uses (WordPopoverSlot), so the bubble grows/shrinks smoothly instead
  // of snapping. `cachedWord` keeps the popover populated through the close
  // animation. Reduced motion → 0ms (instant, no lingering DOM).
  const open = tappable && !!wordSave && !!activeWord;
  const { mounted, visible } = useExitTransition(
    open,
    prefersReducedMotion() ? 0 : POPOVER_MS,
  );
  const [cachedWord, setCachedWord] = useState<string | null>(activeWord);
  useEffect(() => {
    if (activeWord) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCachedWord(activeWord);
    }
  }, [activeWord]);
  const displayWord = activeWord ?? cachedWord;
  return (
    <>
      <div dir={dirOf(text)} className={className}>
        <AnnotatedText
          translation={{
            text,
            // No affordance without a tap handler: suppress the
            // underlines entirely when not tappable.
            complexWords: tappable ? bubble.complexWords : [],
          }}
          mine={mine}
          onWordTap={tappable ? (word) => toggle(bubble.id, word) : undefined}
          // Highlight the open word like the chat bubble does.
          activeWord={activeWord}
        />
      </div>
      {mounted && displayWord && wordSave && (
        <div
          className="grid"
          style={{
            transition: prefersReducedMotion()
              ? undefined
              : `grid-template-rows ${POPOVER_MS}ms ease-out`,
            gridTemplateRows: visible ? '1fr' : '0fr',
          }}
        >
          <div className="overflow-hidden min-h-0">
            <WordPopover
              word={displayWord}
              translation={glossFor(bubble, displayWord)}
              mine={mine}
              saved={wordSave.isSaved(displayWord)}
              saving={wordSave.isSaving(displayWord)}
              // Life bubbles have no MetaOverlay timestamp to clear —
              // always use the compact bottom margin.
              compactMarginBottom
              speakLanguage={practiceLanguage}
              speakScope={bubble.id}
              onSave={() => wordSave.toggleSave(bubble, displayWord)}
            />
          </div>
        </div>
      )}
    </>
  );
}
