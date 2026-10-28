/**
 * MSG-BUBBLE-12 — the flip's layout-height schedule.
 *
 * Spec: docs/specs/message-pipeline.md — MSG-BUBBLE-12.
 *
 * The turn itself is `scaleX(1 - progress)`, a TRANSFORM, which does not affect
 * layout — so without this the surrounding scroll learns the bubble's new
 * height in the single frame the content swaps, and redistributes it in one
 * jump (bubbles above jerk up, or bubbles below jerk down, depending which side
 * of the scroll anchor the bubble is on). This maps the same progress value
 * onto a SPACER above the bubble, so that redistribution happens over the
 * gesture instead of in one frame.
 *
 * The bubble's own box is left alone (MSG-BUBBLE-12.8) — it is always exactly
 * as tall as its content, and it changes size at zero width where nobody can
 * see it.
 *
 * PURE, and deliberately so (MSG-BUBBLE-12.3). The gesture is reversible: a
 * drag can stop at 30px, come back to 10px and release below the commit
 * threshold. A timeline started on gesture-begin cannot unwind that and would
 * strand the box at a size the content never took. A function of progress
 * unwinds for free — the same reason `scaleX` is written this way.
 */

import { FLIP_SPACE_MS } from './bubbleMotion';

/** Which way the swap goes. `null` = nothing in flight, so no pin at all. */
export type FlipDirection = 'grow' | 'shrink' | null;

export type FlipHeightInput = {
  /** 0..1. 0 = at rest / fully turned back, 1 = zero width (the swap point). */
  progress: number;
  direction: FlipDirection;
  /** The height the bubble had before the turn started. */
  fromH: number;
  /** The height the other face wants. Null until it has been measured. */
  toH: number | null;
  /** True once the content has actually swapped — i.e. the turn is on its way
   *  back out and what is on screen is the NEW face. */
  swapped: boolean;
};

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * The height of the SPACER above the bubble — never the bubble's own box.
 *
 * MSG-BUBBLE-12.8. The bubble is exactly as tall as its content, always. Its
 * height changes in one step at zero width, at the same instant the content
 * swaps, where there is nothing on screen to see it happen. Animating the
 * bubble's own box instead makes the collapsing sliver visibly stretch, and it
 * is the wrong object anyway: what has to move is the SPACE the flip needs.
 *
 * The spacer and the bubble hand off to each other so the total is continuous
 * at every point, including across the swap:
 *
 *   grow   first half   bubble fromH + spacer delta*t   -> fromH..fromH+delta
 *          swap         bubble toH   + spacer 0         =  fromH+delta   (equal)
 *   shrink first half   bubble fromH + spacer 0         =  fromH
 *          swap         bubble toH   + spacer delta     =  fromH         (equal)
 *          second half  bubble toH   + spacer delta*t   -> toH
 *
 * Which is the requirement in both directions: a grow has all its room by the
 * midpoint, so the taller face appears into space that is already there; a
 * shrink cannot give room back early (the taller face is still on screen), so
 * it holds the gap at the swap and closes it as the new face comes out.
 */
export function flipSpacerHeightAt({
  progress,
  direction,
  fromH,
  toH,
  swapped,
}: FlipHeightInput): number {
  if (!direction || toH === null) return 0;
  if (fromH <= 0 || toH <= 0) return 0;
  const delta = Math.abs(toH - fromH);
  // Sub-pixel: the two faces are effectively the same box, so there is no room
  // to make and a spacer would only add a stale pixel.
  if (delta < 1) return 0;

  // A grow carries the space BEFORE the swap and hands it to the bubble at the
  // swap; a shrink is the mirror — it takes the vacated space AT the swap and
  // gives it back on the way out. Progress runs 1 -> 0 on the way out, so
  // `delta * t` closes the gap in both readings.
  return (direction === 'grow' ? !swapped : swapped) ? delta * clamp01(progress) : 0;
}

