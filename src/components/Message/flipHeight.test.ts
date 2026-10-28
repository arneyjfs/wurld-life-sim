import { describe, expect, it } from 'vitest';
import { FLIP_HALF_MS, FLIP_SPACE_MS } from './bubbleMotion';
import {
  FLIP_SPACE_CLOSE,
  FLIP_SPACE_OPEN,
  flipMotion,
  flipSpacerAnimation,
  flipSpacerHeightAt,
  flipTargetHeight,
  flipCollapseAt,
  flipSpacerSide,
  flipTurnAt,
  flipTurnSettleTarget,
  flipTransformOrigin,
  flipTurnSwapped,
  gestureFlipDirection,
  resolveTwinMaxWidth,
  type FlipHeightInput,
} from './flipHeight';

/** A grow: 40 -> 80, so 40px of room to make. */
const at = (over: Partial<FlipHeightInput>) =>
  flipSpacerHeightAt({
    progress: 0, direction: 'grow', fromH: 40, toH: 80, swapped: false, ...over,
  });

/** What the surrounding scroll actually sees: spacer + the bubble's own box. */
const total = (over: Partial<FlipHeightInput> & { bubbleH: number }) =>
  at(over) + over.bubbleH;

describe('MSG-BUBBLE-12 — the flip makes room for itself', () => {
  describe('12.1 — a GROW opens its space during the FIRST half', () => {
    it('starts opening from the very first pixel of the drag', () => {
      // The whole point: without this the surrounding scroll learns about a
      // two-row bubble in the one frame it becomes one, and redistributes the
      // difference in a single jump.
      expect(at({ progress: 0 })).toBe(0);
      expect(at({ progress: 0.25 })).toBe(10);
      expect(at({ progress: 0.5 })).toBe(20);
    });

    it('has ALL the room by zero width, before the new face appears', () => {
      expect(at({ progress: 1 })).toBe(40);
    });

    it('hands the room to the bubble at the swap and keeps none of it', () => {
      // The bubble is now the taller box itself, so a surviving spacer would
      // double-count the room and leave a permanent gap.
      for (const progress of [1, 0.6, 0.2, 0]) {
        expect(at({ progress, swapped: true })).toBe(0);
      }
    });
  });

  describe('12.2 — a SHRINK holds until the swap, then closes over the SECOND half', () => {
    const shrink = (over: Partial<FlipHeightInput>) =>
      at({ direction: 'shrink', fromH: 80, toH: 40, ...over });

    it('takes no room back while the old, taller face is still on screen', () => {
      // Closing early would pull the messages above down onto a bubble that is
      // still the tall one.
      expect(shrink({ progress: 0 })).toBe(0);
      expect(shrink({ progress: 0.5 })).toBe(0);
      expect(shrink({ progress: 1 })).toBe(0);
    });

    it('holds the vacated space at the swap, then gives it back', () => {
      // Progress runs 1 -> 0 on the way out, so the gap closes as the new face
      // comes out of the centre — both moving at once, which is the ask.
      expect(shrink({ progress: 1, swapped: true })).toBe(40);
      expect(shrink({ progress: 0.5, swapped: true })).toBe(20);
      expect(shrink({ progress: 0, swapped: true })).toBe(0);
    });
  });

  describe('12.8 — the total is CONTINUOUS across the swap', () => {
    // The bubble's own box steps 40 -> 80 at the swap. That step is invisible
    // (zero width), but it must be exactly cancelled by the spacer or the jolt
    // this whole feature removes simply moves to the midpoint.
    it('a grow hands over with no step', () => {
      const before = total({ progress: 1, swapped: false, bubbleH: 40 });
      const after = total({ progress: 1, swapped: true, bubbleH: 80 });
      expect(before).toBe(80);
      expect(after).toBe(80);
    });

    it('a shrink hands over with no step', () => {
      const s = { direction: 'shrink' as const, fromH: 80, toH: 40, progress: 1 };
      expect(total({ ...s, swapped: false, bubbleH: 80 })).toBe(80);
      expect(total({ ...s, swapped: true, bubbleH: 40 })).toBe(80);
    });

    it('and each direction ends on the height the content takes', () => {
      expect(total({ progress: 0, swapped: true, bubbleH: 80 })).toBe(80);
      expect(total({
        direction: 'shrink', fromH: 80, toH: 40, progress: 0, swapped: true, bubbleH: 40,
      })).toBe(40);
    });
  });

  describe('12.3 / 12.6 — pure function of progress, so a reversal unwinds', () => {
    it('an uncommitted drag that comes back leaves NO space behind', () => {
      // Drag out to 0.5, think better of it, release below threshold.
      expect(at({ progress: 0.5 })).toBe(20);
      expect(at({ progress: 0 })).toBe(0);
    });

    it('is order-independent — the same progress always gives the same gap', () => {
      const seq = [0, 0.3, 0.8, 0.2, 0.8, 0];
      expect(seq.map((progress) => at({ progress }))).toEqual([0, 12, 32, 8, 32, 0]);
    });

    it('clamps rather than extrapolating past either end', () => {
      // An over-drag must not open more room than the content will take.
      expect(at({ progress: 1.4 })).toBe(40);
      expect(at({ progress: -0.3 })).toBe(0);
    });
  });

  describe('opting OUT — a spacer that outlives its animation is a stray gap', () => {
    it('holds no space before a direction is known', () => {
      expect(at({ direction: null, progress: 1 })).toBe(0);
    });

    it('holds no space before the target has been measured', () => {
      expect(at({ toH: null, progress: 1 })).toBe(0);
    });

    it('holds no space when the two faces are the same box', () => {
      // Sub-pixel difference: there is no room to make.
      expect(at({ fromH: 60, toH: 60.4, progress: 1 })).toBe(0);
      expect(at({ fromH: 60, toH: 60.4, progress: 1, swapped: true })).toBe(0);
    });

    it('holds no space on a nonsense measurement', () => {
      // A zero height means the node was not laid out yet.
      expect(at({ fromH: 0, progress: 1 })).toBe(0);
      expect(at({ toH: 0, progress: 1 })).toBe(0);
    });
  });

  describe('12.4 — direction from the semantics, not a measurement', () => {
    it('turning a bubble ON is a grow, turning it OFF is a shrink', () => {
      // MSG-VIEW-3: the flip can only ADD the native row.
      expect(gestureFlipDirection(false)).toBe('grow');
      expect(gestureFlipDirection(true)).toBe('shrink');
    });
  });

  describe('12.15 — the ARRIVAL\'s space travels in the half its direction names', () => {
    // Owner, 2026-09-22: *"the flip animates smoothly, but the height change
    // creating or consuming the space the bubble need happens immediately (no
    // animation)"*. An arrival's progress is a STEP, so the rendered spacer
    // height is only ever the ENDPOINT of the current half; this is what covers
    // the travel between two of them.
    const anim = (over: Partial<Parameters<typeof flipSpacerAnimation>[0]> = {}) =>
      flipSpacerAnimation({
        flipEase: 'linear', firstHalf: true, direction: 'grow', delta: 40, ...over,
      });

    it('12.1 — a GROW opens over the FIRST half', () => {
      expect(anim()).toBe(`${FLIP_SPACE_OPEN} ${FLIP_SPACE_MS}ms linear`);
    });

    it('12.1 — ...and steps to nothing at the swap, with NO animation on it', () => {
      // ⚠ The one thing that must NOT be eased. The bubble's own box takes the
      // room in the same frame the spacer gives it up (12.8's hand-off table),
      // so animating the release would double-count it for 180ms — which is the
      // overshoot the space-opening fix exists to remove.
      expect(anim({ firstHalf: false, flipEase: 'ease-out' })).toBeUndefined();
    });

    it('12.2 — a SHRINK holds through the first half with nothing to run', () => {
      // The old, taller face is still on screen. Closing early pulls the
      // messages above down onto a bubble that has not shrunk yet.
      expect(anim({ direction: 'shrink' })).toBeUndefined();
    });

    it('12.2 — ...and closes over the SECOND half, after the bubble lets go', () => {
      expect(anim({ direction: 'shrink', firstHalf: false, flipEase: 'ease-out' }))
        .toBe(`${FLIP_SPACE_CLOSE} ${FLIP_SPACE_MS}ms ease-out`);
    });

    it('12.8 — a GESTURE gets none of this: the finger IS the easing', () => {
      // A transition or animation on top of a finger-driven value lags the
      // finger by its own duration. `flipEase` undefined IS "no arrival".
      expect(anim({ flipEase: undefined })).toBeUndefined();
      expect(anim({ flipEase: undefined, direction: 'shrink', firstHalf: false }))
        .toBeUndefined();
    });

    it('12.1 — the travel finishes BEFORE the half it lives in', () => {
      // ⚠ Not a tuning preference — a race. The swap is a `setTimeout` started
      // when the turn begins; the animation starts at the first style
      // resolution after the commit that attaches it, and that commit is the
      // expensive one (layout effect, measurement twin, forced reflow). On the
      // emulator harness the gap cost ~30ms of a 180ms half, so the spacer
      // reached 30px of a 36px delta and the bubble took the last 6px in one
      // frame. Ending early is what 12.1 asks for anyway: ALL the room BY zero
      // width, not exactly AT it.
      expect(FLIP_SPACE_MS).toBeLessThan(FLIP_HALF_MS);
      expect(FLIP_HALF_MS - FLIP_SPACE_MS,
        'less than two frames of slack — the measured lag was already ~30ms')
        .toBeGreaterThanOrEqual(40);
    });

    it('opts out on the same terms the height schedule does', () => {
      // Sub-pixel: the two faces are one box, there is no travel to cover, and
      // an animation from 0 to 0 is a stray 180ms of nothing.
      expect(anim({ delta: 0.4 })).toBeUndefined();
      expect(anim({ direction: null })).toBeUndefined();
    });
  });
  describe('12.7 — the target is a DELTA on the live box, not the twin\'s own box', () => {
    // Real numbers, measured in Chromium: a bubble with px-3 py-2 around a
    // single 20px row. The twin is absolutely positioned inside the surface, so
    // it spans the PADDING box — 24px wider — and its own height carries none of
    // the 16px of vertical padding.
    const target = (over: Partial<Parameters<typeof flipTargetHeight>[0]> = {}) =>
      flipTargetHeight({ surfaceH: 36, liveBodyH: 20, twinBodyH: 40, ...over });

    it('adds the ROW delta to the live box rather than returning the twin', () => {
      // The bug that shipped: 40 was used as the target, so the box animated
      // 36 -> 40 and then jumped the remaining 16px when the content swapped.
      expect(target()).toBe(56);
    });

    it('a shrink comes back by exactly the same delta', () => {
      // 12.2's second half has to land on the box the content actually takes,
      // or the jolt just moves to the end of the gesture.
      expect(target({ surfaceH: 56, liveBodyH: 40, twinBodyH: 20 })).toBe(36);
    });

    it('a grow and its reverse are exact inverses', () => {
      const grown = target({ surfaceH: 36, liveBodyH: 20, twinBodyH: 40 });
      expect(grown).toBe(56);
      expect(target({ surfaceH: grown!, liveBodyH: 40, twinBodyH: 20 })).toBe(36);
    });

    it('is unaffected by anything the two faces SHARE', () => {
      // A reply preview or an image sits in the surface but not in either body,
      // so it cancels — the delta form is what makes that true for free.
      expect(target({ surfaceH: 236 })).toBe(256);
    });

    it('refuses a measurement taken before layout', () => {
      // A zero here means the node was not laid out yet; deriving a target from
      // it would pin the bubble to a size its content never takes.
      expect(target({ surfaceH: 0 })).toBeNull();
      expect(target({ liveBodyH: 0 })).toBeNull();
      expect(target({ twinBodyH: 0 })).toBeNull();
    });

    it('refuses a target the box could never take', () => {
      // Degenerate: rows measured taller than the surface holding them, which
      // drives the delta past zero. Pinning to a negative height would collapse
      // the bubble outright, so the schedule declines the turn instead.
      expect(target({ surfaceH: 36, liveBodyH: 40, twinBodyH: 1 })).toBeNull();
    });
  });

  describe('flipMotion — one progress value drives both', () => {
    const gesture = (over = {}) => ({ dragX: 0, flipProgress: 0, active: false, ...over });

    it('is inert at rest — no transform, no direction, no pin', () => {
      const m = flipMotion(gesture(), 0, false);
      expect(m.progress).toBe(0);
      expect(m.transform).toBeUndefined();
      expect(m.direction).toBeNull();
    });

    it('keeps a transform while a finger is DOWN but not yet moved', () => {
      // Without this the bubble would pop between transformed and untransformed
      // at the top of every gesture.
      const m = flipMotion(gesture({ active: true }), 0, false);
      expect(m.transform).toBe('translateX(0px) scaleX(1)');
      expect(m.direction).toBe('grow');
    });

    it('the transform and the direction read the SAME progress', () => {
      // They are returned together precisely so they cannot disagree.
      const m = flipMotion(gesture({ flipProgress: 0.5, active: true, dragX: -30 }), 0, true);
      expect(m.progress).toBe(0.5);
      expect(m.transform).toBe('translateX(-30px) scaleX(0.5)');
      expect(m.direction).toBe('shrink');
    });

    it('whichever trigger is turning the card wins', () => {
      // MSG-BUBBLE-10: the finger and the arrival share one value.
      expect(flipMotion(gesture({ flipProgress: 0.2 }), 0.9, false).progress).toBe(0.9);
      expect(flipMotion(gesture({ flipProgress: 0.9 }), 0.2, false).progress).toBe(0.9);
    });

    it('MSG-BUBBLE-12.5 — an ARRIVAL turn still gets a direction', () => {
      // It has no semantic hint, so it takes grow and lets the measured target
      // decide how far. A null here would mean no height animation at all on
      // the programmatic path — the case this invariant exists for.
      const m = flipMotion(gesture(), 0.4, true);
      expect(m.direction).toBe('grow');
      expect(m.transform).toBe('translateX(0px) scaleX(0.6)');
    });

    it('an arrival on a bubble showing native does NOT read as a shrink', () => {
      // The semantic rule is about the GESTURE. Applying it to an arrival would
      // hold the box through the first half of a turn that may be growing.
      expect(flipMotion(gesture(), 0.4, true).direction).toBe('grow');
    });
  });
});

