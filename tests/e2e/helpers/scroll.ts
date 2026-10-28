/**
 * Scroll-position helpers for chat-list specs.
 *
 * The chat list is a normal-direction `flex flex-col` scroll
 * container. Visual bottom = `scrollTop = scrollHeight − clientHeight`
 * (the browser's max scrollTop). All "at visual bottom" checks use a
 * 2px tolerance.
 *
 * Helpers operate on the FIRST scrollable ancestor of the first
 * MessageBubbleSurface, matching the chat list's actual scroller.
 * Pages without a chat mounted will throw a clear error from inside
 * the evaluated callback.
 */
import type { Page } from '@playwright/test';

const AT_BOTTOM_TOLERANCE_PX = 2;
const VIEWPORT_POSITION_TOLERANCE_PX = 2;

// Inlined into every page.evaluate so we don't have to thread a function
// reference across the bridge. Kept short on purpose. Must begin with
// `(` so callers that wrap it as `new Function('return ' + finder)`
// don't get bitten by ASI (the `return` and the IIFE must stay on the
// same line, or JS inserts a semicolon after the bare `return`).
//
// Uses `[data-message-id]` (the per-message wrapper div) as the
// starting point rather than `[data-testid="MessageBubbleSurface"]`
// because some bubble states (translating shimmer, deleted-for-everyone
// tombstone) don't render the surface element but DO render the
// wrapper. Either way the scrollable ancestor is the same.
const FIND_SCROLLER = /* js */ `(() => {
    const anchor = document.querySelector('[data-message-id]')
      || document.querySelector('[data-testid="MessageBubbleSurface"]');
    let el = anchor;
    while (el) {
      const style = window.getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') return el;
      el = el.parentElement;
    }
    throw new Error('scroll container not found');
  })()`;

/** Exported so gesture helpers in sibling files can target the same scroller. */
export const SCROLLER_FINDER = FIND_SCROLLER;

// The same traversal as a BOOLEAN, derived from the finder rather than written
// out again — two copies of this walk would drift.
const SCROLLER_EXISTS = /* js */ `(() => { try { return !!${FIND_SCROLLER}; } catch { return false; } })()`;

/**
 * Wait until the chat scroller is mounted and anchored by at least one message.
 *
 * ⚠ Why a WAIT and not a bare probe. `FIND_SCROLLER` starts from
 * `[data-message-id]`, so it throws the moment the list renders no messages —
 * and `ChatScreen` renders exactly that on purpose: `loading` false plus
 * `messagesReady` false (its one-frame `requestAnimationFrame` deferral, which
 * paints the shell before the heavy list) yields a header, a composer and an
 * empty placeholder with no spinner. A one-shot probe landing in that window
 * fails with "scroll container not found" against a page that is perfectly
 * healthy a frame later. That is how the `@critical` gate's
 * `vocab-style growth on a NON-tail bubble` test failed intermittently: the
 * probe ran after a multi-second quiet-wait, by which point the list had
 * re-rendered empty for a frame.
 *
 * ⚠ This cannot mask a real regression. A list that is genuinely missing never
 * appears, so the wait times out and the test still fails — just with an
 * honest error instead of a race.
 */
export async function waitForScroller(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction(SCROLLER_EXISTS, undefined, { timeout: timeoutMs });
}

/** Raw scrollTop. Prefer `getDistanceFromVisualBottom` for assertions. */
export async function getScrollTop(page: Page): Promise<number> {
  return page.evaluate(`(${FIND_SCROLLER}).scrollTop`) as Promise<number>;
}

/**
 * Distance in pixels from the visual bottom. 0 = at bottom, larger =
 * scrolled up. Convention-agnostic: detects the layout axis from the
 * scroller's COMPUTED flex-direction so it is correct on both the regular
 * column and the column-reverse (NEGATIVE-up) port.
 *   - column-reverse: scrollTop 0 = visual bottom, negative toward older →
 *     distance = -scrollTop.
 *   - column: distance = (scrollHeight - clientHeight) - scrollTop.
 */
export async function getDistanceFromVisualBottom(page: Page): Promise<number> {
  return page.evaluate(
    `(() => {
      const el = ${FIND_SCROLLER};
      if (getComputedStyle(el).flexDirection === 'column-reverse') {
        return Math.max(0, -el.scrollTop);
      }
      const max = el.scrollHeight - el.clientHeight;
      return Math.max(0, max - el.scrollTop);
    })()`,
  ) as Promise<number>;
}

