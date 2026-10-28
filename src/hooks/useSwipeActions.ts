import { useCallback, useEffect, useRef, useState } from 'react';
import {
  flipCollapseAt,
  flipTurnAt,
  flipTurnSettleTarget,
  flipTurnSwapped,
} from '@/components/Message/flipHeight';

type Options = {
  /** LTR (rightward) commit handler — Reply. */
  onSwipeRight?: () => void;
  /** RTL (leftward) flip TOGGLE. MSG-BUBBLE-12.11 — fires when the turn crosses
   *  its midpoint, in EITHER direction, mid-drag; not on release. Both call
   *  sites treat the flip as a toggle, so a back-crossing undoing it is the
   *  same call. Disabled when undefined. */
  onFlipToggle?: () => void;
  /** QUIZ-INB-6 — when set, the leftward swipe does not turn the card: it fires
   *  this once when the finger passes `flipRange`, and the host runs its own motion. */
  onLeftCommit?: () => void;
  /** Distance to commit LTR swipe. Source `REPLY_THRESHOLD = 60`. */
  replyThreshold?: number;
  /** Drag distance to ZERO WIDTH — the turn's midpoint, and its commit
   *  threshold. The complete turn (out to the revealed new face) is twice
   *  this. Source `FLIP_RANGE = 60`. */
  flipRange?: number;
  /**
   * MSG-BUBBLE-12.12 — speed limit on the TURN, in turn-units per millisecond.
   * The finger sets a target; the rendered turn chases it no faster than this.
   * A flick otherwise resolves the whole animation inside one or two frames,
   * which is not an animation — it is the jump the feature exists to remove,
   * just triggered by a fast hand instead of by the swap.
   * 0.012 ≈ 165ms for a complete 0 -> 2 turn at full speed.
   */
  flipMaxTurnPerMs?: number;
  /** MSG-REPLY-5.1 — sideways travel, measured FROM THE YIELD POINT, that
   *  reclaims a gesture already yielded to vertical scroll. Deliberately larger
   *  than `commitPx`: the finger is by then in a scroll, and re-claiming on any
   *  small drift would make the list impossible to pan past a bubble. */
  rescuePx?: number;
  /** Distance (px) the finger must leave the touch deadzone before the gesture
   *  COMMITS to an axis (MSG-REPLY-5). Default 10px — WhatsApp-style early
   *  commit: as soon as `max(absDx, absDy)` crosses this, the gesture locks
   *  horizontal (reply/flip) or yields to vertical scroll, and the decision is
   *  FINAL (no later re-evaluation, so a mid-swipe vertical wiggle can't cancel
   *  a committed horizontal swipe). */
  commitPx?: number;
  /** Axis-lock cone, expressed as `tan(θ)` from the HORIZONTAL axis. Horizontal
   *  commits when `absDy <= absDx * axisRatio`; otherwise the gesture yields to
   *  scroll. Default `1 = 45°` (matches WhatsApp — a clean diagonal boundary,
   *  decided early). Higher widens the horizontal cone toward vertical. */
  axisRatio?: number;
  /** Cap on rightward translation. Source clamps to 80px. */
  maxTranslate?: number;
  /** External gate for RTL. When false, leftward drag is ignored (the source
   *  fails the gesture when `viewMode === 'visible'`). */
  enableLeft?: boolean;
  /** External gate for LTR (reply). When false, rightward drag is ignored
   *  entirely — no translate, no reply commit. Used to make broadcast
   *  messages non-repliable (the bubble doesn't even slide). */
  enableRight?: boolean;
};

type Handlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
};

type SwipeState = {
  /** Current LTR translate offset in px (0 when not dragging or RTL). */
  dragX: number;
  /** RTL collapse 0..1 (scaleX = 1 - flipProgress). Rises to 1 at the turn's
   *  midpoint and falls back to 0 as the new face comes out. */
  flipProgress: number;
  /** MSG-BUBBLE-12.11 — the turn is past its midpoint, so the face on screen is
   *  the one it turned TO. Consumers latch the flip DIRECTION off this; without
   *  it a live-swapped face reads as a shrink halfway through a grow. */
  flipPast: boolean;
  /** True while a horizontal gesture is active. */
  active: boolean;
};

