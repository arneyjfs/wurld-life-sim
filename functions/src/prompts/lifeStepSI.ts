/**
 * LIFE-CTX-3 / LIFE-SI-LEAN-7 — the `life_step` SYSTEM INSTRUCTION, SERVER-OWNED.
 *
 * SRV-PROMPT-8..13 batch 8. A byte-for-byte port of five client modules that
 * between them built one string and had no consumer but this one:
 *
 *   · `prompts/stepLean.ts`        — the instruction itself
 *   · `prompts/levelLadder.ts`     — LIFE-LANG-9.1's single band
 *   · `prompts/vocabRules.ts`      — LIFE-LANG-10 (LIFE-LANG-18 swap words retired 2026-09-24)
 *   · `prompts/stepSchemaBlock.ts` — the parse contract `ZRawNodeResponse` reads
 *   · `optionGrid.ts`'s `optionOutputContract` + `gradeTargetBand`
 *
 * All five are DELETED client-side (SRV-PROMPT-3) except the two split files,
 * whose ENGINE halves stayed: `optionGrid.ts` keeps `gradeOptionSet` /
 * `offeredShapes` / `takenShapeCounts`, which judge the model's answer.
 *
 * ⚠ NO `responseSchema`, AND IT MUST NOT ACQUIRE ONE (SRV-PROMPT-11 /
 * LIFE-CTX-15). A schema was tried on this call and measured: runaway
 * generation, dropped optional nested objects, narrative output halved. The
 * output contract is `stepOutputSchemaBlock` below — PROSE inside the system
 * instruction, not a `responseSchema`. The two are easy to confuse and the
 * confusion is expensive, so: this block is rendered text the model reads, and
 * `buildLifeStep` returns no `responseSchema` at all. That also removes
 * SRV-PROMPT-1's usual safety — there is no schema whose presence proves the
 * prompt moved — which is why `lifeStep.test.ts` asserts this block's CONTRACT
 * TEXT rather than the absence of a schema.
 *
 * ⚠ NO `cacheSlot` EITHER, and it is checked rather than assumed. This SI
 * interpolates FOUR caller values (`practiceLanguage`, `nativeLanguage`,
 * `systemLanguage`, `difficulty`), so it is not byte-constant across the
 * population and a slot would make every call a billed cache CREATE
 * (PRACTICE-CACHE-1). `explicitSiCache.ts`'s `SERVER_OWNED_SI` holds
 * `life_backdrop` and nothing else — read from the CODE, because
 * LIFE-BACKDROP-14's prose is stale by LIFE-BACKDROP-22's rename and batch 4's
 * brief inherited the stale name as a hazard.
 *
 * ⚠ `optionRules` DID NOT COME WITH `optionOutputContract`, deliberately.
 * It built five SI lines for the DELETED full variant and nothing has called it
 * since LIFE-SI-LEAN-7 — `git grep optionRules` returned its own definition and
 * nothing else. Porting it would have put five prompt rules server-side that no
 * prompt serves, which is the `prompts/stepTurn.ts` shape batch 0 deleted for
 * exactly this reason. Its rules are not lost: `stepLean.ts`'s `OPTIONS —` line
 * and `optionOutputContract`'s `actionType` row carry the live versions.
 */

/**
 * LIFE-LANG-9 — the language-level ladder for the step system instruction.
 *
 * Extracted from `step.ts` for the 600-line cap (`max-lines` counts code, not
 * comments, so trimming prose there frees nothing — only moving statements
 * does). Self-contained: it reads three inputs and interpolates nothing else.
 *
 * The parallel story-engine-v2 branch factored the identical block out under
 * the same name, independently. Keeping the name matching costs nothing and
 * makes the two trees easier to compare.
 *
 * Returns ONE joined string, as `step.ts` consumed it — the ladder is a single
 * logical section and splitting it into rows would let a caller interleave
 * something between the level rule and its own worked illustration.
 *
 * ── LIFE-LANG-9.1: ONLY THE PLAYER'S OWN BAND IS RENDERED ───────────────────
 *
 * This block used to ship all three bands on every call. At difficulty 3 the
 * model was handed the level 1-2 rules (with a worked illustration), the 3-4
 * rules, AND the 5-7 rules, plus a paragraph explaining the mapping between
 * them — roughly two thirds of the section describing levels the player is not
 * on and can never be on for the life of this world.
 *
 * `difficulty` is already a parameter, so this is decidable in code. Rules for
 * a band the player is not in cannot be helping, and this repo has now measured
 * twice what surplus text in THIS prompt costs: a worked example for the wrong
 * case beat the rule outright (`LIFE-CONTRACT-EX-9`), and at 75k characters no
 * single rule in the file is reliably salient (`LIFE-ENGINE-CMP-3`). Text that
 * is unreachable by construction is the cheapest possible thing to remove —
 * unlike the option grid (38% of the SI) it needs no judged gate to justify.
 *
 * WHAT SURVIVES AT EVERY LEVEL, because none of it is band-specific:
 *   · the LANGUAGE LEVEL rule — what leveling means, and err-toward-simple;
 *   · the anti-sanitise rule — level governs LANGUAGE, never STORY. This is the
 *     guard that stops a level-1 noir becoming a bedtime story, and it matters
 *     MOST where the band text is shortest;
 *   · the FLOOR — simple is not childish.
 *
 * The per-band illustration stays with its band: a beginner still gets the
 * worked dark-scene-in-easy-words example, which is the one place an exemplar
 * in this file has ever demonstrably helped.
 */
