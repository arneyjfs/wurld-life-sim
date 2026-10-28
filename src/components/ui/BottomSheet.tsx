import { type ReactNode } from 'react';
import { Drawer as Vaul } from 'vaul';
import { isComposerFocused } from '@/lib/composerFocus';
import { cn } from '@/lib/cn';
import { useOverlayBack } from '@/hooks/useOverlayBack';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Title for screen readers — always required for vaul's a11y. */
  ariaLabel: string;
  /**
   * Optional description for screen readers. Defaults to nothing (rendered
   * empty + sr-only). vaul logs a warning if Description is omitted.
   */
  ariaDescription?: string;
  children: ReactNode;
  /**
   * Centred / fixed-width footprint on tablet+ (default `sm:max-w-md`). Pass
   * a custom Tailwind chain to override (e.g. `sm:max-w-sm` for compact
   * confirms).
   */
  desktopWidthClass?: string;
  /**
   * Bottom-sheet body classes (applied to the inner Content element after
   * the standard rounded-top + safe-area + bg). Use for `max-h-*` caps and
   * per-instance layout tweaks.
   */
  className?: string;
  /**
   * How the sheet reacts to the soft keyboard.
   *
   * - `'pad'` (default) — `.pb-keyboard` + `.max-h-sheet`. For a sheet with
   *   an input at its BOTTOM (ExplainModal's composer footer), which really
   *   does have to clear the keyboard.
   * - `'none'` — COMP-KB-21. No compensation at all, definite height, and
   *   vaul's own `repositionInputs` turned OFF. For a sheet whose input is at
   *   the TOP and is therefore already clear.
   *
   * The lift mode that used to live here was removed 2026-07-31: on a
   * platform that already shrinks the viewport it double-compensated and
   * floated the sheet a keyboard-height too high.
   */
  keyboardInset?: 'pad' | 'none';
  /**
   * z-index Tailwind class for both overlay + content. Defaults to the
   * standard modal layer (`z-(--z-modal)`).
   */
  zClass?: string;
  /**
   * Show the rounded grab handle at the top of the sheet (only meaningful
   * on touch). Defaults to true.
   */
  showHandle?: boolean;
  /**
   * COMP-KB-25.2 — called inside the tap on the backdrop that closes the
   * sheet (a real tap, so a focus made here can raise the iOS keyboard).
   */
  onOverlayTap?: () => void;
};

/**
 * Swipe-to-dismiss bottom sheet built on `vaul`. Mirrors the pattern from
 * `ReactorListModal` (gold standard for this app's sheets):
 *
 *   • Mobile (< sm): drags from the bottom; flick or 25 % drag dismisses.
 *   • Desktop (>= sm): pinned to viewport centre with rounded corners, no
 *     drag handle, and vaul's overshoot pad suppressed (UI-DESKTOP-1).
 *   • Inner scrollable content (anything with `overflow-y: auto`) keeps
 *     ownership of vertical pointer gestures until scroll-top is reached.
 *     vaul walks the pointer-target ancestry on each drag-start; if a
 *     scrollable parent has `scrollTop > 0`, the drag becomes a scroll.
 *     Once scrollTop hits 0, the next downward swipe drags the sheet.
 *
 * The sheet is always portaled and includes vaul's required `Title` /
 * `Description` for a11y. The provided `ariaLabel` becomes the SR-only
 * title; the optional `ariaDescription` populates the description slot.
 */
