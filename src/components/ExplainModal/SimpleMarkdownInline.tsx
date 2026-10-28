import { type ReactNode } from 'react';
import { Loader } from 'lucide-react';
import { FlashcardIcon } from '@/components/FlashcardIcon';
import { CardListenButton } from '@/components/CardListenButton';
import { cn } from '@/lib/cn';
import { safeHref } from '@/lib/messageMarkdown';
import { onExternalLinkClick } from '@/lib/openExternal';

/**
 * Inline renderer for the ExplainModal markdown. Splits a string into a
 * mix of `<vocab .../>` chips and emphasis runs (bold / italic / strike /
 * code / link) and produces React nodes the parent block element can drop
 * straight into the DOM.
 *
 * Why it lives in its own file: extracted from SimpleMarkdown.tsx so that
 * file can stay under the 600-LOC cap once strike/link and the vocab-aware
 * matcher pushed it past the limit.
 *
 * ── Composition with vocab chips ────────────────────────────────────────
 *
 * The AI emits `**<vocab .../>**` to make a vocab term render as both a
 * tappable chip AND bold. A naïve implementation that splits on vocab
 * tags first and runs the markdown matcher on each text fragment will
 * leak the asterisks — the `**` on either side ends up in different
 * fragments with the chip between them, so the bold regex can't find a
 * balanced pair.
 *
 * Fix: we pre-tokenise the input as a sequence of `(text | vocab)`
 * atoms, then rewrite each vocab atom as a single Unicode private-use
 * placeholder (U+E000…U+E000+N). The markdown regexes see one continuous
 * string with placeholders that are not `*` / `_` / `~` / `` ` ``, so
 * they match across them naturally. After matching, every placeholder
 * inside an emphasis run is restored as a `<VocabChip>` — the chip
 * inherits font-weight / italic / strikethrough from its parent
 * `<strong>` / `<em>` / strike `<span>` via the normal CSS cascade.
 */

export type VocabState = {
  saved: Set<string>;
  saving: string | null;
  onSave: (phrase: string, translation: string) => void;
  /** CARDS-TTS-1 — the phrases' practice language; set → each chip gets a speaker. */
  speakLanguage?: string;
};

type ParsedVocab = {
  attrs: Record<string, string>;
  end: number;
};

/**
 * Hand-rolled `<vocab .../>` parser. The old regex `<vocab\s([^>]*?)\/>`
 * stopped at the first `>` it saw, so a phrase like `"pas > 10"` broke
 * the parse. This walks attributes one at a time, respecting single- and
 * double-quoted values, and only closes the tag on a literal `/>`.
 *
 * Returns `null` on any malformed input — caller falls back to plain
 * text.
 */
export function parseVocabTag(text: string, openIdx: number): ParsedVocab | null {
  const TAG_OPEN = '<vocab';
  if (!text.startsWith(TAG_OPEN, openIdx)) return null;
  let i = openIdx + TAG_OPEN.length;
  if (i >= text.length || !/\s/.test(text[i] ?? '')) return null;
  const attrs: Record<string, string> = {};
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i] ?? '')) i += 1;
    if (i >= text.length) return null;
    if (text[i] === '/' && text[i + 1] === '>') {
      return { attrs, end: i + 2 };
    }
    const nameStart = i;
    if (!/[A-Za-z_]/.test(text[i] ?? '')) return null;
    i += 1;
    while (i < text.length && /[A-Za-z0-9_-]/.test(text[i] ?? '')) i += 1;
    const name = text.slice(nameStart, i);
    if (text[i] !== '=') return null;
    i += 1;
    const quote = text[i];
    if (quote !== '"' && quote !== "'") return null;
    i += 1;
    const valueStart = i;
    while (i < text.length && text[i] !== quote) i += 1;
    if (i >= text.length) return null;
    attrs[name] = text.slice(valueStart, i);
    i += 1;
  }
  return null;
}

