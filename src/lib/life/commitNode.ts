/**
 * LIFE-NODE-3: ALL Firestore writes for a node land here, at
 * arrival time (cached pick or live landing). Previews are never
 * persisted — nothing from a lookahead touches Firestore until the
 * player picks it.
 *
 * Write order (carries LIFE-STEP-5 forward):
 *   1. The action event — decision (chip / ✏️ free text) or
 *      correction (practice outcome). 'none' writes nothing.
 *   2. Per beat: NPC promotion (+ npc_introduced event + avatar
 *      kickoff on first sighting) then the beat event.
 *   3. currentBackdrop patch from node.backdropIntent.
 *
 * Turn-level signals (worldDelta, scene) are NOT committed here —
 * they apply when the generating response lands (applyTurnSignals +
 * the scene lifecycle paths in useNodeEngine).
 *
 * Spec: docs/specs/life-sim.md §10.46 (LIFE-NODE-3).
 */
import * as log from '../log';
import { EMPTY_CANON, applyIntroductions } from './canon';
import { castArchetypes } from './cast';
import {
  applyFelt,
  applyLadderDelta,
  EMPTY_LADDER,
  worldFactsFor,
  type GoalLadder,
} from './goalLadder';
import { advanceTimeOfDay, readTimeAdvance, readTimeOfDay } from './timeOfDay';
import { buildBeatRepairContext, normalizeBeats } from './beatRepair';
import {
  appendBeatEvent,
  appendDecisionEvent,
  appendLifeEvent,
  updateLifeWorld,
} from './world';
import {
  promoteOrTouchNpc,
  setNpcAvatar,
  setNpcAvatarFailed,
  setNpcDescription,
  setNpcStanding,
  writeNpcMemories,
} from './npcs';
import { resolveNpcRole } from './npcRole';
import { generateNpcAvatar, svgToDataUri, type NpcAvatarGenResult } from './generateNpcAvatar';
import { generateNpcProfile } from './generateNpcProfile';
import { writeCharacterAvatar } from './lifeAvatarAssets';
import { lifeDebug } from './debugLog';
import { WRITE_YOUR_OWN_ID, type Felt, type NpcMemoryUpdate, type BackdropIntent, type StepIntroduction, type WorldDelta } from './stepSchema';
import type { PracticeOutcome } from './generateStepOptions';
import type { LifeBeatPayload, LifeNpc, LifeWorld } from '@/types/firestore';

/** What the player did to arrive at the node being committed. */
export type CommitAction =
  | {
      kind: 'choice';
      choiceId: string;
      text: string;
      /** LIFE-GRID-4: the picked option's `actionType`, persisted on the
       *  decision event so `actionShapesFromEvents` can rebuild the grid's
       *  cross-turn memory after a reload. Optional — the offered SETS are not
       *  in the log, so this is the only action history there is. */
      actionType?: string;
      targetId?: string | null;
    }
  | {
      kind: 'free-text';
      text: string;
      /** LIFE-REP-5: the person this turn is invested in — set ONLY by the
       *  `LIFE-NEED-5` clearing chip on a `who` block. Code guarantees the
       *  step; see the note at the `applyFelt` call. */
      investIn?: string | null;
    }
  | { kind: 'practice-outcome'; outcome: PracticeOutcome }
  | { kind: 'none' };

export type CommitNodeInput = {
  uid: string;
  world: LifeWorld;
  /** Active scene id — scopes newly-introduced NPCs
   *  (LIFE-SCENE-8). Null in idle mode. */
  sceneId: string | null;
  action: CommitAction;
  /** The node's beats (empty for question nodes — their bubble
   *  lands at practice resolution). `user`-speaker beats are legal
   *  here: the resolved practice bubble commits through this path. */
  beats: ReadonlyArray<LifeBeatPayload>;
  /** LIFE-NPC-6: the PRE-turn NPC roster. Swept after promotion to
   *  backfill avatars/descriptions for rows created before assets were
   *  required (or scene key-NPCs whose gen never fired). Optional —
   *  the sweep no-ops when absent. Excludes this-turn's just-promoted
   *  NPCs (they're kicked inline), so there's no double-fire. */
  npcs?: ReadonlyArray<LifeNpc>;
  backdropIntent?: BackdropIntent | null;
  /** LIFE-CANON-1: entities this turn declared — folds this-turn canSpeak:false
   *  into the mute set so a same-turn introduce+speak is still narrated. */
  introduces?: ReadonlyArray<StepIntroduction>;
};