describe('MSG-BUBBLE-12.9 — the space opens on the side the scroller is not anchored to', () => {
  /** A 800px-tall scroll viewport starting at y=100. Midpoint is y=500. */
  const side = (bubbleTop: number, bubbleHeight = 40) =>
    flipSpacerSide({ bubbleTop, bubbleHeight, viewTop: 100, viewHeight: 800 });

  it('puts the space BEFORE a bubble in the lower half', () => {
    // Near the bottom the scroller is bottom-pinned (SCROLL-INV-1): inserted
    // height is absorbed by scrollTop, so everything ABOVE the insertion point
    // moves up and everything below holds. The bubble must be in the part that
    // holds — which means the spacer goes above it.
    expect(side(700)).toBe('before');
    expect(side(880)).toBe('before');
  });

  it('puts the space AFTER a bubble in the upper half', () => {
    // Nothing is pinned up here, so inserted height pushes everything after it
    // down. The bubble holds only if the spacer follows it.
    expect(side(120)).toBe('after');
    expect(side(300)).toBe('after');
  });

  it('decides on the bubble CENTRE, not its top edge', () => {
    // A tall bubble straddling the midpoint belongs to the half its mass is in.
    // Judging by the top edge alone flips the answer for exactly the bubbles
    // where the spacer is largest.
    expect(side(420, 200)).toBe('before'); // centre 520 — below the 500 midpoint
    expect(side(380, 200)).toBe('after'); //  centre 480 — above it
  });

  it('falls back to AFTER when the viewport is degenerate', () => {
    // No scroller found / not laid out yet. `after` is the placement that is
    // correct at the top of a list, which is where a not-yet-scrolled chat is.
    expect(flipSpacerSide({ bubbleTop: 0, bubbleHeight: 40, viewTop: 0, viewHeight: 0 }))
      .toBe('after');
  });
});

