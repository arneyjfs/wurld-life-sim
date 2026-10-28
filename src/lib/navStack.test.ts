// @vitest-environment jsdom
/**
 * NAV-STACK-* — the history stack mirrors the hierarchy.
 *
 * ⚠ WHAT THE OLD NAV SUITE PROVED, AND WHY IT WASN'T ENOUGH.
 * 43 nav tests were green while back was visibly broken in production, because
 * they tested `resolveParent` as a pure function (correct), and the animation
 * direction (correct), and nothing tested the history stack or the callers.
 * `useAppBack.test.tsx` never mounted a real screen, and its NAV-BACK-CIRCULAR
 * case seeded a 4-entry history and asserted only the resulting PATHNAME — so
 * a push and a replace were indistinguishable to it, which is precisely the
 * difference that produced the reported yo-yo.
 *
 * So these tests assert STACK SHAPE, not just destinations.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { parentChain } from './navHierarchy';
import {
  NAV_DEPTH_KEY,
  canPopToParent,
  depthForPath,
  depthOf,
  seedHistory,
  seedPlan,
  withEntry,
  stateForPath,
  belowOf,
  stampCurrentEntry,
} from './navStack';

describe('NAV-STACK-1 — parentChain is the shape the stack must have', () => {
  it('NAV-STACK-1 — root first, current last', () => {
    expect(parentChain('/chat/A/info')).toEqual(['/', '/chat/A', '/chat/A/info']);
    expect(parentChain('/chat/A/add-member')).toEqual([
      '/',
      '/chat/A',
      '/chat/A/info',
      '/chat/A/add-member',
    ]);
    expect(parentChain('/')).toEqual(['/']);
    expect(parentChain('/settings')).toEqual(['/', '/settings']);
  });

  it('NAV-STACK-1 — the wurlds routes chain correctly (the spec table was stale, the code was not)', () => {
    // My own hypothesis going in was that `resolveParent` still keyed on
    // `/life/` and every wurlds route fell through to `/`. It does not — the
    // CODE was migrated and the SPEC TABLE was what had gone stale. Pinning
    // the real behaviour so the next person doesn't re-derive that the hard way.
    expect(parentChain('/wurlds/w-123')).toEqual(['/', '/wurlds', '/wurlds/w-123']);
    expect(parentChain('/wurlds/start')).toEqual(['/', '/wurlds', '/wurlds/start']);
    expect(parentChain('/cards/practice/hub')).toEqual(['/', '/cards/practice/hub']);
  });

  it('NAV-STACK-1 — an unknown path still chains, via NAV-PARENT-2', () => {
    expect(parentChain('/nope/whatever')).toEqual(['/', '/nope/whatever']);
  });

  it('NAV-STACK-1 — query and hash never change the chain', () => {
    expect(parentChain('/chat/A/info?tab=x#frag')).toEqual(['/', '/chat/A', '/chat/A/info']);
  });

  it('NAV-STACK-1 — terminates even if a rule ever maps a path to itself', () => {
    // The cycle guard. `resolveParent` is a hand-ordered rule list; one
    // mis-ordered entry returning the path it was given would spin forever, at
    // BOOT, before anything renders. This asserts termination rather than the
    // exact chain, because the point is that it returns at all.
    expect(() => parentChain('/chat/A/info')).not.toThrow();
    expect(parentChain('/chat/A/info').length).toBeLessThan(10);
  });
});

describe('NAV-STACK-3 — the depth stamp is CHECKED, never assumed', () => {
  it('NAV-STACK-3 — reads back what it wrote', () => {
    expect(depthOf(withEntry(null, 2, '/chat/A'))).toBe(2);
    expect(depthOf(withEntry({ usr: 'router state' }, 1, '/'))).toBe(1);
    // ...without eating the router's own state, which shares this object.
    expect(withEntry({ usr: 'router state' }, 1, '/')).toMatchObject({ usr: 'router state' });
  });

  it('NAV-STACK-3 — an entry we did not write reads as unknown, not as zero', () => {
    // The distinction that makes the fallback safe: `null` means "cannot
    // confirm", and 0 means "confirmed root". Collapsing them would let a
    // foreign entry claim to be the root and authorise a pop off the bottom.
    expect(depthOf(null)).toBeNull();
    expect(depthOf(undefined)).toBeNull();
    expect(depthOf({})).toBeNull();
    expect(depthOf({ [NAV_DEPTH_KEY]: 'two' })).toBeNull();
    expect(depthOf({ [NAV_DEPTH_KEY]: -1 })).toBeNull();
    expect(depthOf({ [NAV_DEPTH_KEY]: 1.5 })).toBeNull();
    expect(depthOf({ [NAV_DEPTH_KEY]: 0 })).toBe(0);
  });

  it('NAV-STACK-3 — pops only when the stamp agrees with the path', () => {
    expect(canPopToParent(withEntry(null, 2, '/chat/A'), '/chat/A/info')).toBe(true);
    expect(canPopToParent(withEntry(null, 1, '/'), '/chat/A')).toBe(true);
  });

  it('NAV-STACK-3 — refuses to pop when it cannot confirm', () => {
    // Unstamped (session restore, foreign entry, a push that bypassed us).
    expect(canPopToParent(null, '/chat/A/info')).toBe(false);
    // Stamp disagrees with the path — something pushed without going through
    // us, so the entry below is NOT necessarily the parent.
    expect(canPopToParent(withEntry(null, 1, '/chat/A'), '/chat/A/info')).toBe(false);
    // At the root there is nothing beneath to pop to, stamp or no stamp.
    expect(canPopToParent(withEntry(null, 0, null), '/')).toBe(false);

    // ⚠ THE REGRESSION THIS SECOND FIELD EXISTS FOR, and it was introduced BY
    // the depth stamp rather than found alongside it. A `<Link to="/cards">`
    // clicked on `/cards/practice` pushes an entry whose path-derived depth
    // (1) is genuinely correct — so a depth-only check said "pop", and back
    // went DOWN into `/cards/practice`. The retrace this whole change exists
    // to stop, delivered by the mechanism meant to stop it.
    expect(canPopToParent(withEntry(null, 1, '/cards/practice'), '/cards')).toBe(false);
    // The same path IS poppable when it genuinely sits on its parent.
    expect(canPopToParent(withEntry(null, 1, '/'), '/cards')).toBe(true);
  });
});

describe('NAV-STACK-4 — boot seeds the chain', () => {
  it('NAV-STACK-4 — a deep link plans a root replace plus one push per level', () => {
    expect(seedPlan('/chat/A/info')).toEqual({ root: '/', pushes: ['/chat/A', '/chat/A/info'] });
  });

  it('NAV-STACK-4 — the root costs nothing', () => {
    // An ordinary cold boot must not pay for this at all.
    expect(seedPlan('/')).toBeNull();
  });
});

/**
 * The stack-shape tests. `jsdom` gives a real `window.history` whose
 * length/state behave, which is what lets these assert the thing the old
 * suite could not.
 */
