/**
 * WhatsApp-style markdown for chat bubbles. Single-character markers,
 * not CommonMark — so the tutor / translator prompts can encourage
 * formatting without ever colliding with vocab annotations.
 *
 *   *bold*      single asterisk
 *   _italic_    single underscore
 *   ~strike~    single tilde
 *   [label](https://example.com)
 *   - bullet line
 *
 * Plain paragraphs separated by blank lines render as separate paragraphs.
 * A single newline inside a paragraph becomes a soft break.
 *
 * Boundary rule (the reason for the lookbehind / lookahead in each
 * regex): markers only fire when adjacent to whitespace, punctuation,
 * or the string edge — never glued onto letters / digits. So `5*3=15`
 * and `snake_case` stay plain. Doubled markers (`**hi**`, `__hi__`,
 * `~~hi~~`) also render literally — the inner run can't start with the
 * marker itself, and the outer pair fails the boundary check on the
 * second copy of the marker.
 *
 * Headings (`# …` … `###### …`) are OPT-IN via `parseMessageMarkdown(src,
 * { headings: true })` — regular chat bubbles stay WhatsApp-style (no
 * headings), but broadcast announcements enable them. Still out of scope
 * (handled elsewhere): fenced code, tables, blockquotes, images, numbered
 * lists. The richer ExplainModal surface uses
 * `components/ExplainModal/SimpleMarkdown.tsx`.
 *
 * This module is pure data — no React. The bubble renderer
 * (`renderAnnotatedRow` / `renderPlainMarkdown` in `BubbleRows.tsx`)
 * walks the AST and runs the existing vocab tokenizer on text leaves so
 * complex-word underlines / tap targets still work. Markers are
 * stripped before the vocab tokenizer sees a leaf, so a complex-word
 * match can never cross a markdown boundary.
 */

import { EMAIL_PATTERN_SOURCE } from '@/lib/translationSkip';

export type MdInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; children: MdInline[] }
  | { kind: 'italic'; children: MdInline[] }
  | { kind: 'strike'; children: MdInline[] }
  | { kind: 'link'; href: string; children: MdInline[] }
  | { kind: 'br' };

export type MdBlock =
  | { kind: 'paragraph'; children: MdInline[] }
  | { kind: 'list'; items: MdInline[][] }
  | { kind: 'heading'; level: number; children: MdInline[] };

const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/;

// ── Link href safety ───────────────────────────────────────────────
// `[label](href)` is the ONLY construct in this grammar that reaches an
// `<a href>` (`renderInline` in BubbleRows.tsx). Message bodies are
// attacker-controlled twice over: a peer types the markdown, and the
// translator / tutor LLM can echo it back into a bubble the reader
// trusts. So the PARSER is the choke point — an unsafe scheme never
// becomes a `link` node at all, and the `[label](href)` degrades to the
// literal text the sender typed.
//
// Allowlist, never a denylist: `javascript:` / `data:` / `vbscript:` are
// the schemes worth naming, but the next one is the one nobody named, so
// anything outside http / https / mailto is refused.
const SAFE_SCHEME_RE = /^(?:https?|mailto):/i;

// Characters that let a scheme hide from a naive `startsWith` check.
// Browsers strip TAB / LF / CR from URLs before resolving them, and
// leading C0/C1 controls, DEL, zero-width formatting chars and the BOM
// are all ignored or skipped by at least one engine — so `\u0001javascript:`
// can execute while reading as a non-matching string. We delete every one
// of them BEFORE testing the scheme, and emit the cleaned value as the
// href so what we validated is exactly what the DOM receives.
// (`LINK_RE` already forbids literal whitespace inside the href, so the
// space in the range below can only ever be a no-op here.)
// eslint-disable-next-line no-control-regex
const HREF_INVISIBLE_RE = /[\u0000-\u0020\u007F-\u00A0\u200B-\u200F\u2028\u2029\uFEFF]/g;

/**
 * Normalise a markdown href and accept it only if it carries an
 * allowlisted scheme. Returns the cleaned href, or `null` when the link
 * must not be rendered as a link at all.
 *
 * Exported so the renderer can re-check defensively — `MdInline` is a
 * public type, so a future caller could hand `renderInline` a node this
 * parser never produced.
 */
export function safeHref(raw: string): string | null {
  const cleaned = raw.replace(HREF_INVISIBLE_RE, '');
  if (!cleaned) return null;
  return SAFE_SCHEME_RE.test(cleaned) ? cleaned : null;
}

