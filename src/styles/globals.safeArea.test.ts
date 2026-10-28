import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CHROME-SAFE-* — the device-inset tokens (docs/specs/app-chrome.md).
 *
 * These live only in CSS, so the test reads the REAL stylesheet rather than a
 * copy. jsdom does not evaluate `env()` / `min()` / `max()`, so we assert the
 * shipped declarations directly — which is the actual contract: the two token
 * families must always be declared together with the same expression, and the
 * iOS bottom cap must be the single knob the spec says it is.
 */

const CSS = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');

/** Body of the first rule whose selector list matches `selector`. */
function ruleBody(selector: string): string {
  const idx = CSS.indexOf(selector);
  expect(idx, `selector not found: ${selector}`).toBeGreaterThan(-1);
  const open = CSS.indexOf('{', idx);
  const close = CSS.indexOf('}', open);
  return CSS.slice(open + 1, close);
}

/** Value of `--name:` inside a rule body, whitespace-collapsed. */
function decl(body: string, name: string): string | null {
  const m = body.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  return m?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
}

const IOS_SELECTOR = '[data-runtime="pwa-installed"],\n[data-runtime="native-ios"]';

describe('CHROME-SAFE-5 — the iOS bottom safe-area cap', () => {
  it('CHROME-SAFE-5 — iOS PWA + native iOS cap the BOTTOM inset at 1.5rem', () => {
    const body = ruleBody(IOS_SELECTOR);
    expect(decl(body, '--safe-area-inset-bottom')).toBe(
      'min(env(safe-area-inset-bottom, 0px), 1.5rem)',
    );
  });

  it('CHROME-SAFE-1 — the cap is applied to BOTH token families identically', () => {
    // A consumer reading --spacing-safe-bottom and one reading
    // --safe-area-inset-bottom must never disagree.
    const body = ruleBody(IOS_SELECTOR);
    expect(decl(body, '--spacing-safe-bottom')).toBe(decl(body, '--safe-area-inset-bottom'));
  });

  it('CHROME-SAFE-5 — the TOP inset is never capped on iOS (status bar needs full clearance)', () => {
    const body = ruleBody(IOS_SELECTOR);
    expect(decl(body, '--safe-area-inset-top')).toBeNull();
    expect(decl(body, '--spacing-safe-top')).toBeNull();
  });

  it('CHROME-SAFE-6 — the cap is a min(), so a notch-less device still resolves to 0', () => {
    const body = ruleBody(IOS_SELECTOR);
    const value = decl(body, '--safe-area-inset-bottom') ?? '';
    expect(value.startsWith('min(')).toBe(true);
    // A max() here would RAISE the inset on devices that report 0.
    expect(value.includes('max(')).toBe(false);
  });
});

describe('CHROME-SAFE-1/3/4 — token resolution + per-runtime floors', () => {
  it('CHROME-SAFE-1 — the base @theme aliases resolve var() then env() then 0px', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(CSS).toContain(
        `--spacing-safe-${side}: var(--safe-area-inset-${side}, env(safe-area-inset-${side}, 0px));`,
      );
    }
  });

  it('CHROME-SAFE-3 — a browser tab floors top + bottom at 1rem', () => {
    const body = ruleBody('[data-runtime="browser"],\n[data-runtime="pwa-tab"]');
    expect(decl(body, '--safe-area-inset-bottom')).toBe(
      'max(env(safe-area-inset-bottom, 0px), 1rem)',
    );
    expect(decl(body, '--spacing-safe-bottom')).toBe(decl(body, '--safe-area-inset-bottom'));
  });

  it('CHROME-SAFE-4 — Android PWA floors the TOP inset at 0.75rem', () => {
    const body = ruleBody('[data-runtime="pwa-installed"] {');
    expect(decl(body, '--safe-area-inset-top')).toBe(
      'max(env(safe-area-inset-top, 0px), 0.75rem)',
    );
    expect(decl(body, '--spacing-safe-top')).toBe(decl(body, '--safe-area-inset-top'));
  });
});

