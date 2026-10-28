/**
 * LIFE-EX-GEN-* / LIFE-EX-DIR-* — the graded-question generator's system
 * instruction and user prompt.
 *
 * Spec: docs/specs/life-sim.md §10.45, docs/specs/practice-mode.md §6.8.
 *
 * A second focused Gemini call that takes a planner-stage `GradedPlan` (from
 * `life_step`) and authors the actual `practicePrompt` + chip set. It does NOT
 * write narrative.
 *
 * ── SRV-PROMPT-8..13 batch 7 ────────────────────────────────────────────────
 *
 * Moved here from `src/lib/life/prompts/gradedQuestion.ts`, which is DELETED
 * (SRV-PROMPT-3). Only the PROMPT half moved: `gradedDirection`,
 * `applyGradedDirection`, `gradedPlanIssues` and `directionViolations` are
 * ENGINE decisions the client acts on — it attributes the resulting bubble from
 * them — and live on in `src/lib/life/gradedDirection.ts`.
 *
 * ⚠ BATCH 7 BECAUSE IT IS THE FIRST CLIENT CRITIC (SRV-PROMPT-12). The retry
 * ladder feeds a verdict computed on the client, from the MODEL's own response,
 * back into attempt 2. Sending the rendered sentence would have re-opened the
 * proxy through the retry path while attempt 1 looked migrated, so the verdict
 * travels as a closed union of codes and the templates live in
 * `lifeGradedViolations.ts`. See that module's header for the escape posture.
 *
 * ── WHAT DOES *NOT* TRAVEL, AND WHY THAT IS A NARROWING ─────────────────────
 *
 * `nativeLanguage` is gone from the wire. `buildGradedQuestionPrompt` never
 * read it — the old `GradedQuestionPromptInput` declared `practiceLanguage` and
 * `nativeLanguage` and the builder touched neither — and the SI reads the
 * SYSTEM language, which the call site already resolves
 * (`scene.systemLanguage ?? nativeLanguage`). So `systemLanguage` and
 * `difficulty` travel RESOLVED, the same shape `life_saga` settled on, and a
 * field that reaches nothing is not left on the wire for someone to wire in.
 *
 * ⚠ THE SCENE IS NARROWED FOR THE SAME REASON. `GradedQuestionSceneContext`
 * carries six fields; only four are rendered here (`sagaTitle`,
 * `locationLabel`, `speakerName`, `recentBeats`). The other two —
 * `difficulty` and `systemLanguage` — feed the SI, and they travel as top-level
 * resolved scalars rather than twice.
 *
 * ── NO SCHEMA, NO CACHE SLOT ────────────────────────────────────────────────
 *
 * NO `responseSchema`, before this batch and after it (SRV-PROMPT-11's shape).
 * `runGradedQuestionGenerate` has only ever sent `responseMimeType:
 * 'application/json'`; the output contract is the JSON shape written into the
 * SI and `ZGeneratedQuestion` defends against the answer. Acquiring one on
 * migration would be a behaviour change rather than a port — LIFE-WORLD-SAGA-10
 * measured that a model under a schema drops non-required fields far more
 * readily, and half this prompt's rules are about OPTIONAL fields
 * (`whyWrong`, `lineVocab`, `completedNativeText`) that the critic then
 * requires.
 *
 * NO `cacheSlot`, read from the CODE rather than from spec prose:
 * `explicitSiCache.ts`'s `SERVER_OWNED_SI` holds `life_backdrop` and nothing
 * else (LIFE-BACKDROP-14's text is stale by LIFE-BACKDROP-22's rename and has
 * already misled one work brief). This SI interpolates the practice language,
 * the system language AND the difficulty, so it is not byte-constant across the
 * population — a slot would make every call a billed cache CREATE
 * (PRACTICE-CACHE-1), and the 1-7 difficulty multiplies the fragmentation by
 * seven on top of the language pair.
 *
 * ── SIZE (SRV-PROMPT-9) ─────────────────────────────────────────────────────
 *
 * Measured, see `__tests__/lifeGradedQuestion.test.ts`. The biggest payload the
 * APP can send assembles to 23,538 B, 35.9% of `MAX_PROMPT_BYTES`; a
 * deliberately harsher fixture reaches 38,339 B (58.5%).
 *
 * ⚠ THE SYSTEM INSTRUCTION IS 16,163 B OF THAT — 24.7% of the cap before a
 * caller sends anything, and identical on every call. This kind therefore
 * starts with a quarter of the budget spent, which is the highest fixed floor
 * of any batch so far, and it is why the violation cap matters: the retry's own
 * term is the only one that grows without a render limit in front of it.
 */

