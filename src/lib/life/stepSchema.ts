/**
 * LIFE-NODE-1/2: the structured shapes for the node/lookahead step
 * engine. Every life_step Gemini call returns a ZRawNodeResponse —
 * a node to render now (live turns) and/or the options leading out
 * of it, each option carrying a one-node-deep preview.
 *
 * Every narrator / NPC beat carries the FULL bilingual payload
 * (LIFE-STEP-4) so the bubble UI can flip view modes without a
 * follow-up call. Mirrors the dual-language single-call pattern
 * the tutor uses (TUTOR-INV-3).
 *
 * Spec: docs/specs/life-sim.md §10.46 (LIFE-NODE-*), §10.45
 * (LIFE-EX-PLAN-* — the gradedPlan shapes are unchanged).
 */
import { z } from 'zod';
import {
  ACTIVE_OPTION_TYPES,
  ZOptionType,
  ZTimeAdvance,
  type OptionType,
} from '@/types/lifeState';
import { normaliseLocationLabel } from './locationLabel';
import type { StepViolation } from '@/lib/practicePromptSpec';


/** The six, as a plain array — the preprocess below needs a membership test
 *  BEFORE Zod sees the value, so it cannot use the enum itself. */
const OPTION_TYPE_VALUES: readonly string[] = ZOptionType.options;

/** LIFE-EX-19 — the WIRE value the model writes for a generation exercise.
 *  Only the two parse seams (`ZGradedPlan`, `ZPracticePrompt`) and the SI
 *  blocks should ever mention it; everything else says `generation`. */
export const WIRE_GENERATION_KIND = 'fill-blank';

/** Backfill `complexWords` from `wordTranslations` keys when a response omits it.
 *
 *  HISTORY, because the rationale inverted. This began as LIFE-COST-5 (D1): the
 *  two fields were emitted together on every beat, chip and saysLine, and
 *  `complexWords` was invariably `Object.keys(wordTranslations)` — the same
 *  strings serialised twice for ~5% of `life_step` output and no information. So
 *  the SI stopped asking for it and this derived it at the parse seam.
 *
 *  `LIFE-LANG-18` then made `complexWords` load-bearing again (its `swapWords`
 *  list was a verbatim subset of it), so the SI asked for both arrays again.
 *  LIFE-LANG-18 has since been RETIRED; the SI still asks for `complexWords`.
 *
 *  This function survives as a FALLBACK, not an optimisation: a response that
 *  omits `complexWords` still yields tappable vocab instead of a bare bubble.
 *  It is a no-op whenever the model sends the array (the normal case), so it
 *  only fills a gap. Insertion order is the order
 *  the model wrote the glosses. */
function fillVocabAnnotations(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.complexWords)) return v;
  const wt = o.wordTranslations;
  if (!wt || typeof wt !== 'object' || Array.isArray(wt)) return v;
  const keys = Object.keys(wt as Record<string, unknown>);
  if (keys.length === 0) return v;
  return { ...o, complexWords: keys };
}

/** Mirror of `ZLifeBeatPayload` but tightened for what the LLM
 *  produces (e.g. user-speaker is never emitted by the model). */
const ZStepBeatBase = z.object({
  speaker: z.enum(['narrator', 'npc']),
  /** NPC display name. Required when speaker === 'npc'; ignored
   *  for narrator. Stable across turns for recurring NPCs. */
  speakerName: z.string().nullable().optional(),
  /** When speaker === 'npc' AND the model wants this NPC to persist,
   *  it provides a stable id slug ("marie-fruit-seller"). The
   *  orchestrator promotes the NPC to lifeNpcs on first sighting
   *  (LIFE-NPC-1). Transient NPCs omit this field. */
  npcId: z.string().nullable().optional(),
  practiceText: z.string(),
  nativeText: z.string(),
  /** Optional — words to highlight in the practice text for the
   *  vocab-tap UI. Mirrors MSG-VOCAB-*'s complexWords field. */
  complexWords: z.array(z.string()).optional(),
  /** Optional — per-word translations for the tap-to-define UI. */
  wordTranslations: z.record(z.string(), z.string()).optional(),
  // LIFE-LANG-18 (`swapWords`) is RETIRED. A stray key from a cached/old
  // response is stripped by zod's default unknown-key handling, not rejected.
});
export const ZStepBeat = z.preprocess(fillVocabAnnotations, ZStepBeatBase);
export type StepBeat = z.infer<typeof ZStepBeat>;

/** A choice the user can pick. Multi-choice exercises emit one
 *  choice per option with `correctness` set; CYOA beats omit
 *  `correctness` (every choice is valid). */
const ZStepChoiceBase = z.object({
  id: z.string(),
  practiceText: z.string(),
  nativeText: z.string(),
  /** Optional emoji rendered on the chip face. */
  emoji: z.string().nullable().optional(),
  /** LIFE-EX-1: present iff this is a graded multi-choice turn. */
  correctness: z.enum(['correct', 'wrong']).nullable().optional(),
  /** LIFE-BUBBLE-7 — optional vocab annotations for the chip's
   *  practiceText, same contract as ZStepBeat. Chips render PLAIN
   *  (tap = pick); the annotations activate when the chip's line
   *  lands as the player's bubble at practice resolution. */
  complexWords: z.array(z.string()).optional(),
  wordTranslations: z.record(z.string(), z.string()).optional(),
  /** LIFE-EX-GEN-9 + LIFE-EX-GEN-11: on a GRADED chip marked wrong, one short
   *  reason it is wrong HERE. It is BOTH a generator forcing-function (a
   *  distractor whose wrongness cannot be articulated is usually a second
   *  correct answer, so the client rejects a chip set whose reasons are
   *  missing) AND, since 2026-07, SHOWN to the learner in PracticeFeedback the
   *  moment they pick that chip — so write it as a kind, learner-facing
   *  system-language clause. Same forcing-function trick as practice mode's `thinking`
   *  self-check step, made structural instead of advisory. */
  whyWrong: z.string().optional(),
});
export const ZStepChoice = z.preprocess(fillVocabAnnotations, ZStepChoiceBase);
export type StepChoice = z.infer<typeof ZStepChoice>;

/** LIFE-STEP-6: when the next beat happens at a different location,
 *  the model emits a backdropIntent so the orchestrator can swap the
 *  scene. */
const ZBackdropIntentBase = z.object({
  /** Snake-cased location category (LIFE-BACKDROP-2). */
  locationType: z.string(),
  /** Vibe modifier — usually inherits the world's worldSeed-derived
   *  vibe, but the model can override (e.g. "the noir city" world
   *  visiting "a magical bookshop" overrides to "magical"). */
  vibe: z.string(),
  /** Persistent scenes go in the cache + lifeBackdrops. Transient
   *  scenes render fresh each visit (LIFE-NPC-1 mirror for
   *  scenes — see LIFE-BACKDROP-2/3). */
  persistent: z.boolean(),
  /** Display label for the location ribbon, e.g. "Le Vieux-Port". A PLACE,
   *  never a time — the clock is tracked separately (LIFE-TIME-1). */
  locationLabel: z.string(),
  /** LIFE-BACKDROP-26 — the same label in the system language, for the
   *  tap-to-reveal on the ribbon. Optional: a legacy world has none, and a
   *  world whose practice and system languages coincide needs none. */
  locationLabelNative: z.string().optional(),
  /** Free-form vibe details that the prompt may use but that are
   *  NOT part of the cache key (LIFE-BACKDROP-2). */
  flavour: z.string().optional(),
  /** When set, the orchestrator runs the transport loop with this
   *  mode before swapping scenes (LIFE-TRANS-1/2). Phase C wires
   *  the loop UI; B.2 stores it on the doc but renders a simple
   *  cross-fade. */
  transportMode: z
    .enum([
      'walk',
      'metro',
      'car',
      'bus',
      'train',
      'bike',
      'plane',
      'boat',
      'teleport',
      'magic-portal',
    ])
    .nullable()
    .optional(),
});