function decodeAttr(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

type VocabAtom = { phrase: string; translation: string };

const PLACEHOLDER_BASE = 0xe000;

/**
 * Extract every `<vocab .../>` tag from `text`. Return a rewritten string
 * where each tag has been replaced with a unique single-codepoint
 * placeholder, plus the parallel list of vocab atoms keyed by the
 * placeholder's offset from U+E000.
 *
 * Single-codepoint placeholders are important: the inline regexes use
 * character classes like `[^*]` which count code units, not graphemes —
 * a 1-char placeholder is treated as one "content" char by `[^*]+`, so a
 * run like `****` matches as bold.
 */
function tokeniseVocab(text: string): { rewritten: string; atoms: VocabAtom[] } {
  const atoms: VocabAtom[] = [];
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '<' && text.startsWith('<vocab', i)) {
      const parsed = parseVocabTag(text, i);
      if (parsed) {
        const phrase = decodeAttr(parsed.attrs.phrase ?? '');
        const translation = decodeAttr(parsed.attrs.translation ?? '');
        if (phrase) {
          out += String.fromCharCode(PLACEHOLDER_BASE + atoms.length);
          atoms.push({ phrase, translation });
        }
        i = parsed.end;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return { rewritten: out, atoms };
}

function isPlaceholder(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= PLACEHOLDER_BASE && code < PLACEHOLDER_BASE + 0x1000;
}

function placeholderIndex(ch: string): number {
  return ch.charCodeAt(0) - PLACEHOLDER_BASE;
}

/**
 * Inline matcher. Finds the earliest emphasis / code / link / placeholder
 * boundary in `text` and returns it as a typed node, or `null` if the
 * rest of the string is pure literal text. Recursive: emphasis inner runs
 * are re-parsed so a bold run containing a vocab placeholder works.
 *
 * We avoid the `g` flag + `lastIndex` walk the old renderer used because
 * a single failed match (e.g. a stray `*`) would skip past the cursor
 * and lose subsequent valid runs.
 */
type Match = {
  start: number;
  end: number;
  build: () => ReactNode;
};

const BOLD_RE = /\*\*([^*]+)\*\*/;
const ITALIC_AST_RE = /\*([^*]+)\*/;
const ITALIC_UND_RE = /(?:^|[^\p{L}\p{N}_])_([^_\n]+?)_(?![\p{L}\p{N}_])/u;
const STRIKE_RE = /~~([^~]+)~~/;
const CODE_RE = /`([^`]+)`/;
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/;

function findEmphasis(
  re: RegExp,
  text: string,
  innerIndex: number,
  build: (inner: string) => ReactNode,
): Match | null {
  const m = re.exec(text);
  if (!m) return null;
  const inner = m[innerIndex] ?? '';
  // Italic underscore regex has a boundary prefix in the match — locate
  // the literal `_…_` inside it.
  const literal = innerIndex === 1 && re === ITALIC_UND_RE ? `_${inner}_` : m[0];
  const start = m.index + m[0].length - literal.length;
  return { start, end: start + literal.length, build: () => build(inner) };
}

function findFirst(
  text: string,
  keyBase: string,
  vocab: VocabState | undefined,
  atoms: VocabAtom[],
): Match | null {
  let best: Match | null = null;
  const consider = (m: Match | null) => {
    if (!m) return;
    if (!best || m.start < best.start) best = m;
  };

  // Placeholders. Earliest placeholder in `text` is the boundary.
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (isPlaceholder(ch)) {
      const idx = placeholderIndex(ch);
      const atom = atoms[idx];
      if (atom) {
        consider({
          start: i,
          end: i + 1,
          build: () => (
            <VocabChip
              key={`${keyBase}-v-${idx}`}
              phrase={atom.phrase}
              translation={atom.translation}
              saved={!!vocab?.saved.has(atom.phrase)}
              saving={vocab?.saving === atom.phrase}
              onSave={vocab ? () => vocab.onSave(atom.phrase, atom.translation) : undefined}
              speakLanguage={vocab?.speakLanguage}
            />
          ),
        });
      }
      break;
    }
  }

  consider(
    findEmphasis(BOLD_RE, text, 1, (inner) => (
      <strong key={`${keyBase}-b`} className="font-semibold">
        {renderRun(inner, `${keyBase}-b`, vocab, atoms)}
      </strong>
    )),
  );
  consider(
    findEmphasis(ITALIC_AST_RE, text, 1, (inner) => (
      <em key={`${keyBase}-i`} className="italic">
        {renderRun(inner, `${keyBase}-i`, vocab, atoms)}
      </em>
    )),
  );
  consider(
    findEmphasis(ITALIC_UND_RE, text, 1, (inner) => (
      <em key={`${keyBase}-iu`} className="italic">
        {renderRun(inner, `${keyBase}-iu`, vocab, atoms)}
      </em>
    )),
  );
  consider(
    findEmphasis(STRIKE_RE, text, 1, (inner) => (
      <span key={`${keyBase}-s`} className="line-through">
        {renderRun(inner, `${keyBase}-s`, vocab, atoms)}
      </span>
    )),
  );
  consider(
    findEmphasis(CODE_RE, text, 1, (inner) => (
      <code
        key={`${keyBase}-c`}
        className="px-1 py-0.5 rounded bg-(--color-bg-hover) text-[0.9em] font-mono"
      >
        {stripPlaceholders(inner, atoms)}
      </code>
    )),
  );

  const link = LINK_RE.exec(text);
  if (link) {
    const label = link[1] ?? '';
    // SEC-APP-1 — same scheme allowlist as chat-bubble markdown
    // (`messageMarkdown.ts`): a `javascript:` / `data:` href from the model
    // renders as plain text, never as an anchor.
    const href = safeHref(link[2] ?? '');
    consider({
      start: link.index,
      end: link.index + link[0].length,
      build: () =>
        href ? (
          <a
            key={`${keyBase}-l`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.stopPropagation();
              onExternalLinkClick(e, href); // CHROME-LINK-1
            }}
            className="underline text-(--color-accent)"
          >
            {renderRun(label, `${keyBase}-l`, vocab, atoms)}
          </a>
        ) : (
          <span key={`${keyBase}-l`}>{renderRun(label, `${keyBase}-l`, vocab, atoms)}</span>
        ),
    });
  }

  return best;
}

/**
 * Render a rewritten run (text + placeholders, no `<vocab/>` tags
 * remaining). Recurses into emphasis bodies so a bold run can contain
 * italics, code, links, or vocab chips.
 */
function renderRun(
  text: string,
  keyBase: string,
  vocab: VocabState | undefined,
  atoms: VocabAtom[],
): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let segKey = 0;
  while (rest.length > 0) {
    const hit = findFirst(rest, `${keyBase}-${segKey}`, vocab, atoms);
    if (!hit) {
      pushText(out, rest, `${keyBase}-${segKey}-t`);
      break;
    }
    if (hit.start > 0) {
      pushText(out, rest.slice(0, hit.start), `${keyBase}-${segKey}-t`);
    }
    out.push(hit.build());
    rest = rest.slice(hit.end);
    segKey += 1;
  }
  return out;
}

function pushText(out: ReactNode[], text: string, keyBase: string): void {
  if (!text) return;
  out.push(<span key={keyBase}>{text}</span>);
}

/**
 * Strip vocab placeholders, swapping each in for its `phrase` text. Used
 * by `<code>` where vocab chips shouldn't render — code spans are
 * literal, so the placeholder char (a PUA codepoint) must not leak to
 * the DOM.
 */
function stripPlaceholders(text: string, atoms: VocabAtom[]): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (isPlaceholder(ch)) {
      const atom = atoms[placeholderIndex(ch)];
      out += atom?.phrase ?? '';
    } else {
      out += ch;
    }
  }
  return out;
}

export function renderInline(text: string, vocab: VocabState | undefined): ReactNode {
  const { rewritten, atoms } = tokeniseVocab(text);
  return renderRun(rewritten, 'inl', vocab, atoms);
}

// eslint-disable-next-line react-refresh/only-export-components
function VocabChip({
  phrase,
  translation,
  saved,
  saving,
  onSave,
  speakLanguage,
}: {
  phrase: string;
  translation: string;
  saved: boolean;
  saving: boolean;
  onSave?: () => void;
  speakLanguage?: string;
}) {
  // Inline chip that flows with the surrounding prose AND can wrap
  // mid-chip when the phrase + translation are too long for a single
  // line. `display: inline` (not `inline-flex`) so the browser can break
  // between the phrase and the translation; an `inline-flex` chip is
  // atomic and bumps the entire chip to a new line.
  //
  // We render the tap target as `<span role="button">` rather than a
  // real `<button>` because `<button>` is `inline-block` in every UA
  // stylesheet — and that defeats inline wrapping. Same pattern as
  // renderAnnotatedRow in BubbleRows.tsx.
  const handleActivate = () => {
    if (!onSave || saving) return;
    onSave();
  };
  // CARDS-TTS-9 — `phrase 🔈 · gloss`: the speaker sits inside the chip right
  // after the phrase, a bare glyph in the phrase's colour and weight. It
  // swallows its own tap (CARDS-TTS-4), so hearing a word never saves it.
  return (
    <>
      <span
        role={onSave ? 'button' : undefined}
        tabIndex={onSave ? 0 : undefined}
        data-testid="vocab-chip"
        aria-label={onSave ? (saved ? 'Remove from flashcards' : 'Save to flashcards') : undefined}
        aria-pressed={onSave ? saved : undefined}
        aria-disabled={saving || undefined}
        onClick={onSave ? (e) => { e.stopPropagation(); handleActivate(); } : undefined}
        onKeyDown={onSave ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            handleActivate();
          }
        } : undefined}
        className={cn(
          // Light-grey filled chip with squarish corners: bold phrase · muted
          // gloss, save icon (`<FlashcardIcon>`, CARDS-ICON-*) on the RIGHT. Shared by BOTH the
          // ExplainModal and the in-chat tutor explain card so they match.
          'px-1.5 rounded-sm bg-(--color-fg-muted)/10 box-decoration-clone',
          onSave && 'cursor-pointer hover:bg-(--color-fg-muted)/20',
          saving && 'opacity-80 cursor-default',
        )}
      >
        <span className="text-sm font-semibold text-(--color-fg)">{phrase}</span>
        {speakLanguage && (
          <CardListenButton
            phrase={phrase}
            language={speakLanguage}
            size={20}
            variant="bare"
            testId="vocab-chip-listen"
            className="align-middle -my-1 ml-0.5 text-(--color-fg) [&_svg]:[stroke-width:2.5]"
          />
        )}
        {' '}
        <span className="text-xs text-(--color-fg-muted) whitespace-nowrap">
          · {translation}
          {onSave && (
            <span className="inline-flex items-center justify-center w-4 h-4 align-middle ml-0.5">
              {saving ? (
                <Loader size={10} className="animate-spin" />
              ) : (
                <FlashcardIcon added={saved} size={10} className={saved ? undefined : 'text-(--color-fg-muted)'} />
              )}
            </span>
          )}
        </span>
      </span>
    </>
  );
}
