/**
 * LIFE-SCENE-*: pure-ish helpers for the scene lifecycle —
 * snapshotting completion stats, computing the per-response replan
 * plan, and the accept / close flows. LifeScreen calls into these
 * so the screen stays focused on UI state.
 *
 * Spec: docs/specs/life-sim.md §11 (LIFE-SCENE-*).
 */
import { runSceneOpen } from './runSceneOpen';
import { EMPTY_CANON } from './canon';
import { RECENT_SUBJECTS_WINDOW } from './sceneFocus';
import { archiveScene, createScene, updateActiveScene } from './scene';
import { appendLifeEvent, updateLifeWorld } from './world';
import { appendCompletedArc } from './arcs';
import { appendSceneMemory } from './bioMemory';
import { kickoffNpcAssets } from './commitNode';
import {
  promoteNpcToWorld,
  promoteOrTouchNpc,
  retireNpcToTransient,
} from './npcs';
import * as log from '../log';
import { SCENE_FLOOR } from './prompts/stepRender';
import { nextLeaningState } from './sceneLeaning';
import type {
  SceneOutline,
  LifeScene,
  LifeEvent,
  LifeWorld,
  WorldArc,
} from '@/types/firestore';
import type { StepSceneSignal } from './stepSchema';

/** LIFE-SCENE-10: snapshot the data the SceneCompleteScreen
 *  needs at the moment of resolution. Stats are computed from
 *  correction events that landed during the scene window
 *  (acceptedAt → now). Filter is timestamp-based. */
export type SceneCompletionSnapshot = {
  title: string;
  premise: string;
  tone: string;
  outcomeLine: string;
  /** LIFE-SCENE-28: the system-language twin of `outcomeLine`. Empty when the
   *  model did not supply one (pre-2026-08 scenes). */
  outcomeLineNative: string;
  endingKey: string;
  /** LIFE-WORLD-ARC-*: 'concluding' means THIS scene also closes
   *  the active worldArc — the player sees the WorldArcCompleteScreen
   *  after dismissing the SceneCompleteScreen. */
  arcStage: 'continues' | 'climactic' | 'concluding';
  /** Through-line memories the model flagged on resolve. Absorbed
   *  into the worldArc's completedSceneMemories on close. */
  keyMomentsForArc: string[];
  /** LIFE-NPC-RECUR-*: NPC ids the model promotes to world-scope on
   *  this scene's resolve. */
  promotedNpcIds: string[];
  /** LIFE-NPC-RECUR-*: world-scope NPC ids the model retires to
   *  transient on this scene's resolve. */
  retiredNpcIds: string[];
  /** LIFE-DAY-6: each exercise type carries its own SCORE, not just a tally.
   *  One day-wide accuracy read identically for a player who aced fill-blank
   *  and missed every comprehension as for one who was evenly mediocre. The
   *  two `*Correct` figures are allowed NOT to sum to `correctCount` — an
   *  untagged correction counts toward the day and toward neither type. */
  stats: {
    gradedCount: number;
    correctCount: number;
    generationCount: number;
    generationCorrect: number;
    comprehensionCount: number;
    comprehensionCorrect: number;
  };
  /** LIFE-VOCAB-RECAP-2: the scene window START (seconds) — `acceptedAt`.
   *  The practised-words list is DERIVED reactively at render from the live
   *  events window (`derivePractisedWords(events, windowStartSec)`), NOT frozen
   *  here: a resolve-time snapshot of `p.events` raced the Firestore listener
   *  (admin-seeded / just-written events could be missing from the frozen list),
   *  which is the flake this de-races. Mirrors how the chapter words already
   *  derive reactively from `arc.startedAt`. */
  windowStartSec: number;
};

