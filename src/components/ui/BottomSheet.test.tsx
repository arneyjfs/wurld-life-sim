/**
 * UI-DESKTOP-1 — the shared bottom sheet on a desktop viewport.
 *
 * Spec: docs/specs/desktop.md — UI-DESKTOP-1.
 *
 * Every sheet in the app is this component, so a desktop defect here shows up
 * on all of them at once — which is exactly what happened with vaul's
 * overshoot pad. These tests assert the CLASS CONTRACT rather than computed
 * geometry: jsdom applies no stylesheet, so a layout assertion here would
 * pass against any markup at all. The rendered result is checked by eye in
 * the desktop screenshot review.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BottomSheet } from './BottomSheet';
import {
  __resetOverlayBackStackForTests,
  closeTopOverlay,
  overlayBackDepth,
} from '@/lib/overlayBackStack';

function content() {
  return screen.getByTestId('sheet-body').closest('[data-vaul-drawer]');
}

function renderSheet(props: Partial<Parameters<typeof BottomSheet>[0]> = {}) {
  render(
    <BottomSheet open onClose={() => {}} ariaLabel="Test sheet" {...props}>
      <div data-testid="sheet-body">body</div>
      <input data-testid="sheet-input" />
    </BottomSheet>,
  );
  return content();
}

/**
 * A `window.visualViewport` jsdom does not have. vaul reads it at mount and
 * subscribes to its `resize`, so it must exist BEFORE render.
 */
function installVisualViewport(height: number) {
  const vv = Object.assign(new EventTarget(), {
    height,
    width: 0,
    offsetTop: 0,
    offsetLeft: 0,
    pageTop: 0,
    pageLeft: 0,
    scale: 1,
  });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    writable: true,
    value: vv,
  });
  return {
    /** Shrink the visual viewport the way a soft keyboard does. */
    shrinkTo(next: number) {
      vv.height = next;
      act(() => {
        vv.dispatchEvent(new Event('resize'));
      });
    },
  };
}

describe('UI-DESKTOP-1 — BottomSheet on desktop', () => {
  it('suppresses vaul’s overshoot pad at sm and up', () => {
    // vaul paints `::after { top: 100%; height: 200% }` in the drawer's own
    // background so a mobile over-drag never reveals the page behind it.
    // Centred on desktop, that pad is no longer off-screen — it hangs below
    // the card as an opaque rectangle running to the viewport edge.
    expect(renderSheet()).toHaveClass('sm:after:hidden');
  });

  it('keeps the overshoot pad on mobile — it is doing a real job there', () => {
    // The guard that matters: the fix must be desktop-ONLY. An unprefixed
    // `after:hidden` would let the page show through under a dragged sheet.
    const el = renderSheet();
    expect(el).not.toHaveClass('after:hidden');
  });

  it('COMP-IMG-5 — caps its height so a long sheet scrolls instead of overflowing', () => {
    const el = renderSheet();
    expect(el).toHaveClass('max-h-sheet');
  });

  it('COMP-IMG-5 — the height cap is KEYBOARD-AWARE, not a fixed 85dvh', () => {
    // The cap and `.pb-keyboard` are one mechanism: the padding spends --kb-h
    // of the sheet's box clearing the keyboard, so the cap has to give that
    // height back or the content absorbs the shortfall. A fixed `85dvh`
    // collapsed the language picker's list to zero with the keyboard up.
    const el = renderSheet();
    expect(el).toHaveClass('pb-keyboard');
    expect(el).not.toHaveClass('max-h-[85dvh]');
  });

  it('hides the drag handle on desktop — there is nothing to drag', () => {
    renderSheet();
    expect(screen.getByTestId('BottomSheet-handle')).toHaveClass('sm:hidden');
  });

  it('honours the caller’s desktop width', () => {
    expect(renderSheet({ desktopWidthClass: 'sm:max-w-sm' })).toHaveClass(
      'sm:max-w-sm',
    );
  });
});

/**
 * COMP-KB-21 — "no compensation at all" has to hold against vaul too.
 *
 * `.kb-none` removes every `--kb-h` term from OUR stylesheet, and the CSS
 * tests in `globals.safeArea.test.ts` prove that. They cannot see the other
 * writer: vaul's `Root` defaults `repositionInputs` to true, and its own
 * `visualViewport.resize` handler writes `style.bottom = <keyboard height>px`
 * and an inline `style.height` straight onto the drawer element
 * (`node_modules/vaul/dist/index.mjs`, `onVisualViewportChange`). Inline
 * styles beat any class, so the sheet was still being lifted a keyboard-height
 * off the floor — the exact symptom COMP-KB-21 was written to kill, arriving
 * from a source the invariant had not accounted for.
 *
 * The `@standard` E2E cannot see it either: it drives the keyboard through
 * `window.__kb(px)` (COMP-KB-20), which sets the CSS variable and never
 * touches `visualViewport.height`, so vaul's handler never runs there.
 * These tests shrink the visual viewport itself, which is the signal vaul
 * actually listens to.
 */
