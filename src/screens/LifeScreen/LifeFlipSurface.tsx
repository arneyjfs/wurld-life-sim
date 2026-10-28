import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { LifeBubbleFlip } from './useLifeBubbleFlip';

/**
 * LIFE-LANG-16 / MSG-BUBBLE-12 — a wurld bubble that makes room for its flip
 * exactly the way a chat bubble does.
 *
 * Spec: docs/specs/message-pipeline.md — MSG-BUBBLE-12.
 *
 * THE BUBBLE'S OWN BOX NEVER ANIMATES (12.8). It is always exactly as tall as
 * its content and steps to the new size at zero width, in the same frame the
 * gloss appears, where there is nothing on screen to see it happen. What
 * animates is a blank SPACER beside it. This replaced a `grid-template-rows`
 * height glide on the bubble itself — which looked smooth in isolation and was
 * the wrong object: what has to move is the beats around it, not the card the
 * finger is on.
 *
 * The measurement contract is a set of DATA ATTRIBUTES, not a chat-specific
 * component: `useFlipHeight` walks the DOM from the twin, so any surface that
 * marks its frame, its rows and a hidden twin gets the identical schedule. That
 * is what makes "the same animation" a shared implementation rather than two
 * implementations that agree today.
 *
 * WHY THE SPACER LANDS BEFORE THE BUBBLE HERE. The dialogue column is pinned to
 * the bottom of the screen (`absolute bottom-0`), so inserted height pushes
 * everything ABOVE the insertion point up and leaves everything below it alone.
 * `flipSpacerSide` reaches the same answer on its own — with no scroller to
 * find it measures against the window, and these beats sit low in it — so this
 * component states no policy of its own.
 */
export function LifeFlipSurface({
  flip,
  className,
  /** The surface's OWN padding. Repeated on the twin so its inner column is the
   *  real text column — see MSG-BUBBLE-12.7. */
  padding,
  style,
  children,
  /** The other face's rows, for measurement only (MSG-BUBBLE-12.10). Rendered
   *  with the same components as `children` so the two are like-for-like. */
  twin,
  ...rest
}: {
  flip: LifeBubbleFlip;
  className?: string;
  padding: string;
  style?: CSSProperties;
  children: ReactNode;
  twin: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'style' | 'className' | 'children'>) {
  // Destructured up front: once `flip.twinRef` is handed to a `ref` prop the
  // lint rule treats every later `flip.*` read as a ref access during render.
  const { handlers, flipStyle, twinRef, measuring, spacerHeight, spacerSide } = flip;
  const spacer = spacerHeight > 0 && (
    <div
      aria-hidden
      data-testid="LifeBubbleFlipSpacer"
      data-side={spacerSide}
      style={{ height: spacerHeight }}
    />
  );
  return (
    // ONE flex item, spacer included. The wurld bubbles sit in columns with a
    // `gap`, so a spacer rendered as their SIBLING does not just add its own
    // height — it adds a gap as well, and removing it at the swap removes both.
    // The bubble then grows by `delta` while the column shrinks by `delta +
    // gap`, and the difference is a small jump exactly at the centre of the
    // turn. Measured at 4px, and invisible to a recorder that measures the
    // spacer's own box: that number balances perfectly, the gap is the parent's.
    //
    // This wrapper is also the FRAME (MSG-BUBBLE-12.10). It has to be: the cap
    // the twin resolves against must come from a box the SURFACE is measured
    // inside, and once the surface is no longer the flex item its own
    // `max-w-full` would resolve against this wrapper — i.e. against its own
    // outgoing width, which is the bug 12.10 exists to prevent.
    <div className="flex flex-col max-w-full min-w-0" data-flip-frame="">
      {spacerSide === 'before' && spacer}
      <div
        {...rest}
        {...handlers}
        // `relative` is load-bearing: the twin is absolutely positioned and has
        // to resolve against THIS box.
        className={cn('relative', padding, className)}
        style={{ ...flipStyle, ...style }}
        data-flip-surface=""
      >
        <div data-flip-body="">{children}</div>
        {measuring && (
          <div
            aria-hidden
            data-flip-twin=""
            className={padding}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 'max-content',
              visibility: 'hidden',
              pointerEvents: 'none',
            }}
          >
            <div ref={twinRef}>{twin}</div>
          </div>
        )}
      </div>
      {spacerSide === 'after' && spacer}
    </div>
  );
}