/**
 * LIFE-SCENE-26: a scene shorter than `SCENE_FLOOR` turns has not been a scene.
 *
 * The owner named BOTH failure modes — days that ran too long AND scenes too
 * small to be satisfying — and only the first was ever guarded (`<scenePace>`).
 * A model that resolves on turn 2 because a `completionTrigger` happened to
 * match hands the player a completion screen for something they barely played.
 *
 * Refused in CODE rather than asked for in the SI, for the reason this spec
 * keeps relearning: the SI already says "don't end it too early", and a rule
 * the model can satisfy by doing nothing (or by mis-reading its own trigger
 * list) is not a rule. The scene simply continues; the model gets another turn
 * and the `<scenePace>` block keeps counting.
 */
export function sceneResolveTooEarly(sceneTurns: number): boolean {
  return sceneTurns < SCENE_FLOOR;
}

export function snapshotSceneCompletion(
  c: LifeScene,
  resolved: {
    endingKey: string;
    outcomeLine: string;
    outcomeLineNative?: string;
    arcStage?: 'continues' | 'climactic' | 'concluding';
    keyMomentsForArc?: string[];
    promotedNpcIds?: string[];
    retiredNpcIds?: string[];
  },
  events: ReadonlyArray<LifeEvent>,
): SceneCompletionSnapshot {
  const acceptedSec =
    c.acceptedAt && typeof c.acceptedAt.seconds === 'number'
      ? c.acceptedAt.seconds
      : 0;
  let gradedCount = 0;
  let correctCount = 0;
  let generationCount = 0;
  let generationCorrect = 0;
  let comprehensionCount = 0;
  let comprehensionCorrect = 0;
  for (const e of events) {
    if (e.kind !== 'correction') continue;
    const ts =
      e.createdAt && typeof e.createdAt.seconds === 'number'
        ? e.createdAt.seconds
        : 0;
    if (ts < acceptedSec) continue;
    gradedCount++;
    const p = (e.payload ?? {}) as { correct?: boolean; kind?: string };
    if (p.correct === true) correctCount++;
    // LIFE-DAY-6: same pass, so a correction with no `kind` still lands in the
    // day total without inflating either type.
    if (p.kind === 'generation') {
      generationCount++;
      if (p.correct === true) generationCorrect++;
    }
    if (p.kind === 'comprehension') {
      comprehensionCount++;
      if (p.correct === true) comprehensionCorrect++;
    }
  }
  return {
    title: c.outline.title,
    premise: c.outline.premise,
    tone: c.outline.tone,
    outcomeLine: resolved.outcomeLine,
    outcomeLineNative: resolved.outcomeLineNative ?? '',
    endingKey: resolved.endingKey,
    arcStage: resolved.arcStage ?? 'continues',
    keyMomentsForArc: resolved.keyMomentsForArc ?? [],
    promotedNpcIds: resolved.promotedNpcIds ?? [],
    retiredNpcIds: resolved.retiredNpcIds ?? [],
    stats: {
      gradedCount,
      correctCount,
      generationCount,
      generationCorrect,
      comprehensionCount,
      comprehensionCorrect,
    },
    windowStartSec: acceptedSec,
  };
}

/** Decision shape for what to write back to the active scene doc
 *  after a turn lands, and whether to kick off a background replan.
 *  Pure — no side effects. */
export type ReplanPlan = {
  patch: Partial<Omit<LifeScene, 'id' | 'acceptedAt'>>;
  /** Outline to feed into runSceneReplan (already has completed
   *  beats marked if applicable). */
  outlineForReplan: SceneOutline;
  shouldReplan: boolean;
  reason: 'tick' | 'replanRequested' | 'hardPivot' | 'none';
};

