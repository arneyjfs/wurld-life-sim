import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSwipeActions } from './useSwipeActions';

/** Minimal React.PointerEvent stand-in for the handlers. */
function ptr(clientX: number, clientY: number, pointerId = 1) {
  return {
    clientX,
    clientY,
    pointerId,
    pointerType: 'touch',
    button: 0,
    currentTarget: { setPointerCapture: () => undefined },
  } as unknown as React.PointerEvent;
}

// MSG-BUBBLE-12.12 — the rendered turn CHASES the finger through a rAF driver,
// so nothing about the flip resolves synchronously any more. Every test that
// asserts a turn value has to advance frames, and it has to do so
// deterministically: jsdom's own rAF fires on a real timer, which would make
// "how far has the card got" a race against the test runner.
let frames: Array<() => void> = [];
let now = 0;

beforeEach(() => {
  frames = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('performance', { now: () => now });
});
afterEach(() => vi.unstubAllGlobals());

/** Advance `ms` and run exactly one frame. */
function frame(ms = 16) {
  now += ms;
  const due = frames;
  frames = [];
  act(() => due.forEach((f) => f()));
}

/** Run the driver until it stops scheduling — i.e. the turn has reached its
 *  target. Bounded so a driver that never converges fails loudly. */
function runFrames(max = 120) {
  for (let i = 0; i < max && frames.length > 0; i++) frame();
}

