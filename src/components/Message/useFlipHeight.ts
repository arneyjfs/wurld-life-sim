import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  flipSpacerAnimation,
  flipSpacerHeightAt,
  flipSpacerSide,
  flipTargetHeight,
  resolveTwinMaxWidth,
  type FlipDirection,
  type FlipSpacerSide,
} from './flipHeight';

/**
 * MSG-BUBBLE-12.15 — the ARRIVAL trigger, when one is driving this turn.
 *
 * A gesture passes nothing and keeps every rule it had. Everything this
 * changes is downstream of "there is no finger here": the direction has to be
 * measured rather than assumed, the halves are named by `holdOriginal` rather
 * than by the face on screen, and the travel between two stepped endpoints has
 * to be supplied by CSS.
 */
type ArrivalTurn = {
  /** `useArrivalFlip`'s curve for the half in flight. */
  ease: string | undefined;
  /** `useArrivalFlip`'s `holdOriginal` — true for exactly the first half. */
  firstHalf: boolean;
};

type Turn = { fromH: number; toH: number; startFace: boolean; side: FlipSpacerSide };

/**
 * The nearest scrolling ancestor — the viewport MSG-BUBBLE-12.9 measures
 * against. The window is the wrong frame: the chat list is inset by a header
 * and a composer, so its midpoint is not the screen's.
 *
 * Prefers an ancestor that is ACTUALLY overflowing. A styled-but-not-scrolling
 * box (a modal body, a clipped strip) can sit between the bubble and the real
 * scroller, and taking it would measure the bubble's position against a frame
 * it does not scroll in — which decides the spacer's side wrongly for every
 * bubble in the list.
 */
function scrollViewport(el: Element | null): HTMLElement | null {
  let fallback: HTMLElement | null = null;
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if (o !== 'auto' && o !== 'scroll') continue;
    if (n.scrollHeight > n.clientHeight + 1) return n;
    fallback ??= n;
  }
  return fallback;
}

/** Content-box width — `clientWidth` still carries the padding. */
function contentWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
}

/**
 * MSG-BUBBLE-12 — apply the flip's height schedule to the bubble surface.
 *
 * Spec: docs/specs/message-pipeline.md — MSG-BUBBLE-12.
 *
 * The schedule itself is pure (`flipHeight.ts`); this is the DOM half — where
 * the two heights come from, and when the spacer is released.
 *
 * WHAT MOVES IS THE SPACE, NOT THE BUBBLE (MSG-BUBBLE-12.8). The surface's own
 * height is never touched: it is always exactly its content, and it steps to
 * the new size at zero width, in the same frame the content swaps, where there
 * is nothing visible to step. This hook only says how much blank space to hold
 * above it.
 *
 * WHERE THE TARGET COMES FROM. A grow has to open its space during the FIRST
 * half (12.1), which means knowing the other face's height BEFORE the content
 * swaps. Nothing on screen can supply that, so the bubble renders a twin of
 * itself — the same rows with `showNative` inverted — hidden and out of flow.
 * `useMessageBubbleState` is a pure `useMemo` over its args, so asking it what
 * the other face would render costs a memo rather than a second source of truth
 * about what a bubble shows.
 *
 * The twin exists ONLY while a flip is in play. Rendering it always would
 * double the row subtree of every bubble in the list to serve a gesture that
 * mostly never happens.
 *
 * WHAT IS MEASURED IS THE ROW DELTA, not the twin's box (MSG-BUBBLE-12.7). The
 * twin is absolutely positioned inside the surface, so it is laid out against
 * the surface's PADDING box — wider than the real text column by the horizontal
 * padding, and its own height carries none of the vertical padding. So the twin
 * wears the surface's padding (which makes its inner column the real one) and
 * the measured node is that inner column, compared against the live one. See
 * `flipTargetHeight`.
 *
 * THE TWIN MOUNTING IS THE TURN-START SIGNAL, and that is what makes this
 * hook's structure work. Its ref callback fires after commit, with the surface
 * still showing the OLD face — so it is the one moment where BOTH heights are
 * readable, and it is a legal place to touch the DOM and call setState. Reading
 * them in an effect instead trips `react-hooks/set-state-in-effect`; reading
 * them during render trips `react-hooks/refs`. Everything the render needs
 * therefore lives in `turn` state, and the refs are touched only in callbacks.
 *
 * WHY `swapped` IS DERIVED. Progress runs 0 -> 1 on the way in and 1 -> 0 on the
 * way out, so it cannot say which half it is in. The content changing IS the
 * midpoint, so the turn records which face was showing when it started and the
 * render compares. No extra plumbing, and it is true for the arrival trigger
 * for the same reason.
 */
