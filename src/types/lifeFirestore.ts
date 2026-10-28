/**
 * The life-sim WORLD documents: the world itself, its saga + chapters, and the
 * per-world rows that hang off it — events, NPCs, backdrops and scenes.
 *
 * Extracted from `firestore.ts` when that file crossed its 600-line cap, the
 * same reason `lifeState.ts` / `lifeNarrative.ts` / `lifeGoal.ts` /
 * `lifeEvents.ts` / `lifeBeat.ts` / `worldSeedKeys.ts` already live beside it.
 * This is the largest single cluster in that file and a self-contained one: the
 * chat / message / practice schemas never reference it, and it needs only four
 * shared scalars — `ZTimestamp`, `ZDifficulty`, `ZStoredViewSettings`. Those are taken from `./firestorePrimitives`, NOT from
 * `firestore.ts`: importing `firestore.ts` here would close a module cycle
 * against its `export *` below, and these schemas evaluate at import time, so
 * that cycle throws rather than merely reading badly.
 *
 * `firestore.ts` re-exports everything here (`export * from './lifeFirestore'`),
 * so every existing `from '@/types/firestore'` import site is unchanged.
 *
 * Spec: docs/specs/life-sim.md (LIFE-DATA-*), docs/specs/story-architecture.md.
 */
import { z } from 'zod';
import { ZDifficulty, ZStoredViewSettings, ZTimestamp } from './firestorePrimitives';
import { ZGoalLadder } from './lifeGoal';
import { ZCastMember, ZFront, ZTimeOfDay } from './lifeState';
import { ZWorldSeedKey } from './worldSeedKeys';

// ---------- life-sim (LIFE-DATA-*) ----------

/** LIFE-ONBOARD-4: the eight built-in world-seed chip keys (plus
 *  "manual" for user-written seeds, "surprise" for the random pick).
 *  See docs/specs/life-sim.md §3. */

/** LIFE-ONBOARD-3: which KIND of wurld the player asked for. Chosen on
 *  the onboarding toggle, which also scopes which seed examples they
 *  were shown. Load-bearing for the two seeds whose KEY carries no
 *  register of its own: `surprise` (what should a random wurld BE?)
 *  and `manual` (how far may a free-text seed be pushed?). Optional —
 *  worlds created before 2026-07-31 have no mode and the prompts fall
 *  back to reading the seed key alone. */
export const ZWorldMode = z.enum(['realistic', 'fantasy']);
export type WorldMode = z.infer<typeof ZWorldMode>;

/**
 * LIFE-ARCH-3 — the saga is now a DISPLAY RECORD, and nothing more.
 *
 * It was the book-level synopsis: premise, centralConflict, antagonist,
 * factions, keyArchetypes, storyMovements, midpointTwist, climax, endStates,
 * estimatedChapters, loveInterestFate, openThreads. Every one of those was a
 * stored FUTURE — the thing this architecture exists to stop storing — and
 * `sagaOpen` stopped writing all of them. What remains is what the UI shows:
 * the title on the wurld card and the tone line under it.
 *
 * EVERY FIELD IS OPTIONAL OR DEFAULTED, and that is load-bearing rather than
 * lax. `ZLifeWorld` embeds this schema, and `useDocSnapshot` returns `null`
 * data for a doc that fails to parse — so a single required field the writer
 * no longer supplies does not degrade a card, it makes the entire world
 * unloadable. That is exactly what happened when `sagaOpen` began writing the
 * thin record against the old required-pillar schema: worlds created after it
 * landed read back as "world not found". Anything added here later must be
 * optional for the same reason.
 */
export const ZWorldSaga = z.object({
  universe: ZUniverse.optional(),
  title: z.string().default(''),
  /** LIFE-LANG-14: the `title` translated into the display (system)
   *  language, shown under the practice-language title on the intro
   *  screen. Empty on legacy sagas generated before this field (the
   *  translation line then hides). */
  titleNative: z.string().default(''),
  /** SPOILER-SAFE hook shown to the player on the world's first entry + on the
   *  overview card "view more". 2-3 sentences. There is no model-facing
   *  `premise` twin any more — that was the synopsis, and it is gone. */
  playerFacingTeaser: z.string().default(''),
  tone: z.string().default(''),
});
export type WorldSaga = z.infer<typeof ZWorldSaga>;

