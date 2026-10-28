/**
 * Vocab-tag client utilities. Twin of `functions/src/vocabTags.ts`.
 * Vitest excludes functions/** from its test glob, so parity is a manual
 * hand-shake — any change here MUST be mirrored on the server side (and
 * vice versa) in the same commit.
 *
 * MSG-VIEW-7.12 — the client no longer reads the `swap="1"` attribute (the
 * swap-words easy mode is retired). A legacy tag carrying it still parses:
 * the attribute is simply ignored and stripped with the rest of the tag.
 */

import { EMAIL_PATTERN_SOURCE } from '@/lib/translationSkip';

export type CwParseResult = {
  plainText: string;
  complexWords: string[];
  wordTranslations: Record<string, string>;
};

/** Outer match for the server's `<cw>`/`<vocab>` tags. Captures the
 *  attribute blob and the inner word — the `t=` attribute is parsed from the
 *  blob below so the model can write attributes in any order. */
export const VOCAB_REGEX =
  /<(?:cw|vocab)\s+([^>]*?)>(.*?)<\/(?:cw|vocab)>/g;

// Non-greedy quote-balanced capture: match a t="..." or t='...' value
// that may itself contain the OTHER quote style (the LLM commonly
// writes `t="how (lit: "all at the hour")"` despite the SI nudging
// it toward single-outer quotes for that case). The lookahead
// requires the closing quote to be followed by an attribute boundary
// (whitespace + next attribute) or end-of-attrs (the outer
// VOCAB_REGEX already strips the closing `>`, so $ is the tag end).
// Without the lookahead, `[^"]*` truncates at the first inner `"`,
// dropping the entire literal-gloss tail — the popover bug the user
// reported as `est-ce que: how (lit: "` mid-string.
const T_ATTR_REGEX = /\bt=(?:"(.*?)"|'(.*?)')(?=\s+\w+=|$)/;

/** Parse server-emitted vocab tags into plain text + a list of complex
 *  phrases + a `word -> meaning` map.
 *  Multi-word phrases are kept as a single entry in `complexWords`
 *  (e.g. "il y a"). */
export function parseCwTags(text: string): CwParseResult {
  if (!text || (!text.includes('<cw') && !text.includes('<vocab'))) {
    return {
      plainText: text ?? '',
      complexWords: [],
      wordTranslations: {},
    };
  }
  const complexWords: string[] = [];
  const wordTranslations: Record<string, string> = {};
  VOCAB_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VOCAB_REGEX.exec(text)) !== null) {
    const attrs = m[1] ?? '';
    const word = m[2] ?? '';
    if (!word) continue;
    const tMatch = T_ATTR_REGEX.exec(attrs);
    const meaning = tMatch ? (tMatch[1] ?? tMatch[2] ?? '') : '';
    if (!complexWords.includes(word)) complexWords.push(word);
    wordTranslations[word.toLowerCase()] = meaning;
  }
  return {
    plainText: stripVocabTagsToPlain(text),
    complexWords,
    wordTranslations,
  };
}

export function stripVocabTagsToPlain(text: string): string {
  if (!text) return '';
  return text
    .replace(/<(?:cw|vocab)[^>]*>/g, '')
    .replace(/<\/(?:cw|vocab)>/g, '')
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches absolute URLs the same way the pipeline's server-side
 * `URL_REGEX_PIPELINE` does. We strip URLs out of vocab tokenization so
 * a complex-word in `complexWords` (e.g. "the") can't false-match a
 * substring inside a URL slug like `/the-page`. The substitution-and-
 * restore the Cloud Function does already protects the LLM from URL
 * text — this is the symmetric belt-and-braces for the CLIENT renderer.
 */
// MSG-BUBBLE-URL-9 — an email address is carved out the same way, so a
// complex word (`example`) can't underline part of `jo@example.com` inside
// its mailto: anchor.
const URL_REGEX = new RegExp(
  String.raw`(?:https?:\/\/|www\.)[^\s<>'")\]]+|` + EMAIL_PATTERN_SOURCE,
  'gi',
);

/**
 * Walk the text and emit a sequence of segments: each plain-text run,
 * each complex-word/phrase match (with the index it lives at in the
 * original string). Multi-word phrases match as single segments because
 * we build an alternation regex sorted by length-desc with unicode
 * word-boundary lookbehind/lookahead — same shape as source's
 * `buildAnnotatedPracticeText` regex but emitting segments instead of
 * re-wrapping in tags.
 *
 * Source equivalent: utils/parseCwTags.ts:53 buildAnnotatedPracticeText
 * inverted from "wrap" to "yield".
 */
export type VocabSegment =
  | { kind: 'plain'; text: string }
  | { kind: 'complex'; match: string };

export function tokenizeVocab(
  text: string,
  complexWords: string[],
): VocabSegment[] {
  if (!text) return [];
  if (complexWords.length === 0) return [{ kind: 'plain', text }];

  // Split the text into URL spans (kept whole as plain segments) +
  // non-URL spans. Each non-URL span is then run through the complex-
  // word tokenizer below. Without this, a complex word like "the"
  // could false-match inside a URL slug (`/the-page`) because slashes
  // / dashes count as non-letter boundaries for `\p{L}\p{N}`.
  const segments: { text: string; isUrl: boolean }[] = [];
  let urlCursor = 0;
  URL_REGEX.lastIndex = 0;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = URL_REGEX.exec(text)) !== null) {
    if (urlMatch.index > urlCursor) {
      segments.push({ text: text.slice(urlCursor, urlMatch.index), isUrl: false });
    }
    segments.push({ text: urlMatch[0], isUrl: true });
    urlCursor = urlMatch.index + urlMatch[0].length;
  }
  if (urlCursor < text.length) {
    segments.push({ text: text.slice(urlCursor), isUrl: false });
  }

  // Sort length-desc so "il y a" wins over "y" or "a" alone.
  const sorted = [...complexWords].sort((a, b) => b.length - a.length);
  const alternation = sorted.map(escapeRegex).join('|');
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])(${alternation})(?![\\p{L}\\p{N}])`,
    'giu',
  );

  const out: VocabSegment[] = [];
  for (const seg of segments) {
    if (seg.isUrl) {
      out.push({ kind: 'plain', text: seg.text });
      continue;
    }
    let cursor = 0;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(seg.text)) !== null) {
      if (m.index > cursor) {
        out.push({ kind: 'plain', text: seg.text.slice(cursor, m.index) });
      }
      out.push({ kind: 'complex', match: m[0] });
      cursor = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
    if (cursor < seg.text.length) {
      out.push({ kind: 'plain', text: seg.text.slice(cursor) });
    }
  }
  return out;
}