export async function commitNode(input: CommitNodeInput): Promise<void> {
  const worldId = input.world.id;

  // 1. Action event FIRST (LIFE-STEP-5 ordering).
  if (input.action.kind === 'practice-outcome') {
    const o = input.action.outcome;
    await appendLifeEvent({
      uid: input.uid,
      worldId,
      kind: 'correction',
      payload: {
        kind: o.kind,
        correct: o.correct,
        picked: o.picked,
        correctAnswer: o.correctAnswer,
        // LIFE-VOCAB-RECAP-7: spread-when-present. Firestore rejects an
        // `undefined` field value outright, and writing `null` would be
        // indistinguishable from "we looked and found nothing" — which is
        // what a missing key already says.
        ...(o.correctAnswerNative?.trim()
          ? { correctAnswerNative: o.correctAnswerNative.trim() }
          : {}),
        promptSource: o.promptSource,
      },
    });
  } else if (input.action.kind === 'choice') {
    await appendDecisionEvent(input.uid, worldId, {
      choiceId: input.action.choiceId,
      text: input.action.text,
      ...(input.action.actionType ? { actionType: input.action.actionType } : {}),
      ...(input.action.targetId ? { targetId: input.action.targetId } : {}),
    });
  } else if (input.action.kind === 'free-text') {
    await appendDecisionEvent(input.uid, worldId, {
      choiceId: WRITE_YOUR_OWN_ID,
      text: input.action.text,
    });
  }

  // LIFE-NPC-2 (player-side): lazily generate the player's own
  // avatar. Fire-and-forget; never blocks the commit. The bytes now
  // live in the assets/character sidecar (LIFE-DATA-1) — the hot world
  // doc carries only `characterAvatarStatus`.
  //
  // LIFE-FAIL-9: fire on a null status (never attempted) OR a stale
  // 'pending' whose gen died mid-flight. The old `== null` gate never
  // re-fired, so a reload/navigation that stranded the world on
  // `characterAvatarStatus: 'pending'` (status written, gen abandoned
  // before it settled) left the user's avatar slot shimmering FOREVER —
  // no retry could reach it. The module-level `inFlightPlayerAvatar`
  // guard (added synchronously below, before the first await) dedups a
  // genuinely in-flight gen THIS session, so a live-but-slow gen is never
  // double-fired; 'ready'/'failed' are terminal and skip.
  const playerAvatarStatus = input.world.characterAvatarStatus;
  if (
    (playerAvatarStatus == null || playerAvatarStatus === 'pending') &&
    !inFlightPlayerAvatar.has(worldId)
  ) {
    inFlightPlayerAvatar.add(worldId);
    void kickoffPlayerAvatarGen({
      uid: input.uid,
      worldId,
      characterName: input.world.characterName,
      worldVibe: pickWorldVibe(input.world),
    }).finally(() => inFlightPlayerAvatar.delete(worldId));
  }

  // 2. LIFE-NPC-1: NPC promotion + beat events, interleaved so the promotion
  // precedes the beat that introduces the NPC. The Set dedups an NPC appearing
  // in both beats of one node.
  //
  // LIFE-BEAT-REPAIR: normalise every beat (attribution strip + re-attribution,
  // mute→narrator, speaker-name/id correction) through the ONE shared path.
  // The live render + overlay already normalise at the arrival boundary
  // (`arriveAtNode`), so here this is an idempotent safety net for the other
  // caller (practice resolution) — no LLM call, no retry, no cost.
  const beats = normalizeBeats(
    input.beats,
    buildBeatRepairContext(input.world, input.npcs ?? [], input.introduces ?? []),
  ).map(coherentAttribution);

  const seenNpcs = new Set<string>();
  for (const beat of beats) {
    if (beat.speaker === 'npc' && beat.npcId && beat.speakerName) {
      if (!seenNpcs.has(beat.npcId)) {
        seenNpcs.add(beat.npcId);
        try {
          // LIFE-NPC-8: work out who they ARE before their assets are drawn.
          // This call used to pass a name and nothing else, so the profile
          // prompt emitted no <role> and the model invented one — a florist
          // rendering as "your formidable vocal coach". LIFE-NPC-6 fixed the
          // same omission on the scene path and never reached this one,
          // which is where most NPCs are actually born.
          const resolvedRole = resolveNpcRole({
            npcId: beat.npcId,
            name: beat.speakerName,
            introduces: input.introduces,
            keyArchetypes: castArchetypes(input.world.cast),
          });
          const { isNew } = await promoteOrTouchNpc({
            uid: input.uid,
            worldId,
            npcId: beat.npcId,
            name: beat.speakerName,
            ...(resolvedRole.relationship
              ? { relationship: resolvedRole.relationship }
              : {}),
            sceneId: input.sceneId,
          });
          if (isNew) {
            await appendLifeEvent({
              uid: input.uid,
              worldId,
              kind: 'npc_introduced',
              payload: { npcId: beat.npcId, name: beat.speakerName },
            });
            // LIFE-NPC-6/7: a fresh NPC needs BOTH assets.
            void kickoffNpcAssets({
              uid: input.uid,
              world: input.world,
              npcId: beat.npcId,
              name: beat.speakerName,
              role: resolvedRole.relationship,
              archetype: resolvedRole.archetype,
              needsAvatar: true,
              needsProfile: true,
            });
          }
        } catch (err) {
          log.warn('life.commit.npc-promote-failed', {
            npcId: beat.npcId,
            err: String(err),
          });
        }
      }
    }
    await appendBeatEvent(input.uid, worldId, { ...beat });
  }

  // LIFE-NPC-6/7: sweep the pre-turn roster for rows missing assets —
  // avatars never generated (legacy NPCs, scene key-NPCs), or
  // descriptions never written. Fire-and-forget; the sweep excludes
  // this-turn's just-promoted NPCs (not in input.npcs yet), so no
  // double-fire. 'failed' avatars are respected (LIFE-FAIL-5) and never
  // re-kicked; descriptions have no failed state so null → re-attempt.
  for (const npc of input.npcs ?? []) {
    const needsAvatar = npc.avatarStatus === 'pending';
    const needsProfile = npc.description == null;
    if (!needsAvatar && !needsProfile) continue;
    void kickoffNpcAssets({
      uid: input.uid,
      world: input.world,
      npcId: npc.id,
      name: npc.name,
      role: npc.relationship ?? null,
      // LIFE-NPC-8: the sweep backfills LEGACY rows, whose `relationship` was
      // never set because the promote that created them dropped it. Re-deriving
      // from the saga is the only way those ever get a real role — the row
      // itself has nothing to offer.
      archetype: resolveNpcRole({
        npcId: npc.id,
        name: npc.name,
        keyArchetypes: castArchetypes(input.world.cast),
      }).archetype,
      needsAvatar,
      needsProfile,
    });
  }

  // 3. Backdrop patch — persist the full descriptor so resume
  // rehydrates the right backdrop (same rule the old runLifeStep had).
  const backdropIntent = input.backdropIntent ?? null;
  const backdropChanged =
    backdropIntent !== null &&
    backdropIntent.locationLabel !== input.world.currentLocationLabel;
  if (backdropIntent && backdropChanged) {
    // LIFE-CTX-12: the step SI instructs the model to "check the events log:
    // if the most recent <event kind='backdrop_visited'> doesn't match where
    // you're narrating, backdropIntent is required THIS turn" — but this event
    // was NEVER written by any code path, so that check could never fire and
    // the model had no record of where it had already taken the player.
    await appendLifeEvent({
      uid: input.uid,
      worldId,
      kind: 'backdrop_visited',
      payload: { locationLabel: backdropIntent.locationLabel },
    });
    // LIFE-BACKDROP-26: the ribbon's tap-to-reveal has no other source for the
    // native label, and the step call is already holding it. Written on EVERY
    // move including the empty case — a move that omits it must CLEAR the
    // previous place's translation, or the harbour offers the player the
    // English for the café they just left.
    const labelNative = backdropIntent.locationLabelNative?.trim() ?? '';
    await updateLifeWorld(input.uid, worldId, {
      currentLocationLabel: backdropIntent.locationLabel,
      currentLocationLabelNative: labelNative,
      currentBackdrop: {
        locationType: backdropIntent.locationType,
        vibe: backdropIntent.vibe,
        persistent: backdropIntent.persistent,
        label: backdropIntent.locationLabel,
        labelNative,
        ...(backdropIntent.flavour ? { flavour: backdropIntent.flavour } : {}),
        // LIFE-TIME-1: the hour this place was first seen at. Not in the cache
        // key — one SVG per place, re-skinned by time — but the generator needs
        // it, or `vibe: "ominous"` renders a bay at night on a bright morning.
        timeOfDay: readTimeOfDay(input.world.timeOfDay),
      },
    });
  }

}