/** LIFE-WORLD-ARC-2: a single chapter in the world's life. While
 *  active it lives inline as `currentArc`; on chapter resolve it moves
 *  to the `completedArcs/{arcId}` SUBcollection (one doc per chapter —
 *  LIFE-DATA-*), NOT an inline array. Each arc owns a multi-scene
 *  through-line. */
export const ZWorldArcSceneMemory = z.object({
  sceneId: z.string(),
  title: z.string(),
  endingKey: z.string(),
  /** The scene's outcome line, in the PRACTICE language. */
  summary: z.string(),
  /** LIFE-SCENE-35: the system-language twin of `summary`. This record stopped
   *  being purely a persistence record when LIFE-SCENE-31 made it the chapter
   *  card's lead content, so it carries both languages like every other
   *  narrative surface. `''` on any chapter recorded before that (not
   *  backfilled — re-deriving it would mean translating every archived
   *  outcome), and the screen renders one line rather than an empty row. */
  summaryNative: z.string().optional(),
  /** 1-3 sentences flagged by the model on resolve as worth echoing
   *  in future arcs. The next chapter's gen reads these as
   *  through-line beats. */
  keyMomentsForArc: z.array(z.string()).default([]),
});
export type WorldArcSceneMemory = z.infer<typeof ZWorldArcSceneMemory>;

export const ZWorldArc = z.object({
  /** 1-based; chapter 1 is the first arc the world ever generated. */
  chapterNumber: z.number(),
  /** PLANNER register (LIFE-WORLD-ARC-REGISTER): to-the-point about what this
   *  chapter is INTENDED to explore + what it is NOT — the loose pull the
   *  scene generator reads. May name tensions the player hasn't discovered;
   *  never shown to the player. */
  premise: z.string(),
  /** USER register (LIFE-WORLD-ARC-REGISTER): the spoiler-safe, evocative
   *  chapter teaser the PLAYER reads on the overview + resume screens — where
   *  they are + a tease of the trials that may come, no twist/ending/un-met
   *  antagonist. Empty on legacy arcs (consumers fall back to `premise`). */
  playerTeaser: z.string().default(''),
  themes: z.array(z.string()).default([]),
  status: z.enum(['active', 'completed']),
  /** NPC ids flagged as recurring across scenes within this arc.
   *  Eviction is model-driven once this list grows past 8 (LIFE-NPC-RECUR-*). */
  recurringNpcIds: z.array(z.string()).default([]),
  /** Memory accumulated from each scene that completed inside
   *  this chapter — read by future arcs + by the next scene's
   *  generation. */
  completedSceneMemories: z.array(ZWorldArcSceneMemory).default([]),
  /** Set on the resolving scene's `arcStage: "concluding"` signal. */
  outcomeLine: z.string().nullable().optional(),
  startedAt: ZTimestamp.optional(),
  resolvedAt: ZTimestamp.optional(),
});
export type WorldArc = z.infer<typeof ZWorldArc>;

/** LIFE-DATA-1 / LIFE-WORLD-*: a single world. Now keyed by a
 *  generated id (collection path `users/{uid}/lifeWorlds/{worldId}`),
 *  not the legacy singleton. */
