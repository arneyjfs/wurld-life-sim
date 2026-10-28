import { useId } from 'react';

/**
 * The Wurld Plus mark (SETTINGS-PLAN-1, owner's pick 2026-10-21): a
 * brand-gradient disc carrying two white stacked chevrons, the "rank up"
 * shape, so it reads in any language. Drawn inline so it scales crisply from a 12px badge to a hero.
 * Used only on Settings' plan badge until the owner signs it off; spreading
 * it to other surfaces (other users in lists) is a separate decision.
 */
export function WurldPlusMark({ size = 16, className }: { size?: number; className?: string }) {
  // One gradient id per instance: two marks on one page must not share it.
  const gradientId = `wurld-plus-${useId().replace(/:/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      data-testid="wurld-plus-mark"
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-gradient-accent-start)" />
          <stop offset="1" stopColor="var(--color-gradient-accent-end)" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill={`url(#${gradientId})`} />
      <path
        d="M7.4 12.4L12 8.4L16.6 12.4M7.4 16.4L12 12.4L16.6 16.4"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
