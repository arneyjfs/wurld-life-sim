/**
 * LIFE-NODE-*: ALL machine logic of the client-side node turn engine
 * (see nodeEngineTypes.ts for the three-file layout).
 *
 * Owns: the TurnPhase machine, the nonce (LIFE-NODE-6), the feedback
 * prefetch (only when the question node did NOT pre-author its
 * continuation — LIFE-EX-PLAN-5), question authoring, the local event
 * overlay, scene auto-start (LIFE-SCENE-24), and turn-level signal
 * application.
 *
 * Does NOT own: bubbles (LifeScreen appends via the appendBubbles
 * callback so resume seeding + avatar taps stay screen-side), the
 * scene descriptor, the scene/arc completion overlays (surfaced via
 * onSceneResolved), or the scene CLOSE — that is one self-contained
 * job with one caller and it lives in `nodeEngineSceneClose.ts`,
 * which is also what keeps this file under the 600-LOC cap.
 *
 * Spec: docs/specs/life-sim.md §10.46.
 */
import * as log from '@/lib/log';
import { lifeFailed } from '@/lib/life/debugLog';
import {
  buildGradedSceneContext,
  generateStepOptions,
  recentGenerationTargets,
  type GenerateStepOptionsResult,
  type LiveTurnChoice,
  type PracticeOutcome,
} from '@/lib/life/generateStepOptions';
import {
  applyTurnSignals,
  commitNode,
  type CommitAction,
} from '@/lib/life/commitNode';
import {
  localBeatEvent,
  localCorrectionEvent,
  mergeLocalEvents,
} from '@/lib/life/mergeLocalEvents';
import { runGradedQuestionGenerate } from '@/lib/life/runGradedQuestionGenerate';
import { gradedSayPlan } from '@/lib/life/gradedSayPlan';
import { closeResolvedScene } from './nodeEngineSceneClose';
import {
  startScene,
  computeReplanPlan,
  fireBackgroundScenePatch,
  sceneResolveTooEarly,
  snapshotSceneCompletion,
} from '@/lib/life/sceneLifecycle';
import { buildResolvedBubble } from '@/lib/life/resolvedBubble';
import { practiceOutcomeFromFeedback } from '@/lib/life/practiceOutcomeFromFeedback';
import {
  actionToLocalEvents,
  beatToPayload,
  createArrivalOwner,
  lastBeatPracticeText,
  payloadsToBubbles,
} from './nodeEngineBeats';
import { buildBeatRepairContext, normalizeBeats } from '@/lib/life/beatRepair';
import {
  authoringFloor,
  prefersReducedMotion,
  scheduleArrival,
  SLOT_SETTLE_MS,
} from './nodeEngineGlide';
import {
  WRITE_YOUR_OWN_ID,
  type GradedPlan,
  type NodePreview,
  type PlayerSaysLine,
  type StepBeat,
  type StepChoice,
  type StepOption,
} from '@/lib/life/stepSchema';
import { createCardMatchHandlers } from './nodeEngineCardMatch';
import { createOpeningPrefetch } from './nodeEngineOpening';
import { pinPlannedUtterance, plannedSpokenLine, prefetchPlannedUtterance } from './nodeEngineVoice';
import { arriveAtResolution, recordDemotedSlot, takeResolution } from './nodeEngineResolution';
import { createTextGraders } from './nodeEngineExercises';
import { buildFeedbackState } from './nodeEngineFeedback';
import { waitKindForTurn } from './waitKind';
import type { LifeBeatPayload, LifeEvent } from '@/types/firestore';
import {
  CONTINUE_AFTER_FAILURE_ID,
  type EngineDeps,
  type NodeEngineActions,
} from './nodeEngineTypes';

/** All machine logic. Closures read ONLY the stable refs in `deps`,
 *  so the actions object created on first render never goes stale. */