// MSG-REPLY-5 — WhatsApp-style EARLY, FINAL axis commit. The gesture stays
// dormant inside a small deadzone (commitPx=10); the first move past it decides
// the axis once (45° cone) and never re-evaluates.
describe('useSwipeActions — MSG-REPLY-5 early axis commit (45° cone)', () => {
  it('MSG-REPLY-5 — commits horizontal EARLY (just past commitPx, well before the old 24px)', () => {
    const { result } = renderHook(() => useSwipeActions({ onSwipeRight: vi.fn() }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    // dx=12 crosses commitPx(10), dy=4 → horizontal-dominant → locks immediately.
    act(() => result.current.handlers.onPointerMove(ptr(12, 4)));
    expect(result.current.state.active).toBe(true);
  });

  it('MSG-REPLY-5 — stays dormant inside the deadzone (no commit on sub-threshold jitter / taps)', () => {
    const { result } = renderHook(() => useSwipeActions({ onSwipeRight: vi.fn() }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    // Both axes < commitPx 10 → undecided, not active (so a tap won't arm a drag).
    act(() => result.current.handlers.onPointerMove(ptr(6, 5)));
    expect(result.current.state.active).toBe(false);
  });

  it('MSG-REPLY-5 — a vertical-dominant start (steeper than 45°) yields to scroll', () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onSwipeRight }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    // dy=12 crosses commitPx, dy>dx → vertical → abort to scroll.
    act(() => result.current.handlers.onPointerMove(ptr(8, 12)));
    // Subsequent horizontal can't re-arm — the decision was final.
    act(() => result.current.handlers.onPointerMove(ptr(30, 14)));
    expect(result.current.state.active).toBe(false);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('MSG-REPLY-5 — once committed horizontal, a large mid-swipe vertical CANNOT cancel it', () => {
    const { result } = renderHook(() => useSwipeActions({ onSwipeRight: vi.fn() }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    // Commit horizontal early.
    act(() => result.current.handlers.onPointerMove(ptr(14, 3)));
    expect(result.current.state.active).toBe(true);
    // A big vertical wiggle afterwards — the committed swipe is immune.
    act(() => result.current.handlers.onPointerMove(ptr(20, 60)));
    expect(result.current.state.active).toBe(true);
  });

  it('MSG-REPLY-5 — a swipe just inside 45° (dx=30,dy=28) commits horizontal', () => {
    const { result } = renderHook(() => useSwipeActions({ onSwipeRight: vi.fn() }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    // 28 ≤ 30*1 (axisRatio 1 = 45°) → horizontal wins.
    act(() => result.current.handlers.onPointerMove(ptr(30, 28)));
    expect(result.current.state.active).toBe(true);
  });

  it('MSG-REPLY-5 — a swipe just past 45° (dx=28,dy=30) yields to scroll', () => {
    const { result } = renderHook(() => useSwipeActions({ onSwipeRight: vi.fn() }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    // 30 > 28*1 → steeper than 45° → scroll.
    act(() => result.current.handlers.onPointerMove(ptr(28, 30)));
    expect(result.current.state.active).toBe(false);
  });

  it('MSG-REPLY-5 — blocks native Y-scroll (preventDefault) on touchmove once committed, not before', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    // PointerEvent stand-in whose currentTarget is a REAL element, so the
    // hook's non-passive touchmove listener actually attaches.
    const ptrEl = (x: number, y: number) =>
      ({
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'touch',
        button: 0,
        currentTarget: el,
      }) as unknown as React.PointerEvent;
    const fireTouchMove = () => {
      const ev = new Event('touchmove', { cancelable: true, bubbles: true });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    };

    const { result } = renderHook(() => useSwipeActions({ onSwipeRight: vi.fn() }));
    act(() => result.current.handlers.onPointerDown(ptrEl(0, 0)));
    // Before commit → must NOT preventDefault (a real vertical scroll must pan).
    expect(fireTouchMove()).toBe(false);
    // Commit horizontal.
    act(() => result.current.handlers.onPointerMove(ptrEl(14, 3)));
    expect(result.current.state.active).toBe(true);
    // After commit → preventDefault, so the bubble moving sideways disables Y-scroll.
    expect(fireTouchMove()).toBe(true);
    // After the gesture ends, the listener detaches (no lingering scroll lock).
    act(() => result.current.handlers.onPointerUp(ptrEl(14, 3)));
    expect(fireTouchMove()).toBe(false);
    document.body.removeChild(el);
  });

  it('MSG-REPLY-5 — the axis decision resets between gestures', () => {
    const { result } = renderHook(() => useSwipeActions({ onSwipeRight: vi.fn() }));
    // First gesture commits horizontal then ends.
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    act(() => result.current.handlers.onPointerMove(ptr(14, 3)));
    act(() => result.current.handlers.onPointerUp(ptr(14, 3)));
    expect(result.current.state.active).toBe(false);
    // Second gesture: a vertical-dominant start must still yield to scroll.
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    act(() => result.current.handlers.onPointerMove(ptr(5, 30)));
    expect(result.current.state.active).toBe(false);
  });
});

describe('useSwipeActions — reply/flip fire only past their release thresholds', () => {
  it('fires Reply when a committed rightward swipe is released past replyThreshold (60)', () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onSwipeRight }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    act(() => result.current.handlers.onPointerMove(ptr(14, 3))); // commit horizontal
    act(() => result.current.handlers.onPointerMove(ptr(65, 6)));
    act(() => result.current.handlers.onPointerUp(ptr(65, 6)));
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire Reply when released before replyThreshold (snap-back)', () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onSwipeRight }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    act(() => result.current.handlers.onPointerMove(ptr(14, 3))); // commit horizontal
    act(() => result.current.handlers.onPointerMove(ptr(30, 4)));
    act(() => result.current.handlers.onPointerUp(ptr(30, 4)));
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('ignores a leftward (flip) commit when enableLeft is false', () => {
    const onFlipToggle = vi.fn();
    const { result } = renderHook(() =>
      useSwipeActions({ onFlipToggle, enableLeft: false }),
    );
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    // Leftward, horizontal-dominant — but enableLeft=false → no commit.
    act(() => result.current.handlers.onPointerMove(ptr(-14, 3)));
    expect(result.current.state.active).toBe(false);
    act(() => result.current.handlers.onPointerMove(ptr(-50, 4)));
    act(() => result.current.handlers.onPointerUp(ptr(-50, 4)));
    runFrames();
    expect(onFlipToggle).not.toHaveBeenCalled();
  });
});

// MSG-BUBBLE-12.11 — the finger drives the WHOLE turn (0 -> 1 -> 2), not just
// the squash. `flipRange` (60) is the travel to zero width; the complete turn
// costs twice that.
describe('useSwipeActions — MSG-BUBBLE-12.11 the flip turn follows the finger all the way', () => {
  /** Commit the leftward axis, then drag to `x`. */
  const dragLeftTo = (result: { current: ReturnType<typeof useSwipeActions> }, x: number) => {
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    act(() => result.current.handlers.onPointerMove(ptr(-14, 3)));
    act(() => result.current.handlers.onPointerMove(ptr(x, 4)));
    // 12.12 — let the card reach the finger. These tests are about WHERE the
    // turn ends up for a given drag, not about how fast it gets there.
    runFrames();
  };

  const moveTo = (result: { current: ReturnType<typeof useSwipeActions> }, x: number) => {
    act(() => result.current.handlers.onPointerMove(ptr(x, 4)));
    runFrames();
  };

  it('collapses to zero width at the midpoint and REVEALS on the way out', () => {
    // The bug: `min(1, dx / 60)` saturates here, so every pixel past -60 left
    // the card pinned at zero width and the reveal was a snap on release.
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle: vi.fn() }));
    dragLeftTo(result, -60);
    expect(result.current.state.flipProgress).toBeCloseTo(1);
    moveTo(result, -90);
    expect(result.current.state.flipProgress).toBeCloseTo(0.5);
    moveTo(result, -120);
    expect(result.current.state.flipProgress).toBeCloseTo(0);
  });

  it('swaps the face AT the midpoint, mid-drag — not on release', () => {
    const onFlipToggle = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle }));
    dragLeftTo(result, -59);
    expect(onFlipToggle).not.toHaveBeenCalled();
    moveTo(result, -61);
    expect(onFlipToggle).toHaveBeenCalledTimes(1);
    expect(result.current.state.flipPast).toBe(true);
  });

  it('un-swaps when the finger comes back across the midpoint', () => {
    // 12.3's reversibility, applied to the CONTENT and not just the geometry.
    const onFlipToggle = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle }));
    dragLeftTo(result, -80);
    expect(onFlipToggle).toHaveBeenCalledTimes(1);
    moveTo(result, -30);
    expect(onFlipToggle).toHaveBeenCalledTimes(2);
    expect(result.current.state.flipPast).toBe(false);
  });

  it('leaves NO trace when released short of the midpoint (12.6)', () => {
    const onFlipToggle = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle }));
    dragLeftTo(result, -50);
    act(() => result.current.handlers.onPointerUp(ptr(-50, 4)));
    runFrames();
    expect(onFlipToggle).not.toHaveBeenCalled();
  });

  it('does not re-fire the toggle on release — the crossing already did it', () => {
    // The midpoint is BOTH the swap point and the commit threshold. A release
    // commit on top of the crossing would flip the card straight back.
    const onFlipToggle = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle }));
    dragLeftTo(result, -100);
    act(() => result.current.handlers.onPointerUp(ptr(-100, 4)));
    runFrames();
    expect(onFlipToggle).toHaveBeenCalledTimes(1);
  });
});

