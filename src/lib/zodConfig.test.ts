/**
 * SEC-HOST-3 (docs/specs/data-boundary.md §3c) — zod runs jitless, so it never
 * probes `new Function("")`, which the CSP (no 'unsafe-eval') reports on
 * every page load. The config must be set before any schema parses, so the
 * module is the FIRST import of the entry point.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import '@/lib/zodConfig';

describe('SEC-HOST-3 — zod never evals', () => {
  it('SEC-HOST-3 — importing zodConfig sets jitless', () => {
    expect(z.config().jitless).toBe(true);
  });

  it('SEC-HOST-3 — parsing an object schema does not call Function', () => {
    const spy = vi.spyOn(globalThis, 'Function');
    const schema = z.object({ a: z.string(), b: z.number().optional() });
    expect(schema.parse({ a: 'x', b: 1 })).toEqual({ a: 'x', b: 1 });
    expect(schema.safeParse({ a: 1 }).success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('SEC-HOST-3 — zodConfig is the first import of src/main.tsx', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');
    const firstImport = main.split('\n').find((l) => l.startsWith('import '));
    expect(firstImport).toMatch(/^import '\.\/lib\/zodConfig';$|^import '@\/lib\/zodConfig';$/);
  });
});
