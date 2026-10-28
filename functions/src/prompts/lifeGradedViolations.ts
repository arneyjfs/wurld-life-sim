/**
 * SRV-PROMPT-12 — THE CLIENT SENDS *WHICH* VIOLATIONS FIRED; THE SERVER WRITES
 * THE WORDS.
 *
 * `life_graded_question` runs a two-attempt ladder whose second attempt is
 * steered by a critic that runs on the CLIENT, over the model's own response
 * (`leakViolations` / `vocabViolations` / `directionViolations` in
 * `src/lib/life/runGradedQuestionGenerate.ts`). Before batch 7 that critic
 * rendered English sentences and the client posted them back up as
 * `violationHint`, which the prompt builder interpolated into a
 * `<violationHint>` block.
 *
 * That is the hole SRV-PROMPT-12 names: had the prompt migrated with the hint
 * still travelling as prose, attempt 1 would look migrated while attempt 2
 * carried an arbitrary caller-authored string straight into the model — the
 * proxy re-opened through the retry path. So the verdict travels as a CLOSED
 * DISCRIMINATED UNION on `code`, with narrowly-typed parameters, and every
 * message template lives here.
 *
 * ── THE THREE RULES THAT MAKE THAT WORTH ANYTHING ───────────────────────────
 *
 * 1. **An unknown `code` is a REJECT, not a dropped entry.** A silently skipped
 *    violation would make the retry weaker than the first attempt and nothing
 *    would say so; `invalid-spec` is a 400 the caller can see.
 * 2. **Every string parameter is sliced THEN escaped** (SRV-PROMPT-14). These
 *    land inside an XML block, and `quote` in particular is MODEL text on the
 *    honest path and ARBITRARY text on a hostile one. Slice-then-escape, never
 *    the reverse: escaping expands (`&` → `&amp;`), so slicing afterwards can
 *    cut an entity in half and emit `&am`.
 * 3. **No parameter carries something the server already holds.** The two
 *    templates that name the plan's `sentenceContext` / `testTarget` read them
 *    off the VALIDATED spec, not off the wire — a caller cannot restate the
 *    plan inside its own critique.
 *
 * ⚠ THE ESCAPE IS THE ONE DELIBERATE DIVERGENCE FROM THE CLIENT'S BYTES. The
 * old client interpolated the hint RAW — `<violationHint>` was the single
 * unescaped interpolation in `buildGradedQuestionPrompt`, where the plan, the
 * scene, the beats and the recent targets were all escaped. On a quote holding
 * `&`, `<` or `>` the server now emits an entity where the client emitted the
 * character. Parity therefore holds byte-for-byte on every captured shape
 * (`gradedQuestionGolden.json` has none) and diverges only on markup — which is
 * the point, because the raw form let a model (or a caller) close the block.
 */

/** LIFE-EX-GEN-3 / LIFE-EX-DIR-3 / LIFE-EX-VOCAB-4 — every verdict the client's
 *  critic can reach, and nothing else. One arm per `out.push` site. */
