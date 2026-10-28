import type { NavDirection } from '@/hooks/useNavDirection';

/**
 * NAV-ANIM page-transition state machine (pure core, unit-tested).
 *
 * `AnimatedRoutes` keeps a list of "slots", each rendering a route tree at
 * its OWN location with a stable `id` key. During a hierarchy navigation we
 * keep the current (now-exiting) slot's LIVE instance and add an entering
 * slot — stable ids preserve BOTH React instances across the transition, so
 * the outgoing page animates out as its live self instead of remounting a
 * blank copy. The list is capped at 2 (newest + the one exiting); after the
 * animation the component drops the exiting slot.
 */

/**
 * NAV-ANIM-6 — how long a page transition lasts, in ms.
 *
 * Lives here rather than in `routes.tsx` because it is a SHARED constant: the
 * `.page-anim-*` rules in `globals.css` must declare the same number (the JS
 * timer below is what drops the outgoing slot, so a CSS animation that outlives
 * it gets cut off mid-frame, and one that finishes early parks the old page on
 * screen). `globals.pageAnim.test.ts` asserts the two never drift.
 *
 * 380ms, not the original 280: paired with a front-loaded iOS curve, 280ms put
 * most of the travel inside the first quarter of the animation and the whole
 * push read as a flash rather than a movement.
 */
export const PAGE_ANIM_MS = 380;

export type NavSlotAnim =
  | 'enter-forward'
  | 'exit-forward'
  | 'enter-back'
  | 'exit-back'
  | null;

export type NavSlot<L> = {
  id: number;
  location: L;
  anim: NavSlotAnim;
};

/**
 * Compute the next slot list for a navigation.
 *
 * - Same pathname → keep the live instance (refresh the location object only).
 * - No direction (peer/tab/first) OR reduced-motion → instant single-slot swap.
 * - Forward/back → [exiting(current), entering(new)] with parallax anims.
 */
export function reduceNavSlots<L extends { pathname: string }>(
  prev: NavSlot<L>[],
  location: L,
  dir: NavDirection,
  reduce: boolean,
  newId: number,
): NavSlot<L>[] {
  const top = prev[prev.length - 1];
  if (!top) return [{ id: newId, location, anim: null }];
  if (top.location.pathname === location.pathname) {
    // Same route — preserve the instance; only refresh the location object
    // if it actually changed (state/hash-only change).
    if (top.location === location) return prev;
    const next = prev.slice();
    next[next.length - 1] = { ...top, location };
    return next;
  }
  if (!dir || reduce) {
    // Instant swap: a single slot, no exit overlay. (Reduced-motion routes
    // here too, so a `back` never lingers the old page on top.)
    return [{ id: newId, location, anim: null }];
  }
  const exiting: NavSlot<L> = {
    ...top,
    anim: dir === 'forward' ? 'exit-forward' : 'exit-back',
  };
  const entering: NavSlot<L> = {
    id: newId,
    location,
    anim: dir === 'forward' ? 'enter-forward' : 'enter-back',
  };
  return [exiting, entering];
}

/**
 * Collapse to the single newest slot once the slide has finished, with its
 * anim CLEARED. The `.page-anim-*` class (held by `both` fill) otherwise leaves
 * a lingering `transform` on the steady-state slot — and ANY transform makes
 * the slot a containing block + stacking context for `position: fixed`, which
 * traps the long-press lifted bubble behind the body-level backdrop portal
 * (RXN-MENU-3.1). Clearing the anim drops the class so fixed escapes to the
 * viewport again. Returns the input unchanged when already a single slot.
 */
export function settleNavSlots<L>(prev: NavSlot<L>[]): NavSlot<L>[] {
  if (prev.length < 2) return prev;
  const last = prev[prev.length - 1];
  return last ? [{ ...last, anim: null }] : prev;
}

/** The slide/parallax class for a slot's animation role. */
export function navSlotAnimClass(anim: NavSlotAnim): string | false {
  switch (anim) {
    case 'enter-forward':
      return 'page-anim-enter-forward';
    case 'exit-forward':
      return 'page-anim-exit-forward';
    case 'enter-back':
      return 'page-anim-enter-back';
    case 'exit-back':
      return 'page-anim-exit-back';
    default:
      return false;
  }
}

/**
 * Stacking order during a transition. Forward: the incoming page covers the
 * receding one (incoming on top). Back: the outgoing page slides off ON TOP
 * of the parent it reveals.
 */
export function navSlotZIndex(anim: NavSlotAnim): number {
  return anim === 'enter-forward' || anim === 'exit-back' ? 20 : 10;
}