/**
 * LIFE-BACKDROP-27: both labels are NORMALISED before anything downstream sees
 * them. Two prompt rules already forbid a time suffix and a production label
 * still arrived as `Ton appartement · nuit`; the label is the backdrop cache
 * key, so a time baked into it regenerates the same place once per story hour
 * and then contradicts the light on screen.
 *
 * Here rather than in `commitNode` because this is the ONE seam every consumer
 * passes through — the world patch, the `backdrop_visited` event, the cache
 * key, the ribbon, and the graded prompt's `<location>` block. Same technique
 * and same reasoning as the `actionType` preprocess above: fix the value where
 * it costs nothing. See `locationLabel.ts` for what it does and does not cut.
 */
export const ZBackdropIntent = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const fix = (k: 'locationLabel' | 'locationLabelNative') =>
    typeof o[k] === 'string' ? { [k]: normaliseLocationLabel(o[k]) } : {};
  return { ...o, ...fix('locationLabel'), ...fix('locationLabelNative') };
}, ZBackdropIntentBase);
export type BackdropIntent = z.infer<typeof ZBackdropIntent>;
/** The unwrapped object, for callers that need `.shape` — a `z.preprocess`
 *  wrapper has none. `step.test.ts` walks it to assert every accepted field is
 *  also named in the prompt's OUTPUT CONTRACT, which is the check that caught
 *  LIFE-BACKDROP-26 shipping as a schema field the model was never asked for. */
export const ZBackdropIntentFields = ZBackdropIntentBase.shape;

/** World fact deltas the model emits — character/world state changes
 *  the orchestrator applies to lifeWorld on accept. */
export const ZWorldDelta = z.object({
  /** LIFE-TIME-1: how much time this turn consumed. NOT a target time — asked
   *  for one of those the model picks whatever suits the scene it is writing
   *  and walks the clock backwards. `advanceTimeOfDay` owns the arithmetic. */
  timeAdvance: z.preprocess(
    (v) => (typeof v === 'string' ? v : undefined),
    ZTimeAdvance.optional(),
  ),
  /** Updated free-form location label. */
  currentLocationLabel: z.string().optional(),
  /**
   * LIFE-GOAL-3/4 — the ladder delta. Four FLAT fields, and the flatness is
   * measured: `LIFE-CTX-15` found nested optional objects silently dropped from
   * generated output, and a need that vanishes without trace is worse than one
   * that never existed — the objective would look free and block nothing.
   *
   * `addGoals` / `removeGoals` were here and are DELETED. They were authored 0
   * times in 95 measured turns, and `removeGoals` is precisely the affordance
   * that let "find the key" stop existing because the player looked elsewhere.
   * The replacement can only ever CLOSE the live objective, never swap it:
   * `applyLadderDelta` ignores `nextObjective` while one is still live.
   */
  objectiveDone: z.preprocess(
    (v) => (typeof v === 'boolean' ? v : undefined),
    z.boolean().optional(),
  ),
  /** WHY the world took it off the table, in fiction. Presence = closed. */
  objectiveClosed: z.string().nullable().optional(),
  /** The next near objective — read ONLY when the slot is free. */
  nextObjective: z.string().nullable().optional(),
  /** LIFE-NEED-5: a FLAT name; code resolves it to a person / thing / place. */
  nextObjectiveNeed: z.string().nullable().optional(),
});
export type WorldDelta = z.infer<typeof ZWorldDelta>;

/** LIFE-EX-1 / LIFE-EX-4: the header shown above the chip grid on a
 *  graded turn. Two flavours — outbound (fill the blank in your own
 *  utterance) + inbound (pick what the NPC just said). */
/** LIFE-EX-19 — the generator writes `"fill-blank"` on the wire and everything
 *  past this seam says `generation`. Same two-layer split as `ZGradedPlan`, for
 *  the same reason: the generator's job IS to author a sentence with a blank in
 *  it, so `fill-blank` is the accurate INSTRUCTION, while the code around it is
 *  reasoning about a category whose presentations include listen, type and
 *  tiles. One preprocess so nothing downstream sees two names. */
export const ZPracticePrompt = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  return o.kind === WIRE_GENERATION_KIND ? { ...o, kind: 'generation' } : v;
}, z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('generation'),
    /** Sentence template with `___` for the blank, in the practice
     *  language. e.g. "Je ___ une baguette". */
    practiceText: z.string(),
    /** DEPRECATED / OPTIONAL (v2.1): the native template with `___` left
     *  in place. It was NEVER rendered — the post-answer overlay shows
     *  `completedNativeText` (the FILLED translation) — so the generator no
     *  longer emits it (output-token waste). Kept optional so old records
     *  still parse; new fill-blanks omit it. */
    nativeText: z.string().optional(),
    /** LIFE-LANG-6: the FULL native translation of the COMPLETED
     *  sentence — the blank FILLED IN (e.g. "I would like a baguette",
     *  NOT "I ___ a baguette"). Distinct from `nativeText` (which keeps
     *  the `___`). Rendered ONLY in the post-answer PracticeFeedback
     *  overlay so the learner always sees the sentence's meaning even
     *  though fill-blank chips carry no gloss (LIFE-LANG-1). Optional on
     *  the schema; the generator leak-guard (LIFE-EX-GEN-3) enforces it
     *  non-empty (and `___`-free) at runtime. */
    completedNativeText: z.string().optional(),
    /** LIFE-EX-GEN-9: HOW this question guarantees exactly one right answer.
     *  Lifted from practice mode's PRACTICE-GEN-10, which requires every
     *  option-bearing fill-blank to commit to one of two strategies — the
     *  life-sim had no equivalent, which is how chip sets like
     *  [peux / veux / doit] shipped, where every option is a real word that
     *  fits the slot and nothing in the question says which meaning is wanted.
     *
     *    'context-anchor'     — the sentence itself carries enough context that
     *                           only one option is coherent. Pedagogically
     *                           richer: the learner reasons about meaning.
     *    'translation-anchor' — the completed sentence's system-language
     *                           translation is SHOWN above the template, and IS
     *                           the discriminator. For targets where several
     *                           options form equally-valid sentences (modals,
     *                           fixed expressions, near-synonyms) this is the
     *                           only honest way to ask the question. */
    /** LIFE-EX-VOCAB-3: vocab for the line that LANDS AS A BUBBLE when this
     *  question resolves — the completed sentence (fill-blank) or the verbatim
     *  utterance (comprehension). NOT the answer token's own gloss.
     *
     *  Reported 2026-07-31: graded lines arrive as messages with no underlined
     *  words. Comprehension carried none at all; fill-blank inherited the
     *  CHIP's annotations, which cover one token ("voudrais") while the bubble
     *  is the whole sentence ("Je voudrais déjeuner avec toi."). Either way the
     *  most language-dense line of the turn was the one the learner could not
     *  tap. Same segmentation contract as a beat (LIFE-LANG-10). */
    lineVocab: z.record(z.string(), z.string()).optional(),
    disambiguation: z.enum(['context-anchor', 'translation-anchor']).optional(),
  }),
  z.object({
    kind: z.literal('comprehension'),
    /** The NPC's verbatim practice-language utterance the player
     *  is being asked to understand. e.g. "Combien ça coûte ?". */
    npcUtterance: z.string(),
    /** Native-language "What did they say?" prompt. */
    question: z.string(),
    /** LIFE-LANG-12 (comprehension sibling of LIFE-LANG-6): the FAITHFUL
     *  system-language translation of the WHOLE `npcUtterance` (e.g.
     *  "It's only the wind, James. Don't be afraid."). Distinct from the
     *  chips' third-person interpretations ("She is telling him not to
     *  fear") — this is what the line literally MEANS. Rendered ONLY in
     *  the post-answer PracticeFeedback overlay (revealing it before would
     *  BE the answer). Mirrors fill-blank's `completedNativeText`. Optional
     *  on the schema; the generator's leak-guard enforces it non-empty at
     *  runtime, and the feedback path falls back to the correct chip's
     *  gloss if absent. */
    utteranceNativeText: z.string().optional(),
    /** LIFE-EX-VOCAB-3: vocab for the line that LANDS AS A BUBBLE when this
     *  question resolves — the completed sentence (fill-blank) or the verbatim
     *  utterance (comprehension). NOT the answer token's own gloss.
     *
     *  Reported 2026-07-31: graded lines arrive as messages with no underlined
     *  words. Comprehension carried none at all; fill-blank inherited the
     *  CHIP's annotations, which cover one token ("voudrais") while the bubble
     *  is the whole sentence ("Je voudrais déjeuner avec toi."). Either way the
     *  most language-dense line of the turn was the one the learner could not
     *  tap. Same segmentation contract as a beat (LIFE-LANG-10). */
    lineVocab: z.record(z.string(), z.string()).optional(),
    /** NPC's display name. The UI uses this to label the bubble
     *  that appears AFTER the player answers (BUBBLE INVARIANT —
     *  the NPC bubble is the practice's reward). */
    speakerName: z.string().nullable().optional(),
    /** Stable NPC slug. Promotes the NPC to the persistent roster
     *  the moment the player answers, since this is the first time
     *  the line they "said" lands. */
    npcId: z.string().nullable().optional(),
  }),
]));
export type PracticePrompt = z.infer<typeof ZPracticePrompt>;