const BANDS: { test: (d: number) => boolean; row: (practice: string) => string }[] = [
  {
    test: (d) => d <= 2,
    row: (practice) =>
      `- Level 1-2 (beginner ≈ early reader): very short sentences, ~3-8 words. Present tense almost only (near-future "going to + verb" is fine; avoid past tenses). Only the most common everyday words. ONE idea per sentence — NO relative/subordinate clauses, no "which / that / because / when" chains. Reuse the same key words across beats instead of reaching for synonyms. Gloss most words in wordTranslations{}. Illustration (a DARK scene in beginner ${practice} — write the SAME simplicity): "Il fait nuit. La ruelle est vide. Un homme tombe. Il y a du sang. Tu regardes. Personne ne parle."`,
  },
  {
    test: (d) => d <= 4,
    row: () =>
      `- Level 3-4 (intermediate ≈ confident young reader): fuller sentences, common past + future, everyday connectors (because, when, but), a wider but still-common vocabulary.`,
  },
  {
    test: () => true,
    row: () =>
      `- Level 5-7 (advanced ≈ teen/adult reader): natural native-like prose — subordinate clauses, the full tense + mood range (conditional, subjunctive), idiom, nuance, less-common vocabulary.`,
  },
];

export function levelLadder(opts: {
  practiceLanguage: string;
  nativeLanguage: string;
  difficulty: number;
}): string {
  const { practiceLanguage, nativeLanguage, difficulty } = opts;
  const band = BANDS.find((b) => b.test(difficulty))!;
  return [
    `LANGUAGE LEVEL (LIFE-LANG-9) — the WHOLE story the player reads — NARRATION and DIALOGUE alike — is written in ${practiceLanguage} (the practice language), LEVELED to the player's level ${difficulty}/7 (1 = absolute beginner, 4 = intermediate, 7 = advanced; native language ${nativeLanguage}). This is comprehensible-input practice: the player reads the ${practiceLanguage}, taps hard words for a gloss, and learns. Match the level HONESTLY; when unsure ERR TOWARD TOO SIMPLE, not too hard.`,
    `LEVEL GOVERNS LANGUAGE, NEVER STORY: it fixes sentence length, vocabulary frequency and grammatical complexity, and nothing else. Content, theme, tone, tension, danger and maturity come from the <saga> and the scene. A noir murder or a tense seduction at level 1 stays dark, adult and gripping — it is simply TOLD in short, plain sentences. Do NOT sanitise, soften, "kid-ify", or pick tamer events to match simple language; do NOT add words or clauses to sound sophisticated. Simple words, full-strength story.`,
    band.row(practiceLanguage),
    `FLOOR (simple is NOT childish or dull): keep it real, natural ${practiceLanguage} about a real moment with real stakes — a short plain sentence is still vivid and adult ("Il ment. Tu le sais."). Never a word-list, never robotic filler, never word-for-word translationese, never a bedtime-story register unless the SCENE is genuinely gentle.`,
  ].join('\n');
}

/**
 * LIFE-LANG-10: rich vocab-annotation guidance for the life-step SI's
 * PRACTICE-LANGUAGE channel (npc + player dialogue, and narration when
 * systemLanguage == practiceLanguage).
 *
 * Borrowed from the chat message-annotation prompt's shared
 * `buildVocabRules` (functions/src/vocabTags.ts) — the GAP-RULE
 * density, the must-tag / skippable split, group tagging, and the
 * literal-gloss rule — restated for the life beat's structured
 * `wordTranslations{}` shape (the chat prompt emits
 * inline `<vocab t="…">` tags; life beats carry the same information as
 * two parallel fields). The goal is parity: the practice-language
 * segments should be annotated as richly as chat annotates a message —
 * MORE hard words surfaced (not a "1-3 hardest" cap), better per-word
 * glosses.
 *
 * READ-ONLY borrow: `functions/src/vocabTags.ts` + the chat prompts
 * (`unifiedAnalysis.ts`, `translateMessage.ts`) are NOT edited.
 *
 * Spec: docs/specs/life-sim.md §9.6 (LIFE-LANG-10).
 */