import {
  MAX_GRADED_VIOLATIONS,
  renderGradedViolations,
  type GradedViolation,
} from "./lifeGradedViolations";

/**
 * LIFE-EX-DIR-1 — WHO speaks the line this question intercepts, carried as the
 * plan whose `kind` already decided it.
 *
 * The client derives a `GradedDirection` from exactly this and attributes the
 * resolved bubble from it; the server re-derives the same bit to render
 * `<direction>`. One source, two readers — never two derivations.
 */
export type LifeGradedQuestionPlan =
  | { kind: "generation"; testTarget: string; sentenceContext: string }
  | {
      kind: "comprehension";
      npcUtterance: string;
      /** The named speaker, or absent/null when the scene has none. */
      speakerName?: string | null;
    };

/** Just enough scene to anchor distractors in the world's register without
 *  dragging in the full `life_step` context (LIFE-EX-GEN-7). */
export type GradedQuestionScene = {
  sagaTitle?: string;
  locationLabel?: string;
  /** An NPC present in the scene. Rendered as `<npcInScene>` and ONLY when the
   *  direction does not already name the speaker — see the builder. */
  speakerName?: string;
  recentBeats?: readonly string[];
};

export type GradedQuestionPromptInput = {
  plan: LifeGradedQuestionPlan;
  /** Fill-blank targets already tested this chapter. */
  recentTargets: readonly string[];
  scene?: GradedQuestionScene;
  /**
   * SRV-PROMPT-12 — the critic's verdict on the PREVIOUS attempt, as codes.
   * Empty or absent on attempt 1. The `<violationHint>` block is rendered from
   * these, here, so no caller-authored sentence reaches the model.
   */
  violations?: readonly GradedViolation[];
};

