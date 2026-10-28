/**
 * LIFE-BACKDROP-12 — bleed colour extraction.
 *
 * Spec: docs/specs/life-sim.md — LIFE-BACKDROP-12.
 */
import { describe, expect, it } from 'vitest';
import { backdropBleedColor } from './backdropBleed';

describe('LIFE-BACKDROP-12 — backdrop bleed colour', () => {
  it('LIFE-BACKDROP-12 — reads the fill off the bleed rect', () => {
    const svg =
      '<svg viewBox="0 0 1000 1000"><rect class="bleed" x="0" y="0" width="1000" height="1000" fill="#e8d5c4"/><circle r="4"/></svg>';
    expect(backdropBleedColor(svg)).toBe('#e8d5c4');
  });

  it('LIFE-BACKDROP-12 — attribute order does not matter', () => {
    const svg =
      '<svg><rect fill="#123456" width="1000" height="1000" class="sky bleed"/></svg>';
    expect(backdropBleedColor(svg)).toBe('#123456');
  });

  it('LIFE-BACKDROP-12 — legacy backdrops without a bleed rect return null', () => {
    // 3:2 backdrops cached before LIFE-BACKDROP-12 — caller falls back to the
    // theme background rather than painting the letterbox transparent.
    const svg =
      '<svg viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#123456"/></svg>';
    expect(backdropBleedColor(svg)).toBeNull();
  });

  it('LIFE-BACKDROP-12 — a gradient fill is rejected, not passed to CSS', () => {
    const svg =
      '<svg><rect class="bleed" width="1000" height="1000" fill="url(#skyGrad)"/></svg>';
    expect(backdropBleedColor(svg)).toBeNull();
  });

  it('LIFE-BACKDROP-12 — fill="none" and empty input are null', () => {
    expect(
      backdropBleedColor('<svg><rect class="bleed" fill="none"/></svg>'),
    ).toBeNull();
    expect(backdropBleedColor('')).toBeNull();
    expect(backdropBleedColor(null)).toBeNull();
  });

  it('LIFE-BACKDROP-12 — a bleed rect with no fill at all is null', () => {
    expect(
      backdropBleedColor('<svg><rect class="bleed" width="1000"/></svg>'),
    ).toBeNull();
  });
});