/**
 * MSG-BUBBLE-12.7 — the other face's height, as a DELTA on the live box.
 *
 * NOT the twin's own box. The twin is absolutely positioned inside the bubble
 * surface, so it is laid out against the surface's PADDING box: it is the
 * horizontal padding wider than the real text column, and its own height
 * carries none of the vertical padding. Reading it directly under-reports the
 * target by the padding AND wraps the text at a width it will never take —
 * which on a short row drops a line, collapses the two faces to one box, and
 * makes `flipHeightAt` opt out entirely. That is how a correct schedule shipped
 * as a feature with no visible animation.
 *
 * What both faces SHARE — a reply preview, an image, the padding itself —
 * cancels in a delta, so this stays right for bubbles that hold more than rows.
 */
export function flipTargetHeight(opts: {
  /** The surface's current border-box height. */
  surfaceH: number;
  /** The rows on screen now. */
  liveBodyH: number;
  /** The same rows for the other face, laid out at the SAME width. */
  twinBodyH: number;
}): number | null {
  const { surfaceH, liveBodyH, twinBodyH } = opts;
  // A zero means the node was not laid out yet; a target derived from it would
  // pin the bubble to a size its content never takes.
  if (surfaceH <= 0 || liveBodyH <= 0 || twinBodyH <= 0) return null;
  const target = surfaceH + (twinBodyH - liveBodyH);
  // Rows taller than the surface containing them is incoherent — refuse rather
  // than pin to a collapsed box.
  return target > 0 ? target : null;
}

/**
 * MSG-BUBBLE-12.15 — the keyframes the arrival's space travels on.
 * Defined in `src/styles/globals.css`; both read `--flip-space` off the spacer.
 */
export const FLIP_SPACE_OPEN = 'flipSpaceOpen';
export const FLIP_SPACE_CLOSE = 'flipSpaceClose';

/**
 * MSG-BUBBLE-12.15 — the spacer's own animation, for an ARRIVAL turn only.
 *
 * `flipSpacerHeightAt` is driven straight off `progress`, which is correct for
 * a finger: the gesture IS the easing (MSG-BUBBLE-12.8), and anything timed on
 * top would lag the finger by its own duration. So a gesture gets `undefined`
 * here, always.
 *
 * An arrival has no finger and no frames. `useArrivalFlip` STEPS progress
 * 0 -> 1 -> 0, so the height `flipSpacerHeightAt` returns is only ever the
 * ENDPOINT of the half in flight. This covers the travel between two of them.
 *
 * ⚠ **Why an ANIMATION and not a transition.** A transition needs a previously
 * resolved computed style to move away from, and the spacer has none: the two
 * commits that start a turn — the one that mounts the measurement twin, and the
 * one its ref callback triggers with the measured target — land in the SAME
 * task, before the browser resolves style once. The element therefore first
 * exists at its destination. A keyframe animation carries its own `from`, so it
 * runs on the element's first style resolution with no history to compare
 * against. The transition this replaced was structurally inert and changed
 * nothing on screen.
 *
 * ⚠ **One animated half per turn, and the other end is a STEP.** A grow opens
 * over the first half and releases instantly at the swap; a shrink holds
 * through the first half, takes the room at the swap and closes over the
 * second. The instant end is the frame the bubble's own box moves the same
 * distance the other way (`flipSpacerHeightAt`'s hand-off table), so easing it
 * would double-count the room for the whole of the other half.
 *
 * ⚠ **`FLIP_SPACE_MS`, not `FLIP_HALF_MS`** — the travel finishes a little
 * before the half it lives in does, because the swap is on a `setTimeout` and
 * this is on the CSS clock, and the two start whole frames apart. See the
 * constant.
 */
