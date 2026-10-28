/**
 * Practice-generation prompt builders. Single source of truth for the
 * Gemini system instructions + user prompts that drive the planner-
 * plus-per-type-generator pipeline ported back from the source app
 * (see ADR-0001 — practice-gen-port-back-to-gemini).
 *
 * Architecture mirrors the unified-analysis Option B refactor: the
 * client (src/lib/practiceGenerator/) AND the offline Python prompt-
 * test harness in `tests/prompts/practice-*` both consume the strings
 * built here. The client imports the TS exports directly; the harness
 * reads dumps written by `scripts/build-prompts.mjs`.
 *
 * Per CLAUDE.md §"Testing": every edit here must be followed by
 * `npm run test:prompts` (ask user first for small prompt edits)
 * before deploying.
 *
 * The current Python harness strings were the byte-for-byte target
 * when these builders were written — keep them aligned so re-running
 * the existing 125-case suite continues to validate the live prompts.
 */

// ---------------------------------------------------------------------------
// Shared helpers — used by both planner + per-type generators.
// Mirrors `_shared/gemini_call.py` so dumped strings match.
// ---------------------------------------------------------------------------

const LEVEL_LABELS = [
  "",
  "Beginner",
  "Basic",
  "Improver",
  "Intermediate",
  "Conversational",
  "Comfortable",
  "Advanced",
];

export type PracticeQuestionType =
  | "multiple-choice"
  | "practice-to-native"
  | "native-to-practice"
  | "fill-the-blank"
  | "vocab-matching"
  | "listen-and-pick"
  | "listen-and-fill"
  | "listen-and-write"
  | "find-the-mistake";

export type PracticeFlashcardSpec = {
  phrase: string;
  translation: string;
  cardId?: string;
};

export type PracticeSlot = {
  cardId: string;
  type: PracticeQuestionType;
  prompt: string;
  flashcards: PracticeFlashcardSpec[];
  matchingPairs?: { left: string[]; right: string[] };
};

export function levelLabel(difficulty: number): { level: number; label: string } {
  const level = Math.max(1, Math.min(7, Math.round(difficulty)));
  return { level, label: LEVEL_LABELS[level]! };
}

export function levelLine(difficulty: number): string {
  const { level, label } = levelLabel(difficulty);
  return `Learner level: ${label} (${level}/7).`;
}

/** Mirrors `_shared/gemini_call.py::spec_block`. */
export function specBlock(
  spec: { prompt: string; flashcard: { phrase: string; translation: string } },
  practice: string,
  native: string,
): string {
  return (
    `SPEC FROM PLANNER:\n` +
    `  prompt:                ${spec.prompt}\n` +
    `  flashcard.phrase:      ${spec.flashcard.phrase}     (${practice})\n` +
    `  flashcard.translation: ${spec.flashcard.translation}  (${native})`
  );
}

/**
 * Universal generator SI prefix — role framing shared by every per-type
 * generator. Mirrors `_shared/gemini_call.py::generator_si_prefix`.
 */
export function generatorSiPrefix(
  practice: string,
  native: string,
  typeLabel: string,
): string {
  return `You write individual ${practice} ${typeLabel} practice questions for a ${native}-speaking learner. Each call produces ONE question from a planner spec.`;
}

/**
 * PRACTICE-GEN-SCENARIO-1: shared SCENARIO WEAVING block — included
 * by every per-slot generator SI so the planner's scenario anchor
 * (when present on slot.prompt) actually surfaces in the user-facing
 * question instead of staying internal-only. Mirrors
 * `src/lib/practiceGenerator/prompts.ts::scenarioWeavingRule`.
 */