/** LIFE-SCENE-3 / -4: the model's scene-aware out-of-band
 *  signals. Used by lifeStep to request replans or declare the arc
 *  resolved. Always optional — present on relevant turns, omitted otherwise.
 *
 *  LIFE-SCENE-24: there is no `hook` here any more. A scene starts because the
 *  world has none, not because the model offered a pitch and the player took
 *  it — a handshake that measured ZERO scenes across two harness runs. A model
 *  still emitting `hook` has it stripped by the schema, so an old cached
 *  response cannot smuggle the retired flow back in. */
export const ZStepSceneSignal = z.object({
  /**
   * LIFE-SCENE-25: how far through its subject this scene is, 0-100, stated
   * EVERY turn while a scene is active.
   *
   * The owner's ask, verbatim: *"You could ask the model to OUTPUT scene
   * completeness so it is even more conscious of moving things along."* That is
   * the point — it is a forcing function first and a signal second. `<scenePace>`
   * tells the model where it is in the turn budget; this makes it say where it
   * is in the STORY, and a model that has just written "35" after nine turns
   * has to reconcile the two itself.
   *
   * Advisory: nothing gates on the number, because a model that learns a value
   * ends the scene would simply stop emitting high ones. The turn budget and
   * the floor (`LIFE-SCENE-26`) are what actually bound the length.
   */
  sceneProgress: z.number().min(0).max(100).optional(),
  /** Set true when the player's recent trajectory has drifted enough
   *  that the active outline needs a refresh. Triggers a background
   *  sceneReplan at the next opportunity. */
  replanRequested: z.boolean().optional(),
  /** Set true when the player has done something the outline can't
   *  absorb — triggers an immediate replan. */
  hardPivot: z.boolean().optional(),
  /** When the model has decided this turn IS the resolution beat.
   *  Carries the candidate-ending key the model chose. The UI shows
   *  the SceneCompleteScreen after the resolution lands. May also
   *  carry chapter-level signals: NPC promotion / retirement and the
   *  arcStage signal that lets the model close out the whole
   *  worldArc with this scene. */
  resolved: z
    .object({
      endingKey: z.string(),
      outcomeLine: z.string(),
      /** LIFE-SCENE-28: the SAME sentence in the system language. The scene's
       *  closing line is the one piece of story the completion screen shows,
       *  and it was practice-language only — so a learner who could not read it
       *  was told how their scene ended in a language they were still learning,
       *  with no gloss and no flip. Optional because a scene resolved before
       *  this shipped has no twin; the screen then shows the single line it
       *  has rather than an empty row. */
      outcomeLineNative: z.string().optional(),
      /** LIFE-NPC-RECUR-*: NPC ids the model promotes from
       *  scene-scope to world-scope on resolve. They survive
       *  into future arcs. */
      promotedNpcIds: z.array(z.string()).optional(),
      /** LIFE-NPC-RECUR-*: world-scope NPC ids the model retires
       *  (moved away, died, fell out). They get demoted to
       *  transient and dropped from the roster next turn. */
      retiredNpcIds: z.array(z.string()).optional(),
      /** LIFE-WORLD-ARC-*: 1-3 sentences that should echo in
       *  future chapters as part of the worldArc through-line. */
      keyMomentsForArc: z.array(z.string()).optional(),
      /** LIFE-WORLD-ARC-*: how this resolution affects the broader
       *  worldArc:
       *    'continues'  — the arc rolls on; more scenes ahead.
       *    'climactic'  — this scene was a major arc milestone
       *                    but the arc continues.
       *    'concluding' — this scene ALSO concludes the
       *                    current worldArc (chapter). Show the
       *                    WorldArcCompleteScreen after the
       *                    scene-complete celebration. */
      arcStage: z.enum(['continues', 'climactic', 'concluding']).optional(),
    })
    // LIFE-NODE-16e: NULLABLE, for exactly the reason `phaseTransition` is
    // (LIFE-NODE-16a). `null` is the natural way to write "the scene did not
    // resolve this turn", the field already means that when absent, and the
    // strict parse was charging a full ~21k-token regeneration for the choice
    // between the two spellings. Observed once in the 2026-08-05 four-world
    // run. LIFE-NODE-16a's scan found `phaseTransition` was the only such
    // field AT THE TIME; this is the second, so the class is not closed —
    // future optional OBJECT fields on this signal should be nullish from the
    // start rather than waiting to cost a turn.
    .nullish(),
  /** DEPRECATED (LIFE-STORY-SHAPE-3): plot-beat status tracking was
   *  removed. Field kept on the schema as no-op for one release so
   *  in-flight responses don't fail parsing; remove after 2026-07. */
  completedBeatIds: z.array(z.string()).optional(),
  /** Optional phase the model is advancing to.
   *
   *  LIFE-NODE-16a: NULLABLE, because `null` is the natural way for a model to
   *  say "no transition this turn" and the field already means nothing when
   *  absent. Measured: one four-world run lost a whole turn — a full ~21k-token
   *  regeneration — to a response whose only defect was writing the absence
   *  down instead of omitting it. */
  phaseTransition: z
    .enum(['opening', 'rising', 'midpoint', 'climax', 'resolution'])
    .nullish(),
  /** LIFE-INTENT-2: where the scene's `openQuestion` sits AFTER what the player
   *  just did — one clause, rewritten every live turn. */
  leaning: z.string().max(240).nullish(),
  /** LIFE-INTENT-2: whether the player's action actually moved it. Declining is
   *  legitimate and must be DECLARED; `nextLeaningState` counts consecutive
   *  declines, so silence here reads as a decline rather than a reset. */
  leaningMoved: z.boolean().nullish(),
});
export type StepSceneSignal = z.infer<typeof ZStepSceneSignal>;

/** LIFE-EX-PLAN-*: the planner-stage output the `lifeStep` Gemini call
 *  emits on graded turns. The lifeStep is the curator — it names
 *  WHAT to test (phrase or saved card) and the CONTEXT it appears
 *  in. The generator (LIFE-EX-GEN-*) picks distractors, decides
 *  language placement, and authors the chip set. */
