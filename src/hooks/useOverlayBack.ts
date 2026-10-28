import { useEffect, useRef } from 'react';
import { registerOverlayBack } from '@/lib/overlayBackStack';

/**
 * NAV-OVERLAY-2 — while `open`, put this overlay's close on the overlay back
 * stack so the Android back button closes it instead of leaving the page
 * (docs/specs/navigation.md).
 *
 * `onClose` is read through a ref: a new identity on every render must NOT
 * re-register, or the overlay would jump above ones opened after it.
 * Pass the overlay's OWN cancel path (the same one its × / scrim uses), so a
 * guarded close stays guarded.
 */
export function useOverlayBack(open: boolean, onClose: () => void): void {
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    return registerOverlayBack(() => latest.current());
  }, [open]);
}
