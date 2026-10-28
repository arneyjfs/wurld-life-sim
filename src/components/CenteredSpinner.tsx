import { cn } from '@/lib/cn';

type Props = {
  /** Optional label for screen readers — visually hidden. Defaults to "Loading". */
  label?: string;
  /** Pixel size of the spinner circle. Defaults to 28. */
  size?: number;
  /** Override or add classes on the centring wrapper. */
  className?: string;
};

/**
 * Vertically + horizontally centred loading indicator. Replaces the
 * "Loading…" text that previously appeared in the top-left of every
 * screen during its initial subscription resolve — that placement
 * tracked the eye but didn't communicate "the chrome is alive, just
 * waiting" the way a centered spinner does.
 *
 * Uses the same accent-coloured ring as the load-older spinner in
 * MessageList so the visual language stays consistent across the app.
 */
export function CenteredSpinner({ label = 'Loading', size = 28, className }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex-1 flex items-center justify-center min-h-0 w-full',
        className,
      )}
    >
      <span
        className="inline-block rounded-full border-2 border-(--color-fg-muted) border-t-transparent animate-spin"
        style={{ width: size, height: size }}
        aria-hidden
      />
      <span className="sr-only">{label}</span>
    </div>
  );
}
