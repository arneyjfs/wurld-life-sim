import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LifeFlipHint } from './LifeFlipHint';
import {
  MAX_FLIPS,
  useLifeFlipHintStore,
  __resetFlipHintForTest,
} from '@/lib/life/lifeFlipHint';

/** A withheld-gloss bubble stand-in with a non-zero rect (jsdom returns 0×0
 *  by default, which the hint treats as "not on screen"). */
function addTarget(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-life-flip-target', '');
  el.getBoundingClientRect = () =>
    ({
      top: 100,
      left: 50,
      width: 200,
      height: 40,
      bottom: 140,
      right: 250,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

describe('LifeFlipHint — LIFE-LANG-16', () => {
  let queue: FrameRequestCallback[] = [];
  function flushRaf() {
    const batch = queue;
    queue = [];
    act(() => batch.forEach((cb) => cb(0)));
  }

  beforeEach(() => {
    localStorage.clear();
    __resetFlipHintForTest();
    queue = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.querySelectorAll('[data-life-flip-target]').forEach((e) => e.remove());
  });

  it('renders the animated swipe finger over the newest withheld bubble when eligible', () => {
    addTarget();
    render(<LifeFlipHint />);
    flushRaf();
    const hint = screen.getByTestId('LifeScreen-FlipHint');
    expect(hint).toBeInTheDocument();
    // The reused tutor-tutorial swipe pointer, not the ring variant.
    expect(hint).toHaveAttribute('data-variant', 'swipe');
  });

  it('renders nothing once the coach-mark budget is exhausted', () => {
    addTarget();
    for (let i = 0; i < MAX_FLIPS; i++) useLifeFlipHintStore.getState().recordFlip();
    render(<LifeFlipHint />);
    flushRaf();
    flushRaf();
    expect(screen.queryByTestId('LifeScreen-FlipHint')).not.toBeInTheDocument();
  });

  it('renders nothing when no withheld bubble is on screen (nothing to reveal)', () => {
    render(<LifeFlipHint />);
    flushRaf();
    flushRaf();
    expect(screen.queryByTestId('LifeScreen-FlipHint')).not.toBeInTheDocument();
  });

  it('credits exactly one show-occasion on mount (bounds the coach-mark)', () => {
    addTarget();
    const before = useLifeFlipHintStore.getState().shows;
    render(<LifeFlipHint />);
    expect(useLifeFlipHintStore.getState().shows).toBe(before + 1);
  });

  it('does NOT credit a show-occasion when already dismissed', () => {
    addTarget();
    for (let i = 0; i < MAX_FLIPS; i++) useLifeFlipHintStore.getState().recordFlip();
    const before = useLifeFlipHintStore.getState().shows;
    render(<LifeFlipHint />);
    expect(useLifeFlipHintStore.getState().shows).toBe(before);
  });
});
