/**
 * LIFE-WORLD-9.1 — make an inline scene SVG COVER its box instead of fitting.
 *
 * Reported 2026-07-31: the world card's scene banner renders as a small square
 * sitting in the middle of the strip, rather than filling it.
 *
 * `object-fit` cannot do this — it applies to replaced elements, and an inline
 * `<svg>` is not one. The knob is the `preserveAspectRatio` ATTRIBUTE, whose
 * default is `xMidYMid meet` — "meet" is literally fit-and-letterbox. `slice`
 * is the cover equivalent: scale to fill, overflow clipped by the wrapper's
 * `overflow-hidden`.
 *
 * Applied at the CARD only, not in `useWorldThumbnail`: the same SVG is the
 * full-size scene on `BackdropStage`, where letterboxing is correct — the artwork
 * is composed for that box and cropping it would cut the scene.
 */
export function svgCover(svg: string): string {
  // Root tag only. A nested <svg> (some generated scenes group layers that way)
  // must keep its own ratio, or the layer crops independently of the frame and
  // the composition comes apart.
  const open = svg.indexOf('<svg');
  if (open === -1) return svg;
  const close = svg.indexOf('>', open);
  if (close === -1) return svg;

  const tag = svg.slice(open, close);
  const rest = svg.slice(close);
  const stripped = tag.replace(/\spreserveAspectRatio\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  return (
    svg.slice(0, open) + `${stripped} preserveAspectRatio="xMidYMid slice"` + rest
  );
}
