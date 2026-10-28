/**
 * SRV-PROMPT-12 — THE `life_step` CRITIC: THE CLIENT SENDS *WHICH* CHECKS
 * FIRED; THE SERVER WRITES THE WORDS.
 *
 * `generateStepOptions` runs a two-attempt ladder whose second attempt is
 * steered by a `retryHint` built at FIVE sites, over the model's own response,
 * and then APPENDED to the prompt:
 *
 *     prompt: i === 0 || !retryHint ? prompt : `${prompt}\n\n${retryHint}`
 *
 * ⚠ THAT LINE IS WHY THIS CONVERSION IS FORCED RATHER THAN OPTIONAL. Once the
 * server builds the prompt, the client has nothing to append TO — so either the
 * verdict crosses as structure, or the retry ladder crosses with the prompt.
 * Sending the RENDERED hint back up would re-open the proxy through the retry
 * path while attempt 1 looked migrated, which is SRV-PROMPT-12 in one sentence.
 *
 * ── THE FIVE SITES ARE FIVE FAMILIES, AND THE FAMILY IS DERIVED ─────────────
 *
 * Each site wraps its issues in its own framing sentence, and each site
 * `continue`s immediately — so a hint has always held issues from exactly ONE
 * site. The family is therefore DERIVED from the codes rather than sent beside
 * them, which is batch 7's `direction-kind-mismatch` shape: a `family` field
 * the codes contradict would be representable, and this way it is not.
 *
 *   | family      | site                                    | codes |
 *   |-------------|-----------------------------------------|-------|
 *   | `json`      | `safeParseJson` returned nothing        | 1     |
 *   | `schema`    | `ZRawNodeResponse.safeParse` failed     | 1     |
 *   | `shape`     | `applyRequestShape` (LIFE-NODE-2)       | 7     |
 *   | `grid`      | `gradeOptionSet` (LIFE-GRID-6)          | 1     |
 *   | `crossTurn` | `validateNodeResponse` (LIFE-CANON-2, LIFE-CONTRACT-EX-6/7) | 3 |
 *
 * ── WHAT DOES NOT TRAVEL ────────────────────────────────────────────────────
 *
 * Every sentence below is DERIVED from its code plus at most two narrow
 * parameters. Nothing restates something the server already holds, and nothing
 * carries prose. The three codes whose client sentence quoted a value carry
 * that value alone: an option id, a target id, a goal key, a count.
 *
 * ── SRV-PROMPT-10: UNKNOWN IS *DROPPED*, NOT REJECTED ───────────────────────
 *
 * ⚠ THIS IS THE ONE PLACE THIS FILE DISAGREES WITH BATCH 7, DELIBERATELY.
 * `lifeGradedViolations.ts` rejects an unknown code, and its reasoning is
 * sound there: a rejected `life_graded_question` DEMOTES to ordinary CYOA
 * options and the player keeps playing, so a 400 costs a quiz.
 *
 * A rejected `life_step` costs the TURN. `generateStepOptions` catches the 400,
 * returns `{kind:'error'}`, and the player gets "the story hit a snag" plus a
 * Continue chip whose only action is to repeat the identical call — a hard
 * loop. And the violations only exist on attempt 2, so the alternative to
 * rejecting is not "no hint at all": it is attempt 2 running UNHINTED, which is
 * byte-identical to attempt 1 and therefore known to be a call the endpoint
 * accepts. A weaker retry beats no turn.
 *
 * So an unrecognised code, a malformed parameter and a cross-family entry are
 * each DROPPED with a warn — the `resolveClientModel` shape — and a verdict
 * that drops to nothing renders no block at all. The warn going non-zero is how
 * a client that has outrun its functions deploy gets noticed.
 */
/**
 * ⚠ REUSED FROM BATCH 7 RATHER THAN RE-IMPLEMENTED. `schema-issue`'s `message`
 * is Zod's own text, Zod writes its length bounds with `<=` / `>=`, and
 * `ZRawNodeResponse` bounds three arrays (`options` 2-3, `beats` 0-2,
 * `introduces` max 4) — so the commonest schema failures on this call are
 * exactly the messages the mandatory escape mangles. `lifeGradedViolations.ts`
 * met the identical problem on the identical library text and answered it; a
 * second copy of that answer is a second thing to get wrong.
 */
