/**
 * LIFE-CTX-1/3 / LIFE-STEP-2 — the `life_step` PROMPT, SERVER-OWNED.
 *
 * SRV-PROMPT-8..13 batch 8, the last and largest. `src/lib/life/prompts/step.ts`
 * is DELETED; this builds both halves from a validated spec.
 *
 * ── WHAT THE SPEC CARRIES, AND WHY EVENTS TRAVEL RAW ────────────────────────
 *
 * The obvious design sends the DERIVED scalars — the cadence tier, the recent
 * targets, the action shapes — because the client already computes them. It is
 * the wrong design here, and batch 7's rule says why: **no parameter carries
 * something the server already holds.** `<recentEvents>` has to render the
 * event rows whatever else happens, so the rows travel; and once they do, every
 * reduction over them (`cyoaStreak`, `productionStreak`, `recentlyPracticedTargets`,
 * `actionShapesFromEvents`, `canonWorkingSetIds`) is something the server holds,
 * and sending it as well would let a caller claim a streak its own events
 * contradict.
 *
 * The exceptions are the three values that CANNOT be re-derived from anything
 * the wire carries, each of which reduces state this prompt never reads:
 *   · `goalLadder.saga.daysLeft`   — `daysLeft(ladder)`
 *   · `goalLadder.blocked`         — `exposureReason(objective, worldFactsFor(world, npcs))`
 *   · `canon`                      — `resolveCanon(world, npcs)`
 * All three stay client-side because each is ALSO read by engine code that
 * judges the model's answer, so moving them would duplicate rather than move.
 *
 * ── SRV-PROMPT-10: THIS KIND IS REJECT-AVERSE, AND IT IS THE ONLY ONE ───────
 *
 * A rejected `life_step` does not degrade. `generateStepOptions` catches the
 * 400, returns `{kind:'error'}`, and the player gets "the story hit a snag"
 * plus a Continue chip whose only action is to make the identical call again —
 * a hard loop rather than a simpler turn. So the validator below rejects only
 * where an honest client cannot reach it and there is nothing to neutralise TO;
 * every optional, model-authored or legacy-laden field NEUTRALISES instead.
 * `buildLifeStep`'s own comments (in `serverPromptSpec.ts`) record the call
 * per family, and `lifeStepSpec.test.ts` drives each one.
 *
 * ── NO `responseSchema`, NO `cacheSlot` ─────────────────────────────────────
 *
 * Both asserted, so the absence reads as a decision. See `lifeStepSI.ts` for
 * the measured reasons (LIFE-CTX-15 for the schema, PRACTICE-CACHE-1 and the
 * four interpolated values for the slot).
 */
import {
  EMPTY_CANON,
  actionShapesFromEvents,
  canonWorkingSetIds,
  leadInDirective,
  recentlyPracticedTargets,
  renderAlreadySpoken,
  renderCanon,
  renderGoalDirective,
  renderGoalState,
  renderPracticeCadence,
  renderProductionCadence,
  renderRecentActions,
  renderRequiredType,
  renderSceneQuestion,
  renderStoryStage,
  renderWorldStateBlocks,
  requiredTypeForTurn,
  type StepGoalLadder,
  type WorldCanon,
} from "./lifeStepBlocks";
import {
  escapeAttr,
  escapeText,
  renderChapterPace,
  renderIdleChapter,
  renderRecentEvents,
  renderScenePace,
  type StepArc,
  type StepEvent,
} from "./lifeStepRender";
import { leanStepSystemInstruction } from "./lifeStepSI";
import { storyStage } from "./lifeStoryStage";
import { renderUniverse, renderWorldStory, type WorldStoryCastMember, type WorldStoryFront, type WorldStoryUniverse } from "./lifeWorldState";

/** One roster row, narrowed to the five fields the prompt reads. */
export type StepNpc = {
  id: string;
  name: string;
  relationship?: string | null;
  oneLineMemory?: string;
  scope?: "scene" | "world" | "transient";
  sceneId?: string | null;
};

/** The active scene, narrowed to what `<scene>`, `<scenePhase>`, `<scenePace>`
 *  and `<sceneQuestion>` render between them. */
export type StepScene = {
  id: string;
  currentPhase: string;
  turnsSinceReplan: number;
  leaning?: string | null;
  leaningStall?: number | null;
  outline: {
    title: string;
    subject?: string | null;
    where?: string | null;
    premise: string;
    tone: string;
    openQuestion?: string | null;
    practiceFocus: readonly string[];
    keyNpcs: ReadonlyArray<{ npcId: string; name: string; role: string }>;
  };
};

/** The just-answered graded question, as the `<turn kind="practiceOutcome">`
 *  block renders it. */
export type StepPracticeOutcome = {
  kind: "generation" | "comprehension";
  correct: boolean;
  picked: string;
  correctAnswer: string;
  promptSource: string;
  resolvedLine?: string | null;
  resolvedSpeaker?: "user" | "npc" | "narrator" | null;
};

/** The pick this turn is answering. */
export type StepChoice = {
  id: string;
  practiceText: string;
  speechAct?: "say" | "act";
  saysLine?: string | null;
};