export function gradedQuestionSystemInstruction(opts: {
  practiceLanguage: string;
  /** LIFE-LANG-7/8: the reading language the instruction +
   *  comprehension interpretations are written in (usually the user's
   *  native language, hence the legacy `nativeText` field name; may
   *  differ when the app UI locale does). */
  systemLanguage: string;
  difficulty: number;
}): string {
  const { practiceLanguage, systemLanguage, difficulty } = opts;
  // LIFE-LANG-8: `nativeLanguage` in the body below is the SYSTEM
  // (reading) language — the field that renders as a chip's `nativeText`
  // — NOT necessarily the user's native tongue. Aliased so the borrowed
  // wording stays readable.
  const nativeLanguage = systemLanguage;
  return [
    `You are the QUESTION GENERATOR for a language-learning life simulator. The lifeStep planner gives you: WHAT to test (a phrase) + the SENTENCE CONTEXT where it appears (for fill-blank) or the verbatim NPC line (for comprehension), plus a tight scene snapshot. You author the practice-prompt header + 3-4 chips. You DO NOT write narrative.`,
    `Practice language: ${practiceLanguage}. System (reading) language: ${systemLanguage}.`,
    `DIFFICULTY — the player is at level ${difficulty}/7 (1 = absolute beginner, 7 = advanced). Match the tested target AND the distractors to the level, and when unsure err TOO EASY rather than too hard. Level 1-2: test ONE very-common word or a basic present-tense form (a greeting, être/avoir/aller, a concrete noun); make the distractors clearly and obviously different so a beginner can reason it out; every chip a short common word. Level 3-4: everyday grammar + vocabulary, distractors plausible but distinguishable. Level 5-7: nuanced grammar / less-common vocabulary, distractors subtly plausible on a real distinction. At level 1 an EASY question is the CORRECT outcome — it builds confidence; simple is the goal, not a failure.`,
    // LIFE-EX-14: the difficulty band above governs the TESTED TARGET and
    // the chips. This governs the LINE ITSELF — the NPC utterance a
    // comprehension question is built on, which from level 3 the player may
    // hear with no transcript at all (`chooseComprehensionVariant`). Owner,
    // 2026-08-06: *"Level 3 should be listen to whole sentence but not too
    // hard. 4-7 should be harder and more and more native style."*
    //
    // It has to be a property of the LINE because there is no playback lever:
    // TTS-STYLE-3 — the voices are prompt-steered and there is no rate
    // parameter, and speech pace is a user setting (TTS-SPEED-1) that this
    // call must not try to second-guess.
    `HOW THE LINE IS SAID (LIFE-EX-14) — this is about the npcUtterance / sentenceContext themselves, not the chips. The player may HEAR this line with no transcript, so its register is the difficulty. Level 1-2: fully-formed, unhurried, textbook-clean — no elision, no dropped particles, no slang; say it the way a patient teacher would. Level 3: one whole natural sentence, still articulated plainly — a native being clear with a learner, not simplified into a phrasebook. Level 4-5: how the character would ACTUALLY say it — contractions, the odd filler, the natural word order a native reaches for first rather than the tidy one. Level 6-7: unhedged native speech — elision, idiom, an interrupted or trailing construction where the moment calls for it. NEVER buy difficulty with obscurity: a long rare-word sentence is not more native than a short idiomatic one, and the register must always fit the CHARACTER — a dockhand and a magistrate do not converge as the level rises.`,
    ``,
    // LIFE-EX-DIR-2: the direction is the engine's decision, carried in on
    // every request. Stated in the SI (the cached, stable half) as a universal
    // rule, and instantiated per request by the <direction> block.
    `SPEAKER DIRECTION (decided by the engine — not yours to choose):`,
    `  • Every request opens with a <direction> block naming WHO speaks the line this question intercepts: speaker="player" (the player says it) or speaker="npc" (a named character says it). That was decided in code, from the player's own last action, before you were called. It is not a suggestion and you cannot change it.`,
    `  • Author the line in THAT voice. The attribution of the resulting bubble is ALREADY fixed: a line written in the other voice is still displayed under the wrong speaker — the player appearing to say a character's line, or a character appearing to say the player's. That is the single worst defect this generator can ship, because the story then contradicts itself.`,
    `  • NEVER author speakerName or npcId. The engine supplies both from the <direction> block and discards anything you write there.`,
    `  • If the material you were handed reads like the OTHER direction, do not quietly switch — the mismatch is a fault upstream and the runtime guard will reject you. Author what the <direction> block says, or nothing that pretends otherwise.`,
    ``,
    `READ THE SCENE FIRST. The <sceneContext> block tells you what world this is and where the player is. Distractors MUST fit that world. If the saga is "The Whispering Resistance" and the location is "Underground bunker", do NOT author "not enough money in the cash register" distractors. Match the register, the tone, the stakes. Generic templates feel broken to the player — they're halfway through battling alien drones, not buying baguettes.`,
    ``,
    `USER VIEW — what the learner sees on a graded turn:`,
    `  • A header card with a ${nativeLanguage} task cue ("Complete the sentence" for fill-blank, "What did they just say?" for comprehension).`,
    `  • For fill-blank: the ${practiceLanguage} sentence with the blank ("___"). NO ${nativeLanguage} scaffold is shown before they answer.`,
    `  • For comprehension: the NPC's verbatim ${practiceLanguage} line in quotes, plus your short ${nativeLanguage} question.`,
    `  • A grid of 3-4 chips, each showing exactly ONE language: fill-blank chips show only the ${practiceLanguage} token(s); comprehension chips show only the ${nativeLanguage} interpretation.`,
    `  • The learner taps one chip. The system marks it correct or wrong.`,
    ``,
    `LANGUAGE RULES (strict — no judgment calls; a runtime guard rejects violations and retries you once with the hint stapled here):`,
    `  • The instruction/question is ALWAYS ${nativeLanguage}; the tested content is ALWAYS ${practiceLanguage}. Never mix languages inside one field.`,
    `  • FILL-BLANK: practicePrompt.practiceText = the ${practiceLanguage} sentence with EXACTLY ONE "___". practicePrompt.completedNativeText = the full ${nativeLanguage} translation with the blank FILLED IN with the correct answer (e.g. "I would like a coffee", NOT "I ___ a coffee") — REQUIRED, non-empty, MUST NOT contain "___". It is shown to the learner ONLY after they answer, so they always see the full sentence's meaning. (Do NOT emit a with-blank native template — it is never shown.) Chips: practiceText = the bare missing ${practiceLanguage} token(s) ONLY; nativeText = "" on EVERY chip. The empty string is MANDATORY — any gloss telegraphs the answer.`,
    `  • COMPREHENSION: practicePrompt.npcUtterance = the verbatim ${practiceLanguage} line (copy from plan, do not paraphrase). practicePrompt.question = a short ${nativeLanguage} question naming the speaker ("What is Sophie saying?") — REQUIRED, never empty. practicePrompt.utteranceNativeText = a FAITHFUL, natural ${nativeLanguage} translation of the WHOLE npcUtterance (what the line literally means, first/second person as spoken — e.g. utterance "C'est seulement le vent, James. N'aie pas peur." → "It's only the wind, James. Don't be afraid.") — REQUIRED, non-empty. This is NOT the third-person chip interpretation and NOT a paraphrase; it is the direct translation, shown to the learner ONLY after they answer (revealing it before would give the answer away), so they always see exactly what was said. Chips: nativeText = a third-person ${nativeLanguage} interpretation, REQUIRED non-empty on EVERY chip and distinct across chips (it is the ONLY text the learner sees); practiceText = the matching ${practiceLanguage} near-paraphrase (kept for the record, never rendered — still required non-empty and distinct).`,
    ``,
    `UNIVERSAL RULES:`,
    `  1. Emit EXACTLY 3 or 4 chips. EXACTLY ONE chip has correctness: "correct". The rest have correctness: "wrong".`,
    `  2. Every chip has a non-empty practiceText. nativeText follows the LANGUAGE RULES above: "" on every fill-blank chip; non-empty on every comprehension chip.`,
    `  3. No two chips share the same practiceText (case-insensitive). Comprehension chips also never share the same nativeText.`,
    `  4. No chip has an emoji on fill-blank turns — emojis telegraph meaning.`,
    `  5. EXACTLY ONE correct answer — and you must SHOW your work for it, see DISAMBIGUATION below. "Either of these could be right" is the single most common defect in this generator; the rules below exist because reshaping "until it feels unambiguous" does not work.`,
    ``,
    `DISAMBIGUATION (fill-blank — MANDATORY, pick ONE strategy per question; the runtime guard rejects a question without one):`,
    `  Every distractor you write will be a real ${practiceLanguage} word that fits the slot grammatically. That is the point — and it is also the trap: [peux / veux / doit] all produce a perfectly good sentence, so NOTHING in the question tells the learner which meaning you wanted. Such a question has no correct answer. Choose how you rule the others out:`,
    `  (a) "context-anchor" — the SENTENCE carries enough information that only one option is coherent. "Le chat ___ sur le tapis pendant des heures." with [dort / mange / court / saute]: only sleeping fits "for hours on a rug". Prefer this — the learner reasons about meaning rather than looking up a translation.`,
    `  (b) "translation-anchor" — the completed sentence's ${nativeLanguage} translation is SHOWN to the learner above the template, and IS the discriminator. Use it whenever the options are interchangeable without it: modals (peux/veux/doit), near-synonyms, fixed expressions with several valid fillers ("Salut, à ___ !" — bientôt and demain are both real farewells), or any target where meaning alone separates the answers. With "I want a coffee" on screen, "veux" is the only option that says it.`,
    `  • LINE VOCAB (LIFE-EX-VOCAB-3) — BOTH kinds: set practicePrompt.lineVocab, a {surface form → ${nativeLanguage} gloss} map for THE LINE THAT WILL BECOME A BUBBLE. Fill-blank: the COMPLETED sentence, with the blank filled in — not the answer token on its own. Comprehension: the verbatim npcUtterance. SEGMENT the whole line into consecutive meaningful units and gloss every one, exactly as a beat is annotated: content words, fixed expressions and verb constructions as single entries; skip only bare function words, numbers, proper nouns and obvious cognates. Keys are the EXACT surface forms as written in that line. This is what makes the resolved bubble tappable — without it the most language-dense line of the turn is the one line the learner cannot look up. It does NOT leak the answer: it is attached to the resolved bubble and shown only after they answer. **FILL-BLANK, REQUIRED: one entry MUST cover the ANSWER token itself** — either as its own key or inside the chunk it belongs to (answer "tend" may live under "te tend"). That answer's chip carries an EMPTY nativeText by mandate, so this is the ONLY place its meaning is generated; omit it and the learner is told what the answer IS but never what it MEANS (LIFE-LANG-19).`,
    `  Set practicePrompt.disambiguation to "context-anchor" or "translation-anchor". On "translation-anchor" the learner SEES completedNativeText before answering, so it must be a natural translation that names the intended meaning without containing the ${practiceLanguage} answer itself. If the testTarget is a COGNATE (near-identical in ${nativeLanguage} — plan, documents, restaurant), translation-anchor is IMPOSSIBLE without leaking (the answer word inevitably appears in the shown ${nativeLanguage} sentence): use "context-anchor" with a sentence that alone rules the distractors out — and the planner should not have picked a cognate target in the first place.`,
    `  SELF-CHECK before you emit: reading ONLY what the learner sees (the instruction, the template, the translation if you chose (b), and the chips), can they pick the answer for a REASON rather than a guess? If not, switch strategy or change the distractors.`,
    `  Every WRONG chip carries \`whyWrong\`: one short ${nativeLanguage} clause saying why it is wrong IN THIS SENTENCE — "means tea, not coffee", "past tense, but the sentence is about now", "expresses obligation, not desire". If you cannot say why a chip is wrong, it is a second correct answer: replace it. (Several distractors MAY be wrong for the same reason — café → thé / eau / lait are all simply the wrong drink, and that is a good question.) The learner SEES this clause the moment they pick that chip (LIFE-EX-GEN-11), so write it as a clear, kind one-line explanation the learner will learn from — not a terse internal note.`,
    ``,
    `ANSWER-LEAK RULES (strict — same runtime guard):`,
    `  • Comprehension: no chip's practiceText OR nativeText may equal or be a substring of the npcUtterance. Verbatim echoes destroy the test.`,
    `  • Fill-blank: each chip's practiceText is JUST the missing word(s) — never the full sentence, never the template, never include words from the surrounding template.`,
    `      GOOD: "voudrais" / "veux" / "ai"  (1-2 tokens each)`,
    `      BAD:  "Je voudrais un café" / "Je continue vers le dépôt"  (full sentences — this is CYOA, not fill-blank)`,
    `      BAD:  "voudrais un café" / "Je voudrais"                   (includes template words)`,
    `  • Fill-blank: NO native gloss on the CHIPS — nativeText: "" on every chip, no exceptions. A per-chip gloss would label each option with its answer. (The sentence-level translation used by "translation-anchor" is different and allowed: it states the MEANING the learner must express, and gives away no single chip.)`,
    ``,
    `CHIP-SHAPE RULES:`,
    `  • FILL-BLANK distractors match the TARGET + the LEVEL — do NOT make every question a conjugation drill (the #1 complaint):`,
    `      - VOCABULARY target (a noun / adjective / common word — the NORM at levels 1-4): distractors are DIFFERENT words of the same class that could grammatically fill the blank but are the WRONG meaning for the sentence. Target "café" → "thé" / "eau" / "lait"; target "content" → "triste" / "fatigué" / "fâché". This tests "which word fits" — the natural beginner skill. NEVER force a beginner to discriminate three near-identical verb endings.`,
    `      - VERB-FORM target (a conjugation the player is drilling — reserve for HIGHER levels, LIFE-EX-PLAN-2): distractors are inflectional variants of the SAME lemma. Target "voudrais" (vouloir) → "veux" / "voulais" / "voudrai".`,
    `      - EITHER WAY every distractor is a grammatically-plausible fill for the blank (so it stays fill-blank, not CYOA) yet semantically or contextually WRONG, and no chip is a substring of the template. VARY the distractor TYPE across questions — a run of identical "pick the right ending" questions is the failure mode.`,
    `  • COMPREHENSION also carries \`whyWrong\` on every wrong chip (LIFE-EX-GEN-10): one short ${nativeLanguage} clause naming what IN THE UTTERANCE rules that reading out — "she asked about the ferry, not the weather", "that is what HE said, not her". Interpretations are fuzzier than tokens, so two plausible readings of one line are the standard failure here; if you cannot rule a reading out from the line itself, it is a second correct answer, so replace it. The learner SEES it on picking the chip (LIFE-EX-GEN-11) — write it to teach.`,
    `  • COMPREHENSION chips are third-person INTERPRETATIONS in ${nativeLanguage}. "She's asking how your week was", "He's offering a coffee", "Sophie is suggesting we meet later." NEVER first-person responses ("Yes, I'm fine") — those are RESPONSES, not interpretations. AND they must fit the scene: a comprehension chip in a sci-fi resistance saga shouldn't read like a café small-talk option.`,
    ``,
    `OUTPUT SHAPE — emit ONLY this JSON object (no prose, no markdown fences):`,
    `{`,
    `  "practicePrompt": {`,
    `    "kind": "fill-blank" | "comprehension",`,
    `    // For fill-blank:`,
    `    "practiceText": "Je ___ un café",                        // sentence with EXACTLY ONE "___"`,
    `    "completedNativeText": "I would like a coffee",          // native translation with the blank FILLED — REQUIRED, no "___" (no with-blank native template — never shown)`,
    `    "lineVocab": { "voudrais": "would like", "un café": "a coffee" }, // LIFE-EX-VOCAB-3: the COMPLETED sentence segmented + glossed`,
    `    "disambiguation": "context-anchor" | "translation-anchor", // REQUIRED on fill-blank — how exactly one chip is right. "translation-anchor" SHOWS completedNativeText to the learner before they answer.`,
    `    // For comprehension:`,
    `    "npcUtterance": "<verbatim from plan>",                  // copy from plan, do not paraphrase`,
    `    "question":     "What is Sophie saying?",                // short native question — REQUIRED`,
    `    "utteranceNativeText": "It's only the wind, James. Don't be afraid." // faithful native translation of the WHOLE line — REQUIRED, shown only after answering. NO speakerName / npcId: the engine sets them from <direction> (LIFE-EX-DIR-2).`,
    `  },`,
    `  "choices": [`,
    `    // fill-blank example — nativeText is ALWAYS "":`,
    `    { "id": "c1", "practiceText": "voudrais", "nativeText": "", "correctness": "correct" },`,
    `    { "id": "c2", "practiceText": "veux",     "nativeText": "", "correctness": "wrong", "whyWrong": "plain 'want' — too blunt for ordering politely" },`,
    `    { "id": "c3", "practiceText": "ai",       "nativeText": "", "correctness": "wrong", "whyWrong": "means 'have', not 'would like'" }`,
    `    // comprehension example — nativeText carries the interpretation, practiceText the hidden near-paraphrase:`,
    `    // { "id": "c1", "practiceText": "Elle propose un café", "nativeText": "She's offering a coffee", "correctness": "correct" }`,
    `  ]`,
    `}`,
  ].join("\n\n");
}

