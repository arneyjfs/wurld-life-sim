/**
 * LIFE-BACKDROP-12: the bleed colour that fills the letterbox.
 *
 * Backdrops are drawn on a SQUARE canvas and rendered contain-fit
 * (`xMidYMid meet`), so on any non-square viewport there is leftover
 * space — horizontal bars on a wide desktop, vertical bars on a tall
 * phone. Cover-fit (the previous `slice`) had no leftover space because
 * it cropped instead, which silently ate the backdrop's edges on extreme
 * aspect ratios.
 *
 * Rather than letting that space fall back to the app chrome colour —
 * which reads as "the picture is too small" — the backdrop declares its own
 * edge colour on a full-canvas `<rect class="bleed">`, and the stage
 * paints the surround with it. The frame then reads as one continuous
 * image that happens to be denser in the middle.
 *
 * Parsing is a regex, not DOMParser: this runs on every backdrop render and
 * the input has already been through `sanitiseSvg`'s allowlist, so the
 * markup is known-safe and known-simple. Returning `null` is the normal
 * path for legacy 3:2 backdrops cached before this landed — the caller
 * falls back to the theme background.
 */

/** Matches a `fill="…"` / `fill='…'` attribute value. */
const FILL_ATTR = /\bfill\s*=\s*["']([^"']+)["']/;

/** Any element carrying `class="bleed"` (attribute order-independent). */
const BLEED_EL = /<(?:rect|path|polygon)\b[^>]*\bclass\s*=\s*["'][^"']*\bbleed\b[^"']*["'][^>]*>/i;

/**
 * The backdrop's declared edge colour, or `null` when it declares none.
 *
 * Only flat colours are returned. A `url(#gradient)` fill is rejected:
 * the surround is painted with a plain CSS background, and naming a
 * gradient we cannot resolve would paint the letterbox transparent —
 * worse than falling back to the theme colour.
 */
export function backdropBleedColor(svg: string | null | undefined): string | null {
  if (!svg) return null;
  const el = BLEED_EL.exec(svg);
  if (!el) return null;
  const fill = FILL_ATTR.exec(el[0]);
  if (!fill) return null;
  const value = fill[1]!.trim();
  if (!value || value === 'none' || value.startsWith('url(')) return null;
  return value;
}