// MSG-BUBBLE-12.12 — the speed limit. Driven with a HAND-CRANKED rAF: the
// default test environment has no `requestAnimationFrame`, so the hook takes
// its degraded follow-the-finger path and every assertion about chasing would
// be vacuous — which is exactly how this would ship untested.
describe('useSwipeActions — MSG-BUBBLE-12.12 the turn chases the finger at a capped speed', () => {
  const flick = (result: { current: ReturnType<typeof useSwipeActions> }, to: number) => {
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    act(() => result.current.handlers.onPointerMove(ptr(-14, 3)));
    act(() => result.current.handlers.onPointerMove(ptr(to, 4)));
  };

  it('does NOT resolve a whole turn in one frame', () => {
    // The reported symptom: a fast swipe looked jumpy again, because the finger
    // can cross 120px in two frames and the card followed it exactly. That is
    // not an animation — it is the same jump the feature exists to remove.
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle: vi.fn() }));
    flick(result, -120); // a complete turn's worth of travel, instantly
    frame();
    // 0.012 turn/ms * 16ms = 0.192 of the turn. Bounded on BOTH sides: the
    // collapse is 0 at turn 2 as well as at turn 0, so `< 0.3` alone would also
    // pass for a card that jumped straight to the end — which is the bug.
    expect(result.current.state.flipProgress).toBeGreaterThan(0.05);
    expect(result.current.state.flipProgress).toBeLessThan(0.3);
    expect(result.current.state.flipPast).toBe(false);
  });

  it('still gets there — the cap is a speed limit, not a ceiling', () => {
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle: vi.fn() }));
    flick(result, -120);
    runFrames();
    // Turn 2 = the new face back at full width, so the collapse is 0 again.
    expect(result.current.state.flipProgress).toBeCloseTo(0, 1);
    // ...and it HOLDS there while the finger is down, rather than recycling.
    expect(result.current.state.flipPast).toBe(true);
    act(() => result.current.handlers.onPointerUp(ptr(-120, 4)));
    runFrames();
    expect(result.current.state.flipPast).toBe(false); // now back at rest
  });

  it('HOLDS at the end while the finger stays down — no repeating flip', () => {
    // The reported bug: swipe and hold to the side and the bubble flipped over
    // and over. A completed turn used to recycle to rest immediately, but the
    // target was still 2, so the very next pointermove aimed at it again from
    // zero — an infinite loop for as long as the finger was held.
    const onFlipToggle = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle }));
    flick(result, -140); // well past the end of the turn
    runFrames();
    expect(onFlipToggle).toHaveBeenCalledTimes(1);
    // A held finger is never perfectly still — jitter must not re-arm it.
    for (const px of [-139, -141, -140, -138]) {
      act(() => result.current.handlers.onPointerMove(ptr(px, 4)));
      runFrames();
    }
    expect(onFlipToggle).toHaveBeenCalledTimes(1);
    expect(result.current.state.flipProgress).toBeCloseTo(0, 1);
  });

  it('swaps the face on the RENDERED turn, not on the finger', () => {
    // With the cap the two diverge on a flick. Swapping on the finger would
    // change the content while the card is still visibly wide.
    const onFlipToggle = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle }));
    flick(result, -120);
    expect(onFlipToggle).not.toHaveBeenCalled(); // finger is past it; the card is not
    frame();
    expect(onFlipToggle).not.toHaveBeenCalled();
    runFrames();
    expect(onFlipToggle).toHaveBeenCalledTimes(1);
  });

  it('tracks a SLOW drag without lagging it — the cap only binds on a flick', () => {
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle: vi.fn() }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    act(() => result.current.handlers.onPointerMove(ptr(-14, 3)));
    // 6px per 16ms frame = 0.1 turn per frame, well under the 0.192 cap.
    for (let px = 20; px <= 50; px += 6) {
      act(() => result.current.handlers.onPointerMove(ptr(-px, 4)));
      frame();
    }
    expect(result.current.state.flipProgress).toBeCloseTo(50 / 60, 1);
  });

  it('runs out to the end the FINGER reached, not the one the card had', () => {
    // Release mid-chase: the user dragged past the midpoint, so it commits,
    // even though the card is still catching up when the finger lifts.
    const onFlipToggle = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle }));
    flick(result, -100);
    frame();
    expect(result.current.state.flipPast).toBe(false); // not there yet
    act(() => result.current.handlers.onPointerUp(ptr(-100, 4)));
    runFrames();
    expect(onFlipToggle).toHaveBeenCalledTimes(1);
  });
});