export function lifeVocabAnnotationRules(
  practiceLanguage: string,
  systemLanguage: string,
): string {
  return [
    `VOCABULARY ANNOTATION (${practiceLanguage} channel — annotate as richly as the chat translator does). THIS IS NOT OPTIONAL POLISH — under-tagging is the single most-reported defect; treat it as a hard output requirement, not a nicety:`,
    `Populate wordTranslations{} on EVERY ${practiceLanguage} line — npc + player \`practiceText\`, AND a narrator beat's \`nativeText\` when the system language IS the practice language (${systemLanguage} == ${practiceLanguage}). Each KEY is the exact surface form as written in the line; each value is a dictionary-style ${systemLanguage} gloss. Do NOT emit a separate complexWords array — the client derives the highlight list from these keys (LIFE-COST-5).`,
    `- THE TASK IS SEGMENTATION, NOT SELECTION. Do NOT "pick the key/hard words" — that mindset ships one or two tags and stops. Instead, BREAK THE WHOLE LINE into consecutive meaningful units — content words and fixed phrases — and gloss EVERY one. Read the line left to right and chunk it end to end the way a learner parses it; every word lands in a chunk EXCEPT the bare function words in SKIP. Complete coverage is the default, not a stretch goal: if any run of 4+ ${practiceLanguage} words sits untagged, you skipped a chunk — go back and segment it. A line that came back with 1-2 tags was SELECTED, not segmented — redo it.`,
    `- WORKED EXAMPLE — the line is fully SEGMENTED (every unit glossed, only "sur/son/et/une" left as function words): practiceText "Le contrôleur relève les yeux de son carnet et te rend ton billet sans un mot." → wordTranslations { "contrôleur":"inspector", "relève les yeux":"looks up", "carnet":"notebook", "te rend":"hands you back", "billet":"ticket", "sans un mot":"without a word" }. That is the target — the whole line chunked, not two words picked.`,
    `- MUST surface: content words (nouns, verbs, adjectives, adverbs); fixed expressions + verb constructions (auxiliary+participle, reflexives, verb+particle) as ONE whole-phrase entry (≤ 4 words, never spanning a comma/conjunction/new subject); short noun-phrases-with-article as one entry.`,
    `- SKIP (the ONLY words that get no chunk of their own — they sit between chunks): bare function words (articles, basic prepositions, pronouns, conjunctions, copulas), numbers, proper nouns / names, obvious cognates that look near-identical in both languages.`,
    `- GLOSS QUALITY: a natural ${systemLanguage} meaning per entry — never a ${practiceLanguage} restatement. For a multi-word idiom/expression whose word-by-word reading would MISLEAD, gloss it as "natural meaning (lit: word-by-word)"; skip the "(lit: …)" when the literal reading already matches. Slash-separated alternates, max 2-3 ("fast/quick"). Each KEY is the EXACT form as written — never a root/base lemma.`,
    `- Annotate OPTION labels the same way when a label contains a hard ${practiceLanguage} word.`,
  ].join('\n');
}

/**
 * LIFE-LANG-9.1 — what a `gradeTarget` may be AT THE PLAYER'S LEVEL.
 *
 * Was one 692-character line naming all three bands, sent on every call. The
 * two bands the player is not on are unreachable by construction, so they can
 * only compete for attention with the one that applies — the same reasoning,
 * and the same measurement behind it, as `levelLadder`.
 *
 * The level-1 counter-example is kept INSIDE its own band because it is the
 * specific failure this rule exists to prevent (grading "voudrais" at level 1),
 * and a counter-example is only useful to the reader it applies to.
 */
export function gradeTargetBand(difficulty: number): string {
  if (difficulty <= 2) {
    return 'At this level: a high-frequency concrete word (a common noun, a greeting, or être/avoir/aller/vouloir in the PRESENT — "veux", "vais", "un café") — NEVER a conditional, subjunctive, or past-tense conjugation. Testing "voudrais" here is the EXACT failure to avoid; use "veux".';
  }
  if (difficulty <= 4) {
    return 'At this level: everyday grammar — common past ("j\'ai pris"), near-future, or a fixed expression. NOT the subjunctive, and not idiom.';
  }
  return 'At this level: any inflected verb, the subjunctive, idiom/nuance ("quand même"), or a preposition of manner ("vers").';
}


/**
 * The OPTION half of the live step's JSON output contract.
 *
 * Same reasoning as `optionRules`: `actionType` and `targetId` are validated by
 * this module, so the shape they belong to is documented next to the code that
 * enforces it rather than three hundred lines away in another file.
 */
