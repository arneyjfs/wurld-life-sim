import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * DEVCON-SEL-1 — pins the app-wide selection-suppression rule that the dev
 * console's panel overrides (docs/specs/dev-console.md §6).
 *
 * The override is an INLINE style on the panel root. That only wins because
 * of two facts about the stylesheet, both asserted here:
 *
 *   1. The suppression lives on `body` (so a descendant's own declaration
 *      beats the inherited value), and
 *   2. it carries no `!important` (so an inline author declaration outranks
 *      it).
 *
 * If someone later moves the rule to `*` with `!important`, selection in the
 * dev console silently stops working — which is the one thing the whole
 * surface exists for. This test fails first instead.
 *
 * Reads the REAL stylesheet: jsdom cannot compute the cascade for
 * `user-select`, so the shipped declarations ARE the contract.
 */

const CSS = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');

/** Body of the first `body { … }` rule inside the base layer. */
function bodyRule(): string {
  const idx = CSS.indexOf('\n  body {');
  expect(idx, 'base-layer `body {` rule not found in globals.css').toBeGreaterThan(-1);
  const open = CSS.indexOf('{', idx);
  const close = CSS.indexOf('\n  }', open);
  return CSS.slice(open + 1, close);
}

describe('DEVCON-SEL-1 — the app-wide selection kill the dev console overrides', () => {
  it('DEVCON-SEL-1 — `body` is the element that suppresses selection', () => {
    const body = bodyRule();
    expect(body).toMatch(/(^|\s)user-select:\s*none;/);
    expect(body).toMatch(/-webkit-user-select:\s*none;/);
    expect(body).toMatch(/-webkit-touch-callout:\s*none;/);
  });

  it('DEVCON-SEL-1 — the suppression carries no !important (an inline override wins)', () => {
    const body = bodyRule();
    expect(body).not.toMatch(/user-select:[^;]*!important/);
    expect(body).not.toMatch(/-webkit-touch-callout:[^;]*!important/);
  });

  it('DEVCON-SEL-1 — no universal-selector rule sets user-select app-wide', () => {
    // A `* { user-select: none }` would apply DIRECTLY to every node inside
    // the panel, beating inheritance from the panel root and defeating the
    // override on the rows themselves.
    const universalRules = CSS.match(/(^|\n)\s*\*[^{]*\{[^}]*\}/g) ?? [];
    for (const rule of universalRules) {
      expect(rule).not.toMatch(/user-select/);
    }
  });
});
