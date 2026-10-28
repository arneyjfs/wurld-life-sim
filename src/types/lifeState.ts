/**
 * The state-machine story artefacts — fronts, clocks, cast tiers, saga state.
 *
 * Spec: docs/specs/story-architecture.md. Read `docs/archive/story-generation-audit.md`
 * for why the old plot-shaped schema was replaced.
 *
 * THE ONE RULE THIS FILE ENCODES: **nothing here stores what WILL happen.**
 * Every field is what is TRUE, what is WANTED, or what is IN MOTION. The old
 * `midpointTwist` / `climax` / `endStates` / `candidateEndings` /
 * `completionTriggers` are gone (LIFE-ARCH-3) — a model handed the twist writes
 * toward the twist, which `LIFE-STORY-STAGE-2` measured directly.
 *
 * Kept OUT of `firestore.ts` because that file is at its LOC cap and because
 * these types are a self-contained contract with their own spec.
 */
import { z } from 'zod';

/* ────────────────────────────── fronts ────────────────────────────── */

/**
 * LIFE-FRONT-3 — what a front fills INTO.
 *
 * Six of the seven are deliberately NOT threats. "What happens if you do
 * nothing" collapses to "something bad" unless the type system refuses to let
 * it, and that collapse is the reported cliché wearing a new costume.
 */
export const ZFrontKind = z.enum([
  'threat', // something is damaged or lost
  'opportunity', // a door closes
  'relationship', // someone cools, leaves, or gives up on the player
  'obligation', // a debt, a promise or a duty comes due
  'rivalry', // someone else gets there first
  'mastery', // the player is found out as not good enough
  'decay', // a place, a trade or a routine quietly ends
]);
export type FrontKind = z.infer<typeof ZFrontKind>;

/** Clock sizes. Bigger = slower = more ambient. A low-stakes world's saga front
 *  should sit at 10-12 (LIFE-FRONT-4): a through-line is required, urgency is
 *  not. */
export const CLOCK_SIZES = [4, 6, 8, 10, 12] as const;

export const ZClock = z.object({
  filled: z.number().int().min(0),
  size: z.number().int().min(4).max(12),
  /** What happens when it FILLS. A world event, never "the player fails":
   *  "the bakery is sold", "Mireille stops speaking to you". Withheld from the
   *  turn prompt (LIFE-FRONT-1.1) — it is the field most likely to produce
   *  foreshadowed doom, and the turn model has no use for it. */
  consequence: z.string(),
  /**
   * LIFE-FRONT-5.1 — the high-water mark, so CLEARING can be distinguished from
   * NEVER HAVING STARTED.
   *
   * The first playthrough ended an entire saga after ONE scene: the model
   * emitted -1 on a clock sitting at 0/8, the clamp held it at 0, and "filled
   * hit zero going down" read as resolved. A pressure that never advanced has
   * not been overcome — nothing happened to it. Clearing now requires the
   * player to have pushed it back down from at least half, which is also the
   * only reading under which "cleared" is a story beat worth ending on.
   */
  peak: z.number().int().min(0).default(0),
  /**
   * LIFE-FRONT-9 — consecutive scene closes in which nothing touched this front.
   *
   * "Clocks advance when unattended" is the Apocalypse World rule the design is
   * built on, and the first playthrough showed it was not actually implemented:
   * one world's saga front sat at 0/8 for six straight scenes because the model
   * — correctly following "an empty list is the normal answer" — never moved
   * it. That is weather that does not blow. The recurring lesson applies: a
   * rule the model can satisfy by doing nothing is not a mechanism, so the
   * drift is a counter in code.
   */
  unattended: z.number().int().min(0).default(0),
  /**
   * LIFE-FRONT-10 — scene closes since this clock last ADVANCED.
   *
   * The second playthrough advanced one world's saga front in 5 of 6 closes:
   * the player was engaged with it, the model judged each scene had moved it,
   * and every judgement was locally defensible. `DELTA_BUDGET` caps a single
   * close and cannot see the run. The result was a SAGA-scope pressure filling
   * inside one chapter — the arc shape collapsing not through any one bad call
   * but through six reasonable ones in a row.
   */
  sinceAdvance: z.number().int().min(0).default(99),
});
export type Clock = z.infer<typeof ZClock>;