const ZGradedPlanGeneration = z.object({
  kind: z.literal('generation'),
  /** The phrase or word being tested ("quand même", "voudrais",
   *  "à la fin"). MUST appear somewhere in `sentenceContext`. MUST
   *  NOT appear in <recentlyPracticed> (LIFE-EX-PLAN-3). */
  testTarget: z.string(),
  /** The sentence where `testTarget` appears in context — the line
   *  the player is committing to say. e.g. "ils vont tous abattre
   *  les humains quand même". The generator blanks out the target
   *  and authors distractor variants. */
  sentenceContext: z.string(),
  /* LIFE-COST-5 (D2): `rationale` was here — a debug-only "why this target
   * now" line the model wrote on every graded plan and nothing ever rendered.
   * ~55 output tokens a turn for a field read only when someone was staring at
   * a telemetry dump. Dropped from the schema AND the SI; a model that still
   * sends one has it stripped by zod. */
});

const ZGradedPlanComprehension = z.object({
  kind: z.literal('comprehension'),
  /** The verbatim NPC utterance in the practice language. The
   *  generator authors interpretation chips around it. */
  npcUtterance: z.string(),
  speakerName: z.string().nullable().optional(),
  npcId: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
});

/**
 * LIFE-EX-18 — the model does NOT declare the kind; the FIELDS decide it.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * `kind` was redundant with the data beside it. A plan carrying
 * `sentenceContext` IS a line the player is about to say; one carrying
 * `npcUtterance` IS a line an NPC says. Asking the model for a label on top of
 * that is asking it to stay consistent with itself, and every inconsistency had
 * to be repaired by guessing from the PICK — a guess that could be wrong in a
 * way that corrupted the turn. Measured in `LIFE-SPEECH-7`: a `hear` pick on
 * ambient sound made the repair rewrite the player's own line into an NPC's
 * mouth, twice in four.
 *
 * Owner, 2026-08-10: *"No need for the model to even output if it's
 * comprehension or generation. If the npc id is me then it's a generation… if
 * it's another npc then any comprehension exercise."*
 *
 * ── WHAT THIS COSTS, STATED PLAINLY ─────────────────────────────────────────
 *
 * The kind ROTATION goes with it (`LIFE-EX-CADENCE-4` forced production every
 * other slot because, left free, the model chose comprehension every time).
 * That objection was tested rather than assumed — 4 runs with the kind
 * instruction removed, against 4 with it:
 *
 *     fill-blank NODES      6  ->  2
 *     comprehension nodes  21  -> 21
 *     gradeTarget options  55  -> 61
 *     TOTAL production per turn   0.64  ->  0.64
 *
 * Production did not collapse: the node route shrank and the OPTION route
 * absorbed it exactly, because production has had its own clock since
 * `LIFE-EX-CADENCE-7`. Comprehension did not balloon either, because the cadence
 * still decides WHETHER a turn is graded — only WHICH KIND is now derived.
 *
 * A preprocess rather than a schema rewrite: downstream code reads a
 * discriminated union and should keep doing so. What changed is who fills the
 * discriminant.
 */
export const ZGradedPlan = z.preprocess((v) => {
  if (!v || typeof v !== 'object') return v;
  const o = v as Record<string, unknown>;
  const derived = deriveGradedKind(o);
  // A declared kind that AGREES is left alone; one that disagrees is overwritten,
  // because the fields cannot be wrong about whose line they hold. When the
  // fields do not decide (both present, or neither) the declaration stands —
  // translated off the wire name (LIFE-EX-19) so the union can still match it,
  // and `gradedPlanIssues` is what objects to the shape.
  if (derived) return { ...o, kind: derived };
  return o.kind === WIRE_GENERATION_KIND ? { ...o, kind: 'generation' } : v;
}, z.discriminatedUnion('kind', [ZGradedPlanGeneration, ZGradedPlanComprehension]));
export type GradedPlan = z.infer<typeof ZGradedPlan>;
export type GradedPlanGeneration = z.infer<typeof ZGradedPlanGeneration>;
export type GradedPlanComprehension = z.infer<typeof ZGradedPlanComprehension>;

/** LIFE-NODE-4: id of the client-injected "write your own ✏️" chip.
 *  Rendered by the client on BRANCH nodes only — it replaces the
 *  always-visible composer. The model NEVER emits this id and it
 *  never carries a preview; picking it opens the inline composer. */
export const WRITE_YOUR_OWN_ID = '__write__';

/** LIFE-NODE-1: a node — one story moment. Also the shape of a
 *  one-node-deep lookahead preview (LIFE-NODE-2): previews ARE
 *  nodes, minus options.
 *
 *    branch       — a real decision point. 0-2 beats.
 *    continuation — connective pacing. 1-2 beats; its single option
 *                   is the "continue" chip.
 *    question     — a graded teaching intercept. NO beats (the
 *                   bubble for the tested line lands at practice
 *                   resolution, LIFE-CONTRACT-EX-1). Carries only
 *                   the gradedPlan; the chip set is authored by the
 *                   LIFE-EX-GEN-* generator when the node is shown.
 */

/** LIFE-NODE-2: one selectable option on a branch/continuation node.
 *  Same face as a chip (id + bilingual label + emoji + the Phase E
 *  annotation fields inherited from ZStepChoice) minus `correctness`
 *  (options are never graded), plus the lookahead: `next` XOR
 *  `noPreview: true`. */
const ZStepOptionBase = ZStepChoiceBase.omit({ correctness: true });

/** LIFE-CANON-2: what this option acts ON — the canon id of the entity the
 *  player is about to touch. Turns "does this exist yet?" from a prompt plea
 *  into a machine check: the client verifies `targetId` is in <canon> and
 *  retries when it isn't. Optional — an option that acts on nothing in
 *  particular ("Keep walking") omits it.
 *
 *  (There used to be an `intent` enum here for an affordance check, but the
 *  only affordance — "can this entity speak?" — is now enforced at commit time
 *  off the canon record itself, so `intent` had no consumer and was dropped.) */
const ZOptionTargeting = {
  targetId: z.string().nullable().optional(),
};

/** LIFE-SPEECH-1: the player's spoken line for a `say` option — the same
 *  bilingual + vocab-annotation shape as a beat, but CLIENT-rendered as a
 *  `user` bubble on pick. Hidden until the pick (never on the chip face). The
 *  model still never emits a `speaker:'user'` beat — the client stays the sole
 *  constructor of user bubbles (from `buildResolvedBubble` for graded, or
 *  `saysLine` for this).
 *
 *  REQUIRED on every `say` option, graded or not (LIFE-SPEECH-3): when the
 *  option also carries `gradeTarget` this line is the fill-blank's
 *  `sentenceContext` rather than a bubble, and if the target turns out to be
 *  unusable the pick falls back to landing the line — which only works because
 *  the line is always there. */
export const ZPlayerSaysLine = z.preprocess(fillVocabAnnotations, z.object({
  practiceText: z.string(),
  nativeText: z.string(),
  complexWords: z.array(z.string()).optional(),
  wordTranslations: z.record(z.string(), z.string()).optional(),
}));
export type PlayerSaysLine = z.infer<typeof ZPlayerSaysLine>;

/** LIFE-SPEECH-1: the declared role of a pick, mirroring the chip label the
 *  model just wrote. `say` = the player speaks (→ user bubble, via `saysLine`
 *  when non-graded or a fill-blank question when graded); `hear` = the player
 *  receives an NPC line (→ comprehension question → npc bubble); `act`
 *  (default when absent) = a non-speech action. Direction is a PROJECTION of
 *  this, machine-checked, so a "how would you say X" pick can never resolve to
 *  an NPC bubble. */
