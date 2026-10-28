// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { closeUnclosedElements, dedupeAttributes, sanitiseSvg } from './sanitizeSvg';

describe('sanitiseSvg — LIFE-BACKDROP-5', () => {
  it('returns null for non-SVG input', () => {
    expect(sanitiseSvg('')).toBeNull();
    expect(sanitiseSvg('hello')).toBeNull();
    expect(sanitiseSvg('<div>not svg</div>')).toBeNull();
  });

  it('passes a clean SVG through with viewBox + preserveAspectRatio injected', () => {
    const out = sanitiseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="red"/></svg>',
    );
    // LIFE-BACKDROP-12: square canvas, contain-fit. Cover-fit ('slice')
    // never leaves letterbox space because it crops instead.
    expect(out).toContain('viewBox="0 0 1000 1000"');
    expect(out).toContain('preserveAspectRatio="xMidYMin meet"');
    expect(out).toContain('<rect');
  });

  it('strips <script> tags entirely', () => {
    const out = sanitiseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>',
    );
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).toContain('<rect');
  });

  it('strips inline event handlers', () => {
    const out = sanitiseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="evil()" onload="bad()" fill="red"/></svg>',
    );
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onload');
    expect(out).toContain('fill="red"');
  });

  it('strips external href values but keeps in-document fragment refs', () => {
    const out = sanitiseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.com/x" /><use href="#localRef"/></svg>',
    );
    expect(out).not.toContain('https://evil.com');
    expect(out).toContain('#localRef');
  });

  it('strips javascript: URLs', () => {
    const out = sanitiseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>',
    );
    expect(out).not.toContain('javascript:');
  });

  it('strips unknown elements like <foreignObject>', () => {
    const out = sanitiseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe/></foreignObject><rect/></svg>',
    );
    expect(out).not.toContain('foreignObject');
    expect(out).not.toContain('iframe');
    expect(out).toContain('<rect');
  });

  it('removes width/height so the SVG scales to its container', () => {
    const out = sanitiseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect/></svg>',
    );
    expect(out).not.toMatch(/\swidth="\d/);
    expect(out).not.toMatch(/\sheight="\d/);
  });

  it('keeps animate / animateTransform elements (atmospheric motion)', () => {
    const out = sanitiseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="5"><animate attributeName="cx" values="10;50;10" dur="3s" repeatCount="indefinite"/></circle></svg>',
    );
    expect(out).toContain('<animate');
    expect(out).toContain('attributeName="cx"');
  });

  it('returns null when the parser rejects the input as malformed XML', () => {
    // Truly broken markup is rejected outright.
    expect(sanitiseSvg('<<<not svg')).toBeNull();
    // Nothing SVG-shaped in it at all.
    expect(sanitiseSvg('<div><p>hello</p></div>')).toBeNull();
    // A root that is not <svg> after repair is still refused: the repair fixes
    // WELL-FORMEDNESS, it does not manufacture an SVG out of something else.
    expect(sanitiseSvg('<notsvg><svg/></notsvg>')).toBeNull();
    // The point of the guard is unchanged — when sanitising cannot produce a
    // usable document the caller falls back to a silhouette (LIFE-FAIL-3), and
    // no bad markup ever reaches the renderer.
  });

  it('LIFE-BACKDROP-25 — an unclosed tag is now REPAIRED rather than refused', () => {
    // This case used to be the example of "malformed XML → null", and it was
    // costing whole backdrops for one missing tag. It is now recovered; the
    // assertion moved rather than being deleted, because the behaviour it
    // described is exactly what changed.
    const out = sanitiseSvg('<svg><rect fill="#123"></svg>');
    expect(out).not.toBeNull();
    expect(out).toContain('rect');
  });
});

/**
 * LIFE-BACKDROP-23 — the allowlist is matched CASE-INSENSITIVELY.
 *
 * THE BUG. `ALLOWED_ELEMENTS` is written in the SVG spec's camelCase
 * (`animateTransform`, `linearGradient`, `clipPath`, `feGaussianBlur`), but the
 * lookup did `ALLOWED_ELEMENTS.has(el.tagName.toLowerCase())`. SVG parses as
 * XML, so `tagName` preserves case — `'animateTransform'.toLowerCase()` is
 * `'animatetransform'`, which is in no set. Every camelCase element was
 * therefore stripped from every generated backdrop, silently:
 *
 *   - `animateTransform` / `animateMotion` — the drifting, swaying, rising
 *     motion. Reported as "none of the backdrop svgs seem to animate anymore".
 *     Plain `<animate>` (lowercase) survived, which is why a candle flicker got
 *     through and made it look like animation *sort of* worked.
 *   - `linearGradient` / `radialGradient` — the SI names "gentle gradients" as
 *     part of the visual identity. Every one was dropped to flat fill.
 *   - `clipPath`, and all eight `fe*` filter primitives.
 *
 * Lowercasing the SET once at construction is the fix; the elements are then
 * matched however the parser reports them.
 */