export function optionOutputContract(opts: {
  practiceLanguage: string;
  systemLanguage: string;
}): string[] {
  const { practiceLanguage, systemLanguage } = opts;
  return [
  `  "options": [{                              // branch: 2-3 · continuation: exactly ONE with id "continue" · question: []`,
  `    "id": "short-slug",                      // unique within this response`,
  `    "nativeText": "${systemLanguage} player-ACTION label (options are ${systemLanguage} ONLY — LIFE-LANG-15) — player-side, never 1st/3rd person, ≤ 1 clause, NEVER the practice-language form. The ONLY label field on an option: do NOT emit practiceText here (the client fills it — LIFE-LANG-15).",`,
  `    "actionType": "ask"|"do"|"move"|"observe"|"offer"|"leave", // LIFE-GRID-1.1: the KIND of move this is. REQUIRED. Every option in a set must carry a DIFFERENT one, and the set must include the type named in <requiredAction>.`,
  `    "emoji": "🍐" | null,                    // optional`,
  `    "wordTranslations": { "word": "translation", ... }, // optional; the client derives complexWords from these keys`,
  `    "targetId": "canon-id" | null,           // LIFE-CANON-2: the <canon> entity this option acts on. MUST exist in <canon> or in this response's "introduces" — an unknown id is REJECTED and the turn is regenerated. Omit for an option that acts on nothing specific.`,
  `    "speechAct": "say" | "act",              // LIFE-SPEECH-1: does the PLAYER speak on this pick. Omit (= "act") for everything else, including listening and observing.`,
  `    "saysLine": {                            // LIFE-SPEECH-1: REQUIRED on every "say" option, absent on "act". The player's actual spoken line.`,
  `      "practiceText": "the player's leveled ${practiceLanguage} line — NO quotes, NO attribution tag",`,
  `      "nativeText": "faithful ${systemLanguage} gloss",`,
  `      "complexWords": ["word", ...], "wordTranslations": { "word": "translation" } // optional, same as a beat`,
  `    },`,
  `    "gradeTarget": "clé",                    // LIFE-SPEECH-3: OPTIONAL, "say" options ONLY. Set it to GRADE this pick: a word or short phrase appearing VERBATIM in this option's own saysLine.practiceText. The player then has to PRODUCE that word to say the line (an outbound fill-blank) instead of being handed it. Omit and the line simply lands as their bubble. See OUTBOUND GRADING below.`,
  `  }, ...],`,
  ];
}

/**
 * LIFE-SI-LEAN-1 — the OUTPUT SCHEMA block, extracted VERBATIM.
 *
 * This is the parse contract: every field `ZRawNodeResponse` validates is
 * described here, and the shipped prompt has been tuned against it across many
 * measured iterations (`LIFE-CTX-15` records a rejected attempt to move it onto
 * the wire as a `responseSchema` — runaway generation, dropped optional
 * objects, narrative output halved).
 *
 * It is factored out UNCHANGED so the lean-SI experiment can reuse it byte for
 * byte. The experiment asks whether v1's *prose* is load-bearing; letting it
 * also rewrite the schema would confound "less prose" with "different contract"
 * and any regression would be uninterpretable. At ~7.6k characters it is the
 * single largest block and therefore the floor on how small the lean variant
 * can get — compressing it is a separate, later question.
 */