/**
 * LIFE-EX-DIR-4: a beat is attributed to exactly ONE speaker.
 *
 * `speaker`, `speakerName` and `npcId` are three independent fields where only
 * one combination is meaningful, so "the player's line, labelled with an NPC's
 * name and id" is expressible — the "attributed to an npc, or to me … never the
 * wrong one or both" state from the 2026-07-31 report. `DialogueArea` routes on
 * `speaker` alone and a `user` bubble never reads the other two, so the defect
 * is invisible on screen and lands in the LOG: `<recentEvents>` binds a line to
 * its `npcId` row (LIFE-CTX-10a) and `LIFE-CANON-4` is then handed two
 * candidate speakers for one line, which is exactly the drift it exists to
 * prevent.
 *
 * Cleared here because `commitNode` is the one chokepoint every Firestore beat
 * write passes through. Idempotent, and it matches what the render already does
 * with the fields, so the persisted event and the on-screen bubble cannot
 * diverge (the standing LIFE-BEAT-REPAIR requirement).
 *
 * NB: the structurally better home is `beatRepair.normalizeBeat`, which runs at
 * the ARRIVAL boundary and would heal the in-memory overlay too. That file is
 * outside this change's scope; moving it there later makes this a no-op rather
 * than a conflict.
 */
function coherentAttribution(beat: LifeBeatPayload): LifeBeatPayload {
  if (beat.speaker === 'npc') return beat;
  if (beat.speakerName == null && beat.npcId == null) return beat;
  log.warn('life.beat.attribution-cleared', {
    speaker: beat.speaker,
    speakerName: beat.speakerName ?? null,
    npcId: beat.npcId ?? null,
  });
  return { ...beat, speakerName: null, npcId: null };
}

