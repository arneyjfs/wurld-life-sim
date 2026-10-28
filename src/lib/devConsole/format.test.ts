/**
 * DEVCON-CON-4 / DEVCON-CON-5 — argument formatting + truncation caps.
 * Spec: docs/specs/dev-console.md §3.
 *
 * The whole point of the console tab is that an object is READABLE on a
 * phone. `[object Object]` would make the feature pointless, and an
 * un-capped `JSON.stringify` of a Firestore snapshot would blow the
 * buffer. Both directions are pinned here.
 */
import { describe, expect, it } from 'vitest';
import { CAPS, formatLogArgs, formatValue, truncate } from './format';

describe('DEVCON-CON-4 — objects render readable, never [object Object]', () => {
  it('DEVCON-CON-4 — plain objects serialise to JSON', () => {
    expect(formatValue({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
    expect(formatValue({ a: 1 })).not.toContain('[object Object]');
  });

  it('DEVCON-CON-4 — arrays serialise to JSON', () => {
    expect(formatValue([1, 'a', true])).toBe('[1,"a",true]');
  });

  it('DEVCON-CON-4 — strings pass through verbatim (not JSON-quoted)', () => {
    expect(formatValue('hello world')).toBe('hello world');
  });

  it('DEVCON-CON-4 — primitives use String()', () => {
    expect(formatValue(undefined)).toBe('undefined');
    expect(formatValue(null)).toBe('null');
    expect(formatValue(42)).toBe('42');
    expect(formatValue(false)).toBe('false');
    expect(formatValue(10n)).toBe('10');
  });

  it('DEVCON-CON-4 — Errors render name, message and stack', () => {
    const err = new Error('boom');
    const out = formatValue(err);
    expect(out).toContain('Error: boom');
    expect(out).toContain('format.test');
  });

  it('DEVCON-CON-4 — functions render as [Function: name]', () => {
    function namedFn() {}
    expect(formatValue(namedFn)).toBe('[Function: namedFn]');
  });

  it('DEVCON-CON-4 — a circular reference renders [Circular], never throws', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = formatValue(a);
    expect(out).toContain('[Circular]');
    expect(out).toContain('"name":"a"');
  });

  it('DEVCON-CON-4 — a throwing getter renders [Unserializable], never throws', () => {
    const bad = {
      ok: 1,
      get boom() {
        throw new Error('nope');
      },
    };
    expect(() => formatValue(bad)).not.toThrow();
    expect(formatValue(bad)).toContain('[Unserializable]');
  });
});

describe('DEVCON-CON-5 — truncation caps', () => {
  it('DEVCON-CON-5 — depth beyond the cap collapses to [Object] / [Array]', () => {
    const deep = { l1: { l2: { l3: { l4: { l5: 'too deep' } } } } };
    const out = formatValue(deep);
    expect(out).toContain('[Object]');
    expect(out).not.toContain('too deep');

    const deepArr = [[[[['too deep']]]]];
    expect(formatValue(deepArr)).toContain('[Array]');
  });

  it('DEVCON-CON-5 — nested strings cap at 500 chars with a +N marker', () => {
    const long = 'x'.repeat(700);
    const out = formatValue({ long });
    expect(out).toContain('x'.repeat(CAPS.jsonStringChars));
    expect(out).not.toContain('x'.repeat(CAPS.jsonStringChars + 1));
    expect(out).toContain('+200');
  });

  it('DEVCON-CON-5 — arrays cap at 50 items with a "+N more" tail', () => {
    const arr = Array.from({ length: 60 }, (_, i) => i);
    const out = formatValue(arr);
    expect(out).toContain('49');
    expect(out).not.toContain('59');
    expect(out).toContain('+10 more');
  });

  it('DEVCON-CON-5 — objects cap at 50 keys with a "+N more" tail', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 60; i += 1) obj[`k${i}`] = i;
    const out = formatValue(obj);
    expect(out).toContain('"k0"');
    expect(out).not.toContain('"k59"');
    expect(out).toContain('+10 more');
  });

  it('DEVCON-CON-5 — truncate() marks the original length', () => {
    const text = 'y'.repeat(50);
    expect(truncate(text, 100)).toBe(text);
    const cut = truncate(text, 10);
    expect(cut.startsWith('yyyyyyyyyy')).toBe(true);
    expect(cut).toContain('truncated, 50 chars total');
  });

  it('DEVCON-CON-5 — a whole console entry caps at 2000 chars', () => {
    const huge = 'z'.repeat(5000);
    const out = formatLogArgs([huge]);
    expect(out.length).toBeLessThan(CAPS.consoleEntryChars + 60);
    expect(out).toContain('truncated, 5000 chars total');
  });

  it('DEVCON-CON-5 — the documented cap values are the shipped ones', () => {
    expect(CAPS.jsonDepth).toBe(4);
    expect(CAPS.jsonStringChars).toBe(500);
    expect(CAPS.jsonArrayItems).toBe(50);
    expect(CAPS.jsonObjectKeys).toBe(50);
    expect(CAPS.consoleEntryChars).toBe(2000);
    expect(CAPS.requestBodyChars).toBe(4000);
    expect(CAPS.responseBodyChars).toBe(4000);
  });
});

describe('DEVCON-CON-4 — formatLogArgs joins arguments', () => {
  it('DEVCON-CON-4 — args join with a single space', () => {
    expect(formatLogArgs(['[info]', 'sent', { id: 7 }])).toBe('[info] sent {"id":7}');
  });

  it('DEVCON-CON-4 — an empty argument list yields an empty string', () => {
    expect(formatLogArgs([])).toBe('');
  });
});
