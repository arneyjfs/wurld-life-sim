/**
 * COMP-KB-23 — the "composer buttons don't steal focus" rule, as one thing.
 *
 * Spec: docs/specs/composer.md §4 (COMP-KB-23), and COMP-KB-5 / COMP-SEND-5
 * for the two instances that have extra rules of their own.
 *
 * ## What it does
 *
 * Tapping a focusable control moves focus to it, which blurs the composer
 * textarea. COMP-KB-16 forces `--kb-h` to 0 whenever nothing input-like holds
 * focus and COMP-KB-7 is its fast path, firing 50ms after the blur — so ANY
 * focus move off the textarea closes the soft keyboard mid-message.
 * `preventDefault` on the pointer-down pair suppresses ONLY that focus-steal:
 * the synthesized `click` still fires, so every `onClick` behaves as before.
 *
 * ## Why BOTH events
 *
 * `onPointerDown` alone is a known-insufficient guard, and COMP-KB-5's own
 * history is the evidence — pointerdown-only was the 2026-06-16 fix for the
 * Send button and it later stopped holding the keyboard up. On iOS WebKit the
 * focus move rides the *synthesized* `mousedown` that follows `touchend`,
 * which a default-prevented `pointerdown` does not stop.
 *
 * ## Why a shared spread rather than two inline lines per call site
 *
 * The failure this rule repairs is half-application. `ReplyPreviewBar`'s
 * Cancel-✕ is the precedent COMP-KB-5 cited for itself, and it still carries
 * `onPointerDown` only — the mousedown half was never propagated back. A
 * spread cannot be half-applied; two hand-written lines can, and were.
 *
 * ## Where it belongs — and where it does NOT
 *
 * Only on a **composer-adjacent** control: reachable while the composer holds
 * focus AND leaving the user on the composing surface once it has acted. A
 * control that navigates away, opens a sheet, or ends the compose mode has no
 * keyboard worth preserving — see COMP-KB-23's roster and its exclusions
 * (Manage, See Plus, the header's phone / avatar / ⋮ menu, Cancel-edit).
 *
 * Spread it onto the element that RECEIVES THE TAP, which is not always the
 * element that draws the control: COMP-SEND-5 grows the Send button's hit box
 * past its visual circle, and a guard on the inner circle would leave the new
 * ring unguarded — a bigger version of the bug rather than a fix.
 */

/** Structurally typed so this module stays React-free; every React
 *  pointer/mouse event satisfies it, so the spread type-checks on any
 *  intrinsic element. */
function suppressFocusSteal(e: { preventDefault: () => void }): void {
  e.preventDefault();
}

export const preventComposerFocusSteal = {
  onPointerDown: suppressFocusSteal,
  onMouseDown: suppressFocusSteal,
};