export function useFlipHeight(
  progress: number,
  direction: FlipDirection,
  /** Which face is currently in the flow. Flipping it IS the midpoint. */
  showingNative: boolean,
  /** MSG-BUBBLE-12.15 — set only when an ARRIVAL is driving. */
  arrival?: ArrivalTurn,
): {
  /** The other face's rows, hidden. Mounting it starts the turn. */
  twinRef: (node: HTMLElement | null) => void;
  /** True while the twin should be rendered at all. */
  measuring: boolean;
  /** px of blank space to hold. 0 = none. */
  spacerHeight: number;
  /** MSG-BUBBLE-12.9 — which side of the bubble that space goes on. */
  spacerSide: FlipSpacerSide;
  /** MSG-BUBBLE-12.15 — whether the spacer element should exist at all. */
  spacerMounted: boolean;
  /** MSG-BUBBLE-12.15 — `|toH - fromH|`, for the keyframes to read. 0 = none. */
  spacerDelta: number;
  /** MSG-BUBBLE-12.15 — the `animation` shorthand, or undefined for a step. */
  spacerAnimation: string | undefined;
} {
  const [turn, setTurn] = useState<Turn | null>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);

  // Mirror of the face on screen, for the twin's ref callback to capture. Read
  // only at twin-mount, which happens on the commit where the turn begins —
  // one commit AFTER this was last written, and the face cannot have swapped in
  // between (the swap is what ends the first half, not what starts it).
  const face = useRef(showingNative);
  useEffect(() => {
    face.current = showingNative;
  }, [showingNative]);

  const twinRef = useCallback((node: HTMLElement | null) => {
    if (!node) {
      // 12.6 — the turn is over. Dropping the pin with it is what leaves NO
      // trace on an uncommitted gesture, so the next natural reflow (a vocab
      // popover, a reaction chip, a late translation) is not fighting it.
      setTurn(null);
      return;
    }
    // WALK THE DOM FROM THE TWIN rather than holding refs to the surface and
    // the rows. Those refs were INLINE callbacks in the host, so React detached
    // (null) and re-attached them on every render — and a parent's ref attaches
    // AFTER its children's. The twin is a child of the surface, so at the very
    // moment this fires the surface ref could legitimately still be null,
    // `fromH` came out 0, and `flipTargetHeight` correctly refused the turn.
    // Chromium survived that ordering; iOS WebKit did not, which is how the
    // animation shipped measuring nothing on a real phone while 8/8 desktop
    // cases passed. The twin is physically inside the surface, so the DOM
    // answers this with no timing to get wrong — and it makes the hook's
    // contract a set of DATA ATTRIBUTES any surface can adopt, which is what
    // lets the wurld bubbles run the identical animation.
    const surfaceEl = node.closest<HTMLElement>('[data-flip-surface]');
    surfaceRef.current = surfaceEl;
    const bodyEl = surfaceEl?.querySelector<HTMLElement>('[data-flip-body]');
    const surfaceRect = surfaceEl?.getBoundingClientRect();
    const fromH = surfaceRect?.height ?? 0;
    // QUIZ-INB-5.1 — content that leaves with the turn besides the rows (the
    // in-bubble quiz, `data-flip-leaves`) counts as live body: the twin's face
    // has none of it.
    let leavesH = 0;
    surfaceEl?.querySelectorAll<HTMLElement>('[data-flip-leaves]').forEach((el) => {
      leavesH += el.getBoundingClientRect().height;
    });
    const liveBodyH = (bodyEl?.getBoundingClientRect().height ?? 0) + leavesH;

    // MSG-BUBBLE-12.10 — cap the twin at the FRAME's max-width before reading
    // it. The twin lays out `width: max-content`, so without the cap a long
    // incoming row measures on one very wide line; with the containing block's
    // width (an absolute `left:0;right:0`) it measures at the OUTGOING face's
    // width and wraps a line the real flip will never render. The two
    // constraints together are exactly what the post-flip bubble resolves.
    // Written here, one statement before the measurement that depends on it:
    // `getBoundingClientRect` forces the reflow, so the read below sees it.
    const twinFrame = node.closest<HTMLElement>('[data-flip-twin]');
    const frame = node.closest<HTMLElement>('[data-flip-frame]');
    if (twinFrame && frame?.parentElement) {
      const cap = resolveTwinMaxWidth(
        getComputedStyle(frame).maxWidth,
        contentWidth(frame.parentElement),
      );
      twinFrame.style.maxWidth = cap === null ? '' : `${cap}px`;
    }
    const twinBodyH = node.getBoundingClientRect().height;

    const toH = flipTargetHeight({ surfaceH: fromH, liveBodyH, twinBodyH });
    // TEST HOOK — `window.__measure` is only ever set by an E2E, and what it
    // records is the one number no rendered DOM exposes: what the twin
    // BELIEVED the other face's height to be. A spacer that opens to the wrong
    // size is indistinguishable from a timing fault when you can only see the
    // result, which is how an under-measure survived three rounds of frame
    // recorders.
    const probe = (window as unknown as { __measure?: unknown[] }).__measure;
    if (probe) probe.push({ fromH, liveBodyH, twinBodyH, toH });

    if (toH === null) return;

    // MSG-BUBBLE-12.9 — latched ONCE, here, for the whole turn. Re-deciding it
    // per frame lets a bubble that drifts across the viewport midpoint move its
    // spacer from one side to the other mid-gesture: a full `delta` teleport in
    // both directions at once.
    // No scroller found at all — the window IS the frame, and that is a far
    // better answer than a zero-height viewport (which would silently pick
    // `after` for every bubble on the screen).
    const viewRect = scrollViewport(surfaceEl)?.getBoundingClientRect();
    const side = flipSpacerSide({
      bubbleTop: surfaceRect?.top ?? 0,
      bubbleHeight: fromH,
      viewTop: viewRect?.top ?? 0,
      viewHeight: viewRect?.height ?? (typeof window === 'undefined' ? 0 : window.innerHeight),
    });
    setTurn({ fromH, toH, startFace: face.current, side });
  }, []);

  // MSG-BUBBLE-12.15 — an ARRIVAL's direction is MEASURED, which 12.5 always
  // said it was. `flipDirectionFor` hard-returns `grow` for one because nothing
  // has mounted the twin yet and something has to; that is fine as a TRIGGER
  // and wrong as a SCHEDULE. `delta` is an absolute value, so a shrinking
  // arrival ran the grow table and opened room it then gave back twice over —
  // the message above rising and falling inside 360ms. The gesture keeps its
  // semantic signal (12.4): it is right, and it unwinds mid-drag in a way a
  // measurement taken at turn start does not.
  const effectiveDirection: FlipDirection = arrival
    ? turn === null ? null : turn.toH > turn.fromH ? 'grow' : 'shrink'
    : direction;

  // Which half we are in. A gesture reads it off the face in the flow, because
  // the content swap IS its midpoint. An arrival never touches `showNative` —
  // what changes is `holdOriginal` — so reading the face there answers "first
  // half" for the whole turn.
  const swapped = arrival
    ? !arrival.firstHalf
    : turn !== null && showingNative !== turn.startFace;
  // MSG-BUBBLE-12.16 — an arrival's target is a PREDICTION made at turn start
  // (the twin). At the swap the new face is really on screen, so measure it
  // and correct the turn before paint: a wrong prediction would open the
  // spacer to the wrong size and then close it (QUIZ-INB-6's skip turn showed
  // 60px predicted against 102px real).
  const swappedArrival = arrival !== undefined && swapped;
  useLayoutEffect(() => {
    if (!swappedArrival || !turn || !surfaceRef.current) return;
    const actual = surfaceRef.current.getBoundingClientRect().height;
    if (Math.abs(actual - turn.toH) > 1) setTurn({ ...turn, toH: actual });
  }, [swappedArrival, turn]);
  const delta = turn === null ? 0 : Math.abs(turn.toH - turn.fromH);

  const spacerHeight =
    effectiveDirection === null || turn === null
      ? 0
      : flipSpacerHeightAt({
          progress,
          direction: effectiveDirection,
          fromH: turn.fromH,
          toH: turn.toH,
          swapped,
        });

  return {
    twinRef,
    // MSG-BUBBLE-12.15 — `direction` goes null the moment progress reaches 0,
    // which for an ARRIVAL is the SWAP: the turn used to be torn down at
    // exactly its midpoint, so a shrink's close had no element left to run on.
    // `flipEase` outliving the progress step is what holds the turn open across
    // both halves.
    measuring: direction !== null || arrival !== undefined,
    // No transition on the height itself. The spacer is driven frame-by-frame
    // off the same progress the transform uses, so anything timed on top would
    // lag the finger by its own duration — the gesture IS the easing. An
    // arrival's progress is a STEP, so what it renders is the ENDPOINT of the
    // half in flight and `spacerAnimation` covers the travel.
    spacerHeight,
    spacerSide: turn?.side ?? 'after',
    // MSG-BUBBLE-12.15 — an ARRIVAL needs the element for the WHOLE turn: an
    // element that first appears at its destination has no travel left to
    // animate, and a shrink holds zero right through its first half.
    //
    // ⚠ A GESTURE keeps the old rule — no room, no element. It has nothing to
    // prime: its spacer is a pure function of a value the finger moves every
    // frame, so it travels for free, and mounting a zero-height div for every
    // turn in the list buys that path nothing. Narrower is the right default
    // for the half of this that was never broken.
    spacerMounted: arrival !== undefined || spacerHeight > 0,
    spacerDelta: delta,
    spacerAnimation: flipSpacerAnimation({
      flipEase: arrival?.ease,
      firstHalf: arrival?.firstHalf ?? false,
      direction: effectiveDirection,
      delta,
    }),
  };
}
