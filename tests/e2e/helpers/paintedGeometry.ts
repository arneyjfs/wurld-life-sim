/**
 * Bubble geometry as the user SEES it: sampled at the end of a rendering
 * update, after ChatScroll's ResizeObserver has compensated.
 *
 * `getBubbleViewportTop` (helpers/scroll.ts) reads `getBoundingClientRect`
 * synchronously, which forces a layout of whatever the DOM holds RIGHT NOW.
 * If a React commit resized bubbles since the last rendering update, that
 * layout is one the browser never paints: ChatScroll's RO compensation for
 * it runs in the NEXT update, before that update's paint. On headless
 * webkit-mobile under the emulator harness rendering updates were measured
 * 300–800ms apart, so a sample can land in that unpainted state, twice in a
 * row, and read as "stable" (see docs/specs/chat-scroll.md, Test methodology:
 * painted-state sampling).
 *
 * How: wait for the next animation frame, then observe a fresh 1×1 probe
 * with a NEW ResizeObserver. A new observation is delivered in that same
 * update's RO broadcast, after the app's observer (created earlier, so it
 * runs earlier) has written its compensation and the landing-lock pin, and
 * before paint. Reading geometry there gives the painted position.
 */
import type { Page } from '@playwright/test';
import { SCROLLER_FINDER } from './scroll';

/** Viewport-relative top of a bubble as painted; `null` if not mounted. */
export async function getBubbleViewportTopPainted(
  page: Page,
  messageId: string,
): Promise<number | null> {
  return page.evaluate(
    ({ id, finder }) =>
      new Promise<number | null>((resolve, reject) => {
        requestAnimationFrame(() => {
          const probe = document.createElement('div');
          probe.style.cssText =
            'position:fixed;left:0;top:0;width:1px;height:1px;visibility:hidden;pointer-events:none';
          document.body.appendChild(probe);
          const ro = new ResizeObserver(() => {
            ro.disconnect();
            probe.remove();
            try {
              // eslint-disable-next-line no-new-func
              const scroller = new Function('return ' + finder)() as HTMLElement;
              const node = scroller.querySelector(`[data-message-id="${id}"]`);
              resolve(
                node
                  ? (node as HTMLElement).getBoundingClientRect().top -
                      scroller.getBoundingClientRect().top
                  : null,
              );
            } catch (err) {
              reject(err);
            }
          });
          ro.observe(probe);
        });
      }),
    { id: messageId, finder: SCROLLER_FINDER },
  );
}
