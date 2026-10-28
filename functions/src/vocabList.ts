import { splitConstructionRule, vocabListRules } from "./prompts/rulebook";
/**
 * MSG-PIPE-19 — the vocab list format.
 *
 * One line per entry:
 *
 *     <vocab>
 *     Bonjour = hello
 *     mon ami = my friend
 *     du coup = so/therefore (lit: "of the blow")
 *     </vocab>
 *
 * `surface = gloss`, one per line, in sentence order.
 *
 * MSG-PIPE-19.2 — a leading run of `*` markers (a model writing the list as
 * markdown bullets, measured `* * maîtrise = master` from flash-lite) is a
 * candidate reading alongside the literal line: the sentence picks, so a
 * WhatsApp-bold span the user typed keeps its asterisks. The marker carries
 * no meaning. (It once flagged a swap entry — the swap feature and its flag
 * were retired 2026-09-24 / 2026-09-29.)
 *
 * WHY, in order of how much it matters:
 *
 * 1. NO ATTRIBUTES, SO NO ATTRIBUTE BUGS. Both defects this repo has actually
 *    shipped on this data were attribute-parsing defects. `t="how (lit: "all
 *    at the hour")"` truncated at the inner quote and reached a user as
 *    `est-ce que: how (lit: ` mid-string. `<w\s+…>` required an attribute, so
 *    a gloss-less entry was silently deleted rather than kept. Neither is
 *    expressible here: everything after the first delimiter is opaque bytes.
 *    Quotes, `<`, `>`, `&`, apostrophes, parens — all just characters.
 *
 * 2. THE SENTENCE DISAMBIGUATES. The surface must occur in the sentence (the
 *    client string-matches it to place the underline), so rather than guessing
 *    a split and checking it afterwards, every reading of a line is generated
 *    and the sentence picks. That is what makes `=` and `*` in a user's own
 *    message safe rather than merely unlikely — see `pickReading`.
 *
 * Used by BOTH the analysis parser and the convert parser, which had grown
 * near-identical private copies of this logic.
 */

export type VocabEntry = {
  /** Exact span as it appears in the sentence. */
  surface: string;
  /** Native gloss. May be empty — a highlighted span with a blank popover is
   *  a far smaller failure than the word vanishing (MSG-PIPE-17). */
  gloss: string;
};

/**
 * ` = ` — equals with a space either side. The spaces matter: a bare `=`
 * collides with arithmetic and shorthand that really does appear in chat
 * ("2=4", "x=y"), so only a spaced one delimits.
 */
const DELIM = ' = ';
type Reading = { surface: string; gloss: string };

/**
 * Enumerate every way a line could be read.
 *
 * Both hazards here come from the SURFACE FORM being a span lifted out of a
 * user's message, so it can contain anything the user typed:
 *
 *   `*bonjour* = hello`            — the user wrote WhatsApp bold, so the span
 *                                    legitimately starts with `*`
 *   `2 = 4 = wrote two equals four` — the user wrote an equals sign inside the
 *                                    span
 *
 * A single-guess parse gets both wrong AND passes a naive validity check: it
 * reads the bold marker as a bullet (surface `bonjour*`), and it truncates the
 * second to surface `2` — which is genuinely present in the sentence, so "does
 * the surface occur?" says yes to a broken entry.
 *
 * So the split is not a guess to be validated afterwards. Every candidate is
 * generated and the sentence chooses between them.
 */
