/**
 * NAV-STACK-* — keep `window.history` equal to the hierarchy chain.
 *
 * ── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────
 *
 * The app had a hierarchy (`resolveParent`) and the browser had a history, and
 * on iOS the browser's back button is not interceptable — no `popstate`
 * veto exists. So there were two back models and the user met whichever they
 * pressed. `NAV-BACK-1`'s `replace`-everywhere rule could not close that gap,
 * for a reason worth stating plainly because it is the crux:
 *
 *   **`replace` never shrinks the stack, and it cannot create an entry BELOW
 *   the bottom of one.**
 *
 * So a deep-linked entry stays the floor however disciplined the in-app
 * affordances are, and back from a push notification leaves the app. The fix
 * is not more discipline — it is to make the stack *be* the chain, at which
 * point a history pop and a hierarchy climb are the same move and the
 * uninterceptable button is correct for free (NAV-STACK-2).
 *
 * ── WHY THE DEPTH STAMP ────────────────────────────────────────────────────
 *
 * `window.history` is not ours alone: the browser restores sessions, other
 * code pushes entries, and a user can arrive mid-stack. We cannot READ the
 * stack (no API exposes entries below the cursor), so the invariant is not
 * observable — only assertable. `navDepth` in `history.state` is how a caller
 * checks rather than assumes (NAV-STACK-3): if the stamp is absent or
 * disagrees with the chain, we do not pop, we fall back to the old
 * replace-to-parent behaviour, which is always safe if sometimes suboptimal.
 *
 * Pure functions here; the DOM-touching wrappers are at the bottom and take
 * the History object so they can be driven in a test.
 */
import { parentChain, resolveParent } from './navHierarchy';

/** Key inside `history.state`. Namespaced — the state object is shared with
 *  React Router, which keeps its own `usr`/`key`/`idx` fields there. */
export const NAV_DEPTH_KEY = 'wurldNavDepth';

/**
 * The path that was showing when this entry was PUSHED — i.e. what is
 * actually one step beneath it in the stack.
 *
 * ⚠ THIS EXISTS BECAUSE THE DEPTH STAMP ALONE IS A LIE ON ANY NON-DESCENDING
 * PUSH, and the lie is dangerous rather than merely useless. A `<Link to="/cards">`
 * clicked from `/cards/practice` pushes an entry whose path-derived depth (1)
 * is perfectly correct — so `canPopToParent` said yes, and back POPPED INTO
 * `/cards/practice`: down the hierarchy, the exact retrace this whole change
 * exists to stop, reintroduced by the mechanism meant to fix it.
 *
 * The path can only say what SHOULD be beneath. This records what IS.
 */
export const NAV_BELOW_KEY = 'wurldNavBelow';

/**
 * NAV-STACK-6 — marks the guard entry beneath the chain in the iOS home-screen
 * app. Landing on it (a platform back from home) puts home straight back on
 * top, so back can never pop past the app into a blank Safari page.
 */
export const NAV_GUARD_KEY = 'wurldNavGuard';

/** Is this history state our NAV-STACK-6 guard? Only our own `true` counts. */
export function isGuardEntry(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as Record<string, unknown>)[NAV_GUARD_KEY] === true
  );
}

/**
 * NAV-STACK-5 — where a pending push-tap should take the app, or `null` when
 * the app is already showing that chat. On a cold launch the booted URL IS the
 * chat, and `seedHistory` has already put it on the stack; navigating to it
 * again pushed a second copy, so back showed the chat twice.
 */
export function pendingChatTarget(chatId: string, pathname: string): string | null {
  const target = `/chat/${chatId}`;
  return pathname === target ? null : target;
}

/**
 * NAV-STACK-6 — called on `popstate`. If the entry we landed on is the guard,
 * push a fresh home entry above it and report `true`; otherwise do nothing.
 * The guard's own URL is `/`, so the router is already rendering home — this
 * only restores an entry for the next back to land on.
 */
export function restoreFromGuard(history: History): boolean {
  if (!isGuardEntry(history.state)) return false;
  history.pushState(stateForPath('/'), '', '/');
  return true;
}

/** The depth a given path's entry must carry: its index in its own chain. */
export function depthForPath(pathname: string): number {
  return parentChain(pathname).length - 1;
}

/** Read our stamp out of an arbitrary history state. `null` when absent or
 *  malformed — which is the common case for an entry we did not write. */
export function depthOf(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) return null;
  const raw = (state as Record<string, unknown>)[NAV_DEPTH_KEY];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : null;
}