/** LIFE-STORY-LOG-1: the log rides in every prompt, so it is bounded. A chapter
 *  is only tens of nodes, so this rarely bites; it is a backstop against a
 *  player who wanders a single chapter for a very long time. WS1-C raised it
 *  40→60 (head 6→8), reclaiming the token budget freed by deleting the
 *  <summary> block — <storySoFar> is now the SOLE durable spine (LIFE-STORY-LOG-2),
 *  so a bigger window pushes the deterministic middle-drop past essentially every
 *  real chapter (~tens of nodes) while staying well under the old 80 (~4.8k tok)
 *  that the owner flagged. */
export const STORY_LOG_CAP = 60;
/** How many of the EARLIEST entries to preserve when over the cap. A chapter's
 *  founding facts ("you inherited the house", "the key opens nothing yet") are
 *  the load-bearing ones — plain `.slice(-cap)` dropped exactly those and kept
 *  recent churn. Retain the head, then the most recent, dropping the middle. */
const STORY_LOG_HEAD = 8;

/** Cap the log to `STORY_LOG_CAP`, keeping the chapter's founding lines and the
 *  most recent developments, dropping the superseded middle. */
export function capStoryLog(entries: ReadonlyArray<string>): string[] {
  if (entries.length <= STORY_LOG_CAP) return [...entries];
  const head = entries.slice(0, STORY_LOG_HEAD);
  const tail = entries.slice(entries.length - (STORY_LOG_CAP - STORY_LOG_HEAD));
  return [...head, ...tail];
}

/** LIFE-NODE-3: turn-level world deltas (goals, location label).
 *  Applied when the generating response lands — separate from the
 *  per-node commit because deltas belong to the TURN, not the node. */