/** Everything `buildLifeStepPrompt` reads, and nothing else. */
export type LifeStepInput = {
  // ── the system instruction ────────────────────────────────────────────
  practiceLanguage: string;
  nativeLanguage: string;
  systemLanguage: string;
  difficulty: number;
  // ── the stable prefix ─────────────────────────────────────────────────
  characterName: string;
  worldSeedKey: string;
  worldSeedText?: string;
  /** LIFE-ONBOARD-6 — the `<bio>` block, stored on `lifeWorld.bio`. Passes
   *  through `normaliseBioBlock` (SRV-PROMPT-14) before it reaches here. */
  bio?: string;
  universe?: WorldStoryUniverse | null;
  story?: {
    situation?: string;
    fronts?: readonly WorldStoryFront[];
    cast?: readonly WorldStoryCastMember[];
  };
  /** `resolveCanon(world, npcs)`, resolved at the call site. */
  canon?: WorldCanon;
  npcs?: ReadonlyArray<StepNpc>;
  recurringNpcIds?: readonly string[];
  // ── chapter + scene ───────────────────────────────────────────────────
  chapterNumber?: number;
  /** `storyLog.turns ?? storyLog.entries.length`, resolved at the call site —
   *  `turns` excludes pre-authored resolution arrivals and `entries.length`
   *  does not, and the pace rule is written in the first (LIFE-ARC-PACE-1). */
  chapterTurns?: number;
  /** `currentArc.startedAt.toMillis()`. */
  chapterStartedAtMs?: number | null;
  sceneTurns?: number;
  storyLogEntries?: readonly string[];
  rollingSummary?: string;
  arc?: StepArc | null;
  scene?: StepScene | null;
  currentLocationLabel?: string;
  goalLadder?: StepGoalLadder | null;
  timeOfDay?: unknown;
  turnIndex?: number;
  events?: readonly StepEvent[];
  // ── the turn ──────────────────────────────────────────────────────────
  requestKind?: "live" | "options";
  currentNodeKind?: "branch" | "continuation" | null;
  isOpeningBeat: boolean;
  choice?: StepChoice | null;
  freeText?: string | null;
  practiceOutcome?: StepPracticeOutcome | null;
  /** SRV-PROMPT-12 — the rendered retry block, appended verbatim as the last
   *  section. Empty / absent on attempt 1. Built by `renderStepRetryHint` from
   *  CODES, never from caller prose. */
  retryHint?: string;
};

/**
 * LIFE-SI-LEAN-7 — the `full` variant is DELETED, and this is now the only step
 * system instruction there is.
 *
 * It was ~73,000 characters over 641 lines. `leanStepSystemInstruction` is
 * ~21,000, and everything that made the cut is measured: `LIFE-CONFORM-1`
 * restated the 43 string tests as assertions on model OUTPUT, `LIFE-SI-LEAN-5`
 * ported back the five rules whose absence actually moved a number, and
 * `LIFE-CONFORM-2` read transcripts for the dozen no predicate can see. The
 * rules left behind were left behind on evidence — the figurative-line cap, the
 * lexicon rules, the scene turn window — each with the measurement recorded
 * where it was dropped.
 *
 * The variant switch goes with it. It existed to run an A/B; the A/B is over,
 * and a switch nothing selects is a second code path that only rots. What
 * replaced it as the safety net is better than a fallback prompt: a conformance
 * harness that reads real archives and says which RULES the model still obeys.
 *
 * If this ever needs undoing, the full SI is `git show fe0c65d^:src/lib/life/prompts/step.ts`.
 */
export function lifeStepSystemInstruction(opts: {
  practiceLanguage: string;
  nativeLanguage: string;
  /** LIFE-LANG-7: the language NARRATION is written in. Usually the
   *  user's native language; may differ when the app UI locale does. */
  systemLanguage: string;
  difficulty: number;
}): string {
  return leanStepSystemInstruction(opts);
}

/** LIFE-CTX-13: verbatim recent-event render window. The caller loads more to
 *  feed the derivations (recentlyPracticedTargets / cyoaStreak); only the last
 *  20 render — <storySoFar> carries older history, so a wider verbatim window is
 *  redundant token spend. */
const STEP_EVENT_WINDOW = 20;

/**
 * LIFE-CTX-19 — how many `<npcRoster>` rows may render.
 *
 * Chosen against the producer, not for roundness (`SRV-PROMPT-15`'s rule,
 * applied to a render window): `LIFE-CAST-3` expects ~30 named people by
 * chapter five, and the measured crossing point is ~81 rows, so 48 clears the
 * honest world by 1.6× and the cliff by 1.7×. An honest world never reaches it;
 * a world that does was going to hard-loop.
 *
 * ⚠ It TRUNCATES rather than rejecting, which is the opposite of
 * `SRV-PROMPT-15`'s default and the same exception batch 8 recorded for this
 * kind: on `life_step` a 400 IS the failure it is meant to prevent.
 */
export const STEP_ROSTER_CAP = 48;

/**
 * The ids the REST of the prompt points at, which the cap must not drop.
 *
 * `LIFE-CTX-10`(a) binds a rendered `beat` to its roster row by `npcId` so the
 * model never has to re-match a speaker by NAME across turns — the attribution
 * drift `LIFE-CANON-4` also guards. A prefix `slice` would silently reintroduce
 * exactly that, and would do it worst for the longest-played worlds, so the cap
 * RETAINS these and fills the remainder.
 *
 * The set is bounded by construction, which is what makes the cap safe rather
 * than merely smaller: history contributes at most `STEP_EVENT_WINDOW` (20)
 * distinct ids because that is all `<recentEvents>` renders (`LIFE-CTX-13`),
 * the canon working set is bounded by the canon caps, and the arc's recurring
 * list and the current scene's cast are bounded by their own schemas.
 */