export function flipSpacerAnimation(opts: {
  /** The ARRIVAL's curve for the half in flight. `undefined` = a gesture. */
  flipEase: string | undefined;
  /** True for exactly the first half — `useArrivalFlip`'s `holdOriginal`. */
  firstHalf: boolean;
  /** The MEASURED direction (MSG-BUBBLE-12.5), not the trigger's guess. */
  direction: FlipDirection;
  /** `|toH - fromH|`, the distance to travel. */
  delta: number;
}): string | undefined {
  const { flipEase, firstHalf, direction, delta } = opts;
  // Sub-pixel, on the same terms `flipSpacerHeightAt` opts out: the two faces
  // are one box, so there is nothing to travel and this would be a whole
  // animation from 0 to 0.
  if (!flipEase || !direction || delta < 1) return undefined;
  const travels = direction === 'grow' ? firstHalf : !firstHalf;
  if (!travels) return undefined;
  const name = direction === 'grow' ? FLIP_SPACE_OPEN : FLIP_SPACE_CLOSE;
  return `${name} ${FLIP_SPACE_MS}ms ${flipEase}`;
}

/** Which side of the bubble the flip's blank space is held on. */
export type FlipSpacerSide = 'before' | 'after';

/**
 * MSG-BUBBLE-12.9 — which side the space opens on.
 *
 * The bubble being turned must not move while it is turning: it is the thing
 * the finger is on and the thing the eye is following. Which placement achieves
 * that is decided by the scroll anchor, not by taste.
 *
 * Near the BOTTOM the scroller is bottom-pinned (SCROLL-INV-1), so inserted
 * height is absorbed by scrollTop: everything ABOVE the insertion point moves
 * up, everything below it holds. Put the spacer after the bubble there and the
 * bubble is in the half that moves — it rises out from under the finger. Near
 * the TOP nothing is pinned, so inserted height pushes everything AFTER it down
 * and the bubble holds only if the spacer follows it.
 *
 * The CENTRE decides, not the top edge: a tall bubble straddling the midpoint
 * belongs to the half its mass is in, and judging by the top edge alone flips
 * the answer for exactly the bubbles whose spacer is largest.
 *
 * Callers must latch this ONCE at turn start. Re-deciding per frame lets a
 * bubble drifting across the midpoint move its spacer from one side to the
 * other mid-gesture, which is a full `delta` teleport in both directions at
 * once.
 */
export function flipSpacerSide(opts: {
  /** The bubble surface's viewport top. */
  bubbleTop: number;
  bubbleHeight: number;
  /** The SCROLLER's viewport top — not the window's. */
  viewTop: number;
  viewHeight: number;
}): FlipSpacerSide {
  const { bubbleTop, bubbleHeight, viewTop, viewHeight } = opts;
  // Not laid out / no scroller found. `after` is what is correct at the top of
  // a list, which is where a chat that has not scrolled yet is.
  if (viewHeight <= 0) return 'after';
  const bubbleCentre = bubbleTop + bubbleHeight / 2;
  return bubbleCentre >= viewTop + viewHeight / 2 ? 'before' : 'after';
}

/**
 * MSG-BUBBLE-12.10 — the twin's wrap cap, resolved from the frame's own CSS.
 *
 * The bubble frame is `w-fit max-w-[80%]`, so the flip changes the bubble's
 * WIDTH as well as its height and the two are not independent — the rows that
 * appear are what re-decide the wrap. The twin has to resolve the same two
 * constraints the real bubble does, and the cap half of that pair cannot be
 * read off the live box (which is at the OUTGOING face's width).
 *
 * Read from `getComputedStyle` rather than duplicated as a constant, so the
 * Tailwind class stays the single source of truth for the cap. Percentages come
 * back unresolved, hence `containerWidth`.
 *
 * Returns null when there is no usable cap, which asks the caller to leave the
 * twin uncapped — `max-content` alone is the right answer when there genuinely
 * is no cap, and a cap of 0 (an unlaid-out row) would wrap every word onto its
 * own line and report a target several times the real one.
 */