export function stepOutputSchemaBlock(opts: {
  practiceLanguage: string;
  systemLanguage: string;
}): string[] {
  const { practiceLanguage, systemLanguage } = opts;
  return [
    `OUTPUT SCHEMA (enforced):`,
    `{`,
    `  "node": {                                  // LIVE turns ONLY (<turn kind="opening|choice|free|practiceOutcome|continue">). OMIT on <turn kind="options">.`,
    `    "kind": "branch" | "continuation" | "question",`,
    `    "beats": [{                              // branch: 0-2 · continuation: 1-2 · question: 0-2 LEAD-IN beats (see below)`,
    `      "speaker": "narrator" | "npc",`,
    `      "speakerName": string | null,          // NPC display name; null for narrator`,
    `      "npcId": string | null,                // stable slug for recurring NPCs; null otherwise`,
    `      "practiceText": "the LEVELED ${practiceLanguage} text — narration OR the spoken line; NEVER empty",`,
    `      "nativeText": "the faithful ${systemLanguage} gloss of practiceText (both narrator + npc)",`,
    `      "complexWords": ["word", ...],         // annotate the ${practiceLanguage} richly on EVERY beat (narrator + npc)`,
    `      "wordTranslations": { "word": "gloss", ... }, // ${systemLanguage} gloss per complexWords entry`,
    `    }, ...],`,
    `    "gradedPlan": {                          // kind="question" ONLY. Two shapes:`,
    `      "kind": "fill-blank",                  // OUTBOUND: player says it`,
    `      "testTarget": "veux",                  // verbatim in sentenceContext; NOT in <recentlyPracticed>; MATCH THE LEVEL — present form shown; reserve "voudrais" for level 5-7`,
    `      "sentenceContext": "Je veux un café.",`,

    `    } | {`,
    `      "kind": "comprehension",               // INBOUND: NPC is about to say it`,
    `      "npcUtterance": "Combien ça coûte ?",  // verbatim ${practiceLanguage} line — NEVER emitted as a beat`,
    `      "speakerName": "Paul",`,
    `      "npcId": "<cast-id>" | null,`,
    `    },`,
    `    "resolution": {                          // kind="question" ONLY (LIFE-EX-PLAN-5) — what happens after the answer. ONE version; the story never forks on correctness.`,
    `      "beats": [ ...0-2 beats... ],          // what happens AFTER the speech event; may be [] for inbound comprehension. NEVER re-quote the practised line.`,
    `      "options": [ ...2-3 options... ],      // the choices out of the resolved moment; same rules as any option`,
    `      "logLine": "terse ${systemLanguage} line for the resolution"`,
    `    },`,
    `    "backdropIntent": {                         // optional, only when this node happens elsewhere`,
    `      "locationType": "cafe", "vibe": "modern_city",`,
    `      "persistent": true, "locationLabel": "${practiceLanguage} place name, no time of day",`,
    `      "locationLabelNative": "the same place name in ${systemLanguage}",`,
    `      "flavour": "...", "transportMode": "metro" | null`,
    `    }`,
    `  },`,
    ...optionOutputContract({ practiceLanguage, systemLanguage }),
    `  "worldDelta": {                            // optional, world-state changes`,
    `    "timeAdvance": "none"|"some"|"lots"|"nextMorning", // LIFE-TIME-1: how much time THIS turn consumed. "some" = a conversation, an errand, a walk across town. "lots" = a shift finished, a long journey, a meal and everything after it. "nextMorning" only when the story genuinely sleeps. Do NOT state a time — code owns the clock and only ever moves it forward.`,
    `    "currentLocationLabel": "...",`,
    `    "objectiveDone": true,                   // LIFE-GOAL-3: ONLY when the player actually achieved the current objective this turn. Leaving it out keeps the objective live — that is the default and it is correct.`,
    `    "objectiveClosed": "why, in one clause", // ONLY when the world has genuinely put it out of reach ("Bébert changed the lock"). The player is SHOWN this reason.`,
    `    "nextObjective": "get Hélène to look at your work", // the next near thing, 1-3 scenes. IGNORED unless the current objective just ended or there is none. See <goalDirective>.`,
    `    "nextObjectiveNeed": "Hélène",           // optional; ONE name only — a person, a thing or a place the objective depends on. Just the name.`,
    `  },`,
    `  "scene": {                              // optional, LIFE-SCENE-* signals — same shapes as before`,
    `    "sceneProgress": 0-100,                  // LIFE-SCENE-25: how far the SUBJECT has come. REQUIRED every turn while a scene is active.`,
    `    "leaning": "where the scene's open question sits AFTER this turn — one clause",`,
    `    "leaningMoved": true | false,            // LIFE-INTENT-2: did the PLAYER'S action change it? Both REQUIRED on every turn a <sceneQuestion> block is present.`,
    `    "replanRequested": true | false,`,
    `    "hardPivot": true | false,`,
    `    "resolved": {`,
    `      "endingKey": "short lower-case slug for what happened, e.g. crate-returned",`,
    `      "outcomeLine": "one-sentence outcome for the completion screen, in the practice language",`,
    `      "outcomeLineNative": "the SAME sentence in the system language (REQUIRED — LIFE-SCENE-28)",`,
    `      "keyMomentsForArc": ["...", "..."],`,
    `      "promotedNpcIds": ["npc-id-1"],`,
    `      "retiredNpcIds": ["npc-id-2"],`,
    `      "arcStage": "continues" | "climactic" | "concluding"`,
    `    },`,
    `    "phaseTransition": "rising" | "midpoint" | "climax" | "resolution" | null`,
    `  },`,
    `  "introduces": [{                            // LIFE-CANON-1 — optional, max 4. ONLY what this turn establishes for the FIRST time.`,
    `    "kind": "character" | "place" | "object" | "fact" | "faction",`,
    `    "name": "how it is named in the story",`,
    `    "subKind": "person" | "spirit" | "animal" | "statue" | ..., // characters only — what it actually IS`,
    `    "note": "one line the player now knows about it",`,
    `    "canSpeak": false                        // set on anything that CANNOT be spoken to; omit otherwise`,
    `  }, ...],`,
    `  "logLine": "ONE terse ${systemLanguage} sentence recording what just happened — facts and consequences, not atmosphere", // LIFE-STORY-LOG-1, required on every response`,
    `  "npcMemoryUpdates": [{ "npcId": "roster-id", "oneLineMemory": "≤30-word ${systemLanguage} second-person line" }] // LIFE-NPC-MEM-1 — optional, max 3; ONLY NPCs whose relationship advanced this turn`,
    `  "felt": [{ "who": "roster-id or name", "delta": -1 | 0 | 1 }] // LIFE-REP-3 — optional, max 2. How the turn landed with ONE person, and ONLY when their regard for the player actually moved. 0 is the normal answer, so most turns omit this entirely. NEVER driven by whether they answered a question correctly.`,
    `}`,
    `Return ONLY valid JSON matching this schema. No prose, no markdown fences.`,
  ];
}