function readings(line: string): Reading[] {
  const out: Reading[] = [];
  const variants: string[] = [line];
  // MSG-PIPE-19.2 — a leading run of bullet markers (`* `, `*`, `* * `):
  // models write `*word` and `* * word` often enough that a literal-only
  // reading DISCARDED the entry (`*食べ物` is not a span of the sentence;
  // measured 3/15 in one tutor-reply run 2026-07-29, and `* * maîtrise` from
  // flash-lite). Generating the stripped variant costs nothing: it joins the
  // same candidate set as every other reading, and the sentence still picks.
  // A legitimately-asterisked span like WhatsApp bold keeps winning, because
  // `*bonjour*` is longer than `bonjour*` and is the one actually present.
  const runStripped = line.replace(/^(?:\*\s*)+/, '');
  if (runStripped !== line) variants.push(runStripped);
  for (const body of variants) {
    let at = body.indexOf(DELIM);
    while (at !== -1) {
      out.push({
        surface: body.slice(0, at).trim(),
        gloss: body.slice(at + DELIM.length).trim(),
      });
      at = body.indexOf(DELIM, at + 1);
    }
    // Unspaced `=` — the likeliest deviation from the format.
    const bare = body.indexOf('=');
    if (bare > 0 && body.indexOf(DELIM) === -1) {
      out.push({
        surface: body.slice(0, bare).trim(),
        gloss: body.slice(bare + 1).trim(),
      });
    }
    // No delimiter at all: a bare word. Keep it as a gloss-less span rather
    // than dropping it (MSG-PIPE-17).
    out.push({ surface: body.trim(), gloss: '' });
  }
  return out.filter((r) => r.surface.length > 0);
}

/**
 * Pick the reading the sentence supports, preferring the LONGEST surface.
 *
 * Longest-wins is what resolves both hazards, and it resolves them in opposite
 * directions, which is why a hand-written first/last rule could not:
 *
 *   `2 = 4 = wrote two equals four` — surfaces `2` and `2 = 4` both occur;
 *                                     the longer one is the real span.
 *   `égale = equals, as in 2 = 2`   — `égale` occurs, `égale = equals, as in 2`
 *                                     does not, so the short one wins.
 *   `*bonjour* = hello`             — `*bonjour*` (as typed) is longer than
 *                                     `bonjour*` (flag stripped), and it is
 *                                     what the user actually typed.
 *
 * A legacy flagged line — `* bonjour = hello` against a sentence with no
 * asterisk — has only one reading that occurs at all, so the flag is stripped.
 */
function pickReading(line: string, occursIn: (surface: string) => boolean): Reading | null {
  const all = readings(line);
  let best: Reading | null = null;
  for (const r of all) {
    if (!occursIn(r.surface)) continue;
    if (!best || r.surface.length > best.surface.length) best = r;
  }
  return best;
}

const ELLIPSIS = /\s*(?:\.\.\.|\u2026)\s*/;

/**
 * MSG-VOCAB-8 — the dual gloss. A line's right side is "in context || on its
 * own"; the card (and the popover, and wordTranslations) keeps the second,
 * then the first when they differ (MSG-VOCAB-8.9).
 *
 * Why two: every single-slot wording measured left the model copying the
 * sentence's own phrasing into the gloss ("est noir de monde = is like
 * Piccadilly Circus"), because it writes the list while looking at the
 * translation it just made. Giving that alignment a slot of its own freed the
 * second one: cards failing the standalone test 18% -> 9%, glosses copied
 * verbatim from the sentence 66% -> 41%, same call, ~9 output tokens.
 *
 * A line without " ||" is an ordinary gloss (cached, in-flight or older
 * responses). An empty second half falls back to the first: a highlighted word
 * with a context gloss beats a blank card.
 *
 * MSG-VOCAB-8.6 — so does a second half that only repeats the span. On an
 * English practice sentence the model writes "on its own" in English
 * ("word underlines = los subrayados de palabras || word underlines"): a card
 * that shows the word as its own meaning teaches nothing, and the first half
 * is in the right language.
 */
export function cardGloss(gloss: string, surface?: string): string {
  return glossFor(gloss, surface, true);
}

/** MSG-VOCAB-8.4 — a split construction keeps ONE gloss, then its pair label. */
function ownGloss(gloss: string, surface?: string): string {
  return glossFor(gloss, surface, false);
}