/** Read the recorded path beneath this entry. `null` when unknown. */
export function belowOf(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;
  const raw = (state as Record<string, unknown>)[NAV_BELOW_KEY];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** Merge our stamps into an existing state object without disturbing it. */
export function withEntry(
  state: unknown,
  depth: number,
  below: string | null,
): Record<string, unknown> {
  const base = typeof state === 'object' && state !== null ? { ...(state as object) } : {};
  const next: Record<string, unknown> = { ...base, [NAV_DEPTH_KEY]: depth };
  if (below) next[NAV_BELOW_KEY] = below;
  else delete next[NAV_BELOW_KEY];
  return next;
}

/**
 * The state a correctly-stacked entry for `pathname` carries: its chain depth,
 * and the parent it sits on. Used by seeding and by tests that need to build a
 * well-formed stack without restating the rule at every call site.
 */
export function stateForPath(pathname: string): Record<string, unknown> {
  return withEntry(null, depthForPath(pathname), resolveParent(pathname));
}

/**
 * NAV-STACK-3 — may a back affordance POP, or must it replace-to-parent?
 *
 * True only when the current entry carries a stamp that matches its own
 * chain depth AND that depth is > 0 (at the root there is no parent to pop
 * to). Everything else — an unstamped entry, a restored session, a stamp
 * that disagrees because something pushed without going through us — returns
 * false, and the caller does the safe thing.
 */
export function canPopToParent(state: unknown, pathname: string): boolean {
  const stamped = depthOf(state);
  if (stamped === null) return false;
  const expected = depthForPath(pathname);
  if (stamped !== expected || expected <= 0) return false;
  // ...and the entry BENEATH must actually be the parent. The depth check
  // above only proves this path SITS at that level, which every push of an
  // ancestor also satisfies. Without this second half, a link up the tree
  // authorises a pop back DOWN into the page it left.
  const below = belowOf(state);
  return below !== null && below === resolveParent(pathname);
}

/**
 * NAV-STACK-4 — what boot must do so the platform back has real parents
 * beneath the entry it landed on.
 *
 * Returns the root to `replaceState` onto the current entry, then the
 * descendants to `pushState` in order. For `/` there is nothing to do and
 * this returns `null`, so a normal cold boot pays nothing.
 */
export function seedPlan(pathname: string): { root: string; pushes: string[] } | null {
  const chain = parentChain(pathname);
  if (chain.length <= 1) return null;
  return { root: chain[0] ?? '/', pushes: chain.slice(1) };
}

// ---------------------------------------------------------------------------
// DOM wrappers. `History` is injected so these are drivable in jsdom.
// ---------------------------------------------------------------------------

/**
 * Apply `seedPlan` to a real History. Call ONCE, before the router reads the
 * location — the URL is unchanged at the end (the last push is the path we
 * arrived on), so the router never sees the intermediate states.
 *
 * ⚠ Ordering matters and is easy to get backwards: `replaceState` REWRITES the
 * entry we are standing on (so the floor becomes `/`), and each `pushState`
 * then adds one above it. Doing it the other way round would leave the
 * deep-linked path buried under its own ancestors and the URL pointing at the
 * root.
 */
export function seedHistory(
  pathname: string,
  history: History,
  suffix = '',
  opts: { guard?: boolean } = {},
): void {
  // `suffix` is the arrival URL's `search + hash`. It belongs to the entry the
  // user asked for — the last one — and never to a seeded ancestor. Dropping
  // it lost every query-carrying deep link (share-target.md SHARE-WEB-3).
  // NAV-STACK-6 — in the iOS home-screen app the arrival entry becomes the
  // guard, and the whole chain (home included) is pushed above it. It is the
  // one entry made by replaceState rather than created, so it stays reachable
  // even where iOS skips entries a script pushed before any interaction.
  // NAV-PARENT-4 — the chain is planned from the path PLUS its query, so a
  // tips marker (`?from=tips`) seeds the tips page beneath a reloaded Try-it
  // screen. Entries still carry the bare paths; only the last gets `suffix`.
  const planUrl = pathname + (suffix.split('#')[0] ?? '');
  if (opts.guard) {
    history.replaceState(withEntry({ [NAV_GUARD_KEY]: true }, 0, null), '', '/');
    const chain = parentChain(planUrl);
    chain.forEach((path, i) => {
      const last = i === chain.length - 1;
      history.pushState(withEntry(null, i, i === 0 ? null : (chain[i - 1] ?? '/')), '', last ? path + suffix : path);
    });
    return;
  }
  const plan = seedPlan(planUrl);
  if (!plan) {
    // Still stamp the root so `canPopToParent` sees a state it recognises.
    history.replaceState(withEntry(history.state, 0, null), '', pathname + suffix);
    return;
  }
  history.replaceState(withEntry(history.state, 0, null), '', plan.root);
  plan.pushes.forEach((path, i) => {
    // We are building the chain ourselves, so we know exactly what each entry
    // sits on: the previous link.
    const below = i === 0 ? plan.root : (plan.pushes[i - 1] ?? plan.root);
    const last = i === plan.pushes.length - 1;
    history.pushState(withEntry(null, i + 1, below), '', last ? path + suffix : path);
  });
}

/**
 * NAV-ANIM-9 — tell an APP-initiated pop apart from a platform one.
 *
 * Under NAV-STACK-1 the in-app back arrow is a real `history.go(-1)`, so it
 * now arrives as a `POP` — and NAV-ANIM-9 mutes the page transition on every
 * `POP`, because a platform back has already run its own interactive
 * animation and replaying ours reads as a bounce. Without this mark the fix
 * for back navigation would silently un-animate every back arrow in the app:
 * the exact regression the old NAV-BACK-1 text warned about, arriving through
 * the door it was holding shut.
 *
 * NAV-ANIM-10 — PEEKED in render, CLEARED after commit. This used to be a
 * boolean that `useNavDirection` read-and-cleared during render. React Router
 * 7 renders every navigation inside `startTransition`, which React restarts
 * whenever an urgent update lands mid-render (and StrictMode replays every
 * render in dev): the first pass took the flag and said `back`, the replay
 * found nothing and said `null`, and the replay is what committed — an
 * un-animated cut from the chat to the list (owner: "occasional small flicker
 * coming from a chat BACK to the chatlist"). Render may run any number of
 * times per navigation, so render only reads; `useNavDirection`'s commit
 * effect clears. The mark names the exact move, so a stale one can never make
 * an unrelated platform pop animate.
 */
let appInitiatedPop: { from: string; to: string } | null = null;

/** Raise immediately before calling `history.go(-1)` from a back affordance:
 *  `from` is the pathname being left, `to` the parent the pop lands on. */
export function markAppInitiatedPop(from: string, to: string): void {
  appInitiatedPop = { from, to };
}

/** Pure read — safe to call in render, any number of times. True only for the
 *  exact move the app announced. */
export function isAppInitiatedPop(from: string, to: string): boolean {
  return appInitiatedPop !== null && appInitiatedPop.from === from && appInitiatedPop.to === to;
}

/** The pending mark, if any (tests and diagnostics). */
export function peekAppInitiatedPop(): { from: string; to: string } | null {
  return appInitiatedPop;
}

/** Drop the mark. Called from `useNavDirection`'s post-commit effect on every
 *  committed pathname change — never from render. */
export function clearAppInitiatedPop(): void {
  appInitiatedPop = null;
}

/** Test seam — a module flag that leaks across tests is its own bug. */
export function _resetAppInitiatedPopForTests(): void {
  appInitiatedPop = null;
}

/**
 * Record what this entry is, and what it sits on, after a navigation.
 *
 * `<Link>` cannot carry history state, so entries it pushes arrive bare and
 * `canPopToParent` would refuse them. Repairing centrally here — rather than
 * demanding every navigation in the app route through a helper — is
 * deliberate: that demand is precisely what already failed, at 16 call sites
 * out of 19.
 *
 * All three navigation types are handled differently, and the differences are
 * the substance:
 *  - PUSH adds an entry on top of the one we were just on, so `below` is the
 *    path we came from. That is the ONLY moment this is knowable.
 *  - REPLACE swaps the current entry; whatever was underneath is unchanged,
 *    but the router has already overwritten our state, so the record is gone
 *    and we degrade to replace-to-parent. Safe, just not stack-shrinking.
 *  - POP restores an entry along with the state it was pushed with, so it
 *    already carries the truth. We must not overwrite it — we did not create
 *    that entry and cannot know what is under it.
 */
export function stampCurrentEntry(
  pathname: string,
  navigationType: 'PUSH' | 'REPLACE' | 'POP',
  previousPathname: string | null,
  history: History,
): void {
  const depth = depthForPath(pathname);
  if (navigationType === 'POP') {
    if (depthOf(history.state) === null) {
      history.replaceState(withEntry(history.state, depth, null), '');
    }
    return;
  }
  const below = navigationType === 'PUSH' ? previousPathname : belowOf(history.state);
  if (depthOf(history.state) === depth && belowOf(history.state) === below) return;
  history.replaceState(withEntry(history.state, depth, below), '');
}
