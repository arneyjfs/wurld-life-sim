/**
 * SRV-PROMPT-8..13 batch 8 — the `life_step` promptSpec, built at the call site.
 *
 * `src/lib/life/prompts/step.ts` used to take a `LifeWorld`, a `LifeEvent[]`, a
 * `LifeScene` and a `LifeNpc[]` and render ~14 kB of XML from them. The prompt
 * is now `functions/src/prompts/lifeStep.ts`; this is the narrowing that feeds
 * it, and it is the ONLY place that knows which fields of those four documents
 * the prompt has ever read.
 *
 * ── WHAT IS RESOLVED HERE, AND WHY IT IS NOT MORE ───────────────────────────
 *
 * Three values, and each is resolved here for the same reason: it reduces state
 * the prompt never reads, and ENGINE code that never migrates reads the same
 * answer, so moving the reduction would DUPLICATE it rather than move it.
 *
 *   · `canon`                     ← `resolveCanon(world, npcs)`
 *                                   also read by `validateNodeResponse`
 *   · `goalLadder.saga.daysLeft`  ← `daysLeft(ladder)`
 *                                   also read by the goal chrome
 *   · `goalLadder.blocked`        ← `exposureReason(objective, worldFactsFor(…))`
 *                                   also read by `clearingMove` for the grid
 *
 * Everything else the prompt derives, it derives SERVER-side from the rows it
 * is given — the cadence streaks, the recently-practised targets, the action
 * shapes, the canon working set. Sending those as well would be a caller
 * claiming a streak its own events contradict (batch 7's rule 2).
 *
 * ⚠ `createdAtMs` is the one shape change in the whole payload: a Firestore
 * `Timestamp` does not survive JSON, and `recentlyPracticedTargets` is the only
 * reader (it drops targets practised before this chapter began).
 */
import type {
  LifeStepArc,
  LifeStepCanon,
  LifeStepCanonEntry,
  LifeStepEvent,
  LifeStepGoalLadder,
  LifeStepNpc,
  LifeStepPromptSpec,
  LifeStepScene,
  LifeStepStory,
  LifeStepUniverse,
  StepViolation,
} from '@/lib/practicePromptSpec';
import type { LifeEvent, LifeNpc, LifeScene, LifeWorld } from '@/types/firestore';
import type { WorldCanon } from '@/types/lifeNarrative';
import { resolveCanon } from './canon';
import { daysLeft, exposureReason, worldFactsFor } from './goalLadder';

export type StepSpecTurn = {
  isOpeningBeat: boolean;
  requestKind: 'live' | 'options';
  currentNodeKind?: 'branch' | 'continuation' | null;
  choice?: LifeStepPromptSpec['choice'] | null;
  freeText?: string | null;
  practiceOutcome?: LifeStepPromptSpec['practiceOutcome'] | null;
};

/** A Firestore `Timestamp`-ish, read without importing the SDK type. */
function millis(v: unknown): number | null {
  return v && typeof v === 'object' && 'toMillis' in v &&
    typeof (v as { toMillis: unknown }).toMillis === 'function'
    ? (v as { toMillis: () => number }).toMillis()
    : null;
}

const entries = (canon: WorldCanon[keyof WorldCanon]): LifeStepCanonEntry[] =>
  canon.map((e) => ({
    id: e.id,
    name: e.name,
    ...(e.kind ? { kind: e.kind } : {}),
    ...(e.note ? { note: e.note } : {}),
    ...(e.canSpeak === false ? { canSpeak: false as const } : {}),
  }));

function canonSpec(canon: WorldCanon): LifeStepCanon {
  return {
    characters: entries(canon.characters),
    places: entries(canon.places),
    objects: entries(canon.objects),
    facts: entries(canon.facts),
  };
}

function storySpec(world: LifeWorld): LifeStepStory {
  return {
    ...(world.situation ? { situation: world.situation } : {}),
    fronts: (world.fronts ?? []).map((f) => ({
      driverId: f.driverId,
      agenda: f.agenda,
      // `null` is a VALUE here, read by the live filter — the batch-6 rule.
      resolved: f.resolved ?? null,
    })),
    cast: (world.cast ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      voice: c.voice,
      standing: c.standing,
      tier: c.tier,
      known: c.known,
      ...(c.wants ? { wants: c.wants } : {}),
      ...(c.nextMove ? { nextMove: c.nextMove } : {}),
      ...(c.limit ? { limit: c.limit } : {}),
      ...(c.routine ? { routine: c.routine } : {}),
      // LIFE-FRONT-1.1 — `clock` does NOT travel, and neither does `wrongAbout`.
      // Rebuilt field by field for the reason batch 6 recorded: a top-level
      // spread would let both ride along on a prompt that must not see them.
      ties: (c.ties ?? []).map((t) => ({ id: t.id, how: t.how })),
    })),
  };
}

function universeSpec(world: LifeWorld): LifeStepUniverse | null {
  const u = world.universe;
  if (!u) return null;
  return {
    setting: u.setting,
    era: u.era,
    laws: [...u.laws],
    places: [...u.places],
    figures: u.figures.map((f) => ({ name: f.name, what: f.what })),
  };
}

function npcSpec(npcs: ReadonlyArray<LifeNpc>): LifeStepNpc[] {
  return npcs.map((n) => ({
    id: n.id,
    name: n.name,
    ...(n.relationship ? { relationship: n.relationship } : {}),
    ...(n.oneLineMemory ? { oneLineMemory: n.oneLineMemory } : {}),
    ...(n.scope ? { scope: n.scope } : {}),
    ...(n.sceneId ? { sceneId: n.sceneId } : {}),
  }));
}