/**
 * Two-direction swipe detector (MSG-REPLY-5):
 *   - rightward drag → translateX (cap 80px), fire Reply on release past 60px
 *   - leftward  drag → a full flip TURN over 120px: squashed to zero width at
 *     60px (where the face swaps, live), back out to full width at 120px. The
 *     midpoint is both the swap point and the commit threshold, and a release
 *     runs the turn out to whichever end it is nearer (MSG-BUBBLE-12.11). Only
 *     enabled when `enableLeft` — gates on `viewMode === 'hidden'`.
 *
 * Axis arbitration is **WhatsApp-style**: a single EARLY, FINAL commit. The
 * gesture stays dormant inside a small touch deadzone (`commitPx`, 10px); the
 * instant the finger crosses it, the dominant axis (45° cone, `axisRatio`)
 * decides once — horizontal locks the swipe and follows the finger for the rest
 * of the gesture (no re-evaluation, so a mid-swipe vertical wiggle can't cancel
 * it), vertical yields to native list scroll. This replaced an earlier
 * late-commit (24px) + cancelable-"engaged" design that felt like a coin-flip
 * on the diagonal.
 *
 * No visual affordance icon is exposed — the bubble's own translate / collapse
 * IS the affordance. Consumers wire dragX → translateX(), flipProgress → scaleX().
 */
