import { describe, expect, it } from 'vitest';
import { stripUndefined } from './stripUndefined';

/**
 * LIFE-CAST-6 — the shared Firestore-write backstop.
 *
 * Every assertion here uses `in` / `Object.keys`, never `toBeUndefined()`.
 * That is the whole point of the invariant: `{ where: undefined }` and `{}`
 * both make `obj.where === undefined`, so `toBeUndefined()` passes against
 * unfixed code and proves nothing. Firestore distinguishes them — it rejects
 * the first outright — so the test has to distinguish them too.
 */
describe('LIFE-CAST-6 — stripUndefined', () => {
  it('LIFE-CAST-6 — removes a key HOLDING undefined, not merely its value', () => {
    const out = stripUndefined({ a: 1, where: undefined });
    expect('where' in out).toBe(false);
    expect(Object.keys(out)).toEqual(['a']);
  });

  it('LIFE-CAST-6 — strips at DEPTH, which a top-level loop does not', () => {
    // `outline.where` is the field that actually failed a write; every
    // life-sim payload is nested like this.
    const out = stripUndefined({
      outline: { subject: 'x', where: undefined, nested: { q: undefined, keep: 1 } },
    });
    expect('where' in out.outline).toBe(false);
    expect('q' in out.outline.nested).toBe(false);
    expect(out.outline.nested.keep).toBe(1);
    expect(out.outline.subject).toBe('x');
  });

  it('LIFE-CAST-6 — walks arrays and drops undefined entries', () => {
    const out = stripUndefined({ cast: [{ name: 'a', role: undefined }, undefined] });
    expect(out.cast).toHaveLength(1);
    expect('role' in (out.cast[0] as object)).toBe(false);
  });

  it('LIFE-CAST-6 — passes NON-plain objects through by identity', () => {
    // The load-bearing case. A Firestore sentinel (`serverTimestamp()`), a
    // `Timestamp`, a `DocumentReference` — all class instances. Copying one
    // into a plain object would strip its prototype and silently turn a
    // sentinel into inert data: a worse bug than the one this prevents, and
    // one nothing would surface but a wrong value in the database.
    class Sentinel {
      readonly _method = 'serverTimestamp';
    }
    const sentinel = new Sentinel();
    const date = new Date(0);
    const out = stripUndefined({ updatedAt: sentinel, when: date, gone: undefined });

    expect(out.updatedAt).toBe(sentinel);
    expect(out.when).toBe(date);
    expect('gone' in out).toBe(false);
  });

  it('LIFE-CAST-6 — leaves null alone; only undefined is illegal in Firestore', () => {
    const out = stripUndefined({ signOf: null, where: undefined });
    expect('signOf' in out).toBe(true);
    expect(out.signOf).toBeNull();
    expect('where' in out).toBe(false);
  });

  it('LIFE-CAST-6 — returns primitives untouched', () => {
    expect(stripUndefined('x')).toBe('x');
    expect(stripUndefined(0)).toBe(0);
    expect(stripUndefined(null)).toBeNull();
  });
});
