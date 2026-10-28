import { describe, expect, it } from 'vitest';
import { parseMessageMarkdown, type MdBlock, type MdInline } from './messageMarkdown';

function asInline(blocks: MdBlock[]): MdInline[] {
  expect(blocks).toHaveLength(1);
  const block = blocks[0]!;
  expect(block.kind).toBe('paragraph');
  if (block.kind !== 'paragraph') throw new Error('not a paragraph');
  return block.children;
}

describe('parseMessageMarkdown — plain text', () => {
  it('round-trips a single plain word', () => {
    const inline = asInline(parseMessageMarkdown('hello'));
    expect(inline).toEqual([{ kind: 'text', text: 'hello' }]);
  });

  it('round-trips a plain sentence with punctuation', () => {
    const inline = asInline(parseMessageMarkdown('Hello, world! How are you?'));
    expect(inline).toEqual([{ kind: 'text', text: 'Hello, world! How are you?' }]);
  });

  it('inserts <br> for a single newline inside a paragraph', () => {
    const inline = asInline(parseMessageMarkdown('line one\nline two'));
    expect(inline).toEqual([
      { kind: 'text', text: 'line one' },
      { kind: 'br' },
      { kind: 'text', text: 'line two' },
    ]);
  });

  it('splits paragraphs on a blank line', () => {
    const blocks = parseMessageMarkdown('first\n\nsecond');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('paragraph');
    expect(blocks[1]?.kind).toBe('paragraph');
  });
});

describe('parseMessageMarkdown — emphasis (WhatsApp-style)', () => {
  it('parses *bold* with single asterisks', () => {
    const inline = asInline(parseMessageMarkdown('this is *bold* text'));
    expect(inline).toEqual([
      { kind: 'text', text: 'this is ' },
      { kind: 'bold', children: [{ kind: 'text', text: 'bold' }] },
      { kind: 'text', text: ' text' },
    ]);
  });

  it('parses _italic_ with single underscores', () => {
    const inline = asInline(parseMessageMarkdown('this is _italic_ text'));
    expect(inline).toEqual([
      { kind: 'text', text: 'this is ' },
      { kind: 'italic', children: [{ kind: 'text', text: 'italic' }] },
      { kind: 'text', text: ' text' },
    ]);
  });

  it('parses ~strike~ with single tildes', () => {
    const inline = asInline(parseMessageMarkdown('this is ~gone~ text'));
    expect(inline).toEqual([
      { kind: 'text', text: 'this is ' },
      { kind: 'strike', children: [{ kind: 'text', text: 'gone' }] },
      { kind: 'text', text: ' text' },
    ]);
  });

  it('does not italicise underscores inside a word (snake_case)', () => {
    const inline = asInline(parseMessageMarkdown('foo_bar_baz remains plain'));
    expect(inline).toEqual([
      { kind: 'text', text: 'foo_bar_baz remains plain' },
    ]);
  });

  it('does not bold asterisks inside a number (5*3=15)', () => {
    const inline = asInline(parseMessageMarkdown('5*3*=15'));
    expect(inline).toEqual([{ kind: 'text', text: '5*3*=15' }]);
  });

  it('renders doubled markers as literal text (**hi** stays plain)', () => {
    const inline = asInline(parseMessageMarkdown('this is **hi** text'));
    expect(inline).toEqual([{ kind: 'text', text: 'this is **hi** text' }]);
  });

  it('renders doubled strike as literal text (~~hi~~ stays plain)', () => {
    const inline = asInline(parseMessageMarkdown('this is ~~hi~~ text'));
    expect(inline).toEqual([{ kind: 'text', text: 'this is ~~hi~~ text' }]);
  });

  it('parses bold at the start of a line', () => {
    const inline = asInline(parseMessageMarkdown('*bold* start'));
    expect(inline[0]).toEqual({
      kind: 'bold',
      children: [{ kind: 'text', text: 'bold' }],
    });
  });

  it('nests italic inside bold', () => {
    const inline = asInline(parseMessageMarkdown('*bold _and_ italic*'));
    expect(inline).toHaveLength(1);
    const bold = inline[0];
    expect(bold?.kind).toBe('bold');
    if (bold?.kind !== 'bold') return;
    expect(bold.children).toEqual([
      { kind: 'text', text: 'bold ' },
      { kind: 'italic', children: [{ kind: 'text', text: 'and' }] },
      { kind: 'text', text: ' italic' },
    ]);
  });
});