describe('MSG-BUBBLE-12.10 — the twin is measured at the width the other face will take', () => {
  it('resolves a percentage cap against the frame container', () => {
    // `max-w-[80%]` — the frame's cap is 80% of the row it sits in, and that is
    // the width the post-flip bubble is allowed to reach.
    expect(resolveTwinMaxWidth('80%', 500)).toBe(400);
  });

  it('resolves a px cap verbatim', () => {
    expect(resolveTwinMaxWidth('320px', 500)).toBe(320);
  });

  it('returns null for `none`, so the caller leaves the twin uncapped', () => {
    // An uncapped twin still wraps at max-content, which is the right answer
    // when there genuinely is no cap. Inventing one would be worse than none.
    expect(resolveTwinMaxWidth('none', 500)).toBeNull();
    expect(resolveTwinMaxWidth('', 500)).toBeNull();
  });

  it('refuses a cap it cannot turn into a positive width', () => {
    // A zero-width container means the row is not laid out yet; capping the
    // twin at 0 would wrap every word onto its own line and report a target
    // several times the real one.
    expect(resolveTwinMaxWidth('80%', 0)).toBeNull();
    expect(resolveTwinMaxWidth('0px', 500)).toBeNull();
    expect(resolveTwinMaxWidth('auto', 500)).toBeNull();
  });
});