/**
 * First `[label](href)` in `text` whose href survives `safeHref`.
 *
 * Scans PAST rejected links rather than stopping at the first match: a
 * message that opens with a hostile link must not cost a later, genuine
 * one its anchor (`[a](javascript:…) and [b](https://ok.com)`). The
 * rejected span is left in place and falls through to `pushText`, so the
 * reader sees the raw markdown and no characters are lost.
 */
function firstSafeLink(text: string): InlineMatch | null {
  const re = new RegExp(LINK_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const href = safeHref(m[2] ?? '');
    if (href) {
      const label = m[1] ?? '';
      return {
        start: m.index,
        end: m.index + m[0].length,
        inner: label,
        build: (children) => ({ kind: 'link', href, children }),
        isLink: true,
      };
    }
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return null;
}

// WhatsApp single-marker emphasis. Each regex requires:
//   * boundary before the opening marker (start-of-string OR a char
//     that is neither a letter/digit nor the marker itself)
//   * non-whitespace on each side of the inner run
//   * the inner run cannot contain the marker or a newline
//   * boundary after the closing marker (non-letter/digit/marker)
const BOLD_RE = /(?:^|[^\p{L}\p{N}*])\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*(?![\p{L}\p{N}*])/u;
const ITALIC_RE = /(?:^|[^\p{L}\p{N}_])_([^_\s][^_\n]*?[^_\s]|[^_\s])_(?![\p{L}\p{N}_])/u;
const STRIKE_RE = /(?:^|[^\p{L}\p{N}~])~([^~\s][^~\n]*?[^~\s]|[^~\s])~(?![\p{L}\p{N}~])/u;

type InlineMatch = {
  start: number;
  end: number;
  inner: string;
  build: (children: MdInline[]) => MdInline;
  /** MSG-BUBBLE-URL — set on a markdown link so `parseInline` knows not to
   *  autolink its LABEL. `[https://a](https://b)` would otherwise emit an
   *  anchor inside an anchor, which is invalid HTML and renders unpredictably. */
  isLink?: boolean;
};

function emphasisMatch(
  re: RegExp,
  marker: string,
  text: string,
  build: (children: MdInline[]) => MdInline,
): InlineMatch | null {
  const m = re.exec(text);
  if (!m) return null;
  const inner = m[1] ?? '';
  const literal = `${marker}${inner}${marker}`;
  const start = m.index + m[0].length - literal.length;
  return { start, end: start + literal.length, inner, build };
}

function findFirst(text: string): InlineMatch | null {
  let best: InlineMatch | null = null;
  const consider = (m: InlineMatch | null) => {
    if (!m) return;
    if (!best || m.start < best.start) best = m;
  };

  consider(firstSafeLink(text));
  consider(
    emphasisMatch(BOLD_RE, '*', text, (children) => ({ kind: 'bold', children })),
  );
  consider(
    emphasisMatch(ITALIC_RE, '_', text, (children) => ({ kind: 'italic', children })),
  );
  consider(
    emphasisMatch(STRIKE_RE, '~', text, (children) => ({ kind: 'strike', children })),
  );
  return best;
}

function parseInline(text: string, autolink = true): MdInline[] {
  const out: MdInline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const hit = findFirst(rest);
    if (!hit) {
      pushText(out, rest, autolink);
      break;
    }
    if (hit.start > 0) pushText(out, rest.slice(0, hit.start), autolink);
    // Inside a markdown link, autolinking is OFF for the rest of the subtree.
    const inner = parseInline(hit.inner, autolink && !hit.isLink);
    out.push(hit.build(inner));
    rest = rest.slice(hit.end);
  }
  return out;
}

function pushText(out: MdInline[], text: string, autolink = true): void {
  if (!text) return;
  const parts = text.split('\n');
  parts.forEach((part, idx) => {
    if (part.length > 0) {
      if (autolink) pushAutolinked(out, part);
      else out.push({ kind: 'text', text: part });
    }
    if (idx < parts.length - 1) out.push({ kind: 'br' });
  });
}

/**
 * MSG-BUBBLE-URL-1/2/3 — turn bare URLs in a plain-text run into link nodes.
 *
 * Deliberately at the PARSER seam rather than in the renderer: autolinks and
 * markdown links then share one node kind, one `safeHref` allowlist and one
 * `<a>` element. A second linkification path in the renderer would have its
 * own security check, which is exactly how the first one's fix stops applying.
 */
