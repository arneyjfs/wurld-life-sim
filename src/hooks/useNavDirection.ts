import { useEffect, useRef } from 'react';
import { resolveParent, resolveSectionIndex, NAV_SECTIONS } from '@/lib/navHierarchy';
import { clearAppInitiatedPop, isAppInitiatedPop } from '@/lib/navStack';

export type NavDirection = 'forward' | 'back' | null;

/**
 * React Router's `useNavigationType()` result, as a plain string union so the
 * hook (and its tests) don't have to hold the router's enum. The enum's members
 * are assignable to these literals, so the call site passes it straight through.
 */
export type NavAction = 'POP' | 'PUSH' | 'REPLACE';

/** NAV-ANIM-8: is `path` a section's bare root — the entry a tab points at,
 *  which may exist only to redirect one level deeper? */
function isSectionRoot(path: string): boolean {
  const p = path.replace(/\/+$/, '') || '/';
  return NAV_SECTIONS.some((s) => s.to === p) && p !== '/';
}

/**
 * NAV-ANIM-1 — classify a navigation by STRUCTURE (not history), mirroring the
 * back contract (NAV-PARENT-1). EVERY navigation the APP performs animates (the
 * exception is a platform-driven `POP` — NAV-ANIM-9); the rules below are tried
 * in order and the first match wins:
 *
 *   a. `forward` (down): navigated to a child — `resolveParent(current) === prev`
 *      (e.g. `/` → `/chat/:id`). The incoming page slides in from the RIGHT.
 *   b. `back` (up): navigated to the parent — `resolveParent(prev) === current`
 *      (e.g. `/chat/:id` → `/`). The incoming page slides in from the LEFT.
 *   c. PEER between two different SECTIONS: rank them by `NAV_SECTIONS` order
 *      (NAV-ANIM-7) — later is `forward`, earlier is `back`. So `/contacts` →
 *      `/cards` slides in from the right and `/cards` → `/contacts` from the
 *      left, matching the tab bar's own left-to-right order.
 *   d. Any other peer — same section (`/chat/a` → `/chat/b`), or a route in no
 *      section at all (`/admin`) — defaults to `forward`.
 *
 * `null` is returned on first render, when the pathname did not change, and for
 * a platform-driven `POP` (NAV-ANIM-9, see the gate below).
 *
 * Why (c) rather than "every peer slides in from the right": `/` is itself the
 * first section, so `/cards` → `/` is already a `back` under rule (b). Defaulting
 * every peer to `forward` would make `/cards` → `/contacts` slide the OPPOSITE
 * way to `/cards` → `/`, i.e. the same leftward move on the tab bar animating
 * differently depending only on whether the target is the first tab. Ranking by
 * section makes the root case fall out of the general one.
 *
 * Apart from the NAV-ANIM-9 `POP` gate it is a pure path comparison, so it's
 * deterministic + consistent with back. Reads the previous pathname from a ref
 * (updated after commit), so the value returned for the render that observes a
 * changed pathname reflects the transition INTO it.
 *
 * @param navigationType React Router's `useNavigationType()` for this location.
 * @param search The location's query. Only rules (a)/(b) read it, through
 *   `resolveParent`, for NAV-PARENT-4's tips-return marker: `/tips` →
 *   `/cards?from=tips` is a move DOWN to a child of the tips page, and back is a
 *   move up. A query-only change is still not a navigation here.
 */