export function computeReplanPlan(
  scene: LifeScene,
  signal: StepSceneSignal | undefined,
): ReplanPlan {
  const phaseTransition = signal?.phaseTransition;
  // LIFE-STORY-SHAPE-4: soft tick lowered from 10 → 5. The scene is
  // a scenario, not a script — refresh openBranches + candidate endings
  // more aggressively as the player accumulates choices.
  const tickHit = scene.turnsSinceReplan + 1 >= 5;
  const shouldReplan =
    signal?.hardPivot === true || signal?.replanRequested === true || tickHit;

  const reason: ReplanPlan['reason'] = !shouldReplan
    ? 'none'
    : signal?.hardPivot === true
      ? 'hardPivot'
      : signal?.replanRequested === true
        ? 'replanRequested'
        : 'tick';

  const patch: ReplanPlan['patch'] = {
    turnsSinceReplan: shouldReplan ? 0 : scene.turnsSinceReplan + 1,
  };
  if (phaseTransition) patch.currentPhase = phaseTransition;
  // LIFE-INTENT-2: fold the turn's leaning claim. Applied on EVERY live turn,
  // including ones that say nothing — silence is a decline, and a counter the
  // quietest responses cannot reach is not a counter.
  const leaning = nextLeaningState(
    { leaning: scene.leaning ?? '', stall: scene.leaningStall ?? 0 },
    signal,
  );
  patch.leaning = leaning.leaning;
  patch.leaningStall = leaning.stall;
  // LIFE-STORY-SHAPE-3: plot-beat completion tracking was removed —
  // the outline no longer carries a beat checklist. completedBeatIds
  // is preserved on the StepSceneSignal as backward-compat noise;
  // we read it for telemetry but no longer write status patches.
  const updatedOutline: SceneOutline = scene.outline;

  return { patch, outlineForReplan: updatedOutline, shouldReplan, reason };
}

/** LIFE-ARCH §3 / LIFE-SCENE-24: start a scene. Runs `sceneOpen` + writes the
 *  active scene doc + pre-promotes the cast it names.
 *  Throws on a hard failure; the caller decides how to surface.
 *
 *  This was `acceptSceneHook` and took the pitch the player had just accepted.
 *  Hooks are gone (LIFE-SCENE-24): a scene now starts because the world HAS no
 *  scene, and the planner builds it from world STATE — situation, cast, live
 *  fronts and dormant canon — rather than from a saga synopsis.
 *
 *  The scene index is BUMPED here, on open, whether or not generation
 *  succeeded: the rotation is a property of how many scenes the player has
 *  been through, and a fallback scene is still a scene they played. */
export async function startScene(input: {
  uid: string;
  world: LifeWorld;
}): Promise<{ sceneId: string; usedFallback: boolean }> {
  const sceneIndex = input.world.sceneCount ?? 0;
  const result = await runSceneOpen({
    world: input.world,
    cast: input.world.cast ?? [],
    fronts: input.world.fronts ?? [],
    canon: input.world.canon ?? EMPTY_CANON,
    history: input.world.sagaHistory ?? [],
    recentSubjects: input.world.recentSubjects ?? [],
    sceneIndex,
  });
  const worldId = input.world.id;
  // No hook id to key off any more; the timestamp alone is unique enough for a
  // per-world subcollection the player adds to a handful of times a day.
  const sceneId = `s-${Date.now()}`;
  await createScene({
    uid: input.uid,
    worldId,
    id: sceneId,
    outline: result.outline,
  });
  for (const npc of result.outline.keyNpcs) {
    try {
      // LIFE-NPC-6: carry the key-NPC's role onto the row as its
      // `relationship` (drives the avatar card's role line + the
      // avatar/profile prompts). Was dropped before.
      const { isNew } = await promoteOrTouchNpc({
        uid: input.uid,
        worldId,
        npcId: npc.npcId,
        name: npc.name,
        relationship: npc.role,
        sceneId,
      });
      // LIFE-NPC-6/7: key-NPCs historically NEVER kicked asset gen —
      // the biggest source of blank avatars. Generate avatar + profile
      // for each freshly-promoted one. Already-present (recurring) NPCs
      // keep their assets; the commitNode roster sweep backfills any
      // still missing.
      if (isNew) {
        void kickoffNpcAssets({
          uid: input.uid,
          world: input.world,
          npcId: npc.npcId,
          name: npc.name,
          role: npc.role,
          needsAvatar: true,
          needsProfile: true,
        });
      }
    } catch (err) {
      log.warn('life.scene.npc-prepromote-failed', {
        npcId: npc.npcId,
        err: String(err),
      });
    }
  }
  // LIFE-SCENE-2: the rotation index and the subject ledger. Both are written
  // on OPEN — `sagaHistory` is written by `sceneClose`, which can fail, and a
  // planner that cannot see the subject of a scene whose close failed will
  // happily run it again.
  await updateLifeWorld(input.uid, worldId, {
    sceneCount: sceneIndex + 1,
    recentSubjects: [
      ...(input.world.recentSubjects ?? []),
      result.outline.subject ?? result.outline.premise,
    ]
      .filter(Boolean)
      .slice(-RECENT_SUBJECTS_WINDOW),
  });
  await appendLifeEvent({
    uid: input.uid,
    worldId,
    kind: 'scene_started',
    payload: { sceneId, title: result.outline.title },
  });
  return { sceneId, usedFallback: result.usedFallback };
}

