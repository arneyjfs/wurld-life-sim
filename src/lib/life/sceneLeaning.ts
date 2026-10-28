/**
 * LIFE-INTENT-2 — the scene's open question, and the LEANING a pick can move.
 *
 * THE DIAGNOSIS THIS EXISTS TO ANSWER. `LIFE-INTENT-1` put the rule in prose:
 * what the player just did happened, and you may not write the next beat as
 * though it did not. It worked, and it stopped exactly halfway. Across 19
 * scenes of a four-world benchmark the judge said the same thing 19 times in
 * different words — *"the choices are acknowledged by the narrative, but the
 * scene progresses along a fixed path"* — and the mean sat at 1.3-1.5 of 4.
 *
 * The reason is structural, not rhetorical. A scene has a `subject`, and a
 * subject is a DESTINATION: every turn's job is to arrive at it. A pick can
 * colour the journey and never change where it goes, because there is nowhere
 * else to go. No amount of instruction fixes that, because the destination was
 * never the pick's to move.
 *
 * So the scene gets something that CAN move: an open question ("will Bruno give
 * up the machinery?") and a one-clause leaning saying where that question sits
 * right now. The step model rewrites the leaning every live turn.
 *
 * WHY THIS IS NOT `candidateEndings` COMING BACK. The obvious version of this
 * mechanism is a question plus 2-3 candidate answers a pick selects between,
 * and `LIFE-ARCH-3` bans that field BY NAME — measured as a monotonic funnel
 * that only ever narrowed, 3 → 2 → 1, until the scene was about nothing. An
 * enumerated answer set is that field wearing a new word, so it is not built
 * here. What LIFE-ARCH-3 names as the correct replacement is *"what people
 * want, what is in motion, what happens if nobody acts"* — and a leaning is
 * exactly "what is in motion": it describes the PRESENT, stores no outcome, and
 * cannot narrow because there is no set to remove from. Free text absorbs an
 * action the scene never anticipated for the same reason: there is no list to
 * be outside of.
 *
 * AND WHY THE STALL COUNTER IS THE ACTUAL MECHANISM. Asking the model to move
 * the leaning is, on its own, another rule it can satisfy by doing nothing —
 * the failure this codebase has now met a dozen times. A leaning may
 * legitimately repeat (an NPC walks in, the player observes), so repeating is
 * allowed but must be DECLARED, and consecutive declines are counted in code.
 * Doing nothing is what INCREMENTS the counter, which is the one shape the
 * do-nothing escape does not survive. It is deliberately the same shape as
 * `LIFE-EX-CADENCE-5`, the last thing here that worked.
 */

/** Consecutive declared non-moves before the prompt stops accepting them.
 *
 *  TWO, not one: a single quiet turn is ordinary — a scene that never lets
 *  anything sit is as unplayable as one that never moves. Two in a row is the
 *  point at which "the picks aren't changing anything" stops being a rhythm and
 *  starts being the on-rails failure the benchmark measured. */
export const LEANING_STALL_LIMIT = 2;

/**
 * LIFE-INTENT-3 — is this "leaning" actually a restated QUESTION?
 *
 * MEASURED on the first run where the mechanism was live: 48 of 134 leanings
 * were questions rather than positions — *"whether Jacinto successfully uses
 * the distraction"*, *"whether the Maestra believes Luz"* — and a DIFFERENT
 * question almost every turn. They carried 37% of all credited moves. The model
 * was not saying where the answer stood; it was replacing the question, which
 * is the exact inverse of the mechanism: a moving question with no answer,
 * instead of a fixed question whose answer moves. `leaningMoved` was trivially
 * true because the text really did differ every turn.
 *
 * THIS TESTS FORM, NOT MEANING, and the distinction is the whole reason it is
 * allowed to exist in code. Three earlier checks in this suite (OPT-LEAK,
 * CLICHE, and one more) tried to score narrative properties by substring, all
 * produced false positives, and all were moved to the judge — because they were
 * asking a lexical test to hold an opinion about meaning. "Does this clause
 * open as an interrogative" is not an opinion.
 *
 * DELIBERATELY NARROW: only a leading "whether"/"if", or a trailing question
 * mark. A position may legitimately open with "will", "has", "can" — *"will
 * refuse unless you pay first"* is a good answer and must keep counting.
 * Measured against the same 134 leanings, an over-broad detector including
 * those stems flags the IDENTICAL 48, so the narrow rule gives up no recall and
 * takes on no risk. "whether" INSIDE a clause ("he cannot decide whether to
 * agree") is not the clause being a question.
 */
export function isRestatedQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^(whether\b|if\b)/i.test(t) || t.endsWith('?');
}

export type LeaningState = {
  /** One clause on where the open question sits right now. */
  leaning: string;
  /** Consecutive turns the model has declared the leaning did not move. */
  stall: number;
};

/** What the step response says about the leaning this turn. Both fields are
 *  optional because a response predating this — or one that simply omits them —
 *  must still commit. */
export type LeaningSignal = {
  leaning?: string | null;
  leaningMoved?: boolean | null;
} | undefined;

/**
 * Fold a turn's signal into the stored leaning.
 *
 * SILENCE IS A DECLINE. A response that omits the fields has told us nothing
 * changed; treating that as a reset would make the counter unreachable by the
 * exact responses most likely to be coasting.
 *
 * A DECLINE MAY NOT ALSO EDIT. If the model says the pick changed nothing, it
 * does not then get to rewrite the state it just called unchanged — otherwise
 * the leaning drifts turn to turn while the counter reads zero, which is the
 * on-rails failure with a moving caption.
 */
export function nextLeaningState(current: LeaningState, signal: LeaningSignal): LeaningState {
  const proposed = signal?.leaning?.trim() ?? '';
  const moved =
    signal?.leaningMoved === true &&
    proposed.length > 0 &&
    // Re-emitting the same clause and calling it a move is the cheapest way to
    // satisfy the field without doing the work. It is not a move.
    proposed !== current.leaning.trim() &&
    // LIFE-INTENT-3: nor is replacing the question with a different question.
    // Treated exactly like doing nothing — it does not overwrite the stored
    // position and it INCREMENTS the stall, so the escalation still arrives.
    !isRestatedQuestion(proposed);
  return moved
    ? { leaning: proposed, stall: 0 }
    : { leaning: current.leaning, stall: current.stall + 1 };
}

/**
 * `renderSceneQuestion` and `SceneQuestionSource` LIVED HERE and MOVED to
 * `functions/src/prompts/lifeStepBlocks.ts` with SRV-PROMPT-8..13 batch 8. The
 * block is prompt text and `prompts/step.ts` was its only consumer.
 *
 * `nextLeaningState` / `isRestatedQuestion` / `LEANING_STALL_LIMIT` STAYED:
 * they FOLD the model's declared move into stored state, which is engine work
 * on the ANSWER. The stall count they maintain travels in the spec.
 */
