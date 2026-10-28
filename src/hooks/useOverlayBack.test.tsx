/**
 * NAV-OVERLAY-2 — useOverlayBack registers an overlay's close on the back
 * stack only while it is open, and always calls the LATEST onClose.
 *
 * Spec: docs/specs/navigation.md — NAV-OVERLAY-2.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetOverlayBackStackForTests,
  closeTopOverlay,
  overlayBackDepth,
} from '@/lib/overlayBackStack';
import { useOverlayBack } from './useOverlayBack';

afterEach(() => __resetOverlayBackStackForTests());

describe('useOverlayBack', () => {
  it('NAV-OVERLAY-2 — registers nothing while closed', () => {
    renderHook(() => useOverlayBack(false, vi.fn()));
    expect(overlayBackDepth()).toBe(0);
    expect(closeTopOverlay()).toBe(false);
  });

  it('NAV-OVERLAY-2 — registers while open and unregisters when it closes', () => {
    const onClose = vi.fn();
    const { rerender } = renderHook(({ open }) => useOverlayBack(open, onClose), {
      initialProps: { open: true },
    });
    expect(overlayBackDepth()).toBe(1);
    expect(closeTopOverlay()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender({ open: false });
    expect(overlayBackDepth()).toBe(0);
  });

  it('NAV-OVERLAY-2 — unregisters on unmount', () => {
    const { unmount } = renderHook(() => useOverlayBack(true, vi.fn()));
    expect(overlayBackDepth()).toBe(1);
    unmount();
    expect(overlayBackDepth()).toBe(0);
  });

  it('NAV-OVERLAY-2 — calls the LATEST onClose, and a new onClose does not re-register (stack position kept)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useOverlayBack(true, cb), {
      initialProps: { cb: first },
    });
    const later = vi.fn();
    const top = renderHook(() => useOverlayBack(true, later));
    rerender({ cb: second });
    expect(overlayBackDepth()).toBe(2);
    // Re-registering on an identity change would have put it above `later`.
    closeTopOverlay();
    expect(later).toHaveBeenCalledTimes(1);
    top.unmount();
    closeTopOverlay();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('NAV-OVERLAY-2 — the newest open overlay is the one back closes', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    renderHook(() => useOverlayBack(true, outer));
    const { rerender } = renderHook(({ open }) => useOverlayBack(open, inner), {
      initialProps: { open: false },
    });
    rerender({ open: true });
    closeTopOverlay();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});