describe('LIFE-BACKDROP-23 — camelCase SVG elements survive sanitisation', () => {
  const wrap = (inner: string) =>
    `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

  it('keeps animateTransform — the motion the player actually sees', () => {
    const out = sanitiseSvg(
      wrap(
        '<circle cx="50" cy="50" r="10"><animateTransform attributeName="transform" type="translate" values="-20,0;20,0;-20,0" dur="15s" repeatCount="indefinite"/></circle>',
      ),
    );
    expect(out).toContain('animateTransform');
    expect(out).toContain('repeatCount="indefinite"');
  });

  it('keeps animateMotion + mpath', () => {
    const out = sanitiseSvg(
      wrap('<circle r="5"><animateMotion dur="9s" repeatCount="indefinite"/></circle>'),
    );
    expect(out).toContain('animateMotion');
  });

  it('keeps gradients — the SI calls them part of the visual identity', () => {
    const out = sanitiseSvg(
      wrap(
        '<defs><linearGradient id="sky"><stop offset="0" stop-color="#abc"/></linearGradient><radialGradient id="sun"><stop offset="0" stop-color="#fe8"/></radialGradient></defs><rect width="100" height="100" fill="url(#sky)"/>',
      ),
    );
    expect(out).toContain('linearGradient');
    expect(out).toContain('radialGradient');
    expect(out).toContain('url(#sky)');
  });

  it('keeps clipPath and the fe* filter primitives', () => {
    const out = sanitiseSvg(
      wrap(
        '<defs><clipPath id="c"><rect width="10" height="10"/></clipPath><filter id="b"><feGaussianBlur stdDeviation="2"/><feOffset dx="1"/><feMerge><feMergeNode/></feMerge></filter></defs>',
      ),
    );
    expect(out).toContain('clipPath');
    expect(out).toContain('feGaussianBlur');
    expect(out).toContain('feMergeNode');
  });

  it('still strips what is NOT on the list, whatever its case', () => {
    // The fix must not become "allow everything" — case-insensitivity is about
    // matching the parser, not widening the set.
    expect(sanitiseSvg(wrap('<script>alert(1)</script><rect/>'))).not.toContain('script');
    expect(sanitiseSvg(wrap('<foreignObject><div/></foreignObject><rect/>'))).not.toContain(
      'foreignObject',
    );
  });
});

describe('LIFE-BACKDROP-24 — a duplicated attribute must not bin the whole image', () => {
  it('recovers an SVG the XML parser rejects for a repeated attribute', () => {
    // MEASURED: one backdrop in twenty of a four-world run died on
    // `90:158: duplicate attribute: fill`. XML returns a <parsererror> root, so
    // the whole backdrop was discarded and the scene fell back to a
    // silhouette — for one duplicated word an HTML parser would have shrugged at.
    const raw = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
      + '<rect x="0" y="0" width="10" height="10" fill="#abc" stroke="#000" fill="#def"/>'
      + '</svg>';
    const out = sanitiseSvg(raw);
    expect(out).not.toBeNull();
    // FIRST value wins, as an HTML parser would take it.
    expect(out).toContain('fill="#abc"');
    expect(out).not.toContain('#def');
    // And nothing else is lost.
    expect(out).toContain('stroke="#000"');
  });

  it('leaves well-formed markup byte-identical', () => {
    const clean = '<rect x="0" y="0" fill="#abc"/>';
    expect(dedupeAttributes(clean)).toBe(clean);
  });

  it('does not corrupt an attribute value containing angle brackets', () => {
    // The tag regex has to respect quoting, or a value like this would end the
    // tag early and mangle the document it was meant to repair.
    const tricky = '<text font-family="a>b" fill="#111">hi</text>';
    expect(dedupeAttributes(tricky)).toBe(tricky);
  });

  it('dedupes per element, not across the document', () => {
    const two = '<g fill="#1"/><g fill="#2"/>';
    expect(dedupeAttributes(two)).toBe(two);
  });
});

describe('LIFE-BACKDROP-25 — an unclosed element is closed, not fatal', () => {
  it('recovers the exact shape that killed a real backdrop', () => {
    // Verbatim from the 2026-08-04 run: <feMerge> opened, never closed, and
    // </filter> arrived instead. 4.9 KB of SVG was discarded for one tag.
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
<defs><filter id="glow">
<feGaussianBlur stdDeviation="3" result="coloredBlur"/>
<feMerge>
<feMergeNode in="coloredBlur"/>
<feMergeNode in="SourceGraphic"/>
</filter>
</defs>
<rect x="0" y="0" width="1000" height="1000" fill="#abc"/>
</svg>`;
    const out = sanitiseSvg(raw);
    expect(out).not.toBeNull();
    // The repair must keep the content, not merely avoid returning null.
    expect(out).toContain('feGaussianBlur');
    expect(out).toContain('feMergeNode');
    expect(out).toContain('#abc');
  });

  it('closes the intervening element, in the right order', () => {
    const out = closeUnclosedElements('<a><b><c/></a>');
    expect(out).toBe('<a><b><c/></b></a>');
  });

  it('closes anything still open when the document ends', () => {
    expect(closeUnclosedElements('<a><b>')).toBe('<a><b></b></a>');
  });

  it('drops a stray close tag that matches nothing open', () => {
    expect(closeUnclosedElements('<a></b></a>')).toBe('<a></a>');
  });

  it('leaves well-formed markup byte-identical', () => {
    for (const ok of [
      '<svg><rect/></svg>',
      '<svg><g><path d="M0,0"/></g></svg>',
      '<svg><defs><linearGradient><stop/></linearGradient></defs></svg>',
    ]) {
      expect(closeUnclosedElements(ok)).toBe(ok);
    }
  });

  it('is not confused by self-closing tags, comments or declarations', () => {
    const s = '<svg><!-- <g> not a tag --><rect/><?xml-stylesheet?></svg>';
    expect(closeUnclosedElements(s)).toBe(s);
  });

  it('does NOT let a repair smuggle a disallowed element past the allowlist', () => {
    // The repair runs before sanitiseElement; closing a tag must never be a
    // way to get <script> rendered.
    const out = sanitiseSvg('<svg><script>alert(1)</script><rect fill="#123"/></svg>');
    expect(out).not.toBeNull();
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
  });
});