const ZSpeechAct = {
  /**
   * LIFE-GRID-1.1: the KIND of move this option is. Optional in the schema and
   * required in the prompt, deliberately — a missing or unusable `actionType`
   * must degrade to an untyped option rather than fail the whole turn's parse,
   * the same call `gradeTarget` makes below. `optionSpreadIssues` skips a set
   * it cannot type.
   *
   * PREPROCESSED, not merely `.optional()`. Measured in production 2026-08-03:
   * turns were being REJECTED on `options.0.actionType: Invalid input` and
   * regenerated — a whole extra billed generation, on the one call the player
   * waits on. `z.enum().optional()` accepts *absent* but rejects `null`, and
   * the model writes `null` into optional fields as a matter of course (the
   * same responses carry `"speakerName": null, "npcId": null`).
   *
   * This is LIFE-CAST-4 — *"null is a word the model writes into typed
   * fields"* — one layer up, and it is the sixth instance of that lesson. Any
   * value that is not one of the six becomes `undefined` HERE, where it costs
   * nothing, rather than at the parse seam, where it costs a turn.
   */
  actionType: z.preprocess(
    (v) => (typeof v === 'string' && OPTION_TYPE_VALUES.includes(v) ? v : undefined),
    ZOptionType.optional(),
  ),
  /**
   * LIFE-SPEECH-8 — `'say' | 'act'`. `hear` is RETIRED, and folded in here.
   *
   * It was authored 4 times in 2,110 options and every one was ambient sound
   * ("Listen at the door for guard activity") rather than the contract's
   * meaning, "a line of language arrives that can be comprehension-tested".
   * Two definitions failed to move that (0, then 0 of 209), because the failure
   * is not lexical — `hear` in English means *perceive with the ears*, and the
   * model reads English. The field name was fighting the contract.
   *
   * COERCED, not rejected: a hard enum failure would spend a retry on a label
   * we no longer act on. And `act` is where these belong on the merits —
   * listening at a door IS a physical action, and `act` is the only value that
   * ARMS the `LIFE-CONTRACT-EX-7` lead-in requirement. `hear` used to DISARM
   * it, which is the one live behaviour the field had and it ran backwards:
   * the player heard something and the next node owed them a beat saying what.
   */
  speechAct: z.preprocess(
    (v) => (v === 'hear' ? 'act' : v),
    z.enum(['say', 'act']).optional(),
  ),
  saysLine: ZPlayerSaysLine.optional(),
  /** LIFE-SPEECH-3: the word or phrase inside THIS option's own
   *  `saysLine.practiceText` to blank out, when the model wants this speech
   *  pick graded. Its presence is what makes the pick an outbound fill-blank —
   *  the client builds the plan from it (`gradedSayPlan`) and intercepts before
   *  the line ever reaches the screen. Absent (the common case) = the line
   *  lands as the player's bubble, unchanged. Validated in code, not here: an
   *  unusable target degrades to the ordinary say path rather than failing the
   *  whole turn's parse. */
  gradeTarget: z.string().optional(),
};

/** v2.1: a CYOA option carries ONE native-language action label (LIFE-LANG-15,
 *  options are native-only). The generator emits it in `nativeText` and OMITS
 *  the duplicate `practiceText` (it was identical — pure output-token waste and
 *  "why is practiceText here?" confusion). This preprocess fills `practiceText`
 *  from `nativeText` before validation, so downstream that still reads
 *  `option.practiceText` (flashcard-key lookup, the vocab popover) keeps
 *  working. Scoped to OPTIONS only — graded chips (`ZStepChoice`) keep their
 *  distinct practice-language `practiceText` (the answer token). No-op when the
 *  model still sends both. */
function fillOptionLabel(v: unknown): unknown {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (
      (o.practiceText == null || o.practiceText === '') &&
      typeof o.nativeText === 'string'
    ) {
      return { ...o, practiceText: o.nativeText };
    }
  }
  return v;
}

/** LIFE-NODE-2: an option is now JUST the chip — no `next` lookahead, no
 *  `noPreview`. Every pick routes to a live generation, so the model no longer
 *  authors content for the two branches the player won't take. (`ZNodePreview`
 *  keeps its name: it is still the shape of a NODE, which is all it ever
 *  described — the "preview" reading died with the lookahead.) */
export const ZStepOption = z.preprocess(
  fillOptionLabel,
  ZStepOptionBase.extend({
    ...ZOptionTargeting,
    ...ZSpeechAct,
  }),
);
export type StepOption = z.infer<typeof ZStepOption>;

/* ZQuestionResolution + ZNodePreview are declared HERE, below the option
 * definitions, because LIFE-EX-PLAN-5 gave the question node a `resolution`
 * that carries real options — so the node shape now depends on ZStepOption
 * rather than the other way round. Nothing between the two cared about the
 * order; only this dependency does. */
/** LIFE-EX-PLAN-5: the continuation that follows a graded resolution, authored
 *  in the SAME call as the question rather than by a second full-context
 *  `life_step` call. There is exactly ONE of these — never a correct-path and a
 *  wrong-path variant — because `LIFE-CONTRACT-EX-3` forbids the narrative from
 *  forking on correctness ("the speech event happens identically regardless of
 *  correctness"). So nothing here is speculative and nothing is discarded, which
 *  is what separates it from the lookahead `LIFE-NODE-2` deleted.
 *
 *  `beats` may legitimately be EMPTY (`LIFE-EX-3`: after an inbound comprehension
 *  answer the NPC's line is still the current line, so the turn is just the
 *  response options). `LIFE-CONTRACT-EX-4` still applies — these beats must not
 *  re-quote the practised line.
 *
 *  Options reuse `ZStepOption` outright, so the label derivation
 *  (`fillOptionLabel`, D3) and the vocab derivation (`fillVocabAnnotations`, D1)
 *  both apply and a resolution option is indistinguishable from one on any other
 *  node downstream. */
export const ZQuestionResolution = z.object({
  /** 0-2 beats of what happens after the speech event. Empty is legal. */
  beats: z.array(ZStepBeat).max(2).optional().default([]),
  /** The choices leading out of the resolved moment. Same 2-3 / max-3 rule as a
   *  branch node (the 4th "write your own" chip is client-injected). */
  options: z.array(ZStepOption).max(3).optional().default([]),
  /** LIFE-STORY-LOG-1: the resolution is a story moment, so it gets its own
   *  terse log line. Optional — the question node's own logLine covers the
   *  question itself. */
  logLine: z.string().max(240).optional(),
  /** A resolution may move the scene (the NPC walks you to a table). */
  backdropIntent: ZBackdropIntent.optional(),
});
export type QuestionResolution = z.infer<typeof ZQuestionResolution>;

export const ZNodePreview = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('branch'),
    beats: z.array(ZStepBeat).max(2).optional().default([]),
    backdropIntent: ZBackdropIntent.optional(),
  }),
  z.object({
    kind: z.literal('continuation'),
    beats: z.array(ZStepBeat).min(1).max(2),
    backdropIntent: ZBackdropIntent.optional(),
  }),
  z.object({
    kind: z.literal('question'),
    /** LIFE-CONTRACT-EX-6: 0-2 LEAD-IN beats — the player's action landing,
     *  before the teaching moment intercepts. This used to be absent entirely,
     *  which meant a pick that triggered a question was deleted from the story
     *  (picking "grab the letter by force" jumped straight to a comprehension
     *  question about the reply, with no beat of the grab). They may NOT
     *  contain the line under test, from either side — checked in code by
     *  `leadInLeaksTestedLine`, because a leak reads as a perfectly good beat
     *  and a model cannot tell it has spent the question. */
    beats: z.array(ZStepBeat).max(2).optional().default([]),
    gradedPlan: ZGradedPlan,
    backdropIntent: ZBackdropIntent.optional(),
    /** LIFE-EX-PLAN-5: what happens AFTER the player answers, authored by this
     *  same call. Optional — absent means fall back to a live turn. */
    resolution: ZQuestionResolution.optional(),
  }),
]);
export type NodePreview = z.infer<typeof ZNodePreview>;

/** LIFE-CANON-1: a thing the story establishes THIS turn. Declaring it is what
 *  earns the right to reference it — anything not already in <canon> and not
 *  introduced here is, by contract, not yet part of the world. */