export function useSwipeActions(options: Options): {
  handlers: Handlers;
  state: SwipeState;
} {
  const {
    onSwipeRight,
    onFlipToggle,
    onLeftCommit,
    replyThreshold = 60,
    flipRange = 60,
    flipMaxTurnPerMs = 0.012,
    commitPx = 10,
    rescuePx = 24,
    axisRatio = 1, // tan(45°): horizontal wins up to 45° off the X axis.
    maxTranslate = 80,
    enableLeft = true,
    enableRight = true,
  } = options;

  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  // MSG-REPLY-5.1 — where the gesture yielded to vertical scroll, if it did.
  // Kept rather than discarded so an obvious sideways move can still reclaim it.
  const yieldAt = useRef<{ x: number; y: number } | null>(null);
  const lockedDir = useRef<1 | 2 | null>(null); // 1 = LTR (reply), 2 = RTL (flip)
  const [dragX, setDragX] = useState(0);
  // MSG-BUBBLE-12.11 — the WHOLE turn, 0 -> 1 -> 2. The collapse the transform
  // uses is derived (`flipCollapseAt`), never stored, so the two cannot drift.
  const [flipTurn, setFlipTurn] = useState(0);
  const [active, setActive] = useState(false);
  // Which side of the midpoint the turn was on last frame. The face swap is the
  // CROSSING, so it needs an edge, not a level.
  const pastMidpoint = useRef(false);
  // Mirror of `flipTurn` for the callbacks that must read it without taking it
  // as a dependency — re-creating the pointer handlers every frame of a drag
  // would detach and re-attach the non-passive touchmove blocker mid-gesture.
  const flipTurnRef = useRef(0);
  const onFlipToggleRef = useRef(onFlipToggle);
  useEffect(() => { onFlipToggleRef.current = onFlipToggle; }, [onFlipToggle]);
  // QUIZ-INB-6 — with `onLeftCommit`, the leftward swipe never turns the card:
  // it fires once past the midpoint distance and the host runs its own motion.
  const onLeftCommitRef = useRef(onLeftCommit);
  useEffect(() => { onLeftCommitRef.current = onLeftCommit; }, [onLeftCommit]);
  const leftCommitted = useRef(false);
  // Latched when the leftward axis locks: a skip ends the quiz mid-gesture, and
  // the rest of THIS gesture must not become an ordinary flip (it would toggle
  // the face the release is about to land on).
  const leftCommitMode = useRef(false);
  const writeTurn = useCallback((v: number) => {
    flipTurnRef.current = v;
    setFlipTurn(v);
    // MSG-BUBBLE-12.11 — the face swaps on the RENDERED turn, not the finger's.
    // With 12.12's speed limit the two diverge on a flick, and swapping on the
    // finger would change the content while the card is still visibly wide.
    const past = flipTurnSwapped(v);
    if (past !== pastMidpoint.current) {
      pastMidpoint.current = past;
      onFlipToggleRef.current?.();
    }
  }, []);
  // Guards the gesture-end so it runs EXACTLY ONCE whether the element handler
  // or the window fallback (below) fires first. Cleared on pointerdown.
  const ended = useRef(false);

  // MSG-REPLY-5 — native-scroll lock. `touch-action: pan-y` lets the browser
  // keep scrolling vertically even after we've committed a horizontal swipe;
  // a downward finger move then starts a native scroll and fires
  // `pointercancel`, which kills the in-flight swipe. Pointer capture doesn't
  // stop that — only `preventDefault` on a NON-PASSIVE `touchmove` does. So we
  // attach one for the gesture's lifetime and preventDefault once committed
  // (`lockedDir !== null`), disabling Y-scroll the instant the bubble moves
  // sideways. Before commit it's a no-op, so a genuine vertical scroll still
  // pans the list.
  const blockerEl = useRef<Element | null>(null);
  const blockScrollWhenLocked = useCallback((e: TouchEvent) => {
    if (lockedDir.current !== null && e.cancelable) e.preventDefault();
  }, []);
  const detachBlocker = useCallback(() => {
    const el = blockerEl.current;
    if (el && typeof el.removeEventListener === 'function') {
      el.removeEventListener('touchmove', blockScrollWhenLocked as EventListener);
    }
    blockerEl.current = null;
  }, [blockScrollWhenLocked]);

  // MSG-BUBBLE-12.11/12.12 — the TURN DRIVER. One rAF loop owns the rendered
  // turn for the whole gesture: during the drag it chases the finger, and on
  // release it chases whichever end the finger was nearer. It is the only
  // timeline in the flip, and it moves the turn INPUT rather than the schedule,
  // so 12.3 (height is a pure function of the turn) still holds.
  //
  // Chasing rather than following is what makes a flick smooth: the finger can
  // cross 120px in two frames, and without a speed limit the card would too.
  //
  // A PURE CAP, deliberately, not a damper. Exponential smoothing was tried
  // first and leaves a steady-state lag proportional to finger speed — measured
  // at 0.2 of a turn on an ordinary slow drag, which reads as the card trailing
  // the finger. A cap is invisible below the limit (a slow drag tracks exactly)
  // and only binds on the flick it exists for.
  const targetTurn = useRef(0);
  const driveRaf = useRef(0);
  const lastFrameMs = useRef(0);

  /** Back to rest, WITHOUT firing the toggle. The collapse is 0 at both ends of
   *  a turn (`flipCollapseAt(2) === flipCollapseAt(0)`), so landing a completed
   *  turn on 0 is visually identical to landing it on 2 and leaves the hook
   *  clean for the next gesture (12.6). Going through `writeTurn` instead would
   *  read that 2 -> 0 as a midpoint crossing and flip the card straight back. */
  const landAtRest = useCallback(() => {
    driveRaf.current = 0;
    pastMidpoint.current = false;
    targetTurn.current = 0;
    flipTurnRef.current = 0;
    setFlipTurn(0);
  }, []);

  const stopDriver = useCallback(() => {
    if (driveRaf.current && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(driveRaf.current);
    }
    driveRaf.current = 0;
  }, []);

  const startDriver = useCallback(() => {
    if (driveRaf.current || typeof requestAnimationFrame !== 'function') return;
    lastFrameMs.current = performance.now();
    const step = () => {
      const now = performance.now();
      const dt = Math.min(64, now - lastFrameMs.current);
      lastFrameMs.current = now;
      const from = flipTurnRef.current;
      const remaining = targetTurn.current - from;
      // Close enough to be a sub-pixel difference on any real bubble — land it
      // and stop, so an idle finger does not hold a rAF loop open.
      if (Math.abs(remaining) < 0.002) {
        // A COMPLETED turn recycles to rest only once the gesture is over.
        // Doing it while the finger is still down re-arms the whole turn: the
        // target is still 2, so the next pointermove aims at it again from 0
        // and the card flips over and over for as long as the finger is held.
        // Held past the end it simply STAYS revealed, which is also what it
        // looks like it should do.
        if (targetTurn.current >= 2 && lockedDir.current === null) landAtRest();
        else { driveRaf.current = 0; writeTurn(targetTurn.current); }
        return;
      }
      const cap = flipMaxTurnPerMs * dt;
      const raw = from + Math.max(-cap, Math.min(cap, remaining));
      // NEVER STEP OVER THE MIDPOINT. Land on it exactly, cross on the next
      // frame. The spacer is a function of the turn, so a frame that jumps from
      // 0.8 to 1.2 renders the spacer at 0.8 of its delta and then hands over to
      // a bubble that is the full delta taller — the remainder is a visible jump
      // at the swap, and it scales with how fast the finger is moving.
      const next = (from < 1 && raw > 1) || (from > 1 && raw < 1) ? 1 : raw;
      writeTurn(next);
      driveRaf.current = requestAnimationFrame(step);
    };
    driveRaf.current = requestAnimationFrame(step);
  }, [flipMaxTurnPerMs, landAtRest, writeTurn]);

  /** Point the driver at a new turn value. Without rAF (jsdom in some
   *  configurations) this degrades to following the finger exactly, which is
   *  the pre-12.12 behaviour rather than a broken one. */
  const aimTurn = useCallback(
    (next: number) => {
      targetTurn.current = next;
      if (typeof requestAnimationFrame !== 'function') writeTurn(next);
      else startDriver();
    },
    [startDriver, writeTurn],
  );

  const reset = useCallback(() => {
    detachBlocker();
    start.current = null;
    lockedDir.current = null;
    yieldAt.current = null;
    setDragX(0);
    setActive(false);
  }, [detachBlocker]);

  // End the gesture EXACTLY ONCE (idempotent via `ended`). `commit` fires the
  // swipe action iff the release passed the threshold. Called by BOTH the
  // element's onPointerUp/Cancel AND the window fallback — whichever lands
  // first wins, so a pointerup that never reaches the (now 0-width, collapsed)
  // bubble because pointer-capture silently failed can no longer strand the
  // bubble at scaleX 0 forever (the reported "flip stuck invisible" bug).
  const finishGesture = useCallback(
    (e: { pointerId: number; clientX: number } | null, commit: boolean) => {
      if (ended.current) return;
      ended.current = true;
      const s = start.current;
      const dir = lockedDir.current;
      if (commit && e && s && e.pointerId === s.pointerId && dir === 1) {
        if (e.clientX - s.x >= replyThreshold) onSwipeRight?.();
      }
      // MSG-BUBBLE-12.11 — nothing to commit on the leftward path: the face
      // already swapped at the midpoint crossing, in whichever direction the
      // finger last crossed it. All that is left is to run the turn out to its
      // nearer end. A release commit ON TOP of the crossing would flip the card
      // straight back.
      // MSG-BUBBLE-12.11 — nothing to commit on the leftward path: the face
      // swaps at the midpoint crossing, in whichever direction the turn last
      // crossed it. All that is left is to run out to the nearer end. Aimed
      // from the FINGER's turn, not the rendered one: under 12.12's speed limit
      // a flick releases with the card still catching up, and where the user
      // dragged to is what they meant.
      if (dir === 2 && !leftCommitMode.current) aimTurn(flipTurnSettleTarget(targetTurn.current));
      reset();
    },
    [aimTurn, onSwipeRight, replyThreshold, reset],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // Grabbing a card mid-settle completes the settle instantly rather than
      // resuming from a partial turn: the drag maps ABSOLUTE finger travel onto
      // the turn, so a non-zero start would offset every frame after it. The
      // jump is invisible — the collapse is 0 at both ends of a settle.
      // Grabbing a card mid-settle completes it instantly rather than resuming
      // from a partial turn: the drag maps ABSOLUTE finger travel onto the
      // turn, so a non-zero start would offset every frame after it. Invisible
      // — the collapse is 0 at both ends of a settle.
      stopDriver();
      landAtRest();
      ended.current = false;
      leftCommitted.current = false;
      start.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      lockedDir.current = null;
      yieldAt.current = null;
      // (Re)attach the non-passive scroll blocker to THIS gesture's element.
      detachBlocker();
      const el = e.currentTarget as Element;
      blockerEl.current = el;
      if (typeof el.addEventListener === 'function') {
        el.addEventListener('touchmove', blockScrollWhenLocked as EventListener, {
          passive: false,
        });
      }
    },
    [blockScrollWhenLocked, detachBlocker, landAtRest, stopDriver],
  );

  // Detach on unmount so a gesture interrupted by an unmount can't leak the
  // listener (the element ref would otherwise pin it).
  useEffect(() => () => { detachBlocker(); stopDriver(); }, [detachBlocker, stopDriver]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const s = start.current;
      if (!s || e.pointerId !== s.pointerId) return;
      let dx = e.clientX - s.x;
      const absDy0 = Math.abs(e.clientY - s.y);

      if (lockedDir.current === null) {
        const yp = yieldAt.current;
        if (yp) {
          // MSG-REPLY-5.1 — already yielded to vertical. The yield is
          // PROVISIONAL: a finger that drifts a few px down before going
          // sideways meant the swipe, and killing the whole touch for that was
          // the reported annoyance. Measured from the YIELD POINT, not the
          // original touch, so the drift itself never counts as swipe travel.
          const rx = e.clientX - yp.x;
          const ry = e.clientY - yp.y;
          if (Math.abs(rx) < rescuePx) return;
          if (Math.abs(ry) > Math.abs(rx) * axisRatio) return;
          // Re-baseline AT the yield point, so the rescue travel is the turn's
          // first travel and the card picks the finger up where it changed its
          // mind. 12.12's speed cap absorbs the resulting step-in.
          start.current = { x: yp.x, y: yp.y, pointerId: s.pointerId };
          yieldAt.current = null;
          dx = e.clientX - yp.x;
        } else {
          // MSG-REPLY-5 — WhatsApp-style early axis commit. Stay dormant inside
          // the touch deadzone; the instant the finger crosses `commitPx` on
          // either axis, decide.
          if (Math.abs(dx) < commitPx && absDy0 < commitPx) return;

          // Vertical-dominant (steeper than the 45° cone) → yield to the list
          // scroll. `touch-action: pan-y` means the browser usually claims a
          // clear vertical first (pointercancel), so this is mostly the
          // backstop for the ambiguous diagonal.
          if (absDy0 > Math.abs(dx) * axisRatio) {
            yieldAt.current = { x: e.clientX, y: e.clientY };
            return;
          }
        }

        // Horizontal-dominant → COMMIT now (early). From here the gesture
        // follows the finger and the axis is never re-evaluated, so a vertical
        // wiggle can't cancel it. That finality is one-way by design: a commit
        // has visible state (the card is turning) and abandoning it would be
        // jarring, while a yield has none and costs nothing to reclaim.
        const dir: 1 | 2 = dx > 0 ? 1 : 2;
        if (dir === 2 && !enableLeft) {
          start.current = null;
          return;
        }
        if (dir === 1 && !enableRight) {
          start.current = null;
          return;
        }
        lockedDir.current = dir;
        leftCommitMode.current = dir === 2 && !!onLeftCommitRef.current;
        setActive(true);
        // Capture the pointer now that the gesture has committed — so plain
        // taps (no movement past the deadzone) don't get hijacked from child
        // controls. The capture is needed for the leftward flip: when the
        // bubble's scaleX collapses to ~0, on web the pointer leaves the bubble
        // and subsequent move/up events would otherwise stop routing here.
        if (typeof (e.currentTarget as Element).setPointerCapture === 'function') {
          try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch {/* ignore */}
        }
      }

      if (lockedDir.current === 1) {
        setDragX(Math.max(0, Math.min(dx, maxTranslate)));
      } else if (lockedDir.current === 2 && leftCommitMode.current) {
        if (!leftCommitted.current && -dx >= flipRange) {
          leftCommitted.current = true;
          onLeftCommitRef.current?.();
        }
      } else if (lockedDir.current === 2) {
        // MSG-BUBBLE-12.12 — AIM, don't write. The finger sets a target and the
        // driver chases it at a capped rate; writing it straight through is
        // what made a flick resolve the whole turn inside one frame.
        aimTurn(flipTurnAt(Math.max(0, -dx), flipRange));
      }
    },
    [aimTurn, axisRatio, commitPx, enableLeft, enableRight, flipRange, maxTranslate, rescuePx],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => finishGesture(e, true),
    [finishGesture],
  );
  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => finishGesture(e, false),
    [finishGesture],
  );

  // Window-level fallback: once a horizontal gesture has committed (`active`),
  // the bubble may collapse to 0 width and lose the pointer, so the up/cancel
  // can fire on a DIFFERENT element and never reach our React handlers. A
  // window listener guarantees the gesture always ends (and commits if past the
  // threshold) — `finishGesture`'s `ended` guard dedupes against the element
  // handler when capture DID hold.
  useEffect(() => {
    if (!active || typeof window === 'undefined') return;
    const onUp = (e: PointerEvent) => finishGesture(e, true);
    const onCancel = (e: PointerEvent) => finishGesture(e, false);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [active, finishGesture]);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
    state: {
      dragX,
      flipProgress: flipCollapseAt(flipTurn),
      flipPast: flipTurnSwapped(flipTurn),
      active,
    },
  };
}
