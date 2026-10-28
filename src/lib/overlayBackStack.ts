/**
 * NAV-OVERLAY-2 — the overlay back stack (docs/specs/navigation.md).
 *
 * An in-memory, process-wide stack of close callbacks: one per open sheet,
 * dialog or in-page step. The Android back button (`useAndroidBackButton`)
 * asks `closeTopOverlay()` before it climbs the route hierarchy, so a press
 * with a sheet open closes the sheet and leaves the URL alone.
 *
 * Deliberately NOT history entries (that is NAV-OVERLAY-1's image-viewer
 * mechanism): sheets navigate from inside themselves, and an overlay entry
 * left under a pushed route is a dead back (NAV-STACK-1). The cost — browser /
 * PWA back and the iOS swipe still leave the page — is recorded in the spec's
 * Design decision.
 *
 * Components do not call this directly; they use `useOverlayBack`.
 */

type Entry = { close: () => void };

const stack: Entry[] = [];

/**
 * Register an open overlay's close. Returns the unregister, which removes
 * exactly this entry wherever it sits (idempotent).
 */
export function registerOverlayBack(close: () => void): () => void {
  const entry: Entry = { close };
  stack.push(entry);
  return () => {
    const i = stack.lastIndexOf(entry);
    if (i !== -1) stack.splice(i, 1);
  };
}

/**
 * Close the most recently registered overlay. Returns true when one was
 * registered — the back press is then CONSUMED, even if that overlay's own
 * close declines (a guarded close: a send or save in flight). The entry stays
 * until its owner unregisters, i.e. until it actually closes.
 */
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

/** How many overlays are registered. For tests and diagnostics. */
export function overlayBackDepth(): number {
  return stack.length;
}

/** Test-only: drop every entry. */
export function __resetOverlayBackStackForTests(): void {
  stack.length = 0;
}
