/**
 * NAV-OVERLAY-2 — the in-memory overlay back stack the Android back button
 * consults before it climbs the hierarchy.
 *
 * Spec: docs/specs/navigation.md — NAV-OVERLAY-2.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetOverlayBackStackForTests,
  closeTopOverlay,
  overlayBackDepth,
  registerOverlayBack,
} from './overlayBackStack';

afterEach(() => __resetOverlayBackStackForTests());

describe('overlayBackStack', () => {
  it('NAV-OVERLAY-2 — with nothing registered, closeTopOverlay reports false and calls nothing', () => {
    expect(closeTopOverlay()).toBe(false);
    expect(overlayBackDepth()).toBe(0);
  });

  it('NAV-OVERLAY-2 — closes the MOST RECENTLY registered overlay only', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlayBack(a);
    registerOverlayBack(b);
    expect(closeTopOverlay()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it('NAV-OVERLAY-2 — unregister removes exactly that entry, so the one beneath is top again', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerOverlayBack(a);
    const offB = registerOverlayBack(b);
    offB();
    expect(overlayBackDepth()).toBe(1);
    expect(closeTopOverlay()).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('NAV-OVERLAY-2 — unregistering a middle entry leaves the top in place; a second unregister is a no-op', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    registerOverlayBack(a);
    const offB = registerOverlayBack(b);
    registerOverlayBack(c);
    offB();
    offB();
    expect(overlayBackDepth()).toBe(2);
    closeTopOverlay();
    expect(c).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('NAV-OVERLAY-2 — the same callback registered twice is two entries (each owner unregisters its own)', () => {
    const a = vi.fn();
    const off1 = registerOverlayBack(a);
    registerOverlayBack(a);
    off1();
    expect(overlayBackDepth()).toBe(1);
  });

  it('NAV-OVERLAY-2 — the press is consumed even when the callback declines to close (guarded close)', () => {
    registerOverlayBack(() => {});
    expect(closeTopOverlay()).toBe(true);
    // The entry stays until its owner unregisters (it is still open).
    expect(overlayBackDepth()).toBe(1);
  });
});