describe('MSG-BUBBLE-12.11 — the finger drives the whole turn', () => {
  /** 60px to zero width, so 120px for the complete turn. */
  const turn = (leftDx: number) => flipTurnAt(leftDx, 60);

  it('runs 0 -> 1 -> 2 across twice the collapse range', () => {
    expect(turn(0)).toBe(0);
    expect(turn(30)).toBe(0.5);
    expect(turn(60)).toBe(1); // zero width — the swap
    expect(turn(90)).toBe(1.5);
    expect(turn(120)).toBe(2); // new face, full width
  });

  it('clamps past the end rather than turning the card twice', () => {
    expect(turn(400)).toBe(2);
    expect(turn(-40)).toBe(0);
  });

  it('collapses to zero width at the midpoint and back out again', () => {
    // This is the bug: `min(1, dx/range)` pins the collapse at 1 for every
    // pixel past 60, so the second half of the animation cannot be dragged.
    expect(flipCollapseAt(0)).toBe(0);
    expect(flipCollapseAt(0.5)).toBe(0.5);
    expect(flipCollapseAt(1)).toBe(1);
    expect(flipCollapseAt(1.5)).toBe(0.5);
    expect(flipCollapseAt(2)).toBe(0);
  });

  it('settles to whichever end the turn is nearer', () => {
    // The midpoint is BOTH the swap point and the commit threshold — one
    // number, so they cannot disagree.
    expect(flipTurnSettleTarget(0.99)).toBe(0);
    expect(flipTurnSettleTarget(1)).toBe(2);
    expect(flipTurnSettleTarget(1.01)).toBe(2);
  });

  it('reports the face swapped for the whole second half, but NOT at zero width', () => {
    // Strictly past 1. "The content swaps at zero width" needs a frame AT zero
    // width for the spacer to reach its full delta in — if the swap fires on the
    // same frame that reaches it, the spacer's last rendered value is one
    // frame's growth short and the bubble jumps by the remainder when it takes
    // over. Measured on the wurld surface: growth 21.875px, last spacer 17.5px.
    expect(flipTurnSwapped(0.99)).toBe(false);
    expect(flipTurnSwapped(1)).toBe(false);
    expect(flipTurnSwapped(1.0001)).toBe(true);
    expect(flipTurnSwapped(1.6)).toBe(true);
  });

  it('still COMMITS from exactly the midpoint, which is a different question', () => {
    // The two differ by exactly that frame, and differ correctly: at zero width
    // the face has not turned yet, but a finger that got there meant to flip it.
    expect(flipTurnSettleTarget(1)).toBe(2);
    expect(flipTurnSwapped(1)).toBe(false);
  });

  it('MSG-BUBBLE-12.4 — direction is latched to the face the turn STARTED on', () => {
    // The face now swaps live at the midpoint, so reading the direction off the
    // current face would flip a grow into a shrink halfway through the gesture
    // — and the spacer would slam shut at the exact moment it is needed most.
    const g = { dragX: 0, flipProgress: 0.4, flipPast: true, active: true };
    expect(flipMotion(g, 0, /* showingNative (already swapped) */ true).direction)
      .toBe('grow');
    const back = { dragX: 0, flipProgress: 0.4, flipPast: false, active: true };
    expect(flipMotion(back, 0, false).direction).toBe('grow');
  });
});