import { ZUniverse, ZWorldCanon } from './lifeNarrative';
export const ZLifeWorld = z.object({
  id: z.string(),
  characterName: z.string(),
  /** Practice language frozen at world creation (LIFE-DATA-5). */
  practiceLanguage: z.string(),
  /** Native language at world creation; cached so the lifeStep
   *  prompts don't have to re-fetch the user's profile each turn. */
  nativeLanguage: z.string(),
  /** LIFE-LANG-7: the world's SYSTEM LANGUAGE — the language NARRATION
   *  is written in (scene-setting / what happens), the language NAME
   *  (e.g. "English"). Frozen at world creation, captured from the
   *  active i18n UI locale (resolveSystemLanguage). Narration is
   *  UNCONSTRAINED + rich in this language and NOT leveled; dialogue
   *  stays in practiceLanguage (LIFE-LANG-8/9). Resolved EVERYWHERE as
   *  `world.systemLanguage ?? world.nativeLanguage` (legacy worlds →
   *  native). */
  systemLanguage: z.string().optional(),
  /** Difficulty snapshot at world creation (1-7). Legacy/dormant — the
   *  generation source is now difficultyPinned (LIFE-SETTINGS-7). */
  difficulty: ZDifficulty,
  /** LIFE-SETTINGS-7: per-wurld difficulty override. A number pins this
   *  wurld to a fixed level; null/absent ⇒ FOLLOW the live global
   *  profile.difficulty. Resolved as `difficultyPinned ?? global ?? 2`. */
  difficultyPinned: ZDifficulty.nullable().optional(),
  /** Seed chip the user picked, or 'manual' when they wrote their
   *  own. */
  worldSeedKey: ZWorldSeedKey,
  /** When `worldSeedKey === 'manual'`, the user's verbatim text. */
  worldSeedText: z.string().optional(),
  /** LIFE-ONBOARD-3: 'realistic' | 'fantasy' — the register the player
   *  picked on the onboarding toggle. Present on every world (stamped by the
   *  2026-09-29 migration on the ones created before the toggle existed). */
  worldMode: ZWorldMode,
  /** Display label for the player's current location, in the practice
   *  language. */
  currentLocationLabel: z.string().optional(),
  /** LIFE-BACKDROP-26: the same label in the system language, revealed for a
   *  moment when the ribbon is tapped. Absent on any world last moved before
   *  the field existed — the ribbon is simply not tappable there. */
  currentLocationLabelNative: z.string().optional(),
  /** LIFE-NPC-2 (player-side): status flag for the player's own portrait
   *  SVG. The BYTES live in the `assets/character` SIDECAR doc — never
   *  inline on this hot doc (LIFE-DATA-1, `src/lib/life/characterAsset.ts`).
   *  'pending' = gen in flight (show shimmer); 'ready' = fetch the sidecar
   *  via `useCharacterAvatar`; 'failed' = permanent (LIFE-FAIL-5); absent =
   *  never attempted (commitNode kicks gen). */
  characterAvatarStatus: z.enum(['pending', 'ready', 'failed']).optional(),
  /** Persisted scene descriptor so resume rehydrates the scene SVG.
   *  Compact single-line schema to respect the 600-LOC cap (matches
   * resumeRecap below). */
  currentBackdrop: z.object({ locationType: z.string(), vibe: z.string(), persistent: z.boolean(), label: z.string(), labelNative: z.string().optional(), flavour: z.string().optional(), timeOfDay: ZTimeOfDay.optional() }).nullable().optional(),
  /**
   * LIFE-GOAL-1/2 — the goal ladder: one distant saga goal, one live near
   * objective, and the record of what closed.
   *
   * REPLACES `currentGoals`, a free-text array the model could rewrite on any
   * turn. That field was wired end to end and MEASURED DEAD: 0 added, 0
   * removed, 0 ever live across 4 runs / 95 turns, because the schema offered
   * it and nothing ever asked for it. Deleted rather than left beside this —
   * two goal systems is how the model gets to pick the one with no rules.
   */
  goalLadder: ZGoalLadder.optional(),
  /** LIFE-LANG-3 / MSG-VIEW-7 — the two-row view model. Absent means
   *  practice-only (life's default, unlike chat's — `lifeViewSettings`).
   *  `.catch(undefined)` degrades an invalid stored value to that default
   *  instead of failing the whole world parse. */
  viewSettings: ZStoredViewSettings.optional().catch(undefined),
  /** Engagement counters. */
  lastSessionAt: ZTimestamp.optional(),
  sessionDayCount: z.number().optional(),
  lastSessionDay: z.string().optional(),
  /** Extended character bio (LIFE-ONBOARD-6). Pre-rendered XML
   *  block; absorbs completed-arc summaries on resolve. */
  bio: z.string().optional(),
  /** LIFE-WORLD-SAGA-*: the book-level through-line. Generated once
   *  at world creation; read by chapter / scene / step
   *  generation as the over-arching plot. Null while gen is in
   *  flight; the model improvises until it lands. */
  saga: ZWorldSaga.nullable().optional(),
  /** LIFE-WORLD-ARC-*: the active chapter (one at a time). Null
   *  between chapters (player on Pause). */
  currentArc: ZWorldArc.nullable().optional(),
  /** LIFE-WORLD-ARC-1 / LIFE-DATA-*: count of archived chapters. The
   *  arcs themselves live in the `completedArcs/{arcId}` SUBcollection
   *  (see src/lib/life/arcs.ts) — this scalar is a cheap mirror so the
   *  overview WorldCard badge ("ready for chapter N+1") needs no
   *  per-card subcollection read. Absent ⇒ 0. */
  completedArcCount: z.number().optional(),
  /** LIFE-FLOW-5 (wurlds-v2 Phase C): "Previously on…" recap shown by
   *  WurldResumeScreen on re-entry. Generated fire-and-forget on world
   *  exit. `text` = a single SYSTEM-language recap paragraph (LIFE-LANG-8;
   *  narration register ⇒ system language only, no bilingual doubling).
   *  `lastEventId` = newest event id included in the generation input;
   *  the exit hook regenerates only when ≥5 newer events exist.
   *  Absent/null = never generated (screen falls back to the storyLog
   *  spine — LIFE-MEM-2). */
  resumeRecap: z.object({ text: z.string(), lastEventId: z.string(), generatedAt: ZTimestamp.optional() }).nullable().optional(),
  /** LIFE-CANON-1: the APPEND-ONLY ledger of everything the story has
   *  established. This is the machinery that replaces "the model should
   *  remember" with "the model is told, every turn, exactly what exists".
   *  Characters derive from the NPC roster; places from scene moves; objects
   *  and facts are model-declared on introduction. Entries are NEVER removed
   *  or reordered — appending keeps the rendered block byte-stable, so it
   *  costs nothing in the prefix cache (LIFE-CTX-1). */
  canon: ZWorldCanon.nullable().optional(),
  /** LIFE-TIME-1: the world clock. Code-owned and monotonic within a day — the
   *  step model may only say how much time PASSED, never what time it is now.
   *  A model asked the latter answers "morning" in the evening, because most
   *  scenes read like mornings. */
  timeOfDay: ZTimeOfDay.optional(),

  /* ── LIFE-ARCH: the state-machine story artefacts ────────────────────
   * These REPLACE `saga`. Nothing here stores what WILL happen — every
   * field is what is TRUE, what is WANTED, or what is IN MOTION
   * (LIFE-ARCH-3). See docs/specs/story-architecture.md.
   *
   * Optional only because they arrive a beat after the doc is created, at
   * `sagaOpen`. A world that has them never loses them. */

  /** LIFE-ARCH-1: immutable. Written once, referenced forever. */
  universe: ZUniverse.nullable().optional(),
  /** LIFE-ARCH-3: 2-3 sentences of NOW. Rewritten by `sceneClose` only when
   *  a scene actually moved it — never a plan, always the present tense. */
  situation: z.string().optional(),
  /** LIFE-FRONT-1: what is in motion. Exactly one has `scope: 'saga'`. */
  fronts: z.array(ZFront).optional(),
  /** LIFE-CAST-1: two tiers. Principals drive, regulars make the place real. */
  cast: z.array(ZCastMember).optional(),
  /** LIFE-ARCH-5: append-only history, oldest first. One line per closed
   *  scene, written by `sceneClose`. */
  sagaHistory: z.array(z.string()).optional(),
  /** LIFE-SCENE-2: subjects of recent scenes, so the planner cannot run the
   *  same one twice — measured doing exactly that in production. */
  recentSubjects: z.array(z.string()).optional(),
  /** LIFE-SCENE-2: scenes OPENED in this world, ever. Drives `focusForScene`'s
   *  rotation, so it must tick once per scene and never go backwards.
   *
   *  Deliberately not `sagaHistory.length`: history is written by `sceneClose`,
   *  which can fail, and a rotation index that stalls when a close fails would
   *  hand consecutive scenes to the same principal — the exact failure the
   *  rotation exists to prevent. */
  sceneCount: z.number().optional(),
  /** LIFE-STORY-LOG-1/2: chronological ledger of what happened this chapter, one
   *  terse line per node. The SOLE durable narrative spine (WS1-C retired the
   *  rewritten `rollingSummary`, LIFE-MEM-1): it only ever APPENDS, so
   *  established facts survive past the 20-event render window. Compact
   *  single-line schema for the 600-LOC cap. */
  /** `turns` (LIFE-ARC-PACE-1) counts GENERATED turns, not entries: a graded
   *  turn's pre-authored resolution appends its own line, so `entries.length`
   *  runs ~1.36x ahead of the turn count the pace rule is written in. Absent on
   *  pre-existing docs ⇒ falls back to `entries.length`. */
  storyLog: z.object({ chapterNumber: z.number(), entries: z.array(z.string()).default([]), turns: z.number().optional(), sceneTurns: z.number().optional(), sceneId: z.string().nullable().optional() }).nullable().optional(),
  createdAt: ZTimestamp.optional(),
  updatedAt: ZTimestamp.optional(),
});
export type LifeWorld = z.infer<typeof ZLifeWorld>;