/** True iff the chat scroller is laid out column-reverse (the CR port). */
export async function isColumnReverse(page: Page): Promise<boolean> {
  return page.evaluate(
    `getComputedStyle(${FIND_SCROLLER}).flexDirection === 'column-reverse'`,
  ) as Promise<boolean>;
}

/** True iff visually pinned to bottom (within 2px tolerance). */
export async function isAtVisualBottom(page: Page): Promise<boolean> {
  const d = await getDistanceFromVisualBottom(page);
  return d <= AT_BOTTOM_TOLERANCE_PX;
}

export async function getScrollContainerRect(
  page: Page,
): Promise<{ top: number; height: number; left: number; width: number }> {
  // Every caller of this helper is measuring a scroller it expects to be there;
  // none asserts its absence. So the wait belongs here rather than at each of
  // the ~20 call sites. See `waitForScroller` for why a bare probe races.
  await waitForScroller(page);
  // The READER'S viewport: the box less its bottom padding. Since COMP-KB-24
  // the scroller runs on under the composer and the keyboard, which reach it
  // as padding; the app's viewport rules (centre, halves, below-the-viewport)
  // measure the visible part, so tests measuring "the viewport" do too.
  return page.evaluate(
    `(() => { const el = ${FIND_SCROLLER}; const r = el.getBoundingClientRect(); const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0; return { top: r.top, height: r.height - pad, left: r.left, width: r.width }; })()`,
  ) as Promise<{ top: number; height: number; left: number; width: number }>;
}

/**
 * Viewport-relative top of a specific message bubble. Returns `null` if
 * the message isn't mounted in the DOM. "Viewport" here = the scroll
 * container's box.
 */
export async function getBubbleViewportTop(
  page: Page,
  messageId: string,
): Promise<number | null> {
  return page.evaluate(
    ({ id, finder }) => {
      // eslint-disable-next-line no-new-func
      const scroller = new Function('return ' + finder)() as HTMLElement;
      const node = scroller.querySelector(`[data-message-id="${id}"]`);
      if (!node) return null;
      return (
        (node as HTMLElement).getBoundingClientRect().top -
        scroller.getBoundingClientRect().top
      );
    },
    { id: messageId, finder: FIND_SCROLLER },
  );
}

/**
 * Viewport-relative BOTTOM of a specific message bubble. Returns
 * `null` if not mounted. Useful for "bubble's bottom edge stays put
 * across a height change" assertions (e.g. SCROLL-INV-1 bubble flip).
 */
export async function getBubbleViewportBottom(
  page: Page,
  messageId: string,
): Promise<number | null> {
  return page.evaluate(
    ({ id, finder }) => {
      // eslint-disable-next-line no-new-func
      const scroller = new Function('return ' + finder)() as HTMLElement;
      const node = scroller.querySelector(`[data-message-id="${id}"]`);
      if (!node) return null;
      return (
        (node as HTMLElement).getBoundingClientRect().bottom -
        scroller.getBoundingClientRect().top
      );
    },
    { id: messageId, finder: FIND_SCROLLER },
  );
}

/** Real message bubbles only — system rows (the loader header, date
 *  separators, the footer/gutter slots) all carry `data-message-id`
 *  prefixed with `__`. */
const REAL_BUBBLE_SELECTOR = '[data-message-id]:not([data-message-id^="__"])';

/**
 * Returns the `data-message-id` of the bubble whose CENTER sits
 * closest to the given viewport-y. Use this to grab "the bubble the
 * user is currently looking at" before a trigger, then re-locate it
 * after to assert it hasn't moved.
 *
 * SYSTEM ROWS ARE EXCLUDED, and under column-reverse that is the
 * difference between measuring drift and measuring the layout. The
 * always-mounted loader header sits at the VISUAL TOP in CR — exactly
 * where a `y = 30` topmost-visible watch looks — and it is the one row
 * a loadOlder prepend legitimately moves by the full inserted height,
 * because the new content lands between it and the reader. Watching it
 * reports ~360px of "drift" for a load that held the reading position
 * perfectly.
 */
