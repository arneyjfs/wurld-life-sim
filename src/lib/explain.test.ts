import { describe, expect, it } from 'vitest';
import { parseExplanationXML } from './explain';

/**
 * SRV-PROMPT-6 — the PROMPT-BUILDER tests that used to sit above this block
 * MOVED to `functions/src/__tests__/explain.test.ts` with the prompts they
 * assert. They were not deleted: they are the only coverage those builders have
 * (Explain has no prompt-eval suite), so retiring them at the moment the server
 * copy became the only copy would have been the worst possible timing.
 *
 * The PARSER tests stay because the parser stayed — it reads the model's output
 * rather than instructing it, and the modal runs it per streamed chunk.
 */
describe('parseExplanationXML verdict (PRACTICE-EXPLAIN-4)', () => {
  it('extracts verdict="overturned" with green-light meaning', () => {
    const xml = `<explanation>
<review verdict="overturned" score="0">
The question was ambiguous — both options are valid.
</review>
<section title="Why ambiguous">
Body.
</section>
</explanation>`;
    const parsed = parseExplanationXML(xml);
    expect(parsed.review?.verdict).toBe('overturned');
    expect(parsed.review?.body).toContain('ambiguous');
    expect(parsed.sections).toHaveLength(1);
  });

  it('extracts verdict="incorrect" without overturning', () => {
    const xml = `<explanation>
<review verdict="incorrect" score="0">
The answer is wrong.
</review>
</explanation>`;
    const parsed = parseExplanationXML(xml);
    expect(parsed.review?.verdict).toBe('incorrect');
  });

  it('extracts verdict="correct" when the verdict stands', () => {
    const xml = `<explanation>
<review verdict="correct" score="0">
Correct.
</review>
</explanation>`;
    const parsed = parseExplanationXML(xml);
    expect(parsed.review?.verdict).toBe('correct');
  });
});

/**
 * MSG-PIPE-31.11 — Luna (OpenAI) sometimes writes the vocab tag as an element
 * around the word, or with a space after `<`. Both read as the self-closing
 * tag, the repeated word dropped, so the renderer sees one chip and no echo.
 */
describe('extractVocabItems quirks (MSG-PIPE-31.11)', () => {
  const section = (body: string) => parseExplanationXML(
    `<explanation><section title="Key">${body}</section></explanation>`,
  ).sections[0]!;

  it('MSG-PIPE-31.11 — <vocab …>word</vocab> reads as the self-closing tag and drops the word', () => {
    const s = section('Say <vocab phrase="avoir hâte" translation="to look forward">avoir hâte</vocab> often.');
    expect(s.vocabItems).toEqual([{ phrase: 'avoir hâte', translation: 'to look forward', explanation: undefined }]);
    expect(s.body).toBe('Say <vocab phrase="avoir hâte" translation="to look forward" /> often.');
  });

  it('MSG-PIPE-31.11 — a self-closing tag followed by the word and a stray </vocab> drops both', () => {
    const s = section('Use <vocab phrase="trop hâte" translation="so excited" />trop hâte</vocab> in texts.');
    expect(s.vocabItems.map((v) => v.phrase)).toEqual(['trop hâte']);
    expect(s.body).toBe('Use <vocab phrase="trop hâte" translation="so excited" /> in texts.');
  });

  it('MSG-PIPE-31.11 — `< vocab …/>` reads as the self-closing tag', () => {
    const s = section('Try < vocab phrase="bof" translation="meh" /> here.');
    expect(s.vocabItems.map((v) => v.phrase)).toEqual(['bof']);
    expect(s.body).toBe('Try <vocab phrase="bof" translation="meh" /> here.');
  });

  it('MSG-PIPE-31.11 — the review comment gets the phrase once, not twice', () => {
    const xml = '<explanation><review score="4">Good, <vocab phrase="chouette" translation="great">chouette</vocab> fits.</review></explanation>';
    const r = parseExplanationXML(xml).review!;
    expect(r.cleanComment).toBe('Good, chouette fits.');
    expect(r.vocabItems.map((v) => v.phrase)).toEqual(['chouette']);
  });

  it('MSG-PIPE-31.11 — well-formed self-closing tags parse exactly as before', () => {
    const body = 'A <vocab phrase="x" translation="y" explanation="z"/> and **<vocab phrase="a &amp; b" translation="c" />** end.\n\n\n\nNext';
    const s = section(body);
    expect(s.body).toBe('A <vocab phrase="x" translation="y" explanation="z"/> and **<vocab phrase="a & b" translation="c" />** end.\n\nNext');
    expect(s.vocabItems).toEqual([
      { phrase: 'x', translation: 'y', explanation: 'z' },
      { phrase: 'a & b', translation: 'c', explanation: undefined },
    ]);
  });

  it('MSG-PIPE-31.11 — a bare open tag `<vocab …>` with no closer reads as the self-closing tag', () => {
    const s = section('Here <vocab phrase="इसकी" translation="disso"> + <vocab phrase="बजाय" translation="em vez de">. Done.');
    expect(s.body).toBe('Here <vocab phrase="इसकी" translation="disso" /> + <vocab phrase="बजाय" translation="em vez de" />. Done.');
    expect(s.vocabItems.map((v) => v.phrase)).toEqual(['इसकी', 'बजाय']);
  });

  it('MSG-PIPE-31.11 — a bare open tag at the end of a line keeps the line break', () => {
    const s = section('Use <vocab phrase="my" translation="il mio">\nNext line');
    expect(s.body).toBe('Use <vocab phrase="my" translation="il mio" />\nNext line');
  });

  it('MSG-PIPE-31.11 — a stray </vocab> never swallows a following tag or a new line', () => {
    const s = section('<vocab phrase="a" translation="b"/> text <vocab phrase="c" translation="d">c</vocab>');
    expect(s.body).toBe('<vocab phrase="a" translation="b"/> text <vocab phrase="c" translation="d" />');
    expect(s.vocabItems.map((v) => v.phrase)).toEqual(['a', 'c']);
  });
});

describe('stray HTML emphasis (EXPLAIN-PHRASE-3.5)', () => {
  it('EXPLAIN-PHRASE-3.5 — <em>/<i> become *…* and <strong>/<b> become **…** in bodies; a title just loses them', () => {
    const xml = `<explanation>
<section title="What <em>it</em> means">
<em>De Lupin</em> names the series; <strong>de</strong> links it, as does <b>du</b> with <i>le</i>.
</section>
</explanation>`;
    const s = parseExplanationXML(xml).sections[0]!;
    expect(s.title).toBe('What it means');
    expect(s.body).toBe('*De Lupin* names the series; **de** links it, as does **du** with *le*.');
    expect(s.body).not.toMatch(/<\/?(em|strong|b|i)>/);
  });

  it('EXPLAIN-PHRASE-3.5 — vocab tags are untouched', () => {
    const xml = `<explanation><section title="T">See <vocab phrase="ignorieren" translation="to ignore" />.</section></explanation>`;
    const s = parseExplanationXML(xml).sections[0]!;
    expect(s.vocabItems.map((v) => v.phrase)).toEqual(['ignorieren']);
  });
});
