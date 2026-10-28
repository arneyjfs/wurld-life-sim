/**
 * MSG-PIPE-27 — ONE rulebook for every prompt that translates a chat message
 * or lists its vocabulary.
 *
 * The analysis SI (`unifiedAnalysis.ts`) is the most measured prompt in the
 * repo, so ITS wording is canonical and every other surface includes these
 * blocks verbatim. They are parameterised only by nouns (which sentence the
 * list comes from, the gloss-language token), never by rules, so a surface
 * cannot quietly carry a weaker copy. `promptRulebook.test.ts` renders every
 * prompt builder and fails when one is missing a block it owes; the deliberate
 * exceptions are tabled in docs/specs/message-pipeline.md (MSG-PIPE-27).
 *
 * Editing a block here changes EVERY surface at once. That is the point, and
 * it is also why a change needs every affected prompt suite re-run.
 */

export type VocabVoice = {
  /** The gloss language as the prompt names it: a token ("NATIVE") or a real
   *  language name for the prompts that are built per pair. */
  gloss: string;
  /** Where the spans come from: "practice sentence" (analysis), "sentence". */
  sentence?: string;
  /** What is being glossed: "practice words" (analysis), "words". */
  words?: string;
};

/** MSG-PIPE-27.1 — the vocab list: format, glosses, density, grouping. */
export function vocabListRules({ gloss, sentence = "sentence", words = "words" }: VocabVoice): string {
  return `  FORMAT — ONE ENTRY PER LINE, in sentence order:
  surface form = ${gloss} in context || ${gloss} on its own
  LEFT of the first " = " is the span EXACTLY as it appears in the ${sentence} — the app string-matches it to highlight the span, so a lemma, a re-spelling or a changed accent will not match and the entry is discarded. RIGHT of it come two ${gloss} glosses of the ${words}, split by " || ": first what they mean in context, then what they mean on their own. Plain text; no escaping needed.
  No tags, no attributes, no quotes around either side, no numbering, one entry per line.
  If a span itself contains " = " or begins with "*", write it exactly as it appears anyway; do not trim or escape it.

  DENSITY — THE GAP RULE (the only rule on how many to list):
  The listed spans, read in sequence, must let a reader reconstruct the core ideas of the message. Do not leave a gap of more than ~3 consecutive unlisted words: wherever you see 4+ unlisted words in a row, list something in that gap.
  SKIPPABLE (these count toward the 3-word gap budget):
    - Function words alone: articles (the / le / la / un), basic prepositions (of / de / à / en), pronouns (I / you / je / tu / il / elle), conjunctions (and / but / or / et / mais), copulas (is / est / était).
    - Numbers, proper nouns, brand names, names of people.
    - Punctuation and pure exclamations (!, ?, oh, ah, hmm).
    - Obvious cognates that look near-identical in both languages.
  MUST LIST:
    - Content words: nouns, verbs, adjectives, adverbs.
    - Fixed expressions — one entry for the whole group: "en fait = actually", "du coup = so/therefore".
    - Short noun phrases with article — one entry for the whole group: "la voiture rouge = the red car".
    - Verb constructions (auxiliary + participle, verb + particle, reflexives) — one entry for the whole group: "a dû partir = had to leave".
  GROUPING: no group longer than 4 words; never extend a group across a comma, full stop, conjunction or new subject; prefer the whole group over its individual words.
  TWO GLOSSES, TWO JOBS. The first is what the ${words} mean in context, however loosely. The second is the back of a flashcard the reader studies weeks later with NO message around it, so it must stand alone: what the ${words} themselves mean, as a good bilingual dictionary would put it, in their own tense and person, nothing borrowed from the context.
    "Tiens-moi au courant = let me know || keep me posted (lit: hold me in the current)"
    "a cántaros = cats and dogs || pouring (lit: by pitchers)"
    "on se retrouve = shall we meet || we meet up"
    "la voiture rouge = the red car || the red car"
  LITERAL GLOSS (flashcard gloss only): add "(lit: word-by-word)" to idioms and fixed expressions whose word-by-word reading differs from the meaning; skip it when the two match ("la voiture rouge = the red car").
  Entries appear in sentence order. Never list the same span twice.`;
}

/** MSG-PIPE-27.2 / MSG-PIPE-19.8 — split constructions. Every vocab surface
 *  except analysis, which never emits one (NV1–NV5). */