export type GradedViolation =
  // ── leak guard, COMPREHENSION arm ────────────────────────────────────────
  | { code: "comprehension-kind-mismatch" }
  | { code: "comprehension-missing-why-wrong" }
  | { code: "comprehension-utterance-narrated"; quote: string }
  | { code: "comprehension-question-empty" }
  | { code: "comprehension-utterance-native-missing" }
  | { code: "comprehension-chip-echoes-utterance"; chipIndex: number }
  | { code: "comprehension-chip-native-in-utterance"; chipIndex: number }
  | { code: "comprehension-chip-native-empty"; chipIndex: number }
  | {
      code: "comprehension-chips-share-native";
      chipIndex: number;
      otherChipIndex: number;
      quote: string;
    }
  // ── leak guard, FILL-BLANK arm ───────────────────────────────────────────
  | { code: "fill-blank-kind-mismatch" }
  | { code: "fill-blank-missing-blank-marker" }
  | { code: "fill-blank-completed-native-missing" }
  | { code: "fill-blank-completed-native-has-blank" }
  /** `quote` is the CHIP; the sentence comes from the validated plan. */
  | { code: "fill-blank-correct-chip-not-in-sentence"; quote: string }
  /** `quote` is the CHIP; the target comes from the validated plan. */
  | { code: "fill-blank-correct-chip-diverges"; quote: string }
  | { code: "fill-blank-chip-has-native-gloss"; chipIndex: number; quote: string }
  | { code: "fill-blank-chip-practice-empty"; chipIndex: number }
  | { code: "fill-blank-chip-contains-template-before"; chipIndex: number; quote: string }
  | { code: "fill-blank-chip-contains-template-after"; chipIndex: number; quote: string }
  | { code: "fill-blank-chip-too-long"; chipIndex: number; tokenCount: number }
  | {
      code: "fill-blank-chips-share-practice";
      chipIndex: number;
      otherChipIndex: number;
      quote: string;
    }
  | { code: "fill-blank-disambiguation-missing" }
  | { code: "fill-blank-missing-why-wrong" }
  | { code: "fill-blank-anchor-leaks-answer"; quote: string }
  // ── the vocab guard ──────────────────────────────────────────────────────
  | { code: "line-vocab-missing" }
  // ── the direction guard ──────────────────────────────────────────────────
  /** No parameter: the plan kind fixes the direction, the required prompt kind
   *  AND therefore the wrong one the model emitted. All three are derived. */
  | { code: "direction-kind-mismatch" }
  | { code: "direction-player-line-narrated"; quote: string }
  | { code: "direction-npc-line-narrated"; quote: string }
  // ── the parse seam ───────────────────────────────────────────────────────
  | { code: "schema-issue"; path: string; message: string }
  | { code: "invalid-json" };

export type GradedViolationCode = GradedViolation["code"];

/** The plan, as the renderer needs it. A subset of `LifeGradedQuestionPlan`. */
export type GradedViolationPlan =
  | { kind: "generation"; testTarget: string; sentenceContext: string }
  | { kind: "comprehension" };

/**
 * Which parameters each code carries — the ONE table the validator and the
 * renderer both read.
 *
 * A code whose entry disagrees with its union arm is a compile error at the
 * renderer (the switch destructures the arm), and a code missing from this
 * table is rejected on the wire. Two tables would be two things to keep in
 * step, which is the shape `SIMPLE_KINDS` already avoids one file over.
 */
export const GRADED_VIOLATION_PARAMS: Readonly<
  Record<GradedViolationCode, readonly ("chipIndex" | "otherChipIndex" | "quote" | "tokenCount" | "path" | "message")[]>
> = {
  "comprehension-kind-mismatch": [],
  "comprehension-missing-why-wrong": [],
  "comprehension-utterance-narrated": ["quote"],
  "comprehension-question-empty": [],
  "comprehension-utterance-native-missing": [],
  "comprehension-chip-echoes-utterance": ["chipIndex"],
  "comprehension-chip-native-in-utterance": ["chipIndex"],
  "comprehension-chip-native-empty": ["chipIndex"],
  "comprehension-chips-share-native": ["chipIndex", "otherChipIndex", "quote"],
  "fill-blank-kind-mismatch": [],
  "fill-blank-missing-blank-marker": [],
  "fill-blank-completed-native-missing": [],
  "fill-blank-completed-native-has-blank": [],
  "fill-blank-correct-chip-not-in-sentence": ["quote"],
  "fill-blank-correct-chip-diverges": ["quote"],
  "fill-blank-chip-has-native-gloss": ["chipIndex", "quote"],
  "fill-blank-chip-practice-empty": ["chipIndex"],
  "fill-blank-chip-contains-template-before": ["chipIndex", "quote"],
  "fill-blank-chip-contains-template-after": ["chipIndex", "quote"],
  "fill-blank-chip-too-long": ["chipIndex", "tokenCount"],
  "fill-blank-chips-share-practice": ["chipIndex", "otherChipIndex", "quote"],
  "fill-blank-disambiguation-missing": [],
  "fill-blank-missing-why-wrong": [],
  "fill-blank-anchor-leaks-answer": ["quote"],
  "line-vocab-missing": [],
  "direction-kind-mismatch": [],
  "direction-player-line-narrated": ["quote"],
  "direction-npc-line-narrated": ["quote"],
  "schema-issue": ["path", "message"],
  "invalid-json": [],
};

