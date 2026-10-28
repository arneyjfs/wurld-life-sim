import { useEffect, useState, type RefObject } from 'react';
import { isInputLike } from '@/lib/keyboardController';
import { useKeyboardState } from './useKeyboardState';

/**
 * COMP-KB-22 / AUTH-SIGN-IN-9 — keep whichever text field inside `fieldsRef`
 * holds focus clear of the keyboard, by scrolling the container that holds
 * them (the nearest `[data-lift-scroller]`, which may be `fieldsRef` itself): never the
 * document (COMP-KB-10 owns the window scroll while a keyboard opens), never
 * smoothly, and only by the distance still missing, so a pass over a field
 * that is already clear does nothing. Re-runs on each settled keyboard height,
 * plus once 300ms later because `.pb-keyboard` transitions its padding (the
 * room may not exist yet on the first pass). The scroller needs
 * `.pb-keyboard` (or equivalent room) for the lift to have somewhere to go.
 *
 * Taking the fields rather than the scroller lets a lazy chunk own the hook
 * while an eager frame owns the scroller (BOOT-SPLIT-5's entry budget).
 */
export function useLiftFocusedField(fieldsRef: RefObject<HTMLElement | null>): void {
  const kb = useKeyboardState();
  const [field, setField] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const port = fieldsRef.current;
    if (!port) return;
    const onIn = (e: FocusEvent) => {
      if (isInputLike(e.target)) setField(e.target as HTMLElement);
    };
    const onOut = (e: FocusEvent) => {
      setField((current) => (current === e.target ? null : current));
    };
    port.addEventListener('focusin', onIn);
    port.addEventListener('focusout', onOut);
    return () => {
      port.removeEventListener('focusin', onIn);
      port.removeEventListener('focusout', onOut);
    };
  }, [fieldsRef]);

  useEffect(() => {
    if (!field || !kb.visible) return;
    const align = () => {
      const port = fieldsRef.current?.closest<HTMLElement>('[data-lift-scroller]');
      if (!port || !field.isConnected) return;
      const portBox = port.getBoundingClientRect();
      const fieldBox = field.getBoundingClientRect();
      // The keyboard overlays the layout viewport rather than shrinking it
      // (COMP-KB-1), so the edge that matters is whichever comes first.
      const keyboardTop = window.innerHeight - kb.height;
      const below = fieldBox.bottom - Math.min(portBox.bottom, keyboardTop);
      const above = portBox.top - fieldBox.top;
      const delta = below > 0 ? below : above > 0 ? -above : 0;
      if (delta === 0) return;
      port.scrollTop += delta;
    };
    align();
    const settle = window.setTimeout(align, 300);
    return () => window.clearTimeout(settle);
  }, [field, kb.visible, kb.height, fieldsRef]);
}
