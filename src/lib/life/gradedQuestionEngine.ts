/**
 * LIFE-EX-DIR-* — the ENGINE half of the graded question: the decisions the
 * client makes and then ACTS on, as opposed to the prompt it used to write.
 *
 * Spec: docs/specs/life-sim.md §10.45 (LIFE-EX-GEN-*, LIFE-EX-DIR-*),
 *       docs/specs/practice-mode.md §6.8 (SRV-PROMPT-8..13 batch 7).
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * `src/lib/life/prompts/gradedQuestion.ts` held BOTH halves: the system
 * instruction and user prompt, and these four functions. Batch 7 moved the
 * prompt half to `functions/src/prompts/lifeGradedQuestion.ts` and DELETED the
 * module (SRV-PROMPT-3 — a retired client prompt module is deleted, not left
 * importable). What is here could not go with it, because none of it is a
 * prompt:
 *
 *   `gradedDirection`       decides WHO the resolved bubble is attributed to.
 *   `applyGradedDirection`  OVERWRITES the model's identity fields with it.
 *   `directionViolations`   is a CRITIC over the model's response.
 *   `gradedPlanIssues`      demotes a malformed plan BEFORE any call is made.
 *
 * The server renders `<direction>` from the same plan, so the sentence the
 * model reads and the attribution the engine applies remain ONE decision — but
 * it is the client that has to hold the value, because the client is what draws
 * the bubble.
 *
 * ── SRV-PROMPT-12: THE CRITIC NOW SPEAKS IN CODES ───────────────────────────
 *
 * `directionViolations` used to return English sentences, which
 * `runGradedQuestionGenerate` joined into a `violationHint` and posted back up
 * as prompt text. That is precisely the proxy SRV-PROMPT-12 exists to close, so
 * it returns `GradedViolation` values now and the server owns the wording. The
 * sentences are unchanged — byte-for-byte, proved by
 * `functions/src/__tests__/gradedQuestionGoldenParity.test.ts`.
 */
import type { GradedViolation } from '@/lib/practicePromptSpec';
import type { GradedPlan, PracticePrompt } from './stepSchema';
import { hasAttributionWrapper } from './utterance';

/**
 * LIFE-EX-DIR-1: WHO speaks the line a graded question intercepts.
 *
 * The direction was previously implied in three places and stated in none:
 * `gradedPlan.kind` implied it, `buildResolvedBubble` re-derived it from
 * `practicePrompt.kind`, and the generator was never told at all. This union is
 * that decision made once and given a type. The speaker's IDENTITY rides on the
 * `npc` arm, so "an NPC is speaking but nobody knows who" can only be an
 * explicit `null` — it is not expressible as a `player` direction that happens
 * to carry a name, which is the "attributed to both" state the beta report
 * named.
 */
export type GradedDirection =
  | { readonly speaker: 'player' }
  | {
      readonly speaker: 'npc';
      readonly speakerName: string | null;
      readonly npcId: string | null;
    };

const nonBlank = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
};

/**
 * LIFE-EX-DIR-1: the ONE derivation of the direction, total over the plan.
 *
 * `plan.kind` is the source because it is ALREADY the direction — `ZGradedPlan`
 * derives it from whose line the plan holds at the parse seam (LIFE-EX-18), so
 * by the time a plan reaches here `kind` and the fields cannot disagree. This
 * names that decision instead of adding a second one, so there is nothing for a
 * downstream reader to disagree with.
 *
 * (It used to be pinned to the picked option's `speechAct` by a repair. That was
 * the same single-source shape, off the wrong source: a `hear` pick on ambient
 * sound flipped the player's own line into an NPC's mouth.)
 *
 * ⚠ THE SERVER RE-DERIVES THE SAME BIT, from the same `plan.kind`, to render
 * `<direction>` — including the identical `nonBlank` on `speakerName`, so a
 * whitespace-only name is "no name" on both sides. That is one decision with
 * two readers, not two derivations: the plan travels, the direction does not.
 */
export function gradedDirection(plan: GradedPlan): GradedDirection {
  if (plan.kind === 'generation') return { speaker: 'player' };
  return {
    speaker: 'npc',
    speakerName: nonBlank(plan.speakerName),
    npcId: nonBlank(plan.npcId),
  };
}

/**
 * LIFE-EX-DIR-1: is this plan actually the shape its `kind` claims?
 *
 * Normally trivially true (zod parsed it). It is NOT guaranteed after the
 * LIFE-SPEECH-1 direction repair, which rewrites `gradedPlan.kind` by spreading
 * the OLD variant's body under the new discriminant — leaving e.g.
 * `{ kind: 'generation', npcUtterance }` with no `testTarget`. The spec builder
 * must not be the thing that discovers that; a caller checks here and demotes
 * (LIFE-EX-GEN-6) instead of hanging in `question-authoring`.
 *
 * ⚠ THESE STAY PROSE, and that is not an oversight. They never reach a model:
 * this check runs BEFORE the first call and its strings go only into the demote
 * reason and the debug buffer. SRV-PROMPT-12 is about text that travels to
 * Gemini, which is why `directionViolations` below had to change shape and this
 * did not.
 */
