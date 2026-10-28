import { describe, expect, it } from 'vitest';
import { isRtlText, dirOf } from './textDirection';

// Arabic "marhaba" + Hebrew "shalom" — built from code points so the source
// file stays ASCII (matches the RTL_RE construction rationale).
const AR = String.fromCharCode(0x0645, 0x0631, 0x062d, 0x0628, 0x0627);
const HE = String.fromCharCode(0x05e9, 0x05dc, 0x05d5, 0x05dd);

describe('MSG-VIEW-4 — textDirection', () => {
  it('isRtlText detects Arabic + Hebrew, not Latin/empty', () => {
    expect(isRtlText(AR)).toBe(true);
    expect(isRtlText(HE)).toBe(true);
    expect(isRtlText('Hello world')).toBe(false);
    expect(isRtlText('')).toBe(false);
    expect(isRtlText(undefined)).toBe(false);
    expect(isRtlText(null)).toBe(false);
  });

  it('dirOf returns rtl for RTL scripts, ltr otherwise', () => {
    expect(dirOf(AR)).toBe('rtl');
    expect(dirOf(HE)).toBe('rtl');
    expect(dirOf('Bonjour')).toBe('ltr');
    expect(dirOf(undefined)).toBe('ltr');
  });

  it('a mixed string with ANY RTL char reads rtl (base-direction heuristic)', () => {
    // Used for a single-language row's base dir.
    expect(dirOf(`hello ${AR}`)).toBe('rtl');
  });
});