export async function getBubbleIdNearViewportY(
  page: Page,
  y: number,
): Promise<string | null> {
  return page.evaluate(
    ({ targetY, finder, sel }) => {
      // eslint-disable-next-line no-new-func
      const scroller = new Function('return ' + finder)() as HTMLElement;
      const scrollerTop = scroller.getBoundingClientRect().top;
      const nodes = Array.from(scroller.querySelectorAll<HTMLElement>(sel));
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const node of nodes) {
        const id = node.getAttribute('data-message-id');
        if (!id) continue;
        const r = node.getBoundingClientRect();
        const top = r.top - scrollerTop;
        const center = top + r.height / 2;
        const dist = Math.abs(center - targetY);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = id;
        }
      }
      return bestId;
    },
    { targetY: y, finder: FIND_SCROLLER, sel: REAL_BUBBLE_SELECTOR },
  );
}

/**
 * The `data-message-id` of the VISUALLY bottom-most real bubble — the
 * one whose bottom edge sits lowest in the scroller.
 *
 * Geometry, not DOM order, because the two disagree: the scroller runs
 * `flex-direction: column-reverse`, so `items` render newest-first and
 * the LAST DOM node is the OLDEST message, thousands of pixels above the
 * fold. A `nodes[nodes.length - 1]` pick lands there, and a test that
 * then grows it and asserts "its bottom edge stayed put" is measuring a
 * bubble the compensation rules classify as `above-viewport-drift-comp`
 * — a different rule from the one under test.
 */
export async function getBottomMostBubbleId(page: Page): Promise<string | null> {
  return page.evaluate(
    ({ finder, sel }) => {
      // eslint-disable-next-line no-new-func
      const scroller = new Function('return ' + finder)() as HTMLElement;
      let bestId: string | null = null;
      let bestBottom = -Infinity;
      for (const node of Array.from(scroller.querySelectorAll<HTMLElement>(sel))) {
        const id = node.getAttribute('data-message-id');
        if (!id) continue;
        const bottom = node.getBoundingClientRect().bottom;
        if (bottom > bestBottom) {
          bestBottom = bottom;
          bestId = id;
        }
      }
      return bestId;
    },
    { finder: FIND_SCROLLER, sel: REAL_BUBBLE_SELECTOR },
  );
}

/**
 * Wheel the scroll container by the given delta (Y only). Positive
 * deltaY = scroll toward visual bottom (newer content). Negative
 * deltaY = scroll toward visual top (older content).
 *
 * Routes by input modality (audit WS-7 follow-up, 2026-06-12):
 *   - touch context (webkit-mobile / iPhone 13 emulation): `mouse.wheel`
 *     THROWS in mobile WebKit ("Mouse wheel is not supported"), so we
 *     dispatch a real touch swipe via `swipeScroller` — which also
 *     exercises the touch listeners (useScrollTopWriter queue
 *     invalidation, useJsMomentum touchend gate, the WS-1 mount-quiet
 *     gate) that desktop wheel can't.
 *   - desktop (chromium): page-level `mouse.wheel` as before.
 */
export async function wheelScroller(page: Page, deltaY: number): Promise<void> {
  if (await isTouchContext(page)) {
    await swipeScroller(page, deltaY);
    return;
  }
  const rect = await getScrollContainerRect(page);
  await page.mouse.move(rect.left + rect.width / 2, rect.top + rect.height / 2);
  await page.mouse.wheel(0, deltaY);
}

/** True on touch-capable contexts (the webkit-mobile E2E project). */
export async function isTouchContext(page: Page): Promise<boolean> {
  return page.evaluate(
    () => navigator.maxTouchPoints > 0 || 'ontouchstart' in window,
  );
}

/**
 * Touch-swipe the scroll container by `deltaY` (same sign convention as
 * `wheelScroller`). Dispatches a real touchstart → touchmove(s) →
 * touchend sequence on the scroller AND advances scrollTop across the
 * move — synthetic touch events don't drive native scrolling in WebKit,
 * so we move the position ourselves while the app's touch listeners see
 * a genuine gesture (touchend timestamp feeds useJsMomentum's
 * continuation gate; touchstart invalidates the write queue).
 *
 * Works on desktop too (constructors are standard), but `wheelScroller`
 * only routes here on touch contexts.
 */