export function scenarioWeavingRule(practice: string, native: string): string {
  return `SCENARIO WEAVING (read slot.prompt carefully):
slot.prompt arrives in one of two shapes — pick by the shape, don't fabricate:
  • WITH a scenario anchor: opens with a brief scene-setter ("At the café, the user wants to order a coffee —", "On a French trip, you're discussing how long the train takes —", "In a job interview, the candidate is asked about strengths —"). Then comes the test target.
  • WITHOUT an anchor: plain target only — "Test the verb 'commander'." No session-level scene.

When an anchor IS present, your USER-FACING question (instruction + practiceText + options) MUST sit inside that scene:
  • Build practiceText, when shown, as a SHORT natural ${practice} sentence the speaker would say IN that scenario, USING the target word/phrase. Bad: practiceText="tellement" (bare). Good: practiceText="Le trajet en train est tellement long !" (in the planning-a-trip scene).
  • Phrase ${native} instructions as if the learner IS in the scene. Bad: "Pick the French for 'why not'." Good: "Your friend just suggested Marseille — pick the French for 'why not?'"
  • When the question type forbids practiceText (e.g. options are ${practice}-language, so practiceText must be empty), put the scenario into the instruction instead.

When NO anchor is present you are STILL FREE — and usually well-served — to embed the target in a brief natural ${practice} sentence so the test has context. Single-word tests in isolation are often ambiguous (e.g. "tellement" can mean "so much" OR "so many" depending on what follows). The only thing you DO NOT do is invent a session-level theme the planner didn't pick:
  • Good (neutral context): practiceText="Il fait tellement chaud aujourd'hui." (uses tellement naturally, no theme imposed).
  • Bad (fabricated theme): practiceText="À l'aéroport, il fait tellement chaud." (an airport scene the planner didn't pick — would make this question feel incoherent against the other slots in the session).
  • Also fine: practiceText="ça vaut le détour" (a fixed idiom that's already self-contained — no sentence needed).

The scenario layer is pedagogical glue when the planner picked one. Without a planner-picked scenario, your job is just to make each question well-posed — neutral context sentences welcome, fabricated themes not.`;
}

/**
 * PRACTICE-SAVE-17 — every generator's explanation stays off vocabulary
 * lists: once answered, each word on screen shows its own translation and an
 * add-to-flashcards button, so the explanation is free for nuance.
 */
export function noVocabListRule(native: string): string {
  return `NO VOCABULARY LIST: the explanation must NOT translate the options one by one or list words with their meanings, and must NOT walk through the distractors naming what each one means. Once the learner answers, every word on screen already shows its own ${native} translation and an add-to-flashcards button. Spend the explanation on why the answer fits and on nuance — a tricky distractor, grammar, register, a false friend.`;
}

/**
 * PRACTICE-SAVE-16 — per-option glosses, shown beside each option after the
 * learner answers. Shared by the MC-family and fill-the-blank generators.
 */
export function optionGlossesRule(practice: string, native: string): string {
  return `OPTION GLOSSES (optionGlosses, keyed like options): when the options are in ${practice}, give each option's short ${native} meaning as used here (1-4 words, no quotes, no commentary). A wrong option gets ITS OWN meaning, never the target's. When the options are in ${native}, set every gloss to "" — do NOT translate ${native} options back into ${practice} (options "cat", "dog" → glosses "", ""). The learner only sees these after answering, next to each option.`;
}

// ---------------------------------------------------------------------------
// MC-family generator — multiple-choice, practice-to-native, native-to-practice,
// listen-and-pick. Mirrors `practice-generator-mc/run-tests.py`.
// ---------------------------------------------------------------------------

export type MCSlotType =
  | "multiple-choice"
  | "practice-to-native"
  | "native-to-practice"
  | "listen-and-pick";