/** LIFE-WORLD-3: lightweight per-user profile that points at the
 *  world the player most recently opened. Used purely as a
 *  breadcrumb — /wurlds IS the overview (NAV-ANIM-8). */
export const ZLifeProfile = z.object({
  lastSeenWorldId: z.string().nullable().optional(),
  updatedAt: ZTimestamp.optional(),
});
export type LifeProfile = z.infer<typeof ZLifeProfile>;

// LIFE-EVENT-1: the event-kind catalogue lives in ./lifeEvents (a data table,
// and this file is at the LOC cap). Re-exported so imports are unchanged.
export { ZLifeEventKind, type LifeEventKind } from './lifeEvents';
import { ZLifeEventKind } from './lifeEvents';


export { ZLifeBeatPayload, type LifeBeatPayload } from './lifeBeat';

export const ZLifeEvent = z.object({
  id: z.string(),
  kind: ZLifeEventKind,
  /** Payload shape depends on `kind`. Validation is lenient at the
   *  doc level — kind-specific parsers handle the inner shape. */
  payload: z.record(z.string(), z.unknown()).optional(),
  createdAt: ZTimestamp.optional(),
});
export type LifeEvent = z.infer<typeof ZLifeEvent>;

/** LIFE-DATA-3: persistent NPC row. Created via npcs.ts on first
 *  persistent appearance; avatar fills in async after Gemini SVG
 *  gen returns (LIFE-NPC-2). */
