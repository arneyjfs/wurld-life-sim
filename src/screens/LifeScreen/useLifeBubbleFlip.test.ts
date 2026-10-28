import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Motion ON. DialogueArea's own tests force reduced motion so the reveal
// resolves instantly, which makes `flipStyle` an empty object — every
// assertion here would be vacuous under that mock.
vi.mock('./nodeEngineGlide', async (importActual) => ({
  ...(await importActual<typeof import('./nodeEngineGlide')>()),
  prefersReducedMotion: () => false,
}));

import { useLifeBubbleFlip, type LifeBubbleAnchor } from './useLifeBubbleFlip';
import { useFlippedBubbleStore } from '@/store/flippedBubbleStore';

/**
 * LIFE-LANG-16 — the wurld bubble flips on the SAME animation as the chat
 * bubble (MSG-BUBBLE-12.11/12.12/12.13), not a look-alike of it.
 *
 * It used to build its own transform inline, and diverged in two ways a player
 * could see: it dropped the transform the instant the finger lifted, so
 * 12.11's release settle never rendered and the card snapped to full width
 * mid-turn; and it scaled about `center`, so faces of different widths jumped
 * sideways at the swap (12.13).
 */
const frames: Array<() => void> = [];
let clock = 0;

beforeEach(() => {
  frames.length = 0;
  clock = 0;
  useFlippedBubbleStore.setState({ activeIds: new Set<string>() });
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('performance', { now: () => clock });
});
afterEach(() => vi.unstubAllGlobals());

function runFrames(max = 120) {
  for (let i = 0; i < max && frames.length > 0; i++) {
    clock += 16;
    const due = frames.splice(0, frames.length);
    act(() => due.forEach((f) => f()));
  }
}

/** A pointer event whose `currentTarget` reports a layout width, which is where
 *  12.13's rotational centre comes from on this surface. */
const ptr = (clientX: number, width = 300) =>
  ({
    clientX, clientY: 100, pointerId: 1, pointerType: 'touch', button: 0,
    currentTarget: { offsetWidth: width, setPointerCapture: () => undefined },
  }) as unknown as React.PointerEvent;

const setup = (anchor: LifeBubbleAnchor) =>
  renderHook(() => useLifeBubbleFlip('b1', true, anchor));

describe('LIFE-LANG-16 — the wurld flip is the chat flip', () => {
  it('MSG-BUBBLE-12.11 — keeps the transform through the RELEASE SETTLE', () => {
    // The divergence a player sees: gated on `active`, the transform vanished
    // the moment the finger lifted, so the turn stopped mid-flight and the card
    // snapped back to full width instead of completing.
    const { result } = setup('right');
    act(() => result.current.handlers.onPointerDown(ptr(200)));
    act(() => result.current.handlers.onPointerMove(ptr(130)));
    runFrames(3);
    act(() => result.current.handlers.onPointerUp(ptr(130)));
    expect(result.current.state.active).toBe(false);
    expect(result.current.flipStyle.transform,
      'the transform was dropped on release — the settle cannot render')
      .toMatch(/scaleX/);
  });

  it('MSG-BUBBLE-12.12 — does not resolve the whole turn in one frame', () => {
    const { result } = setup('left');
    act(() => result.current.handlers.onPointerDown(ptr(200)));
    act(() => result.current.handlers.onPointerMove(ptr(60))); // a full turn's travel
    runFrames(1);
    expect(result.current.state.flipProgress).toBeGreaterThan(0.05);
    expect(result.current.state.flipProgress).toBeLessThan(0.3);
  });

  it('MSG-BUBBLE-12.13 — pins the rotational centre to the outgoing face', () => {
    const right = setup('right');
    act(() => right.result.current.handlers.onPointerDown(ptr(200, 300)));
    act(() => right.result.current.handlers.onPointerMove(ptr(150, 300)));
    runFrames(2);
    // Right-anchored: measured back from the right edge.
    expect(right.result.current.flipStyle.transformOrigin).toBe('calc(100% - 150px) center');

    const left = setup('left');
    act(() => left.result.current.handlers.onPointerDown(ptr(200, 240)));
    act(() => left.result.current.handlers.onPointerMove(ptr(150, 240)));
    runFrames(2);
    expect(left.result.current.flipStyle.transformOrigin).toBe('120px center');
  });

  it('leaves a CENTRED bubble alone — both faces already share its centre', () => {
    // The narrator card is `mx-auto`, so a width change moves both edges
    // symmetrically and there is no centre to correct.
    const { result } = setup('center');
    act(() => result.current.handlers.onPointerDown(ptr(200, 300)));
    act(() => result.current.handlers.onPointerMove(ptr(150, 300)));
    runFrames(2);
    expect(result.current.flipStyle.transformOrigin).toBe('center center');
  });

  it('leaves NO transform at rest', () => {
    const { result } = setup('right');
    expect(result.current.flipStyle.transform).toBeUndefined();
  });
});