export function createEngineActions(deps: EngineDeps): NodeEngineActions {
  const {
    propsRef,
    machineRef,
    localEventsRef,
    nonceRef,
    prefetchRef,
    openingPrefetchRef,
    replanRef,
    sceneStartRef,
    activePlanRef,
    activeResolutionRef,
    transition,
  } = deps;

  // LIFE-NODE-9: monotonic guard for the beat glide. Bumped
  // on EVERY node arrival so a newer arrival cancels any still-pending
  // staggered append from the previous one (defensive — the glide
  // (~<600ms) normally completes well before the options call resolves).
  let staggerGen = 0;
  // LIFE-SPEECH-5: the ordinary `say` this pick degrades to if the graded
  // generator can't author its question. Set by `pick` immediately before the
  // synthesised question node arrives, and CONSUMED (captured + cleared) at the
  // top of `authorQuestion`, so it can only ever apply to the question it was
  // set for. Null for every model-authored question node.
  let gradedSayFallback: { option: StepOption; saysLine: PlayerSaysLine | null } | null = null;
  // LIFE-NODE-11: owns the CURRENT turn's arrival sequence — its events, and
  // the options released on their tail. `take` supersedes the previous turn's
  // sequence; `cancelPendingTurnArrivals` drains it on unmount.
  const arrivals = createArrivalOwner();

  /**
   * LIFE-EX-13.2 — THE TURN HAS COME TO REST. Open the scene review here, or
   * leave an open one alone.
   *
   * This is the single place a turn stops being mid-flight, and it is therefore
   * the only safe place to hand the screen to the end-of-scene grid.
   *
   * LIFE-EX-13 opened the grid inside `handleSignals`, which runs from the
   * MIDDLE of `arriveAtNode` — so whatever phase that arrival went on to set
   * overwrote it. LIFE-EX-13.1 read that as "guard the writes" and guarded the
   * two `options-ready` ones. `arriveAtNode` has two more (`question-authoring`
   * for a question node, synchronously; `options-loading` for the demote path)
   * and both still discarded the grid, which is the 2026-08-07 report: *"I'm
   * still not getting card matching exercise before the scene summary."*
   *
   * Guarding the last two would be the third round of the same whack-a-mole,
   * and would ALSO be wrong: when the scene ends on a graded question the
   * player should answer it and get the review afterwards, not have the review
   * eat the question. So `handleSignals` now only ARMS the review, and it opens
   * here — after a branch's options land, or after the question that ended the
   * scene has been answered and its follow-on arrives. Whatever route the turn
   * took, it passes through here exactly once.
   *
   * The options are stored either way; `completeCardMatch` moves to
   * `options-ready` when the grid is solved and finds them waiting.
   */
  function settlePhase(next: 'options-ready'): { phase?: 'options-ready' } {
    // Already showing a grid (a re-render, a second release) — never restart it.
    if (machineRef.current.phase === 'card-match') return {};
    // Armed by a resolve on this turn or an earlier one in this arrival chain.
    if (cardMatch.tryEnterSceneReview()) return {};
    return { phase: next };
  }

  function currentEvents(): LifeEvent[] {
    return mergeLocalEvents(propsRef.current.events, localEventsRef.current);
  }

  // LIFE-EX-10: card-matching review handlers (extracted for the LOC cap).
  // `runLiveTurn` is a hoisted declaration below, so passing it here is safe.
  const cardMatch = createCardMatchHandlers({ deps, currentEvents });
  // LIFE-BACKDROP-21: starts the opening turn behind the intro card so its
  // backdropIntent can drive the first scene gen. Extracted for the LOC cap.
  const prefetchOpening = createOpeningPrefetch({ deps, currentEvents });

  function pushLocal(evts: LifeEvent[]): void {
    localEventsRef.current = [...localEventsRef.current, ...evts].slice(-12);
  }

  async function awaitReplan(): Promise<void> {
    // LIFE-SCENE-5: a replan kicked by the previous response may
    // still be in flight — the next prompt must read the refreshed
    // outline. Usually zero wait (absorbed by read time).
    if (replanRef.current) {
      try {
        await replanRef.current;
      } catch {
        // runSceneClose never throws — defensive.
      }
      replanRef.current = null;
    }
  }

  /** Turn-level signals from a landed response: worldDelta, hook
   *  offer, scene resolution, replan plan (LIFE-NODE-3/6). */
  function handleSignals(
    result: Extract<GenerateStepOptionsResult, { kind: 'ok' }>,
    /** LIFE-REP-5: the person this turn was SPENT ON, when it was the
     *  `LIFE-NEED-5` clearing chip. Passed from the action rather than read off
     *  the response, because the guarantee is about what the player DID — a
     *  model that never mentions the reaction must not be able to void it. */
    investIn?: string | null,
  ): void {
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    // LIFE-CANON-1 / LIFE-STORY-LOG-1 ride here alongside worldDelta — all
    // three are TURN-level, so they commit when the generating response lands
    // (LIFE-NODE-2/3).
    const hasLedger =
      (result.introduces?.length ?? 0) > 0 ||
      Boolean(result.logLine?.trim()) ||
      (result.npcMemoryUpdates?.length ?? 0) > 0;
    // LIFE-ARC-PACE-2: a GENERATED turn always has something to commit — the
    // pace counter. `logLine` is optional in the schema, so gating purely on
    // the payload meant a turn where the model narrated nothing never reached
    // `storyLog.turns`, and the number <chapterPace> renders drifted low. The
    // error direction is the ORIGINAL defect (chapters running past their
    // ceiling), so it has to be the generation that decides, not the payload.
    // A pre-authored resolution is exempt: it cost no `life_step`, so it falls
    // back to the payload test and only commits when it has something to say.
    if (result.worldDelta || hasLedger || !result.fromResolution) {
      void applyTurnSignals({
        uid: p.uid,
        world: p.world,
        npcs: p.npcs,
        // LIFE-REP-5: a clearing turn ALWAYS buys its step. Read off the
        // action rather than the response, because the guarantee is about
        // what the player DID, not about what the model noticed.
        investIn: investIn ?? null,
        worldDelta: result.worldDelta,
        introduces: result.introduces,
        logLine: result.logLine ?? null,
        npcMemoryUpdates: result.npcMemoryUpdates,
        countsAsTurn: !result.fromResolution,
        // LIFE-ARC-PACE-4: which DAY this turn belongs to, so the day's pace
        // counter re-scopes when the day does rather than carrying a stale
        // total into the next one.
        sceneId: p.scene?.id ?? null,
      }).catch((err) =>
        log.warn('life.node.world-delta-failed', { err: String(err) }),
      );
    }
    const signal = result.scene;
    // LIFE-SCENE-24: there is no hook to route. A turn that lands with no
    // active scene starts one, instead of waiting to be offered a pitch that
    // the measurement says never came.
    startSceneIfNone();
    // LIFE-SCENE-32: is this the turn the scene ENDS on? Computed BEFORE
    // anything is rendered, because the close call that writes the summary is
    // started from it and every millisecond before the celebration screen
    // appears is a millisecond the player does not spend watching a placeholder.
    const resolvingNow =
      !!signal?.resolved
      && !!p.scene
      && !sceneResolveTooEarly(p.world?.storyLog?.sceneTurns ?? 0);
    if (signal?.resolved && p.scene && !resolvingNow) {
      // LIFE-SCENE-26: refuse a resolve that lands below the floor. "Too small
      // to be satisfying" is the failure the owner named alongside "too long",
      // and only the second was guarded. The scene just carries on — the model
      // gets another turn and <scenePace> keeps counting.
      log.warn('life.scene.resolve-too-early', {
        sceneTurns: p.world?.storyLog?.sceneTurns ?? 0,
        endingKey: signal.resolved.endingKey,
      });
    }
    if (p.scene) {
      const plan = computeReplanPlan(p.scene, signal);
      fireBackgroundScenePatch(p.uid, p.world.id, plan.patch);
      if (plan.reason === 'hardPivot') {
        // LIFE-NODE-6: a hard pivot invalidates any generation still in flight
        // against the old outline — the result is dropped on arrival.
        nonceRef.current += 1;
      }
      // LIFE-SCENE-32 / LIFE-SCENE-36 — A RESOLVING SCENE CLOSES. ONLY A
      // RESOLVING SCENE CLOSES, AND ONLY ONCE.
      //
      // LIFE-SCENE-32 fixed half of this: the gate used to be
      // `plan.shouldReplan` ALONE — a 5-turn tick plus the two pivot signals —
      // so a scene resolving on any other turn produced no summary at all and
      // the completion screen pulsed its placeholder forever. The fix added
      // `|| resolvingNow` and left the tick in place.
      //
      // LIFE-SCENE-36 removes the tick. PRODUCTION, 2026-08-06: FOUR closes
      // inside six minutes with summaries that contradicted each other — a
      // 12-turn scene closing at turn 5, turn 10 and again on resolve, each
      // writing a "what happened in this scene" line from a partial view of it.
      // The tick trigger is a leftover from `sceneReplan`, which refreshed a
      // running scene's PLAN; `sceneClose` (LIFE-ARCH-4) writes STATE — a
      // history line, clock deltas, cast deltas — and there is nothing for it
      // to say about a scene still in progress.
      //
      // It also broke a stated contract with a second-order cost. LIFE-ARCH-5:
      // sagaHistory is *"an array of one-line entries appended at each
      // sceneClose"*, and `canonDormancy()` derives dormancy from it assuming
      // ONE LINE PER CLOSED SCENE — so extra lines make every entity read as
      // more recent than it is, which is exactly the design's own watch-list
      // signal 4 ("always the most recent entity → dormancy not working").
      //
      // The tick keeps its bookkeeping: `plan.patch` above still resets
      // `turnsSinceReplan`, and a hard pivot still bumps the nonce.
      if (resolvingNow) {
        // LIFE-ARCH-4 / LIFE-SCENE-31.1 — the whole close lives in
        // `nodeEngineSceneClose`. It never rejects and reports exactly once,
        // so nothing here has to await it or handle its failures.
        replanRef.current = closeResolvedScene({
          uid: p.uid,
          world: p.world,
          outline: plan.outlineForReplan,
          events: p.events,
          npcs: p.npcs,
          resolved: signal.resolved,
          onSummary: (line) => propsRef.current.onSceneSummary(line),
        });
      }
    }
    // LIFE-SCENE-32: the celebration screen opens LAST, once the close call is
    // already in flight. Opening it first cost the whole round-trip in visible
    // placeholder time, for no reason other than statement order — the snapshot
    // it renders was ready before any of this ran.
    if (resolvingNow && p.scene && signal?.resolved) {
      p.onSceneResolved(snapshotSceneCompletion(p.scene, signal.resolved, p.events));
      // LIFE-EX-13: the scene's LAST exercise — a review of what it taught,
      // misses first — held in front of the summary card. `onSceneResolved`
      // has already set `pendingSceneComplete`, and `LifeScreenBottom` counts
      // an open card-match as mid-activity, so the "View scene summary" chip
      // waits behind the grid and appears the moment it is solved.
      cardMatch.armSceneReview();
    }
  }

  /** Render + commit + route for a node the player just arrived at.
   *  `liveResult` present = the options came bundled with the node (the normal
   *  path); absent = the graded-demote path, which fetches options separately
   *  (LIFE-NODE-8). */
  function arriveAtNode(
    node: NodePreview,
    opts: {
      action: CommitAction;
      appendMode: 'reset' | 'append';
      liveResult: Extract<GenerateStepOptionsResult, { kind: 'ok' }> | null;
      /** LIFE-SPEECH-1: the player's spoken line for a `say` pick, prepended
       *  as the first (user) bubble of this arrival. */
      saysLine?: PlayerSaysLine | null;
    },
  ): void {
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    // LIFE-NODE-16: replacing the FEEDBACK panel means the slot is mid-collapse
    // — hold the options until it settles (rationale on `SLOT_SETTLE_MS`). Read
    // BEFORE the transitions below change the phase.
    const slotFloor = machineRef.current.phase === 'feedback' ? SLOT_SETTLE_MS : 0;
    // LIFE-NODE-9: any arrival cancels a still-pending previous glide.
    staggerGen += 1;
    const gen = staggerGen;
    // LIFE-BEAT-REPAIR: normalise at the arrival boundary so the on-screen
    // bubble, the in-memory overlay, and the persisted event all carry the
    // SAME repaired shape. Doing it only in commitNode (persist) left the live
    // bubble showing the raw defect all session (mute entity in a speech
    // bubble; the player's « … », demandes-tu line under an NPC avatar) until
    // a reload. Fold this turn's introduces so a same-turn introduce+speak of a
    // mute entity is converted too.
    // LIFE-CONTRACT-EX-6: a question node's beats are its LEAD-IN — the
    // player's action landing before the intercept. This line used to read
    // `node.kind === 'question' ? [] : node.beats`, discarding them; combined
    // with the schema not offering the field, a pick that triggered a question
    // never appeared in the story at all.
    const rawBeats: StepBeat[] = node.beats;
    // LIFE-SPEECH-6: the line ALREADY on screen, so a beat restaging it is
    // dropped rather than shown twice. Two sources in priority order: the
    // `saysLine` this very call is about to prepend as the player's bubble, and
    // otherwise the most recent committed beat — which on the post-outcome turn
    // is the RESOLVED graded line the player just produced. The second is the
    // reported bug: a fill-blank puts the player's completed sentence on screen,
    // and the post-outcome turn then had an NPC say it straight back.
    const repairCtx = {
      ...buildBeatRepairContext(
        p.world, p.npcs ?? [], opts.liveResult?.introduces ?? [],
      ),
      // `currentEvents()`, NOT `p.events`: the resolved graded bubble is pushed
      // to the LOCAL overlay and only reaches the Firestore snapshot a
      // round-trip later, so on the post-outcome turn — the reported bug —
      // `p.events` does not contain it yet and this read came back null. The
      // merged view is also exactly what `generateStepOptions` was given, so
      // the line we compare against is the line the model was shown.
      alreadySpoken: opts.saysLine?.practiceText ?? lastBeatPracticeText(currentEvents()),
    };
    const beatPayloads = rawBeats.map(beatToPayload);
    // LIFE-SPEECH-1: a non-graded `say` pick carries the player's spoken line on
    // the option (`saysLine`). Prepend it as the FIRST bubble — a client-built
    // `user` beat — so the player always SEES their own line, instantly, before
    // the world's reaction. The model never emits a user beat (ZStepBeat is
    // narrator|npc); the client is the sole constructor of user bubbles (here, or
    // buildResolvedBubble for graded).
    if (opts.saysLine) {
      beatPayloads.unshift({
        speaker: 'user', speakerName: null, npcId: null, ...opts.saysLine,
      });
    }
    const payloads = normalizeBeats(beatPayloads, repairCtx);
    const bubbles = payloadsToBubbles(payloads);
    // LIFE-NODE-9: on any arrival that FOLLOWS A PLAYER ACTION (appendMode
    // 'reset'), the node's beats glide up staggered from the bottom — a short
    // pause lets the chip grid clear, then each beat mounts in turn.
    //
    // The trigger used to also require `liveResult === null`, i.e. a cached
    // preview advance. With the lookahead gone (LIFE-NODE-2) that combination
    // can no longer occur, which would have silently killed the animation.
    // Keying on `appendMode` alone restores it — and it matters MORE now: the
    // beats land after a visible wait, so staggering them reads as the story
    // unfolding rather than a block of text appearing at once.
    //
    // VISUAL ONLY: commitNode + the local overlay (below) still fire ONCE,
    // immediately — the next prompt sees the events and the roster sweep runs
    // regardless of the glide. The opening node, question authoring and
    // practice resolution use 'append' and land instantly, as does the
    // reduced-motion path.
    const staggered =
      opts.appendMode === 'reset' &&
      bubbles.length > 0 &&
      !prefersReducedMotion();
    // LIFE-NODE-11: ONE sequence owns the turn. It drains the events, then
    // releases the options as the final beat — so the options cannot land
    // first, or between two events, however the two calls happen to resolve.
    if (staggered) {
      // Clear the turn boundary now (chips + previous-turn highlight go);
      // the beats arrive over the pause + stagger.
      p.appendBubbles([], { resetTurn: true });
    }
    const appendOne = (b: (typeof bubbles)[number]) => propsRef.current.appendBubbles([b], { resetTurn: false });
    arrivals.take(scheduleArrival({ bubbles, staggered, settleFloorMs: slotFloor, append: appendOne, isStale: () => gen !== staggerGen }));
    if (!staggered) p.appendBubbles(bubbles, { resetTurn: opts.appendMode === 'reset' });
    if (node.backdropIntent) p.onBackdropIntent(node.backdropIntent);
    // LIFE-NODE-3: all Firestore writes; don't block the render. Beats are the
    // already-normalised payloads (commitNode re-normalises idempotently).
    void commitNode({
      uid: p.uid,
      world: p.world,
      // Pass the roster so commitNode's LIFE-NPC-6 sweep can backfill avatars
      // for NPCs missing their SVG (legacy rows + never-kicked key-NPCs).
      npcs: p.npcs,
      sceneId: p.scene?.id ?? null,
      action: opts.action,
      beats: payloads,
      introduces: opts.liveResult?.introduces ?? [],
      backdropIntent: node.backdropIntent ?? null,
    }).catch((err) => log.warn('life.node.commit-failed', { err: String(err) }));
    pushLocal([
      ...actionToLocalEvents(opts.action),
      ...payloads.map((b) => localBeatEvent(b)),
    ]);
    if (opts.liveResult) {
      handleSignals(
        opts.liveResult,
        opts.action.kind === 'free-text' ? (opts.action.investIn ?? null) : null,
      );
    }
    if (node.kind === 'question') {
      // LIFE-EX-13 RETIRED the mid-scene steal that used to live here. A
      // review no longer takes a graded slot at an arbitrary point; it fires
      // ONCE, at the scene's end, ahead of the summary card (see the
      // `tryEnterSceneReview` call on the resolve path). So a question node is
      // always a question now — which also removes the LIFE-SPEECH-5 carve-out
      // that had to exist to stop the steal eating a `say` pick's line.
      activePlanRef.current = node.gradedPlan;
      // LIFE-EX-PLAN-5: hold the pre-authored continuation until Continue.
      activeResolutionRef.current = node.resolution ?? null;
      transition({
        phase: 'question-authoring',
        nodeKind: 'question',
        options: [],
        question: null,
      });
      void authorQuestion(node.gradedPlan);
      return;
    }
    if (opts.liveResult) {
      // LIFE-NODE-11: the options came bundled with the node, so they are in
      // hand BEFORE the first beat has glided in. Held to the tail of the
      // sequence — until then the phase stays `live-loading`, so the player
      // keeps the loading placeholder rather than an empty options area
      // (LIFE-UI-12).
      const liveOptions = opts.liveResult.options;
      // LIFE-EX-13.2: the turn settles here — `settlePhase` opens an armed
      // scene review, or leaves an open one up.
      arrivals.release(() =>
        transition({ ...settlePhase('options-ready'), nodeKind: node.kind, options: liveOptions, question: null }),
      );
    } else {
      transition({
        phase: 'options-loading',
        nodeKind: node.kind,
        options: [],
        question: null,
      });
      void fetchOptions(node.kind);
    }
  }

  /** Background options call for the node on screen (LIFE-NODE-2). */
  async function fetchOptions(
    currentNodeKind: 'branch' | 'continuation',
  ): Promise<void> {
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    await awaitReplan();
    const result = await generateStepOptions({
      uid: p.uid,
      world: p.world,
      events: currentEvents(),
      scene: p.scene,
      npcs: p.npcs,
      turn: { kind: 'options', currentNodeKind },
      nonce: nonceRef.current,
    });
    if (result.nonce !== nonceRef.current) return; // LIFE-NODE-6: stale, drop.
    if (result.kind !== 'ok') {
      log.warn('life.node.options-failed', { kind: result.kind });
      // LIFE-NODE-15: the moment the player is actually SHOWN "the story hit a
      // snag". `generateStepOptions` now records WHY in the buffer, but the
      // snag itself was still console-only — so the overlay had the cause and
      // not the effect, and the one entry a player would look for after seeing
      // that screen was the one missing.
      lifeFailed('STEP', 'options failed → snag ladder shown to the player', {
        kind: result.kind,
        nodeKind: currentNodeKind,
      });
      // LIFE-NODE-11: the Continue ladder is this turn's terminal step too —
      // queued the same way, so a failure never jumps ahead of the events.
      arrivals.release(() => transition({ phase: 'options-failed', options: [], question: null }));
      return;
    }
    // Signals are not visual — they apply on arrival like the commit does,
    // never behind the pacing.
    handleSignals(result);
    arrivals.release(() =>
      transition({ ...settlePhase('options-ready'), options: result.options }),
    );
  }

  /** Live turn: generate the node to render now + its options. */
  async function runLiveTurn(opts: {
    action: CommitAction;
    /** Shared with `TurnRequest` — see LiveTurnChoice. Do NOT inline a narrower
     *  literal here; the previous copy dropped `speechAct` on the floor. */
    choice?: LiveTurnChoice | null;
    freeText?: string | null;
    practiceOutcome?: PracticeOutcome | null;
    resetTurn: boolean;
    prefetched?: Promise<GenerateStepOptionsResult> | null;
    /** LIFE-SPEECH-1: the player's spoken line on a `say` pick. Prepended
     *  immediately so the player's own bubble is on screen for the whole
     *  `live-loading` wait (LIFE-NODE-2 — every pick generates live). */
    saysLine?: PlayerSaysLine | null;
  }): Promise<void> {
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    transition({
      phase: 'live-loading',
      waitKind: waitKindForTurn({ ...opts, eventCount: p.events.length }),
      options: [],
      question: null,
      feedback: null,
      composerOpen: false,
      cardMatch: null,
    });
    if (opts.resetTurn) p.appendBubbles([], { resetTurn: true });
    await awaitReplan();
    const result = await (opts.prefetched ??
      generateStepOptions({
        uid: p.uid,
        world: p.world,
        events: currentEvents(),
        scene: p.scene,
        npcs: p.npcs,
        turn: {
          kind: 'live',
          choice: opts.choice ?? null,
          freeText: opts.freeText ?? null,
          practiceOutcome: opts.practiceOutcome ?? null,
        },
        nonce: nonceRef.current,
      }));
    if (result.nonce !== nonceRef.current) {
      // LIFE-NODE-6: hard pivot landed mid-flight. Never hang —
      // fall to the Continue ladder.
      transition({ phase: 'options-failed', options: [], question: null });
      return;
    }
    if (result.kind !== 'ok' || !result.node) {
      log.warn('life.node.live-failed', {
        kind: result.kind,
      });
      propsRef.current.onError(
        result.kind === 'error' ? result.error : new Error(`Life step failed (${result.kind})`),
        'lifeStep',
      );
      transition({ phase: 'options-failed', options: [], question: null });
      return;
    }
    arriveAtNode(result.node, {
      // LIFE-NODE-9: 'reset' marks "this arrival follows a player action", which
      // is what the beat glide keys on. `opts.resetTurn` already cleared the
      // board before the wait; re-clearing on landing is a visual no-op. The
      // resume/continue paths pass resetTurn:false and land instantly.
      action: opts.action,
      appendMode: opts.resetTurn ? 'reset' : 'append',
      liveResult: result,
      saysLine: opts.saysLine ?? null,
    });
  }

  /** LIFE-NODE-1: author the question node's chips at show time. */
  async function authorQuestion(plan: GradedPlan): Promise<void> {
    const p = propsRef.current;
    // LIFE-SPEECH-5: consumed here, whatever happens next — the fallback
    // belongs to THIS question and must never survive into the next one.
    const sayFallback = gradedSayFallback;
    gradedSayFallback = null;
    if (!p.uid || !p.world) return;
    const floor = authoringFloor(); // LIFE-NODE-10: shimmer never flashes.
    const evts = currentEvents();
    // TTS-VOICE-7 — WARM THE AUDIO NOW, not when the card mounts. BOTH
    // listening kinds' lines are already known here (see `plannedSpokenLine`),
    // a whole Gemini round-trip before the question exists, so the synthesis
    // runs inside the generation below instead of after it. Fire-and-forget:
    // it either wins the race or loses harmlessly to on-demand autoplay.
    prefetchPlannedUtterance(plan, p.world, p.speechSpeed);
    const result = await runGradedQuestionGenerate({
      plan,
      practiceLanguage: p.world.practiceLanguage,
      nativeLanguage: p.world.nativeLanguage,
      recentTargets: recentGenerationTargets(evts),
      scene: buildGradedSceneContext(p.world, evts, plan),
    });
    await floor;
    if (machineRef.current.phase !== 'question-authoring') return; // superseded
    if (result.kind !== 'ok') {
      // LIFE-NODE-8 (v2.1): GRACEFUL DEMOTE — a rejected question no longer
      // dead-ends at the "story snagged" ladder. Author normal CYOA options for
      // this node (as a branch) so the story just continues WITHOUT the quiz;
      // only a second failure (the options gen itself) falls back to the
      // recovery ladder. This is the fix for "a valid-looking graded question
      // snagged" — e.g. a name fill-blank whose translation-anchor leaks the
      // answer is correctly rejected, but the player now sees choices, not a snag.
      log.warn('life.node.question-author-failed', { reason: result.reason });
      // LIFE-EX-CADENCE-1: mark the graded slot SPENT, or the cadence directive
      // re-fires on the very next node and the demote loops.
      if (p.uid && p.world) recordDemotedSlot(p.uid, p.world.id, result.reason, pushLocal);
      activePlanRef.current = null;
      activeResolutionRef.current = null;
      if (sayFallback) {
        // LIFE-SPEECH-5: this question WAS the player's pick (LIFE-SPEECH-3),
        // so there is no node on screen to author options for — the board was
        // cleared for a question that never appeared. Degrade to the same place
        // an unusable `gradeTarget` degrades to: the ordinary `say`. The line
        // lands as the player's own bubble and the world reacts to it.
        //
        // `action: 'none'` because the arrival that showed the question already
        // committed the decision — a second one would double-log the pick.
        void runLiveTurn({
          action: { kind: 'none' },
          choice: {
            id: sayFallback.option.id,
            practiceText: sayFallback.option.practiceText,
            speechAct: sayFallback.option.speechAct,
            saysLine: sayFallback.saysLine?.practiceText ?? null,
          },
          resetTurn: true,
          saysLine: sayFallback.saysLine,
        });
        return;
      }
      transition({ phase: 'options-loading', nodeKind: 'branch', question: null });
      void fetchOptions('branch');
      return;
    }
    transition({
      phase: 'question-ready',
      question: {
        // TTS-VOICE-7: the line the player HEARS is the line that was warmed.
        practicePrompt: pinPlannedUtterance(result.practicePrompt, plan),
        spokenLine: plannedSpokenLine(plan), // TTS-VOICE-7: warmed == spoken.
        choices: result.choices,
      },
    });
  }

  /** Graded chip pick → feedback + prefetch (LIFE-NODE flow). */
  function gradePick(chipId: string): void {
    const q = machineRef.current.question;
    if (!q) return;
    const choice = q.choices.find((c) => c.id === chipId);
    if (!choice) return;
    resolveGraded(choice, choice.correctness === 'correct');
  }

  // LIFE-EX-8/11: text-answer graders (type-to-fill, word-order) — extracted for
  // the LOC cap. `resolveGraded` is a hoisted declaration below.
  const textGraders = createTextGraders({ machineRef, resolveGraded });

  /** Shared graded-resolution core (chip pick OR typed answer): build the
   *  feedback from the picked answer + correctness, transition to the
   *  feedback overlay, and prefetch the post-outcome live turn. */
  function resolveGraded(picked: StepChoice, correct: boolean): void {
    const q = machineRef.current.question;
    if (!q) return;
    // The whole shape of the overlay is a pure function of the answered
    // question — extracted to `nodeEngineFeedback.ts` for the LOC cap.
    const feedback = buildFeedbackState({
      question: q,
      plan: activePlanRef.current,
      picked,
      correct,
    });
    transition({ phase: 'feedback', feedback });
    // Prefetch the post-feedback live turn while the overlay is up — UNLESS the
    // question node pre-authored its continuation (LIFE-EX-PLAN-5), in which
    // case there is nothing to fetch. This `if` is where the saving actually
    // happens: the prefetch hid the latency but still paid for a full
    // ~15.9k-input call on every graded turn.
    const p = propsRef.current;
    if (p.uid && p.world && !activeResolutionRef.current) {
      // LIFE-SPEECH-6: hand the model the line it is about to see on screen.
      const outcome = practiceOutcomeFromFeedback(feedback, buildResolvedBubble(feedback));
      prefetchRef.current = generateStepOptions({
        uid: p.uid,
        world: p.world,
        events: currentEvents(),
        scene: p.scene,
        npcs: p.npcs,
        turn: { kind: 'live', practiceOutcome: outcome },
        nonce: nonceRef.current,
      });
    }
  }

  /**
   * LIFE-SCENE-24: start a scene because the world has none.
   *
   * This replaces the hook handshake. `LIFE-ARC-PACE-3` measured that
   * handshake producing ZERO scenes across two harness runs — the model was
   * asked to offer a pitch "every 5-10 nodes" and never did, so no chapter
   * could end, because a chapter ends only when a scene resolves. A request
   * the model can satisfy by doing nothing is not a mechanism, so the request
   * is gone and the engine simply starts one.
   *
   * Fire-and-forget on purpose: the turn that discovered the gap continues
   * immediately, and the scene lands on the `useLifeScene` subscription a
   * moment later. Blocking the turn on a ~2s generation would put a wait in
   * front of the player for something they did not ask for.
   */
  function startSceneIfNone(): void {
    const p = propsRef.current;
    if (!p.uid || !p.world || p.scene || sceneStartRef.current) return;
    // One in flight at a time. Without this, every turn taken while the first
    // generation is still running kicks another — and each one WRITES an
    // active scene doc, so the last to land silently replaces the story the
    // player was already three turns into.
    sceneStartRef.current = true;
    void startScene({ uid: p.uid, world: p.world })
      .catch((err) => {
        log.warn('life.scene.start-failed', { err: String(err) });
      })
      .finally(() => {
        sceneStartRef.current = false;
      });
  }

  function pick(choiceId: string): void {
    const s = machineRef.current;
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    if (s.phase === 'question-ready') {
      gradePick(choiceId);
      return;
    }
    if (s.phase === 'options-failed') {
      // LIFE-NODE-8: the only chip is the client Continue.
      if (choiceId === CONTINUE_AFTER_FAILURE_ID) {
        void runLiveTurn({ action: { kind: 'none' }, resetTurn: true });
      }
      return;
    }
    if (s.phase !== 'options-ready') return;
    if (choiceId === '__resume__') {
      void runLiveTurn({ action: { kind: 'none' }, resetTurn: true });
      return;
    }
    if (choiceId === WRITE_YOUR_OWN_ID) {
      // LIFE-NODE-4: swap chips for the composer.
      transition({ composerOpen: true });
      return;
    }
    const option = s.options.find((o) => o.id === choiceId);
    if (!option) return;
    const action: CommitAction = {
      kind: 'choice',
      choiceId: option.id,
      text: option.practiceText,
      // LIFE-GRID-4: what KIND of move this was, onto the log. Without it the
      // grid's cross-turn memory is empty on every reload and the model is
      // back to being told nothing about what it has already offered.
      // SPREAD, not assigned: an option with no `actionType` must produce the
      // same action object it always did, not one carrying `undefined` keys.
      ...(option.actionType ? { actionType: option.actionType } : {}),
      ...(option.targetId ? { targetId: option.targetId } : {}),
    };
    // LIFE-SPEECH-3: a `say` option that declared a `gradeTarget` is the GATED
    // form of itself — the player produces the line instead of being handed it.
    // Intercept HERE, before the bubble is prepended, because after that there
    // is no unspoken line left to intercept (which is exactly why outbound
    // fill-blanks stopped firing at all).
    //
    // Routed through `arriveAtNode` with a synthesised question node rather
    // than a bespoke path: authoring, the card-match steal (LIFE-EX-10), the
    // grading overlay, `buildResolvedBubble` and the post-outcome prefetch are
    // then all the SAME code the model-authored question node runs. The only
    // difference is who built the plan.
    const sayPlan = gradedSayPlan(option, recentGenerationTargets(currentEvents()));
    if (sayPlan) {
      // LIFE-SPEECH-5: arm the degrade BEFORE the arrival, because the arrival
      // synchronously starts `authorQuestion`, which consumes it. If the
      // generator can't author this question the pick becomes the ordinary
      // `say` rather than a fresh options set with the player's line dropped.
      gradedSayFallback = { option, saysLine: option.saysLine ?? null };
      arriveAtNode(
        // LIFE-CONTRACT-EX-6: no lead-in on the CLIENT-intercepted say. The
        // player's own line IS the tested sentence, so there is no prior
        // action to narrate — the pick and the speech are the same act.
        { kind: 'question', beats: [], gradedPlan: sayPlan },
        { action, appendMode: 'reset', liveResult: null, saysLine: null },
      );
      return;
    }
    // LIFE-SPEECH-1: a non-graded `say` option carries the player's spoken line.
    // It is prepended immediately, so on a speech pick the player's own bubble
    // is on screen for the whole `live-loading` wait rather than dead air.
    const saysLine = option.saysLine ?? null;
    // LIFE-NODE-2: every pick is a live generation now — the lookahead cache
    // (and with it the `cacheFresh` guard) is gone.
    void runLiveTurn({
      action,
      choice: {
        id: option.id,
        practiceText: option.practiceText,
        // LIFE-SPEECH-1: the direction lock projects across the call boundary,
        // and LIFE-SPEECH-2: so does the LINE, which the client is about to
        // render as the player's own bubble — the model must not stage it again.
        speechAct: option.speechAct, saysLine: saysLine?.practiceText ?? null,
      },
      resetTurn: true,
      saysLine,
    });
  }

  function feedbackContinue(): void {
    const fb = machineRef.current.feedback;
    if (!fb) return;
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    // LIFE-CONTRACT-EX-3: the bubble for the practised line lands NOW.
    const resolved = buildResolvedBubble({
      outcomeKind: fb.outcomeKind, promptSource: fb.promptSource,
      correctAnswer: fb.correctAnswer,
      speakerName: fb.speakerName, npcId: fb.npcId,
      // LIFE-LANG-6/12: the resolved bubble's system-language gloss (the
      // same faithful full-sentence translation the feedback overlay
      // showed) so the revealed line is bilingual + viewMode-aware.
      nativeText: fb.sentenceNative, lineVocab: fb.lineVocab,
    });
    const beat: LifeBeatPayload = {
      speaker: resolved.speaker,
      speakerName: resolved.speakerName ?? null,
      npcId: resolved.npcId ?? null,
      practiceText: resolved.practiceText,
      nativeText: resolved.nativeText ?? null,
      // POST-PHASE-E: annotations ride the resolved line (outbound =
      // the correct chip's annotations). If ResolvedBubble lacks
      // these fields, Phase E did not land as pinned — STOP.
      complexWords: resolved.complexWords,
      wordTranslations: resolved.wordTranslations,
    };
    p.appendBubbles(
      [
        {
          id: resolved.id,
          speaker: resolved.speaker,
          speakerName: resolved.speakerName ?? null,
          npcId: resolved.npcId ?? null,
          practiceText: resolved.practiceText,
          nativeText: resolved.nativeText,
          complexWords: resolved.complexWords,
          wordTranslations: resolved.wordTranslations,
        },
      ],
      { resetTurn: true },
    );
    // LIFE-VOCAB-RECAP-7: one builder for both sites — this is the copy that
    // reaches Firestore via commitNode, the other feeds the prefetch, and a
    // divergence would mean the stored event disagreed with the context the
    // model was given for the same answer.
    const outcome = practiceOutcomeFromFeedback(fb, resolved);
    // NB: the story no longer credits SRS (flashcard threading removed,
    // 2026-07). Saved vocabulary is captured from the story and reviewed in
    // the dedicated practice session, which owns all SM-2 state. The
    // `correction` event still records the miss for the future
    // wurld-mistakes-practice backlog (LIFE-EX-SRS §19).
    // Correction event + resolved-line beat (+ NPC promotion via the
    // beat loop) — LIFE-NODE-3.
    void commitNode({
      uid: p.uid,
      world: p.world,
      // LIFE-NPC-6 roster sweep — backfill missing NPC avatars/SVGs.
      npcs: p.npcs,
      sceneId: p.scene?.id ?? null,
      action: { kind: 'practice-outcome', outcome },
      beats: [beat],
      backdropIntent: null,
    }).catch((err) => log.warn('life.node.commit-failed', { err: String(err) }));
    pushLocal([localCorrectionEvent(outcome), localBeatEvent(beat)]);
    const prefetched = prefetchRef.current;
    prefetchRef.current = null;
    activePlanRef.current = null;
    const resolution = takeResolution(activeResolutionRef);
    // LIFE-EX-PLAN-5: the question node already authored what happens next —
    // render it from memory, no post-feedback call. Valid whatever the player
    // picked because LIFE-CONTRACT-EX-3 forbids forking on correctness.
    if (resolution) return void arriveAtResolution(resolution, nonceRef.current, arriveAtNode);
    // No resolution (older response, or a card-match review) — live turn, as
    // before. The correction is already committed, so this lands as 'none'.
    void runLiveTurn({
      action: { kind: 'none' },
      practiceOutcome: outcome,
      resetTurn: false,
      prefetched,
    });
  }

  return {
    prefetchOpening,
    startOpening: () => {
      void runLiveTurn({
        action: { kind: 'none' },
        resetTurn: false,
        // LIFE-BACKDROP-21: the intro-time prefetch, when there was one. Null on
        // a path that never showed the intro — `runLiveTurn` then fetches.
        prefetched: openingPrefetchRef.current,
      });
    },
    startResume: (option: StepOption) => {
      transition({ phase: 'options-ready', nodeKind: 'continuation', options: [option] });
    },
    continueTurn: () => {
      void runLiveTurn({ action: { kind: 'none' }, resetTurn: true });
    },
    pick,
    // LIFE-EX-8/11: type-to-fill + word-order submits (fill-blank rendered as a
    // text input / a word bank instead of chips).
    submitTyped: textGraders.gradeTyped,
    submitOrder: textGraders.gradeOrder,
    closeComposer: () => {
      transition({ composerOpen: false });
    },
    submitFreeText: (text: string, investIn?: string | null) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // LIFE-NODE-6: free text invalidates every cached preview.
      nonceRef.current += 1;
      void runLiveTurn({
        action: { kind: 'free-text', text: trimmed, investIn: investIn ?? null },
        freeText: trimmed,
        resetTurn: true,
      });
    },
    feedbackContinue,
    completeCardMatch: cardMatch.completeCardMatch,
  };
}
