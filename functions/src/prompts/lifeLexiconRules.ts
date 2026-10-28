/**
 * LIFE-STORY-LEXICON-1 / -2 — the portentous-noun family and the stock
 * warning-idiom, banned by name. THE ONLY COPY.
 *
 * ── THIS WAS A TEMPORARY DUPLICATE, AND THE DUPLICATION IS OVER ─────────────
 *
 * Written in SRV-PROMPT-8..13 batch 3 as the server half of a split, with a
 * stated expiry: batch 5, when `life_saga` moved and the client's
 * `LEXICON_RULES` went with it. That happened (2026-09-18), and the claim was
 * verified rather than inherited — `git grep LEXICON_RULES` showed
 * `prompts/sagaOpen.ts` as the last non-test consumer, so the client constant is
 * DELETED and this is now the only rule text in the repository.
 *
 * ⚠ THE FILE ITSELF DOES NOT DIE, and its old header said it would. What
 * expired was the DUPLICATION, not the artefact: two server prompts read this —
 * `lifeWorldArc.ts` (chapter names) and `lifeSagaOpen.ts` (saga title, place
 * names, faction names, cast epithets) — which is exactly why the rule is shared
 * rather than written twice. The reported failure (2026-08-01) spanned all of
 * those surfaces from the same dozen words.
 *
 * Renamed `WORLD_ARC_LEXICON_RULES` → `LEXICON_RULES` at the same time: the old
 * name described its only reader, and it now has two.
 *
 * ── WHAT DELIBERATELY DID NOT COME ACROSS ───────────────────────────────────
 *
 * `BANNED_LEXICON` and `BANNED_IDIOMS` are SCORERS and are STILL CLIENT-SIDE.
 * `tests/playthrough/ruleConformance.ts`, `rescore.ts` and `run.play.ts` count
 * violations against them; the server does not score, so it has no use for the
 * lists as lists, and a second copy of a word list that looks authoritative is
 * exactly how two lists come to disagree about which one is. This file holds the
 * RENDERED rule text and nothing else.
 *
 * ⚠ RETIRING THE PARITY GUARD LEFT ONE THING UNASSERTED, and it was replaced
 * rather than dropped. The client's rule text was BUILT by interpolating those
 * two arrays, so the old equality test tied the SCORED words to the BANNED words
 * as a side effect. With the client text gone, a word could be added to the
 * scorer and never to this file — a benchmark marking output down for a rule the
 * model was never given. `serverPromptParity.test.ts` now asserts the
 * containment directly, which is more than the equality ever proved.
 *
 * ── WHY THE TEXT IS FLAT ────────────────────────────────────────────────────
 *
 * The client used to build these lines by interpolating its arrays. This is the
 * rendered RESULT, written out, with no template substitution — so the bytes a
 * reader sees here are the bytes the model sees. Still pinned by test
 * (`not.toContain('${')`): a copy that interpolated its own arrays could agree
 * with them at import time and diverge on a value neither test had looked at.
 */
export const LEXICON_RULES: string[] = [
  `NAMING + WORD CHOICE (LIFE-STORY-LEXICON-1, load-bearing):`,
  `- These words are BANNED as atmosphere — in titles, chapter names, place names, faction names, character epithets, and narration: echo, shadow, silence, whisper, unspoken, forgotten, hollow, veil, ash, ember, bone, dust, fracture, shard, remnant, last breath, final, eternal, the weight of. They are the default vocabulary of generated fiction, and a story built from them announces itself as generated.`,
  `- The ban is on the ABSTRACT use. A ship's deck really is salted, a burnt house really does have ash on it, a cave really is hollow — concrete nouns doing concrete work are fine. What is banned is reaching for one to supply MOOD: "the Syndicate of Silence", "the Archive of Unspoken Vows", "the Echo-Heirs", "Le Dernier Souffle de Verre", "L'Ombre-sur-Seine". Every one of those came from a single session and they are all the same name.`,
  `- ALSO BANNED as a shape: "The <abstract noun> of <abstract noun>" and "The <adjective> <abstract noun>". If the title would still make sense attached to a different story, it is not a title, it is a mood.`,
  `- INSTEAD, name things after something the player can POINT AT in this specific world: a street, a dish, a shop sign, a boat, a debt, a nickname, a piece of local slang, a date. "Le 14 rue Cendrillon", "The Tuesday Market", "Bébert's Ledger", "Two Weeks in Valence". A name that could belong to no other story is doing its job.`,
  `- The test, and you can run it on your own draft: swap this story's setting for a completely different one. If the name still fits, rewrite it.`,
  ``,
  `WHAT CHARACTERS SAY (LIFE-STORY-LEXICON-2):`,
  `- BANNED as dialogue: any stock warning-idiom. "The walls have ears." "Be careful who you trust." "There is something you should know." "Nothing here is what it seems." "Nothing is what it seems." "You didn't hear this from me." "Some things are better left alone." These are what a character says when the writer has not decided who they are.`,
  `- A person who is worried says something ONLY THEY would say, about a SPECIFIC thing: "Don't say that in front of Bartek." "Not on a Thursday, they do the rounds on a Thursday." "Just — put it in the bag." Their voice="…" attribute is the source; if the line would fit any nervous person in any story, it belongs to nobody.`,
  `- The strongest version of unease is usually NOT saying it: changing the subject, going quiet, looking at the door, suddenly having somewhere to be.`,];
