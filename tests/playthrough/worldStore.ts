/**
 * THE IN-MEMORY WORLD — a Firestore stand-in, and the only thing in the harness
 * that reimplements app behaviour.
 *
 * Every life GENERATOR is pure and gets called for real (see `transport.ts`).
 * `commitNode` is the exception: it folds a generated node into Firestore across
 * ~13 call sites. Mocking those individually would be more code and more drift
 * than folding the same state in memory, so this does the fold — using the SAME
 * pure helpers `commitNode` itself imports (`applyIntroductions`, `capStoryLog`,
 * `advanceTimeOfDay`, `npcIdFor`), so the two cannot diverge on the parts that
 * matter.
 *
 * WHAT IT MAINTAINS is exactly what the turn prompt reads back —
 * `buildLifeStepPrompt` touches `world`, `world.storyLog`, `world.timeOfDay`,
 * `events`, `npcs` and `scene`, and nothing else. State the prompt never reads
 * is state that cannot affect what the player sees, so it is not modelled.
 *
 * The counters are copied from `commitNode` deliberately and precisely:
 * `turns` is NOT `entries.length` (LIFE-ARC-PACE-1), and `sceneTurns` resets on
 * the scene CHANGING rather than on resolve (LIFE-ARC-PACE-4). Both drive the
 * pace blocks the model reads, so getting them wrong would mis-pace every scene
 * and read as a pacing defect in the score.
 */
import { EMPTY_CANON, applyIntroductions } from '@/lib/life/canon';
import { advanceTimeOfDay, readTimeAdvance, readTimeOfDay } from '@/lib/life/timeOfDay';
import { npcIdFor } from '@/lib/life/npcs';
import {
  applyLadderDelta, EMPTY_LADDER, worldFactsFor, type GoalLadder,
} from '@/lib/life/goalLadder';
import { isRestatedQuestion, nextLeaningState, type LeaningSignal } from '@/lib/life/sceneLeaning';
import type { LifeEvent, LifeNpc, LifeScene, LifeWorld, SceneOutline } from '@/types/firestore';
import type { WorldCanon } from '@/types/lifeNarrative';

/** Mirrors `capStoryLog`'s ceiling; the helper is not exported. */
const STORY_LOG_CAP = 40;

export type NodeLike = {
  kind?: string;
  beats?: { speaker: string; speakerName?: string; npcId?: string; practiceText: string; nativeText: string }[];
  options?: unknown[];
  logLine?: string;
  introduces?: { kind: string; name: string; id?: string; note?: string; subKind?: string; canSpeak?: boolean }[];
  worldDelta?: {
    timeAdvance?: 'none' | 'some' | 'lots' | 'nextMorning';
    currentLocationLabel?: string;
    objectiveDone?: boolean;
    objectiveClosed?: string | null;
    nextObjective?: string | null;
    nextObjectiveNeed?: string | null;
  };
  scene?: { resolved?: { endingKey: string; outcomeLine: string } | null };
};

export class WorldStore {
  world: LifeWorld;
  events: LifeEvent[] = [];
  npcs: LifeNpc[] = [];
  scene: LifeScene | null = null;
  canon: WorldCanon = EMPTY_CANON;

  private seq = 0;

  constructor(world: LifeWorld) {
    this.world = world;
  }