export const ZLifeNpcAvatarStatus = z.enum(['pending', 'ready', 'failed']);

/** LIFE-NPC-RECUR-*: lifecycle scope of an NPC.
 *   - 'scene' = bound to one scene; vanishes from the active
 *      roster the moment that scene archives.
 *   - 'world'    = recurring world-scope NPC; shows up across
 *      scenes within the same world.
 *   - 'transient' = retiring; the next turn drops this NPC from the
 *      roster and writes an `npc_forgotten` event. The model emitted
 *      it on a scene.resolved via `retiredNpcIds[]`. */
export const ZLifeNpcScope = z.enum(['scene', 'world', 'transient']);
export type LifeNpcScope = z.infer<typeof ZLifeNpcScope>;

export const ZLifeNpc = z.object({
  id: z.string(),
  name: z.string(),
  relationship: z.string().nullable().optional(),
  /** LIFE-DATA-1: avatar status flag ONLY. The SVG BYTES live in the
   *  `assets/npc-{id}` SIDECAR doc (never inline on this roster-listened
   *  doc); the UI reads them via `useNpcAvatars` when status is 'ready'. */
  avatarStatus: ZLifeNpcAvatarStatus.default('pending'),
  /**
   * LIFE-REP-1 — REPUTATION, not affection.
   *
   * **Zero means "you are nobody to them yet"**, not "neutral". Below zero is a
   * debt of regard — being disregarded, never disliked. Seeded from the ROLE GAP
   * at open (`LIFE-REP-2`): a stringer and an editor-in-chief do not start level
   * and neither has wronged the other.
   *
   * Moving the zero point is the highest-leverage line in this feature. Under
   * the old reading only a NEGATIVE standing blocked anything, so a world where
   * nobody disliked the player had nothing in the way at all — measured on the
   * v2 branch's warm fixture, the block never fired in a single one of fifteen
   * 24-turn runs and AGENCY came back 2 in fourteen of them.
   *
   * Code owns the number (`LIFE-REP-3`): the model reports a ±1 reaction and
   * `commitNode` clamps and accumulates. A practice answer NEVER moves it
   * (`LIFE-REP-7`).
   */
  standing: z.number().optional(),
  /** Free-form one-liner the compactor maintains (LIFE-COMPACT-3). */
  oneLineMemory: z.string().optional(),
  /** LIFE-NPC-7: 1-2 sentence, second-person, spoiler-free profile —
   *  "who they are + how they fit into your story". Generated by
   *  generateNpcProfile; backfilled by the commitNode roster sweep. */
  description: z.string().nullable().optional(),
  /** LIFE-NPC-RECUR-*: lifecycle scope. Defaults to 'scene' when
   *  promoted from a scene hook; 'world' when promoted on scene
   *  close; 'transient' when retiring. The roster filter at read time
   *  joins this with `sceneId` to decide visibility. */
  scope: ZLifeNpcScope.default('scene').optional(),
  /** When `scope === 'scene'`, the scene id this NPC is bound
   *  to. When `scope === 'world'` or `'transient'`, ignored / null. */
  sceneId: z.string().nullable().optional(),
  firstMetAt: ZTimestamp.optional(),
  lastSeenAt: ZTimestamp.optional(),
  updatedAt: ZTimestamp.optional(),
});
export type LifeNpc = z.infer<typeof ZLifeNpc>;

