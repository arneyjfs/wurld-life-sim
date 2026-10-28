// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCssVar, setWebThemeColor, toHexColor } from './statusBar';

describe('toHexColor', () => {
  it('passes #rrggbb through, lower-cased', () => {
    expect(toHexColor('#FFffff')).toBe('#ffffff');
    expect(toHexColor('#1a1d27')).toBe('#1a1d27');
  });

  it('expands #rgb shorthand to #rrggbb', () => {
    expect(toHexColor('#fff')).toBe('#ffffff');
    expect(toHexColor('#0Af')).toBe('#00aaff');
  });

  it('parses rgb() / rgba() into #rrggbb (alpha discarded)', () => {
    expect(toHexColor('rgb(26, 29, 39)')).toBe('#1a1d27');
    expect(toHexColor('rgba(255, 255, 255, 0.5)')).toBe('#ffffff');
    expect(toHexColor('rgb(0 17 34)')).toBe('#001122');
  });

  it('returns null for unparseable input', () => {
    expect(toHexColor(null)).toBeNull();
    expect(toHexColor(undefined)).toBeNull();
    expect(toHexColor('')).toBeNull();
    expect(toHexColor('not-a-color')).toBeNull();
    expect(toHexColor('hsl(120, 50%, 50%)')).toBeNull();
  });
});

describe('resolveCssVar', () => {
  beforeEach(() => {
    document.documentElement.style.setProperty('--test-token-bg', '#1a1d27');
    document.documentElement.style.setProperty('--test-token-empty', '');
  });
  afterEach(() => {
    document.documentElement.style.removeProperty('--test-token-bg');
    document.documentElement.style.removeProperty('--test-token-empty');
  });

  it('reads a custom property from <html> computed style', () => {
    expect(resolveCssVar('--test-token-bg')).toBe('#1a1d27');
  });

  it('returns null for an unset / empty var', () => {
    expect(resolveCssVar('--this-token-does-not-exist')).toBeNull();
    expect(resolveCssVar('--test-token-empty')).toBeNull();
  });
});

describe('setWebThemeColor', () => {
  afterEach(() => {
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  });

  it('updates an existing <meta name="theme-color"> tag', () => {
    const existing = document.createElement('meta');
    existing.setAttribute('name', 'theme-color');
    existing.setAttribute('content', '#000000');
    document.head.appendChild(existing);

    setWebThemeColor('#1a1d27');

    const all = document.head.querySelectorAll('meta[name="theme-color"]');
    expect(all.length).toBe(1);
    expect(all[0]?.getAttribute('content')).toBe('#1a1d27');
  });

  it('creates the tag if it is missing', () => {
    expect(document.head.querySelector('meta[name="theme-color"]')).toBeNull();
    setWebThemeColor('#ffffff');
    const meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('#ffffff');
  });

  it('does not duplicate writes when the value is unchanged', () => {
    setWebThemeColor('#abcdef');
    const first = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    setWebThemeColor('#abcdef');
    const second = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(first).toBe(second);
    expect(second?.getAttribute('content')).toBe('#abcdef');
  });

  // Regression for the iOS PWA standalone meta-tag-cache quirk: iOS snapshots
  // the theme-color node at page load and ignores in-place setAttribute
  // updates against the SAME node. The fix at commit 1719351 replaces the
  // node — remove() + new element — so iOS re-reads on the next paint.
  // If a future refactor switches back to setAttribute, this test fails.
  it('writes a FRESH node on each distinct value (no in-place mutation)', () => {
    setWebThemeColor('#111111');
    const first = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(first).not.toBeNull();

    setWebThemeColor('#222222');
    const second = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second?.getAttribute('content')).toBe('#222222');

    setWebThemeColor('#333333');
    const third = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(third).not.toBe(second);
    expect(third).not.toBe(first);
    expect(third?.getAttribute('content')).toBe('#333333');

    // Old nodes have been detached from <head>.
    expect(first?.isConnected).toBe(false);
    expect(second?.isConnected).toBe(false);
    expect(third?.isConnected).toBe(true);
  });

  // index.html ships a media-query PAIR (`prefers-color-scheme: light`
  // + `... : dark`) for the initial paint. Without this cleanup, those
  // would survive every setWebThemeColor call and Safari's "first
  // applicable in document order" selection would pick a stale tint
  // that ignores our latest write — visible repro: opening ImageViewer
  // from /chat/:id/info, status bar zone stays page-bg instead of
  // flipping to viewer-black.
  it('removes ALL pre-existing theme-color metas (including media-queried siblings)', () => {
    const light = document.createElement('meta');
    light.setAttribute('name', 'theme-color');
    light.setAttribute('content', '#ffffff');
    light.setAttribute('media', '(prefers-color-scheme: light)');
    document.head.appendChild(light);

    const dark = document.createElement('meta');
    dark.setAttribute('name', 'theme-color');
    dark.setAttribute('content', '#0a0a0a');
    dark.setAttribute('media', '(prefers-color-scheme: dark)');
    document.head.appendChild(dark);

    setWebThemeColor('#000000');

    const remaining = document.head.querySelectorAll('meta[name="theme-color"]');
    expect(remaining.length).toBe(1);
    expect(remaining[0]?.getAttribute('content')).toBe('#000000');
    // Both static siblings are gone.
    expect(light.isConnected).toBe(false);
    expect(dark.isConnected).toBe(false);
  });
});
