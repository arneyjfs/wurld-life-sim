/**
 * LIFE-CONTRACT-BUBBLE-4: a speech bubble holds the VERBATIM utterance and
 * nothing else.
 *
 * Observed on beta (2026-07-21): a bubble rendered, under an NPC's avatar,
 *
 *     « Qu'est-ce que c'est que ce projet ? », demandes-tu.
 *     "What is this project?", you ask.
 *
 * — the PLAYER's own line, wrapped in quotation marks, carrying a narrator's
 * attribution clause, attributed to an NPC. Three contract breaches at once.
 * The step SI already forbids this ("the content that would appear inside
 * quotation marks in a novel"), which is exactly why a prompt rule is not
 * enough: the model writes the sentence a novelist would write, quotes and all.
 *
 * The repair is deterministic and language-independent. It does NOT try to
 * parse grammar — it exploits the fact that a narrated line has a structure a
 * verbatim one never does: a quoted span with prose outside it.
 */

/** Quote pairs seen across the practice languages we ship. */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['«', '»'], // « »  French, Russian, Spanish
  ['“', '”'], // “ ”  English curly
  ['„', '“'], // „ “  German
  ['‚', '‘'], // ‚ ‘
  ['‘', '’'], // ‘ ’
  ['「', '」'], // 「 」 Japanese
  ['‟', '”'],
  ['"', '"'],
];

export type UtteranceRepair = {
  /** The verbatim utterance, quotes and attribution removed. */
  text: string;
  /** The prose that sat OUTSIDE the quotes ("demandes-tu", "she said"). */
  attribution: string;
  /** True when anything was changed. */
  repaired: boolean;
};

// French sets a non-breaking space (U+00A0) or a narrow one (U+202F) before
// « » and ? ! : ; and Gemini emits them; written as escapes so they don't
// trip no-irregular-whitespace.
const trimEdge = (s: string): string =>
  s.replace(/^[\s\u00a0\u202f,.:;\u2014\u2013-]+|[\s\u00a0\u202f,.:;\u2014\u2013-]+$/gu, '');

/** A verb of speech in the residue is the clearest signal that the prose
 *  outside the quotes is an ATTRIBUTION ("«…» demanded the innkeeper") rather
 *  than the real sentence ("«Bonjour» est un mot"). Word-boundary matched for
 *  the Latin-script practice languages we ship. An unlisted verb simply fails
 *  to match, so the line is LEFT ALONE — the SI, not this repair, is the
 *  primary contract, and leaving a line intact is always the safe failure. */
const SPEECH_VERB_LATIN =
  new RegExp(
    '\\b(' + [
      // English
      'says?', 'said', 'saying', 'asks?', 'asked', 'asking', 'repl(?:y|ies|ied)',
      'answers?', 'answered', 'adds?', 'added', 'whispers?', 'whispered',
      'shouts?', 'shouted', 'murmurs?', 'murmured', 'exclaims?', 'exclaimed',
      'demanded', 'continues?', 'continued', 'repeats?', 'repeated',
      // French
      'dit', 'dis', 'dites', 'disait', 'disant', 'demande', 'demandes', 'demanda',
      'r[ée]ponds?', 'r[ée]pond', 'r[ée]pondit', 'ajoutes?', 'ajouta', 'murmures?',
      'murmura', 'cries?', 'cria', 'exclame', 'exclama', 'lance', 'lan[çc]a',
      'souffles?', 'souffla', 'reprend', 'reprit',
      // Spanish
      'dijo', 'dice', 'pregunt\\w*', 'respond\\w*', 'a[ñn]ad\\w*', 'grit[aó]',
      'susurr\\w*', 'exclam\\w*', 'contest\\w*',
      // German
      'sagt\\w*', 'fragt\\w*', 'antwortet\\w*', 'ruft', 'rief', 'fl[üu]stert\\w*',
      // Italian
      'disse', 'chiede', 'chiese', 'rispond\\w*', 'grid[aò]', 'sussurr\\w*',
      // Portuguese
      'diz', 'disse', 'perguntou', 'respondeu', 'gritou', 'sussurr\\w*',
    ].join('|') + ')\\b',
    'i',
  );

