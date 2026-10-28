import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MSG-BUBBLE-8.6 — the entrance / exit grid wrappers are HORIZONTALLY
 * transparent (docs/specs/message-pipeline.md).
 *
 * `.bubble-enter-grow` / `.bubble-exit-shrink` wrap the bubble in a grid box to
 * animate the GAP around it. A grid item's `min-width: auto` resolves to its
 * min-content size in the inline axis, so without an explicit `min-width: 0`
 * those wrappers put a min-content FLOOR under the bubble that the plain `<div>`
 * a settled bubble sits in does not — and the floor outlives the animation,
 * because `animateEnter` is captured once per instance (MSG-BUBBLE-8.5).
 *
 * jsdom does no layout, so the contract is asserted against the shipped CSS.
 */

const CSS = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');

function ruleBody(selector: string): string {
  const idx = CSS.indexOf(`${selector} {`);
  expect(idx, `selector not found: ${selector} {`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', idx);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open + 1, close);
}

function decl(body: string, prop: string): string | null {
  const m = body.match(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;]+);`));
  return m?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
}

describe('MSG-BUBBLE-8.6 — the grow wrapper never floors the bubble width', () => {
  for (const selector of ['.bubble-enter-grow > *', '.bubble-exit-shrink > *']) {
    it(`MSG-BUBBLE-8.6 — ${selector} declares min-width: 0`, () => {
      expect(decl(ruleBody(selector), 'min-width')).toBe('0');
    });

    it(`MSG-BUBBLE-8.6 — ${selector} keeps its vertical-axis rules`, () => {
      // The horizontal fix must not disturb what the wrapper is FOR: the item
      // keeps its natural height and overflows the animating track downward.
      const body = ruleBody(selector);
      expect(decl(body, 'min-height')).toBe('0');
      expect(decl(body, 'align-self')).toBe('start');
    });
  }
});

/**
 * MSG-REVIEW-CLARIFY-2 — the clarify placeholder is the theme's accent, muted.
 *
 * Asserted against the shipped CSS because the point of the token is that it is
 * DERIVED: a hand-picked hex would pass any test that only checked "it is
 * purple", and would then silently stop matching the brand the first time
 * --color-accent moves.
 */
describe('MSG-REVIEW-CLARIFY-2 — the clarify placeholder derives from the accent', () => {
  it('MSG-REVIEW-CLARIFY-2 — it mixes --color-accent toward --color-fg-muted', () => {
    const m = CSS.match(/--color-clarify-placeholder:\s*([^;]+);/g) ?? [];
    expect(m.length, 'exactly one declaration — a per-theme override would be a second value to keep in step').toBe(1);
    const value = (m[0] ?? '').replace(/\s+/g, ' ');
    expect(value).toContain('color-mix');
    expect(value).toContain('var(--color-accent)');
    expect(value).toContain('var(--color-fg-muted)');
  });

  it('MSG-REVIEW-CLARIFY-2 — it is not a literal colour', () => {
    // Both earlier cuts were hand-picked blues that belonged to no palette.
    const value = (CSS.match(/--color-clarify-placeholder:\s*([^;]+);/) ?? [])[1] ?? '';
    expect(value).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