export function gradedPlanIssues(plan: GradedPlan): string[] {
  if (plan?.kind === 'generation') {
    const out: string[] = [];
    if (!nonBlank(plan.testTarget)) {
      out.push('fill-blank gradedPlan has no `testTarget` — there is nothing to blank out.');
    }
    if (!nonBlank(plan.sentenceContext)) {
      out.push('fill-blank gradedPlan has no `sentenceContext` — there is no sentence to test in.');
    }
    return out;
  }
  if (plan?.kind === 'comprehension') {
    return nonBlank(plan.npcUtterance)
      ? []
      : ['comprehension gradedPlan has no `npcUtterance` — there is no line to understand.'];
  }
  return ['gradedPlan is missing or carries an unrecognised `kind`.'];
}

/**
 * LIFE-EX-DIR-3, NORMALISE half: the speaker identity on a generated prompt is
 * the ENGINE's, always.
 *
 * The model used to be asked to copy `speakerName` / `npcId` "<from plan>" —
 * a prose instruction to restate a fact the client already holds, which it was
 * free to paraphrase, translate or invent, and which `PracticePromptCard` then
 * rendered beside a bubble the engine attributed from the plan. Two sources for
 * one fact. Overwriting is right rather than rejecting: the correct value is
 * known in code, so a retry could only reproduce it (same reasoning as
 * LIFE-SPEECH-1's repair-don't-retry).
 */
export function applyGradedDirection(
  direction: GradedDirection,
  prompt: PracticePrompt,
): PracticePrompt {
  // A kind/direction disagreement is a REJECT, not a normalisation
  // (`directionViolations`) — silently retyping the prompt would change what
  // the question tests.
  if (prompt.kind !== 'comprehension' || direction.speaker !== 'npc') return prompt;
  return { ...prompt, speakerName: direction.speakerName, npcId: direction.npcId };
}

/**
 * LIFE-EX-DIR-3, REJECT half: what normalisation cannot fix.
 *
 * Returns the codes for the leak-guard's retry hint; empty when the generated
 * prompt is in the direction the engine asked for. SRV-PROMPT-12: the SERVER
 * turns these into the sentences the model reads, so nothing this function
 * decides travels as prose.
 */
export function directionViolations(
  direction: GradedDirection,
  prompt: PracticePrompt,
): GradedViolation[] {
  const wantKind = direction.speaker === 'player' ? 'generation' : 'comprehension';
  if (prompt.kind !== wantKind) {
    // No parameters: the plan's kind fixes the direction, the required prompt
    // kind AND the wrong one the model emitted, so the server derives all three
    // from the plan it already validated. A `promptKind` field here would be a
    // second copy of a fact the wire already carries.
    return [{ code: 'direction-kind-mismatch' }];
  }
  // LIFE-CONTRACT-BUBBLE-4, applied to the OUTBOUND line too. The inbound check
  // has existed since the beta "the player's question inside the NPC's bubble"
  // report; the outbound template is the same failure mirrored, and it is the
  // one that lands in the player's own bubble.
  if (prompt.kind === 'generation' && hasAttributionWrapper(prompt.practiceText)) {
    return [{ code: 'direction-player-line-narrated', quote: prompt.practiceText.slice(0, 60) }];
  }
  if (prompt.kind === 'comprehension' && hasAttributionWrapper(prompt.npcUtterance)) {
    return [{ code: 'direction-npc-line-narrated', quote: prompt.npcUtterance.slice(0, 60) }];
  }
  return [];
}

/** Just enough scene to anchor distractors in the world's register
 *  without dragging in the full lifeStep context (LIFE-EX-GEN-7).
 *
 *  ⚠ FOUR OF THESE SIX FIELDS TRAVEL AND TWO DO NOT. `difficulty` and
 *  `systemLanguage` feed the SYSTEM INSTRUCTION, which the call site resolves
 *  (`?? nativeLanguage`, `?? 2`) before building the spec — so they cross the
 *  wire as top-level resolved scalars rather than twice, and the server never
 *  re-applies a fallback the client already applied (the `life_saga` seam's
 *  rule). The other four are rendered into `<sceneContext>`. */
export type GradedQuestionSceneContext = {
  /** Saga title (1 line). "The Whispering Resistance" tells the
   *  model NOT to author cash-register distractors. */
  sagaTitle?: string;
  /** Where the player is right now ("Underground bunker", "Forêt
   *  abandonnée"). Most important single fact. */
  locationLabel?: string;
  /** When the graded turn involves a specific NPC, their display
   *  name. Helps the model author chips that mention them naturally. */
  speakerName?: string;
  /** Last 2-3 narrative beats (newest last). Tight scene snapshot.
   *  Just the practice-language line — the model gets the gist from
   *  the surrounding fields. */
  recentBeats?: ReadonlyArray<string>;
  /** LIFE-CTX-3: the player's 1-7 level, carried from the world. The
   *  graded SI calibrates the tested target + distractor complexity to
   *  it — mirroring the storyline SI (never below the engaging lower
   *  limit). */
  difficulty?: number;
  /** LIFE-LANG-7/8: the SYSTEM language — the reading language the
   *  question instruction + comprehension interpretations are written
   *  in (the tested content stays practice language). Carried from the
   *  world (`world.systemLanguage ?? world.nativeLanguage`); absent ⇒
   *  the runner falls back to nativeLanguage. */
  systemLanguage?: string;
};