export function splitConstructionRule(): string {
  return `  SPLIT CONSTRUCTIONS — words that belong together with other words between them (a French negation such as ne + pas, a German separable verb, a perfect around its object). If ONE OR TWO words sit between the parts, list the WHOLE run as one entry, middle words included: "ne le sais pas = don't know it", "n'en veux pas = don't want any", "rufe dich morgen an = call you tomorrow". Only when MORE words sit between, write the parts exactly as they appear, in order, joined by "...": "fährt ... ab = leaves" in "Der Zug fährt um acht Uhr ab". The app finds both halves, underlines them together, and shows the reader the whole construction when they tap either one. Never list one half on its own: "fährt" does not mean "leaves" — that sense belongs to the pair — so a lone half teaches the reader a word the language does not have. If the two halves cannot be told apart because BOTH appear more than once in the sentence, the entry is dropped, so prefer a different span in that case.`;
}

/** MSG-PIPE-27.3 — how a translation reads; MSG-PIPE-27.8 — friend-to-friend, one version. */
export function translationStyleRules(): string {
  return `- Write it the way a native speaker texts a friend: natural, casual, same tone. Never word-for-word.
- Use the target's word order, even in a fragment with no verb: French puts most adjectives after the noun, so "incredible bread" = "pain incroyable", never "incroyable pain"; only short common adjectives go first ("lovely colour" = "jolie couleur").
- Keep degree and tone. Hedges stay hedges: "pretty good", "quite", "a bit", "kind of" = "plutôt", "assez", "un peu" — never "très" or "vraiment". Stay as vague as the sender was.
- Contract where a texter would ("I'm", "don't", "c'est"). Writing "I am" / "do not" in a casual text changes the register.
- Same message, same length: every idea the sender gave, and nothing they did not. Do not add, drop, simplify or elaborate.
- Speak friend-to-friend. Wherever the target language has a familiar and a polite way to say "you", or politeness levels, use the familiar form a friend uses with a friend (French tu, German du, Spanish tú, Russian ты, the Japanese plain form, Korean 반말), even when the source sounds polite. Keep a formal form only where the sender typed it themselves in that language.
- Write ONE version and commit to it. Never offer two alternatives side by side: no slash between options, no "or" between options, no option in brackets. The gender rule's both forms are the only exception.`;
}

/** MSG-PIPE-27.4 — a GENUINELY unknown gender gets both forms (owner
 *  decision 2026-09-25); a named one gets only that form. */
export function genderRule(): string {
  return `- Gender: follow the gender cue given for the message. Words about the sender (first person) take the sender's gender; words about the person addressed ("you look happy") take theirs. When the cue says the sender's or the addressee's gender is UNKNOWN, give BOTH forms on a word that genuinely inflects for that person — "content(e)", "tout(e) seul(e)" — and nowhere else: never on an invariant word (malade, sympa, triste), never inside a fixed phrase with no agreement ("un peu" is never "un(e) peu"). Both forms go only into a sentence YOU write — never into words the sender wrote in the language, and never as a correction. When the cue names the gender, use that form only. Both forms are ONLY for the sender ("I") and the person addressed ("you"): words about anyone else — "they", "he", "she", a person the sender mentions — take the natural default, one form, however unknown their gender ("They are happy" = "Ils sont contents").`;
}

/** MSG-PIPE-27.5 — formatting survives translation. Stated in WORDS only: no
 *  paired-marker demonstration, because this model family copies a
 *  demonstration even under a "never" label (TUTOR-INV-23). */
export function formattingRules(): string {
  return `- Keep the sender's line breaks, paragraph structure and emoji exactly.
- WhatsApp formatting: when the sender put an asterisk, underscore or tilde around words (bold, italic, strikethrough), put the same single marker around the same words in the translation. Never add a marker the sender did not type, and never double one. Keep bullet lines, in the same order.
- A link: translate its label, never its URL.
- A very short message (1-3 words) stays similarly short.
- No tags or XML-like markup inside a sentence.`;
}

/** MSG-PIPE-27.6 — the span check every vocab checklist runs. It agrees with
 *  the split rule instead of contradicting it. */
export function spanCheck(where = "the sentence its list belongs to"): string {
  return `does every surface form appear EXACTLY in ${where}, as one unbroken run — or, for a split construction with a longer middle, as its parts joined by "..." — and does every line carry both glosses, split by " || "? A span that does not occur there is discarded.`;
}
