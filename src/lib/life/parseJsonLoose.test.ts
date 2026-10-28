/**
 * LIFE-FAIL-11 — a complete object followed by junk is still a good object.
 *
 * Spec: docs/specs/life-sim.md — LIFE-FAIL-11 (and LIFE-WORLD-SAGA-9, the
 * placeholder-saga failure this reaches by a different route).
 *
 * THE BUG THESE EXIST FOR. Measured 2026-08-03 against real Gemini: 2 of 6
 * `life_world_saga` responses failed `JSON.parse` with "Unexpected
 * non-whitespace character AFTER JSON". `runWorldSagaGenerate` does not retry a
 * parse failure — it falls straight to `trivialSaga`, so the player silently
 * received the placeholder world instead of the saga the model had in fact
 * written correctly.
 *
 * The scanner cases below are the ones a regex gets wrong, which is why there
 * is a scanner: braces inside strings, escaped quotes, and nesting.
 */
import { describe, expect, it } from 'vitest';
import { extractFirstJsonValue, parseJsonLoose, stripFences } from './parseJsonLoose';

describe('LIFE-FAIL-11 — parseJsonLoose', () => {
  it('parses ordinary clean JSON unchanged', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('  \n {"a":[1,2]} \n ')).toEqual({ a: [1, 2] });
  });

  it('THE REPORTED CASE — a complete object followed by trailing prose', () => {
    const raw = '{"title":"Les Marées","tone":"warm"}\n\nI hope this saga works well!';
    expect(parseJsonLoose(raw)).toEqual({ title: 'Les Marées', tone: 'warm' });
  });

  it('salvages when a SECOND object follows the first', () => {
    // The other shape the failure can take: the model emits the answer, then
    // starts over. The first complete value is the answer.
    expect(parseJsonLoose('{"a":1}\n{"b":2}')).toEqual({ a: 1 });
  });

  it('strips a ```json fence, with or without trailing junk', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('```json\n{"a":1}\n```\nDone.')).toEqual({ a: 1 });
  });

  it('does NOT close early on a brace inside a string', () => {
    // The saga SI is full of literal braces in its example prose, and the model
    // echoes them. A regex-based "first }" would truncate here.
    const raw = '{"premise":"the shape is {like this}","tone":"warm"} trailing';
    expect(parseJsonLoose(raw)).toEqual({
      premise: 'the shape is {like this}',
      tone: 'warm',
    });
  });

  it('does NOT close early on an ESCAPED quote before a brace', () => {
    const raw = '{"t":"she said \\"go} now\\"","x":1} junk';
    expect(parseJsonLoose(raw)).toEqual({ t: 'she said "go} now"', x: 1 });
  });

  it('handles nesting to depth', () => {
    const raw = '{"a":{"b":{"c":[{"d":1}]}}} tail';
    expect(parseJsonLoose(raw)).toEqual({ a: { b: { c: [{ d: 1 }] } } });
  });

  it('salvages a top-level ARRAY too', () => {
    expect(parseJsonLoose('[{"a":1}] and then some words')).toEqual([{ a: 1 }]);
  });

  it('returns undefined when the object never closes — TRUNCATION is not salvage', () => {
    // A cut-off response is a real failure and must stay one: half a saga is
    // worse than the placeholder, because it would pass schema-patching and
    // become the world's permanent through-line.
    expect(parseJsonLoose('{"a":1,"b":')).toBeUndefined();
    expect(extractFirstJsonValue('{"a":1,"b":')).toBeNull();
  });

  it('returns undefined for prose with no JSON at all', () => {
    expect(parseJsonLoose('I cannot help with that request.')).toBeUndefined();
  });

  it('distinguishes a model that legitimately returned null from a failure', () => {
    // `undefined` is the failure signal precisely so `null` stays usable.
    expect(parseJsonLoose('null')).toBeNull();
    expect(parseJsonLoose('garbage')).toBeUndefined();
  });
});

describe('LIFE-FAIL-11 — stripFences', () => {
  it('leaves unfenced text alone', () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });

  it('removes the opening fence line and the closing fence', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
});