function rosterKeepIds(input: LifeStepInput): Set<string> {
  // ⚠ NOT seeded from the canon working set, which was this guard's first and
  // wrong shape: that set is itself seeded with every world-scope npc, so
  // "retain everything referenced" retained all of them and the cap did
  // nothing. The three sources below are each bounded by their own schema.
  const keep = new Set<string>();
  for (const id of input.recurringNpcIds ?? []) keep.add(id);
  // Only the rendered tail can bind anything — an event outside the window is
  // not in the prompt, so its npc is not referenced by it.
  for (const e of (input.events ?? []).slice(-STEP_EVENT_WINDOW)) {
    // ⚠ `payload.npcId`, NOT `e.npcId`. `StepEvent` is `{kind, payload?,
    // createdAtMs?}` and the binding lives one level down; reading the top
    // level silently found nothing and the retention did nothing. It was caught
    // only because the FIXTURE was written from the spec rather than from this
    // code — had both been written together they would have been wrong
    // together, and the guard would have passed while protecting nothing.
    const npcId = (e.payload as { npcId?: unknown } | undefined)?.npcId;
    if (typeof npcId === "string" && npcId) keep.add(npcId);
  }
  const sceneId = input.scene?.id;
  if (sceneId) {
    for (const n of input.npcs ?? []) {
      if (n.sceneId === sceneId) keep.add(n.id);
    }
  }
  return keep;
}

/**
 * The roster, bounded. Referenced rows first, then the rest in the order the
 * caller sent them, up to `STEP_ROSTER_CAP`.
 *
 * ⚠ A roster AT OR UNDER the cap comes back UNTOUCHED, by identity — the common
 * path has to stay byte-identical or this is a behaviour change wearing a
 * bound's clothes.
 *
 * ⚠ If the retained set ALONE exceeds the cap it is kept whole. Correctness
 * beats bytes at that point: dropping a row the prompt still names is the
 * silent failure this exists to prevent, and the resolver's own `too-large`
 * check is the backstop. `stepRosterCap.test.ts` pins the set's bound so that
 * arm stays unreachable rather than merely unlikely.
 */
export function capStepRoster(
  npcs: ReadonlyArray<StepNpc>,
  keep: ReadonlySet<string>,
): ReadonlyArray<StepNpc> {
  if (npcs.length <= STEP_ROSTER_CAP) return npcs;
  const kept = npcs.filter((n) => keep.has(n.id));
  if (kept.length >= STEP_ROSTER_CAP) return kept;
  const rest = npcs.filter((n) => !keep.has(n.id));
  return [...kept, ...rest.slice(0, STEP_ROSTER_CAP - kept.length)];
}

/** LIFE-MEM-2: a world that existed BEFORE compaction was removed (WS1-C) may
 *  carry a legacy `rollingSummary` and only a few `storyLog` lines. Surface it
 *  read-only until the durable spine fills past this many entries, then drop it.
 *  Matches STORY_LOG_HEAD in commitNode.ts. New worlds (rollingSummary '') never
 *  trip it. */
const LEGACY_SUMMARY_SHIM_MAX = 8;

/** Renders the user-prompt body in the LIFE-CTX-1 order. The SI
 *  is sent separately to Gemini (top of the cache); this is the
 *  per-turn user content. */