/** LIFE-FRONT-1: a source of pressure. Never a plot. */
export const ZFront = z.object({
  id: z.string(),
  name: z.string(),
  /** A cast id, or `'circumstance'` when nobody is driving it. Revisable —
   *  changing it IS a reversal (LIFE-ARCH-7). */
  driverId: z.string().default('circumstance'),
  /** What this force is TRYING to achieve, present tense. The ONLY narrative
   *  field the turn prompt sees (LIFE-FRONT-1.1). */
  agenda: z.string(),
  kind: ZFrontKind,
  scope: z.enum(['saga', 'chapter']),
  clock: ZClock,
  /** Set when the clock fills or is cleared. A resolved SAGA-scoped front puts
   *  the saga into closeout (LIFE-FRONT-5) — detected in code, never
   *  self-reported by the model. */
  resolved: z.enum(['filled', 'cleared']).nullable().default(null),
});
export type Front = z.infer<typeof ZFront>;

/* ─────────────────────────────── cast ─────────────────────────────── */

/**
 * LIFE-CAST-1 — TWO TIERS, and most characters do not want anything.
 *
 * Giving every character an ambition rebuilds the reported failure at cast
 * level: a world where everyone is pursuing something is exhausting, and that
 * IS "predictable drama at every step" one layer down. Principals drive;
 * regulars make the place real.
 */
export const ZCastTier = z.enum(['principal', 'regular']);
export type CastTier = z.infer<typeof ZCastTier>;

/** LIFE-CAST-2: a belief that does not match reality, pinned to a canon id so
 *  the payoff is CODE-DETECTABLE — "this principal believes something the
 *  player now knows to be false" is dramatic irony the engine can find and
 *  hand to `sceneOpen`. A belief never corrected is just a fact. */
export const ZWrongAbout = z.object({
  aboutId: z.string(),
  believes: z.string(),
});
export type WrongAbout = z.infer<typeof ZWrongAbout>;

export const ZCastMember = z.object({
  id: z.string(),
  name: z.string(),
  /** CANON — what the player has WITNESSED. Append-only, and excluded from the
   *  `sceneClose` response schema entirely (LIFE-ARCH-2.1), so a revision
   *  cannot contradict it by construction rather than by checking. */
  known: z.string().default(''),
  tier: ZCastTier.default('regular'),
  /** HOW they talk, 6-10 words. The per-character anchor `LIFE-STORY-VOICE-1`
   *  never had — its rule ("if two NPCs could swap lines you wrote one
   *  character twice") had nowhere to attach. */
  voice: z.string().default(''),
  /**
   * TTS-VOICE-2: the character's gender, for choosing WHOSE voice reads their
   * lines aloud. Nothing in the life sim recorded this before 2026-08-06, so
   * every character in every wurld spoke in the PLAYER's preferred voice.
   *
   * OPTIONAL, and the absence is meaningful rather than a gap to paper over:
   * a legacy world's cast has none, and `voiceForSpeaker` returns empty for a
   * character with no gender so the caller falls back to the player
   * preference. Guessing from a name is the defect this field exists to stop.
   *
   * `other` is a real answer, not a null: it means the character HAS been
   * considered and no binary voice is right for them, which is a different
   * state from "never authored" and reads the same way to the picker.
   */
  gender: z.enum(['male', 'female', 'other']).optional(),
  /** TTS-VOICE-2: which end of the gender's voice pool suits them. Optional —
   *  an absent or unrecognised register widens to the whole pool rather than
   *  failing, because a slightly-off voice beats no voice. */
  voiceRegister: z.enum(['warm', 'firm', 'bright', 'calm', 'rough']).optional(),
  /** Toward the player. Swings both ways; a monotone cast is signal 5 of the
   *  watch-list firing. */
  standing: z.number().int().min(-3).max(3).default(0),
  /** Relationships to OTHER cast, not the player. This is what turns spokes on
   *  a wheel into a society, and it generates story with NO stakes at all:
   *  Mireille and Bébert have not spoken in a year. */
  ties: z
    .array(z.object({ id: z.string(), how: z.string() }))
    .default([]),

  // principals only ------------------------------------------------------
  wants: z.string().optional(),
  /** What they do NEXT if nothing stops them. The raw material every option
   *  grid is built from (LIFE-GRID-3). */
  nextMove: z.string().optional(),
  /** What they will NOT do. Makes a character a person with integrity rather
   *  than a plot function. */
  limit: z.string().optional(),
  wrongAbout: ZWrongAbout.nullable().optional(),

  // regulars only --------------------------------------------------------
  /** What they are doing when the player is not there. The ANTI-DRAMA field: a
   *  row reading "opens at six, complains about the delivery van" cannot be
   *  written as a plot device. */
  routine: z.string().optional(),
});
export type CastMember = z.infer<typeof ZCastMember>;

/* ──────────────────────────── saga state ──────────────────────────── */

