import { useEffect, useState, type ReactNode } from 'react';
import { useExitTransition } from '@/hooks/useExitTransition';

/** How long the second row takes to open or close. */
export const SECOND_ROW_MS = 200;

/**
 * MSG-VIEW-7.9 — the eye REVEALS the second row, it does not turn the card.
 *
 * Spec: docs/specs/message-pipeline.md — MSG-VIEW-7.
 *
 * Adding or removing a row is a reveal, not a swap: the rows already on screen
 * stay exactly where they are and a new one grows in beneath them. A card flip
 * says "this became that", which is true of the swipe peek and false here — the
 * practice row did not become anything, a translation appeared under it.
 *
 * A `grid-template-rows` 0fr↔1fr glide, the same technique the vocab popover
 * uses: it animates to the row's natural height without anyone measuring it.
 *
 * THE GRID IS ALWAYS RENDERED, even closed. It must persist at `0fr` so the
 * browser has that baseline computed style and the `0fr → 1fr` transition
 * actually runs — a div that first appears when the row opens has `1fr` in its
 * very first paint, so there is nothing to transition FROM and the row snaps
 * to full height. Only the CHILDREN are gated, and `useExitTransition` keeps
 * them mounted through the close so the row has content to shrink.
 *
 * IT YIELDS TO A TURN IN FLIGHT (`instant`). MSG-BUBBLE-12.8 gives the flip the
 * opposite rule — the bubble's own box must NOT animate, because the space
 * beside it is carrying the movement and the box steps at zero width. Both
 * animating at once would fight: the spacer would open for a height change that
 * then arrives gradually anyway. So while a card is turning this steps, and the
 * turn owns the motion.
 */
export function SecondRowReveal({
  show,
  instant,
  measuring,
  children,
}: {
  show: boolean;
  /** A flip is in flight — step, don't glide (MSG-BUBBLE-12.8). */
  instant?: boolean;
  /** This subtree is the measurement TWIN (MSG-BUBBLE-12.10), so render the
   *  SETTLED layout: no grid track, no exit-hold, nothing whose sizing the
   *  browser could resolve differently from a plain row. The twin's whole job
   *  is to report the height the real rows will take, and every wrapper it
   *  carries that the settled DOM does not is a way for that to be wrong. */
  measuring?: boolean;
  children: ReactNode;
}) {
  const glide = useExitTransition(show, instant ? 0 : SECOND_ROW_MS);
  // `instant` BYPASSES the transition machinery rather than shortening it.
  // `useExitTransition` defers `visible` to a rAF so an enter has a false→true
  // edge to animate from — correct for a glide, and a one-frame lag when there
  // is no glide to run. During a flip that lag lands exactly on the swap: the
  // spacer hands its room to the bubble in the swap commit, but the row that
  // makes the bubble taller arrives a frame later, so for one frame the bubble
  // is still short and nothing is holding the space. That is a visible jitter
  // in the middle of the turn — the gap snapping shut and open again.
  const mounted = instant ? show : glide.mounted;
  const visible = instant ? show : glide.visible;
  // Held so the row still has content to shrink on the way out: the parent
  // stops passing children the instant the row is switched off.
  const [cached, setCached] = useState<ReactNode>(children);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (show) setCached(children);
  }, [show, children]);

  // A bubble that mounts with its second row ALREADY on does not play the
  // reveal, and needs no guard to stop it: `useExitTransition` initialises
  // `visible` from `open`, so the track's FIRST computed style is `1fr`, and a
  // CSS transition never runs on an element's first style — there is no
  // previous value to animate from. The guard this used to carry (arm the
  // transition a commit late) was solving a problem that does not exist, and
  // armed before the opening edge anyway.
  if (measuring) return <>{show ? children : null}</>;

  return (
    <div
      className="grid motion-reduce:transition-none"
      data-testid="MessageSecondRowReveal"
      data-open={visible ? 'true' : 'false'}
      style={{
        transition: instant ? undefined : `grid-template-rows ${SECOND_ROW_MS}ms ease-out`,
        gridTemplateRows: visible ? '1fr' : '0fr',
      }}
    >
      <div className="overflow-hidden min-h-0">{mounted ? (show ? children : cached) : null}</div>
    </div>
  );
}