export function buildLifeStepPrompt(input: LifeStepInput): string {
  const sections: string[] = [];

  // (1.5) LIFE-UNIVERSE-1: the setting + its LAWS. Generated once with the
  //       saga and never regenerated, so this is the most stable block in the
  //       whole prompt and belongs at the very top of the cache prefix. The
  //       laws are what make a rule like "the hush-spirits cannot speak" a
  //       standing constraint the model reads every turn, rather than a detail
  //       buried in a beat forty events ago.
  const universe = renderUniverse(input.universe);
  if (universe) sections.push(universe);

  // LIFE-STORY-STAGE-1/2: how far into its FIRST chapter this world is.
  // Computed here because it governs BOTH the `<storyStage>` block in the
  // volatile tail AND how much of the saga the stable prefix is allowed to
  // carry — the two must never disagree about whether the story has started.
  const stage = storyStage({
    chapterNumber: input.chapterNumber ?? 1,
    chapterTurns: input.chapterTurns ?? 0,
  });

  // (2) World seed + character sheet. Stable across turns; only
  //     mutates on character-sheet edits or compaction.
  sections.push(
    [
      `<character name="${escapeAttr(input.characterName)}" practiceLanguage="${escapeAttr(input.practiceLanguage)}" nativeLanguage="${escapeAttr(input.nativeLanguage)}"/>`,
      `<world seed="${escapeAttr(input.worldSeedKey)}"${input.worldSeedText ? ` description="${escapeAttr(input.worldSeedText)}"` : ''}/>`,
      // LIFE-ONBOARD-6: extended bio block — people, quirks,
      // hooks. Empty when bio gen failed; the model falls back
      // to inventing context per-turn.
      input.bio ?? '',
      // LIFE-ARCH — what is TRUE, WANTED and IN MOTION. Replaces the
      // book-level synopsis `renderSaga` used to put here: premise,
      // midpointTwist, climax, endStates were all stored FUTURES, and
      // LIFE-STORY-STAGE-2 measured that a model handed the twist writes
      // toward it. Fronts render agenda + driver only, never a clock
      // (LIFE-FRONT-1.1). Stable for a scene at a time, so it caches well here.
      renderWorldStory(input.story ?? {}),
      // NB: currentLocation + goals used to live here but are VOLATILE — they
      // now render in a <currentState> block just above <recentEvents> so
      // scene/goal changes don't evict the stable prefix cache (LIFE-CTX-1).
    ]
      .filter(Boolean)
      .join('\n'),
  );

  // (2.5) LIFE-CANON-1: the established-entity ledger. The authoritative answer
  //       to "does this exist yet?", replacing the model's previous job of
  //       re-deriving that from a 40-event window every turn.
  //
  //       LIFE-CANON-5: only entities IN PLAY carry their `note`. Canon is
  //       append-only and uncapped — ~17,600 chars by node 300, the largest
  //       unbounded term in the body — and since the implicit cache boundary
  //       stops inside the SI, every byte of it is billed at the full uncached
  //       rate. The working set is computed from the SAME volatile text that
  //       renders below (the section order is unchanged; only the computation
  //       moves earlier), so an entity nobody has mentioned in the last 20
  //       events stops paying for its description every turn while keeping its
  //       id, name, kind and affordance — every canon rule the SI states still
  //       holds for every entity.
  const canonContextText = [
    ...(input.events ?? []).slice(-STEP_EVENT_WINDOW).map((e) => JSON.stringify(e.payload ?? {})),
    ...(input.storyLogEntries ?? []),
    input.currentLocationLabel ?? '',
    input.goalLadder?.objective?.text ?? '',
    input.goalLadder?.saga?.text ?? '',
  ].join('\n');
  // `resolveCanon(world, npcs)` ran HERE and stays CLIENT-SIDE: it is what
  // `validateNodeResponse` checks the model's `targetId`s against, so it is a
  // judgement on the ANSWER rather than prompt text. The resolved ledger
  // travels (SRV-PROMPT-12's "nothing the server already holds" does not bite —
  // the server holds neither the stored canon nor the roster's relationships).
  const canon = input.canon ?? EMPTY_CANON;
  // LIFE-CTX-19 — the BOUNDED roster is computed FIRST and everything that keys
  // off an npc derives from it, because the alternative was two unbounded
  // blocks rather than one. `pinnedIds` used to be "every world-scope npc",
  // which seeds `canonWorkingSetIds` unconditionally — so `<npcMemory>` (line
  // ~500) rendered an `oneLineMemory` for every NPC a world had ever created,
  // and that block carries PROSE where the roster carries identity. Deriving
  // the pins from the capped roster bounds both, and makes it impossible to
  // render a memory for someone with no roster row to bind it to
  // (`LIFE-CTX-10` in reverse).
  const roster = capStepRoster(input.npcs ?? [], rosterKeepIds(input));
  const npcMemoryInPlay = canonWorkingSetIds(canon, {
    text: canonContextText,
    // Recurring (world-scope) NPCs carry the chapter — always in play.
    pinnedIds: roster.filter((n) => n.scope === 'world').map((n) => n.id),
  });
  sections.push(renderCanon(canon, npcMemoryInPlay));

  // (2.6) NB: <storySoFar> USED to render here (above roster/scene) but grows
  //       every turn, so it evicted the prefix cache on EVERY call — moved to the
  //       volatile tail, just above <recentEvents> (LIFE-CTX-13).

  // (3) NPC roster (LIFE-SCENE-8 + LIFE-NPC-RECUR-6). Each row carries scope
  //     (scene / world). Recurring NPCs from the active chapter's roster ALSO
  //     get surfaced in a separate <recurringNpcs> block below so the model
  //     treats them as priority for hooks + scenes.
  //
  // ⚠ LIFE-CTX-19 — BOUNDED HERE. This comment used to read "Filter is applied
  // by the caller (LifeScreen) so we just render what was passed", and there
  // was no such filter: `useLifeNpcs` subscribes to the whole `npcs`
  // subcollection with no `limit()` and `npcSpec` maps every row. The roster
  // grew for the life of a world and crossed `MAX_PROMPT_BYTES` at ~81 rows —
  // against `LIFE-CAST-3`'s ~30 by chapter five — where `SRV-PROMPT-10` turns a
  // `too-large` into the player's hard loop. A stale comment asserting a bound
  // nothing enforced is how it survived eight batches.
  if (input.npcs && input.npcs.length > 0) {
    const recurringIds = new Set(
      input.recurringNpcIds ?? [],
    );
    const rows = [...roster]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((n) => {
        const scope = n.sceneId ? 'scene' : 'world';
        const recurring = recurringIds.has(n.id) ? ' recurring="true"' : '';
        const rel = n.relationship
          ? ` relationship="${escapeAttr(n.relationship)}"`
          : '';
        // LIFE-CTX-13: identity ONLY, self-closing. oneLineMemory used to live
        // inside this row but mutates (~1-in-5 turns) while the row is stable, so
        // embedding it evicted the whole roster from the cache. It now renders in
        // its own <npcMemory> block in the volatile tail.
        return `  <npc id="${escapeAttr(n.id)}" name="${escapeAttr(n.name)}" scope="${scope}"${recurring}${rel}/>`;
      })
      .join('\n');
    sections.push(`<npcRoster>\n${rows}\n</npcRoster>`);
  } else {
    sections.push(`<npcRoster/>`);
  }

  // (3.5) LIFE-NPC-RECUR-6: highlight block. When the active arc
  //       carries recurring NPCs, surface them as a priority list so
  //       the model leans on them in hooks + scenes. The roster
  //       above still has them with `recurring="true"`; this block
  //       is the eviction-cap signal — when the list grows past 8
  //       the model should favour retirement on scene resolves.
  const recurring = resolveRecurringRoster(
    input.recurringNpcIds,
    input.npcs,
  );
  if (recurring.length > 0) {
    const rows = recurring
      .map(
        (n) =>
          `  <npc id="${escapeAttr(n.id)}" name="${escapeAttr(n.name)}"/>`,
      )
      .join('\n');
    const capHint =
      recurring.length > 8
        ? ` overCap="true"`
        : recurring.length >= 6
          ? ` approachingCap="true"`
          : '';
    sections.push(
      `<recurringNpcs count="${recurring.length}"${capHint}>\n${rows}\n</recurringNpcs>`,
    );
  }

  // (4) Scene index — populated by scene cache in Phase C.
  sections.push(`<backdropIndex/>`);

  // (4.2) The chapter-frozen flashcard deck block was REMOVED (2026-07): the
  //       story no longer threads saved cards into the narrative. It weaved
  //       ~1-2k input tokens into every turn and forced graded targets toward
  //       whatever card was due rather than what the scene + level called for.
  //       Vocabulary is now CAPTURED from the story (save-as-flashcard) and
  //       reviewed in the dedicated practice session. Graded targets are
  //       chosen purely for story fit + difficulty (LIFE-EX-PLAN-2).

  // (4.5) Active scene (LIFE-SCENE-2/3/4). Present when an
  //       arc is in flight; absent in idle mode. Renders outline
  //       identity + open branches + candidate endings + current
  //       phase so the model can pace without a beat checklist
  //       (LIFE-STORY-SHAPE-3).
  if (input.scene) {
    sections.push(renderScene(input.scene));
  } else {
    // LIFE-WORLD-ARC-4: idle does NOT mean empty. The chapter's through-line
    // renders here so the next hook has something to serve — see
    // `renderIdleChapter`. A world between chapters (or one stranded with no
    // arc) still falls back to the bare tag.
    sections.push(renderIdleChapter(input.arc));
  }

  // (5) LIFE-MEM-2: legacy rollingSummary shim. Compaction is gone (WS1-C) and
  //     the durable spine is <storySoFar>; but a world mid-chapter at the
  //     cutover may still carry a rollingSummary while its storyLog is short.
  //     Surface it read-only until the log fills, then drop it. New worlds
  //     (rollingSummary '') never render it.
  const legacySummary = (input.rollingSummary ?? '').trim();
  const logLen = (input.storyLogEntries ?? []).length;
  if (legacySummary && logLen < LEGACY_SUMMARY_SHIM_MAX) {
    sections.push(`<priorSummary>${escapeText(legacySummary)}</priorSummary>`);
  }

  // (5.2) LIFE-CTX-13/10: per-NPC memory, split OUT of the roster row so the
  //       roster stays byte-stable. Keyed by npcId, sorted, at the top of the
  //       volatile tail so it stays cached on the ~4/5 turns it doesn't change.
  if (input.npcs && input.npcs.length > 0) {
    // LIFE-CANON-5: same working-set rule as <canon>. A memory line is ~90 chars
    // and only useful while that NPC is on stage; a roster that grows all
    // session was paying for every retired acquaintance's biography every turn.
    // `canonWorkingSetIds` already pinned world-scope NPCs, so recurring
    // characters keep their memory whether or not they were just mentioned.
    const memRows = [...roster]
      .filter((n) => (n.oneLineMemory ?? '').trim())
      .filter((n) => npcMemoryInPlay.has(n.id))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(
        (n) =>
          `  <npcMemory npcId="${escapeAttr(n.id)}">${escapeText(n.oneLineMemory ?? '')}</npcMemory>`,
      );
    if (memRows.length > 0) {
      sections.push(`<npcMemory>\n${memRows.join('\n')}\n</npcMemory>`);
    }
  }

  // (5.5) LIFE-CTX-1 cache health: VOLATILE world-state — current location
  //       (changes every few nodes) + goals (any worldDelta). Rendered HERE,
  //       in the volatile tail just above <recentEvents>, NOT in the stable
  //       prefix (section 2) — otherwise each scene/goal change evicted the
  //       roster + scene + summary from
  //       Gemini's prefix cache on ~20-30% of turns.
  const stateRows: string[] = [];
  // LIFE-CTX-9: the scene's volatile counters live HERE, not on the
  // <scene> tag up at §4.5 — they change every turn and would otherwise
  // evict the outline + summary from the prefix cache on every single call.
  if (input.scene) {
    stateRows.push(
      `  <scenePhase phase="${input.scene.currentPhase}" turnsSinceReplan="${input.scene.turnsSinceReplan}"/>`,
    );
  }
  if (input.currentLocationLabel) {
    stateRows.push(
      `  <location>${escapeText(input.currentLocationLabel)}</location>`,
    );
  }
  // LIFE-GOAL-* — the ladder, rendered as STATE the model reads and a
  // DIRECTIVE it must answer. The old `<goals>` block was state only, which is
  // half of why nothing ever wrote to it: a block you can read and never have
  // to act on is scenery. `renderGoalDirective` (below) is the half that asks.
  const ladderRows = renderGoalState(input.goalLadder);
  if (ladderRows) stateRows.push(ladderRows);
  if (stateRows.length > 0) {
    sections.push(`<currentState>\n${stateRows.join('\n')}\n</currentState>`);
  }

  // (5.9) LIFE-STORY-LOG-1: the append-only chapter spine — what has happened
  //       this chapter, in order. MOVED here from the old §2.6 (it grows every
  //       turn, so it belongs in the volatile tail, not the stable prefix —
  //       LIFE-CTX-13). Survives past the verbatim <recentEvents> window, so
  //       established facts don't silently fall out of the model's view.
  const logEntries = input.storyLogEntries ?? [];
  if (logEntries.length > 0) {
    sections.push(
      `<storySoFar>\n${logEntries.map((l) => `  <happened>${escapeText(l)}</happened>`).join('\n')}\n</storySoFar>`,
    );
  } else {
    sections.push('<storySoFar/>');
  }

  // (6) Recent events — oldest → newest. RENDER-capped to the last
  //     STEP_EVENT_WINDOW (LIFE-CTX-13); older history lives in <storySoFar>.
  //     The caller loads a wider window to feed the derivations below, so the
  //     cap is applied to the render only, not to `input.events`.
  //     LIFE-SCENE-33: when the active scene's boundary is still inside that
  //     window, the block is PARTITIONED at it rather than listed flat — the
  //     prior scene is a labelled container, not one more row.
  sections.push(
    renderRecentEvents(
      (input.events ?? []).slice(-STEP_EVENT_WINDOW),
      input.scene?.id ?? null,
      input.scene?.outline?.where ?? null,
    ),
  );

  // (6.4) Recently-practiced fill-blank targets. The model otherwise
  //       keeps reusing the same verb / preposition across consecutive
  //       graded turns. Surfacing the recent target list lets the SI
  //       rule "pick a FRESH target or demote to CYOA" actually bind.
  // `currentArc.startedAt.toMillis()` ran HERE; a Firestore `Timestamp` does
  // not survive JSON, so the call site reads the number off it and sends that.
  const chapterStartedAt = input.chapterStartedAtMs ?? null;
  const recentTargets = recentlyPracticedTargets(input.events ?? [], chapterStartedAt);
  if (recentTargets.length > 0) {
    const rendered = recentTargets
      .map((t) => `<target>${escapeText(t)}</target>`)
      .join('');
    sections.push(`<recentlyPracticed>${rendered}</recentlyPracticed>`);
  }

  // (6.5) Question cadence directive (LIFE-NODE-7). The model has a
  // bias toward narrative nodes over question nodes (cheaper
  // to author); left alone it stops asking questions entirely.
  // Counter it by counting decision events since the last
  // correction event and directing a question NODE when the
  // streak hits 2 (~1 question node in 3). Not applied on the
  // opening beat (no history) or on practiceOutcome turns (the node
  // after a practice is never a question — its OPTIONS carry the
  // next question instead, so the directive fires on the following
  // options call via the same counter).
  // LIFE-EX-CADENCE-1: pressure, not position. This used to be a single
  // imperative at streak >= 2 — "Make THIS node a question" — which forced the
  // graded moment onto whatever node happened to be Nth regardless of whether
  // anything was being said there. A question bolted onto a moment that does not
  // call for one reads as a pop quiz, and the model has no way to say "not here,
  // but next turn". Two tiers now: a DUE nudge that lets the model place the
  // question at the next moment that genuinely fits, and an OVERDUE tier that
  // closes the window so the streak cannot run away.
  // LIFE-ARC-PACE-1: where this chapter is against its length budget. Without
  // this the model cannot act on the pace rule at all — chapters ran forever
  // because "you are 45 turns in" was never said. Silent below the window: a
  // premature conclusion is its own failure mode.
  const chapterPace = renderChapterPace(input.chapterTurns ?? 0);
  if (chapterPace) sections.push(chapterPace);
  // LIFE-ARC-PACE-4: the DAY's own budget. Emitted alongside <chapterPace>,
  // never instead of it — they bound different units and a chapter spans
  // several days, so the model needs both to know whether it is closing a day
  // or a chapter.
  // LIFE-SCENE-25: the pace block names the SUBJECT, so "bring it to an
  // ending" points at a specific thing rather than at the scene in general.
  const scenePace = renderScenePace(
    input.sceneTurns ?? 0,
    input.scene?.outline.subject ?? input.scene?.outline.premise ?? null,
  );
  if (scenePace) sections.push(scenePace);
  // LIFE-INTENT-2: the one thing this scene is UNSETTLED on, and where it
  // currently sits. Rendered here, in the volatile tail beside <scenePace>,
  // rather than up in the cached scene block — the same placement lesson
  // LIFE-INTENT-1 learned the hard way, where a rule ~500 lines up in the
  // prefix lost to a directive in the tail. This block is about what the
  // player JUST did, so it belongs next to the turn, not next to the setting.
  const sceneQuestion = renderSceneQuestion(input.scene);
  if (sceneQuestion) sections.push(sceneQuestion);
  // LIFE-STORY-STAGE-1: the WORLD's own clock, one level above the chapter's.
  // Empty once the world is `underway`, which is the whole point — after that
  // <chapterPace> governs and nothing should still be capping what the story
  // may contain. The cast size is the live roster, so the block can say "you
  // have one, you need two" rather than asking for variety in the abstract.
  const storyStageBlock = renderStoryStage({
    stage,
    chapterTurns: input.chapterTurns ?? 0,
    castSize: input.npcs?.length ?? 0,
  });
  if (storyStageBlock) sections.push(storyStageBlock);

  // LIFE-SCENE-24: <hookPressure> lived here. It existed to nag the model into
  // offering a hook, because a chapter ends only when a scene resolves and the
  // model offered ZERO across 37 measured turns. The engine now starts the
  // scene itself, so there is nothing left to nag about.

  const cadence = renderPracticeCadence({
    events: input.events ?? [],
    isOpeningBeat: input.isOpeningBeat === true,
    hasPracticeOutcome: input.practiceOutcome != null,
    // LIFE-EX-CADENCE-6: the cadence block is conditional on the pick in two
    // places, and it could not see the pick.
    pickedSpeechAct: input.choice?.speechAct ?? null,
  });
  if (cadence) sections.push(cadence);

  // LIFE-EX-CADENCE-7 — production has its OWN clock, and it is deliberately
  // pushed independently of the block above. A comprehension question used to
  // reset the shared streak and buy two turns at `tier="none"`, where the model
  // marked `gradeTarget` on 1 of 22 `say` options. Gating the exercise that
  // costs nothing on the clock of the one that costs a whole turn is backwards.
  const production = renderProductionCadence(input.events ?? []);
  if (production) sections.push(production);

  // LIFE-GOAL-3/4 — the forcing function. In the VOLATILE tail beside the other
  // per-turn directives, because it is conditional on state that changes every
  // turn and would evict the stable prefix if it sat higher (LIFE-CTX-1).
  //
  // This is the half `currentGoals` never had: the state block above is
  // readable, and this is the block the model has to ANSWER.
  // `worldFactsFor(world, npcs)` ran HERE and stays client-side: it reduces
  // the whole world and the whole roster to answer one question, and its ANSWER
  // (`exposureReason`) travels on `goalLadder.blocked` instead.
  const goalDirective = renderGoalDirective(input.goalLadder);
  if (goalDirective) sections.push(goalDirective);

  // LIFE-GRID-5 / LIFE-GRID-4 — the option-grid mechanics, in the VOLATILE tail
  // because they change every turn and would otherwise invalidate the cached
  // prefix below them. `requiredTypeForTurn` is the PREVENT half of the reported
  // "same options every turn" complaint: rotating a required type costs nothing
  // and guarantees the spread, where rejecting a bad set costs a whole extra
  // call. `<recentActions>` is the cross-turn memory the grid never had — the
  // same mechanism `<recentlyPracticed>` already uses for vocab, which works.
  const requiredType = requiredTypeForTurn(input.turnIndex ?? (input.events ?? []).length);
  const recentActions = renderRecentActions(actionShapesFromEvents(input.events ?? []));
  if (recentActions) sections.push(recentActions);
  sections.push(renderRequiredType(requiredType));
  // LIFE-NPC-10 + LIFE-TIME-1 — the world-state blocks. Above the volatile tail
  // because they change every few turns rather than every turn.
  sections.push(
    renderWorldStateBlocks({
      practiceLanguage: input.practiceLanguage,
      characterName: input.characterName,
      npcNames: (input.npcs ?? []).map((n) => n.name),
      timeOfDay: input.timeOfDay,
    }),
  );


  // (7) Current input — the volatile bit at the very bottom.
  if (input.requestKind === 'options') {
    // LIFE-NODE-2: the node is already on screen — its beats are the
    // newest beat events and the player's pick is the newest decision
    // event. Ask ONLY for the options.
    const kind = input.currentNodeKind ?? 'branch';
    const shape =
      kind === 'continuation'
        ? 'exactly ONE option with id "continue"'
        : '2-3 options';
    sections.push(
      `<turn kind="options" nodeKind="${kind}">The current node is already on screen — its beats are the most recent beat events above, following the player's latest decision. Do NOT emit a node and do NOT re-narrate those beats. Author the OPTIONS leading out of this moment: ${shape}.</turn>`,
    );
  } else if (input.isOpeningBeat) {
    sections.push(
      `<turn kind="opening">Generate the opening node (kind "branch"). LEAD with a MEDIUM ESTABLISHING narrator beat (2-4 sentences, in the practice language) that sets the stage — WHERE the player is, WHAT is going on, the mood, and WHO is present if anyone (LIFE-STORY-RHYTHM ESTABLISH). Do NOT open on an NPC line: the player has no context yet for who would be speaking. If a character is present, they MAY add ONE short greeting beat AFTER the establishing prose. Then 2-3 options that invite the player to engage. So: 1 medium narrator beat (+ optionally 1 short npc greeting), 2-3 options.</turn>`,
    );
  } else if (input.practiceOutcome) {
    const o = input.practiceOutcome;
    const outcome = o.correct ? 'correct' : 'wrong';
    // LIFE-SPEECH-6: on a FILL-BLANK the player has just PRODUCED a whole line,
    // and the client has already put it on screen as their own bubble. This
    // branch used to pass only the graded metadata below, so the model had no
    // idea the line was said — and `LIFE-SPEECH-2` documents exactly what it
    // does then: it stages the speech itself and, barred from `user` beats by
    // the PLAYER-VOICE RULE, hands the player's words to an NPC. Reported as
    // "it shows in the events as both me and the NPC saying the line". The
    // `<alreadySpoken>` treatment existed for the `say`-PICK branch below and
    // was never applied here. Both now share ONE builder, in `stepSpeech.ts` —
    // two call sites that must say the same thing is the shape that drifts.
    sections.push(
      `<turn kind="practiceOutcome" practiceKind="${escapeAttr(o.kind)}" outcome="${outcome}">\n` +
        `  <picked>${escapeText(o.picked)}</picked>\n` +
        `  <correctAnswer>${escapeText(o.correctAnswer)}</correctAnswer>\n` +
        `  <promptSource>${escapeText(o.promptSource)}</promptSource>` +
        `${renderAlreadySpoken(o.resolvedLine, o.resolvedSpeaker)}\n` +
        `</turn>`,
    );
  } else if (input.choice) {
    // LIFE-SPEECH-1: the pick rides into this call. It used to feed the
    // say->fill-blank / hear->comprehension direction lock, which is gone
    // (LIFE-EX-18). Two live readers remain and both are worth the attribute:
    // `leadInDirective` arms the lead-in beat on an ACT (LIFE-CONTRACT-EX-10),
    // and `renderPracticeCadence` routes production to the option after a SAY.
    // Since LIFE-SPEECH-8 the only values are `say` and `act`.
    const act = input.choice.speechAct;
    const actAttr = act ? ` speechAct="${escapeAttr(act)}"` : '';
    // LIFE-SPEECH-2: the line is ALREADY the player's bubble on screen — the
    // client prepends it the instant they pick, one call before this one. The
    // model was previously told only the menu label ("Tell them I am lost"), so
    // it staged the speech itself; barred from `user` beats by the PLAYER-VOICE
    // RULE, it put the player's words in an NPC's mouth. Reported as "my
    // character says it, then the npc says it from their character".
    const saidBlock = renderAlreadySpoken(input.choice.saysLine);
    sections.push(
      `<turn kind="choice"${actAttr}><choice id="${escapeAttr(input.choice.id)}">${escapeText(input.choice.practiceText)}</choice>${saidBlock}${leadInDirective(act)}</turn>`,
    );
  } else if (input.freeText) {
    // LIFE-LANG-13.1 — free text is the player SPEAKING, and the client has
    // already put it on screen as their bubble. Same budget as the `say`
    // branch above: it costs one of the two visible slots.
    sections.push(
      `<turn kind="free">${escapeText(input.freeText)}</turn>\n  <note>The player wrote that themselves and it is ALREADY on screen as their own bubble — do not repeat or restage it. It also COSTS A SLOT (LIFE-LANG-13.1 event budget): this node adds AT MOST ONE more beat, so the words they just wrote stay in view.</note>`,
    );
  } else {
    sections.push(
      `<turn kind="continue">The player is resuming. Generate the next natural beat continuing from the events above. No new scene change unless time has clearly passed in the narrative.</turn>`,
    );
  }

  // SRV-PROMPT-12 — THE RETRY HINT IS A SECTION, not a caller-appended string.
  //
  // `generateStepOptions` used to build `${prompt}\n\n${retryHint}` at the call
  // site. Once the server builds the prompt the client cannot append to it, so
  // the critic's verdict had to cross as CODES (`lifeStepViolations.ts`) and be
  // rendered here. Pushing it as the last section joins with the same `\n\n`
  // the caller used, which is what keeps the bytes identical.
  if (input.retryHint) sections.push(input.retryHint);

  return sections.join('\n\n');
}

