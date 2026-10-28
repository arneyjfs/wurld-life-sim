import { describe, expect, it } from 'vitest';
import { parseCwTags, stripVocabTagsToPlain, tokenizeVocab } from './vocabTags';

describe('parseCwTags', () => {
  it('returns empty result for plain text with no tags', () => {
    const r = parseCwTags('hello world');
    expect(r.plainText).toBe('hello world');
    expect(r.complexWords).toEqual([]);
    expect(r.wordTranslations).toEqual({});
  });

  it('extracts cw tag word + meaning', () => {
    const r = parseCwTags('I went <cw t="to the seaside">to the beach</cw> today');
    expect(r.complexWords).toEqual(['to the beach']);
    expect(r.wordTranslations['to the beach']).toBe('to the seaside');
    expect(r.plainText).toContain('to the beach');
    expect(r.plainText).not.toContain('<cw');
  });

  it('handles both <cw> and <vocab> tag names', () => {
    const r = parseCwTags('<vocab t="a">b</vocab> and <cw t="c">d</cw>');
    expect(r.complexWords).toEqual(['b', 'd']);
  });

  it('dedupes repeated words', () => {
    const r = parseCwTags(
      '<cw t="meaning">word</cw> and <cw t="meaning">word</cw>',
    );
    expect(r.complexWords).toEqual(['word']);
  });

  it('MSG-VIEW-7.12 — a legacy swap="1" attribute is ignored and stripped', () => {
    // The swap-words easy mode is retired; stored tags still carry the
    // attribute. It must neither leak into the plain text nor surface as a
    // swap list, and the word stays an ordinary complex word.
    const r = parseCwTags('je <vocab swap="1" t="umbrella">parapluie</vocab>');
    expect(r.plainText).toBe('je parapluie');
    expect(r.complexWords).toEqual(['parapluie']);
    expect(r.wordTranslations).toEqual({ parapluie: 'umbrella' });
    expect(r).not.toHaveProperty('swapWords');
  });

  // Regression: T_ATTR_REGEX used to be `t="([^"]*)"` which truncated
  // the gloss at the FIRST inner `"`. The LLM commonly writes literal
  // glosses like `t="how (lit: "all at the hour")"` — the old regex
  // captured only `how (lit: ` and the popover rendered the
  // truncated string. Fix uses a non-greedy `(.*?)` with a lookahead
  // for the next attribute boundary or end-of-attrs.
  it('preserves embedded double-quotes inside t= when followed by attribute boundary', () => {
    const r = parseCwTags(
      '<vocab t="how (lit: "all at the hour")" swap="1">tout à l\'heure</vocab>',
    );
    expect(r.wordTranslations["tout à l'heure"]).toBe(
      'how (lit: "all at the hour")',
    );
  });

  it('preserves embedded double-quotes inside t= at end of attrs', () => {
    const r = parseCwTags(
      '<vocab t="so/therefore (lit: "of the blow")">du coup</vocab>',
    );
    expect(r.wordTranslations['du coup']).toBe(
      'so/therefore (lit: "of the blow")',
    );
  });

  it('preserves embedded single-quotes inside double-quoted t=', () => {
    const r = parseCwTags(
      `<vocab t="it's a long way">c'est loin</vocab>`,
    );
    expect(r.wordTranslations["c'est loin"]).toBe("it's a long way");
  });
});

describe('stripVocabTagsToPlain', () => {
  it('removes opening and closing tags', () => {
    expect(stripVocabTagsToPlain('<cw t="x">foo</cw> bar')).toBe('foo bar');
    expect(stripVocabTagsToPlain('a <vocab t="x">b</vocab> c')).toBe('a b c');
  });

  it('returns empty for empty/undefined input', () => {
    expect(stripVocabTagsToPlain('')).toBe('');
  });
});

describe('tokenizeVocab', () => {
  it('returns single plain segment when no complex words', () => {
    expect(tokenizeVocab('hello world', [])).toEqual([
      { kind: 'plain', text: 'hello world' },
    ]);
  });

  it('emits plain + complex + plain segments around a single word', () => {
    const out = tokenizeVocab('I love croissants today', ['croissants']);
    expect(out).toEqual([
      { kind: 'plain', text: 'I love ' },
      { kind: 'complex', match: 'croissants' },
      { kind: 'plain', text: ' today' },
    ]);
  });

  it('matches multi-word phrases as one segment', () => {
    const out = tokenizeVocab('il y a un chien', ['il y a']);
    expect(out).toEqual([
      { kind: 'complex', match: 'il y a' },
      { kind: 'plain', text: ' un chien' },
    ]);
  });

  it('does not match mid-word (word-boundary aware)', () => {
    // "the" should NOT match inside "their".
    const out = tokenizeVocab('Use their car not the bus', ['the']);
    expect(
      out.filter((s) => s.kind === 'complex').map((s) => 'match' in s && s.match),
    ).toEqual(['the']);
  });

  it('prefers longer phrases when shorter ones overlap', () => {
    // Both "il" and "il y a" are complex. Longer should win.
    const out = tokenizeVocab('il y a', ['il', 'il y a']);
    expect(
      out.filter((s) => s.kind === 'complex').map((s) => 'match' in s && s.match),
    ).toEqual(['il y a']);
  });

  it('is case-insensitive but preserves the original casing', () => {
    const out = tokenizeVocab('Hello world', ['hello']);
    const complex = out.find((s) => s.kind === 'complex');
    expect(complex && 'match' in complex && complex.match).toBe('Hello');
  });

  it('handles unicode letters via \\p{L}', () => {
    const out = tokenizeVocab('Ich gehe nach Hause', ['nach Hause']);
    expect(
      out.filter((s) => s.kind === 'complex').map((s) => 'match' in s && s.match),
    ).toEqual(['nach Hause']);
  });

  it('returns empty array for empty input', () => {
    expect(tokenizeVocab('', ['a'])).toEqual([]);
  });
});

describe('MSG-BUBBLE-URL-9 — an email is kept whole by the vocab carve-out', () => {
  it('MSG-BUBBLE-URL-9 — a complex word never matches inside an email address', () => {
    expect(tokenizeVocab('mail jo@example.com today', ['example', 'today'])).toEqual([
      { kind: 'plain', text: 'mail ' },
      { kind: 'plain', text: 'jo@example.com' },
      { kind: 'plain', text: ' ' },
      { kind: 'complex', match: 'today' },
    ]);
  });

  it('MSG-BUBBLE-URL-9 — the same word outside the address still matches', () => {
    const out = tokenizeVocab('example: jo@example.com', ['example']);
    expect(out[0]).toEqual({ kind: 'complex', match: 'example' });
    expect(out).toContainEqual({ kind: 'plain', text: 'jo@example.com' });
  });
});