function glossFor(gloss: string, surface: string | undefined, withContext: boolean): string {
  const at = gloss.lastIndexOf(" ||");
  if (at === -1) return gloss;
  const own = gloss.slice(at + 3).trim();
  const inContext = gloss.slice(0, at).trim();
  if (!own) return inContext;
  if (surface !== undefined && inContext && sameText(own, surface) && !sameText(inContext, surface)) {
    return inContext;
  }
  // MSG-VOCAB-8.9 — both, stand-alone meaning first, when they say different
  // things ("tío = mate || uncle" → "uncle / mate"). A first half that only
  // echoes the span adds nothing.
  const echoesSpan = surface !== undefined && sameText(inContext, surface);
  // MSG-VOCAB-8.11 — a half with a literal rendering already carries enough:
  // it is shown alone, without the other half after a slash.
  if (hasLiteral(own)) return own;
  if (withContext && inContext && !echoesSpan && hasLiteral(inContext)) return inContext;
  if (withContext && inContext && !echoesSpan && glossKey(own) !== glossKey(inContext)) return `${own} / ${inContext}`;
  return own;
}

/** MSG-VOCAB-8.9 — what two glosses are compared on: case, spacing,
 *  punctuation and the second half's `(lit: …)` ignored. */
function glossKey(gloss: string): string {
  return gloss
    .replace(/\(\s*lit\s*:[^)]*\)/giu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function hasLiteral(gloss: string): boolean {
  return /\(\s*lit\s*:/iu.test(gloss);
}

function sameText(a: string, b: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

/** Word-boundary occurrences of `part` in `sentence`, as [start, end) pairs.
 *  The boundaries mirror the CLIENT's tokenizer (`tokenizeVocab`), which is the
 *  thing that will actually underline these — a substring test would place "ab"
 *  inside "haben" and highlight a fragment of an unrelated word. */
function occurrences(sentence: string, part: string): Array<[number, number]> {
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])(${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![\\p{L}\\p{N}])`,
    "giu",
  );
  const out: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    out.push([m.index, m.index + m[0].length]);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

/**
 * MSG-PIPE-24.12 — place a SPLIT construction, or refuse.
 *
 * `fährt ... ab`, `bien ... que`, `habe ... gelesen`: the parts are real, in
 * order, with other words between them. Returns the parts AS THEY APPEAR when
 * exactly ONE ordered, non-overlapping placement exists; null otherwise.
 *
 * ONE placement is the whole rule, and it is stricter than "pair each part with
 * the next candidate". A sentence carrying `bien`, an unrelated `que`, and then
 * a genuine `bien ... que` admits three placements — (1,2), (1,4), (3,4) — and
 * nothing in the text says which was meant, so it is dropped. Extra occurrences
 * that form no placement do not count against it: a stray second `bien` AFTER
 * the only `que` creates no pairing and is simply ignored, so the real one is
 * still found. Zero placements is a drop for the same reason as any other
 * unplaceable line.
 *
 * Enumeration stops the moment a second placement is found, so the search is
 * bounded by the answer rather than by the sentence.
 */
export function resolveSplitSpan(surface: string, sentence: string): string[] | null {
  if (!ELLIPSIS.test(surface)) return null;
  const parts = surface.split(ELLIPSIS).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const spots = parts.map((p) => occurrences(sentence, p));
  if (spots.some((s) => s.length === 0)) return null;

  const found: Array<Array<[number, number]>> = [];
  const walk = (depth: number, after: number, acc: Array<[number, number]>): void => {
    if (found.length > 1) return; // a second placement is all the answer needs
    if (depth === parts.length) {
      found.push([...acc]);
      return;
    }
    for (const spot of spots[depth]!) {
      if (spot[0] < after) continue;
      acc.push(spot);
      walk(depth + 1, spot[1], acc);
      acc.pop();
      if (found.length > 1) return;
    }
  };
  walk(0, 0, []);

  if (found.length !== 1) return null;
  return found[0]!.map(([a, b]) => sentence.slice(a, b));
}

/**
 * Parse a vocab-list body into ordered entries.
 *
 * `occursIn` is the sentence membership test, and it is REQUIRED to be real —
 * it is what disambiguates the readings above, not merely a filter applied
 * afterwards. There is always a sentence to check against: the translation for
 * translate modes, the source itself for annotate-only.
 */
export function parseVocabList(
  body: string | null | undefined,
  occursIn: (surface: string) => boolean,
  /** MSG-PIPE-24.12 — the sentence itself, which a split construction needs
   *  because placing it is about POSITIONS, not membership. Optional so a
   *  caller with only a predicate still works; without it a split line is
   *  dropped exactly as before. */
  sentence?: string,
): VocabEntry[] {
  if (!body) return [];
  const out: VocabEntry[] = [];
  const seen = new Set<string>();
  for (const raw of body.split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    // Tolerate a bullet the model adds out of habit. Unlike `*` (the legacy
    // flag, and WhatsApp bold) `-`/`•` cannot begin a user's own span, so
    // stripping them is unambiguous.
    if (line.startsWith('-') || line.startsWith('•')) line = line.slice(1).trim();
    if (!line) continue;

    // The sentence arbitrates; a line no reading can place is DROPPED rather
    // than guessed at. A missing highlight costs the reader one word; a wrong
    // one costs them their trust in every highlight.
    const picked = pickReading(line, occursIn);
    if (!picked) {
      // MSG-PIPE-24.12 — a SPLIT construction: no single run to underline, so
      // no reading places, but both halves are right there in the sentence.
      // Emit ONE ENTRY PER PART, all carrying the same gloss with the whole
      // construction named in it. Tapping either half then shows
      // "leaves (fährt … ab)" — the pair's meaning, attributed to the pair.
      //
      // That naming is what makes this safe, and it is why the earlier attempt
      // at this was reverted: `fährt` alone does NOT mean "leaves", so an entry
      // glossing one half as the whole would teach a wrong word. Highlighting
      // both and labelling the construction teaches the real thing.
      const split = sentence
        ? readings(line)
            .map((r) => ({ r, parts: resolveSplitSpan(r.surface, sentence) }))
            .find((c) => c.parts !== null)
        : undefined;
      if (!split || !split.parts) continue;
      const label = split.parts.join(" … ");
      for (const part of split.parts) {
        const k = part.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ surface: part, gloss: `${ownGloss(split.r.gloss, split.r.surface)} (${label})` });
      }
      continue;
    }
    const { surface, gloss } = picked;
    const key = surface.toLowerCase();
    // Dedupe by lowercased surface, keeping the FIRST occurrence — the same
    // document-order contract the tag parser had, so everything downstream is
    // indifferent to which format produced the list.
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ surface, gloss: cardGloss(gloss, surface) });
  }
  return out;
}

/** The stored shape: the format is transport only, and nothing downstream of
 *  the parser knows which one was used. (`swapWords` was dropped when the swap
 *  feature was retired — MSG-PIPE-19.2.) */
export type VocabPayload = {
  complexWords: string[];
  wordTranslations: Record<string, string>;
};

export function toVocabPayload(entries: VocabEntry[]): VocabPayload {
  const complexWords: string[] = [];
  const wordTranslations: Record<string, string> = {};
  for (const e of entries) {
    complexWords.push(e.surface);
    wordTranslations[e.surface.toLowerCase()] = e.gloss;
  }
  return { complexWords, wordTranslations };
}

/** MSG-PIPE-27.1 / 27.2 — the vocab rules every non-analysis surface
 *  includes: the canonical list rules (analysis wording) plus the split rule.
 *  One place, so no prompt can carry its own weaker copy. */
export function vocabListFormatRules(nativeLanguage: string, sentence?: string, words?: string): string {
  return `${vocabListRules({ gloss: nativeLanguage, sentence, words })}

${splitConstructionRule()}`;
}
