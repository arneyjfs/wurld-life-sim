import type { Page } from '@playwright/test';
import { SCROLLER_FINDER, getScrollContainerRect } from './scroll';

/**
 * Finger-accurate touch drags over the chat scroller, for COMP-KB-6.
 *
 * Distinct from `swipeScroller` in `scroll.ts`: that helper's job is to MOVE
 * `scrollTop` (it fires a whole gesture in one `page.evaluate`, so every event
 * carries essentially the same `timeStamp`). COMP-KB-6 is a finger tracker that
 * reads travel AND velocity, so it needs:
 *
 *   - one `page.evaluate` per touch event, with real wall-clock gaps between
 *     them, or every drag looks like an infinitely fast flick;
 *   - the ability to hold the finger down (no `touchend`) so a test can assert
 *     the "armed but not yet committed" state;
 *   - the ability to reverse direction mid-gesture.
 *
 * Positive offsets move the finger DOWN the screen — the dismiss direction
 * (a bottom-anchored chat scrolls toward older messages).
 */

type TouchPhase = 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel';

/**
 * Source for a page-side touch factory, injected into `page.evaluate` as a
 * string because evaluate callbacks cannot close over module scope.
 *
 * **WebKit has no `Touch` constructor** — `new Touch({...})` throws
 * `TypeError: Illegal constructor`. It does still expose the legacy
 * `document.createTouch` / `createTouchList` factories, and its `TouchEvent`
 * constructor works. Chromium is the other way round: `new Touch` works and
 * `createTouch` does not exist.
 *
 * This mattered more than a compatibility footnote. Every COMP-KB-6 E2E case
 * begins with `canDispatchTouchEvents`, which was returning false on
 * webkit-mobile for this exact reason — so the first case failed at the guard
 * and `describe.serial` skipped the rest. The suite had NEVER run on the
 * engine it was written for. The guard did its job (a gesture test that cannot
 * dispatch gestures must fail loudly, not pass quietly); nothing was reading
 * what it said.
 */
const TOUCH_FACTORY = `
  function __mkTouch(target, x, y) {
    try {
      return new Touch({
        identifier: 1, target: target,
        clientX: x, clientY: y, pageX: x, pageY: y,
      });
    } catch (e) {
      // WebKit: legacy factory. (view, target, id, pageX, pageY, screenX, screenY)
      return document.createTouch(window, target, 1, x, y, x, y);
    }
  }
  function __mkList(touches) {
    try {
      if (document.createTouchList) return document.createTouchList.apply(document, touches);
    } catch (e) { /* fall through to the array form */ }
    return touches;
  }
`;


/** True when the browser can construct real TouchEvents with a touch list.
 *  A test that needs a genuine gesture must fail loudly rather than silently
 *  pass against events the app can't read. */
export async function canDispatchTouchEvents(page: Page): Promise<boolean> {
  return page.evaluate((factory) => {
    try {
      // eslint-disable-next-line no-new-func
      const { mk, list } = new Function(
        factory + 'return { mk: __mkTouch, list: __mkList };',
      )() as {
        mk: (t: EventTarget, x: number, y: number) => Touch;
        list: (t: Touch[]) => Touch[];
      };
      const t = mk(document.body, 0, 0);
      const ev = new TouchEvent('touchstart', {
        bubbles: true,
        touches: list([t]),
        targetTouches: list([t]),
        changedTouches: list([t]),
      });
      return !!ev.touches && ev.touches.length === 1;
    } catch {
      return false;
    }
  }, TOUCH_FACTORY);
}

async function fireTouch(
  page: Page,
  phase: TouchPhase,
  x: number,
  y: number,
): Promise<void> {
  const ending = phase === 'touchend' || phase === 'touchcancel';
  await page.evaluate(
    ({ finder, type, cx, cy, end, factory }) => {
      // eslint-disable-next-line no-new-func
      const el = new Function('return ' + finder)() as HTMLElement;
      // eslint-disable-next-line no-new-func
      const { mk, list } = new Function(
        factory + 'return { mk: __mkTouch, list: __mkList };',
      )() as {
        mk: (t: EventTarget, px: number, py: number) => Touch;
        list: (t: Touch[]) => Touch[];
      };
      const touch = mk(el, cx, cy);
      el.dispatchEvent(
        new TouchEvent(type, {
          bubbles: true,
          cancelable: true,
          touches: end ? list([]) : list([touch]),
          targetTouches: end ? list([]) : list([touch]),
          changedTouches: list([touch]),
        }),
      );
    },
    { finder: SCROLLER_FINDER, type: phase, cx: x, cy: y, end: ending, factory: TOUCH_FACTORY },
  );
}

/**
 * One finger position, as an offset from the drag's start point. A bare number
 * is a purely vertical offset (the common case); the object form adds sideways
 * travel, which COMP-KB-6.1 needs — the yield to the bubble swipe is decided on
 * the ratio of the two, so a helper that can only move on one axis cannot
 * express the gesture at all.
 */
export type DragPoint = number | { dx: number; dy: number };

const dxOf = (p: DragPoint) => (typeof p === 'number' ? 0 : p.dx);
const dyOf = (p: DragPoint) => (typeof p === 'number' ? p : p.dy);

export type DragOptions = {
  /** Fire `touchend` at the last offset. Set false to leave the finger down. */
  release?: boolean;
  /** Wall-clock gap between moves. Keep >= ~40ms so the app measures a SLOW
   *  drag; a smaller gap reads as a flick and commits on velocity alone. */
  stepDelayMs?: number;
};

/**
 * Where every drag starts: a third of the way down the scroller. Since
 * COMP-KB-24 the scroller runs on under the composer and the keyboard, and
 * COMP-KB-6's boundary is the composer's top, so the scroller's centre left
 * only 14–25px to cross: less than the fixtures' first step.
 */
export function dragStartY(rect: { top: number; height: number }): number {
  return rect.top + rect.height / 3;
}

/**
 * Drag from `dragStartY` (horizontally centred) through `fingerOffsets` (px below the start
 * point), one touchmove per entry, then optionally release.
 */
export async function touchDragScroller(
  page: Page,
  fingerOffsets: DragPoint[],
  opts: DragOptions = {},
): Promise<void> {
  const { release = true, stepDelayMs = 60 } = opts;
  const rect = await getScrollContainerRect(page);
  const cx = rect.left + rect.width / 2;
  const cy = dragStartY(rect);

  await fireTouch(page, 'touchstart', cx, cy);
  let last: DragPoint = 0;
  for (const offset of fingerOffsets) {
    await page.waitForTimeout(stepDelayMs);
    await fireTouch(page, 'touchmove', cx + dxOf(offset), cy + dyOf(offset));
    last = offset;
  }
  if (release) {
    await page.waitForTimeout(stepDelayMs);
    await fireTouch(page, 'touchend', cx + dxOf(last), cy + dyOf(last));
  }
}

/** Release a finger left down by `touchDragScroller(..., { release: false })`. */
export async function releaseTouch(page: Page, atOffset: number): Promise<void> {
  const rect = await getScrollContainerRect(page);
  await fireTouch(
    page,
    'touchend',
    rect.left + rect.width / 2,
    dragStartY(rect) + atOffset,
  );
}