/** LIFE-DATA-4: persistent scene row. Created via scenes.ts on
 *  first visit to a persistent locationType+vibe combination. The
 *  rendered SVG markup is cached INLINE on the doc (`svgInline`) —
 *  there is no Storage upload round-trip. */
export const ZLifeBackdrop = z.object({
  id: z.string(),
  /** Normalised cache key — matches descriptorCacheKey(d). */
  descriptor: z.string(),
  /** Display label (e.g. "Paul's bakery"). */
  locationLabel: z.string().optional(),
  /** Inline SVG bytes — the rendered scene markup, cached directly on
   *  the doc (no Storage upload). The only place scene SVGs live. */
  svgInline: z.string().optional(),
  createdAt: ZTimestamp.optional(),
  lastVisitedAt: ZTimestamp.optional(),
});
export type LifeBackdrop = z.infer<typeof ZLifeBackdrop>;

/** LIFE-SCENE-2: the scene outline. One per active scene;
 *  written by sceneGenerate at acceptance, rewritten by
 *  sceneReplan as the arc unfolds.
 *
 *  NB: the old `ZScenePlotBeat` shape (with id + summary + status)
 *  was removed on 2026-06-01 per LIFE-STORY-SHAPE-3 — plot-beat
 *  checklists were dragging the player. Scenes now lean on
 *  `openBranches` + `candidateEndings` instead of a beat sequence. */

export const ZSceneKeyNpc = z.object({
  npcId: z.string(),
  name: z.string(),
  role: z.string(),
});
export type SceneKeyNpc = z.infer<typeof ZSceneKeyNpc>;

export const ZSceneEnding = z.object({
  key: z.string(),
  summary: z.string(),
});
export type SceneEnding = z.infer<typeof ZSceneEnding>;

