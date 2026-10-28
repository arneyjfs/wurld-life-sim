import { useId } from 'react';
import { BookmarkCheck, BookmarkPlus } from 'lucide-react';
import { cn } from '@/lib/cn';

type Props = {
  /** The phrase is already in the deck → `BookmarkCheck` (CARDS-ICON-2). */
  added?: boolean;
  /** Pixel size, passed straight to the Lucide glyph. */
  size?: number;
  /** `default` paints the added glyph success-green; `inherit` leaves the
   *  colour to a container that already paints it (e.g. a green chip). */
  tone?: 'default' | 'inherit';
  /** CARDS-ICON-5 — the added glyph drawn solid, the tick cut out. */
  filled?: boolean;
  className?: string;
};

/** lucide-react 1.14 `BookmarkCheck`'s own paths, so the solid form keeps its shape. */
const BOOKMARK_D =
  'M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z';
const TICK_D = 'm9 10 2 2 4-4';

/**
 * CARDS-ICON-5 — Lucide has no filled bookmark: fill the outline's path with
 * `currentColor` (stroked too, so the silhouette matches the outline glyph)
 * and mask the tick out of it, so whatever is behind shows through the tick.
 */
function SolidBookmarkCheck({ size, className }: { size: number; className?: string }) {
  const maskId = `flashcard-tick-${useId().replace(/:/g, '')}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      data-testid="flashcard-icon"
      data-added="true"
      data-filled="true"
      className={className}
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" />
        <path d={TICK_D} fill="none" stroke="black" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
      </mask>
      <path
        d={BOOKMARK_D}
        fill="currentColor"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}

/**
 * The one save-to-flashcards glyph (docs/specs/cards-screen.md CARDS-ICON-*).
 * Every add-to-deck button renders this, so the icon can't drift between
 * surfaces: a bookmark with a plus to save, a bookmark with a tick once
 * saved. The API is shared with other surfaces — widen it only additively
 * (CARDS-ICON-3).
 */
/** CARDS-ICON-1 — the same glyphs for a slot that takes an icon component. */
export const FlashcardGlyph = BookmarkPlus;
export const FlashcardAddedGlyph = BookmarkCheck;

export function FlashcardIcon({ added = false, size = 14, tone = 'default', filled = false, className }: Props) {
  if (added && filled) {
    return (
      // Keeps Lucide's class names: it IS the bookmark-check, drawn solid.
      <SolidBookmarkCheck
        size={size}
        className={cn('lucide lucide-bookmark-check', tone === 'default' && 'text-(--color-success)', className)}
      />
    );
  }
  const Glyph = added ? FlashcardAddedGlyph : FlashcardGlyph;
  return (
    <Glyph
      size={size}
      aria-hidden
      data-testid="flashcard-icon"
      data-added={added ? 'true' : 'false'}
      className={cn(added && tone === 'default' && 'text-(--color-success)', className)}
    />
  );
}