/** CJK has no spaces, so word boundaries don't apply. A speech-verb character
 *  (say/ask/answer/shout…) or a quotative particle after the close-quote
 *  (Japanese と, Korean 라고/이라고/하고) marks the residue as an attribution. */
const SPEECH_MARK_CJK =
  /[言話话問问答尋聞闻叫喊囁道語语说說]|^[とっ]|라고|이라고|하고/u;

/** Does the prose left outside the quotes read as a speech-attribution (so the
 *  quoted span is the whole utterance and the wrapper should be stripped)? True
 *  for an empty residue (a bare "«…»" — the UI draws the marks), a speech verb
 *  in any shipped language, or a subject-person marker. REPLACES the old length
 *  cap, which both over-stripped legit lines ending on a short quoted word and
 *  under-detected long novelistic attributions. */
function looksLikeAttribution(residue: string): boolean {
  const r = residue.trim();
  if (r.length === 0) return true;
  return SPEECH_VERB_LATIN.test(r) || SPEECH_MARK_CJK.test(r) || attributionPerson(r) !== null;
}

/**
 * Strip a narrator's quote-and-attribution wrapper from a line meant to be a
 * verbatim utterance.
 *
 * Fires only when the text LOOKS narrated: it opens OR closes on a quoted span,
 * AND the prose left outside reads as a speech-attribution
 * (`looksLikeAttribution`). That second condition keeps a genuine utterance
 * intact whether it merely CONTAINS a quotation (`Il a dit « bonjour » hier.`)
 * or ENDS on a quoted word (`Le code est « cygne »` — closes on a quote but
 * the residue is not an attribution).
 */
export function stripAttributionWrapper(raw: string): UtteranceRepair {
  const text = (raw ?? '').trim();
  if (text.length === 0) return { text: raw ?? '', attribution: '', repaired: false };

  for (const [open, close] of QUOTE_PAIRS) {
    const start = text.indexOf(open);
    if (start === -1) continue;
    // For a symmetric pair ("…") the closing mark is the LAST occurrence, not
    // the next one — otherwise `"a" and "b"` truncates at the second mark.
    const end = open === close
      ? text.lastIndexOf(close)
      : text.indexOf(close, start + open.length);
    if (end <= start) continue;

    const inner = text.slice(start + open.length, end);
    const before = text.slice(0, start);
    const after = text.slice(end + close.length);
    const outside = trimEdge(before + ' ' + after);
    if (inner.trim().length === 0) continue;

    const opensOnQuote = start === 0;
    const closesOnQuote = end + close.length >= text.length;

    if (opensOnQuote) {
      // The quote leads: a trailing attribution (the beta case "« … »,
      // demandes-tu", or "« … » she said"). Strip if the residue reads as an
      // attribution.
      if (!looksLikeAttribution(after)) continue;
    } else if (closesOnQuote) {
      // The quote trails. This is ambiguous — a NARRATOR introducing a quote
      // ("Elle demande : « Tu viens ? »") vs a genuine NPC line that itself
      // ENDS on a quoted word ("Elle m'a dit « non »"). Grammatically both are
      // "subject verb quote", so require the strong lead-in signal a narrator
      // uses: a colon/dash before the quote, or an empty residue. Without it,
      // KEEP the line — truncating a real utterance to its final quoted word is
      // worse than missing a rare narrator-intro strip (the SI is the primary
      // contract). This also makes the repair a FIXPOINT: the surviving line no
      // longer opens/closes on a bare attribution, so a second pass (commitNode
      // re-normalising what arriveAtNode already fixed) is a no-op even on
      // nested quotes.
      const leadIn = before.replace(/[\s\u00a0\u202f]+$/u, '');
      if (leadIn.length !== 0 && !/[:—–-]$/.test(leadIn)) continue;
    } else {
      // The quote is embedded mid-line — not a wrapper. Leave it.
      continue;
    }

    return { text: inner.trim(), attribution: outside, repaired: true };
  }
  // No wrapper found. `repaired` is false — the earlier `.trim()` is not a
  // repair (returning true here fired spurious "utterance-repaired" warns and
  // could trip the re-attribution branch on a whitespace-only difference).
  return { text, attribution: '', repaired: false };
}