export function BottomSheet({
  open,
  onClose,
  ariaLabel,
  ariaDescription,
  children,
  desktopWidthClass = 'sm:max-w-md',
  className,
  keyboardInset = 'pad',
  zClass = 'z-(--z-modal)',
  showHandle = true,
  onOverlayTap,
}: Props) {
  // NAV-OVERLAY-2 — the Android back button closes an open sheet (every sheet
  // and ConfirmDialog in the app is this primitive) before it leaves the page.
  useOverlayBack(open, onClose);
  return (
    <Vaul.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      // COMP-KB-21 — the SECOND writer, and the one the CSS could not reach.
      // vaul defaults `repositionInputs` to true, which installs its own
      // `visualViewport.resize` handler; while an input is focused that
      // handler writes `style.bottom = <keyboard height>px` and an inline
      // `style.height` directly onto this element. Inline styles beat every
      // class, so `.kb-none` removing all `--kb-h` terms from OUR stylesheet
      // left the sheet lifted a keyboard-height off the floor exactly as
      // before — the owner's "the padding behind the keyboard is still
      // there", arriving from a source the invariant had not accounted for.
      //
      // Off for `'none'` only. `'pad'` (ExplainModal's bottom composer) keeps
      // vaul's behaviour untouched — it is a different shape of sheet and
      // changing it is not this rule's business.
      //
      // Cost, accepted: `repositionInputs: false` also disables vaul's
      // `usePreventScroll` — they share one `isDisabled` expression, so there
      // is no way to keep the lock and drop the repositioning. Both of that
      // lock's jobs are already covered here: `html`/`body` are pinned to
      // `overflow: hidden` at a fixed height on every web runtime (globals.css,
      // "Web-only viewport lock"), so there is no window scroll to prevent;
      // and its window-scroll snap-back on input focus is what COMP-KB-10's
      // rAF loop in `keyboardInset.ts` does unconditionally, on every runtime,
      // whether or not a sheet is open.
      repositionInputs={keyboardInset !== 'none'}
      dismissible
    >
      <Vaul.Portal>
        <Vaul.Overlay
          className={cn('fixed inset-0 bg-(--color-scrim)', zClass)}
          onClick={
            onOverlayTap
              ? () => {
                  onOverlayTap();
                  onClose();
                }
              : undefined
          }
        />
        <Vaul.Content
          // COMP-KB-25.2 — with `onOverlayTap`, the backdrop closes the sheet
          // on the CLICK (end of the tap), not on pointerdown: the overlay is
          // gone from hit-testing once the sheet starts closing, so a
          // pointerdown close would leave no tap to raise the keyboard in.
          onPointerDownOutside={onOverlayTap ? (e) => e.preventDefault() : undefined}
          // COMP-KB-25.4 — if the chat composer holds focus as the sheet
          // closes (a keyboard return), do not move focus back to the
          // sheet's trigger: that would drop the keyboard again.
          onCloseAutoFocus={(e) => {
            if (isComposerFocused()) e.preventDefault();
          }}
          className={cn(
            'fixed inset-x-0 bottom-0 flex flex-col outline-none',
            zClass,
            'bg-(--color-bg-elevated) text-(--color-fg)',
            'rounded-t-2xl shadow-2xl',
            // `.pb-keyboard` (composer.md COMP-KB-3 / COMP-IMG-4):
            // `max(--kb-h + 0.5rem, env(keyboard-inset-height) + 0.5rem,
            //      safe-area-inset-bottom, 0.5rem)`
            // → safe-area when keyboard is DOWN (same as the old
            //   `pb-[max(safe-bottom,1rem)]` for the menu/contact/
            //   language-picker consumers);
            // → kb-h + 0.5rem when keyboard is UP — covers the
            //   ExplainModal case (a composer footer inside the
            //   sheet) which previously had to put `pb-keyboard` on
            //   its OWN footer, double-stacking with the outer's
            //   safe-area pad and pushing the composer ~34px above
            //   the keyboard top.
            // COMP-KB-21 — `'none'` takes NEITHER of these: no keyboard
            // padding, and (below) no keyboard term in the height cap.
            keyboardInset === 'none' ? 'kb-none' : 'pb-keyboard',
            // COMP-IMG-5 — keyboard-aware height cap. NOT a fixed 85dvh: the
            // keyboard overlays the viewport rather than shrinking it, so a
            // fixed cap makes `.pb-keyboard` above spend the sheet's own
            // content height on clearing the keyboard. See globals.css.
            // `.kb-none` carries its own DEFINITE height (COMP-KB-21), and
            // `.max-h-sheet` has a `--kb-h` term — so only the padded mode
            // takes this. Applying both would size the same box twice.
            keyboardInset === 'none' ? '' : 'max-h-sheet',
            'sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-full',
            desktopWidthClass,
            'sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
            // ⚠ The grab handle was providing the top margin by accident. It is
            // `sm:hidden`, so on desktop the content began flush against the
            // card's top edge and the title read as jammed into the corner.
            // Owner, 2026-09-21: *"dialogues need more padding around the top
            // on desktop."* `sm:`-only, because the phone still has the handle
            // and padding there would double up.
            'sm:pt-4',
            // UI-DESKTOP-1 — kill vaul's overshoot pad on desktop. vaul paints
            // `::after { top: 100%; height: 200%; background: inherit }` under
            // the drawer so an over-drag on touch never reveals the page
            // behind it. On mobile that pad lives below the viewport and is
            // invisible; centred on desktop it hangs beneath the card as an
            // opaque rectangle running to the bottom edge. Desktop-only, so
            // the drag it protects is untouched.
            'sm:after:hidden',
            className,
          )}
          data-testid="BottomSheet-content"
        >
          <Vaul.Title className="sr-only">{ariaLabel}</Vaul.Title>
          <Vaul.Description className="sr-only">
            {ariaDescription ?? ariaLabel}
          </Vaul.Description>
          {showHandle && (
            <div
              data-testid="BottomSheet-handle"
              className="mx-auto mt-2 mb-1 h-1 w-10 rounded-full bg-(--color-border-strong) shrink-0 sm:hidden"
            />
          )}
          {children}
        </Vaul.Content>
      </Vaul.Portal>
    </Vaul.Root>
  );
}
