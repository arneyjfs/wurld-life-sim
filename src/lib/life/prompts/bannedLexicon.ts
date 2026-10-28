/**
 * LIFE-STORY-LEXICON-1 — the portentous-noun family, banned by name.
 *
 * Reported 2026-08-01, after `LIFE-STORY-VOICE-1` shipped: *"Still too many
 * titles, chapters and prose with the words echo, shadow, etc."*
 *
 * `worldSaga` already told the model not to write "The Shadow of X" as a TITLE.
 * That was too narrow twice over: it named one construction rather than the
 * vocabulary, and it governed one of the three surfaces that produce this
 * language. The reported session, from a single seed, produced *Le Dernier
 * Souffle de Verre*, *L'Ombre-sur-Seine*, the *Syndicate of Silence*, the
 * *Archive of Unspoken Vows*, the *Echo-Heirs* and *The Final Broadcast* —
 * saga title, place name, faction names and chapter names, all drawing on the
 * same dozen words.
 *
 * WHY A LIST AND NOT "be original": the same reason `LIFE-STORY-VOICE-1` is a
 * count rather than a plea. "Avoid cliché" is unobservable — the model cannot
 * tell that its output is the median output, because the median is exactly
 * what it samples. A list of words it can scan its own draft for is checkable
 * in one pass.
 *
 * The ban is on these words as ATMOSPHERE, which is the only way they arrive.
 * A ship's deck really is salted and a burnt house really does have ash; the
 * rule targets the abstract slot — a title, a faction name, a chapter name, or
 * a line reaching for mood — not the concrete noun doing a concrete job.
 */
export const BANNED_LEXICON = [
  'echo',
  'shadow',
  'silence',
  'whisper',
  'unspoken',
  'forgotten',
  'hollow',
  'veil',
  'ash',
  'ember',
  'bone',
  'dust',
  'fracture',
  'shard',
  'remnant',
  'last breath',
  'final',
  'eternal',
  'the weight of',
] as const;

/**
 * LIFE-STORY-LEXICON-2, as a LIST rather than only as prose in the rule below.
 *
 * Same argument this file already makes for the noun ban — *"a list of words it
 * can scan its own draft for is checkable in one pass"* — applied to the
 * dialogue idioms, which were named only inside a prompt sentence and so could
 * not be counted by anything.
 *
 * These differ from `BANNED_LEXICON` in a way that matters to any checker: a
 * single banned NOUN has an innocent concrete use ("the dusty toolbox"), while
 * a stock idiom does not. That makes these safely machine-countable, and the
 * nouns not.
 */
export const BANNED_IDIOMS = [
  'the walls have ears',
  'be careful who you trust',
  'there is something you should know',
  'nothing here is what it seems',
  'nothing is what it seems',
  "you didn't hear this from me",
  'some things are better left alone',
] as const;

/**
 * ⚠ `LEXICON_RULES` USED TO LIVE HERE AND IS NOW SERVER-ONLY.
 *
 * SRV-PROMPT-8..13 batch 5 moved `life_saga` server-side, which was this rule
 * text's last client consumer (`life_world_arc` took a duplicate in batch 3 and
 * `LIFE-SI-LEAN-7` had already dropped it from the step SI on measurement). A
 * retired prompt artefact is DELETED rather than left importable
 * (SRV-PROMPT-3 / PRACTICE-OWN-8), so the rendered lines now live once, at
 * `functions/src/prompts/lifeLexiconRules.ts`, where a correction is one
 * `deploy:prod:functions` away instead of an App Store review.
 *
 * ⚠ THE TWO ARRAYS ABOVE DID NOT GO WITH IT, and the split is deliberate. They
 * are SCORERS: `tests/playthrough/ruleConformance.ts`, `rescore.ts` and
 * `run.play.ts` count violations against them. The server does not score, so it
 * has no use for the lists as lists — and a second copy of a word list that
 * looks authoritative is exactly how two lists come to disagree about which one
 * is.
 *
 * ⚠ THAT SPLIT NEEDS A GUARD, because the old parity test provided one by
 * accident. The rule text used to be BUILT from these arrays, so a word added
 * here reached the prompt automatically; now it does not, and a scorer could
 * count violations of a rule the model was never given.
 * `tests/playthrough/serverPromptParity.test.ts` asserts that every word in
 * `BANNED_LEXICON` and every idiom in `BANNED_IDIOMS` appears in the shipped
 * server rule text — which is the property that actually mattered.
 */