describe('MSG-BUBBLE-12.13 — the turn keeps ONE rotational centre across the swap', () => {
  it('falls back to the box centre when nothing is turning', () => {
    expect(flipTransformOrigin({ mine: true, startWidth: 0 })).toBe('center center');
    expect(flipTransformOrigin({ mine: false, startWidth: -1 })).toBe('center center');
  });

  it('measures from the RIGHT edge for a mine bubble', () => {
    // Mine is right-anchored: both faces share their right edge, so a distance
    // from that edge is the same absolute point in both boxes.
    expect(flipTransformOrigin({ mine: true, startWidth: 300 }))
      .toBe('calc(100% - 150px) center');
  });

  it('measures from the LEFT edge for a theirs bubble', () => {
    expect(flipTransformOrigin({ mine: false, startWidth: 300 }))
      .toBe('150px center');
  });

  it('resolves to the OUTGOING box own centre, so the first half is unchanged', () => {
    // 100% is the CURRENT box. While the outgoing face is on screen the current
    // box IS the outgoing one, so `100% - w/2` is exactly its centre and the
    // first half of the turn looks like an ordinary centre flip.
    const w = 240;
    expect(flipTransformOrigin({ mine: true, startWidth: w }))
      .toBe(`calc(100% - ${w / 2}px) center`);
    expect(flipTransformOrigin({ mine: false, startWidth: w })).toBe(`${w / 2}px center`);
  });
});