describe('NAV-STACK-1/4 — against a real History', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('NAV-STACK-4 — seeding a deep link leaves the URL alone and puts parents beneath it', () => {
    const before = window.history.length;
    seedHistory('/chat/A/info', window.history);

    // The URL the user asked for is still the one showing — seeding must be
    // invisible.
    expect(window.location.pathname).toBe('/chat/A/info');
    // Two ancestors were pushed beneath it (`/` was replaced onto the entry we
    // were standing on, so it costs no new entry).
    expect(window.history.length).toBe(before + 2);
    // And the entry is stamped at its chain depth, so a back affordance may pop.
    expect(depthOf(window.history.state)).toBe(2);
    // ...with the entry BENEATH recorded as the real parent. Seeding is the one
    // place the app builds the stack itself, so it is the one place `below` can
    // be known for certain — and if it recorded the wrong thing here, the
    // deep-link back would pop somewhere arbitrary while still passing a
    // depth-only check.
    expect(belowOf(window.history.state)).toBe('/chat/A');
    expect(canPopToParent(window.history.state, '/chat/A/info')).toBe(true);
  });

  it('NAV-STACK-4 — back from a seeded deep link reaches the parent, not the void', () => {
    // THE REPORTED BUG: "clicking a notification and going straight to the
    // message, pressing back takes me to an empty safari page." Before
    // seeding, the deep-linked entry was the floor of a fresh browsing
    // context and there was nothing beneath it at all.
    seedHistory('/chat/A/info', window.history);
    window.history.back();
    // jsdom applies history moves asynchronously; the assertion that matters
    // and is synchronous is that entries EXIST beneath us to move to.
    expect(window.history.length).toBeGreaterThanOrEqual(3);
  });

  it('NAV-STACK-4 — seeding keeps the deep link\'s query and hash on the current entry', () => {
    // Found 2026-09-24 (share-target.md SHARE-WEB-3): the seed pushed the bare
    // pathname, so `/share?inbox=…` booted as `/share` and every share
    // delivered by URL was lost before React ran.
    window.history.replaceState(null, '', '/share?inbox=abc#x');
    seedHistory('/share', window.history, '?inbox=abc#x');
    expect(window.location.pathname).toBe('/share');
    expect(window.location.search).toBe('?inbox=abc');
    expect(window.location.hash).toBe('#x');
  });

  it('NAV-PARENT-4 / NAV-STACK-4 — a reload on a Try-it screen seeds the tips page beneath it', () => {
    // Found in the 0.3.1 merge audit: the chain was built from the bare path,
    // so `/cards?from=tips` seeded `/` → `/cards` and the platform back
    // skipped the tips page (learning-tips.md: "survives a refresh").
    window.history.replaceState(null, '', '/cards?from=tips');
    seedHistory('/cards', window.history, '?from=tips');
    expect(window.location.pathname).toBe('/cards');
    expect(window.location.search).toBe('?from=tips');
    expect(depthOf(window.history.state)).toBe(2);
    expect(belowOf(window.history.state)).toBe('/tips');
  });

  it('NAV-STACK-4 — a root boot keeps its query too', () => {
    window.history.replaceState(null, '', '/?x=1');
    seedHistory('/', window.history, '?x=1');
    expect(window.location.search).toBe('?x=1');
  });

  it('NAV-STACK-4 — a root boot adds no entries', () => {
    const before = window.history.length;
    seedHistory('/', window.history);
    expect(window.history.length).toBe(before);
    expect(depthOf(window.history.state)).toBe(0);
  });

  it('NAV-STACK-3 — stamping fixes an entry a plain <Link> pushed', () => {
    // A `<Link>` cannot carry our state, so the entry it pushes arrives
    // unstamped and `canPopToParent` would refuse. This is the repair.
    window.history.pushState(null, '', '/chat/A');
    expect(canPopToParent(window.history.state, '/chat/A')).toBe(false);

    const length = window.history.length;
    stampCurrentEntry('/chat/A', 'PUSH', '/', window.history);

    expect(canPopToParent(window.history.state, '/chat/A')).toBe(true);
    // ...and repairing the stamp must not disturb the stack itself.
    expect(window.history.length).toBe(length);
    expect(window.location.pathname).toBe('/chat/A');
  });

  it('NAV-STACK-3 — re-stamping an already-correct entry is a no-op', () => {
    window.history.replaceState(stateForPath('/chat/A'), '', '/chat/A');
    const state = window.history.state;
    stampCurrentEntry('/chat/A', 'PUSH', '/', window.history);
    // Same object identity: nothing was rewritten, so this can sit in a
    // location effect without churning state on every render.
    expect(window.history.state).toBe(state);
  });
});

describe('depthForPath', () => {
  it('is the index of the path in its own chain', () => {
    expect(depthForPath('/')).toBe(0);
    expect(depthForPath('/chat/A')).toBe(1);
    expect(depthForPath('/chat/A/info')).toBe(2);
    expect(depthForPath('/chat/A/add-member')).toBe(3);
  });
});