// MSG-REPLY-5.1 — a vertical yield is PROVISIONAL. The finger often drifts a
// few px down before going sideways, and that used to kill the swipe for the
// whole touch: the axis decision was final in both directions.
describe('useSwipeActions — MSG-REPLY-5.1 an obvious sideways move rescues a vertical yield', () => {
  const startAt = (result: { current: ReturnType<typeof useSwipeActions> }) =>
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));

  it('rescues the flip after a small accidental vertical drift', () => {
    const onFlipToggle = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle }));
    startAt(result);
    // Vertical-dominant past the deadzone → yields to the list scroll.
    act(() => result.current.handlers.onPointerMove(ptr(-3, 14)));
    expect(result.current.state.active).toBe(false);
    // ...then the finger goes clearly sideways. That is the swipe they meant.
    act(() => result.current.handlers.onPointerMove(ptr(-30, 18)));
    expect(result.current.state.active).toBe(true);
    runFrames();
    expect(result.current.state.flipProgress).toBeGreaterThan(0);
  });

  it('counts the rescue travel from the YIELD POINT, not the original touch', () => {
    // Re-baselining at the touch origin would credit the drift as swipe travel
    // and start the turn part-way through; baselining at the yield point makes
    // the rescue continuous with the finger. 12.12's cap absorbs the step in.
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle: vi.fn() }));
    startAt(result);
    act(() => result.current.handlers.onPointerMove(ptr(-3, 14)));
    act(() => result.current.handlers.onPointerMove(ptr(-33, 18))); // 30px from the yield
    runFrames();
    // 30px of a 60px half-range = half the collapse, not 33/60.
    expect(result.current.state.flipProgress).toBeCloseTo(0.5, 1);
  });

  it('does NOT rescue while the finger is still going vertically', () => {
    // A real scroll must stay a scroll — this is the case the yield exists for.
    const onFlipToggle = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle }));
    startAt(result);
    act(() => result.current.handlers.onPointerMove(ptr(-3, 14)));
    act(() => result.current.handlers.onPointerMove(ptr(-12, 90)));
    runFrames();
    expect(result.current.state.active).toBe(false);
  });

  it('needs an OBVIOUS sideways move, not a nudge', () => {
    // The bar is higher than the initial 10px deadzone: the finger is already
    // in a scroll, so re-claiming it on any small drift would make the list
    // impossible to scroll past a bubble.
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle: vi.fn() }));
    startAt(result);
    act(() => result.current.handlers.onPointerMove(ptr(-3, 14)));
    act(() => result.current.handlers.onPointerMove(ptr(-15, 16))); // 12px sideways
    expect(result.current.state.active).toBe(false);
  });

  it('a COMMITTED horizontal is still never cancelled by vertical', () => {
    // The asymmetry is the point. A committed horizontal has visible state —
    // the card is mid-turn — and abandoning it would be jarring. A yield has
    // none, so reclaiming it costs nothing.
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle: vi.fn() }));
    startAt(result);
    act(() => result.current.handlers.onPointerMove(ptr(-14, 3)));
    expect(result.current.state.active).toBe(true);
    act(() => result.current.handlers.onPointerMove(ptr(-20, 200)));
    expect(result.current.state.active).toBe(true);
  });

  it('rescues the REPLY direction too', () => {
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onSwipeRight }));
    startAt(result);
    act(() => result.current.handlers.onPointerMove(ptr(3, 14)));
    act(() => result.current.handlers.onPointerMove(ptr(33, 18)));
    expect(result.current.state.active).toBe(true);
    expect(result.current.state.dragX).toBeGreaterThan(0);
  });
});

