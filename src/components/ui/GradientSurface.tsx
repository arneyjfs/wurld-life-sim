import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  children?: ReactNode;
  className?: string;
  /** Stable key used for subtle hue rotation so distinct surfaces look
   *  related but not identical. Pass null/undefined to use the
   *  canonical brand gradient (no variation). */
  seedKey?: string;
  style?: CSSProperties;
};

/**
 * Brand gradient — the same purple→pink linear gradient that ships on
 * the Practice / Send / Save CTAs (`--gradient-accent` in globals.css).
 * Previously a cropped PNG that picked a random patch per `seedKey`,
 * which made avatars look unrelated to each other and inconsistent
 * with the CTA gradient elsewhere.
 *
 * When `seedKey` is provided, a small per-key hue rotation (±20°) is
 * applied so a chat list of round avatars reads as "same family,
 * slightly different shade" rather than all-identical. Pass no
 * seedKey for the canonical CTA gradient.
 */
function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Curated palette of hue rotations applied on top of the brand
// purple→pink gradient. A continuous range hit muddy zones where one
// endpoint landed in orange and the other in yellow-green (a sludgy
// in-between), so we step instead. Each entry is a known-good shift
// that keeps the gradient saturated and reads as a distinct colour
// pair vs the others. Add or reorder freely; the only constraint is
// avoiding +100° .. +170° which traverses olive.
const HUE_ROTATIONS_DEG = [
  0,    // purple → pink (brand)
  30,   // magenta → red
  60,   // red → orange
  90,   // orange → yellow-orange
  -30,  // purple-blue → magenta
  -60,  // blue → purple
  -90,  // blue-cyan → blue
  -120, // cyan → blue
  -150, // green-cyan → cyan
  180,  // green → teal
];

function hueRotateDeg(seedKey: string): number {
  return HUE_ROTATIONS_DEG[hashString(seedKey) % HUE_ROTATIONS_DEG.length] ?? 0;
}

export function GradientSurface({
  children,
  className,
  seedKey,
  style,
}: Props) {
  const rotate = seedKey ? hueRotateDeg(seedKey) : 0;
  return (
    <div
      className={cn('relative overflow-hidden bg-gradient-accent', className)}
      style={{
        ...(rotate !== 0 ? { filter: `hue-rotate(${rotate}deg)` } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}
