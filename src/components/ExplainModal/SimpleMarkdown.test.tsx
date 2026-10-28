import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SimpleMarkdown, parseVocabTag } from './SimpleMarkdown';

/**
 * Direct tests for the hand-rolled `<vocab .../>` parser. The parser is
 * exported separately so we can pin its edge-cases without spinning up
 * React. The component-level tests below confirm the parser plays nicely
 * with `SimpleMarkdown`'s inline-render path.
 */
describe('parseVocabTag', () => {
  it('parses a basic vocab tag', () => {
    const text = '<vocab phrase="hola" translation="hello" />';
    const result = parseVocabTag(text, 0);
    expect(result).not.toBeNull();
    expect(result!.attrs).toEqual({ phrase: 'hola', translation: 'hello' });
    expect(result!.end).toBe(text.length);
  });

  it('tolerates a `>` inside a quoted attribute value', () => {
    // The old regex `<vocab\s([^>]*?)\/>` would stop at the first `>`
    // inside the phrase, parsing this as a broken tag.
    const text = '<vocab phrase="pas > 10" lang="fr" />';
    const result = parseVocabTag(text, 0);
    expect(result).not.toBeNull();
    expect(result!.attrs.phrase).toBe('pas > 10');
    expect(result!.attrs.lang).toBe('fr');
    expect(result!.end).toBe(text.length);
  });

  it('tolerates single-quoted attribute values', () => {
    const text = `<vocab phrase='ça va' translation='how are you' />`;
    const result = parseVocabTag(text, 0);
    expect(result).not.toBeNull();
    expect(result!.attrs.phrase).toBe('ça va');
  });

  it('returns null for malformed tags', () => {
    expect(parseVocabTag('<vocab phrase=hello />', 0)).toBeNull();
    expect(parseVocabTag('<vocab phrase="x"', 0)).toBeNull();
    // No whitespace after `<vocab` — must not match `<vocabulary>`.
    expect(parseVocabTag('<vocabulary />', 0)).toBeNull();
  });
});

describe('SimpleMarkdown — vocab rendering', () => {
  it('renders a `<vocab />` chip with a `>` in the phrase without crashing', () => {
    const source = 'See: <vocab phrase="pas > 10" translation="more than ten" /> ok';
    render(<SimpleMarkdown source={source} />);
    // The phrase should appear verbatim — the `>` is preserved.
    expect(screen.getByText('pas > 10')).toBeInTheDocument();
    expect(screen.getByText(/more than ten/)).toBeInTheDocument();
    expect(screen.getByText(/See:/)).toBeInTheDocument();
    expect(screen.getByText(/ok/)).toBeInTheDocument();
  });

  it('falls back to plain text on malformed vocab tags', () => {
    // No closing `/>` — the renderer should not crash.
    const source = 'broken <vocab phrase="x" and the rest';
    const { container } = render(<SimpleMarkdown source={source} />);
    expect(container.textContent).toContain('broken');
    expect(container.textContent).toContain('and the rest');
  });

  it('renders bold/italic/code outside vocab tags', () => {
    const source = '**bold** *italic* `code` and <vocab phrase="x" translation="y" />.';
    const { container } = render(<SimpleMarkdown source={source} />);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('code')?.textContent).toBe('code');
  });
});

describe('SimpleMarkdown — links (SEC-APP-1)', () => {
  it('SEC-APP-1 — a javascript: link renders as plain text with no <a href>', () => {
    const { container } = render(
      <SimpleMarkdown source={'Click [here](javascript:alert(1)) now'} />,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('here');
  });

  it('SEC-APP-1 — an https: link keeps its anchor', () => {
    const { container } = render(<SimpleMarkdown source={'See [docs](https://wurld.chat/x)'} />);
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a!.getAttribute('href')).toBe('https://wurld.chat/x');
  });
});
