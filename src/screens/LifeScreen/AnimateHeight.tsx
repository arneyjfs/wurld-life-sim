/**
 * LIFE-UI-ANIM: animates its own height to track its content's natural height,
 * so when the bottom panel swaps phase (options → question → feedback) or the
 * option grid gains/loses a row, the height change GLIDES instead of snapping.
 * Because the panel sits under the flex-1 scene area, gliding the panel height
 * makes the dialogue bubbles stacked ABOVE it move up/down gradually — the jar
 * this component exists to remove.
 *
 * Measured via ResizeObserver: iOS WKWebView has no reliable transition on CSS
 * `height:auto`, so we transition an explicit measured pixel height. Disabled
 * (renders children untouched) when `enabled` is false — e.g. the ✏️ composer
 * is open and the soft keyboard drives its own height, which we must not fight —
 * and under reduced motion. The first measure lands WITHOUT a transition so the
 * panel doesn't animate up from zero on mount.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from './nodeEngineGlide';

const HEIGHT_MS = 220;

export function AnimateHeight({
  enabled = true,
  children,
}: {
  enabled?: boolean;
  children: ReactNode;
}) {
  // ResizeObserver must exist (jsdom's no-op stub never fires, so height stays
  // null and we render children untouched — inert + safe in unit tests).
  const active =
    enabled && !prefersReducedMotion() && typeof ResizeObserver !== 'undefined';
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || !active) return;
    // setState only from the observer callback (a genuine external-system
    // subscription — never synchronously in the effect body). ResizeObserver
    // also delivers one callback on observe(), which lands the first height.
    const ro = new ResizeObserver(() => {
      const next = el.offsetHeight;
      setHeight((prev) => (prev === next ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);

  return (
    <div
      // First application is auto → Npx, which can't transition (auto is not
      // interpolable) so it lands without animating; subsequent Npx → Mpx
      // changes glide.
      style={
        active && height != null
          ? { height, overflow: 'hidden', transition: `height ${HEIGHT_MS}ms ease-out` }
          : undefined
      }
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}
