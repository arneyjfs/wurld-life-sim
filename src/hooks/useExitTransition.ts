import { useEffect, useRef, useState } from 'react';

/**
 * Symmetric enter / exit hook for conditionally-rendered components.
 *
 * React's "set state to false → unmount" pattern doesn't leave time for a
 * leave animation. This hook decouples the *logical* show/hide signal
 * (`visible`) from the *render* signal (`mounted`):
 *
 *  - On show: `mounted` flips to true SAME tick; `visible` follows on the
 *    next frame so any `animate-in` keyframes get a clean false→true
 *    transition.
 *  - On hide: `visible` flips to false immediately so exit keyframes start
 *    playing; `mounted` is kept true for `durationMs` so the element stays
 *    in the DOM long enough to finish animating, then unmounts.
 *
 * Usage:
 *   const { mounted, visible } = useExitTransition(openProp, 200);
 *   if (!mounted) return null;
 *   return <div className={visible ? 'enter-classes' : 'exit-classes'}>…
 *
 * The two booleans give the consumer freedom to pick its own enter / exit
 * classes (or inline styles). Animation classes from tailwindcss-animate
 * compose cleanly here — `animate-in` styles run on mount, `animate-out`
 * styles run when `visible` flips to false.
 *
 * Caveats:
 *  - `durationMs` should match the longest CSS animation on the exit
 *    classes. Too short → element snaps away mid-animation. Too long →
 *    blocked from re-opening cleanly.
 *  - If `open` flips back to true while still in the exit timeout, we
 *    cancel the timeout and remount the visible state — the hook never
 *    leaves the element half-unmounted.
 *  - The hook is unaware of `prefers-reduced-motion`. Consumers that care
 *    should pass a `durationMs` of 0 in that case (which collapses to a
 *    synchronous mount/unmount).
 */
export function useExitTransition(
  open: boolean,
  durationMs: number,
): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);
  const timeoutRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Synchronizing render state with an external open/close signal that
  // we don't control. set-state-in-effect is the right shape here:
  // mount/visible flips are downstream of `open`. The rule's purpose is
  // to discourage cascading renders driven by self-derived state, which
  // is the opposite of this use case.
  useEffect(() => {
    if (open) {
      // Cancel any pending unmount from a recent close.
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      // Defer the visible=true flip a frame so the element can mount in
      // its hidden state first. Without this the enter animation is
      // skipped because the same render commits both mount and final
      // state.
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setVisible(true);
      });
      return;
    }
    // Closing: kick off the exit immediately, schedule the unmount.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setVisible(false);
    if (durationMs <= 0) {
      setMounted(false);
      return;
    }
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setMounted(false);
    }, durationMs);
  }, [open, durationMs]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { mounted, visible };
}