/** True when the line carries a narrator's attribution clause outside the
 *  quotes — i.e. it is prose about speech, not speech. */
export function hasAttributionWrapper(raw: string): boolean {
  const r = stripAttributionWrapper(raw);
  return r.repaired && r.attribution.length > 0;
}

/** A speech-attribution's SUBJECT pronoun is a fairly language-general signal
 *  of who is speaking, because the verb agrees with its subject: a 2nd-person
 *  subject ("you ask", "demandes-tu") is the player; a 3rd-person one ("she
 *  says", "dit-elle", "dit Élise") is an NPC. High-precision markers only —
 *  anything ambiguous falls through to `unknown`, which keeps the model's own
 *  choice (a wrong flip is worse than none). Covers the languages we can
 *  actually test (English, French); other languages simply return null here
 *  and rely on the name match + the SI. */
// The pronoun must be the SUBJECT of the attribution — at the START of the
// clause ("you ask", "tu demandes") or an ENCLITIC after the verb ("demandes-
// tu", "dit-elle"). Matching a pronoun ANYWHERE would misfire on "she says to
// you", where "you" is the ADDRESSEE, not the speaker (review finding #8).
const SECOND_PERSON =
  /^(you|tu|tú|vous|vos)\b|[-‑](tu|vous)\b/i; // "you ask" · "tu demandes" · "demandes-tu" · "dites-vous"
const THIRD_PERSON =
  /^(s?he|they|il|elle|on|ils|elles)\b|[-‑]t?[-‑]?(il|elle|on|ils|elles)\b/i; // "she says" · "dit-il" · "demande-t-elle"

function attributionPerson(a: string): 'second' | 'third' | null {
  const t = a.trim();
  // 2nd person wins ties: "demandes-tu" carries no 3rd-person marker, but a
  // stray match elsewhere shouldn't override an explicit "you"/"-tu".
  if (SECOND_PERSON.test(t)) return 'second';
  if (THIRD_PERSON.test(t)) return 'third';
  return null;
}

/**
 * Whose line is it? Decided first by NAME MATCH (works in every language —
 * names don't inflect), then by the SUBJECT PERSON of the attribution.
 *
 * `'unknown'` is returned when nothing is decisive, so the model's choice is
 * kept rather than guessed at — a wrong re-attribution would move a genuine
 * NPC line into the player's own voice.
 */
export function attributionSpeaker(
  attribution: string,
  names: { playerName?: string | null; speakerName?: string | null },
): 'player' | 'npc' | 'unknown' {
  const a = attribution.toLowerCase();
  if (a.length === 0) return 'unknown';
  // Whole-TOKEN name match, not substring: a raw `includes` let a 2-char name
  // match inside an unrelated word ("Al" in "alors"), then flipped the beat's
  // speaker (review finding #10). Compare significant name tokens (≥3 chars)
  // against the attribution's tokens.
  const aTokens = new Set(a.split(/[^\p{L}]+/u).filter(Boolean));
  const has = (n?: string | null): boolean =>
    (n ?? '')
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .some((t) => t.length >= 3 && aTokens.has(t));
  // The speaker's own name wins: "« … », dit Élise" really is Élise speaking.
  if (has(names.speakerName)) return 'npc';
  if (has(names.playerName)) return 'player';
  // No name (the beta case "demandes-tu") → fall back to the subject person.
  const person = attributionPerson(a);
  if (person === 'second') return 'player';
  if (person === 'third') return 'npc';
  return 'unknown';
}
