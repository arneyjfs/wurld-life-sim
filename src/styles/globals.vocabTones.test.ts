import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MSG-LINK-1 / MSG-VOCAB-14 — the colour tokens behind link underlines and the
 * vocab card's circles (docs/specs/message-pipeline.md). jsdom resolves no
 * custom properties, so the values are asserted against the shipped CSS, per
 * theme block; the rendered colours are asserted by the E2E specs.
 */
const CSS = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');
const DARK_AT = CSS.indexOf('[data-theme="dark"] {');
const LIGHT = CSS.slice(0, DARK_AT);
const DARK = CSS.slice(DARK_AT, CSS.indexOf('\n}', DARK_AT));

function token(block: string, name: string): string | null {
  const m = block.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1]!.trim() : null;
}

describe('vocab + link tones', () => {
  it.each([['light', LIGHT], ['dark', DARK]] as const)(
    'MSG-LINK-1 — %s: link underlines are the text colour on both bubbles',
    (_t, block) => {
      expect(token(block, 'color-link-underline-mine')).toBe('currentColor');
      expect(token(block, 'color-link-underline-theirs')).toBe('currentColor');
    },
  );

  it('MSG-VOCAB-14.2 — the saved icon is #34c759 in light, #4ade80 in dark', () => {
    expect(token(LIGHT, 'color-flashcard-saved')).toBe('#34c759');
    expect(token(DARK, 'color-flashcard-saved')).toBe('#4ade80');
  });

  it('MSG-VOCAB-14.1 — the received-bubble circle is a lighter accent wash in light mode than in dark', () => {
    expect(token(LIGHT, 'color-vocab-circle-theirs')).toMatch(/color-mix\(in srgb, var\(--color-accent\) 7%, transparent\)/);
    expect(token(DARK, 'color-vocab-circle-theirs')).toMatch(/color-mix\(in srgb, var\(--color-accent\) 12%, transparent\)/);
  });
});