export const ZStepIntroduction = z.object({
  kind: z.enum(['character', 'place', 'object', 'fact', 'faction']),
  name: z.string(),
  /** Optional explicit slug; derived from the name when absent. */
  id: z.string().optional(),
  /** For characters: what they actually ARE ('person', 'spirit', 'animal'…).
   *  This is what makes an affordance like canSpeak meaningful. */
  subKind: z.string().optional(),
  note: z.string().optional(),
  /** Set FALSE for anything that cannot be spoken to. The client then refuses
   *  to render an option offering to speak to it. */
  canSpeak: z.boolean().optional(),
});
export type StepIntroduction = z.infer<typeof ZStepIntroduction>;

/** RETIRED with the lookahead (LIFE-NODE-2/5). `perOptionIssues` enforced the
 *  next-XOR-noPreview law and the hook-accept chip's mandatory `noPreview`.
 *  With no previews there is no XOR to police, and the hook-accept chip needs
 *  no exception because EVERY pick now routes live — which is the behaviour
 *  that exception existed to force. */

/** Node-kind-dependent option-count rules (LIFE-NODE-1). Called from
 *  the superRefine when the response carries the node inline (live
 *  turns), and from generateStepOptions with the client-known kind
 *  on <turn kind="options"> responses (no node to read it from). */
export function optionCountViolations(
  options: ReadonlyArray<{ id: string }>,
  nodeKind: 'branch' | 'continuation' | 'question',
): StepViolation[] {
  if (nodeKind === 'question') {
    return options.length === 0 ? [] : [{ code: 'question-carries-options', count: options.length }];
  }
  if (nodeKind === 'continuation') {
    if (options.length !== 1) {
      return [{ code: 'continuation-option-count', count: options.length }];
    }
    return options[0]!.id === 'continue'
      ? []
      : [{ code: 'continuation-option-id', optionId: options[0]!.id }];
  }
  return options.length >= 2 && options.length <= 3
    ? []
    : [{ code: 'branch-option-count', count: options.length }];
}

/** The Zod-path wrapper. See `shapeViolationMessage`. */
export function optionCountIssues(
  options: ReadonlyArray<{ id: string }>,
  nodeKind: 'branch' | 'continuation' | 'question',
): string[] {
  return optionCountViolations(options, nodeKind).map(shapeViolationMessage);
}

/**
 * LIFE-GRID-1.1 / 1.2 — the option SPREAD, checked as the backstop behind the
 * `<requiredAction>` rotation.
 *
 * Reported failure: *"always directing the user to the same or very similar
 * options in the grid."* The prevention lives in the prompt (a rotating
 * required type costs nothing); this is the reject half, and it should fire
 * rarely — a headless run over 180 option sets tripped it 2% of the time. If
 * the measured rate climbs past ~15% the rule is wrong, not the model.
 *
 * Only unambiguous defects are named. A grid that is merely *slightly* samey is
 * a matter of taste and belongs in the prompt; three options of the same type,
 * or a set where nothing acts on the world, is a defect that can be stated
 * exactly. Options with no `actionType` are skipped rather than guessed at —
 * legacy responses must not be failed for a field they predate.
 */
/**
 * LIFE-GRID-1.3 — ids must be unique and must not be recycled with a new
 * meaning.
 *
 * Measured 2026-08-03: `observe-shadows` appeared on two turns of one scene
 * meaning "wait and watch" then "listen for metallic sounds", and `offer-bread`
 * meant "offer to share the bread" then "offer to keep watch". Ids are the key
 * `actionShapesFromEvents` rebuilds the LIFE-GRID-4 memory from, so a recycled
 * id makes the grid's cross-turn history describe actions the player never
 * took — the one block whose whole job is to be accurate about that.
 *
 * Only WITHIN a response is checkable here; across turns is prevented in the
 * prompt, because the previous turn's ids are not in scope at this seam.
 */
export function optionIdViolations(
  options: ReadonlyArray<{ id: string }>,
): StepViolation[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const o of options) {
    const id = o.id.trim().toLowerCase();
    if (seen.has(id)) dupes.add(o.id);
    seen.add(id);
  }
  return dupes.size ? [{ code: 'option-ids-duplicated', optionIds: [...dupes] }] : [];
}

/** The Zod-path wrapper. See `shapeViolationMessage`. */
export function optionIdIssues(options: ReadonlyArray<{ id: string }>): string[] {
  return optionIdViolations(options).map(shapeViolationMessage);
}

export function optionSpreadViolations(
  options: ReadonlyArray<{ actionType?: OptionType }>,
  nodeKind: 'branch' | 'continuation' | 'question',
): StepViolation[] {
  if (nodeKind !== 'branch' || options.length < 2) return [];
  const types = options.map((o) => o.actionType).filter((t): t is OptionType => !!t);
  if (types.length < options.length) return [];

  const issues: StepViolation[] = [];
  if (new Set(types).size < types.length) {
    issues.push({ code: 'options-repeat-action-type', actionTypes: [...types] });
  }
  if (!types.some((t) => ACTIVE_OPTION_TYPES.includes(t))) {
    issues.push({ code: 'options-none-active' });
  }
  return issues;
}

/** The Zod-path wrapper. See `shapeViolationMessage`. */
export function optionSpreadIssues(
  options: ReadonlyArray<{ actionType?: OptionType }>,
  nodeKind: 'branch' | 'continuation' | 'question',
): string[] {
  return optionSpreadViolations(options, nodeKind).map(shapeViolationMessage);
}

/**
 * SRV-PROMPT-3 — THE SHAPE SENTENCES EXIST ON BOTH SIDES, AND THE DUPLICATION
 * DOES NOT EXPIRE.
 *
 * The three predicates above feed TWO consumers with different needs:
 *
 *   · `applyRequestShape` (generateStepOptions) needs CODES, because the retry
 *     hint they build is now written server-side (SRV-PROMPT-12);
 *   · `ZRawNodeResponse`'s `superRefine` needs a MESSAGE, because a `ZodIssue`
 *     carries a string and that string is the strict-parse contract's own text.
 *
 * So the PREDICATE is single — one implementation per rule, above — and only
 * the wording is duplicated. This is the `DELTA_PER_FRONT` shape (batch 4) and
 * NOT the batch-1 gloss shape: the Zod message is engine text that never
 * migrates, so the two copies never re-converge and deleting this table at some
 * later batch would be wrong.
 *
 * ⚠ Drift is invisible and expensive in a specific way. A `superRefine` message
 * ends up in the model's retry hint too — via `schema-issue`'s `message`
 * parameter — so if these sentences diverge from
 * `functions/src/prompts/lifeStepViolations.ts`, the SAME defect would be
 * described to the model two different ways depending on which seam caught it.
 * `tests/playthrough/serverPromptParity.test.ts` asserts them against each
 * other, rendered.
 */
export function shapeViolationMessage(v: StepViolation): string {
  switch (v.code) {
    case 'question-carries-options':
      return `question nodes carry NO options (got ${v.count}) — the graded generator authors the chips`;
    case 'continuation-option-count':
      return `continuation nodes carry exactly ONE option (got ${v.count})`;
    case 'continuation-option-id':
      return `the continuation option's id must be "continue" (got "${v.optionId}")`;
    case 'branch-option-count':
      return `branch nodes carry 2-3 options (got ${v.count})`;
    case 'options-repeat-action-type':
      return (
        `every option in a set must be a DIFFERENT actionType (got ${v.actionTypes.join(', ')}) — ` +
        'two ways to do the same kind of thing is one option written twice'
      );
    case 'options-none-active':
      return (
        'no option lets the player act on the world — at least one must be do, move, offer or leave; ' +
        'a set that only asks and observes is an interrogation'
      );
    case 'live-turn-missing-node':
      return 'live turns require a `node` to render';
    case 'option-ids-duplicated':
      return `option ids must be unique within a response (repeated: ${v.optionIds.join(', ')})`;
    default:
      // Unreachable: the four families above are the only ones this table
      // serves. Thrown rather than defaulted, because a silently empty Zod
      // message is a strict-parse failure with nothing saying why.
      throw new Error(`shapeViolationMessage: ${v.code} is not a shape violation`);
  }
}