export function buildGradedQuestionPrompt(input: GradedQuestionPromptInput): string {
  const sections: string[] = [];
  const plan = input.plan;

  // LIFE-EX-DIR-2: FIRST, because it frames everything below it. Rendered from
  // the PLAN's own kind — computed, never re-typed — so the prompt cannot state
  // a direction the engine did not decide.
  const speaker: "player" | "npc" = plan.kind === "generation" ? "player" : "npc";
  sections.push(directionBlock(plan));

  // LIFE-EX-GEN-7: scene context anchors distractors in the world.
  // Without it the generator authors generic café / shop / market
  // distractors regardless of whether the world is a noir mystery
  // or a sci-fi resistance saga.
  const scene = input.scene;
  if (scene) {
    const backdropSections: string[] = [];
    if (scene.sagaTitle) {
      backdropSections.push(`<saga>${escapeText(scene.sagaTitle)}</saga>`);
    }
    if (scene.locationLabel) {
      backdropSections.push(`<location>${escapeText(scene.locationLabel)}</location>`);
    }
    // LIFE-EX-DIR-2: a bare `<speaker>` here READ as "this is who is speaking"
    // while it only ever meant "this NPC is in the scene" — precisely the
    // ambiguity the direction block exists to remove. When the direction
    // already names the speaker it would duplicate it; otherwise it is
    // re-tagged so it cannot be mistaken for an attribution.
    if (scene.speakerName && speaker === "player") {
      backdropSections.push(`<npcInScene>${escapeText(scene.speakerName)}</npcInScene>`);
    }
    if (scene.recentBeats && scene.recentBeats.length > 0) {
      const beats = scene.recentBeats.map((b) => `  <beat>${escapeText(b)}</beat>`).join("\n");
      backdropSections.push(`<recentBeats>\n${beats}\n</recentBeats>`);
    }
    if (backdropSections.length > 0) {
      sections.push(`<sceneContext>\n${backdropSections.join("\n")}\n</sceneContext>`);
    }
  }

  sections.push(`<plan kind="${plan.kind}">`);
  if (plan.kind === "generation") {
    sections.push(
      `<testTarget>${escapeText(plan.testTarget)}</testTarget>`,
      `<sentenceContext>${escapeText(plan.sentenceContext)}</sentenceContext>`,
    );
    sections.push(
      `Author a fill-blank question. The sentenceContext is the line the PLAYER is about to say (see <direction>) — keep it in their voice. Replace the testTarget in sentenceContext with "___" for the practice template. The "correct" chip is the testTarget itself; the wrong chips are sibling phrases the learner might confuse it with (different inflection, different fixed expression, different preposition — whatever's pedagogically meaningful).`,
    );
  } else {
    // The speaker is NOT restated here: <direction> is the single place this
    // prompt names who is talking (LIFE-EX-DIR-2).
    sections.push(`<npcUtterance>${escapeText(plan.npcUtterance)}</npcUtterance>`);
    sections.push(
      `Author a comprehension question. The npcUtterance is the line the character named in <direction> is about to say. The "correct" chip's interpretation matches it; the wrong chips are plausible-but-wrong interpretations that fit the scene.`,
    );
  }
  sections.push(`</plan>`);

  if (input.recentTargets.length > 0) {
    const rendered = input.recentTargets.map((t) => `<target>${escapeText(t)}</target>`).join("");
    sections.push(
      `<recentlyPracticed>${rendered}</recentlyPracticed>`,
      `Avoid using any token in <recentlyPracticed> as a distractor — the learner has just seen these.`,
    );
  }

  // SRV-PROMPT-12 — the retry hint, rendered HERE from codes. An empty array
  // renders nothing, exactly as the old falsy-string check did: attempt 1 and a
  // clean verdict are the same prompt.
  const violations = input.violations ?? [];
  if (violations.length > 0) {
    const hint = renderGradedViolations(violations.slice(0, MAX_GRADED_VIOLATIONS), plan);
    sections.push(
      `<violationHint>The previous attempt was rejected. Fix these issues and re-emit:\n${hint}</violationHint>`,
    );
  }

  sections.push(`Author the question now. Emit ONLY the JSON object.`);
  return sections.join("\n\n");
}

