import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Pointer } from 'lucide-react';
import { useShouldHintFlip, useLifeFlipHintStore } from '@/lib/life/lifeFlipHint';

/**
 * LIFE-LANG-16 — one-time "swipe to flip" coach-mark for the wurld dialogue.
 *
 * The bubbles default to practice-only (viewMode 'hidden') and flip to reveal
 * the native gloss with NO persistent button (chat-style — MSG-VIEW-3). This
 * layer teaches that gesture: an animated finger (the tutor tutorial's
 * `setup-pointer-swipe`, reduced-motion aware) hovers over the NEWEST bubble
 * that currently has a withheld gloss (`[data-life-flip-target]`), on the first
 * few occasions only (`useShouldHintFlip`). Portalled to <body>, position
 * fixed, `pointer-events: none` — it never blocks the tap/swipe it teaches.
 *
 * The rect is re-measured each frame (rAF) so the finger tracks the bubble as
 * beats glide in / the scene reflows. When no flippable-withheld bubble is on
 * screen (e.g. viewMode 'visible', or all bubbles already flipped) there is no
 * target, so the hint renders nothing.
 */

type Rect = { top: number; left: number; width: number; height: number };

const TARGET_SELECTOR = '[data-life-flip-target]';

/** Bottom-most on-screen match = the newest bubble in the bottom-anchored
 *  dialogue window. Zero-size (unrendered/jsdom) matches are skipped. */
function pickLast(els: Element[]): Element | null {
  let best: Element | null = null;
  let bestBottom = -Infinity;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.bottom > bestBottom) {
      best = el;
      bestBottom = r.bottom;
    }
  }
  return best;
}

function measure(el: Element): Rect | null {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function rectsDiffer(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a !== b;
  return (
    Math.abs(a.top - b.top) > 0.5 ||
    Math.abs(a.left - b.left) > 0.5 ||
    Math.abs(a.width - b.width) > 0.5 ||
    Math.abs(a.height - b.height) > 0.5
  );
}

export function LifeFlipHint() {
  const show = useShouldHintFlip();
  const recordShow = useLifeFlipHintStore((s) => s.recordShow);
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);

  // Count one "session shown" the first time the hint is eligible on this
  // mount — bounds the coach-mark to the first few wurld sessions even for a
  // player who never engages it (LIFE-LANG-16, MAX_SHOWS).
  useEffect(() => {
    if (show) recordShow();
    // Intentionally mount-only: recordShow is a stable store action and we want
    // exactly one show-credit per LifeScreen mount, not one per re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Ref-only reset (not a synchronous setState). While `show` is false the
    // render guard below returns null regardless of the stale `rect`, so no
    // finger flashes; the first rAF tick re-measures when it flips true.
    rectRef.current = null;
    if (!show) return;
    let raf = 0;
    const tick = () => {
      const el = pickLast(Array.from(document.querySelectorAll(TARGET_SELECTOR)));
      const next = el ? measure(el) : null;
      if (rectsDiffer(rectRef.current, next)) {
        rectRef.current = next;
        setRect(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [show]);

  if (!show || !rect) return null;

  const pad = 6;
  const style: CSSProperties = {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };

  return createPortal(
    <div
      aria-hidden
      className="setup-pointer"
      data-testid="LifeScreen-FlipHint"
      data-variant="swipe"
      style={style}
    >
      <span className="setup-pointer-swipe" role="presentation">
        <Pointer size={28} aria-hidden />
      </span>
    </div>,
    document.body,
  );
}
