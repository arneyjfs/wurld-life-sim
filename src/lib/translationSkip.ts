/**
 * Translation skip rules — predicates that recognise message content
 * which doesn't benefit from translation (emoji-only, URL-only). The
 * source app applies these both server-side (Cloud Function bypasses
 * the pipeline) and client-side (optimistic placeholder skips the
 * 'sending'/'translating' shimmer and renders as 'sent' immediately).
 *
 * Regexes match the source's server-side definitions verbatim so the
 * client and server agree about who is skippable:
 *   - functions/src/index.ts EMOJI_ONLY_REGEX (line 3348)
 *   - functions/src/index.ts URL_ONLY_REGEX  (line 3345)
 *
 * Keeping the predicates in lockstep avoids the visible regression
 * where the client shows "translating…" for ~200ms before the server
 * doc lands with sendStatus='sent' — a brief but ugly flicker for
 * what should be instant.
 */

// Single emoji, sequence of emojis, ZWJ joiners (U+200D), variation
// selectors (U+FE0F), and incidental whitespace/punctuation are all
// skippable. Mirrors `isEmojiOnlyLike` in functions/src/index.ts:1375
// so the client and server agree on which messages bypass translation.
//
// We intentionally include the bare ZWJ + VS-16 inside the character
// class even though no-misleading-character-class flags them — these
// glyphs appear *between* base emojis in family/profession sequences
// (👨‍👩‍👧, 👮🏽‍♀️) and we want each such sequence to count as a single
// "emoji-only" token. Anchored ^...+$ with /u semantics gives the
// intended behaviour; the lint warning is the false-positive case.
// eslint-disable-next-line no-misleading-character-class
const EMOJI_ONLY_REGEX = /^[\p{Extended_Pictographic}\p{Emoji_Component}‍️\s.,!?]+$/u;

/**
 * MSG-BUBBLE-URL-7 — an email address, as a RegExp SOURCE so every site
 * (translation skip, bubble autolink, vocab carve-out) builds from one string.
 * Mirrored character-for-character in `functions/src/textPatterns.ts`
 * (asserted by `functions/src/__tests__/translationSkip.parity.test.ts`).
 *
 *   - local part `[A-Za-z0-9._%+-]+`, not preceded by another address / path
 *     character (so `a@b@c.com` and `x.com/jo@y.com` don't yield a fragment);
 *   - one or more dot-separated alphanumeric/hyphen domain labels;
 *   - a TLD of ≥2 letters that no further label character follows.
 *
 * `@handle`, `a@b`, `a@b.c` never match, and a sentence-ending full stop is
 * never part of the address because a label can't end in `.`.
 */
export const EMAIL_PATTERN_SOURCE =
  '(?<![A-Za-z0-9._%+\\-/@])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z]{2,}(?![A-Za-z0-9-])';

// Bare URL (http(s):// or www.) — or, MSG-BUBBLE-URL-8, a bare email
// address — with no surrounding prose. Whitespace around it is tolerated;
// anything else (a leading word, a trailing comment, a full stop) makes the
// message translatable again.
const URL_ONLY_REGEX = new RegExp(
  `^\\s*(?:(?:https?:\\/\\/|www\\.)\\S+|${EMAIL_PATTERN_SOURCE})\\s*$`,
  'i',
);

// A single letter in ANY script (Latin, CJK, Cyrillic, Arabic, …). Numbers
// (\p{Nd}), punctuation, currency/math symbols and whitespace are NOT letters.
// Mirrors the server's HAS_LETTER check in functions/src/index.ts.
const HAS_LETTER_REGEX = /\p{L}/u;

/**
 * True when the text consists entirely of emojis (incl. ZWJ joiners,
 * skin-tone modifiers, variation selectors) and incidental punctuation.
 * Empty / whitespace-only text returns false — there's nothing to send.
 */
export function isEmojiOnly(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return EMOJI_ONLY_REGEX.test(trimmed);
}

/**
 * True when the text is a single URL or email address with no surrounding
 * prose. Used to skip translation for shared links — translating
 * "https://..." or "jo@example.com" is never useful and often produces
 * gibberish (MSG-BUBBLE-URL-8).
 */
export function isUrlOnly(text: string | null | undefined): boolean {
  if (!text) return false;
  return URL_ONLY_REGEX.test(text);
}

/**
 * True when the text has NO letters in any script — only digits, times,
 * dates, currency/math symbols, punctuation, etc. (e.g. "20353281",
 * "04-00-04", "$1,000", "2+2=4"). There is nothing linguistic to translate:
 * these render identically in every language.
 *
 * This is the gap that stranded a numbers-only message in a permanent
 * "translating…" state — it slipped past the emoji/URL net, ran the full
 * pipeline, produced no per-recipient translation, and (not being
 * `universal`) left the recipient's practice row empty with no failsafe
 * (the doc was already `pipeline.state='done'`, so the stuck-sweep never
 * fired). Treating it as skippable makes it `universal` — both rows render
 * `originalText` and the shimmer never shows.
 */
export function isNonLinguistic(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  return !HAS_LETTER_REGEX.test(trimmed);
}

/**
 * Aggregate predicate: should this message be sent WITHOUT translation?
 *
 *   - emoji-only ✅ — universal language, translating breaks the joke
 *   - url-only ✅ — link doesn't translate
 *   - non-linguistic ✅ — numbers/symbols/punctuation have nothing to translate
 *   - everything else ❌ — runs the normal pipeline
 *
 * Server applies the same rule independently, so this is purely a UX
 * optimisation: it lets the optimistic bubble skip 'sending' state
 * and land directly as 'sent' without waiting for the pipeline RPC.
 */
export function shouldSkipTranslation(text: string | null | undefined): boolean {
  return isEmojiOnly(text) || isUrlOnly(text) || isNonLinguistic(text);
}