import { spellComparisons } from "./lifeGradedViolations";


/** LIFE-NODE-16/19 — the response did not parse. Carries nothing: the client's
 *  sentence is fixed, and the raw sample it logs is for the debug buffer and
 *  has never reached the model. */
export type StepViolation =
  | { code: "invalid-json" }
  // ── schema (LIFE-NODE-8) ────────────────────────────────────────────────
  /** One `ZodIssue`, as `strict.error.issues.slice(0, 6)` yields it. */
  | { code: "schema-issue"; path: string; message: string }
  // ── request shape (LIFE-NODE-2) ─────────────────────────────────────────
  | { code: "live-turn-missing-node" }
  | { code: "question-carries-options"; count: number }
  | { code: "continuation-option-count"; count: number }
  | { code: "continuation-option-id"; optionId: string }
  | { code: "branch-option-count"; count: number }
  | { code: "options-repeat-action-type"; actionTypes: string[] }
  | { code: "options-none-active" }
  | { code: "option-ids-duplicated"; optionIds: string[] }
  // ── option grid (LIFE-GRID-6) ───────────────────────────────────────────
  | { code: "dangled-goal"; goal: string; takes: number }
  // ── cross-turn validator ────────────────────────────────────────────────
  | { code: "unknown-entity-ref"; optionId: string; targetId: string }
  | { code: "lead-in-leaks-tested-line" }
  | { code: "question-omits-lead-in" };

export type StepViolationCode = StepViolation["code"];

/** The parameters each code carries, and NOTHING else. Read by the validator
 *  in `serverPromptSpec.ts` and by the renderer below, so the two cannot
 *  disagree about what a code means. */
export const STEP_VIOLATION_PARAMS = {
  "invalid-json": [],
  "schema-issue": ["path", "message"],
  "live-turn-missing-node": [],
  "question-carries-options": ["count"],
  "continuation-option-count": ["count"],
  "continuation-option-id": ["optionId"],
  "branch-option-count": ["count"],
  "options-repeat-action-type": ["actionTypes"],
  "options-none-active": [],
  "option-ids-duplicated": ["optionIds"],
  "dangled-goal": ["goal", "takes"],
  "unknown-entity-ref": ["optionId", "targetId"],
  "lead-in-leaks-tested-line": [],
  "question-omits-lead-in": [],
} as const satisfies Record<StepViolationCode, readonly string[]>;

export type StepViolationFamily = "json" | "schema" | "shape" | "grid" | "crossTurn";

/** Which framing sentence a code belongs under. DERIVED, never sent. */
export const STEP_VIOLATION_FAMILY: Readonly<Record<StepViolationCode, StepViolationFamily>> = {
  "invalid-json": "json",
  "schema-issue": "schema",
  "live-turn-missing-node": "shape",
  "question-carries-options": "shape",
  "continuation-option-count": "shape",
  "continuation-option-id": "shape",
  "branch-option-count": "shape",
  "options-repeat-action-type": "shape",
  "options-none-active": "shape",
  "option-ids-duplicated": "shape",
  "dangled-goal": "grid",
  "unknown-entity-ref": "crossTurn",
  "lead-in-leaks-tested-line": "crossTurn",
  "question-omits-lead-in": "crossTurn",
};

/**
 * The cap, measured against the REAL producers rather than guessed
 * (SRV-PROMPT-15), and re-derived by `lifeStepViolations.test.ts` rather than
 * frozen in this comment:
 *
 *   · `schema`    — `strict.error.issues.slice(0, 6)`                      → 6
 *   · `shape`     — 1 count + 2 spread + 1 id issue                        → 4
 *   · `crossTurn` — 3 `unknown-entity-ref` (one per option) + 2 lead-in     → 5
 *   · `grid`      — one verdict                                            → 1
 *   · `json`      — one                                                    → 1
 *
 * ⚠ AND IT TRUNCATES RATHER THAN REJECTING, which is the opposite of the call
 * `MAX_GRADED_VIOLATIONS` makes one kind over. Same reason as the unknown code
 * above: SRV-PROMPT-15's argument for rejecting is that a 400 is *visible to
 * the caller and unreachable for an honest one*, and on this kind a 400 is not
 * merely visible — it is the hard loop of SRV-PROMPT-10. Six is the ceiling an
 * honest caller can reach, so a truncation at eight can only happen to a caller
 * that is broken or hostile, and a broken caller getting a shorter hint is
 * strictly better than a player getting no turn.
 */