/**
 * LIFE-ARCH §3: render the active scene as an XML block the model can read.
 *
 * A place, some people, and something at stake — `where` / `keyNpcs` /
 * `subject` / `premise`. Nothing else, because nothing else is decided yet.
 *
 * WHAT LEFT, AND WHY IT MATTERS HERE. `openBranches`, `candidateEndings` and
 * `completionTriggers` used to ride into EVERY step prompt for the whole life
 * of the scene. That is what made them expensive: not that they were authored
 * once, but that the model was reminded of the plan on every single turn, and a
 * model shown three candidate endings writes toward one of them. They are no
 * longer written (`runSceneOpen`), so the arrays are empty on new scenes and
 * these blocks would render empty for old ones — dropped outright rather than
 * left to rot.
 */
function renderScene(c: StepScene): string {
  const o = c.outline;
  const keyNpcs = o.keyNpcs
    .map(
      (n) =>
        `    <npc id="${escapeAttr(n.npcId)}" name="${escapeAttr(n.name)}" role="${escapeAttr(n.role)}"/>`,
    )
    .join('\n');
  const focus = o.practiceFocus
    .map((f) => `    <focus>${escapeText(f)}</focus>`)
    .join('\n');
  return [
    // LIFE-CTX-9: NO volatile counters on this tag. `turnsSinceReplan`
    // increments every single turn and `phase` advances mid-chapter; both
    // used to ride here, at §4.5, which invalidated the prefix cache from
    // this block down (summary + this whole outline) on EVERY turn. They
    // now render in the volatile <currentState> block instead.
    `<scene id="${escapeAttr(c.id)}" status="active">`,
    `  <title>${escapeText(o.title)}</title>`,
    o.subject?.trim() ? `  <subject>${escapeText(o.subject)}</subject>` : '',
    o.where?.trim() ? `  <where>${escapeText(o.where)}</where>` : '',
    `  <atStake>${escapeText(o.premise)}</atStake>`,
    o.tone.trim() ? `  <tone>${escapeText(o.tone)}</tone>` : '',
    focus ? `  <practiceFocus>\n${focus}\n  </practiceFocus>` : '',
    keyNpcs ? `  <keyNpcs>\n${keyNpcs}\n  </keyNpcs>` : '',
    `</scene>`,
  ]
    .filter(Boolean)
    .join('\n');
}


/** LIFE-NPC-RECUR-*: resolve recurring-NPC ids against the passed
 *  roster. Ids without a roster match are dropped (they may have
 *  been retired or never existed). Returns ordered by the ids list
 *  so the prompt-side highlight is stable. */
function resolveRecurringRoster(
  ids: ReadonlyArray<string> | undefined,
  roster: ReadonlyArray<StepNpc> | undefined,
): Array<{ id: string; name: string }> {
  if (!ids || ids.length === 0 || !roster) return [];
  const lookup = new Map<string, StepNpc>();
  for (const n of roster) lookup.set(n.id, n);
  const out: Array<{ id: string; name: string }> = [];
  for (const id of ids) {
    const n = lookup.get(id);
    if (n && n.scope !== 'transient') out.push({ id: n.id, name: n.name });
  }
  return out;
}