export function mcTypeRules(
  qtype: MCSlotType,
  practice: string,
  native: string,
): string {
  if (qtype === "practice-to-native") {
    return (
      `- practiceText: REQUIRED — set to flashcard.phrase (the ${practice} text to translate).\n` +
      `- options: 4 FULL ${native} sentence translations (NOT single words). Exactly 1 is an accurate translation; 3 mistranslate the key word or phrase.\n` +
      `- instruction (in ${native}): brief task cue such as 'What does this mean?' — never contain ${practice}.`
    );
  }
  if (qtype === "native-to-practice") {
    return (
      `- practiceText: leave as empty string "" (not shown).\n` +
      `- options: 4 ${practice} words/phrases. Exactly 1 correctly renders the ${native} cue; 3 are plausible wrong choices from the same domain.\n` +
      `- instruction (in ${native}): include the ${native} cue the learner must translate.`
    );
  }
  if (qtype === "listen-and-pick") {
    return (
      `- practiceText: REQUIRED — set to flashcard.phrase (the UI hides it; only audio plays).\n` +
      `- options: 4 ${practice} words/phrases that sound similar to the target. Exactly 1 matches what was spoken.\n` +
      `- instruction (in ${native}): short cue like 'What did you hear?' — no ${practice}.`
    );
  }
  // multiple-choice — versatile
  return (
    `- options language — decide this FIRST, by asking which language the ANSWER is in: if the prompt gives a meaning in ${native} and asks for the ${practice} word ("Pick the ${practice} word meaning 'X'", "Which ${practice} word means 'X'?") → options in ${practice}, and the correct option is flashcard.phrase. If the prompt shows a ${practice} word and asks what it means ("What does 'X' mean?") → options in ${native}. If the prompt only names a ${practice} word to test ("Test understanding of 'X'") without asking for it, treat it as showing that word → options in ${native}. The word "meaning" in the prompt does not decide it on its own.\n` +
    `- practiceText: this is the LARGE focal text shown above the options. Two cases — pick by which language the options are in:\n` +
    `  • options in ${practice} (learner picks the ${practice} answer from a ${native} cue) → practiceText MUST be empty string "". Any ${practice} text above ${practice} options leaks the answer. The renderer auto-promotes your instruction to the focal slot — you do NOT lose visual prominence by leaving practiceText empty.\n` +
    `  • options in ${native} (learner picks the meaning of a fully-shown ${practice} phrase) → practiceText REQUIRED, set to the ${practice} phrase being translated.\n` +
    `- instruction (in ${native}): plain task cue; never contain ${practice}.`
  );
}