/**
 * LIFE-ARCH-5: history is APPEND-ONLY and only the OLDEST entries fold.
 *
 * Repeatedly rewriting a summary degrades it — the telephone-game failure that
 * mutability buys us. Appending bounds the damage to the material that matters
 * least instead of producing a summary of a summary of a summary.
 */
export const ZSagaState = z.object({
  title: z.string(),
  titleNative: z.string().default(''),
  tone: z.string().default(''),
  /** 2-3 sentences of NOW. Not a synopsis, not a hook — where the player
   *  actually stands. Rewritten (as a delta) at each scene close. */
  situation: z.string().default(''),
  /** One line per closed scene, appended, never rewritten. Oldest fold into a
   *  single "earlier:" entry when the render budget is exceeded. */
  history: z.array(z.string()).default([]),
  /** `closing` once the saga-scoped front resolved (LIFE-FRONT-5): one
   *  aftermath chapter, then succession. */
  status: z.enum(['running', 'closing']).default('running'),
});
export type SagaState = z.infer<typeof ZSagaState>;

/* ────────────────────────────── scene ─────────────────────────────── */

/**
 * The scene is now a SITUATION, not an outline. Gone: `candidateEndings`,
 * `completionTriggers`, `openBranches`, `estimatedPhaseCount` — every one of
 * them a stored future, and `candidateEndings` in particular was a monotonic
 * funnel (replan could only ever narrow it).
 */
export const ZSceneSituation = z.object({
  title: z.string(),
  where: z.string(),
  /** Cast ids present. */
  who: z.array(z.string()).default([]),
  /** The ONE thing this scene is about, in a handful of words. */
  subject: z.string(),
  /** What is at stake RIGHT NOW — this scene, not the saga. */
  atStake: z.string().default(''),
  /** LIFE-CANON-6: canon ids this scene deliberately picks back up. Required
   *  non-empty from scene 3 onward. Nothing here PLANS a payoff; it makes
   *  reuse cheaper than invention, and a thing returning after five scenes
   *  carries new meaning automatically because the player has changed. */
  drawsOn: z.array(z.string()).default([]),
  /** LIFE-FRONT-8: the front whose pressure this scene makes PERCEIVABLE.
   *  Required whenever any clock is past half — hidden pressure the player
   *  cannot perceive is indistinguishable from things going wrong for no
   *  reason, which turns an agency design into an on-rails one. */
  signOf: z.string().nullable().default(null),
});
export type SceneSituation = z.infer<typeof ZSceneSituation>;

/* ───────────────────────── option taxonomy ────────────────────────── */

/**
 * LIFE-GRID-1: the `LIFE-OPT-VARIETY` action types, promoted from prose to
 * data. Structured, they turn "all three options are Ask…" from an
 * unverifiable plea into a code check — and, better, let the engine ROTATE a
 * required type per turn so the repeat never happens (LIFE-GRID-5).
 */
export const ZOptionType = z.enum([
  'ask',
  'do',
  'move',
  'observe',
  'offer',
  'leave',
]);
export type OptionType = z.infer<typeof ZOptionType>;

/** The types that act on the world rather than interrogating it. At least one
 *  option per branch set must be one of these — the rule that keeps a warm,
 *  low-key world from reading as a Q&A bot. */
export const ACTIVE_OPTION_TYPES: readonly OptionType[] = ['do', 'move', 'offer', 'leave'];


/* ──────────────────────────── the world clock ──────────────────────────── */

/**
 * LIFE-TIME-1 — ordered, and the order IS the mechanism: `advanceTimeOfDay`
 * indexes into it.
 *
 * Lives here rather than beside its logic in `lib/life/timeOfDay.ts` because
 * `firestore.ts` needs the schema and every `lib/life/*` module imports FROM
 * `firestore.ts` — putting it the other way round is a cycle.
 */
export const TIMES_OF_DAY = [
  'dawn',
  'morning',
  'midday',
  'afternoon',
  'evening',
  'night',
] as const;

export const ZTimeOfDay = z.enum(TIMES_OF_DAY);
export type TimeOfDay = z.infer<typeof ZTimeOfDay>;

/**
 * What the step model is allowed to say about the passage of time.
 *
 * Deliberately NOT a target time. Asked for a target, the model picks whatever
 * suits the scene it is writing and walks the clock backwards; asked how much
 * time passed, it makes a local judgement it is actually good at.
 */
export const ZTimeAdvance = z.enum(['none', 'some', 'lots', 'nextMorning']);
export type TimeAdvance = z.infer<typeof ZTimeAdvance>;