describe('parseMessageMarkdown — links', () => {
  it('parses [label](url)', () => {
    const inline = asInline(parseMessageMarkdown('see [docs](https://example.com) here'));
    expect(inline).toEqual([
      { kind: 'text', text: 'see ' },
      {
        kind: 'link',
        href: 'https://example.com',
        children: [{ kind: 'text', text: 'docs' }],
      },
      { kind: 'text', text: ' here' },
    ]);
  });

  it('allows emphasis inside a link label', () => {
    const inline = asInline(parseMessageMarkdown('[*bold link*](https://x.com)'));
    const link = inline[0];
    expect(link?.kind).toBe('link');
    if (link?.kind !== 'link') return;
    expect(link.children[0]?.kind).toBe('bold');
  });
});

describe('parseMessageMarkdown — bullet lists', () => {
  it('parses a dash-prefixed list as a list block with items', () => {
    const blocks = parseMessageMarkdown('- one\n- two\n- three');
    expect(blocks).toHaveLength(1);
    const list = blocks[0];
    expect(list?.kind).toBe('list');
    if (list?.kind !== 'list') return;
    expect(list.items).toHaveLength(3);
    expect(list.items[0]).toEqual([{ kind: 'text', text: 'one' }]);
    expect(list.items[1]).toEqual([{ kind: 'text', text: 'two' }]);
    expect(list.items[2]).toEqual([{ kind: 'text', text: 'three' }]);
  });

  it('parses asterisk-prefixed lines as a list (WhatsApp accepts * and -)', () => {
    const blocks = parseMessageMarkdown('* one\n* two');
    expect(blocks).toHaveLength(1);
    const list = blocks[0];
    expect(list?.kind).toBe('list');
    if (list?.kind !== 'list') return;
    expect(list.items).toHaveLength(2);
    expect(list.items[0]).toEqual([{ kind: 'text', text: 'one' }]);
    expect(list.items[1]).toEqual([{ kind: 'text', text: 'two' }]);
  });

  it('does not confuse inline *bold* with a bullet (no space after marker)', () => {
    const blocks = parseMessageMarkdown('*bold* line');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('paragraph');
  });

  it('parses emphasis inside a list item', () => {
    const blocks = parseMessageMarkdown('- *first*\n- _second_');
    const list = blocks[0];
    if (list?.kind !== 'list') throw new Error('expected list');
    expect(list.items[0]?.[0]?.kind).toBe('bold');
    expect(list.items[1]?.[0]?.kind).toBe('italic');
  });

  it('separates a paragraph from a following list', () => {
    const blocks = parseMessageMarkdown('Intro\n- one\n- two');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('paragraph');
    expect(blocks[1]?.kind).toBe('list');
  });
});