export async function swipeScroller(page: Page, deltaY: number): Promise<void> {
  const rect = await getScrollContainerRect(page);
  await page.evaluate(
    ({ dy, finder, cx, cy }) => {
      // eslint-disable-next-line no-new-func
      const el = new Function('return ' + finder)() as HTMLElement;
      const makeTouch = (x: number, y: number): Touch => {
        try {
          return new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
        } catch {
          // Pre-constructor WebKit fallback — a plain object satisfies
          // the listeners we care about (they read .clientY at most).
          return { identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y } as unknown as Touch;
        }
      };
      const fire = (type: string, x: number, y: number, ending: boolean) => {
        const t = makeTouch(x, y);
        let ev: Event;
        try {
          ev = new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: ending ? [] : [t],
            targetTouches: ending ? [] : [t],
            changedTouches: [t],
          });
        } catch {
          // A real TouchEvent always carries the three touch lists; app
          // listeners read `e.touches.length` (useKeyboardDismissGesture), so
          // the fallback must too or it throws on every swipe in WebKit.
          ev = new Event(type, { bubbles: true, cancelable: true });
          const list = (items: Touch[]) => Object.assign(items.slice(), { item: (i: number) => items[i] ?? null });
          Object.defineProperties(ev, {
            touches: { value: list(ending ? [] : [t]) },
            targetTouches: { value: list(ending ? [] : [t]) },
            changedTouches: { value: list([t]) },
          });
        }
        el.dispatchEvent(ev);
      };
      // Compute the clamped target by letting the BROWSER clamp the write —
      // convention-agnostic, so it's correct for NEGATIVE-up column-reverse
      // (scrollTop ∈ [-(scrollHeight-clientHeight), 0]) as well as a regular
      // column ([0, scrollHeight-clientHeight]). The previous explicit
      // `Math.max(0, Math.min(max, startTop+dy))` clamp assumed a positive
      // range, so in CR it pinned EVERY swipe-up to 0 (the visual bottom): the
      // webkit-mobile touch path (chromium uses a native wheel and dodges this)
      // never actually scrolled up — the deterministic SCROLL-INV-3/4 webkit
      // failures.
      const startTop = el.scrollTop;
      el.scrollTop = startTop + dy; // browser clamps to the valid range
      const endTop = el.scrollTop;
      el.scrollTop = startTop; // rewind before replaying the stepped gesture
      // Finger moves OPPOSITE to content: scrolling down (dy>0) = swipe up.
      const STEPS = 5;
      fire('touchstart', cx, cy, false);
      for (let i = 1; i <= STEPS; i += 1) {
        const f = i / STEPS;
        el.scrollTop = startTop + (endTop - startTop) * f;
        fire('touchmove', cx, cy - dy * f, false);
      }
      el.scrollTop = endTop;
      fire('touchend', cx, cy - dy, true);
    },
    { dy: deltaY, finder: FIND_SCROLLER, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 },
  );
}

/**
 * Programmatically set scrollTop on the scroll container. Use sparingly
 * — most tests should drive scroll via wheel events to exercise the
 * real user-input code path.
 */
export async function setScrollTop(page: Page, value: number): Promise<void> {
  await page.evaluate(
    ({ v, finder }) => {
      // eslint-disable-next-line no-new-func
      const el = new Function('return ' + finder)() as HTMLElement;
      // Synthetic wheel first: these helpers EMULATE user scrolling,
      // and ChatScroll's WS-1 mount-quiet gate only arms pagination
      // after real user input (wheel/touch/key). Direction matches
      // the move so intent-sensitive listeners read it correctly.
      el.dispatchEvent(
        new WheelEvent('wheel', { deltaY: v - el.scrollTop, bubbles: true, cancelable: true }),
      );
      el.scrollTop = v;
    },
    { v: value, finder: FIND_SCROLLER },
  );
}

/**
 * Programmatically scroll to the visual bottom. Equivalent to writing
 * `scrollTop = scrollHeight` (the browser clamps to max).
 */
export async function scrollToVisualBottom(page: Page): Promise<void> {
  await page.evaluate(
    `(() => { const el = ${FIND_SCROLLER}; el.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, bubbles: true, cancelable: true })); el.scrollTop = el.scrollHeight; })()`,
  );
}

/**
 * Programmatically scroll UP from the bottom by N pixels. Useful for
 * setting up "user is scrolled up by ~N px" preconditions without
 * driving wheel events.
 */
