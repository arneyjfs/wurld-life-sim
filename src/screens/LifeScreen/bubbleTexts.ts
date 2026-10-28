/**
 * LIFE-LANG-3/4 — resolve which lines a life bubble shows.
 *
 * Every bubble treatment (narrator / npc / user) routes through this, so it is
 * the one place the life surface's view model is interpreted. It lives outside
 * `DialogueArea.tsx` to keep that file under the 600-LOC cap and because it is
 * worth testing on its own.
 *
 * Two rules pull against each other and the order matters:
 *
 *   1. `gated` — this bubble is the SOURCE of the active comprehension
 *      question. LIFE-LANG-4: showing the gloss would BE the answer, so the
 *      bubble renders practiceText with the native line behind an explicit
 *      reveal, whatever the player's settings say. Checked FIRST.
 *   2. Everything else follows `ViewSettings` (MSG-VIEW-7), with the
 *      per-bubble flip (LIFE-LANG-16) revealing whichever line the settings
 *      withheld.
 *
 * There is no mixed (swap-words) row: LIFE-LANG-18 is retired, and a stored
 * `primary: 'mixed'` is normalised away by `fromStored` before it gets here.
 *
 * A beat with no usable `nativeText` falls back to practiceText rather than
 * rendering empty (LIFE-WIP-2).
 */
import type { ViewSettings } from '@/lib/viewSettings';

/** Structural subset of DialogueArea's `Bubble` this needs. */
export type BubbleLines = {
  practiceText: string;
  nativeText?: string | null;
  wordTranslations?: Record<string, string>;
};

export type BubbleTexts = {
  primary: string;
  secondary: string | null;
};

export function bubbleTexts(
  bubble: BubbleLines,
  settings: ViewSettings,
  gated: boolean,
  flipped: boolean,
): BubbleTexts {
  const native =
    bubble.nativeText && bubble.nativeText.trim() ? bubble.nativeText : null;
  const practice = bubble.practiceText;

  if (gated) {
    return { primary: practice, secondary: flipped ? native : null };
  }

  const nativeFirst = settings.primary === 'native' && !!native;
  const showSecond = settings.secondRow || flipped;
  if (nativeFirst) {
    return { primary: native, secondary: showSecond ? practice : null };
  }
  return { primary: practice, secondary: showSecond ? native : null };
}