function arcSpec(world: LifeWorld): LifeStepArc | null {
  const arc = world.currentArc;
  if (!arc) return null;
  return {
    chapterNumber: arc.chapterNumber,
    premise: arc.premise,
    themes: [...arc.themes],
    recurringNpcIds: [...arc.recurringNpcIds],
    completedSceneMemories: arc.completedSceneMemories.map((m) => ({
      title: m.title,
      summary: m.summary,
    })),
  };
}

function sceneSpec(scene: LifeScene | null | undefined): LifeStepScene | null {
  if (!scene) return null;
  const o = scene.outline;
  return {
    id: scene.id,
    currentPhase: scene.currentPhase,
    turnsSinceReplan: scene.turnsSinceReplan,
    ...(scene.leaning ? { leaning: scene.leaning } : {}),
    ...(typeof scene.leaningStall === 'number' ? { leaningStall: scene.leaningStall } : {}),
    outline: {
      title: o.title,
      premise: o.premise,
      tone: o.tone,
      ...(o.subject ? { subject: o.subject } : {}),
      ...(o.where ? { where: o.where } : {}),
      ...(o.openQuestion ? { openQuestion: o.openQuestion } : {}),
      practiceFocus: [...o.practiceFocus],
      keyNpcs: o.keyNpcs.map((n) => ({ npcId: n.npcId, name: n.name, role: n.role })),
    },
  };
}

function goalSpec(
  world: LifeWorld,
  npcs: ReadonlyArray<LifeNpc>,
): LifeStepGoalLadder | null {
  const ladder = world.goalLadder;
  if (!ladder) return null;
  const objective = ladder.objective ?? null;
  // Resolved here — see the file header for why the FACTS do not travel.
  const blocked = objective
    ? exposureReason(
        { id: objective.id, text: objective.text, need: objective.need ?? null },
        worldFactsFor(world, npcs),
      )
    : null;
  return {
    ...(ladder.saga
      ? {
          saga: {
            text: ladder.saga.text,
            when: ladder.saga.when,
            daysLeft:
              daysLeft({
                saga: ladder.saga,
                objective: null,
                done: [],
                dayIndex: ladder.dayIndex ?? 0,
              }) ?? 0,
          },
        }
      : {}),
    ...(objective
      ? {
          objective: {
            text: objective.text,
            ...(objective.need ? { need: { name: objective.need.name } } : {}),
          },
        }
      : {}),
    done: (ladder.done ?? []).map((d) => ({
      how: d.how,
      text: d.text,
      ...(d.because ? { because: d.because } : {}),
    })),
    ...(blocked ? { blocked } : {}),
  };
}

function eventSpec(events: ReadonlyArray<LifeEvent>): LifeStepEvent[] {
  return events.map((e) => ({
    kind: e.kind,
    ...(e.payload ? { payload: e.payload } : {}),
    createdAtMs: millis(e.createdAt),
  }));
}

/** Build the `life_step` spec for one turn. `retry` is absent on attempt 1. */
export function buildLifeStepSpec(input: {
  world: LifeWorld;
  events: ReadonlyArray<LifeEvent>;
  npcs: ReadonlyArray<LifeNpc>;
  scene?: LifeScene | null;
  turn: StepSpecTurn;
  turnIndex?: number;
  retry?: readonly StepViolation[];
}): LifeStepPromptSpec {
  const { world, events, npcs, scene, turn } = input;
  const log = world.storyLog;
  return {
    kind: 'life_step',
    practiceLanguage: world.practiceLanguage,
    nativeLanguage: world.nativeLanguage,
    // LIFE-LANG-7 — legacy worlds fall back to native. Applied HERE so the
    // server never re-applies a default the client already applied, which is
    // the rule batch 5's harness seam had to learn twice.
    systemLanguage: world.systemLanguage ?? world.nativeLanguage,
    difficulty: world.difficulty,
    characterName: world.characterName,
    worldSeedKey: world.worldSeedKey,
    ...(world.worldSeedText ? { worldSeedText: world.worldSeedText } : {}),
    ...(world.bio ? { bio: world.bio } : {}),
    universe: universeSpec(world),
    story: storySpec(world),
    canon: canonSpec(resolveCanon(world, npcs)),
    npcs: npcSpec(npcs),
    recurringNpcIds: [...(world.currentArc?.recurringNpcIds ?? [])],
    chapterNumber: world.currentArc?.chapterNumber ?? 1,
    // `turns` excludes pre-authored resolution arrivals and `entries.length`
    // does not; the pace rules are written in the first (LIFE-ARC-PACE-1).
    chapterTurns: log?.turns ?? log?.entries.length ?? 0,
    chapterStartedAtMs: millis(world.currentArc?.startedAt),
    sceneTurns: log?.sceneTurns ?? 0,
    storyLogEntries: [...(log?.entries ?? [])],
    arc: arcSpec(world),
    scene: sceneSpec(scene),
    ...(world.currentLocationLabel
      ? { currentLocationLabel: world.currentLocationLabel }
      : {}),
    goalLadder: goalSpec(world, npcs),
    ...(typeof world.timeOfDay === 'string' ? { timeOfDay: world.timeOfDay } : {}),
    ...(input.turnIndex !== undefined ? { turnIndex: input.turnIndex } : {}),
    events: eventSpec(events),
    requestKind: turn.requestKind,
    ...(turn.currentNodeKind ? { currentNodeKind: turn.currentNodeKind } : {}),
    isOpeningBeat: turn.isOpeningBeat,
    ...(turn.choice ? { choice: turn.choice } : {}),
    ...(turn.freeText ? { freeText: turn.freeText } : {}),
    ...(turn.practiceOutcome ? { practiceOutcome: turn.practiceOutcome } : {}),
    ...(input.retry && input.retry.length > 0 ? { retry: [...input.retry] } : {}),
  };
}
