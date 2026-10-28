import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * COMP-KB-22 / AUTH-SIGN-IN-9 — whichever field in the container holds focus
 * is lifted clear of the keyboard by scrolling the container only, by the
 * minimum distance. Spec: docs/specs/composer.md, docs/specs/auth-onboarding.md.
 */
let kbState: { visible: boolean; height: number } = { visible: false, height: 0 };
vi.mock('@/hooks/useKeyboardState', () => ({ useKeyboardState: () => kbState }));

import { useLiftFocusedField } from './useLiftFocusedField';

const INNER_H = 800;
const KB_H = 320;

function Form() {
  const ref = useRef<HTMLDivElement | null>(null);
  useLiftFocusedField(ref);
  return (
    <div ref={ref} data-testid="scroller" data-lift-scroller>
      <input data-testid="top" />
      <input data-testid="low" />
    </div>
  );
}

/** A rect that moves with its scroller, so a second pass finds nothing to do. */
function stubRect(el: Element, top: number, bottom: number, scroller?: HTMLElement) {
  el.getBoundingClientRect = () => {
    const y = scroller ? scroller.scrollTop : 0;
    return { top: top - y, bottom: bottom - y, y: top - y, height: bottom - top, left: 0, right: 0, x: 0, width: 0, toJSON: () => ({}) } as DOMRect;
  };
}

function mount() {
  const view = render(<Form />);
  const scroller = screen.getByTestId('scroller');
  stubRect(scroller, 0, INNER_H);
  stubRect(screen.getByTestId('top'), 100, 140, scroller);
  // Bisected by the keyboard top (480): 470..520.
  stubRect(screen.getByTestId('low'), 470, 520, scroller);
  return { ...view, scroller };
}

function keyboardUp(rerender: (ui: React.ReactElement) => void) {
  kbState = { visible: true, height: KB_H };
  rerender(<Form />);
}

beforeEach(() => {
  vi.useFakeTimers();
  kbState = { visible: false, height: 0 };
  Object.defineProperty(window, 'innerHeight', { value: INNER_H, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('COMP-KB-22 / AUTH-SIGN-IN-9 — useLiftFocusedField', () => {
  it('AUTH-SIGN-IN-9 — a focused field under the keyboard is lifted clear by scrolling its container', () => {
    const { rerender, scroller } = mount();
    fireEvent.focusIn(screen.getByTestId('low'));
    keyboardUp(rerender);
    // 520 - 480 = 40px, the minimum distance.
    expect(scroller.scrollTop).toBe(40);
    expect(screen.getByTestId('low').getBoundingClientRect().bottom).toBeLessThanOrEqual(INNER_H - KB_H);
  });

  it('COMP-KB-22 — the follow-up pass is a no-op once the field is clear', () => {
    const { rerender, scroller } = mount();
    fireEvent.focusIn(screen.getByTestId('low'));
    keyboardUp(rerender);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(scroller.scrollTop).toBe(40);
  });

  it('COMP-KB-22 — a field already above the keyboard does not move anything', () => {
    const { rerender, scroller } = mount();
    fireEvent.focusIn(screen.getByTestId('top'));
    keyboardUp(rerender);
    expect(scroller.scrollTop).toBe(0);
  });

  it('COMP-KB-22 — never scrolls the document', () => {
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const { rerender } = mount();
    fireEvent.focusIn(screen.getByTestId('low'));
    keyboardUp(rerender);
    expect(intoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  it('AUTH-SIGN-IN-9 — after the field blurs, a keyboard change moves nothing', () => {
    const { rerender, scroller } = mount();
    const low = screen.getByTestId('low');
    fireEvent.focusIn(low);
    fireEvent.focusOut(low);
    keyboardUp(rerender);
    expect(scroller.scrollTop).toBe(0);
  });
});