export const MAX_STEP_VIOLATIONS = 8;

/** A quoted value inside the hint. Bounded for the same reason every other
 *  prompt field is (SRV-PROMPT-17): these are model text on the honest path and
 *  caller text on any other. */
export const STEP_VIOLATION_VALUE_MAX = 200;
/** A Zod path, which is a dotted field list and never long. */
export const STEP_VIOLATION_PATH_MAX = 120;
/** A Zod message. Library text on the honest path. */
export const STEP_VIOLATION_MESSAGE_MAX = 400;

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/** Slice THEN escape — never the reverse. Escaping expands (`&` → `&amp;`), so
 *  slicing afterwards can cut an entity in half and emit `&am`. */
const v = (s: string): string => esc(s.slice(0, STEP_VIOLATION_VALUE_MAX));

/**
 * One verdict, in the words the model reads.
 *
 * ⚠ THESE STRINGS ARE A PORT AND NOT AN EDIT. Every one is byte-identical to
 * the sentence `generateStepOptions.ts` / `validateStep.ts` / `optionGrid.ts` /
 * `stepSchema.ts` built before batch 8, proved by `stepGoldenParity.test.ts`
 * against a capture taken immediately before the client stopped rendering them.
 * Rewording one is a prompt change and needs `npm run test:prompts` evidence.
 */
export function renderStepViolation(violation: StepViolation): string {
  switch (violation.code) {
    // `json` and `grid` render no per-issue line: their frames ARE the whole
    // sentence (see `stepRetryFrame`). Returning '' here rather than a
    // placeholder keeps the frame the single owner of those two shapes.
    case "invalid-json":
      return "";
    case "dangled-goal":
      return "";
    case "schema-issue":
      return `  - ${esc(violation.path.slice(0, STEP_VIOLATION_PATH_MAX))}: ${esc(
        spellComparisons(violation.message).slice(0, STEP_VIOLATION_MESSAGE_MAX),
      )}`;
    case "live-turn-missing-node":
      return "  - live turns require a `node` to render";
    case "question-carries-options":
      return `  - question nodes carry NO options (got ${violation.count}) — the graded generator authors the chips`;
    case "continuation-option-count":
      return `  - continuation nodes carry exactly ONE option (got ${violation.count})`;
    case "continuation-option-id":
      return `  - the continuation option's id must be "continue" (got "${v(violation.optionId)}")`;
    case "branch-option-count":
      return `  - branch nodes carry 2-3 options (got ${violation.count})`;
    case "options-repeat-action-type":
      return (
        `  - every option in a set must be a DIFFERENT actionType (got ${violation.actionTypes.join(", ")}) — ` +
        "two ways to do the same kind of thing is one option written twice"
      );
    case "options-none-active":
      return (
        "  - no option lets the player act on the world — at least one must be do, move, offer or leave; " +
        "a set that only asks and observes is an interrogation"
      );
    case "option-ids-duplicated":
      return `  - option ids must be unique within a response (repeated: ${violation.optionIds
        .map((id) => v(id))
        .join(", ")})`;
    case "unknown-entity-ref":
      return `  - [unknown-entity-ref] option "${v(violation.optionId)}" targets "${v(
        violation.targetId,
      )}", which is not in <canon>. Either target an entity that already exists, describe what the player can perceive instead of naming it, or declare it in "introduces".`;
    case "lead-in-leaks-tested-line":
      return "  - [lead-in-leaks-tested-line] a lead-in beat says the very line this question tests, so the answer is already on screen. Lead-in beats narrate what the PLAYER DID and the world reacting to it — never the utterance being tested. The tested line lands when the question resolves.";
    case "question-omits-lead-in":
      return "  - [question-omits-lead-in] the player just DID something and this question node narrates none of it, so their action never happened on screen. Open the question node with ONE NARRATOR beat: what they did, and the PHYSICAL result — what moved, opened, spilled, went quiet. No spoken line from anybody: the character being tested has not spoken yet, and writing their line here deletes the question. Then the question intercepts.";
  }
}