export const GRADED_VIOLATION_CODES: readonly GradedViolationCode[] = Object.keys(
  GRADED_VIOLATION_PARAMS,
) as GradedViolationCode[];

/**
 * The two codes that read the PLAN, and therefore only make sense on a
 * fill-blank one.
 *
 * `leakViolations`'s fill-blank arm runs only when `plan.kind === 'generation'`,
 * so an honest client can never pair these with a comprehension plan. Rejecting
 * the pairing makes "a critique that quotes a sentence the plan does not have"
 * unrepresentable rather than rendered as an empty quote — the `life_saga`
 * `universe` argument, one level down.
 */
export const GRADED_VIOLATION_NEEDS_FILL_BLANK_PLAN: ReadonlySet<GradedViolationCode> = new Set<
  GradedViolationCode
>(["fill-blank-correct-chip-not-in-sentence", "fill-blank-correct-chip-diverges"]);

/**
 * Length ceilings, applied BEFORE the escape.
 *
 * The client's own critic already slices the two narration quotes to 60; every
 * other quote it produced was UNBOUNDED (a chip's `nativeText`, a template
 * fragment). These are chosen above anything a well-behaved model emits — the
 * golden corpus's longest quote is well under `QUOTE_MAX` and a test asserts it
 * — so a legitimate retry is never truncated, and a hostile one cannot spend
 * the byte budget SRV-PROMPT-9 governs.
 */
export const VIOLATION_QUOTE_MAX = 240;
export const VIOLATION_MESSAGE_MAX = 300;
export const VIOLATION_PATH_MAX = 120;

/**
 * How many verdicts may travel at once.
 *
 * MEASURED, not guessed: `runGradedQuestionGenerate.test.ts` drives the real
 * client guards with a maximally-broken four-chip response — 23 on fill-blank,
 * 17 on comprehension — and asserts the count stays under this. Over it is a
 * REJECT rather than a truncation: an honest caller provably cannot reach it, so
 * anything that does is hostile or broken, and quietly dropping the tail would
 * weaken the retry with nothing saying so.
 *
 * ⚠ THE CAP IS A BYTE DECISION AS WELL AS A SHAPE ONE (SRV-PROMPT-9). Each
 * rendered violation costs ~457 B at the quote ceiling, so an UNCAPPED list
 * crosses `MAX_PROMPT_BYTES` at ~101 entries — four times what the critic can
 * produce, but reachable by anyone who can post a spec.
 */
export const MAX_GRADED_VIOLATIONS = 32;

/** `&<>` only — the TEXT-node escape the rest of this prompt uses. `"` stays
 *  raw because the templates themselves wrap quotes around every parameter. */
function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

const q = (s: string): string => esc(s.slice(0, VIOLATION_QUOTE_MAX));

/**
 * Spell out comparison operators in a `schema-issue` message, BEFORE the escape.
 *
 * ⚠ THE ESCAPE IS RIGHT AND ITS SIDE EFFECT WAS NOT. `message` is caller-
 * supplied text on the wire and has to be escaped like every other parameter.
 * But Zod writes its own length bounds with `<=` and `>=` — *"Too small:
 * expected array to have >=3 items"* — and `choices` is `.min(3).max(4)`, so
 * the two commonest schema failures on this call are exactly the two messages
 * the escape mangles. The model is being ASKED to fix an array length and was
 * reading `&gt;=3`.
 *
 * Spelling the operator REMOVES the character rather than encoding it, so the
 * escape has nothing left to do on the realistic path and the sentence reads as
 * English. It is a deliberate divergence from the client's bytes, pinned by the
 * golden parity test alongside the escape itself — not a quiet improvement.
 *
 * Substituting words is safe here because these are the only comparisons Zod
 * emits and they are always numeric bounds; a message carrying a literal `<`
 * for some other reason still gets escaped by the caller below.
 */