  /** The world as the generators want it — canon lives on the doc. */
  get worldDoc(): LifeWorld {
    return { ...this.world, canon: this.canon } as LifeWorld;
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  openScene(outline: SceneOutline, sceneId: string): void {
    this.scene = {
      id: sceneId,
      status: 'active',
      outline,
      currentPhase: 'opening',
      turnsSinceReplan: 0,
    } as LifeScene;
    this.events.push({ id: this.id('e'), kind: 'scene_started', payload: { sceneId, title: outline.title } });
    // Pre-promote the cast the scene named, as `startScene` does.
    for (const n of outline.keyNpcs) this.touchNpc(n.npcId, n.name, n.role, sceneId);
  }

  /**
   * LIFE-INTENT-2: fold a turn's leaning claim into the scene, the way
   * `computeReplanPlan` does in the app. Also RECORDS each claim, because
   * "how often did a pick actually move the scene" is the measurement this
   * whole mechanism exists to produce — and unlike INTENT's judged score it is
   * a number the model cannot talk its way around.
   */
  applyLeaning(signal: LeaningSignal): void {
    if (!this.scene) return;
    const before = { leaning: this.scene.leaning ?? '', stall: this.scene.leaningStall ?? 0 };
    const after = nextLeaningState(before, signal);
    // LIFE-INTENT-3: record WHY a claimed move did not count. Without this a
    // rejected restated-question is indistinguishable from a turn the model
    // honestly said was quiet, and the two want opposite fixes.
    const claimed = signal?.leaning?.trim() ?? '';
    this.leaningClaims.push({
      moved: after.stall === 0,
      stall: after.stall,
      leaning: after.leaning,
      restatedQuestion: signal?.leaningMoved === true && isRestatedQuestion(claimed),
    });
    this.scene = { ...this.scene, leaning: after.leaning, leaningStall: after.stall };
  }

  /** Per-turn leaning history for the whole run, oldest first. */
  readonly leaningClaims: Array<{
    moved: boolean; stall: number; leaning: string; restatedQuestion: boolean;
  }> = [];

  touchNpc(rawId: string, name: string, relationship: string, sceneId: string | null): void {
    const id = npcIdFor(rawId || name);
    if (this.npcs.some((n) => n.id === id)) return;
    this.npcs.push({
      id, name, relationship, sceneId, avatarStatus: 'pending',
    } as unknown as LifeNpc);
  }

  /**
   * Fold one generated node into state — the `commitNode` equivalent.
   *
   * `countsAsTurn` mirrors the app: a live branch/continuation node is a turn;
   * a question node's pre-authored resolution is not a second one.
   */
  commit(node: NodeLike, opts: { countsAsTurn: boolean; choiceText?: string; actionType?: string; targetId?: string | null }): void {
    for (const b of node.beats ?? []) {
      if (b.speaker === 'npc' && b.speakerName) {
        this.touchNpc(b.npcId ?? b.speakerName, b.speakerName, 'met in a scene', this.scene?.id ?? null);
      }
      this.events.push({
        id: this.id('e'),
        kind: 'beat',
        payload: { speaker: b.speaker, speakerName: b.speakerName, practiceText: b.practiceText, nativeText: b.nativeText },
      });
    }
    if (opts.choiceText) {
      this.events.push({
        id: this.id('e'),
        kind: 'decision',
        payload: {
          choiceId: 'c', text: opts.choiceText,
          ...(opts.actionType ? { actionType: opts.actionType } : {}),
          ...(opts.targetId ? { targetId: opts.targetId } : {}),
        },
      });
    }

    const chapter = this.world.currentArc?.chapterNumber;
    const grown = applyIntroductions(
      this.canon,
      (node.introduces ?? []) as Parameters<typeof applyIntroductions>[1],
      chapter,
    );
    if (grown) this.canon = grown;

    // `!== 'none'` exactly as `commitNode` tests it. `readTimeAdvance` returns
    // the STRING 'none', which is truthy — so a bare `if (advance)` rebuilt the
    // world on every turn to write back the same hour. Harmless here only
    // because `advanceTimeOfDay(t, 'none')` steps by zero.
    const advance = readTimeAdvance(node.worldDelta?.timeAdvance);
    if (advance !== 'none') {
      this.world = {
        ...this.world,
        timeOfDay: advanceTimeOfDay(readTimeOfDay(this.world.timeOfDay), advance),
      };
    }
    if (node.worldDelta?.currentLocationLabel) {
      this.world = { ...this.world, currentLocationLabel: node.worldDelta.currentLocationLabel };
    }
    // LIFE-GOAL-3/4 — the ladder, applied through the SAME reducer the app
    // uses. That is the point: the harness must not have its own opinion about
    // when an objective survives, or the conformance runs would measure the
    // harness rather than the engine. The predecessor of this block merged
    // `addGoals` / `removeGoals`, a field the model authored 0 times in 95
    // measured turns.
    const before: GoalLadder = {
      ...EMPTY_LADDER,
      ...(this.world.goalLadder ?? {}),
      done: this.world.goalLadder?.done ?? [],
      dayIndex: this.world.goalLadder?.dayIndex ?? 0,
    };
    const after = applyLadderDelta(
      before,
      {
        objectiveDone: node.worldDelta?.objectiveDone,
        objectiveClosed: node.worldDelta?.objectiveClosed,
        nextObjective: node.worldDelta?.nextObjective,
        nextObjectiveNeed: node.worldDelta?.nextObjectiveNeed,
      },
      worldFactsFor(this.world, this.npcs),
      { advance: node.worldDelta?.timeAdvance, newId: `obj-${before.done.length}` },
    );
    this.world = { ...this.world, goalLadder: after };

    const line = node.logLine?.trim();
    const isTurn = opts.countsAsTurn;
    if (line || isTurn) {
      const prev = this.world.storyLog ?? null;
      const fresh = !prev || (chapter !== undefined && prev.chapterNumber !== chapter);
      const prevTurns = fresh ? 0 : (prev.turns ?? prev.entries.length);
      const sceneId = this.scene?.id ?? null;
      const sceneChanged = fresh || (prev?.sceneId ?? null) !== sceneId;
      const prevSceneTurns = sceneChanged ? 0 : (prev?.sceneTurns ?? 0);
      const entries = [...(fresh ? [] : prev!.entries), ...(line ? [line] : [])];
      this.world = {
        ...this.world,
        storyLog: {
          chapterNumber: chapter ?? prev?.chapterNumber ?? 1,
          entries: entries.slice(-STORY_LOG_CAP),
          turns: prevTurns + (isTurn ? 1 : 0),
          sceneTurns: prevSceneTurns + (isTurn ? 1 : 0),
          sceneId,
        },
      };
    }
    if (this.scene) {
      this.scene = { ...this.scene, turnsSinceReplan: this.scene.turnsSinceReplan + 1 };
    }
  }

  /**
   * LIFE-NPC-MEM-1: fold per-NPC memory into the roster, as `writeNpcMemories`
   * does — roster-guarded, empties dropped.
   *
   * This was DROPPED ENTIRELY, so `<npcMemory>` rendered empty on every turn of
   * every playthrough and no character ever accumulated a history with the
   * player. The prompt's own words for it are "the one-line story so far,
   * shown in the <npcMemory> block every future turn", which makes it a prime
   * input to exactly the dimensions that were scoring worst — CHARACTER,
   * CAST-DEPTH and COHERENCE.
   *
   * It is also, precisely, the defect `tsconfig.tests.json` records from the
   * life-cost harness: NPC memory never reaching a harness prompt. That one
   * mis-declared the field name; this one never wrote it at all.
   */
  applyNpcMemories(updates: ReadonlyArray<{ npcId: string; oneLineMemory: string }>): void {
    if (updates.length === 0) return;
    const known = new Set(this.npcs.map((n) => n.id));
    for (const m of updates) {
      const line = m.oneLineMemory.trim();
      if (!line || !known.has(m.npcId)) continue;
      this.npcs = this.npcs.map((n) =>
        n.id === m.npcId ? ({ ...n, oneLineMemory: line } as LifeNpc) : n);
    }
  }

  /**
   * A graded question that has been answered — ONE event per outcome, of ANY
   * kind, exactly as `commitNode` writes it.
   *
   * OF ANY KIND is the whole point. This first recorded only fill-blanks, and
   * two separate mechanisms silently broke:
   *
   *  - `cyoaStreak` walks back to the most recent `correction` and counts the
   *    decisions after it. With comprehensions unrecorded, the streak never
   *    reset after one, so `cadenceTier` stayed `forced` and the model was told
   *    "THIS node is the question" on turn after turn. Measured: 6 questions in
   *    8 turns, against a 1-in-2-to-1-in-3 design target.
   *  - the kind rotation (`gradedSlotIndex`, LIFE-EX-CADENCE-4) counted the
   *    same events to alternate fill-blank with comprehension. Advancing it on
   *    only one kind pinned the rotation, which is precisely the failure that
   *    rotation existed to prevent. That rotation is now deleted
   *    (LIFE-EX-18) — but `gradedOrdinal`, which drives the RENDER variant, is
   *    still a count over these same events, so recording both kinds is still
   *    load-bearing for exactly the same reason.
   *
   * `recentGenerationTargets` filters on `payload.kind === 'generation'`, so a
   * comprehension entry is invisible to it and the fresh-target rule is
   * unaffected — which is why the fill-blank-only version looked correct.
   */
  recordCorrection(kind: string, correctAnswer: string | null): void {
    this.events.push({
      id: this.id('e'),
      kind: 'correction',
      payload: {
        kind,
        correct: true,
        ...(correctAnswer ? { correctAnswer } : {}),
        promptSource: 'model',
      },
    } as unknown as LifeEvent);
  }

  /** Turns elapsed in the current scene — what `<scenePace>` reads. */
  get sceneTurns(): number {
    return this.world.storyLog?.sceneTurns ?? 0;
  }

  get chapterTurns(): number {
    return this.world.storyLog?.turns ?? 0;
  }
}