/** LIFE-SCENE-10: close-scene flow. Templated bio absorb +
 *  archive + completion event. The SceneCompleteScreen has
 *  already shown stats to the player; we just finalize. */
/**
 * Returns the arc AS UPDATED by this close — the day just completed included.
 *
 * LIFE-DAY-2.1: it used to return void, and `useChapterCompletion` then handed
 * `archiveActiveArc` its own captured `world`. That copy predates the write
 * this function just made, so the archived arc was missing the very scene that
 * had ended, and a chapter of one scene archived an EMPTY day list — which is
 * the content `LIFE-SCENE-31` promoted to be the chapter card's lead. Returning
 * the arc closes the gap without a re-read or a listener round-trip.
 */
export async function closeSceneFlow(input: {
  uid: string;
  world: LifeWorld;
  scene: LifeScene;
  snapshot: SceneCompletionSnapshot;
}): Promise<WorldArc | null> {
  const worldId = input.world.id;
  const memoryLine = `\n<completedScene title="${escapeAttr(input.snapshot.title)}" ending="${escapeAttr(input.snapshot.endingKey)}">${escapeText(input.snapshot.outcomeLine)}</completedScene>`;

  // Absorb the scene into the active arc's memory + advance NPC
  // scope. The world patch is a single write so the in-memory model
  // stays atomic.
  const worldPatch: Parameters<typeof updateLifeWorld>[2] = {
    // LIFE-SCENE-13: append the memory line, then CAP the tail. The bio
    // renders in every step prompt's stable prefix — an unbounded tail bloats
    // each turn's tokens + the world doc. Older outcomes survive in the
    // archived arcs' completedSceneMemories[] (LIFE-WORLD-ARC-2).
    bio: appendSceneMemory(input.world.bio ?? '', memoryLine),
  };
  const activeArc = input.world.currentArc ?? null;
  if (activeArc) {
    const memory = {
      sceneId: input.scene.id,
      title: input.snapshot.title,
      endingKey: input.snapshot.endingKey,
      summary: input.snapshot.outcomeLine,
      // LIFE-SCENE-35: the twin has been computed on every snapshot since
      // LIFE-SCENE-28 and dropped here. Defensible while this was only a
      // persistence record; LIFE-SCENE-31 made it the chapter card's lead
      // content and nothing came back to this line. `?? ''` and never
      // undefined — Firestore rejects undefined on a write, and a model that
      // omits the field must not take the whole close down with it.
      summaryNative: input.snapshot.outcomeLineNative ?? '',
      keyMomentsForArc: input.snapshot.keyMomentsForArc,
    };
    const nextRecurring = mergeRecurring(
      activeArc.recurringNpcIds,
      input.snapshot.promotedNpcIds,
      input.snapshot.retiredNpcIds,
    );
    const updatedArc: WorldArc = {
      ...activeArc,
      completedSceneMemories: [
        ...activeArc.completedSceneMemories,
        memory,
      ],
      recurringNpcIds: nextRecurring,
    };
    worldPatch.currentArc = updatedArc;
  }

  await updateLifeWorld(input.uid, worldId, worldPatch);
  await archiveScene(input.uid, worldId, 'completed');
  // LIFE-DAY-2.1: captured here, where the updated arc is in hand.
  const closedArc = worldPatch.currentArc ?? null;

  // LIFE-NPC-RECUR-*: promote scene NPCs to world scope; retire
  // world NPCs to transient. The roster filter in the prompt picks
  // these up on the next turn.
  for (const npcId of input.snapshot.promotedNpcIds) {
    try {
      await promoteNpcToWorld(input.uid, worldId, npcId);
      await appendLifeEvent({
        uid: input.uid,
        worldId,
        kind: 'npc_promoted_world',
        payload: { npcId },
      });
    } catch (err) {
      log.warn('life.npc.promote-world-failed', { npcId, err: String(err) });
    }
  }
  for (const npcId of input.snapshot.retiredNpcIds) {
    try {
      await retireNpcToTransient(input.uid, worldId, npcId);
      await appendLifeEvent({
        uid: input.uid,
        worldId,
        kind: 'npc_retiring',
        payload: { npcId },
      });
    } catch (err) {
      log.warn('life.npc.retire-failed', { npcId, err: String(err) });
    }
  }

  await appendLifeEvent({
    uid: input.uid,
    worldId,
    kind: 'scene_completed',
    payload: {
      sceneId: input.scene.id,
      title: input.snapshot.title,
      endingKey: input.snapshot.endingKey,
    },
  });
  return closedArc;
}