export function mcGeneratorSystemInstruction(
  practice: string,
  native: string,
): string {
  return `${generatorSiPrefix(practice, native, "MC-family")}

USER VIEW — what the learner sees on screen, top to bottom:
  Row 1 — instruction (${native}). Muted small text when practiceText is non-empty; PROMOTED to large bold when practiceText is empty.
  Row 2 — practiceText (${practice}). LARGE bold focal text — ONLY renders if you set it. If empty, this row is absent and Row 1's instruction takes the focal slot.
  Row 3 — the 4 options as a tappable list.
Key consequences (read carefully — common failure mode):
  • instruction and practiceText render TOGETHER when both are set. The system does NOT pick one of them. It is not an either/or.
  • An empty practiceText doesn't shrink the question — the instruction auto-promotes to the focal slot.
  • Leaving practiceText empty is the RIGHT choice whenever showing a ${practice} phrase above ${practice} options would reveal the answer.

UNIVERSAL RULES (apply to every question type):
- instruction is ${native} ONLY — NO ${practice} words. practiceText is ${practice} ONLY. Never mix inside a single field.
- practiceText should be SHORT — a brief, natural use of the target (5-8 words typical). Long padded sentences with extra clauses feel academic; prefer ordinary everyday phrasing.
- When options exist: 4 UNIQUE options, exactly 1 correct, distractors plausible but definitively wrong. correctKey names the option that answers the instruction — verify literal match.
- ANSWER-LEAK RULES (strict — a runtime guard drops slots that violate these):
  • The correct answer (and any close inflection or obvious translation of it) MUST NOT appear in the instruction.
  • If the options are in ${practice} (the learner is picking the ${practice} answer from a ${native} cue), the correct answer MUST NOT appear ANYWHERE in practiceText. Two leak shapes to watch for — both are dropped at runtime:
    1. practiceText IS the answer literally. Example: instruction "Select the French phrase for 'to be honest'.", practiceText "pour être honnête", options [pour être honnête, ...]. FIX: set practiceText="" (the renderer promotes the instruction to focal).
    2. practiceText CONTAINS the answer as a sub-phrase. Example: instruction "Select the French word for 'now'.", practiceText "Je dois partir maintenant.", options [maintenant, ...]. FIX: set practiceText="" OR rewrite practiceText to use a contrasting word that doesn't contain the answer.
  • If the options are in ${native} (the learner is picking the ${native} meaning of a fully-shown ${practice} phrase), the correct answer MAY appear in instruction context if needed, but distractors must not match.
- The PLANNER fields in the user prompt are INTERNAL BRIEFING ONLY — the user never sees them. Your question must be unambiguous from the USER VIEW above alone (instruction + practiceText + options).
- DISAMBIGUATION (apply ONLY when options are ${practice}-language AND practiceText is a sentence with a '___' blank or single-word target slot — pick ONE strategy):
  (a) TRANSLATION anchor — instruction includes the COMPLETED sentence's ${native} translation in quotes. Format: \`Pick the word so the sentence means "<${native} translation>".\` Use when the practiceText is short and the target is part of a fixed idiom with multiple valid fillers — without the translation, distractors like 'demain' in 'à ___' form equally-valid phrases.
  (b) CONTEXT anchor — instruction is a plain cue; practiceText carries enough surrounding context that only ONE option produces a coherent meaning. Use when the sentence itself can disambiguate — pedagogically richer because the learner reasons about meaning rather than translation lookup.
  NEVER ship a question of this shape without one of the two. Skip this whole rule when the user is just picking the meaning of a fully-shown phrase (practice-to-native, listen-and-pick — the practice text or audio already fixes the meaning).
- \`intent\` (one sentence): what this question tests — purely internal, not shown to user.
- instruction must NEVER say "highlighted phrase/word" or refer to highlighting. Instead, reference the target word directly, e.g. "What does 'ejemplo' mean in this sentence?"

${scenarioWeavingRule(practice, native)}

VOCAB HINT TAGS (where allowed by type rules):
Use <vocab t="${native} meaning">word</vocab> tags in practiceText to give the learner tappable translation hints on SURROUNDING context words — NOT on the word being tested. These are hints to help the learner understand the sentence so they can focus on the target concept. The difficulty level controls how many hints to provide — lower levels get more hints, higher levels get fewer or none. NEVER tag the target/tested word itself.
- Alternate translations: separate close equivalents with a forward slash (e.g. t="fast/quick"). Max 2-3 alternates.
- Literal gloss: natural meaning first, then literal gloss in parens with (lit: "...") marker. Example: t='stick around (lit: "to stay in the corner")'. Use when the literal meaning is interesting/non-obvious.

EXPLANATION (${native}, 1-2 sentences): explain why the correct answer is right and teach something useful or interesting. The first sentence should make clear why the correct answer fits. Then add whatever is most valuable for THIS specific question — a tricky distractor, an etymology, a false friend, an alternative phrasing, a register/cultural note. Skip the second sentence if the answer is obvious and nothing else adds value.
${noVocabListRule(native)}

${optionGlossesRule(practice, native)}

OUTPUT SCHEMA (enforced — return ONLY this JSON):
{
  "intent": "one-sentence internal reasoning anchor — what this question tests",
  "instruction": "${native} task cue (never refers to 'highlighted' anything)",
  "practiceText": "${practice} text rendered LARGE + BOLD above the options (5-8 words) — OR empty string when options are ${practice}-language (showing anything leaks the answer); the renderer auto-promotes instruction to focal in that case",
  "options": {"a": "...", "b": "...", "c": "...", "d": "..."},
  "correctKey": "a|b|c|d",
  "explanation": "${native} explanation (1-2 sentences)",
  "optionGlosses": {"a": "${native} meaning or """, "b": "...", "c": "...", "d": "..."}
}`;
}

export type MCGeneratorInput = {
  spec: { type: MCSlotType; prompt: string; flashcard: { phrase: string; translation: string } };
  practice: string;
  native: string;
  difficulty: number;
};

export function buildMcGeneratorUserPrompt(input: MCGeneratorInput): string {
  return `${levelLine(input.difficulty)}

QUESTION TYPE: ${input.spec.type}
${specBlock(input.spec, input.practice, input.native)}

TYPE RULES:
${mcTypeRules(input.spec.type, input.practice, input.native)}`;
}