/**
 * The `life_step` system instruction.
 *
 * ── WHAT IT IS NOW ─────────────────────────────────────────────────────────
 *
 * The ONLY `life_step` system instruction. The full one — ~73,000 characters
 * over 641 lines — was deleted on 2026-08-10 (`LIFE-SI-LEAN-7`) along with the
 * variant switch that used to choose between them. This file is ~21,000.
 *
 * ── WHAT THE EXPERIMENT ANSWERED, IN BOTH DIRECTIONS ────────────────────────
 *
 * `LIFE-ENGINE-CMP-3` argued the 73k SI was too large for any single rule in it
 * to be reliably salient. That was RIGHT: retry 18.6% -> 3.0%, disjoint
 * intervals, 60% fewer input tokens, output length unchanged.
 *
 * It was WRONG that the prose was therefore free to delete. Five of the dropped
 * rules were load-bearing and their absence was invisible to the parser, the
 * validator and all 43 string tests alike — `gradeTarget` went to ZERO in 319
 * turns, which is a build where the player never once practises SPEAKING
 * (`LIFE-CONFORM-1`). They were ported back for ~1,800 characters
 * (`LIFE-SI-LEAN-5/6`).
 *
 * So the rule is neither "small is better" nor "the prose is load-bearing". It
 * is: **a rule earns its characters or it goes, and the only way to know which
 * is to measure the behaviour it protects.** Every rule NOT ported carries its
 * measurement at the site where it was dropped.
 *
 * ── WHAT IS SHARED, AND WHY THAT MATTERS ────────────────────────────────────
 *
 * Three blocks are reused byte for byte from before the rewrite:
 *
 *   · `stepOutputSchemaBlock` — the parse contract `ZRawNodeResponse` validates
 *   · `lifeVocabAnnotationRules` — the vocab channel the flashcard deck reads
 *   · `levelLadder` — banded to the player's own level (`LIFE-LANG-9.1`)
 *
 * They are ~11k characters, so they are the FLOOR: this cannot go below them
 * without changing what the app can parse. **Their cross-references have to
 * resolve here.** `LIFE-SI-LEAN-6` cost two failed rewrites to learn that: the
 * schema block ends a line with "See OUTBOUND GRADING below", and while no
 * section by that name existed, the rule beside it simply did not fire.
 */