describe('parseMessageMarkdown — pathological input', () => {
  it('leaves a single unbalanced asterisk as plain text', () => {
    const inline = asInline(parseMessageMarkdown('one * two'));
    expect(inline).toEqual([{ kind: 'text', text: 'one * two' }]);
  });

  it('leaves an unbalanced link as plain text, but still autolinks the URL inside it', () => {
    // ⚠ AMENDED for MSG-BUBBLE-URL-1. This asserted the whole string stayed
    // text, which was right when the ONLY way to get an anchor was
    // `[label](href)`. Its intent — "malformed markdown must not be repaired
    // into a markdown link" — is unchanged and still asserted: no `docs` label
    // appears, and every literal character the user typed survives.
    //
    // What changed is that `https://example.com` is a real URL the user typed,
    // and MSG-BUBBLE-URL-1 says a bare URL in text linkifies wherever it sits.
    // Refusing to link it because a nearby bracket is unbalanced would make
    // the feature depend on unrelated punctuation.
    const inline = asInline(parseMessageMarkdown('see [docs(https://example.com)'));
    expect(inline).toEqual([
      { kind: 'text', text: 'see [docs(' },
      {
        kind: 'link',
        href: 'https://example.com',
        children: [{ kind: 'text', text: 'https://example.com' }],
      },
      // The unmatched `)` is sentence punctuation, not part of the href
      // (MSG-BUBBLE-URL-2), so it survives as text.
      { kind: 'text', text: ')' },
    ]);
  });

  it('does not let bold span paragraph breaks', () => {
    // A bold that "opens" but whose closing marker is past a blank
    // line should not greedily eat the second paragraph.
    const blocks = parseMessageMarkdown('open *bold\n\nnew para*');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('paragraph');
    expect(blocks[1]?.kind).toBe('paragraph');
  });
});

describe('parseMessageMarkdown — headings (opt-in, broadcasts)', () => {
  it('parses ## as a level-2 heading when headings enabled', () => {
    const blocks = parseMessageMarkdown('## Title', { headings: true });
    expect(blocks).toEqual([
      { kind: 'heading', level: 2, children: [{ kind: 'text', text: 'Title' }] },
    ]);
  });

  it('captures heading level from the number of # marks', () => {
    expect(parseMessageMarkdown('# A', { headings: true })[0]).toMatchObject({ level: 1 });
    expect(parseMessageMarkdown('### A', { headings: true })[0]).toMatchObject({ level: 3 });
  });

  it('does NOT parse headings by default (regular chat stays WhatsApp-style)', () => {
    const blocks = parseMessageMarkdown('## Title');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('paragraph');
  });

  it('parses headings WITHOUT a space after the marker (##Title, lenient)', () => {
    // Broadcast authors + LLM-translated copy often drop the space; both
    // `## Title` and `##Title` must render as headings.
    expect(parseMessageMarkdown('##Title', { headings: true })[0]).toMatchObject({
      kind: 'heading',
      level: 2,
    });
    expect(parseMessageMarkdown('###Three', { headings: true })[0]).toMatchObject({
      kind: 'heading',
      level: 3,
    });
  });

  it('bare hashes with no content are NOT a heading', () => {
    expect(parseMessageMarkdown('###', { headings: true })[0]?.kind).toBe('paragraph');
    expect(parseMessageMarkdown('##   ', { headings: true })[0]?.kind).toBe('paragraph');
  });

  it('parses inline emphasis inside a heading', () => {
    const blocks = parseMessageMarkdown('## A *bold* heading', { headings: true });
    const h = blocks[0];
    expect(h?.kind).toBe('heading');
    if (h?.kind !== 'heading') return;
    expect(h.children.some((c) => c.kind === 'bold')).toBe(true);
  });

  it('separates a heading from the following paragraph', () => {
    const blocks = parseMessageMarkdown('## Heading\nbody text', { headings: true });
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.kind).toBe('heading');
    expect(blocks[1]?.kind).toBe('paragraph');
  });
});

// ───────────────────────────────────────────────────────────────────
// Link href safety. `[label](href)` is the ONLY construct that reaches
// an `<a href>` (BubbleRows.tsx renderInline), and message bodies are
// attacker-controlled: a peer can type any markdown, and the
// translator/tutor LLM can echo it back. So the PARSER is the choke
// point — an unsafe scheme must never reach the AST as a `link` node.
// Rejected input degrades to literal text (the reader sees the raw
// `[label](href)`), never to a clickable script URL.
// ───────────────────────────────────────────────────────────────────

/** Deep-search a block list for any `link` node. */
function findLinks(blocks: MdBlock[]): Extract<MdInline, { kind: 'link' }>[] {
  const out: Extract<MdInline, { kind: 'link' }>[] = [];
  const walk = (nodes: MdInline[]): void => {
    for (const n of nodes) {
      if (n.kind === 'link') {
        out.push(n);
        walk(n.children);
      } else if ('children' in n) {
        walk(n.children);
      }
    }
  };
  for (const b of blocks) {
    if (b.kind === 'list') b.items.forEach(walk);
    else walk(b.children);
  }
  return out;
}

