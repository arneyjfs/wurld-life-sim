import { describe, expect, it } from 'vitest';
import { svgCover } from './svgCover';

/**
 * LIFE-WORLD-9.1 — the card banner must COVER, not letterbox.
 *
 * `object-fit` is not available: it applies to replaced elements and an inline
 * <svg> is not one. The default `preserveAspectRatio` is `xMidYMid meet`, and
 * "meet" IS fit-and-letterbox — which is the small square sitting in the middle
 * of the strip.
 */
describe('LIFE-WORLD-9.1 — svgCover', () => {
  it('LIFE-WORLD-9.1 — adds slice when the attribute is absent', () => {
    const out = svgCover('<svg viewBox="0 0 100 100"><rect/></svg>');
    expect(out).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(out).toContain('viewBox="0 0 100 100"');
    expect(out).toContain('<rect/>');
  });

  it('LIFE-WORLD-9.1 — REPLACES an existing meet rather than emitting two', () => {
    // A duplicate attribute is invalid and the first wins, so appending alone
    // would silently keep letterboxing.
    const out = svgCover('<svg preserveAspectRatio="xMidYMid meet" viewBox="0 0 4 3"/>');
    expect(out).toContain('slice');
    expect(out).not.toContain('meet');
    expect(out.match(/preserveAspectRatio/g)).toHaveLength(1);
  });

  it("LIFE-WORLD-9.1 — only the ROOT svg is touched", () => {
    // Some generated scenes group layers in nested <svg>. A nested layer must
    // keep its own ratio or it crops independently of the frame and the
    // composition comes apart.
    const out = svgCover('<svg viewBox="0 0 9 9"><svg viewBox="0 0 2 2"/></svg>');
    expect(out.match(/preserveAspectRatio/g)).toHaveLength(1);
    expect(out.indexOf('preserveAspectRatio')).toBeLessThan(out.indexOf('<svg viewBox="0 0 2 2"'));
  });

  it('LIFE-WORLD-9.1 — a non-svg string is returned untouched', () => {
    expect(svgCover('')).toBe('');
    expect(svgCover('not markup')).toBe('not markup');
  });
});