describe('CHROME-SAFE-2 — every bottom-inset consumer goes through a token', () => {
  const SRC = resolve(process.cwd(), 'src');

  /** Files allowed to read `env(safe-area-inset-bottom)` directly, with why. */
  const RAW_ENV_ALLOWLIST = new Map([
    // Documented deliberate opt-out: the filmstrip floats over the image
    // viewer's own chrome and wants the FULL inset, not the capped token.
    ['components/Image/ViewerFilmstrip.tsx', 'documented opt-out'],
  ]);

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = `${dir}/${name}`;
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  }

  it('CHROME-SAFE-2 — no component hard-codes the raw bottom env() inset', () => {
    // Raw env() bypasses the per-runtime cap (CHROME-SAFE-5), so a screen using
    // it renders a visibly different bottom gap from its siblings on the SAME
    // surface — the Practice/Life screens sat 18px lower than the composer and
    // tab bar before this was unified.
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8');
      const rel = file.slice(SRC.length + 1);
      if (RAW_ENV_ALLOWLIST.has(rel)) continue;
      // The `var(--safe-area-inset-bottom, env(...))` fallback form IS the
      // token; only a bare env() reference is an offence.
      const bare = text
        .replace(/var\(--safe-area-inset-bottom,\s*env\(safe-area-inset-bottom[^)]*\)\)/g, '')
        .includes('env(safe-area-inset-bottom');
      if (bare) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe('CHROME-BOTTOM-1 — .pb-keyboard folds the safe-area term in', () => {
  it('CHROME-BOTTOM-1 — .pb-keyboard reads the capped token, not raw env()', () => {
    const body = ruleBody('.pb-keyboard {');
    const padding = decl(body, 'padding-bottom') ?? '';
    // Must go through the token so the per-runtime cap/floor applies.
    expect(padding).toContain('var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))');
    // …and must still carry the keyboard term + the no-inset floor.
    expect(padding).toContain('--kb-h');
    expect(padding).toContain('0.5rem');
  });

  it('COMP-KB-15 — .pb-keyboard has exactly ONE keyboard term, `--kb-h`', () => {
    // `env(keyboard-inset-height)` was a second writer that no JS path could
    // zero: the COMP-KB-16 focus gate and COMP-KB-19 resets govern `--kb-h`
    // only, so on Chromium the padding could stay keyboard-tall while `--kb-h`
    // was 0px and the TabBar had already come back.
    // Assert the DECLARATION, not the rule body — the body also carries the
    // comment explaining why the env() term was removed.
    const padding = decl(ruleBody('.pb-keyboard {'), 'padding-bottom') ?? '';
    expect(padding).not.toContain('keyboard-inset-height');
    expect(padding).toContain('calc(var(--kb-h, 0px) + 0.25rem)');
  });
});

/**
 * COMP-IMG-5 — the BottomSheet's height cap must be keyboard-aware.
 *
 * jsdom evaluates neither `dvh` nor `min()`, so the contract is asserted on
 * the shipped declaration. That is the right level anyway: the bug was not a
 * wrong number, it was the cap being a CONSTANT while `.pb-keyboard` spends a
 * variable amount of the same box.
 */
describe('COMP-IMG-5 — the sheet height cap', () => {
  it('COMP-IMG-5 — .max-h-sheet grows by the keyboard height', () => {
    const body = ruleBody('.max-h-sheet');
    expect(body).toContain('var(--kb-h');
    // …and stays inside the screen when it does.
    expect(body).toContain('100dvh');
  });

  it('COMP-IMG-5 — it falls back to the 85dvh resting cap with no keyboard', () => {
    const body = ruleBody('.max-h-sheet');
    expect(body).toContain('85dvh');
    // The fallback is what makes `--kb-h` unset resolve to the resting cap
    // rather than an invalid declaration the browser drops entirely.
    expect(body).toMatch(/var\(--kb-h,\s*0px\)/);
  });
});

/**
 * COMP-KB-21 — `.kb-none` does NOT compensate for the keyboard.
 *
 * The contract is an ABSENCE, so the test has to assert the absence over the
 * whole rule rather than one property. `.pb-keyboard` padded a keyboard-sized
 * empty box inside the sheet (which whichever child is `flex-1 min-h-0` paid
 * for); `.kb-lift` then moved the sheet's bottom edge up by `--kb-h`, which on
 * a platform that already shrinks the viewport is a second compensation and
 * floats the sheet a keyboard-height too high. Neither is wanted: the picker's
 * search field is the first thing in the sheet and clears the keyboard on its
 * own.
 */
/** A rule body with `/* … *␘/` comments stripped — DECLARATIONS only.
 *  These tests assert what the rule does, and prose that merely NAMES
 *  `--kb-h` (to explain its absence) is not the rule doing anything. */
function decls(selector: string): string {
  return ruleBody(selector).replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('COMP-KB-21 — .kb-none', () => {
  it('COMP-KB-21 — the rule contains NO keyboard term at all, in any property', () => {
    // Deliberately whole-rule, not per-property: the bug came back twice, in
    // `padding-bottom` and then in `bottom`. Anything that reintroduces
    // `--kb-h` here is the regression, whatever property it lands in.
    expect(decls('.kb-none')).not.toContain('--kb-h');
  });

  it('COMP-KB-21 — the sheet is NOT offset off the viewport floor', () => {
    expect(decls('.kb-none')).not.toMatch(/(^|[^-])bottom:/);
  });

  it('COMP-KB-21 — the height is DEFINITE, not a max-height', () => {
    // `flex-1 min-h-0` needs a definite container height to distribute.
    // Under `max-height` alone the container content-sizes first and only
    // then clamps, and the picker's list resolved to ONE PIXEL. This survived
    // the removal of the lift and must keep surviving.
    const body = decls('.kb-none');
    expect(body).toMatch(/(^|[^-])height:\s*85dvh/);
    expect(body).not.toMatch(/max-height:/);
  });

  it('COMP-KB-21 — the home-indicator inset is still cleared', () => {
    // Dropping keyboard compensation must not drop safe-area compensation —
    // the home indicator is a real obstruction whether or not a keyboard is up.
    const padding = decls('.kb-none').split('padding-bottom:')[1]?.split(';')[0] ?? '';
    expect(padding).toContain('safe-area-inset-bottom');
  });

  it('COMP-KB-21 — the retired `.kb-lift` RULE is gone, not merely unused', () => {
    // A dead rule with passing tests reads as a supported mode. It isn't one.
    // Matches the selector followed by its brace, so the mention of the name
    // in the explanatory comment above `.kb-none` doesn't count as a rule.
    expect(CSS).not.toMatch(/\.kb-lift\s*\{/);
  });
});
