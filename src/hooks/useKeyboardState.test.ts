import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardState } from './useKeyboardState';
import {
  getKeyboardSnapshot,
  installKeyboardController,
  resetKeyboardState,
} from '@/lib/keyboardController';

/**
 * COMP-KB-15 — `useKeyboardState` is a READER. The detection contract itself
 * (source precedence, focus gating, baseline self-heal, reset points, and the
 * migrated COMP-KB-7/9/11/12/13 behaviours) is asserted against the singleton
 * in `src/lib/keyboardController.test.ts`. What this file guards is the wiring:
 * the hook subscribes, re-renders on change, shares one controller across
 * mounts, and never writes `--kb-h` itself.
 */

const BASELINE = 800;
const kbH = () => document.documentElement.style.getPropertyValue('--kb-h');

class FakeVisualViewport extends EventTarget {
  height = BASELINE;
  offsetTop = 0;
}

// ONE viewport for the whole file: the controller is a module singleton that
// binds its listeners at install time, so swapping `window.visualViewport`
// per-test would orphan them. Height is rewound in beforeEach instead.
const vv = new FakeVisualViewport();

function focusInput(): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  document.body.appendChild(ta);
  ta.focus();
  return ta;
}

function openTo(occluded: number) {
  act(() => {
    vv.height = BASELINE - occluded;
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: BASELINE - occluded,
    });
    vv.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(60); // past SETTLE_MS
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  (window as unknown as { visualViewport: FakeVisualViewport }).visualViewport = vv;
  vv.height = BASELINE;
  vv.offsetTop = 0;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: BASELINE });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.body.innerHTML = '';
  installKeyboardController();
  resetKeyboardState('test-setup');
  // Re-derive the no-keyboard baseline at the rewound height (COMP-KB-17: a
  // resize with nothing focused IS the baseline observation).
  vv.dispatchEvent(new Event('resize'));
  expect(getKeyboardSnapshot()).toEqual({ visible: false, height: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('COMP-KB-15 — useKeyboardState reads the controller', () => {
  it('COMP-KB-15 — starts closed', () => {
    const { result } = renderHook(() => useKeyboardState());
    expect(result.current).toEqual({ visible: false, height: 0 });
  });

  it('COMP-KB-15 — re-renders when the controller commits a new height', () => {
    const { result } = renderHook(() => useKeyboardState());
    focusInput();
    openTo(300);
    expect(result.current.visible).toBe(true);
    expect(result.current.height).toBe(300);
  });

  it('COMP-KB-15 — two mounted consumers see identical state from one controller', () => {
    const a = renderHook(() => useKeyboardState());
    const b = renderHook(() => useKeyboardState());
    focusInput();
    openTo(300);
    expect(a.result.current).toEqual(b.result.current);
    expect(a.result.current).toBe(b.result.current); // same snapshot object
  });

  it('COMP-KB-15 — unmounting one consumer leaves the other live', () => {
    const a = renderHook(() => useKeyboardState());
    const b = renderHook(() => useKeyboardState());
    a.unmount();
    focusInput();
    openTo(300);
    expect(b.result.current.height).toBe(300);
  });

  it('COMP-KB-15 — the hook itself never writes --kb-h', () => {
    // Rendering with no keyboard activity must not produce a write beyond the
    // controller's own boot-time 0.
    const spy = vi.spyOn(document.documentElement.style, 'setProperty');
    renderHook(() => useKeyboardState());
    renderHook(() => useKeyboardState());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('COMP-KB-16 — a viewport shrink with nothing focused leaves the hook closed', () => {
    const { result } = renderHook(() => useKeyboardState());
    openTo(300); // no focused input — the desktop-window-resize case
    expect(result.current.visible).toBe(false);
    expect(kbH()).toBe('0px');
  });
});