/**
 * The whole verdict, framed as the site that produced it framed it.
 *
 * ⚠ THE `crossTurn` FRAME IS DOUBLE-WRAPPED, AND THAT IS A FAITHFUL PORT OF A
 * REAL DEFECT — NOT A TYPO HERE. `validateStep.renderRetryHint` returns a
 * string that ALREADY opens `<retryHint>`, and `generateStepOptions` wrapped
 * its return value again:
 *
 *     retryHint = `<retryHint>${renderRetryHint(blocking)}</retryHint>`;
 *
 * so every cross-turn retry the app has ever sent reached the model as
 * `<retryHint><retryHint>…</retryHint></retryHint>`. It is reproduced here
 * because this batch is a PORT: un-nesting the tag changes what the model
 * reads, which is a prompt edit, and a prompt edit needs `npm run test:prompts`
 * evidence rather than an engineer's judgement. `stepGoldenParity.test.ts`
 * PINS the nesting and says so, so the day it is fixed the fix is deliberate
 * and measured rather than a tidy-up nobody costed.
 */
export function stepRetryFrame(
  family: StepViolationFamily,
  violations: readonly StepViolation[],
): string {
  // ⚠ `json` AND `grid` IGNORE `lines` ENTIRELY — their frames ARE the whole
  // sentence, which is why `renderStepViolation` returns '' for both codes.
  // Worth stating because it makes those two families unusable as mutation
  // fixtures: a mixed-family list headed by `invalid-json` renders the same
  // bytes whether or not the cross-family drop happens. `lifeStepSpec.test.ts`
  // uses `schema` + `shape` for exactly that reason.
  const lines = violations
    .map(renderStepViolation)
    .filter((l) => l.length > 0)
    .join("\n");
  switch (family) {
    case "json":
      return "<retryHint>The previous response was not valid JSON. Re-emit valid JSON matching the schema exactly. No prose, no fences.</retryHint>";
    case "schema":
      return `<retryHint>The previous response failed schema validation:\n${lines}\nRemember: options are plain chips (no next, no noPreview); a question node carries ONLY a gradedPlan and NO options; live turns emit a node, options turns do NOT. Re-emit a valid JSON object matching the schema exactly. No prose, no fences.</retryHint>`;
    case "shape":
      return `<retryHint>The previous response had the wrong shape for this turn:\n${lines}\nRe-emit a valid JSON object. No prose, no fences.</retryHint>`;
    case "grid": {
      // LIFE-GRID-6 — one verdict, rendered as `${violation}. ${hint}`. The
      // hint half is fixed text and never travels.
      const g = violations.find((x) => x.code === "dangled-goal");
      if (!g || g.code !== "dangled-goal") return "";
      return `<retryHint>option "${v(g.goal)}" is a goal the player has already taken ${g.takes} times. They have tried this more than once and are still here, so the world has been refusing them. Either LET IT HAPPEN this turn, or have someone close it off for good — then offer three options about what follows. Do not offer it again unchanged.</retryHint>`;
    }
    case "crossTurn":
      // See the header note: the outer pair is the shipped defect, ported.
      return `<retryHint><retryHint>The previous response had cross-turn issues. Re-emit a valid response that fixes ALL of these:\n${lines}\nRespect the rest of the schema.</retryHint></retryHint>`;
  }
}

/**
 * The retry block as `buildLifeStepPrompt` appends it, or `''` for a verdict
 * that has nothing left in it.
 *
 * The family comes from the FIRST entry and entries from any other family are
 * dropped — the client's five sites each `continue`, so an honest verdict is
 * always one family, and mixing is neutralised rather than rejected for the
 * SRV-PROMPT-10 reason in the header.
 */
export function renderStepRetryHint(violations: readonly StepViolation[]): string {
  if (violations.length === 0) return "";
  const family = STEP_VIOLATION_FAMILY[violations[0]!.code];
  const sameFamily = violations.filter((x) => STEP_VIOLATION_FAMILY[x.code] === family);
  return stepRetryFrame(family, sameFamily);
}