export async function applyTurnSignals(input: {
  uid: string;
  world: LifeWorld;
  worldDelta?: WorldDelta;
  /** LIFE-NPC-1: the live roster, so derived canon entries resolve. */
  npcs?: ReadonlyArray<LifeNpc>;
  /**
   * LIFE-REP-5: the person THIS turn was spent on, set only by the
   * `LIFE-NEED-5` clearing chip on a `who` block. Guarantees the step in code
   * instead of waiting on the model's `felt` — see the note at `applyFelt`.
   */
  investIn?: string | null;
  /** LIFE-CANON-1: entities this turn established for the first time. */
  introduces?: ReadonlyArray<StepIntroduction>;
  /** LIFE-STORY-LOG-1: the one-line record of what just happened. */
  logLine?: string | null;
  /** LIFE-ARC-PACE-1: set when this commit is a GENERATED turn, so it advances
   *  the chapter's pace counter. A pre-authored resolution arrival
   *  (LIFE-EX-PLAN-5) passes false — it is a story moment, not a turn.
   *  Opt-IN: a caller that only carries a worldDelta is not asserting a turn. */
  countsAsTurn?: boolean;
  /** LIFE-ARC-PACE-4: which scene (= day) this turn belongs to, so the
   *  day's own pace counter resets when the day does. Optional: a caller
   *  that doesn't know leaves the count alone rather than zeroing it. */
  sceneId?: string | null;
  /** LIFE-NPC-MEM-1: per-NPC memory refreshes to fan out to the npc docs. */
  npcMemoryUpdates?: ReadonlyArray<NpcMemoryUpdate>;
  /** LIFE-REP-3: how the turn landed with up to two people. Code clamps. */
  felt?: ReadonlyArray<Felt>;
}): Promise<void> {
  const delta = input.worldDelta ?? {};
  const patch: Record<string, unknown> = {};

  // LIFE-TIME-1 — the world clock, applied HERE rather than trusted from the
  // model. `advanceTimeOfDay` is monotonic within a day, so a model that writes
  // a morning scene at nine in the evening cannot drag the clock backwards to
  // justify it; only an explicit `nextMorning` wraps. Same shape as the front
  // clocks: the model reports a local judgement, code owns the number.
  const advance = readTimeAdvance(delta.timeAdvance);
  if (advance !== 'none') {
    patch.timeOfDay = advanceTimeOfDay(readTimeOfDay(input.world.timeOfDay), advance);
  }

  // LIFE-CANON-1 / LIFE-STORY-LOG-1: extend the two APPEND-ONLY ledgers. These
  // are turn-level like worldDelta — a preview never persists them, and they
  // describe the turn as a whole rather than any single node.
  const chapter = input.world.currentArc?.chapterNumber;
  // LIFE-CANON-6: fold introductions into the STORED ledger only. Passing the
  // resolveCanon output (stored + derived roster + current location) BAKED the
  // live roster and the momentary location into persisted canon, so retired
  // NPCs lingered forever and the doc grew with every backdrop. Roster + location
  // stay DERIVED at render/validate time (resolveCanon); only model-declared
  // entities persist here.
  const grown = applyIntroductions(
    input.world.canon ?? EMPTY_CANON,
    input.introduces ?? [],
    chapter,
  );
  if (grown) patch.canon = grown;
  const line = input.logLine?.trim();
  const isTurn = input.countsAsTurn === true;
  if (line || isTurn) {
    const prev = input.world.storyLog;
    // A chapter change resets the log; otherwise entries only ever append.
    const fresh = !prev || (chapter !== undefined && prev.chapterNumber !== chapter);
    // LIFE-ARC-PACE-1: `turns` is the pace counter and is NOT `entries.length`
    // — see the field doc on `ZLifeWorld.storyLog`. Legacy docs (written before
    // the field existed) seed from `entries.length`; that overstates the count,
    // which only ever makes an already-overlong chapter conclude sooner.
    const prevTurns = fresh ? 0 : (prev.turns ?? prev.entries.length);
    // LIFE-ARC-PACE-4: the same counter one level down, scoped to the SCENE
    // (= a day, LIFE-DAY-1). The chapter had `turns` and a <chapterPace> block;
    // the day had neither, so "wrap this day up" was a rule stated in a
    // quantity the model could not observe — the same defect <chapterPace>
    // exists to fix — and days ended wherever a completionTrigger happened to
    // fire, routinely mid-morning. Reset on the scene CHANGING rather than
    // on resolve, so the count belongs to whichever scene is running now
    // and a resolve/start pair cannot leave a stale total behind.
    // Only re-scope when the caller actually TOLD us which scene this is.
    // An undefined sceneId means "don't know", and treating that as a
    // change would reset the day's count on every such commit.
    const knownScene = input.sceneId !== undefined;
    const sceneChanged =
      fresh || (knownScene && (prev?.sceneId ?? null) !== input.sceneId);
    const prevSceneTurns = sceneChanged ? 0 : (prev?.sceneTurns ?? 0);
    patch.storyLog = {
      chapterNumber: chapter ?? prev?.chapterNumber ?? 1,
      entries: capStoryLog([...(fresh ? [] : prev.entries), ...(line ? [line] : [])]),
      turns: prevTurns + (isTurn ? 1 : 0),
      sceneTurns: prevSceneTurns + (isTurn ? 1 : 0),
      sceneId: knownScene ? input.sceneId : (prev?.sceneId ?? null),
    };
  }
  if (delta.currentLocationLabel) {
    patch.currentLocationLabel = delta.currentLocationLabel;
  }
  // LIFE-GOAL-3/4 — the ladder. Code owns it; `applyLadderDelta` is where the
  // model's proposal gets ignored if an objective is still live, which is the
  // whole of the reported "the key never came back" bug.
  const ladderBefore: GoalLadder = {
    ...EMPTY_LADDER,
    ...(input.world.goalLadder ?? {}),
    done: input.world.goalLadder?.done ?? [],
    dayIndex: input.world.goalLadder?.dayIndex ?? 0,
  };
  const ladderAfter = applyLadderDelta(
    ladderBefore,
    {
      objectiveDone: delta.objectiveDone,
      objectiveClosed: delta.objectiveClosed,
      nextObjective: delta.nextObjective,
      nextObjectiveNeed: delta.nextObjectiveNeed,
    },
    worldFactsFor(input.world, input.npcs ?? []),
    { advance, newId: `obj-${input.sceneId ?? 'w'}-${ladderBefore.done.length}` },
  );
  const ladderMoved =
    ladderAfter.objective?.id !== ladderBefore.objective?.id ||
    ladderAfter.done.length !== ladderBefore.done.length ||
    ladderAfter.dayIndex !== ladderBefore.dayIndex;
  if (ladderMoved) {
    patch.goalLadder = ladderAfter;
  }
  // LIFE-GOAL-11 — SAY WHAT THE LADDER DID, every turn.
  //
  // Added after a player transcript reported "the immediate goal didn't
  // regenerate in scene 2" and the log could not answer it: SCENE-GEN,
  // SCENE-CLOSE, STEP, WORLD-ARC and NPC-AVATAR all narrate themselves and the
  // ladder was the one mechanic that shipped silent. A feature whose whole job
  // is to tell the player where they are, that cannot tell a developer where it
  // is, is not debuggable from the surface it is reported on.
  //
  // Logged on EVERY turn, including the ones where nothing moved — "still
  // live, model proposed nothing" is exactly the observation that separates a
  // stuck objective from an absent one, and it is invisible if only changes
  // are logged.
  lifeDebug('GOAL', ladderMoved ? 'ladder moved' : 'ladder unchanged', {
    before: ladderBefore.objective?.text ?? null,
    after: ladderAfter.objective?.text ?? null,
    need: ladderAfter.objective?.need
      ? `${ladderAfter.objective.need.kind}:${ladderAfter.objective.need.name}`
      : null,
    // What the MODEL said this turn, beside what code did with it. When these
    // disagree the disagreement is the bug.
    saidDone: delta.objectiveDone ?? false,
    saidClosed: delta.objectiveClosed ?? null,
    proposed: delta.nextObjective ?? null,
    settled: ladderAfter.done.length,
    dayIndex: ladderAfter.dayIndex,
  });
  if (Object.keys(patch).length > 0) {
    await updateLifeWorld(input.uid, input.world.id, patch);
  }

  // LIFE-REP-3: fold this turn's reactions into the roster. Code clamps and
  // owns the sum; the model only ever said which way one person moved.
  //
  // Best-effort like the memory fan-out below: a standing write that fails must
  // not fail the turn. The alternative — a story that stops because a number
  // did not save — is worse than a relationship that drifts by one step.
  // LIFE-REP-5 — INVESTING A TURN IN A PERSON ALWAYS LANDS.
  //
  // "Earning regard is the reliable move; what it costs is time." Reliable has
  // to mean guaranteed, so the +1 is prepended by CODE rather than waited on
  // from the model's `felt`. The player was shown a door and told it clears the
  // block; a door that works only when the model remembers to report a reaction
  // is the door not working — and `hear` (4/2,110) and `addGoals` (0/95) are
  // this repo's two measurements of what "the model will usually mention it"
  // is worth.
  //
  // PREPENDED, not appended: `applyFelt` keeps the FIRST entry per person and
  // drops the rest, so a model reaction for the same person on the same turn
  // cannot stack on top. That is `LIFE-REP-5`'s "exactly one step" — and it is
  // also why a hostile reaction cannot cancel the investment the player just
  // spent their turn on.
  const invested = input.investIn ? [{ who: input.investIn, delta: 1 }] : [];
  const moved = applyFelt(
    (input.npcs ?? []).map((n) => ({ id: n.id, name: n.name, standing: n.standing })),
    [...invested, ...(input.felt ?? [])],
  );
  for (const [npcId, standing] of moved) {
    try {
      await setNpcStanding(input.uid, input.world.id, npcId, standing);
    } catch (e) {
      log.warn('life/commit: standing write failed', { npcId, error: String(e) });
    }
  }

  // LIFE-NPC-MEM-1: fan per-NPC memory refreshes out to the npc docs. Authored
  // inline by the model that just lived the scene (no separate compaction call).
  // Best-effort + roster-guarded — never fails the turn.
  if (input.npcMemoryUpdates && input.npcMemoryUpdates.length > 0) {
    await writeNpcMemories(
      input.uid,
      input.world.id,
      input.npcMemoryUpdates,
      input.npcs ?? [],
      'life.step',
    );
  }
}