describe('MSG-BUBBLE-MD — link href scheme allowlist', () => {
  const ALLOWED: [string, string, string][] = [
    ['https', '[x](https://example.com)', 'https://example.com'],
    ['http', '[x](http://example.com)', 'http://example.com'],
    ['mailto', '[x](mailto:bob@example.com)', 'mailto:bob@example.com'],
    ['uppercase scheme is normalised, not rejected', '[x](HTTPS://EXAMPLE.COM)', 'HTTPS://EXAMPLE.COM'],
    ['query + fragment survive', '[x](https://e.com/a?b=1#c)', 'https://e.com/a?b=1#c'],
  ];

  for (const [name, src, href] of ALLOWED) {
    it(`MSG-BUBBLE-MD — allows ${name}`, () => {
      const links = findLinks(parseMessageMarkdown(src));
      expect(links).toHaveLength(1);
      expect(links[0]!.href).toBe(href);
    });
  }

  const REJECTED: [string, string][] = [
    ['javascript:', '[x](javascript:alert(1))'],
    ['mixed-case javascript:', '[x](JaVaScRiPt:alert(1))'],
    ['all-caps JAVASCRIPT:', '[x](JAVASCRIPT:alert(1))'],
    ['data: html', '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
    ['data: svg', '[x](data:image/svg+xml,<svg onload=alert(1)>)'],
    ['vbscript:', '[x](vbscript:msgbox(1))'],
    ['file:', '[x](file:///etc/passwd)'],
    ['leading C0 control char', '[x](\u0001javascript:alert(1))'],
    ['leading NUL', '[x](\u0000javascript:alert(1))'],
    ['leading DEL', '[x](\u007Fjavascript:alert(1))'],
    ['TAB inside the scheme', '[x](java\u0009script:alert(1))'],
    ['CR inside the scheme', '[x](java\u000Dscript:alert(1))'],
    ['LF inside the scheme', '[x](java\u000Ascript:alert(1))'],
    ['NUL inside the scheme', '[x](java\u0000script:alert(1))'],
    ['leading U+200B zero-width space', '[x](\u200Bjavascript:alert(1))'],
    ['HTML-entity obfuscated scheme', '[x](&#106;avascript:alert(1))'],
    ['unknown custom scheme', '[x](wurld-evil:do-a-thing)'],
  ];

  for (const [name, src] of REJECTED) {
    it(`MSG-BUBBLE-MD — rejects ${name}`, () => {
      expect(findLinks(parseMessageMarkdown(src))).toEqual([]);
    });
  }

  it('MSG-BUBBLE-MD — a rejected link degrades to literal text, losing no characters', () => {
    const src = 'look [here](javascript:alert(1)) now';
    const blocks = parseMessageMarkdown(src);
    expect(findLinks(blocks)).toEqual([]);
    const flat = JSON.stringify(blocks);
    expect(flat).toContain('here');
    expect(flat).toContain('look ');
    expect(flat).toContain(' now');
  });

  it('MSG-BUBBLE-MD — a rejected link does not suppress a later valid one', () => {
    const blocks = parseMessageMarkdown('[a](javascript:alert(1)) and [b](https://ok.com)');
    const links = findLinks(blocks);
    expect(links).toHaveLength(1);
    expect(links[0]!.href).toBe('https://ok.com');
  });

  it('MSG-BUBBLE-MD — rejection survives nesting inside emphasis', () => {
    expect(findLinks(parseMessageMarkdown('*[x](javascript:alert(1))*'))).toEqual([]);
  });

  it('MSG-BUBBLE-MD — rejection applies inside a bullet list item', () => {
    expect(findLinks(parseMessageMarkdown('- [x](javascript:alert(1))'))).toEqual([]);
  });

  it('MSG-BUBBLE-MD — rejection applies inside a heading', () => {
    expect(
      findLinks(parseMessageMarkdown('## [x](javascript:alert(1))', { headings: true })),
    ).toEqual([]);
  });
});

/**
 * MSG-BUBBLE-URL-1..5 — bare URLs are links.
 *
 * Reported as "urls often do not render as clickable". Measured before any
 * change: it was NEVER. The only producer of a link node was `[label](href)`
 * markdown, which nobody types into a chat composer, so every bare URL — mid
 * sentence or as the whole message — rendered as plain text.
 */
describe('MSG-BUBBLE-URL — bare URLs linkify', () => {
  /** Every link node in the tree, flattened, as [href, visible text]. */
  const links = (src: string): Array<[string, string]> => {
    const out: Array<[string, string]> = [];
    const textOf = (nodes: MdInline[]): string =>
      nodes
        .map((n) =>
          n.kind === 'text' ? n.text : 'children' in n ? textOf(n.children) : '',
        )
        .join('');
    const walk = (nodes: MdInline[]) => {
      for (const n of nodes) {
        if (n.kind === 'link') out.push([n.href, textOf(n.children)]);
        if ('children' in n) walk(n.children);
      }
    };
    for (const b of parseMessageMarkdown(src)) {
      if (b.kind === 'list') b.items.forEach(walk);
      else walk(b.children);
    }
    return out;
  };

  it('MSG-BUBBLE-URL-1 — the whole message being a URL (path b of the report)', () => {
    expect(links('https://example.com')).toEqual([['https://example.com', 'https://example.com']]);
    expect(links('https://example.com/a/b?q=1#frag')).toEqual([
      ['https://example.com/a/b?q=1#frag', 'https://example.com/a/b?q=1#frag'],
    ]);
  });

  it('MSG-BUBBLE-URL-1 — a URL inside a sentence (path a of the report)', () => {
    expect(links("have a look at https://example.com it's good")).toEqual([
      ['https://example.com', 'https://example.com'],
    ]);
    // Translated text is not a special case — the pipeline keeps URLs intact,
    // so this is the same path. Pinned because "it only breaks in French" was
    // a live theory.
    expect(links("regarde https://example.com c'est bien")).toEqual([
      ['https://example.com', 'https://example.com'],
    ]);
  });

  it('MSG-BUBBLE-URL-2 — trailing sentence punctuation is not part of the href', () => {
    // The commonest shape in real prose. Swallowing the full stop produces a
    // 404 that LOOKS like it works, which is worse than no link.
    expect(links('see https://example.com.')[0]?.[0]).toBe('https://example.com');
    expect(links('see https://example.com, then go')[0]?.[0]).toBe('https://example.com');
    expect(links('really?? https://example.com?!')[0]?.[0]).toBe('https://example.com');
  });

  it('MSG-BUBBLE-URL-2 — an unmatched closing bracket is dropped, a matched one is kept', () => {
    expect(links('see (https://example.com) ok')[0]?.[0]).toBe('https://example.com');
    // ...but a URL that legitimately contains parens keeps them. Wikipedia is
    // the case everyone gets wrong.
    expect(links('https://en.wikipedia.org/wiki/Foo_(bar)')[0]?.[0]).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    );
  });

  it('MSG-BUBBLE-URL-3 — www. resolves to https, and case does not matter', () => {
    expect(links('go to www.example.com now')).toEqual([
      ['https://www.example.com', 'www.example.com'],
    ]);
    expect(links('www.example.com')[0]?.[0]).toBe('https://www.example.com');
    expect(links('HTTPS://EXAMPLE.COM')[0]?.[0]).toBe('HTTPS://EXAMPLE.COM');
  });

  it('MSG-BUBBLE-URL-3 — autolinks go through the SAME allowlist as markdown links', () => {
    // One sanitizer. A second linkification path with its own check is how the
    // first one's fix silently stops applying.
    expect(links('javascript:alert(1)')).toEqual([]);
    expect(links('data:text/html;base64,AAAA')).toEqual([]);
  });

  it('MSG-BUBBLE-URL-1 — no text is lost and surrounding words survive', () => {
    const blocks = parseMessageMarkdown('a https://example.com b');
    const flat = JSON.stringify(blocks);
    expect(flat).toContain('"a "');
    expect(flat).toContain('" b"');
  });

  it('MSG-BUBBLE-URL — a markdown link is NOT double-linked', () => {
    // The nesting trap: the label is parsed as inline content, so a URL used
    // as its own label would autolink INSIDE the anchor and emit <a> in <a>.
    expect(links('[docs](https://example.com)')).toEqual([
      ['https://example.com', 'docs'],
    ]);
    expect(links('[https://a.example](https://b.example)')).toEqual([
      ['https://b.example', 'https://a.example'],
    ]);
  });

  it('MSG-BUBBLE-URL — composes with emphasis', () => {
    expect(links('*look at https://example.com*')[0]?.[0]).toBe('https://example.com');
  });

  // ── Email addresses (2026-10-13 owner report: "the regex doesn't catch
  // email addresses"). Same seam, same allowlist, mailto: href.
  it('MSG-BUBBLE-URL-6 — an email inside prose links to mailto:, text is the address', () => {
    expect(links('write to jo@example.com about it')).toEqual([
      ['mailto:jo@example.com', 'jo@example.com'],
    ]);
    expect(links('jo.smith+tag@mail.example.co.uk')).toEqual([
      ['mailto:jo.smith+tag@mail.example.co.uk', 'jo.smith+tag@mail.example.co.uk'],
    ]);
    // No text lost around it.
    const flat = JSON.stringify(parseMessageMarkdown('write to jo@example.com about it'));
    expect(flat).toContain('"write to "');
    expect(flat).toContain('" about it"');
  });

  it('MSG-BUBBLE-URL-7 — trailing sentence punctuation is not part of the address', () => {
    expect(links('mail me at jo@example.com.')).toEqual([
      ['mailto:jo@example.com', 'jo@example.com'],
    ]);
    expect(links('jo@example.com, or ring')[0]).toEqual(['mailto:jo@example.com', 'jo@example.com']);
    expect(links('(jo@example.com)')[0]).toEqual(['mailto:jo@example.com', 'jo@example.com']);
    const flat = JSON.stringify(parseMessageMarkdown('mail me at jo@example.com.'));
    expect(flat).toContain('"."');
  });

  it('MSG-BUBBLE-URL-7 — no false positives: handles, missing TLD, 1-letter TLD, double @', () => {
    expect(links('ping @handle later')).toEqual([]);
    expect(links('a@b')).toEqual([]);
    expect(links('a@b.c')).toEqual([]);
    expect(links('a@@b.com')).toEqual([]);
    expect(links('meet @ 5pm.ok')).toEqual([]);
    expect(links('x@1.23')).toEqual([]);
  });

  it('MSG-BUBBLE-URL-7 — an @ inside a URL stays part of the URL', () => {
    expect(links('see https://example.com/@jo now')).toEqual([
      ['https://example.com/@jo', 'https://example.com/@jo'],
    ]);
    expect(links('https://jo@example.com/x')).toEqual([
      ['https://jo@example.com/x', 'https://jo@example.com/x'],
    ]);
  });

  it('MSG-BUBBLE-URL-6 — URLs and emails in one message both link, in order', () => {
    expect(links('site https://example.com mail jo@example.com')).toEqual([
      ['https://example.com', 'https://example.com'],
      ['mailto:jo@example.com', 'jo@example.com'],
    ]);
  });

  it('MSG-BUBBLE-URL-6 — a markdown mailto link is not double-linked', () => {
    expect(links('[Jo](mailto:jo@example.com)')).toEqual([['mailto:jo@example.com', 'Jo']]);
    expect(links('[jo@example.com](mailto:jo@example.com)')).toEqual([
      ['mailto:jo@example.com', 'jo@example.com'],
    ]);
  });
});