/** LIFE-NPC-RECUR-*: merge promotion + retirement into the existing
 *  recurring list. Retired ids are removed; promoted ids are added
 *  (deduped). Cap of 8 is SOFT — we don't evict here; the SI nudges
 *  the model to favour retirement once the list grows past 8. */
function mergeRecurring(
  existing: string[],
  promoted: string[],
  retired: string[],
): string[] {
  const retire = new Set(retired);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...existing, ...promoted]) {
    if (retire.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** LIFE-WORLD-ARC-*: resolve the names of recurring NPCs from the
 *  active arc's id list against the on-device roster. Used by the
 *  WorldArcCompleteScreen to render "you'll see again: ..." line. */
export function resolveRecurringNames(
  ids: ReadonlyArray<string>,
  roster: ReadonlyMap<string, { name: string }>,
): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const npc = roster.get(id);
    if (npc) out.push(npc.name);
  }
  return out;
}

/** LIFE-WORLD-ARC-1: archive the active worldArc. Called when the
 *  player taps "Continue your wurld" or "Pause for now" after a
 *  scene resolves with arcStage: 'concluding'. The arc's
 *  outcomeLine is set to the resolving scene's outcome.
 *
 *  Clean-break data model (LIFE-DATA-*): the resolved arc is written
 *  to the `completedArcs/{arcId}` SUBcollection (one doc per chapter),
 *  and the world doc gets ONLY the incremented `completedArcCount`
 *  scalar + `currentArc: null` — never an unbounded inline array. */
export async function archiveActiveArc(input: {
  uid: string;
  world: LifeWorld;
  snapshot: SceneCompletionSnapshot;
}): Promise<WorldArc | null> {
  const active = input.world.currentArc;
  if (!active) return null;
  const resolved: WorldArc = {
    ...active,
    status: 'completed',
    outcomeLine: input.snapshot.outcomeLine,
  };
  await appendCompletedArc(input.uid, input.world.id, resolved);
  await updateLifeWorld(input.uid, input.world.id, {
    currentArc: null,
    completedArcCount: (input.world.completedArcCount ?? 0) + 1,
  });
  await appendLifeEvent({
    uid: input.uid,
    worldId: input.world.id,
    kind: 'world_arc_completed',
    payload: {
      chapterNumber: resolved.chapterNumber,
      premise: resolved.premise,
      outcomeLine: resolved.outcomeLine ?? '',
    },
  });
  return resolved;
}

/** Apply the per-response patch in the background. Caller doesn't
 *  await — the scene doc is updated optimistically. */
export function fireBackgroundScenePatch(
  uid: string,
  worldId: string,
  patch: ReplanPlan['patch'],
): void {
  void updateActiveScene(uid, worldId, patch).catch((err) => {
    log.warn('life.scene.patch-failed', { err: String(err) });
  });
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
  );
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
