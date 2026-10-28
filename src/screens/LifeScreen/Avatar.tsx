/**
 * LIFE-BUBBLE-*: placeholder avatar component for the dialogue
 * window. Phase A/B renders an initials circle in a colour derived
 * from the name (so an NPC stays the same hue across turns even
 * without a generated SVG yet). Phase C swaps this for a real
 * Gemini-rendered SVG via the `svgUrl` prop — until then, leaving
 * `svgUrl` undefined falls back to the initials circle.
 *
 * Spec: docs/specs/life-sim.md §9.
 */
import { UserRound } from 'lucide-react';
import { cn } from '@/lib/cn';

type Props = {
  /** Display name — first letter becomes the initial. */
  name: string;
  /** When set, renders the generated SVG instead of the initial.
   *  (Phase C wiring; no callers pass this yet.) */
  svgUrl?: string | null;
  /** LIFE-NPC-2: the avatar SVG is still generating (`avatarStatus:
   *  'pending'`). Show a person icon under a shimmer instead of the
   *  initials, so the slot reads as "loading" rather than final. Ignored
   *  once `svgUrl` lands. */
  loading?: boolean;
  /** Reserves a slot but doesn't render anything (so layouts stay
   *  aligned next to bubbles that DO have an avatar). */
  invisible?: boolean;
  /** When set, the avatar becomes a tap target — opens a larger-view
   *  modal. Callers (DialogueArea) wire it to a modal opener. */
  onTap?: () => void;
  className?: string;
};

/** Lightweight hash → palette index for a per-name stable colour.
 *  Same name → same colour every turn. */
function paletteIndex(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) & 0x7fffffff;
  }
  return h % PALETTE.length;
}

const PALETTE = [
  'bg-purple-200 text-purple-800',
  'bg-orange-200 text-orange-800',
  'bg-teal-200 text-teal-800',
  'bg-pink-200 text-pink-800',
  'bg-blue-200 text-blue-800',
  'bg-amber-200 text-amber-800',
  'bg-green-200 text-green-800',
  'bg-rose-200 text-rose-800',
];

export function Avatar({ name, svgUrl, loading = false, invisible = false, onTap, className }: Props) {
  if (invisible) {
    return <span className={cn('block w-8 h-8 shrink-0', className)} aria-hidden />;
  }
  const tapProps = onTap
    ? {
        onClick: onTap,
        role: 'button' as const,
        tabIndex: 0,
        'aria-label': name,
        className: cn('cursor-pointer hover:opacity-80 transition-opacity'),
      }
    : { 'aria-hidden': true as const };
  if (svgUrl) {
    return (
      <span
        {...tapProps}
        className={cn(
          'block w-8 h-8 shrink-0 rounded-full overflow-hidden bg-(--color-bg-elevated)',
          tapProps.className,
          className,
        )}
      >
        <img
          src={svgUrl}
          alt=""
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </span>
    );
  }
  if (loading) {
    // LIFE-NPC-2: avatar SVG still generating — a person icon under a
    // shimmer sweep (the parent's rounded-full + overflow-hidden clips the
    // `.skeleton-block` gradient to the circle; the icon sits on top).
    return (
      <span
        {...tapProps}
        aria-busy
        data-testid="LifeScreen-Avatar-Loading"
        className={cn(
          'relative inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-full overflow-hidden bg-(--color-bg-elevated) text-(--color-fg-muted)',
          tapProps.className,
          className,
        )}
      >
        <UserRound size={16} className="relative z-10 opacity-70" />
        <span className="absolute inset-0 skeleton-block" aria-hidden />
      </span>
    );
  }
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      {...tapProps}
      className={cn(
        'inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-full font-bold text-sm',
        PALETTE[paletteIndex(name)],
        tapProps.className,
        className,
      )}
    >
      {initial}
    </span>
  );
}