/** LIFE-SPEECH-1: `saysLine` belongs to a `say` option and nowhere else.
 *
 *  A `say` option MUST carry it (else the pick surfaces no player bubble — the
 *  reported bug), and a `hear`/`act` option must not (the player didn't speak).
 *  Checked per option at the strict-parse seam.
 *
 *  The OTHER half of LIFE-SPEECH-1 — the say→fill-blank / hear→comprehension
 *  direction lock — no longer lives here. It used to be checkable in place
 *  because the option and its question preview were authored in the SAME
 *  response; with the lookahead gone (LIFE-NODE-2) the question node is
 *  authored by the NEXT call, so the check moved to a repair against the pick
 *  that led to it — and then went away entirely, because the pick turned out to
 *  be the WRONG source. `deriveGradedKind` below reads the plan's own fields
 *  instead (LIFE-EX-18); there is no direction lock left to check here. */
export function optionSpeechActIssues(
  options: ReadonlyArray<{
    id: string;
    speechAct?: 'say' | 'act';
    saysLine?: unknown;
  }>,
): string[] {
  const issues: string[] = [];
  options.forEach((o, i) => {
    const act = o.speechAct ?? 'act';
    const hasSays = o.saysLine !== undefined && o.saysLine !== null;
    if (hasSays && act !== 'say') {
      issues.push(
        `option ${i} ("${o.id}"): saysLine is ONLY valid on a speechAct:"say" option (the player speaks) — got speechAct:"${act}"`,
      );
    }
    if (act === 'say' && !hasSays) {
      issues.push(
        `option ${i} ("${o.id}"): a "say" option MUST carry saysLine (the player's spoken line) or the pick surfaces NO player bubble`,
      );
    }
  });
  return issues;
}


/**
 * LIFE-EX-18 — the graded kind is DERIVED from whose line it is. The FIELDS win.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The `kind` discriminant is redundant with the fields beside it. A plan with
 * `sentenceContext` is a line the PLAYER is about to say; a plan with
 * `npcUtterance` is a line an NPC says. So `kind` is a label the model has to
 * keep consistent with data it already wrote, and the `gradedPlanDirectionFix`
 * repair (deleted with this change) existed purely to patch the cases where it
 * didn't.
 *
 * That repair guessed from the PICK, and its guess can be wrong in a way that
 * corrupts the turn. Measured (`LIFE-SPEECH-7`): a `hear` pick on ambient sound
 * ("Listen for footsteps") arms the projection, the model authors a fill-blank,
 * and the repair rewrites the line the PLAYER was going to say into an NPC's
 * mouth. 2 of 4 `hear` picks did exactly that.
 *
 * The fields cannot be wrong in that way. `sentenceContext` IS the player's
 * line — whoever declared what.
 *
 * ── WHY `kind` STAYS IN THE SHAPE ───────────────────────────────────────────
 *
 * Not for back-compat. Nothing here is in production and existing wurlds are
 * disposable — an earlier draft of this comment argued the opposite at length,
 * and the constraint was invented. It stays for two smaller, real reasons:
 *
 *   **It is the TIE-BREAK — in theory.** This function returns `null` when the
 *   fields do not decide: both present, or neither. In the BOTH case the
 *   declaration picks the arm and Zod strips the stray field; with no
 *   declaration the plan is unparseable and spends a retry. **Measured after
 *   landing: 0 of 48 graded plans hit either case.** So this reason is sound but
 *   untested by real traffic — if `kind` is ever removed, re-check that number
 *   first rather than trusting this paragraph.
 *
 *   **Removing it is unmeasured.** It costs ~2 tokens per shape in the SI.
 *   "A rule earns its characters" is not licence to delete on an aesthetic —
 *   the same standard that reverted the `hear` definition applies here.
 *
 * ── THE WIRE NAME AND THE CODE NAME DIFFER, ON PURPOSE (LIFE-EX-19) ─────────
 *
 * The model writes `"fill-blank"`; everything past this seam says `generation`.
 * They are different layers and they want different words: `fill-blank` names
 * what the model AUTHORS (a sentence plus the word to blank out) and is a good
 * instruction because it is concrete; `generation` names the pedagogical
 * CATEGORY, whose presentations are chips / type / order / listen — only one of
 * which is a fill-in-the-blank.
 *
 * This function is the single translation point, so nothing downstream has to
 * know there were ever two names. Renaming the WIRE too would be an unmeasured
 * prompt change for zero behaviour, and toward the more abstract of the two
 * words — `LIFE-SPEECH-8` in reverse.
 */
export function deriveGradedKind(
  plan: { kind?: unknown; sentenceContext?: unknown; npcUtterance?: unknown } | null | undefined,
): 'generation' | 'comprehension' | null {
  if (!plan) return null;
  const hasSentence = typeof plan.sentenceContext === 'string' && plan.sentenceContext.trim() !== '';
  const hasUtterance = typeof plan.npcUtterance === 'string' && plan.npcUtterance.trim() !== '';
  // Both or neither: the fields do not decide, so leave the declaration alone
  // rather than inventing an answer. A plan carrying both is malformed and
  // `gradedPlanIssues` is the thing that should say so.
  if (hasSentence === hasUtterance) return null;
  return hasSentence ? 'generation' : 'comprehension';
}


/** LIFE-NPC-MEM-1: one per-NPC memory refresh, authored inline by the step
 *  model. `npcId` must be a roster id verbatim (hallucinated ids are dropped at
 *  commit); `oneLineMemory` is a ≤240-char second-person line. */
export const ZNpcMemoryUpdate = z.object({
  npcId: z.string(),
  oneLineMemory: z.string().max(240),
});

/**
 * LIFE-REP-3 — one person's reaction to the turn.
 *
 * `delta` is coerced rather than validated strictly: a model that writes 2 or
 * -5 has still expressed a direction correctly, and rejecting the whole
 * response over the magnitude would spend a retry on something code is about to
 * clamp anyway. Anything unreadable becomes 0, which `LIFE-REP-4` calls the
 * normal answer.
 */
export const ZFelt = z.object({
  /** Roster id or display name; resolved against the cast at commit. */
  who: z.string(),
  delta: z.preprocess(
    (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.sign(v) : 0),
    z.number(),
  ),
});
export type Felt = z.infer<typeof ZFelt>;
export type NpcMemoryUpdate = z.infer<typeof ZNpcMemoryUpdate>;

const ZRawNodeResponseBase = z.object({
  /** Present on LIVE turns only — the node to render NOW. Omitted on
   *  <turn kind="options"> responses (that node already rendered
   *  from the picked option's preview). */
  node: ZNodePreview.optional(),
  /** The options leading out of the node. Max 3 — the 4th "write
   *  your own" chip is client-injected (LIFE-NODE-4). */
  options: z.array(ZStepOption).max(3).optional().default([]),
  /** Turn-level world-state changes; applied when the response
   *  lands (LIFE-NODE-3). */
  worldDelta: ZWorldDelta.optional(),
  /** LIFE-SCENE-3/4/10 signals; applied when the response lands. */
  scene: ZStepSceneSignal.optional(),
  /** LIFE-CANON-1: entities this turn puts on the page for the first time. */
  introduces: z.array(ZStepIntroduction).max(4).optional(),
  /** LIFE-STORY-LOG-1: ONE terse third-person line recording what just
   *  happened, appended to the chapter's story log. ~15 output tokens buys a
   *  memory that survives past the 40-event read window — the cheapest fix
   *  available for "it forgot what already happened". */
  logLine: z.string().max(240).optional(),
  /** LIFE-NPC-MEM-1: per-NPC memory refreshes for NPCs whose relationship with
   *  the player MATERIALLY advanced this turn (max 3). Authored by the model
   *  that just lived the scene — replaces compaction's reconstruction from a
   *  folded digest. Committed best-effort via applyTurnSignals; omitted NPCs
   *  keep their existing memory. */
  npcMemoryUpdates: z.array(ZNpcMemoryUpdate).max(3).optional(),
  /**
   * LIFE-REP-3 — how the turn LANDED with one person. The only consequence
   * channel there is.
   *
   * A local judgement about a single reaction, which is the thing models are
   * reliably good at — as opposed to maintaining a running total, which is the
   * thing they are reliably bad at (`LIFE-TIME-1`'s ratchet, `LIFE-FRONT-9`'s
   * drift, and now this). Code clamps to ±1 and owns the sum.
   *
   * Capped at 2 per turn: `LIFE-REP-4` says 0 is the normal answer, and a model
   * handed an unbounded array will fill it. The cap is the same restraint
   * device as `npcMemoryUpdates`' max(3) above.
   */
  felt: z.array(ZFelt).max(2).optional(),
});