describe('useSwipeActions — the turn LANDS on the midpoint before crossing it', () => {
  it('never steps over zero width in a single frame', () => {
    // The reported wurld defect. The spacer is a function of the turn, so a
    // frame that jumps 0.8 -> 1.2 renders the spacer at 0.8 of its delta and
    // then hands over to a bubble the full delta taller. The remainder is a
    // visible jump at the swap, and it grows with finger speed — which is why
    // it showed up on the wurld's short beats and hid on a slow chat drag.
    const { result } = renderHook(() => useSwipeActions({ onFlipToggle: vi.fn() }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    act(() => result.current.handlers.onPointerMove(ptr(-14, 3)));
    act(() => result.current.handlers.onPointerMove(ptr(-140, 4)));

    const seen: number[] = [];
    for (let i = 0; i < 60 && frames.length > 0; i++) {
      frame();
      seen.push(result.current.state.flipProgress);
      if (result.current.state.flipPast) break;
    }
    // The frame BEFORE the swap must be at full collapse — that is the frame
    // the spacer needs in order to hold the whole delta.
    const atSwap = seen[seen.length - 1]!;
    const beforeSwap = seen[seen.length - 2]!;
    expect(beforeSwap,
      `the turn crossed the midpoint from ${beforeSwap} — the spacer never ` +
      `reached its delta, so the bubble jumps the remainder`)
      .toBeCloseTo(1, 5);
    expect(atSwap).toBeLessThan(1);
  });
});

// QUIZ-INB-6 — with an open quiz, the flip-way swipe skips without turning the card.
describe('useSwipeActions — onLeftCommit (QUIZ-INB-6)', () => {
  it('QUIZ-INB-6 — past the midpoint distance it fires once; the card never turns', () => {
    const onLeftCommit = vi.fn();
    const onFlipToggle = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onLeftCommit, onFlipToggle }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    act(() => result.current.handlers.onPointerMove(ptr(-14, 2)));
    act(() => result.current.handlers.onPointerMove(ptr(-40, 2)));
    runFrames();
    expect(onLeftCommit).not.toHaveBeenCalled();
    act(() => result.current.handlers.onPointerMove(ptr(-70, 2)));
    act(() => result.current.handlers.onPointerMove(ptr(-110, 2)));
    runFrames();
    expect(onLeftCommit).toHaveBeenCalledTimes(1);
    expect(result.current.state.flipProgress).toBe(0);
    act(() => result.current.handlers.onPointerUp(ptr(-110, 2)));
    runFrames();
    expect(onLeftCommit).toHaveBeenCalledTimes(1);
    expect(onFlipToggle).not.toHaveBeenCalled();
    expect(result.current.state.flipProgress).toBe(0);
  });

  it('QUIZ-INB-6 — a drag that stops short of the midpoint does not skip', () => {
    const onLeftCommit = vi.fn();
    const { result } = renderHook(() => useSwipeActions({ onLeftCommit }));
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    act(() => result.current.handlers.onPointerMove(ptr(-14, 2)));
    act(() => result.current.handlers.onPointerMove(ptr(-45, 2)));
    act(() => result.current.handlers.onPointerUp(ptr(-45, 2)));
    runFrames();
    expect(onLeftCommit).not.toHaveBeenCalled();
  });
});

describe('useSwipeActions — onLeftCommit latches per gesture (QUIZ-INB-6)', () => {
  it('QUIZ-INB-6 — the skip ending the quiz mid-gesture does not turn the rest of the gesture into a flip', () => {
    const onLeftCommit = vi.fn();
    const onFlipToggle = vi.fn();
    let open = true;
    const { result, rerender } = renderHook(() =>
      useSwipeActions(open ? { onLeftCommit } : { onFlipToggle }),
    );
    act(() => result.current.handlers.onPointerDown(ptr(0, 0)));
    act(() => result.current.handlers.onPointerMove(ptr(-14, 2)));
    act(() => result.current.handlers.onPointerMove(ptr(-70, 2)));
    expect(onLeftCommit).toHaveBeenCalledTimes(1);
    open = false; // the skip closed the quiz
    rerender();
    act(() => result.current.handlers.onPointerMove(ptr(-120, 2)));
    runFrames();
    act(() => result.current.handlers.onPointerUp(ptr(-120, 2)));
    runFrames();
    expect(onFlipToggle).not.toHaveBeenCalled();
    expect(result.current.state.flipProgress).toBe(0);
  });
});