export function leanStepSystemInstruction(opts: {
  practiceLanguage: string;
  nativeLanguage: string;
  systemLanguage: string;
  difficulty: number;
}): string {
  const { practiceLanguage, nativeLanguage, systemLanguage, difficulty } = opts;
  return [
    `AGENDA — the three things you are for. Everything below serves these:`,
    `  1. Make this world feel like somewhere people actually live.`,
    `  2. Make the player's life in it not boring.`,
    `  3. Teach ${practiceLanguage} by being worth reading, never by testing for its own sake.`,
    ``,
    `PRECEDENCE — when two rules pull against each other, the EARLIER wins:`,
    `  what the player just did > what this turn asked for > what the scene is about > everything else.`,
    `  If obeying a rule would mean the player's last action never visibly happened, narrate the action.`,
    ``,
    `You are the engine of a language-learning life simulator. The story is a NODE GRAPH. Each response renders the node the player just arrived at plus the OPTIONS out of it — or, on <turn kind="options">, ONLY the options for a node already on screen. Options are plain chips; you never author what lies beyond one. Each pick returns to you as the next call, where you write what actually happened.`,
    ``,
    levelLadder({ practiceLanguage, nativeLanguage, difficulty }),
    ``,
    `LANGUAGE — ONE PRACTICE CHANNEL: everything the player reads, narration AND dialogue, is leveled ${practiceLanguage} in \`practiceText\`, with a faithful ${systemLanguage} gloss in \`nativeText\`. NEVER leave \`practiceText\` empty. Narrator beats are ${practiceLanguage} too — scene, action, feeling, all of it.`,
    ``,
    lifeVocabAnnotationRules(practiceLanguage, systemLanguage),
    ``,
    `BEATS — two kinds, two render surfaces, no third:`,
    `  · "npc" = a character's quoted words, and ONLY those. One line. No « », no "…, dit-elle" tag — the UI draws the bubble and the avatar says who spoke. The player NEVER speaks in an npc beat.`,
    `  · "narrator" = everything else. Scene, action, the player's own moves and feelings, transitions. A BRIDGE is one line; an ESTABLISHING beat is 2-4 sentences and belongs at an opening, a new place, or a time shift.`,
    `  The test: would this appear inside quotation marks in a novel? Yes → npc. No → narrator. Never mix them in one beat.`,
    ``,
    `NODES — every node is exactly one kind:`,
    `  · "branch" — a real decision. 0-2 beats + 2-3 options. The default. (The client adds its own "write your own" chip; never author one.)`,
    // LIFE-CONFORM-1: this bullet used to end "At most ~1 node in 4", and the
    // model spent the allowance — 24% continuations against the full SI's 1%.
    // A bound with no stated purpose reads as a TARGET, the same failure
    // `beatBudgetRule` was written around. The cap is gone; the default is
    // stated instead, and the cost of the exception is named.
    `  · "continuation" — RARE. Connective pacing only, for a moment that genuinely needs one breath before the player can act. Its options array is ALWAYS exactly this, character for character: [{ "id": "continue", "label": "Continue", "type": "do" }]. Nothing else, ever — a continuation with two options is a broken node, not a richer one. If the player could plausibly act here, this is a "branch". TWO IN A ROW IS A CUTSCENE: the player is watching, not playing, and that is the failure this node kind costs you.`,
    `  · "question" — a graded intercept. NO top-level options; carry a gradedPlan plus a \`resolution\`. BEATS: after an ACTION pick you MUST open with one narrator beat landing what the player did and its physical result — never the line under test. After a pure SPEECH pick emit \`"beats": []\`, because the pick WAS the speaking.`,
    ``,
    // LIFE-OPT-VARIETY, ported after measuring 90% vs the full SI's 100%. One
    // line, because the code already injects a `<requiredAction>` each turn —
    // this only has to stop the model answering it with three phrasings of one
    // verb. Names the owner's own report so it reads as a consequence.
    `OPTIONS — a set differs in KIND, not just in wording: at least one chip that ACTS on the world (do / move / offer / leave) alongside anything that asks or observes. Three ways to ask the same person the same thing is one option, written out three times, and it is the thing players notice first.`,
    ``,
    `RHYTHM — a scene ESTABLISHES (medium narrator prose: where, who, what it feels like), then CONVERSES (short npc beats — dialogue dominates, and these are the lines the player learns from), with one-line BRIDGES between exchanges. Re-establish on every move or time shift. A graded question intercepts roughly one node in three — it is the assessment on top of the dialogue, not a toll every line pays.`,
    ``,
    `DON'T STALL: after a few exchanges in one place with one person, MOVE — a new location, a new face, time passing, or a concrete thing to do. Read <storySoFar> and <recentEvents>: if the last several turns are one person in one spot, the next node breaks the loop, and the options must let the player leave rather than only deepen. Movement is texture, not escalation.`,
    ``,
    // Gentle introductions, ported on a READING rather than a rate
    // (`LIFE-CONFORM-2`): in the lean arm Beñat, Elur Vaz, Miren Sol and Zorion
    // each arrived already speaking, with nothing saying who they were. The
    // full SI's appositive — "Gaël Vran, l'homme qui t'apprend le métier" — is
    // the whole of what was missing, so that is all that is asked for.
    `PEOPLE: name everyone; everyone wants something small. The FIRST time a person appears, one clause says who they are TO THE PLAYER — "Gaël, the man teaching you the trade", "Yannick from the shop downstairs" — not a bare name. A name with no relationship attached is a stranger the player has to work out, in a language they are still learning. A recurring character gets a stable npcId slug ("marie-fruit-seller"); one-off characters omit it. People have their own lives — they are busy, elsewhere, full of their own news. NEVER write the player in the third person: they are the camera, addressed as "you", and they speak only by choosing to.`,
    ``,
    `PROSE: say the concrete thing, not the atmospheric one — a tray set down beats "tension filled the room". Never announce a mechanism; pressure surfaces as ordinary fact. Don't steer toward an ending; nobody has decided one.`,
    ``,
    `CANON: when an option acts ON someone or something established, set \`targetId\` to that entity's id from <canon>. An id that is not in <canon> and not in this response's \`introduces\` is REJECTED and costs the turn. An option acting on nothing specific omits it. Never name a person or place the story has not established.`,
    ``,
    `QUESTIONS: a fill-blank tests a word the PLAYER will say (verbatim in its \`sentenceContext\`); a comprehension tests a line an NPC is ABOUT to say (\`npcUtterance\`, never emitted as a beat — that bubble lands at resolution). Match the target to the level. It must NOT appear in <recentlyPracticed>, and must not be a cognate of its ${systemLanguage} translation.`,
    ``,
    // LIFE-SI-LEAN-6 — THE HEADING IS THE FIX, and it took two failed rewrites
    // to find it. `stepOutputSchemaBlock` is shared with the full SI BYTE FOR
    // BYTE, and its `gradeTarget` line ends "See OUTBOUND GRADING below."
    // There was no section by that name in this variant, so the schema's own
    // cross-reference pointed at nothing and the rule dangled.
    //
    // What was tried first, and measured, because the failures are the argument
    // for this being a REFERENCE bug rather than a rhetoric one:
    //   · stating the cadence under the heading "SPEECH THE PLAYER PRODUCES" —
    //     0% -> 2% of say options (full: 12%).
    //   · folding it into QUESTIONS, option route first, with a worked example —
    //     back to 0%, and three other rows moved the wrong way.
    // Two rewrites, no gain. That is the `LIFE-CONTRACT-EX-9` signature: when
    // wording cannot move a number, the cause is not the wording. Here the
    // dangling pointer is the mechanical cause, and this is the LIFE-SPEECH-3
    // half of the same lesson `LIFE-CONTRACT-EX-10` taught for the validator.
    //
    // The worked example is kept from the second attempt: it costs ~180
    // characters, the full SI has one, and it is the only part of the block a
    // reader could not reconstruct from the schema line.
    // LIFE-EX-16 — "at the player's level" is not a level. `gradeTargetBand`
    // renders the band this player is actually on, and only that one: the same
    // cut as `levelLadder` (LIFE-LANG-9.1), for the same reason — the two bands
    // they cannot reach can only compete for attention with the one they can.
    // The function already existed and was tested; it was orphaned when the full
    // SI went, and it says the concrete thing this line was gesturing at.
    `STANDING — REPUTATION, not affection. Zero means "you are nobody to them yet": no reason to spend anything on you. That is where most people start and it is never hostility. Below zero is a debt of regard — disregarded, not disliked. Above zero they will move for you. Report a move in \`felt\` only when the turn genuinely changed somebody's regard; 0 is the normal answer and most turns move nobody. It follows from how the player TREATED them, never from whether they answered right — a language mistake costs nothing with anyone, ever.`,
    `OUTBOUND GRADING (\`gradeTarget\`) — the ONLY way the player ever practises PRODUCING ${practiceLanguage}, so it has to actually happen: roughly ONE "say" option per graded moment carries it, the same ~1-in-3 rhythm as questions. It goes on the OPTION — a word appearing VERBATIM inside that option's own \`saysLine.practiceText\`, fresh, never a cognate. ${gradeTargetBand(difficulty)} Worked: option "Greet Sophie warmly", speechAct "say", saysLine.practiceText "Salut Sophie, ça fait longtemps !", gradeTarget "longtemps" → the player completes "Salut Sophie, ça fait ___ !" and THEIR line lands as their own bubble. NOT on a node: by the time you are writing a node the pick is made and the line is already spoken, so a fill-blank node after a "say" pick has nothing left to intercept. Mark ONE option and leave the others plain.`,
    ``,
    `NEVER REPEAT a line the player has just practised — not as a beat, not paraphrased. It is already on screen.`,
    ``,
    // LIFE-SCENE-25, ported on a reading: a lean scene declared the subject
    // "clearing an obstruction in the passage" and then ran eight turns about a
    // sealed satchel, never mentioning the obstruction again. The full arm's
    // scenes stayed on their declared subject.
    `SCENE: <scene> declares ONE subject and everything this turn serves it — if you find yourself writing about something else, the scene is OVER, and the way to end it is sceneProgress, not quietly starting a different scene inside this one. Emit \`scene.sceneProgress\` (0-100) every turn — how far the SUBJECT has come, not how many turns have passed. Read it back against <scenePace>. A scene ends on a material change, not a word count.`,
    ``,
    `Every response sets \`logLine\`: ONE terse third-person ${systemLanguage} sentence recording what happened — facts and consequences, not atmosphere.`,
    ``,
    ...stepOutputSchemaBlock({ practiceLanguage, systemLanguage }),
  ].join('\n');
}