/** LIFE-NODE-2: the raw shape every life_step Gemini call returns. */
export const ZRawNodeResponse = ZRawNodeResponseBase.superRefine((val, ctx) => {
  const issues = [
    ...optionSpeechActIssues(val.options),
    ...(val.node ? optionCountIssues(val.options, val.node.kind) : []),
    ...(val.node ? optionSpreadIssues(val.options, val.node.kind) : []),
    ...optionIdIssues(val.options),
  ];
  for (const message of issues) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['options'] });
  }
  // LIFE-EX-PLAN-5's resolution check USED TO LIVE HERE, and it did the
  // opposite of what its own comment said. The comment promised the documented
  // degradation — "a resolution that arrives malformed is dropped rather than
  // failing the response … `feedbackContinue` falls back to a live turn" — and
  // the code added a ctx issue, which fails the whole turn. Two of one run's
  // thirteen schema rejections were that contradiction. The check now runs in
  // `repairStepResponse` (LIFE-NODE-16d), where dropping is actually possible:
  // a superRefine can only object, never mend.
});

/**
 * LIFE-NODE-16 — mend what has one correct reading, before the strict schema
 * sees it. Runs on the RAW parsed JSON at the single `safeParse` seam in
 * `generateStepOptions`, so `RawNodeResponseInput` stays an honest description
 * of what an author must write (the E2E fixtures type against it).
 *
 * MEASURED 2026-08-04 across a four-world run's 184 `life_step` responses: 13
 * (7%) failed the strict parse, 11 of them invisibly — each one a whole ~21k
 * input-token regeneration spent on a defect with an obvious fix, and one of
 * the two visible ones cost the run an entire eight-turn scene by landing on
 * turn 0. Every repair below is deterministic and preserves what the model
 * actually authored; nothing here guesses at content.
 *
 * The line this does NOT cross: a branch with two options of the same
 * `actionType` stays a rejection. There is no correct reading — the missing
 * third kind cannot be invented, and relabelling one would lie to the grid
 * rotation that reads the field. See LIFE-GRID-1.1 for why 2.2% is the rule
 * working rather than the rule being wrong.
 */
export function repairStepResponse(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const val = raw as Record<string, unknown>;
  const node = val.node && typeof val.node === 'object' && !Array.isArray(val.node)
    ? (val.node as Record<string, unknown>)
    : null;
  const options = Array.isArray(val.options) ? (val.options as Array<Record<string, unknown>>) : [];
  let node2 = node;
  let options2 = val.options;

  if (node?.kind === 'continuation' && options.length >= 2) {
    // (b) The model wrote a real choice and mislabelled the container. Only
    // promote when the set is a VALID branch — otherwise the relabel would swap
    // one rejection for another and hide which defect was actually there.
    const asBranch = [
      ...optionCountIssues(readIds(options), 'branch'),
      ...optionSpreadIssues(readActionTypes(options), 'branch'),
    ];
    if (asBranch.length === 0) node2 = { ...node, kind: 'branch' };
  } else if (node?.kind === 'continuation' && options.length === 1) {
    // (c) The id is a protocol token, not content: the player reads the
    // option's text either way, so forcing it changes nothing they can see.
    const only = options[0]!;
    if (typeof only.id === 'string' && only.id !== 'continue') {
      options2 = [{ ...only, id: 'continue' }];
    }
  }

  // (d) LIFE-EX-PLAN-5's documented degradation, finally implemented. The
  // question is the load-bearing half of the turn and it is still good; the
  // resolution is an optimisation that saves one call, and losing it costs a
  // live turn rather than the whole node.
  if (node2?.kind === 'question' && node2.resolution && typeof node2.resolution === 'object') {
    const res = node2.resolution as Record<string, unknown>;
    const resOpts = Array.isArray(res.options) ? (res.options as Array<Record<string, unknown>>) : [];
    const broken = [
      ...optionCountIssues(readIds(resOpts), 'branch'),
      ...optionSpreadIssues(readActionTypes(resOpts), 'branch'),
      // LIFE-SPEECH-1 still applies INSIDE the resolution — a `say` option with
      // no `saysLine` surfaces no player bubble. Dropping is the right
      // consequence: worse than a fallback live turn is shipping that bug.
      ...optionSpeechActIssues(readSpeechActs(resOpts)),
    ];
    if (broken.length > 0) {
      const { resolution: _dropped, ...rest } = node2;
      node2 = rest;
    }
  }

  if (node2 === node && options2 === val.options) return raw;
  return { ...val, ...(node2 ? { node: node2 } : {}), options: options2 };
}

/** Coerce raw option entries to the `{id}` shape `optionCountIssues` reads,
 *  substituting '' for a missing/non-string id so a malformed entry is counted
 *  rather than crashing the repair pass. */
function readIds(options: ReadonlyArray<Record<string, unknown>>): Array<{ id: string }> {
  return options.map((o) => ({ id: typeof o.id === 'string' ? o.id : '' }));
}

/** Same, for `optionSpeechActIssues`. An unrecognised `speechAct` is passed
 *  through as absent, which the checker reads as `act` — the safe default,
 *  since only a declared `say` carries the saysLine obligation.
 *
 *  LIFE-SPEECH-8: `hear` folds to `act` HERE TOO. This reader runs on the raw
 *  wire object, BEFORE `ZStepChoiceBase` transforms it, so it is the second
 *  seam the retired value can arrive at — and two seams disagreeing about what
 *  a value means is the shape of bug this whole invariant came from. Behaviour
 *  is unchanged either way (`hear` already read as not-`say`); what changes is
 *  that there is now one answer instead of two. */
function readSpeechActs(
  options: ReadonlyArray<Record<string, unknown>>,
): Array<{ id: string; speechAct?: 'say' | 'act'; saysLine?: unknown }> {
  return options.map((o) => ({
    id: typeof o.id === 'string' ? o.id : '',
    speechAct:
      o.speechAct === 'say' ? 'say'
        : o.speechAct === 'act' || o.speechAct === 'hear' ? 'act'
          : undefined,
    saysLine: o.saysLine,
  }));
}

/** Same, for `optionSpreadIssues`. An absent `actionType` stays absent — the
 *  spread check deliberately skips a set it cannot fully type rather than
 *  guessing (see its own note on legacy responses). */
function readActionTypes(
  options: ReadonlyArray<Record<string, unknown>>,
): Array<{ actionType?: OptionType }> {
  return options.map((o) => ({
    actionType: typeof o.actionType === 'string' ? (o.actionType as OptionType) : undefined,
  }));
}
export type RawNodeResponse = z.infer<typeof ZRawNodeResponse>;
/** Authoring-side (pre-parse) shape — optionals not yet defaulted.
 *  Used by the E2E mock fixtures (tests/e2e/helpers/lifeMock.ts). */
export type RawNodeResponseInput = z.input<typeof ZRawNodeResponse>;

/* The lenient mirror (`ZRawNodeResponseLenient`) went with the sanitize pass —
 * it existed so ONE malformed `next` preview couldn't fail a whole response
 * (LIFE-NODE-5). With no previews, the only thing left to be malformed is the
 * node itself, and a broken node has nothing to salvage. */