export const MC_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING" },
    instruction: { type: "STRING" },
    practiceText: { type: "STRING" },
    options: {
      type: "OBJECT",
      properties: {
        a: { type: "STRING" },
        b: { type: "STRING" },
        c: { type: "STRING" },
        d: { type: "STRING" },
      },
      required: ["a", "b", "c", "d"],
    },
    correctKey: { type: "STRING", enum: ["a", "b", "c", "d"] },
    explanation: { type: "STRING" },
    // PRACTICE-SAVE-16
    optionGlosses: {
      type: "OBJECT",
      properties: {
        a: { type: "STRING" },
        b: { type: "STRING" },
        c: { type: "STRING" },
        d: { type: "STRING" },
      },
      required: ["a", "b", "c", "d"],
    },
  },
  required: [
    "intent",
    "instruction",
    "practiceText",
    "options",
    "correctKey",
    "explanation",
    "optionGlosses",
  ],
};

// ---------------------------------------------------------------------------
// fill-the-blank generator. Mirrors `practice-generator-fill-blank/run-tests.py`.
// ---------------------------------------------------------------------------

export function fillBlankGeneratorSystemInstruction(
  practice: string,
  native: string,
): string {
  return `${generatorSiPrefix(practice, native, "fill-the-blank")}

TYPE: fill-the-blank

RULES:
- practiceText: a short, natural ${practice} sentence with EXACTLY one '___' (three underscores) where the target word goes.
- Target word (the missing word) = flashcard.phrase. If flashcard.phrase is multi-word (e.g. a conjugated form), use the FULL phrase as the single blank.
- Surrounding words must be simpler than the target — the blank is the only challenge.
- options: 4 ${practice} words/phrases, all the same part of speech, all fit grammatically, but only ONE option can plausibly complete the sentence given the available information.
- DISAMBIGUATION (mandatory — pick ONE strategy per question):
  (a) TRANSLATION anchor — \`instruction\` includes the COMPLETED sentence's ${native} translation in quotes. Format: \`Complete to say: "<${native} translation>".\`. Use when the practiceText is short and the target is part of a fixed idiom with multiple valid fillers (e.g. \`Salut, à ___ !\` — bientôt vs. demain both work). The translation tells the user which idiom you intend.
  (b) CONTEXT anchor — \`instruction\` is a plain cue like 'Complete the sentence.' AND practiceText carries enough surrounding context that only ONE option produces a coherent meaning. Use when distractors are semantically distinct enough that the sentence itself disambiguates (e.g. \`Le chat ___ sur le tapis pendant des heures.\` with options [dort, mange, court, saute] — only ONE matches "for hours on a rug"). Pedagogically richer — the learner reasons about meaning, not just translation lookup.
- Pick (a) when distractors are common-collocation traps; pick (b) when the sentence can carry its own meaning. NEVER ship without one of the two.
- instruction (${native}): NO ${practice} inside. Either the cue alone (b) or the cue + quoted translation (a).
- correctKey ("a"|"b"|"c"|"d"): the option that IS flashcard.phrase.
- Do NOT include <vocab> tags.
- explanation (${native}, 1-3 sentences). ${noVocabListRule(native)}
- ${optionGlossesRule(practice, native)}

${scenarioWeavingRule(practice, native)}

THINKING STEPS — fill \`thinking\` array, 1 sentence each:
  step "interpret": identify target word and intended meaning.
  step "compose": draft the sentence with ___ in place of the target.
  step "distractors": name 3 same-POS ${practice} words that fit grammatically but not semantically.
  step "disambiguation": which strategy — (a) translation anchor or (b) context anchor? Why does this question favor that choice?
  step "self-check": exactly one ___? options unique? correctKey matches flashcard.phrase? Confirm: if a learner reads ONLY \`instruction + practiceText + options\`, can they pick the correct answer for a reason BEYOND guessing? If not, switch disambiguation strategy.

OUTPUT SCHEMA (enforced — return ONLY this JSON):
{
  "thinking": [{"step": "interpret", "reasoning": "..."}, ...],
  "instruction": "${native} task cue",
  "practiceText": "${practice} sentence with ___",
  "options": {"a": "...", "b": "...", "c": "...", "d": "..."},
  "correctKey": "a|b|c|d",
  "explanation": "${native} explanation (1-3 sentences)",
  "optionGlosses": {"a": "${native} meaning", "b": "...", "c": "...", "d": "..."}
}`;
}