export const ZSceneOutline = z.object({
  title: z.string(),
  premise: z.string(),
  /** LIFE-SCENE-25: the ONE thing this scene revolves around, in a handful of
   *  words ("getting the key back", "the argument about the rent"). Distinct
   *  from `premise`, which is the situation, and from `title`, which is the
   *  label: `subject` is the test a beat has to pass to belong here. A scene
   *  may bring several people in and out, but a beat that does not serve the
   *  subject belongs in a different scene. Optional so pre-2026-08 scene docs
   *  still parse; the prompt falls back to the premise. */
  subject: z.string().optional(),
  /** LIFE-INTENT-2: the ONE thing this scene is unsettled on, present tense and
   *  naming no outcome ("will Bruno give up the machinery?"). Distinct from
   *  `subject`, which is a destination the scene arrives at — this is a thing
   *  that can come out differently, and it is what gives a player's pick
   *  somewhere to land. NOT an exit condition: `LIFE-SCENE-END-1` still ends
   *  the scene on material change, and a scene may end with its question
   *  unanswered. Optional so pre-2026-08 scene docs still parse; the step
   *  prompt omits the whole block when it is absent. */
  openQuestion: z.string().optional(),
  /** LIFE-ARCH §3: the specific place this scene happens in. `sceneOpen` picks
   *  it from canon or `universe.places` — a scene needs somewhere to BE, and
   *  before this the location was re-invented by the step model every turn. */
  where: z.string().optional(),
  /** LIFE-CANON-6: canon ids this scene picks BACK UP. Nothing here plans a
   *  payoff; it records which dormant material the planner chose, so the reuse
   *  it is asked for is observable rather than asserted. */
  drawsOn: z.array(z.string()).optional(),
  /** LIFE-FRONT-8: the front this scene was asked to make perceivable, and did.
   *  Read by `sceneClose` — a front counts as ATTENDED only when the sign it
   *  reports was the one the engine requested (LIFE-FRONT-8.1). Dropping it
   *  here is what makes every front read as unattended and drift forever. */
  signOf: z.string().nullable().optional(),
  tone: z.string(),
  /** Vocab / register / discourse the model should weave into beats
   *  while this scene runs. */
  practiceFocus: z.array(z.string()).default([]),
  keyNpcs: z.array(ZSceneKeyNpc).default([]),
  /** Safe detours the player can take without invalidating the arc. */
  openBranches: z.array(z.string()).default([]),
  candidateEndings: z.array(ZSceneEnding).default([]),
  /** Human-readable triggers — e.g. "resolution-beat-landed",
   *  "player-walked-away-3x". The MODEL checks these as it advances. */
  completionTriggers: z.array(z.string()).default([]),
  /** ~4-6. Soft hint used by lifeStep pacing. */
  estimatedPhaseCount: z.number().optional(),
});
export type SceneOutline = z.infer<typeof ZSceneOutline>;

export const ZScenePhase = z.enum([
  'opening',
  'rising',
  'midpoint',
  'climax',
  'resolution',
]);
export type ScenePhase = z.infer<typeof ZScenePhase>;

export const ZSceneStatus = z.enum([
  'active',
  'completed',
  'abandoned',
]);
export type SceneStatus = z.infer<typeof ZSceneStatus>;

/** LIFE-SCENE-1: at most one active scene per user. Active
 *  lives at `users/{uid}/lifeScene/active`; completed / abandoned
 *  scenes archive to `users/{uid}/lifeScene/history/{id}`. */
export const ZLifeScene = z.object({
  id: z.string(),
  status: ZSceneStatus,
  outline: ZSceneOutline,
  currentPhase: ZScenePhase.default('opening'),
  /** Resets to 0 on each replan; ticked by lifeStep. Drives the
   *  soft-tick replan trigger (LIFE-SCENE-4). */
  turnsSinceReplan: z.number().default(0),
  /** The candidate ending the model is steering toward — narrowed
   *  by replans as the player's choices accumulate. */
  chosenEndingKey: z.string().nullable().optional(),
  /** LIFE-INTENT-2: one clause on where `outline.openQuestion` sits RIGHT NOW.
   *  Seeded by `sceneOpen`, rewritten by the step model on every live turn that
   *  declares a move. Per-turn state, so it lives on the doc rather than the
   *  outline — the outline is what the scene was opened as, this is what it has
   *  become. */
  leaning: z.string().optional(),
  /** LIFE-INTENT-2: consecutive turns the model has DECLARED the leaning did
   *  not move. Counted in code, because "move the leaning" is otherwise one
   *  more rule satisfiable by doing nothing — here, doing nothing is what
   *  increments it. Drives the escalation at `LEANING_STALL_LIMIT`. */
  leaningStall: z.number().optional(),
  acceptedAt: ZTimestamp.optional(),
  resolvedAt: ZTimestamp.optional(),
  /** When the user archives the scene-complete screen. */
  closedAt: ZTimestamp.optional(),
});
export type LifeScene = z.infer<typeof ZLifeScene>;