/**
 * LIFE-FAIL-9: player-avatar gens in flight, keyed by worldId. A dead
 * 'pending' (the gen was abandoned by a reload/navigation before it settled)
 * self-heals — a later `commitNode` re-kicks because this set is empty after a
 * reload, while a genuinely in-flight gen this session is deduped. Mirrors
 * `inFlightNpcAssets`; module-level so it spans turns; cleared when the gen
 * settles.
 */
const inFlightPlayerAvatar = new Set<string>();

/** Test seam — clear the player-avatar in-flight guard between unit tests. */
export function __resetPlayerAvatarInFlight(): void {
  inFlightPlayerAvatar.clear();
}

/** LIFE-FAIL-3/5: ONE retry on a transient avatar-gen failure before we give
 *  up and write the terminal 'failed' status. `generateNpcAvatar` returns a
 *  typed result and never throws, so a non-'ok' kind IS the transient-failure
 *  signal. A single retry recovers the common flaky-network / rate-limit case;
 *  a second failure lands the graceful terminal state (the initials circle)
 *  rather than an infinite shimmer. Used by BOTH the player and NPC kickoffs. */
async function generateNpcAvatarWithRetry(
  input: Parameters<typeof generateNpcAvatar>[0],
): Promise<NpcAvatarGenResult> {
  const first = await generateNpcAvatar(input);
  if (first.kind === 'ok') return first;
  return generateNpcAvatar(input);
}