export function spellComparisons(s: string): string {
  // ⚠ THE TWO-CHARACTER BOUNDS ONLY. A bare `<` or `>` in a message is not a
  // Zod comparison — it is arbitrary text on the honest path and markup on a
  // hostile one, and both of those want ESCAPING, not translating. Spelling
  // them as well would rewrite `</violationHint><b>` into prose while looking
  // like a safety measure, and would mangle any message that happened to quote
  // a tag. Each pattern eats the whitespace after the operator and puts back
  // exactly one, so `>=3` reads `at least 3` rather than `at least3`.
  return s.replace(/<=\s*/g, "at most ").replace(/>=\s*/g, "at least ");
}

/**
 * One verdict, in the words the model reads.
 *
 * ⚠ THESE STRINGS ARE A PORT AND NOT AN EDIT. Every one is byte-identical to
 * the sentence `runGradedQuestionGenerate.ts` pushed before batch 7, proved by
 * `gradedQuestionGoldenParity.test.ts` against a capture taken immediately
 * before the client stopped rendering them. Rewording one is a prompt change
 * and needs `npm run test:prompts` evidence, not a tidy-up.
 */
export function renderGradedViolation(v: GradedViolation, plan: GradedViolationPlan): string {
  switch (v.code) {
    case "comprehension-kind-mismatch":
      return 'practicePrompt.kind must be "comprehension" — the plan kind is comprehension.';
    case "comprehension-missing-why-wrong":
      return "Every WRONG comprehension chip needs a short `whyWrong` naming what in the utterance rules it out (\"she asked about the ferry, not the weather\"). An interpretation you cannot rule out from the line itself is a second correct answer.";
    case "comprehension-utterance-narrated":
      return `practicePrompt.npcUtterance is written as narration ("${q(v.quote)}") — quotation marks plus an attribution clause. It is rendered as the speech bubble VERBATIM, so give the spoken words ONLY, with no quotes and no "…, she asks" tag. If the line is something the PLAYER says, this should not be a comprehension question at all.`;
    case "comprehension-question-empty":
      return 'practicePrompt.question is empty — comprehension requires a short native-language question ("What is Sophie saying?").';
    case "comprehension-utterance-native-missing":
      return "practicePrompt.utteranceNativeText is missing/empty — comprehension REQUIRES a faithful native translation of the whole npcUtterance (shown after the answer so the learner sees what was said).";
    case "comprehension-chip-echoes-utterance":
      return `Chip ${v.chipIndex} practiceText echoes the NPC utterance — gives the answer away. Reframe as a third-person interpretation ("She is asking…").`;
    case "comprehension-chip-native-in-utterance":
      return `Chip ${v.chipIndex} nativeText is a substring of the NPC utterance — leaks the answer.`;
    case "comprehension-chip-native-empty":
      return `Chip ${v.chipIndex} has empty nativeText — comprehension chips show ONLY the native interpretation; nativeText is REQUIRED on every chip.`;
    case "comprehension-chips-share-native":
      return `Chips ${v.chipIndex} and ${v.otherChipIndex} share the same nativeText ("${q(v.quote)}") — every comprehension chip needs a distinct interpretation.`;
    case "fill-blank-kind-mismatch":
      return 'practicePrompt.kind must be "fill-blank" — the plan kind is fill-blank.';
    case "fill-blank-missing-blank-marker":
      return 'practicePrompt.practiceText is missing the "___" blank marker.';
    case "fill-blank-completed-native-missing":
      return "practicePrompt.completedNativeText is missing/empty — fill-blank REQUIRES the full native translation with the blank FILLED IN (shown after the answer so the learner sees the sentence meaning).";
    case "fill-blank-completed-native-has-blank":
      return 'practicePrompt.completedNativeText still contains "___" — it must be the COMPLETED translation with the blank filled in (nativeText keeps the "___"; completedNativeText fills it).';
    case "fill-blank-correct-chip-not-in-sentence":
      return `The "correct" chip "${q(v.quote)}" does not appear in sentenceContext "${q(
        plan.kind === "generation" ? plan.sentenceContext : "",
      )}" — the blank has to be a word that is actually in the sentence.`;
    case "fill-blank-correct-chip-diverges":
      return `The "correct" chip "${q(v.quote)}" diverges from the plan's testTarget "${q(
        plan.kind === "generation" ? plan.testTarget : "",
      )}". Chip should be the testTarget or a tightly-related form of it.`;
    case "fill-blank-chip-has-native-gloss":
      return `Chip ${v.chipIndex} carries a native gloss ("${q(v.quote)}") — fill-blank chips must set nativeText: "" (one language per kind; a gloss telegraphs the answer).`;
    case "fill-blank-chip-practice-empty":
      return `Chip ${v.chipIndex} has empty practiceText.`;
    case "fill-blank-chip-contains-template-before":
      return `Chip ${v.chipIndex} contains the template's text BEFORE the blank ("${q(v.quote)}"). Chip should be just the missing word(s).`;
    case "fill-blank-chip-contains-template-after":
      return `Chip ${v.chipIndex} contains the template's text AFTER the blank ("${q(v.quote)}"). Chip should be just the missing word(s).`;
    case "fill-blank-chip-too-long":
      return `Chip ${v.chipIndex} is ${v.tokenCount} tokens — too long for fill-blank. Each chip should be 1-3 tokens.`;
    case "fill-blank-chips-share-practice":
      return `Chips ${v.chipIndex} and ${v.otherChipIndex} share the same practiceText ("${q(v.quote)}") — every fill-blank chip must be a DISTINCT option.`;
    case "fill-blank-disambiguation-missing":
      return 'practicePrompt.disambiguation is REQUIRED on fill-blank: "context-anchor" (the sentence itself rules the others out) or "translation-anchor" (the learner is shown completedNativeText, and the meaning rules them out). Pick the one that makes exactly ONE chip correct.';
    case "fill-blank-missing-why-wrong":
      return "Every WRONG chip needs a short `whyWrong` saying why it is wrong IN THIS SENTENCE. If you cannot state why a chip is wrong, it is a second correct answer — replace it.";
    case "fill-blank-anchor-leaks-answer":
      return `"translation-anchor" SHOWS completedNativeText to the learner, but it contains the answer "${q(v.quote)}" verbatim — the question would answer itself. Translate the whole sentence instead of leaving the target word untranslated inside it.`;
    case "line-vocab-missing":
      return "practicePrompt.lineVocab is REQUIRED on a comprehension question: the NPC utterance is the densest practice-language line of the turn and lands as a bubble the player must be able to tap. Supply a segment -> gloss map covering the utterance, same contract as a beat's wordTranslations.";
    case "direction-kind-mismatch": {
      // All three names are DERIVED from the plan: a generation plan is the
      // player's direction and wants a `generation` prompt, so the kind the
      // model actually emitted can only be the other one. Nothing travels.
      const wantKind = plan.kind === "generation" ? "generation" : "comprehension";
      const gotKind = plan.kind === "generation" ? "comprehension" : "generation";
      const speaker = plan.kind === "generation" ? "player" : "npc";
      return `practicePrompt.kind is "${gotKind}" but the engine decided <direction speaker="${speaker}">, which requires "${wantKind}". The direction was fixed before you were called — author the other kind.`;
    }
    case "direction-player-line-narrated":
      return `practicePrompt.practiceText ("${q(v.quote)}") is written as narrated, attributed speech — quotation marks plus a "…, she said" clause. The engine decided <direction speaker="player">: this template is the PLAYER's own words and is rendered verbatim inside their own bubble. Give the bare sentence with no quotes and no attribution. If the line really belongs to a character, this should not be a fill-blank at all.`;
    case "direction-npc-line-narrated":
      return `practicePrompt.npcUtterance ("${q(v.quote)}") is written as narration about speech rather than the spoken words. The engine decided <direction speaker="npc">: this line is rendered verbatim inside the character's bubble, so give the spoken words only — no quotes, no "…, she asks" tag.`;
    case "schema-issue":
      return `[${esc(v.path.slice(0, VIOLATION_PATH_MAX))}] ${esc(
        spellComparisons(v.message).slice(0, VIOLATION_MESSAGE_MAX),
      )}`;
    case "invalid-json":
      return "Output was not valid JSON. Emit the JSON object only — no prose, no fences.";
  }
}

/** The whole verdict, newline-joined in the order the critic pushed it — which
 *  is the order the client's array carries, so the server never re-sorts. */
export function renderGradedViolations(
  violations: readonly GradedViolation[],
  plan: GradedViolationPlan,
): string {
  return violations.map((v) => renderGradedViolation(v, plan)).join("\n");
}