export type FreeTextGeneratorInput = {
  spec: { type: PracticeQuestionType; prompt: string; flashcard: { phrase: string; translation: string } };
  practice: string;
  native: string;
  difficulty: number;
};

export function buildSimpleSpecUserPrompt(input: FreeTextGeneratorInput): string {
  return `${levelLine(input.difficulty)}

${specBlock(input.spec, input.practice, input.native)}`;
}

export const FILL_BLANK_RESPONSE_SCHEMA = MC_RESPONSE_SCHEMA;

// ---------------------------------------------------------------------------
// find-the-mistake generator. Mirrors `practice-generator-find-mistake/run-tests.py`.
// ---------------------------------------------------------------------------

export function findMistakeGeneratorSystemInstruction(
  practice: string,
  native: string,
): string {
  return `${generatorSiPrefix(practice, native, "find-the-mistake")}

TYPE: find-the-mistake
- User reads a ${practice} sentence containing EXACTLY ONE error.
- Words of the sentence become tappable options.
- User taps the wrong word.

RULES:
- practiceText: the ${practice} sentence CONTAINING the single mistake, space-separated tokens (no <vocab> tags). MUST have at least 5 tokens so 4 UNIQUE options can be drawn.
- mistakeIndex: integer index (0-based) of the wrong token in the space-split practiceText.
- correctedText: the same sentence with ONLY the mistake token replaced by the correct form. Everything else identical.
- options: 4 tokens drawn from practiceText. The mistake token must be among them. The other 3 are plausible but correct words from the same sentence.
- correctAnswer: the mistake token (matches options[correctKey]).
- correctKey: ("a"|"b"|"c"|"d") — key of the option that is the mistake.
- instruction (${native}): includes a ${native} translation hint of what the sentence is SUPPOSED to mean, so the learner has a target.
- explanation (${native}, 1-3 sentences): what was wrong + the correct form + why. ${noVocabListRule(native)}

${scenarioWeavingRule(practice, native)}

THINKING STEPS — fill \`thinking\`, 1 sentence each:
  step "interpret": identify the grammatical feature to break (conjugation, gender, case, preposition, etc).
  step "compose": write the correct sentence, then swap one token for a wrong form — note its index.
  step "distract": pick 3 other tokens from the sentence as option distractors.
  step "self-check": exactly one error? mistakeIndex points to it? correctedText fixes only that token? correctAnswer matches options[correctKey]?

OUTPUT SCHEMA (enforced):
{
  "thinking":      [{"step": "...", "reasoning": "..."}, ...],
  "instruction":   "${native} task cue with target meaning",
  "practiceText":  "${practice} sentence with one error",
  "options":       {"a": "...", "b": "...", "c": "...", "d": "..."},
  "correctKey":    "a|b|c|d",
  "correctAnswer": "the mistake token",
  "mistakeIndex":  0,
  "correctedText": "${practice} sentence fixed",
  "explanation":   "${native} explanation"
}`;
}

export const FIND_MISTAKE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    thinking: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          step: { type: "STRING" },
          reasoning: { type: "STRING" },
        },
        required: ["step", "reasoning"],
      },
    },
    instruction: { type: "STRING" },
    practiceText: { type: "STRING" },
    options: {
      type: "OBJECT",
      properties: {
        a: { type: "STRING" },
        b: { type: "STRING" },
        c: { type: "STRING" },
        d: { type: "STRING" },
      },
      required: ["a", "b", "c", "d"],
    },
    correctKey: { type: "STRING", enum: ["a", "b", "c", "d"] },
    correctAnswer: { type: "STRING" },
    mistakeIndex: { type: "NUMBER" },
    correctedText: { type: "STRING" },
    explanation: { type: "STRING" },
  },
  required: [
    "thinking",
    "instruction",
    "practiceText",
    "options",
    "correctKey",
    "correctAnswer",
    "mistakeIndex",
    "correctedText",
    "explanation",
  ],
};

// Listening-question generators live in `./practiceListenGenerators.ts`
// — kept out of this file to stay under the per-file LOC budget.
export {
  FREE_TEXT_RESPONSE_SCHEMA,
  listenFillGeneratorSystemInstruction,
  listenWriteGeneratorSystemInstruction,
} from "./practiceListenGenerators";