export async function scrollUpFromBottom(
  page: Page,
  pixels: number,
): Promise<void> {
  await page.evaluate(
    ({ p, finder }) => {
      // eslint-disable-next-line no-new-func
      const el = new Function('return ' + finder)() as HTMLElement;
      // Synthetic wheel — see setScrollTop for why (WS-1 gate).
      el.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -p, bubbles: true, cancelable: true }),
      );
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = Math.max(0, max - p);
    },
    { p: pixels, finder: FIND_SCROLLER },
  );
}

/**
 * Mimic the user wheeling UP by N pixels: dispatch a real `wheel`
 * event on the scroll container (so useStayAtVisualBottom's wheel
 * listener flips `wasAtBottom` to false synchronously) AND
 * programmatically move scrollTop. More reliable than
 * `page.mouse.wheel()` which is targeted at the page-level mouse
 * position; in serial test runs the prior page's mouse position can
 * land outside the scroll container after a `page.goto`.
 */
export async function scrollUpWithIntent(
  page: Page,
  pixels: number,
): Promise<void> {
  await page.evaluate(
    ({ p, finder }) => {
      // eslint-disable-next-line no-new-func
      const el = new Function('return ' + finder)() as HTMLElement;
      // Synthetic wheel event so the hook's listener (which only
      // flips wasAtBottom on real user input) sees an upward wheel.
      el.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -p,
          bubbles: true,
          cancelable: true,
        }),
      );
      // Scrolling UP toward older content is `scrollTop - p` in BOTH layouts,
      // but the valid clamp range differs by axis:
      //   - column (normal): scrollTop ∈ [0, scrollHeight-clientHeight].
      //   - column-reverse (the shipped CR architecture): scrollTop 0 = visual
      //     bottom, NEGATIVE toward older → range [-(scrollHeight-clientHeight), 0].
      // The old single `Math.max(0, …)` clamp silently snapped any negative
      // (i.e. every column-reverse scroll-up) back to 0 — a no-op — so the
      // "scrolled up, not at bottom" setup never held. Branch on flex-direction.
      const max = el.scrollHeight - el.clientHeight;
      const target = el.scrollTop - p;
      el.scrollTop =
        getComputedStyle(el).flexDirection === 'column-reverse'
          ? Math.min(0, Math.max(-max, target))
          : Math.max(0, Math.min(max, target));
    },
    { p: pixels, finder: FIND_SCROLLER },
  );
}

export const SCROLL_TOLERANCE = {
  atBottomPx: AT_BOTTOM_TOLERANCE_PX,
  viewportPositionPx: VIEWPORT_POSITION_TOLERANCE_PX,
};

/**
 * Dump the ChatScroll trace (last 500 events) as a structured JSON
 * string. Returns null when the trace is disabled (production build)
 * or unavailable (chat not mounted yet).
 *
 * Use this from a spec's `afterEach` when the test fails — attach the
 * dump to the test report so post-hoc analysis has the full scroll
 * timeline.
 */
export async function dumpScrollTrace(page: Page): Promise<string | null> {
  const result = await page.evaluate(() => {
    const buf = (window as unknown as {
      __chatScrollTrace?: { dump(): string };
    }).__chatScrollTrace;
    return buf ? buf.dump() : null;
  });
  return result;
}

/**
 * Clear the ChatScroll trace ring buffer. Call from `beforeEach` so
 * each test gets a clean trace without leftover events from the
 * previous test's setup.
 */
export async function clearScrollTrace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const buf = (window as unknown as {
      __chatScrollTrace?: { clear(): void };
    }).__chatScrollTrace;
    buf?.clear();
  });
}

/**
 * Per-bubble RO growth entries recorded in the trace ring since the
 * last clearScrollTrace(). Each entry is one bubble's height delta in
 * one ResizeObserver pass, with the anchor rule the unified RO
 * callback applied to it (`anchor-top` / `anchor-bottom` /
 * `above-viewport-drift-comp` / `below-viewport-skip`) and whether a
 * scrollTop compensation write was issued for it.
 *
 * Lets SCROLL-INV-2 tests implement the refined design rule's
 * accounting instead of asserting zero movement: background
 * translation churn legitimately shifts the reading position when an
 * in-viewport lower-half bubble grows (anchor-bottom holds the grown
 * bubble's bottom, moving every row above it up by delta). A test
 * that knows the watched bubble's position can compute the EXACT
 * spec-sanctioned shift and assert the measured drift matches it.
 */