/** LIFE-NPC-2 (player-side): generate the player's own character
 *  avatar. Moved verbatim from runLifeStep.ts. */
async function kickoffPlayerAvatarGen(opts: {
  uid: string;
  worldId: string;
  characterName: string;
  worldVibe: string;
}): Promise<void> {
  await updateLifeWorld(opts.uid, opts.worldId, {
    characterAvatarStatus: 'pending',
  }).catch(() => undefined);
  try {
    const result = await generateNpcAvatarWithRetry({
      name: opts.characterName,
      role: "the player's own character — protagonist of the saga",
      worldVibe: opts.worldVibe,
    });
    if (result.kind === 'ok') {
      const dataUri = svgToDataUri(result.svg);
      // LIFE-DATA-1: bytes to the sidecar FIRST, THEN flip the hot doc's
      // status flag to 'ready' — a status==='ready' reader is guaranteed
      // to find the sidecar. The world doc never carries the avatar bytes.
      await writeCharacterAvatar(opts.uid, opts.worldId, dataUri);
      await updateLifeWorld(opts.uid, opts.worldId, {
        characterAvatarStatus: 'ready',
      });
      lifeDebug('NPC-AVATAR', `player avatar ready for "${opts.characterName}"`, {
        bytes: dataUri.length,
      });
    } else {
      await updateLifeWorld(opts.uid, opts.worldId, {
        characterAvatarStatus: 'failed',
      }).catch(() => undefined);
    }
  } catch (err) {
    log.warn('life.player-avatar.kickoff-failed', { err: String(err) });
    await updateLifeWorld(opts.uid, opts.worldId, {
      characterAvatarStatus: 'failed',
    }).catch(() => undefined);
  }
}

/** LIFE-NPC-6/7: fire whichever of an NPC's assets (avatar, profile
 *  description) are missing. The single entry point used by the
 *  new-NPC path + the roster sweep here AND by sceneLifecycle's
 *  key-NPC pre-promotion — so vibe/premise derivation lives in one
 *  place. Fire-and-forget; each sub-gen tolerates its own failure. */
/**
 * NPC asset generations in flight, keyed `${worldId}:${npcId}:avatar|profile`.
 * The roster sweep in `commitNode` runs on EVERY node arrival and re-kicks any
 * NPC whose avatar (`avatarStatus: 'pending'`, no url) or profile (null) hasn't
 * landed — but a flash-preview avatar gen (2–5s, the priciest tier) routinely
 * outlasts a turn, so without this guard the SAME NPC's gen fires again on the
 * next pick (2× tokens per new NPC). Mirrors `inFlightBackdropGens` in
 * `useLifeBackdrop`. Module-level so it spans turns; cleared when the gen settles.
 */
const inFlightNpcAssets = new Set<string>();

function guardNpcAsset(key: string, run: () => Promise<void>): Promise<void> {
  if (inFlightNpcAssets.has(key)) return Promise.resolve();
  inFlightNpcAssets.add(key);
  return run().finally(() => inFlightNpcAssets.delete(key));
}

export async function kickoffNpcAssets(opts: {
  uid: string;
  world: LifeWorld;
  npcId: string;
  name: string;
  role?: string | null;
  /** LIFE-NPC-8: fuller "who they are" line for the PROMPTS. Kept separate
   *  from `role` because that renders as the card's one-line role row. */
  archetype?: string | null;
  needsAvatar: boolean;
  needsProfile: boolean;
}): Promise<void> {
  const worldVibe = pickWorldVibe(opts.world);
  // LIFE-ARCH-3: the situation (what is TRUE now) replaces the saga premise
  // (what someone planned). Same job for the profile prompt, better source.
  const sagaPremise = opts.world.situation?.trim() || null;
  const jobs: Promise<void>[] = [];
  if (opts.needsAvatar) {
    jobs.push(
      guardNpcAsset(`${opts.world.id}:${opts.npcId}:avatar`, () =>
        kickoffNpcAvatarGen({
          uid: opts.uid,
          worldId: opts.world.id,
          npcId: opts.npcId,
          name: opts.name,
          role: opts.role ?? null,
          worldVibe,
        }),
      ),
    );
  }
  if (opts.needsProfile) {
    jobs.push(
      guardNpcAsset(`${opts.world.id}:${opts.npcId}:profile`, () =>
        kickoffNpcProfileGen({
          uid: opts.uid,
          worldId: opts.world.id,
          npcId: opts.npcId,
          name: opts.name,
          role: opts.role ?? null,
          archetype: opts.archetype ?? null,
          worldVibe,
          sagaPremise,
        }),
      ),
    );
  }
  await Promise.all(jobs);
}

