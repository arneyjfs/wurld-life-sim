import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resolveParent } from '@/lib/navHierarchy';
import { canPopToParent, markAppInitiatedPop } from '@/lib/navStack';

/**
 * The single "back" action — NAV-BACK-1 / NAV-BACK-2 (docs/specs/navigation.md).
 *
 * The DESTINATION is always the hierarchy's (`resolveParent` of the current
 * path), never history's. What changed in 2026-09 is the MOVE:
 *
 *   - When NAV-STACK-3 can confirm the entry beneath us is that parent — the
 *     current entry carries a `navDepth` stamp matching its own chain depth —
 *     we POP. Under NAV-STACK-1 the stack IS the chain, so a pop and a climb
 *     are the same move, and popping is what keeps them the same move: it
 *     SHRINKS the stack, which `replace` never did.
 *   - Otherwise we fall back to `navigate(parent, { replace: true })`, the
 *     original NAV-BACK-1 behaviour. That covers a restored session, an entry
 *     pushed by something that bypassed us, and a user who arrived mid-stack.
 *     Always correct in destination, just not stack-shrinking.
 *
 * ⚠ WHY POPPING MATTERS AT ALL, since `replace` also lands on the parent:
 * `replace` rewrites the top entry and leaves the depth alone, so the browser's
 * stack keeps growing while the app believes it is being tidy. On iOS the
 * browser's stack IS the back button the user presses, and it was retracing
 * the way in — settings → chat → settings → chat. Landing on the right screen
 * was never the problem; leaving the stack the right SHAPE was.
 */
export function useAppBack(): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    // NAV-PARENT-4 — the search is part of what back reads (the tips marker).
    const here = location.pathname + location.search;
    const parent = resolveParent(here);
    if (!parent) return; // root: no-op (Android hardware exit lives in useAndroidBackButton)
    if (canPopToParent(window.history.state, here)) {
      // NAV-ANIM-9: raise BEFORE the pop. `navigate(-1)` dispatches
      // synchronously into the router, so a flag set afterwards would be read
      // too late and the arrow would lose its slide.
      markAppInitiatedPop(location.pathname, parent);
      navigate(-1);
      return;
    }
    navigate(parent, { replace: true });
  }, [navigate, location.pathname, location.search]);
}

/**
 * The parent path for the current location, for a back affordance that wants a
 * semantic `href` (right-click, open-in-new-tab, screen readers announcing a
 * destination).
 *
 * ⚠ A `<Link to={useParentPath()}>` is NOT a back affordance on its own — it
 * PUSHES, which is the defect NAV-BACK-2 exists to stop. 16 of the app's 19
 * back arrows were exactly that. Use `BackButton`, which renders the href for
 * semantics and calls `useAppBack` for the move.
 */
export function useParentPath(): string {
  const location = useLocation();
  return resolveParent(location.pathname + location.search) ?? '/';
}
