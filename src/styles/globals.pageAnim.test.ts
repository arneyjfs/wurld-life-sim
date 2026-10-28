import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_ANIM_MS } from '@/lib/navTransition';

/**
 * NAV-ANIM-6 — the page transition's duration + curve (docs/specs/navigation.md).
 *
 * The timing lives in TWO places by necessity: the CSS animations play it, and
 * a JS timer uses it to drop the outgoing slot. They cannot drift — a CSS
 * animation longer than the timer gets cut off mid-frame; a shorter one leaves
 * the old page parked. jsdom can't run the animation, so we assert the shipped
 * declarations against the exported constant.
 */

const CSS = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');

const RULES = [
  '.page-anim-enter-forward',
  '.page-anim-exit-forward',
  '.page-anim-enter-back',
  '.page-anim-exit-back',
] as const;

/** The `animation:` shorthand declared by the first rule matching `selector`. */
function animationShorthand(selector: string): string {
  // Skip the reduced-motion block, which lists all four selectors together and
  // declares `animation: none`.
  const idx = CSS.indexOf(`${selector} {`);
  expect(idx, `selector not found: ${selector} {`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', idx);
  const close = CSS.indexOf('}', open);
  const body = CSS.slice(open + 1, close);
  const value = body.match(/animation\s*:\s*([^;]+);/)?.[1];
  expect(value, `no animation shorthand in ${selector}`).toBeDefined();
  return value!.replace(/\s+/g, ' ').trim();
}

describe('NAV-ANIM-6 — one duration, one curve, declared once', () => {
  it('NAV-ANIM-6 — every .page-anim-* rule runs for exactly PAGE_ANIM_MS', () => {
    for (const selector of RULES) {
      const shorthand = animationShorthand(selector);
      expect(shorthand, selector).toContain(`${PAGE_ANIM_MS}ms`);
    }
  });

  it('NAV-ANIM-6 — every .page-anim-* rule shares ONE easing curve', () => {
    const curves = RULES.map((selector) => {
      const m = animationShorthand(selector).match(/cubic-bezier\([^)]*\)/);
      expect(m, `${selector} must declare an explicit cubic-bezier`).not.toBeNull();
      return m![0].replace(/\s/g, '');
    });
    expect(new Set(curves).size, `curves drifted: ${curves.join(' | ')}`).toBe(1);
  });

  it('NAV-ANIM-6 — the transition is long enough not to read as a flash', () => {
    // 280ms on a front-loaded curve was the reported "flash". The floor keeps a
    // future tuning pass from walking back under it by accident.
    expect(PAGE_ANIM_MS).toBeGreaterThanOrEqual(340);
    // Upper bound: past ~half a second a push stops feeling responsive.
    expect(PAGE_ANIM_MS).toBeLessThanOrEqual(500);
  });

  it('NAV-ANIM-6 — the curve is not the old front-loaded iOS ease', () => {
    // cubic-bezier(0.32, 0.72, 0, 1) spends ~70% of its travel in the first
    // quarter of the duration, which is what made the short transition snap.
    const shorthand = animationShorthand('.page-anim-enter-forward');
    expect(shorthand.replace(/\s/g, '')).not.toContain('cubic-bezier(0.32,0.72,0,1)');
  });

  it('NAV-ANIM-5 — .page-anim-* still declares no will-change', () => {
    for (const selector of RULES) {
      const idx = CSS.indexOf(`${selector} {`);
      const body = CSS.slice(CSS.indexOf('{', idx) + 1, CSS.indexOf('}', CSS.indexOf('{', idx)));
      expect(body, selector).not.toContain('will-change');
    }
  });
});