/** LIFE-NPC-2 / LIFE-NPC-6: avatar gen for a promoted / asset-less
 *  NPC. Passes `role` (the NPC's relationship) so clothing + bearing
 *  match — it was omitted before, drawing generic portraits. */
async function kickoffNpcAvatarGen(opts: {
  uid: string;
  worldId: string;
  npcId: string;
  name: string;
  role?: string | null;
  worldVibe: string;
}): Promise<void> {
  try {
    // LIFE-FAIL-5: ONE retry before the terminal 'failed' write (the roster
    // sweep NEVER re-kicks a 'failed' NPC, so the retry must happen here).
    const result = await generateNpcAvatarWithRetry({
      name: opts.name,
      role: opts.role ?? null,
      worldVibe: opts.worldVibe,
    });
    if (result.kind === 'ok') {
      const dataUri = svgToDataUri(result.svg);
      await setNpcAvatar(opts.uid, opts.worldId, opts.npcId, dataUri);
      lifeDebug('NPC-AVATAR', `avatar ready for "${opts.name}"`, {
        npcId: opts.npcId,
        bytes: dataUri.length,
      });
    } else {
      await setNpcAvatarFailed(opts.uid, opts.worldId, opts.npcId).catch(() => undefined);
    }
  } catch (err) {
    log.warn('life.npc-avatar.kickoff-failed', {
      npcId: opts.npcId,
      err: String(err),
    });
    await setNpcAvatarFailed(opts.uid, opts.worldId, opts.npcId).catch(() => undefined);
  }
}

/** LIFE-NPC-7: profile-description gen for a promoted / description-less
 *  NPC. No failure marker — on error `description` stays null and the
 *  roster sweep re-attempts on a later turn. */
async function kickoffNpcProfileGen(opts: {
  uid: string;
  worldId: string;
  npcId: string;
  name: string;
  role?: string | null;
  archetype?: string | null;
  worldVibe: string;
  sagaPremise?: string | null;
}): Promise<void> {
  try {
    const result = await generateNpcProfile({
      name: opts.name,
      role: opts.role ?? null,
      archetype: opts.archetype ?? null,
      worldVibe: opts.worldVibe,
      sagaPremise: opts.sagaPremise ?? null,
    });
    if (result.kind === 'ok') {
      await setNpcDescription(opts.uid, opts.worldId, opts.npcId, result.description);
      // Reuses the NPC-AVATAR asset channel (debugLog.ts is out of this
      // change's scope; a dedicated 'NPC-PROFILE' channel is a nice-to-have).
      lifeDebug('NPC-AVATAR', `description ready for "${opts.name}"`, {
        npcId: opts.npcId,
        chars: result.description.length,
      });
    }
  } catch (err) {
    log.warn('life.npc-profile.kickoff-failed', {
      npcId: opts.npcId,
      err: String(err),
    });
  }
}

/** Saga tone beats worldSeedKey for the avatar prompt's visual
 *  register. Moved verbatim from runLifeStep.ts. */
function pickWorldVibe(world: LifeWorld): string {
  if (world.saga?.tone) return world.saga.tone.trim();
  return SEED_VIBE_LABEL[world.worldSeedKey] ?? 'modern city';
}

const SEED_VIBE_LABEL: Record<string, string> = {
  city_life: 'modern city, contemporary clothing',
  studying_abroad: 'student quarter, contemporary clothing',
  work_abroad: 'office district, contemporary business clothing',
  family_country: 'ancestral village, contemporary clothing',
  farm_life: 'working farm, practical outdoor clothing',
  retired_village: 'rural village, contemporary clothing',
  restaurant: 'restaurant kitchen and dining room, chef whites and service blacks',
  local_team: 'sports ground and clubhouse, kit and training gear',
  hostel: 'backpacker hostel, casual travelling clothes',
  magic_university: 'fantasy magical university, robes and academic attire',
  noir_detective: 'noir city, 1940s collars and smoky tones',
  alien_invasion: 'occupied modern city, contemporary clothing under an unfamiliar sky',
  frontier_colony: 'frontier colony, sci-fi or western',
  sea_voyage: 'working tall ship at sea, oilskins and salt-worn layers',
  pilgrim_town: 'old cathedral town, pilgrim and clerical dress',
  outlaw_trail: 'frontier west, dust, long coats, rifles and railhead-town clothing',
  heist: 'city the job is set in, sharp clothes that do not draw a second look',
  haunted_house: 'old inherited manor and the village around it, layered period-worn clothing',
  surprise: 'modern city, contemporary clothing',
  manual: 'modern city, contemporary clothing',
};