export type RoGrowthEntry = {
  t: number;
  /** Index of the RO pass (trace event) the entry belongs to, in order. */
  pass: number;
  id: string;
  delta: number;
  oldTop: number;
  oldBottom: number;
  rule: string;
  compensated: boolean;
  /** The pass's compensation write landed this far from its target
   *  (`after − target`): the writer clamps into the scroll range, so at the
   *  visual top a write can fall short. 0 when it landed exactly or there
   *  was no write. */
  writeShortfall?: number;
};

/** A trace-ring event as `window.__chatScrollTrace.events` holds it. */
export type ScrollTraceEvent = { t: number; kind: string; label: string; data?: unknown };

const RO_COMP_WRITES = new Set(['ro-anchor-comp', 'ro-pin-reading-row']);

/**
 * Pure: the RO growth entries in a list of trace events, one `pass` per
 * `ro:growth` event, each carrying the shortfall of that pass's compensation
 * write (the next `ro-anchor-comp` / `ro-pin-reading-row` write before the
 * following pass). Use it on a ring read in the same task as a position.
 */
export function roGrowthEntriesFromEvents(events: ScrollTraceEvent[]): RoGrowthEntry[] {
  const out: RoGrowthEntry[] = [];
  let pass = -1;
  let passStart = 0;
  let shortfallSeen = true;
  for (const e of events) {
    if (e.kind === 'ro' && e.label === 'growth') {
      pass += 1;
      passStart = out.length;
      shortfallSeen = false;
      const gs = (e.data as { growths?: Array<Omit<RoGrowthEntry, 't' | 'pass'>> } | undefined)?.growths ?? [];
      for (const g of gs) {
        out.push({ t: e.t, pass, id: g.id, delta: g.delta, oldTop: g.oldTop, oldBottom: g.oldBottom, rule: g.rule, compensated: g.compensated, writeShortfall: 0 });
      }
      continue;
    }
    if (!shortfallSeen && e.kind === 'write' && RO_COMP_WRITES.has(e.label)) {
      shortfallSeen = true;
      const d = e.data as { target?: number; after?: number } | undefined;
      const shortfall = typeof d?.target === 'number' && typeof d?.after === 'number' ? d.after - d.target : 0;
      for (let k = passStart; k < out.length; k++) out[k]!.writeShortfall = shortfall;
    }
  }
  return out;
}

export async function getRoGrowthEntries(page: Page): Promise<RoGrowthEntry[]> {
  const events = await page.evaluate(() => {
    const buf = (window as unknown as { __chatScrollTrace?: { events: Array<{ t: number; kind: string; label: string; data?: unknown }> } }).__chatScrollTrace;
    return buf?.events ?? [];
  });
  return roGrowthEntriesFromEvents(events);
}

/**
 * The spec-sanctioned viewport shift of a bubble whose top sat at
 * `watchedTopPx`, given the RO growth entries recorded across the
 * measurement window (SCROLL-INV-2 refined design rule, 2026-06-09, and
 * SCROLL-INV-2.1 for multi-bubble passes off the bottom).
 *
 * Column-reverse (bottom-anchored), one pass at a time:
 *  - LAYOUT: every grower at or below the watched bubble (oldTop ≥ its
 *    top, the watched bubble included — its own growth lifts its top)
 *    lifts it by delta.
 *  - WRITE: the pass writes `scrollTop -= Σ delta` over its COMPENSATED
 *    entries, which moves every row, the watched one included, down by
 *    that sum. In per-bubble mode those are the `below-viewport-skip` and
 *    `anchor-top` growers; in SCROLL-INV-2.1 pin mode they are the rows at
 *    or below the pinned reading row. Both are recorded as `compensated`.
 *  So per pass: shift = −Σ_{oldTop ≥ top} delta + Σ_{compensated} delta.
 *  - CLAMP: when the writer clamped that write into the scroll range (the
 *    reader at the visual top), scrollTop landed `writeShortfall` further
 *    toward newer, which lifts every row by that much.
 *
 * Passes are applied in order and the watched top is carried forward,
 * because each pass's entries are measured against the viewport as the
 * previous pass left it (a height transition spreads one reflow over many
 * passes). With `watchedId`, a pass in which the watched bubble itself
 * resized re-reads its top from its own entry.
 *
 * The regular-column branch is the original, top-anchored accounting.
 */