export function useNavDirection(
  pathname: string,
  navigationType: NavAction,
  search = '',
): NavDirection {
  const prevRef = useRef(pathname);
  const prevSearchRef = useRef(search);
  // Read-in-render is intentional + required: the slide class must be present on
  // the keyed wrapper's FIRST mount render (else the page jumps before sliding).
  // A ref (not state) holds prev precisely because updating it in the effect
  // below does NOT re-render — so the class persists for the full animation; a
  // state-prev would re-render and cancel the CSS animation mid-slide.
  // eslint-disable-next-line react-hooks/refs
  const prev = prevRef.current;
  // eslint-disable-next-line react-hooks/refs
  const prevSearch = prevSearchRef.current;

  let dir: NavDirection = null;
  // NAV-ANIM-9 — a POP is the PLATFORM's back/forward affordance (iOS edge
  // swipe, Android predictive back, browser chrome), and it has ALREADY run its
  // own interactive transition by the time `popstate` fires. Replaying the slide
  // on the page it just settled restarts that page from translateX(-22%) + dim
  // and slides it in a SECOND time — which on a fast flick reads as the incoming
  // page overshooting and bouncing back (owner report, 2026-07-31).
  //
  // ⚠ AMENDED 2026-09-20 (NAV-STACK-*). The old reasoning was: "NAV-BACK-1
  // requires every in-app back to `navigate(parent, { replace: true })`, which
  // the router reports as REPLACE; tab taps are PUSH; so by elimination a POP
  // can only be the platform." That elimination is no longer sound — under
  // NAV-STACK-1 the in-app back arrow POPS, because popping is what keeps the
  // stack equal to the hierarchy chain. Left as it was, this gate would have
  // silently un-animated every back arrow in the app, which is precisely the
  // regression the old comment warned about, arriving through the door it was
  // holding shut.
  //
  // So the app now SAYS which pops are its own, rather than being inferred:
  // `useAppBack` marks the exact move (from, to) immediately before
  // `navigate(-1)`. Once-only still matters — if the mark survived, a platform
  // pop landing just after an in-app one would inherit it and double-animate,
  // restoring the original bug via the fix for its opposite.
  //
  // ⚠ NAV-ANIM-10 — PEEK here, clear in the effect below. This line used to
  // CONSUME the flag in render. React Router 7 renders navigations inside
  // `startTransition`; React restarts an interrupted transition render (and
  // StrictMode replays every render), so the pass that consumed the flag was
  // thrown away and the replay — the one committed — saw no flag and returned
  // `null`: an in-app back that occasionally cut instead of sliding. Render may
  // run many times per navigation; only the commit happens once.
  //
  // `prevRef` still advances below, so the NEXT navigation classifies off the
  // path the pop landed on — the suppression is per-navigation, not sticky.
  const appPop = navigationType === 'POP' && isAppInitiatedPop(prev, pathname);
  if (prev !== pathname && (navigationType !== 'POP' || appPop)) {
    if (resolveParent(pathname + search) === prev) dir = 'forward';
    else if (resolveParent(prev + prevSearch) === pathname) dir = 'back';
    else {
      const from = resolveSectionIndex(prev);
      const to = resolveSectionIndex(pathname);
      // NAV-ANIM-8 — a section ROOT that only redirects is not a destination,
      // and the hop through it must not overwrite the direction the real move
      // already set. Found via Settings → Wurlds (reported 2026-07-31), where
      // `/wurlds` was `<Navigate to="/wurlds/overview">`: the first hop ranked
      // correctly as `back` (4 → 3), then the redirect landed in the SAME
      // section, hit the `from === to` default, and re-animated `forward`.
      //
      // The ROOT CAUSE is fixed instead — the overview now lives AT `/wurlds`,
      // so no tab points at a redirect. This guard is kept as the general rule
      // it should always have been: a tab root that only forwards has no
      // left/right of its own, and `null` leaves the first animation running
      // rather than fighting it. Nothing in the app exercises it today.
      const redirectHop = from === to && from !== -1 && isSectionRoot(prev);
      dir = redirectHop
        ? null
        : from !== -1 && to !== -1 && from !== to
          ? (to > from ? 'forward' : 'back')
          : 'forward';
    }
  }

  useEffect(() => {
    prevSearchRef.current = search;
  }, [search]);

  useEffect(() => {
    prevRef.current = pathname;
    // NAV-ANIM-10 — the navigation has COMMITTED; whatever it was, the mark has
    // had its one chance. Clearing on every committed move (not only a matched
    // POP) means a mark whose pop never arrived cannot linger either.
    clearAppInitiatedPop();
  }, [pathname]);

  return dir;
}