export function resolveTwinMaxWidth(
  /** `getComputedStyle(frame).maxWidth` — `'80%'`, `'320px'`, `'none'`. */
  rawMaxWidth: string,
  /** Content width of the frame's containing block, for the `%` case. */
  containerWidth: number,
): number | null {
  const raw = rawMaxWidth.trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  const px = raw.endsWith('%') ? containerWidth * (value / 100) : raw.endsWith('px') ? value : NaN;
  return Number.isFinite(px) && px > 0 ? px : null;
}

/**
 * MSG-BUBBLE-12.11 — the drag position as a TURN value, `0 -> 1 -> 2`.
 *
 * `1` is zero width and the frame the content swaps; `2` is the new face back
 * at full width. `halfRange` is the travel to the midpoint, so the complete
 * turn costs twice that.
 *
 * The predecessor was `min(1, dx / range)`, which saturates at the midpoint —
 * the card sits at zero width however much further the finger travels, and the
 * reveal is a snap on release rather than something the hand did.
 */
export function flipTurnAt(leftDx: number, halfRange: number): number {
  if (halfRange <= 0) return 0;
  const t = leftDx / halfRange;
  return t < 0 ? 0 : t > 2 ? 2 : t;
}

/** The collapse the transform uses: `scaleX(1 - flipCollapseAt(turn))`. */
export function flipCollapseAt(turn: number): number {
  return clamp01(1 - Math.abs(1 - turn));
}

/**
 * True once the turn is PAST zero width — i.e. the new face is on screen.
 *
 * Strictly greater, and that is load-bearing. "The content swaps at zero width"
 * needs a frame AT zero width for the spacer to reach its full delta in; if the
 * swap fires on the same frame that reaches it, the spacer's last rendered
 * value is one frame's growth short and the bubble jumps by the remainder when
 * it takes over. Measured on the wurld surface: growth 21.875px, last spacer
 * 17.5px, a 4.4px jump at the swap. Paired with the driver landing exactly on
 * the midpoint (MSG-BUBBLE-12.12), this gives the exchange a frame where the
 * spacer holds the whole delta and the card is edge-on.
 */
export function flipTurnSwapped(turn: number): boolean {
  return turn > 1;
}

/**
 * Where a released turn settles. The midpoint is BOTH the swap point and the
 * commit threshold — one number, so the two cannot disagree.
 */
export function flipTurnSettleTarget(turn: number): number {
  // `>=`, NOT `flipTurnSwapped`. The two questions differ by exactly the
  // midpoint frame, and differ correctly: at zero width the face has not turned
  // yet, but a finger that got there meant to flip it.
  return turn >= 1 ? 2 : 0;
}

/**
 * The direction a GESTURE flip will take, from the semantics rather than a
 * measurement (MSG-BUBBLE-12.4).
 *
 * MSG-VIEW-3's flip can only ADD the native row, so turning a bubble ON makes
 * it taller-or-equal and turning it OFF makes it shorter-or-equal. That is
 * known the moment the finger lands, for free — no hidden twin of the bubble
 * rendered to measure a height nobody will ever see. When the two faces happen
 * to be the same height `flipHeightAt` opts out anyway, so a cheap signal that
 * is occasionally uninformative costs nothing.
 */
export function gestureFlipDirection(currentlyFlipped: boolean): FlipDirection {
  return currentlyFlipped ? 'shrink' : 'grow';
}

/**
 * The direction for a turn in flight, or null when nothing is turning.
 *
 * Lives here rather than in `MessageItem` so it is covered by the same tests as
 * the schedule it feeds — the two are only correct together.
 *
 * The ARRIVAL trigger (MSG-BUBBLE-12.5) has no semantic hint: an
 * opposite-language arrival can be taller or shorter. It takes the grow
 * schedule and lets the measured target decide how far, and where the two faces
 * turn out to be one box `flipHeightAt` opts out entirely — so the worst case
 * is an arrival that shrinks doing so over the first half rather than the
 * second. The gesture path, which is the one a finger is watching, keeps the
 * exact choreography.
 */
