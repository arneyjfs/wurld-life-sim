import { ArrowLeft } from 'lucide-react';
import { useAppBack, useParentPath } from '@/hooks/useAppBack';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';

type Props = {
  /** Extra classes for the tap target. The icon size is fixed. */
  className?: string;
  /** Override the label when a screen needs something more specific than
   *  "Back" for a screen reader. Defaults to `common.back`. */
  label?: string;
};

/**
 * THE back affordance — NAV-BACK-2 (docs/specs/navigation.md).
 *
 * ⚠ THIS COMPONENT EXISTS BECAUSE BEING RIGHT WAS NOT ENOUGH.
 * `useAppBack` was written, specified and unit-tested, and 3 of the app's 19
 * back arrows called it. The other 16 were hand-rolled
 * `<Link to="/chat/{id}">` — each landing on the correct screen and each
 * PUSHING a duplicate of the parent onto history, which turned the stack into
 * a palindrome around the cursor so every platform back press retraced the way
 * in: settings → chat → settings → chat, exactly as reported. Nothing caught
 * it, because a `<Link>` that lands on the right path looks right in review,
 * in a pathname assertion, and on screen.
 *
 * So the rule is no longer "call the hook" — it is "render this component".
 * A hand-rolled back arrow is a defect, and there is a lint rule saying so.
 *
 * ── WHY IT IS AN <a> AND NOT A <button> ────────────────────────────────────
 *
 * The `href` is real, so right-click / long-press / open-in-new-tab / "where
 * does this go" all work and a screen reader announces a destination. But the
 * click is intercepted: `<Link>`'s own navigation is a PUSH, which is the
 * whole defect. `preventDefault` + `useAppBack` gives the semantics of a link
 * with the stack behaviour of a back. Modified clicks (⌘/ctrl/shift/middle)
 * are deliberately NOT intercepted, so "open the parent in a new tab" keeps
 * working — a back arrow that swallowed ⌘-click would be a worse link than
 * the one it replaced.
 */
export function BackButton({ className, label }: Props) {
  const t = useT();
  const back = useAppBack();
  const parent = useParentPath();

  return (
    <a
      href={parent}
      data-testid="nav-back"
      aria-label={label ?? t('common.back')}
      className={cn('p-1 -ml-1 text-(--color-fg)', className)}
      onClick={(e) => {
        // Let the browser handle anything that means "open elsewhere".
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        back();
      }}
    >
      <ArrowLeft size={20} />
    </a>
  );
}