export function sanctionedShiftFor(
  watchedTopPx: number,
  growths: RoGrowthEntry[],
  columnReverse = false,
  watchedId?: string,
): number {
  if (!columnReverse) {
    let shift = 0;
    for (const g of growths) {
      if (!g.compensated && g.oldBottom <= watchedTopPx + 2) shift += g.delta;
      if (g.compensated && g.oldTop >= watchedTopPx - 2) shift -= g.delta;
    }
    return shift;
  }
  const passes = new Map<number, RoGrowthEntry[]>();
  for (const g of growths) {
    const list = passes.get(g.pass) ?? [];
    list.push(g);
    passes.set(g.pass, list);
  }
  let top = watchedTopPx;
  let total = 0;
  for (const pass of [...passes.keys()].sort((a, b) => a - b)) {
    const entries = passes.get(pass)!;
    const own = watchedId ? entries.find((g) => g.id === watchedId) : undefined;
    if (own) top = own.oldTop;
    let shift = 0;
    for (const g of entries) {
      if (g.oldTop >= top - 2) shift -= g.delta;
      if (g.compensated) shift += g.delta;
    }
    shift -= entries[0]?.writeShortfall ?? 0;
    total += shift;
    top += shift;
  }
  return total;
}

/**
 * Wait until the rendered message WINDOW (membership, not heights) has
 * stopped changing for `stableMs`. The signature is `count|firstId|lastId`
 * of the real (non-`__`) `[data-message-id]` nodes.
 *
 * Why this exists separately from `waitForScrollerQuiet`: the live-tail
 * Firestore listener emits snapshots for a while after navigate (pending
 * serverTimestamps resolving). Most are no-ops, but an occasional one
 * SHIFTS the `limit(50)` tail (CASE 5 LIVE-TAIL-SHIFT) and evicts/loads
 * messages. A test that pins to a single anchor bubble across a transition
 * must wait for that membership to settle, or its anchor can vanish from
 * the DOM mid-measurement. `waitForScrollerQuiet` keys on scroll WRITES,
 * which a membership shift may not always produce on a compensated edge —
 * this polls the membership directly, so it's the right tool when the
 * concern is "will my chosen bubble still be loaded."
 */
export async function waitForMessageWindowStable(
  page: Page,
  opts: { stableMs?: number; maxWaitMs?: number } = {},
): Promise<void> {
  const stableMs = opts.stableMs ?? 500;
  const maxWaitMs = opts.maxWaitMs ?? 6_000;
  const sig = () =>
    page.evaluate(() => {
      const nodes = document.querySelectorAll(
        '[data-message-id]:not([data-message-id^="__"])',
      );
      const ids = Array.from(nodes).map(
        (n) => (n as HTMLElement).dataset.messageId,
      );
      return `${ids.length}|${ids[0] ?? ''}|${ids[ids.length - 1] ?? ''}`;
    });
  const start = Date.now();
  let prev = await sig();
  let stableSince = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await page.waitForTimeout(100);
    const cur = await sig();
    if (cur === prev) {
      if (Date.now() - stableSince >= stableMs) return;
    } else {
      prev = cur;
      stableSince = Date.now();
    }
  }
}

/**
 * Wait until the chat scroller has been QUIET for `quietMs` — no
 * `ro growth` or `write` events recorded in the trace ring. Use this
 * before measuring viewport positions in tests where pre-existing
 * bubbles can still be growing in the background (translation
 * pipeline tail, image decode). Falls back to a hard `maxWaitMs`
 * ceiling so a slow test doesn't hang.
 *
 * Returns the timestamp of the last activity event seen; useful for
 * tests that want to assert nothing happened in their measurement
 * window.
 */