export function flipDirectionFor(opts: {
  gestureActive: boolean;
  progress: number;
  arrivalProgress: number;
  showingNative: boolean;
  /** MSG-BUBBLE-12.11 — the turn is past its midpoint, so `showingNative` is
   *  already the face it turned TO. */
  swapped?: boolean;
}): FlipDirection {
  const { gestureActive, progress, arrivalProgress, showingNative, swapped } = opts;
  if (progress <= 0 && !gestureActive) return null;
  if (arrivalProgress > 0) return 'grow';
  // MSG-BUBBLE-12.11 — the face swaps LIVE at the midpoint now, so the current
  // face is not the one the turn started on. Reading the direction off it would
  // turn a grow into a shrink halfway through the gesture, and the spacer would
  // slam shut at the exact moment it is holding the most room. Recovered rather
  // than latched in a ref: the turn value already says which half we are in.
  return gestureFlipDirection(swapped ? !showingNative : showingNative);
}

/**
 * Everything the turn drives, from the two things that can trigger one.
 *
 * The finger and the arrival share ONE progress value — whichever is turning
 * the card wins — and the transform and the height schedule must be computed
 * from the same number or they describe different animations. Extracted so
 * that is structurally true rather than a convention two call sites keep.
 */
export function flipMotion(
  /** `useSwipeActions().state`, taken whole — it is already the unit. */
  gesture: { dragX: number; flipProgress: number; flipPast?: boolean; active: boolean },
  arrivalProgress: number,
  showingNative: boolean,
): { progress: number; transform: string | undefined; direction: FlipDirection } {
  const { dragX, flipProgress, flipPast = false, active } = gesture;
  const progress = Math.max(flipProgress, arrivalProgress);
  return {
    progress,
    transform:
      active || progress > 0
        ? `translateX(${dragX}px) scaleX(${1 - progress})`
        : undefined,
    direction: flipDirectionFor({
      gestureActive: active,
      progress,
      arrivalProgress,
      showingNative,
      swapped: flipPast,
    }),
  };
}

/**
 * MSG-BUBBLE-12.13 — pin the turn's rotational centre to the OUTGOING card.
 *
 * `scaleX` scales about `transform-origin`, which defaults to the CURRENT box's
 * centre. The two faces of a flip are different widths — the bubble frame is
 * `w-fit`, so revealing a row re-decides the wrap and therefore the width — and
 * they share their ANCHORED edge, not their centre: right for a mine bubble,
 * left for a theirs. So the two centres sit half the width delta apart, and at
 * zero width, where the card is a one-pixel sliver, it jumps sideways by that
 * amount in the single frame the content swaps.
 *
 * Expressing the origin as a fixed distance from the anchored edge — half the
 * OUTGOING width — resolves to the old box's own centre for the first half (an
 * ordinary centre flip) and to that same ABSOLUTE point for the second, so
 * there is nothing to jump.
 *
 * The x-correction this looks like it still needs comes for free: at `scale(1)`
 * an element sits at its natural layout position whatever its origin, so the
 * incoming card slides to its true resting x as it widens, across the second
 * half. No separate translate, and nothing to unwind if the gesture reverses.
 *
 * `startWidth` must be the LAYOUT width (`offsetWidth`), not a bounding rect:
 * by the time a turn is measurable the frame usually already carries a scaleX,
 * and a rect would report the scaled width.
 */
export function flipTransformOrigin(opts: {
  /** Right-anchored (mine) vs left-anchored (theirs). */
  mine: boolean;
  /** The frame's layout width when the turn started. 0 = not turning. */
  startWidth: number;
}): string {
  const { mine, startWidth } = opts;
  // Not turning, or nothing measured — the default is correct at scale 1 and
  // for a flip whose two faces are the same width.
  if (!(startWidth > 0)) return 'center center';
  const half = startWidth / 2;
  return mine ? `calc(100% - ${half}px) center` : `${half}px center`;
}