describe('COMP-KB-21 — vaul’s own keyboard repositioning', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'visualViewport');
  });

  it('COMP-KB-21 — a keyboard-sized viewport shrink leaves NO inline offset on a `none` sheet', () => {
    const vv = installVisualViewport(window.innerHeight);
    const el = renderSheet({ keyboardInset: 'none' }) as HTMLElement;
    screen.getByTestId('sheet-input').focus();

    vv.shrinkTo(window.innerHeight - 320);

    // Asserted as an ABSENCE over both properties vaul writes, for the same
    // reason the CSS test is whole-rule: the lift came back once through
    // `padding-bottom` and once through `bottom`, and an inline `height` is
    // the third way to spend the same pixels.
    expect(el.style.bottom).toBe('');
    expect(el.style.height).toBe('');
  });

  it('COMP-KB-21 — the fix is SCOPED: the padded mode is left exactly as it was', () => {
    // Pinning existing behaviour, not endorsing it. `'pad'` is ExplainModal's
    // mode (a composer at the sheet's BOTTOM) and its keyboard handling is
    // owned by COMP-IMG-5 — this test exists so a future edit to the `'none'`
    // path cannot silently change it too.
    const vv = installVisualViewport(window.innerHeight);
    const el = renderSheet({ keyboardInset: 'pad' }) as HTMLElement;
    screen.getByTestId('sheet-input').focus();

    vv.shrinkTo(window.innerHeight - 320);

    expect(el.style.bottom).toBe('320px');
  });
});

/**
 * UI-DESKTOP — a sheet needs its own top breathing room on desktop.
 *
 * ⚠ **The grab handle was doing this by accident.** On a phone the handle sits
 * above the content and gives the sheet a visible top margin; on desktop it is
 * `sm:hidden`, so the content began flush against the card's top edge and the
 * title looked jammed into the corner. Owner, 2026-09-21: *"dialogues need more
 * padding around the top on desktop."*
 *
 * It is fixed HERE rather than in each consumer because every sheet in the app
 * inherits the same geometry, and the ones that look right on a phone are
 * exactly the ones that lost their spacing when the handle vanished.
 */
describe('UI-DESKTOP — top padding without the handle', () => {
  it('UI-DESKTOP — the content gets desktop-only top padding', () => {
    render(<BottomSheet open onClose={() => {}} ariaLabel="s"><p>body</p></BottomSheet>);
    expect(screen.getByTestId('BottomSheet-content').className).toContain('sm:pt-4');
  });

  it('UI-DESKTOP — and the phone keeps the handle doing the job', () => {
    // The padding is `sm:`-only on purpose: adding it unconditionally would
    // double up with the handle's own margin on the surface that was correct.
    render(<BottomSheet open onClose={() => {}} ariaLabel="s"><p>body</p></BottomSheet>);
    expect(screen.getByTestId('BottomSheet-handle')).toBeInTheDocument();
    expect(screen.getByTestId('BottomSheet-content').className).not.toContain(' pt-4');
  });
});

/**
 * NAV-OVERLAY-2 — every sheet built on BottomSheet is closable by the Android
 * back button, because the PRIMITIVE registers on the overlay back stack.
 *
 * Spec: docs/specs/navigation.md — NAV-OVERLAY-2.
 */
describe('NAV-OVERLAY-2 — BottomSheet registers on the overlay back stack', () => {
  afterEach(() => __resetOverlayBackStackForTests());

  it('NAV-OVERLAY-2 — a CLOSED sheet registers nothing', () => {
    render(<BottomSheet open={false} onClose={() => {}} ariaLabel="s"><p>body</p></BottomSheet>);
    expect(overlayBackDepth()).toBe(0);
  });

  it('NAV-OVERLAY-2 — an OPEN sheet registers, and back calls its onClose', () => {
    const onClose = vi.fn();
    render(<BottomSheet open onClose={onClose} ariaLabel="s"><p>body</p></BottomSheet>);
    expect(overlayBackDepth()).toBe(1);
    act(() => { closeTopOverlay(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('NAV-OVERLAY-2 — closing the sheet unregisters it', () => {
    const { rerender } = render(
      <BottomSheet open onClose={() => {}} ariaLabel="s"><p>body</p></BottomSheet>,
    );
    expect(overlayBackDepth()).toBe(1);
    rerender(<BottomSheet open={false} onClose={() => {}} ariaLabel="s"><p>body</p></BottomSheet>);
    expect(overlayBackDepth()).toBe(0);
  });
});