/**
 * Wait until the scroller's `scrollTop` stops moving.
 *
 * The gap `waitForScrollerQuiet` cannot cover: that one watches the trace
 * buffer for `write` / `ro growth` events, i.e. things the APP did. A wheel is
 * something the BROWSER does, and it leaves no trace entry — so a pending
 * wheel is invisible to it.
 *
 * `page.mouse.wheel()` dispatches the event and returns; the scroll is applied
 * a frame or more later. A test that wheels and then immediately measures can
 * therefore read a baseline that is one wheel-delta stale, and the difference
 * shows up later as "drift" attributed to whatever the test was actually
 * measuring. That is exactly how chat-scroll SCROLL-INV-2 failed
 * intermittently with `drift 400px` — one wheel of -400, landing just after
 * the baseline read.
 *
 * Settling is measured in FRAMES, not milliseconds, and the ceiling is
 * deliberately low. Wheel application takes a frame or two; anything that
 * needs a network round-trip (a loadOlder page + its restore) cannot finish
 * inside this window. So this waits out the input without also waiting out —
 * and thereby hiding — the behaviour under test.
 */
export async function waitForScrollSettled(
  page: Page,
  opts: { stableFrames?: number; maxWaitMs?: number } = {},
): Promise<number> {
  const stableFrames = opts.stableFrames ?? 3;
  const maxWaitMs = opts.maxWaitMs ?? 600;
  return page.evaluate(`new Promise((resolve) => {
    const el = ${FIND_SCROLLER};
    const start = performance.now();
    let last = el.scrollTop;
    let same = 0;
    const tick = () => {
      const now = el.scrollTop;
      same = now === last ? same + 1 : 0;
      last = now;
      if (same >= ${stableFrames} || performance.now() - start >= ${maxWaitMs}) {
        resolve(now);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })`) as Promise<number>;
}

export async function waitForScrollerQuiet(
  page: Page,
  opts: { quietMs?: number; maxWaitMs?: number } = {},
): Promise<number> {
  const quietMs = opts.quietMs ?? 500;
  const maxWaitMs = opts.maxWaitMs ?? 5_000;
  return page.evaluate(
    ({ quiet, max }) => {
      return new Promise<number>((resolve) => {
        const start = performance.now();
        const tick = () => {
          const buf = (window as unknown as {
            __chatScrollTrace?: { events: Array<{ t: number; kind: string; label: string }> };
          }).__chatScrollTrace;
          const events = buf?.events ?? [];
          // SCROLL-FIXTURE-2 — what counts as activity, and what "quiet" means.
          //
          // Two defects, and together they made this helper report quiet while
          // the layout was still moving. Diagnosed from the `:588` trace on
          // webkit-mobile (~1-2 failures in 8):
          //
          //  (a) The scroller's OWN height was not activity. `ro scroller
          //      resize` is now counted. Mobile WebKit settles its viewport
          //      (`100dvh` + the composer inset) about a second after mount:
          //      `{prev: 757, cur: 708, delta: -49}`. A test that measures a
          //      bubble, injects growth, and re-measures across that settle
          //      sees the bubble move by the CONTAINER's delta — and the
          //      failure said exactly that, `-49px` against a 64px injection.
          //
          //  (b) `last === 0` resolved IMMEDIATELY. "Nothing has happened yet"
          //      was read as "everything has settled", so the caller's
          //      `quietMs` bought nothing at all on a page whose first write
          //      is still ahead of it. That is why the trace shows the test
          //      proceeding at ~2.6s and injecting at ~3.29s, straight into
          //      the 3.294s resize. The baseline is now the START OF THE WAIT,
          //      so `quiet` always means "nothing for quietMs from now", which
          //      is what every call site already assumed it meant.
          //
          // (a) alone does NOT fix it — measured, 2/8, no better — because at
          // wait time the resize is still in the future and there is nothing
          // to see. It is (b) that makes the window cover it.
          let last = 0;
          for (let i = events.length - 1; i >= 0; i--) {
            const e = events[i]!;
            if (
              e.kind === 'write' ||
              (e.kind === 'ro' && (e.label === 'growth' || e.label === 'scroller resize'))
            ) {
              last = e.t;
              break;
            }
          }
          // Never earlier than the moment we were called (see (b)).
          const since = performance.now() - Math.max(last, start);
          const elapsed = performance.now() - start;
          if (since >= quiet) {
            resolve(last);
          } else if (elapsed >= max) {
            resolve(last);
          } else {
            // Wait the remaining `quiet` window from the later of the last
            // event and the start of this wait.
            const remaining = Math.max(20, quiet - since);
            window.setTimeout(tick, remaining);
          }
        };
        tick();
      });
    },
    { quiet: quietMs, max: maxWaitMs },
  );
}