/** LIFE-EX-DIR-2: the direction, rendered for the model. Built from the PLAN,
 *  so the sentence the model reads and the attribution the engine will apply
 *  are the same decision — there is no second place for the two to be written
 *  independently and drift apart. */
function directionBlock(plan: LifeGradedQuestionPlan): string {
  if (plan.kind === "generation") {
    return [
      `<direction speaker="player">`,
      `The line this question intercepts is spoken BY THE PLAYER, in their own first-person voice, to whoever is with them. The moment they answer, the COMPLETED sentence is rendered verbatim inside the PLAYER'S OWN speech bubble and attributed to them.`,
      `So: first person, the player's own words, no quotation marks, no "…, she said" clause, never a line a character would say to them, and never a sentence describing the player from outside.`,
      `</direction>`,
    ].join("\n");
  }
  // `nonBlank` on purpose, and it is the SAME normalisation `gradedDirection`
  // applies on the client: a whitespace-only `speakerName` is NO name, not a
  // name made of spaces. Keeping the two in step is what stops the prompt
  // naming a speaker the engine will attribute as `null`.
  const who = nonBlank(plan.speakerName);
  const label = who ?? "the character speaking";
  return [
    who ? `<direction speaker="npc" name="${escapeAttr(who)}">` : `<direction speaker="npc">`,
    `The line this question intercepts is spoken BY ${escapeText(label)} — a character in the scene, in their own voice, addressed to the player. The moment they answer, the verbatim utterance is rendered inside ${escapeText(who ? `${who}'s` : "that character's")} speech bubble and attributed to them.`,
    `Give the spoken words ONLY — no quotation marks, no attribution clause, and never the player's own words. Do NOT author speakerName or npcId: the engine already holds them and overwrites whatever you write.`,
    `</direction>`,
  ].join("\n");
}

function nonBlank(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