const URL_AUTOLINK_SOURCE = String.raw`(?:https?:\/\/|www\.)[^\s<>"']+`;

/**
 * MSG-BUBBLE-URL-6/7 — URL OR email, one alternation scanned left to right, so
 * an `@` inside a URL (`https://x.com/@jo`) stays part of the URL that started
 * earlier. Group 1 = URL, group 2 = email.
 */
const AUTOLINK_RE = new RegExp(`(${URL_AUTOLINK_SOURCE})|(${EMAIL_PATTERN_SOURCE})`, 'gi');

/**
 * MSG-BUBBLE-URL-2 — strip what punctuation belongs to the SENTENCE, not the
 * URL.
 *
 * `see https://example.com.` must link `https://example.com` and leave the
 * full stop as text. Swallowing it yields a 404 that LOOKS like a working
 * link, which is worse than not linking at all — and a URL ending a sentence
 * is the commonest shape there is in real prose.
 *
 * A closing bracket is only dropped when nothing opened it INSIDE the match,
 * so `…/wiki/Foo_(bar)` keeps its paren while `(https://example.com)` does not.
 */
function trimUrlTail(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url[url.length - 1];
    if (!last) break;
    if ('.,;:!?'.includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const opener = last === ')' ? '(' : last === ']' ? '[' : last === '}' ? '{' : null;
    if (opener) {
      const opens = url.split(opener).length - 1;
      const closes = url.split(last).length - 1;
      if (closes > opens) {
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return url;
}

function pushAutolinked(out: MdInline[], text: string): void {
  const re = new RegExp(AUTOLINK_RE.source, AUTOLINK_RE.flags);
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[2] !== undefined) {
      // MSG-BUBBLE-URL-6 — an email: the address is the link text, `mailto:`
      // the href, and the SAME allowlist decides. The pattern already stops
      // before sentence punctuation (MSG-BUBBLE-URL-7), so no tail trimming.
      const mailHref = safeHref(`mailto:${m[2]}`);
      if (mailHref) {
        if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
        out.push({ kind: 'link', href: mailHref, children: [{ kind: 'text', text: m[2] }] });
        last = m.index + m[2].length;
      }
      continue;
    }
    const url = trimUrlTail(m[0]);
    // MSG-BUBBLE-URL-3: `www.` has no scheme of its own, so give it https
    // BEFORE the allowlist runs — the allowlist is the only thing that decides,
    // and it must decide on the string that will actually become the href.
    const href = url ? safeHref(/^www\./i.test(url) ? `https://${url}` : url) : null;
    if (!url || !href) {
      if (m.index === re.lastIndex) re.lastIndex += 1;
      continue;
    }
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push({ kind: 'link', href, children: [{ kind: 'text', text: url }] });
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
}

// Bullets accept either `-` or `*` followed by whitespace. WhatsApp
// recognises both. No collision with `*bold*` because that marker is
// glued directly onto the word — the bullet regex requires whitespace
// AFTER the marker, which `*bold*` lacks.
const BULLET_RE = /^\s*[-*]\s+/;

// ATX-ish headings (`#` … `######`). Opt-in via `opts.headings`. The space
// after the marker is OPTIONAL — both `## Title` and `##Title` parse — because
// broadcast authors + LLM-translated copy don't reliably keep it. Requires at
// least one non-space content char, so a bare `###` (no text) stays plain.
const HEADING_RE = /^(#{1,6})[ \t]*([^#\s].*?)\s*$/;

export function parseMessageMarkdown(
  source: string,
  opts: { headings?: boolean } = {},
): MdBlock[] {
  const lines = source.split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (opts.headings) {
      const hm = HEADING_RE.exec(line);
      if (hm) {
        blocks.push({
          kind: 'heading',
          level: hm[1]!.length,
          children: parseInline(hm[2]!),
        });
        i += 1;
        continue;
      }
    }
    if (BULLET_RE.test(line)) {
      const items: MdInline[][] = [];
      while (i < lines.length && BULLET_RE.test(lines[i] ?? '')) {
        const item = (lines[i] ?? '').replace(BULLET_RE, '');
        items.push(parseInline(item));
        i += 1;
      }
      blocks.push({ kind: 'list', items });
      continue;
    }
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !BULLET_RE.test(lines[i] ?? '') &&
      !(opts.headings && HEADING_RE.test(lines[i] ?? ''))
    ) {
      paraLines.push(lines[i] ?? '');
      i += 1;
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paraLines.join('\n')) });
  }
  return blocks;
}
