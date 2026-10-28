/**
 * LIFE-NODE-2: the generation half of the node engine. ONE Gemini
 * call per player action:
 *
 *   turn {kind:'live'}    → node to render now + its options.
 *   turn {kind:'options'} → options for the node already on screen
 *                           (committed as the newest events).
 *
 * PURE — no writes (WS1-C removed the compaction probe, LIFE-MEM-1).
 * All node / turn writes live in commitNode.ts (LIFE-NODE-3).
 *
 * Failure ladder (LIFE-NODE-8): schema failure → one retry with the
 * issues attached → 'schema-failed'. A graded plan's KIND is never on that
 * ladder — it is derived from the plan's own fields at the parse seam
 * (LIFE-EX-18), so there is no mismatch left to retry or repair.
 *
 * LIFE-NODE-15: every rejection on that ladder ALSO reaches the life debug
 * ring buffer, not just the browser console. `log.warn` was the only reporter
 * here, so a snagged turn showed the in-app overlay nothing at all — and two
 * rejections (invalid JSON, wrong shape for the turn) reported nowhere at all.
 * The buffer is what survives a route change; the console is not.
 *
 * Spec: docs/specs/life-sim.md §10.46.
 */
import { generateWithTransportRetry } from './generateWithRetry';
import * as log from '../log';
import { buildLifeStepSpec } from './stepSpec';
import type { StepViolation } from '@/lib/practicePromptSpec';
import { LIFE_PRIMARY_MODEL, LIFE_TEMPERATURE } from './modelConfig';
import { lifeDebug, lifeFailed, lifeWarn } from './debugLog';
import {
  ZRawNodeResponse,
  repairStepResponse,
  optionCountViolations,
  optionIdViolations,
  optionSpreadViolations,
  type GradedPlan,
  type NodePreview,
  type NpcMemoryUpdate,
  type RawNodeResponse,
  type StepSceneSignal,
  type StepIntroduction,
  type StepOption,
  type WorldDelta,
} from './stepSchema';
import { validateNodeResponse, type ValidatorIssue } from './validateStep';
import { stripLeakingLeadIns, testedLineOf } from './leadInBeats';
import { cadenceTier, cyoaStreak } from './prompts/stepStreaks';
import { resolveCanon } from './canon';
// LIFE-GRID-6: the dangled-goal backstop. `gradeOptionSet` lived here unused
// since it was written — the reject half of LIFE-GRID-1.1/1.2 was tested and
// never called.
import { gradeOptionSet, offeredShapes, takenShapeCounts } from './optionGrid';
import type { GradedQuestionSceneContext } from './gradedQuestionEngine';
import type {
  LifeScene,
  LifeEvent,
  LifeNpc,
  LifeWorld,
} from '@/types/firestore';

/** Generation attempts per call: one shot plus one hinted retry. */
const MAX_ATTEMPTS = 2;

/** The outcome of the just-answered graded question. Passed forward
 *  on the post-feedback live turn so the model reacts in-narrative
 *  (LIFE-CONTRACT-EX-3/4). Moved from runLifeStep.ts. */
export type PracticeOutcome = {
  kind: 'generation' | 'comprehension';
  correct: boolean;
  picked: string;
  correctAnswer: string;
  /** LIFE-VOCAB-RECAP-7: the answer's native gloss, resolved by
   *  `glossForAnswer` out of the question's `lineVocab` at the moment the
   *  outcome is built — the same lookup the feedback overlay's "It means:"
   *  line already does. Rides into the `correction` event so the day summary
   *  can offer a save button on a word the player got wrong. NOT sent to the
   *  model: `PracticeOutcomeForPrompt` is a separate, narrower type. */
  correctAnswerNative?: string | null;
  promptSource: string;
  /** LIFE-SPEECH-6: the RESOLVED line the graded turn put on screen — for a
   *  fill-blank, the player's completed sentence. Without it the post-outcome
   *  turn does not know the line was said and restages it in an NPC's mouth. */
  resolvedLine?: string | null;
  /** Who the resolved line belongs to, so the note names them correctly. */
  resolvedSpeaker?: 'user' | 'npc' | 'narrator' | null;
};

/** The option the player picked, as it rides into the live turn that resolves
 *  it. Exported because `runLiveTurn` (nodeEngineActions) must thread the same
 *  shape through — it kept its own narrower copy, and when `speechAct` was
 *  added here the copy silently dropped it, breaking the LIFE-SPEECH-1
 *  direction lock. One type, one place. */
export type LiveTurnChoice = {
  id: string;
  practiceText: string;
  /** LIFE-SPEECH-1: the direction the PICK declared. Rides into this
   *  call because the question node it may produce is authored here,
   *  one call after the option itself (LIFE-NODE-2) — without it the
   *  say->fill-blank / hear->comprehension lock has nothing to project
   *  from. */
  speechAct?: 'say' | 'act';
  /** LIFE-SPEECH-2: the option's `saysLine.practiceText`. The client puts this
   *  on screen as the player's bubble the instant they pick — one call BEFORE
   *  this one — so the model must be told it has already been said, or it
   *  stages the speech again and (barred from `user` beats) hands the player's
   *  words to an NPC. */
  saysLine?: string | null;
};

export type TurnRequest =
  | { kind: 'options'; currentNodeKind: 'branch' | 'continuation' }
  | {
      kind: 'live';
      choice?: LiveTurnChoice | null;
      freeText?: string | null;
      practiceOutcome?: PracticeOutcome | null;
    };

export type GenerateStepOptionsInput = {
  uid: string;
  world: LifeWorld;
  /** Oldest → newest, including the engine's local overlay
   *  (mergeLocalEvents) so just-committed events are visible. */
  events: LifeEvent[];
  scene?: LifeScene | null;
  npcs?: ReadonlyArray<LifeNpc>;
  turn: TurnRequest;
  /** LIFE-NODE-6: echoed back on the result so the caller can drop
   *  stale responses after a nonce bump. */
  nonce: number;
};

export type GenerateStepOptionsResult =
  | {
      kind: 'ok';
      /** Null on options turns (the node already rendered). */
      node: NodePreview | null;
      options: StepOption[];
      worldDelta?: WorldDelta;
      scene?: StepSceneSignal;
      /** LIFE-CANON-1 / LIFE-STORY-LOG-1: the turn's ledger contributions,
       *  committed alongside the node's beats. */
      introduces?: StepIntroduction[];
      logLine?: string;
      /** LIFE-NPC-MEM-1: per-NPC memory refreshes, committed via applyTurnSignals. */
      npcMemoryUpdates?: NpcMemoryUpdate[];
      /** LIFE-ARC-PACE-1: set on a result synthesised from a question node's
       *  PRE-AUTHORED resolution (LIFE-EX-PLAN-5) rather than from a `life_step`
       *  generation. Such an arrival still appends a story-log line, so it must
       *  NOT also advance the chapter's turn counter — the pace rule is written
       *  in generated turns ("~1 turn in 3 is a question"), and counting both
       *  halves of a graded turn ran the counter 1.36x fast. */
      fromResolution?: true;
      nonce: number;
    }
  | { kind: 'schema-failed'; rawAttempts: string[]; nonce: number }
  | { kind: 'error'; error: unknown; nonce: number };


export async function generateStepOptions(
  input: GenerateStepOptionsInput,
): Promise<GenerateStepOptionsResult> {
  const turn = input.turn;
  const live = turn.kind === 'live' ? turn : null;
  // Opening = first-ever live turn (same derivation the old
  // runLifeStep used: the events log is empty).
  const isOpeningBeat = live !== null && input.events.length === 0;

  const promptInputBase = {
    choice: live?.choice ?? null,
    freeText: live?.freeText ?? null,
    practiceOutcome: live?.practiceOutcome ?? null,
    isOpeningBeat,
    scene: input.scene ?? null,
    npcs: input.npcs,
    requestKind: turn.kind,
    currentNodeKind: turn.kind === 'options' ? turn.currentNodeKind : null,
  } as const;

  // WS1-C (LIFE-MEM-1): the inline compaction pass was REMOVED. The prompt body
  // is bounded by construction — the SI is sent separately, and <recentEvents>
  // renders only the last STEP_EVENT_WINDOW (LIFE-CTX-13) — so there is no
  // runaway to compact. Durable memory is the append-only <storySoFar> spine +
  // <canon>, never a lossy LLM rewrite on the critical path.
  //
  // SRV-PROMPT-8..13 batch 8: both halves are now built by
  // `functions/src/prompts/lifeStep.ts` from the spec below. Nothing here holds
  // prompt text any more, and the retry hint that used to be APPENDED to the
  // prompt travels as codes instead (SRV-PROMPT-12).
  const specFor = (retry: readonly StepViolation[]) =>
    buildLifeStepSpec({
      world: input.world,
      events: input.events,
      npcs: input.npcs ?? [],
      scene: input.scene ?? null,
      turn: {
        isOpeningBeat,
        requestKind: turn.kind,
        currentNodeKind: promptInputBase.currentNodeKind,
        choice: promptInputBase.choice
          ? {
              id: promptInputBase.choice.id,
              practiceText: promptInputBase.choice.practiceText,
              ...(promptInputBase.choice.speechAct
                ? { speechAct: promptInputBase.choice.speechAct }
                : {}),
              ...(promptInputBase.choice.saysLine
                ? { saysLine: promptInputBase.choice.saysLine }
                : {}),
            }
          : null,
        freeText: promptInputBase.freeText,
        practiceOutcome: outcomeForPrompt(promptInputBase.practiceOutcome),
      },
      retry,
    });

  // LIFE-CONTRACT-EX-4: the practiced line for the never-repeat
  // validator (live post-feedback turns only).
  const practicedLine =
    live?.practiceOutcome?.kind === 'generation'
      ? live.practiceOutcome.promptSource.replace(
          /_{2,}/,
          live.practiceOutcome.correctAnswer,
        )
      : live?.practiceOutcome?.kind === 'comprehension'
        ? live.practiceOutcome.promptSource
        : null;

  const attempts: string[] = [];
  /** SRV-PROMPT-12 — the critic's verdict as CODES. The server renders the
   *  words and appends the block; this array is what used to be a string of
   *  prose built at five sites and glued onto the prompt. */
  let retry: StepViolation[] = [];
  /** LIFE-NODE-15(b): the reason the MOST RECENT attempt was rejected, carried
   *  to the terminal `schema-failed` entry so the last line of the debug buffer
   *  says WHY the turn snagged. Mirrors `runGradedQuestionGenerate`'s
   *  `exhausted-retries: <last violation>` (LIFE-EX-GEN-9). */
  let lastReason: string | null = null;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    let raw: string;
    try {
      // LIFE-NODE-14: the TRANSPORT is retried underneath this attempt, on its
      // own budget. A dropped socket says nothing about the model's output, so
      // it must not spend one of the two content retries below — and it must
      // not `return` out of the ladder, which is how one network blip became
      // the "story hit a snag" screen.
      raw = await generateWithTransportRetry({
        // PRACTICE-OWN-5 shape: no prose on the wire at all. The retry verdict
        // rides inside the spec rather than being appended to a prompt the
        // client no longer holds.
        promptSpec: specFor(i === 0 ? [] : retry),
        model: LIFE_PRIMARY_MODEL,
        // life-sim thinking A/B, 2026-07-25 (N=4/level, real prompts,
        // cache-aware pricing). 'medium' spent 610 thinking tokens per
        // turn for no measurable gain — schema validity was 4/4 at
        // every level — while costing 16.5% more and, critically, 2.9x
        // the latency on the ONE call the player waits on every turn
        // (8557ms -> 2912ms). 'low' was worse than 'medium' (925
        // thinking tokens); emission is non-deterministic, so the only
        // safe setting is off. Note thinking counts against
        // maxOutputTokens, so it can also truncate the JSON and burn a
        // retry.
        thinkingLevel: 'minimal',
        responseMimeType: 'application/json',
        category: 'life_step',
        temperature: LIFE_TEMPERATURE,
        // LIFE-COST-3: i > 0 is a regeneration after a schema/validator
        // rejection — surfaced in telemetry so the retry rate is measured.
        attempt: i,
      });
    } catch (err) {
      log.warn('life.node.gen-failed', { attempt: i, err: String(err) });
      // LIFE-NODE-15(a): the turn is being ABANDONED — the player is about to
      // see the snag ladder (LIFE-NODE-8) — so this is the single most
      // important thing the overlay can show, and it used to show nothing.
      // The transport ladder is already spent by here (LIFE-NODE-14), so any
      // retries it made are above this entry in the buffer.
      lifeFailed('STEP', 'step gen threw → turn abandoned', {
        attempt: i,
        requestKind: turn.kind,
        err: String(err),
      });
      return { kind: 'error', error: err, nonce: input.nonce };
    }
    attempts.push(raw);
    const parsed = safeParseJson(raw);
    if (!parsed) {
      retry = [{ code: 'invalid-json' }];
      lastReason = 'invalid-json';
      // LIFE-NODE-15(a): this path reported NOWHERE before — not even a
      // console warn — and it is the most common real rejection (a truncated
      // response), so it is the one the buffer most needs to name. The raw
      // sample is bounded at 600 chars: enough to see the truncation point
      // without pasting a whole response into a debug list.
      // LIFE-NODE-15(c): the sample is the HEAD of the response, so it can
      // never show WHY the parse failed — every failure looks like valid JSON
      // in its first 600 chars. Reported 2026-08-03: two invalid-JSON
      // rejections in one session with no way to tell a truncated response
      // from a malformed one, which is the difference between raising an
      // output cap and fixing a prompt. `finishReason` is not surfaced through
      // the Cloud Function envelope, so these three fields are the evidence
      // that IS available: a response that stops mid-structure ends without its
      // closing brace, and its length says whether it stopped near a ceiling.
      const trimmed = raw.trimEnd();
      lifeFailed('STEP', 'step rejected: invalid JSON', {
        attempt: i,
        requestKind: turn.kind,
        chars: raw.length,
        endsAbruptly: !trimmed.endsWith('}'),
        tail: trimmed.slice(-120),
        responseSample: raw.slice(0, 600),
        retry,
      });
      continue;
    }
    // LIFE-NODE-16: mend the defects that have one correct reading before the
    // strict schema judges the response. 7% of a measured run's step responses
    // failed the parse and most of those failures were invisible — a silent
    // regeneration of the app's most expensive call, spent on a mislabelled
    // node kind or a `null` where a field could simply have been omitted.
    const strict = ZRawNodeResponse.safeParse(repairStepResponse(parsed));
    const response: RawNodeResponse | null = strict.success ? strict.data : null;
    if (!response) {
      const issueDetail = strict.success
        ? []
        : strict.error.issues.slice(0, 6).map((iss) => ({
            path: iss.path.join('.'),
            message: iss.message,
          }));
      log.warn('life.node.schema-failed', {
        attempt: i,
        issues: issueDetail,
        responseSample:
          typeof parsed === 'object'
            ? JSON.stringify(parsed).slice(0, 600)
            : String(parsed).slice(0, 600),
      });
      retry = issueDetail.map((iss) => ({
        code: 'schema-issue' as const,
        path: iss.path,
        message: iss.message,
      }));
      lastReason = `schema: ${issueDetail.map((iss) => `${iss.path} ${iss.message}`).join('; ') || 'unknown'}`;
      // LIFE-NODE-15(a): the issues go in STRUCTURED (path + message per
      // issue), not as a pre-joined string — the overlay renders the payload
      // as JSON, so a reader gets one line per fault instead of having to
      // re-read a ZodError. The `retry` VERDICT rides along so what the model
      // was actually asked to fix is visible without reconstructing it from
      // source — codes since SRV-PROMPT-8..13 batch 8, because the sentences
      // are server-side and re-rendering them here for a log line would be the
      // duplication SRV-PROMPT-3 forbids.
      lifeFailed('STEP', 'step rejected: schema', {
        attempt: i,
        requestKind: turn.kind,
        issues: issueDetail,
        responseSample:
          typeof parsed === 'object'
            ? JSON.stringify(parsed).slice(0, 600)
            : String(parsed).slice(0, 600),
        retry,
      });
      continue;
    }

    // Request-shape rules the schema can't know.
    const shaped = applyRequestShape(response, turn);
    if (shaped.issues.length > 0) {
      retry = shaped.issues;
      lastReason = `wrong shape: ${shaped.issues.map((v) => v.code).join('; ')}`;
      // LIFE-NODE-15(a): the other path that reported nowhere. A live turn
      // that came back with no node is a full regeneration, and it was
      // invisible in both the console and the overlay.
      lifeFailed('STEP', 'step rejected: wrong shape for this turn', {
        attempt: i,
        requestKind: turn.kind,
        issues: shaped.issues.map((v) => v.code),
        retry,
      });
      continue;
    }
    let final = shaped.response;

    // LIFE-LANG-13.1 — THE PLAYER'S OWN BUBBLE COSTS A SLOT.
    //
    // `LIFE-LANG-13(c)` already says the revealed practised line "counts as one
    // of the turn's ~2 visible beat slots, so the post-practiceOutcome live
    // node adds AT MOST ONE more beat". That rule was written for the GRADED
    // path and stops there — but a `say` option and a free-text turn ALSO put a
    // client-built bubble on screen before this call runs
    // (`LIFE-CONTRACT-BUBBLE-2`), and nothing charged them for it. So the model
    // was free to answer with two fresh beats on top of the player's own: three
    // bubbles into two visible slots, and the overflow scrolls into the next
    // turn's window. Reported as "I choose to say something, then 2 other
    // events land, and those count into the next turn's quota".
    //
    // The SI now states the budget (see `saidBlock` in prompts/step.ts) and
    // this clamps it, because a stated budget is a request and a slice is a
    // guarantee — the lesson `LIFE-ARC-PACE-*` keeps relearning about
    // quantities the model cannot observe.
    //
    // Keeps the FIRST beat: beats are in narrative order, so it is the reply or
    // reaction that follows the player's line. The tail is what would have
    // scrolled the player's own words out of view.
    const playerSpokeThisTurn = Boolean(
      live?.choice?.saysLine?.trim() || live?.freeText?.trim(),
    );
    if (
      playerSpokeThisTurn &&
      final.node &&
      final.node.kind !== 'question' &&
      final.node.beats.length > 1
    ) {
      const clampReason = live?.freeText?.trim() ? 'free-text' : 'says-line';
      log.warn('life.node.beat-budget-clamped', {
        was: final.node.beats.length,
        reason: clampReason,
      });
      // LIFE-NODE-15(c): `lifeWarn`, NOT `lifeFailed`. Nothing failed — the
      // response was trimmed in place and the turn ships. This clamp fires on
      // the ORDINARY `say` turn, so a `-FAILED` tag here would stamp every
      // healthy speech turn and bury the real failures in the overlay.
      lifeWarn('STEP', 'beat budget clamped to 1 (player already spoke)', {
        was: final.node.beats.length,
        now: 1,
        reason: clampReason,
      });
      final = {
        ...final,
        node: { ...final.node, beats: final.node.beats.slice(0, 1) },
      };
    }

    // LIFE-EX-18 — the say/hear -> kind REPAIR lived here and is DELETED.
    //
    // It inferred the graded kind from the PICK and rewrote the plan to match.
    // Both of its branches are now wrong or redundant:
    //
    //   `hear` pick + a player-line plan -> it flipped the plan to comprehension,
    //   which moves `sentenceContext` (the line the PLAYER was about to say) into
    //   `npcUtterance`, an NPC's mouth. Measured in `LIFE-SPEECH-7`: 2 of 4 `hear`
    //   picks did exactly this, because the model tags AMBIENT SOUND as `hear`.
    //
    //   `say` pick + an NPC-line plan -> it flipped to fill-blank, but
    //   `LIFE-SPEECH-4` explicitly ALLOWS a comprehension of the reply after a
    //   say pick and calls it the natural move. So the repair was overriding a
    //   legitimate authoring choice.
    //
    // `ZGradedPlan` now derives the kind from the fields at the parse seam, so
    // there is no mismatch left to guess at. A guess that can corrupt the turn is
    // worse than no guess when the truth is already in the data.

    // LIFE-CANON-2: the ONE canon fault worth a retry — an option that names
    // an entity the story never established ("names someone who hasn't
    // appeared"). It used to only `log.warn`, so it shipped regardless; now it
    // spends a retry with the offending option in the hint. In practice it
    // almost never fires (the model reliably targets real ids), which is what
    // a safeguard should be. Affordance ("speak to a mute entity") is NOT here
    // by design — measuring it against real Gemini showed the model already
    // keeps such an entity mute, so rejecting the option only suppressed a
    // legitimate action; the mute-response rendering is fixed at commit time.
    // LIFE-GRID-6 — the DANGLED GOAL, and the first time `gradeOptionSet` has
    // ever been CALLED. It was written as the reject half of LIFE-GRID-1.1/1.2,
    // unit-tested, and wired to nothing: the prompt half shipped and the
    // backstop sat dead, which is why "do not offer that shape again" was
    // advice rather than a rule and 12.6% of picks were re-offered.
    //
    // It fires on 2.2% of grids across the 1,980-grid archive, against this
    // module's own ~15% ceiling for a backstop. The spread rules it used to
    // carry now live in `optionSpreadIssues`, which runs ~150 lines above at
    // the request-shape stage; see the note on `gradeOptionSet`.
    const shapes = offeredShapes(final.options);
    if (shapes.length >= 2) {
      const verdict = gradeOptionSet(shapes, takenShapeCounts(input.events));
      if (!verdict.ok && i < MAX_ATTEMPTS - 1) {
        lifeFailed('STEP', `option grid rejected: dangled-goal → retrying`, {
          attempt: i,
          goal: verdict.goal,
          takes: verdict.takes,
        });
        retry = [{ code: 'dangled-goal', goal: verdict.goal, takes: verdict.takes }];
        lastReason = `grid: dangled-goal ${verdict.goal}`;
        continue;
      }
      if (!verdict.ok) {
        // LIFE-NODE-8 never strands the player behind a validator: on the last
        // attempt the grid ships, and the miss is a warning rather than a wall.
        lifeWarn('STEP', 'option grid rejected with no retry left → shipping', {
          violation: 'dangled-goal',
          goal: verdict.goal,
        });
      }
    }

    // LIFE-CONTRACT-EX-8 — REPAIR the leaked lead-in, before anything judges it.
    //
    // Reported 2026-08-07 with a screenshot: the NPC's line landed as a bubble
    // (with its native translation) and the comprehension card underneath then
    // asked what she had just said; answering emitted the line a SECOND time as
    // the resolution bubble. `LIFE-CONTRACT-EX-6` already detected this and
    // spent a retry on it — but `LIFE-CONTRACT-EX-7`, shipped the day before the
    // report, hints "what they did, and the world reacting to it", and for a
    // comprehension the world reacting IS the tested line. With MAX_ATTEMPTS=2
    // the ladder can only go: omit → rejected → obey the hint → leak → SHIP.
    // A retry cannot resolve a rule pair that points at each other, so the leak
    // is now removed rather than argued with. Ordering is the point: what
    // survives is what EX-7 judges, so a node whose only beat was the leak is
    // told it narrated nothing — the complaint that is actually true.
    if (final.node?.kind === 'question') {
      const kept = stripLeakingLeadIns(final.node.beats, final.node.gradedPlan);
      if (kept !== final.node.beats) {
        lifeWarn('STEP', 'lead-in leaked the tested line → beat stripped', {
          dropped: final.node.beats.length - kept.length,
          kept: kept.length,
          tested: testedLineOf(final.node.gradedPlan),
        });
        final = { ...final, node: { ...final.node, beats: [...kept] } };
      }
    }

    const crossTurnIssues = validateNodeResponse(
      { node: final.node ?? null, options: final.options },
      {
        practicedLine,
        canon: resolveCanon(input.world, input.npcs ?? []),
        introduces: final.introduces ?? [],
        // LIFE-CONTRACT-EX-7: the pick this turn is answering. Absent on an
        // options-only turn and on the opening beat, which is correct — there
        // is no action to have gone missing.
        pickedSpeechAct: live?.choice?.speechAct ?? null,
      },
    );
    // LIFE-CONTRACT-EX-6 joins the canon fault as BLOCKING, and LIFE-CONTRACT-EX-7
    // joins them. The warn-only codes describe a turn that is worse than it
    // should be; these three describe a turn that does not work — an option
    // pointing at nothing, a question whose answer is already on screen, or a
    // question that deleted the action the player just took. Each costs the
    // player the moment itself.
    const blocking = crossTurnIssues.filter(
      (iss) =>
        iss.code === 'unknown-entity-ref' ||
        iss.code === 'lead-in-leaks-tested-line' ||
        iss.code === 'question-omits-lead-in',
    );
    // Only the canon faults block, and only while a retry remains. The
    // duplicate-text / repeats-practiced-line issues stay warn-only (their
    // retry budget is spent upstream), and on the LAST attempt everything is
    // shipped — the player is never stuck behind a validator (LIFE-NODE-8).
    const willRetry = blocking.length > 0 && i < MAX_ATTEMPTS - 1;
    if (crossTurnIssues.length > 0) {
      const issues = crossTurnIssues.map((iss) => iss.code);
      // LIFE-NODE-15 / SRV-PROMPT-12: the log prints CODES now, because the
      // sentences live server-side. Re-rendering them here to keep the old log
      // text would be exactly the duplication SRV-PROMPT-3 forbids, and nothing
      // parses either line — checked, not assumed.
      log.warn('life.node.validator-issues', {
        issues,
        blocking: blocking.length,
        attempt: i,
      });
      // LIFE-NODE-15: the SAME check reads two ways, so it logs two ways. A
      // blocking canon fault with a retry left costs the player a full
      // regeneration → `lifeFailed`. Anything else SHIPS (LIFE-NODE-8 never
      // strands the player behind a validator) → `lifeWarn`, because the turn
      // the player is looking at is the one that was warned about, and calling
      // that FAILED in the overlay would be wrong.
      const entry = willRetry ? lifeFailed : lifeWarn;
      // LIFE-NODE-15.1: name the rule that ACTUALLY fired. This summary was the
      // fixed string "canon (unknown entity)", but `blocking` is three codes and
      // only one is a canon fault — measured over the 2026-08-07 archive the
      // split was `question-omits-lead-in` 15 / `unknown-entity-ref` 2, so 83%
      // of retries were reported as a fault they had nothing to do with. That
      // mislabel is why "many life steps failed" could not be diagnosed from
      // the overlay: it pointed at the entity ledger while the real cause was
      // the SI contradicting itself about question beats (LIFE-CONTRACT-EX-9).
      const blockingCodes = blocking.map((iss) => iss.code).join('; ');
      entry(
        'STEP',
        willRetry
          ? `step rejected: ${blockingCodes} → retrying`
          : 'validator issues shipped anyway (no retry left / non-blocking)',
        // LIFE-NODE-15.1 — the codes AND their parameters. Codes alone would
        // lose the offending id, which is the single most useful thing in this
        // entry: "unknown-entity-ref" says which rule fired, `targetId` says
        // what to go and look at. SRV-PROMPT-12 moved the SENTENCE server-side,
        // not the facts.
        { attempt: i, issues, verdict: blocking.map(crossTurnViolation), blocking: blocking.length },
      );
    }
    if (willRetry) {
      retry = blocking.map(crossTurnViolation);
      lastReason = blocking.map((iss) => iss.code).join('; ');
      continue;
    }

    lifeDebug(
      'STEP',
      `${turn.kind} turn — node=${final.node?.kind ?? 'none'}, ${final.options.length} options`,
      {
        requestKind: turn.kind,
        nodeKind: final.node?.kind,
        // LIFE-NPC-8: `introduces` is the channel that says WHO a new
        // character is, and it was absent from this payload — so a trace of
        // the exact turn that mis-described an NPC could not show whether the
        // model had supplied a note or not. Logged now, because that is the
        // first question anyone debugging this class of bug will ask.
        introduces: final.introduces ?? [],
        // LIFE-CONTRACT-EX-8 (observability): question nodes used to log
        // `beats: []` UNCONDITIONALLY, from the era when they were beatless by
        // construction. `LIFE-CONTRACT-EX-6` gave them beats and this line was
        // not revisited — so when the 2026-08-07 leak was reported, the trace of
        // the exact turn that leaked showed `beats: []`, i.e. the one field that
        // would have named the fault was hard-coded to hide it. Every node kind
        // logs what it actually carries.
        beats: (final.node?.beats ?? []).map((b) => ({
          speaker: b.speaker,
          speakerName: b.speakerName ?? undefined,
          practiceText: b.practiceText,
        })),
        options: final.options.map((o) => ({
          id: o.id,
          practiceText: o.practiceText,
          actionType: o.actionType ?? undefined,
          speechAct: o.speechAct ?? 'act',
        })),
        backdropIntent: final.node?.backdropIntent ?? undefined,
        // LIFE-EX-CADENCE-3 — the cadence state and whether the model HONOURED
        // it. This was the missing measurement: the July note asked for the
        // correction/decision ratio to be re-measured on a real chapter, and
        // nothing recorded a deferral, so twelve turns with one question looked
        // exactly like twelve turns where none were due. A `deferred: true` row
        // is now the visible symptom of the failure it names.
        cadence: cadenceTier(cyoaStreak(input.events)),
        cadenceDeferred:
          cadenceTier(cyoaStreak(input.events)) !== 'none' &&
          final.node?.kind !== 'question',
      },
    );
    return {
      kind: 'ok',
      node: final.node ?? null,
      options: final.options,
      worldDelta: final.worldDelta,
      scene: final.scene,
      introduces: final.introduces,
      logLine: final.logLine,
      npcMemoryUpdates: final.npcMemoryUpdates,
      nonce: input.nonce,
    };
  }

  // LIFE-NODE-15(b) — ONE terminal entry, naming the LAST reason.
  //
  // This is the return the player sees as "the story hit a snag" (LIFE-NODE-8),
  // and it is the line someone opens the overlay to find. Each attempt above
  // logged its own rejection, but scanning back through them to work out which
  // one actually ended the turn is exactly the re-derivation this invariant
  // exists to remove — so the last reason is restated here. Same shape as
  // `runGradedQuestionGenerate`'s `exhausted-retries: <last violation>`
  // (LIFE-EX-GEN-9), because they are read side by side on a graded turn.
  lifeFailed('STEP', 'step exhausted retries → snag', {
    attempts: MAX_ATTEMPTS,
    requestKind: turn.kind,
    lastReason: lastReason ?? 'unknown',
    responseSample: attempts[attempts.length - 1]?.slice(0, 600) ?? null,
  });
  return { kind: 'schema-failed', rawAttempts: attempts, nonce: input.nonce };
}

/* `sanitizeOptions` was deleted with the lookahead (LIFE-NODE-2/5). It parsed
 * the envelope with `next` untyped and demoted individually-broken previews to
 * `noPreview` so one malformed preview couldn't cost the whole response a
 * retry. With no previews the only thing left to be malformed is the node
 * itself, and a broken node has nothing to salvage — it goes straight to the
 * retry, same as before. */

/** Request-shape rules: live turns must carry a node; options turns
 *  must not (a stray node is DROPPED, not retried); option counts
 *  must match the (known) current node kind. */
function applyRequestShape(
  response: RawNodeResponse,
  turn: TurnRequest,
): { response: RawNodeResponse; issues: StepViolation[] } {
  if (turn.kind === 'live') {
    if (!response.node) {
      return { response, issues: [{ code: 'live-turn-missing-node' }] };
    }
    return { response, issues: [] };
  }
  const withoutNode = response.node ? { ...response, node: undefined } : response;
  return {
    response: withoutNode,
    issues: [
      ...optionCountViolations(withoutNode.options, turn.currentNodeKind),
      ...optionSpreadViolations(withoutNode.options, turn.currentNodeKind),
      ...optionIdViolations(withoutNode.options),
    ],
  };
}

/**
 * SRV-PROMPT-12 — a BLOCKING cross-turn issue as the code the server renders.
 *
 * Only the three blocking codes ever reached the prompt: the warn-only ones
 * (`duplicate-practice`, `duplicate-native`, `node-repeats-practiced-line`)
 * ship rather than retry, so they have never been in a retry hint and do not
 * travel. `unknown-entity-ref` carries the two ids its sentence quotes and
 * NOTHING ELSE — the rest of that sentence is fixed text the server holds.
 */
function crossTurnViolation(issue: ValidatorIssue): StepViolation {
  if (issue.code === 'unknown-entity-ref') {
    return {
      code: 'unknown-entity-ref',
      optionId: issue.optionId ?? '',
      targetId: issue.targetId ?? '',
    };
  }
  if (issue.code === 'lead-in-leaks-tested-line') return { code: 'lead-in-leaks-tested-line' };
  return { code: 'question-omits-lead-in' };
}

/** LIFE-SPEECH-6 — the narrower outcome the PROMPT reads. `correctAnswerNative`
 *  is deliberately absent: it feeds the day summary's save button and has never
 *  been sent to the model (see `PracticeOutcome`'s own note). */
function outcomeForPrompt(
  o: PracticeOutcome | null,
): { kind: 'generation' | 'comprehension'; correct: boolean; picked: string; correctAnswer: string; promptSource: string; resolvedLine?: string; resolvedSpeaker?: 'user' | 'npc' | 'narrator' } | null {
  if (!o) return null;
  return {
    kind: o.kind,
    correct: o.correct,
    picked: o.picked,
    correctAnswer: o.correctAnswer,
    promptSource: o.promptSource,
    ...(o.resolvedLine ? { resolvedLine: o.resolvedLine } : {}),
    ...(o.resolvedSpeaker ? { resolvedSpeaker: o.resolvedSpeaker } : {}),
  };
}

/** LIFE-EX-GEN-7: tight scene snapshot for the graded generator.
 *  Moved from runLifeStep.ts (was buildSceneContext) — now keyed off
 *  the plan instead of the raw response. */
export function buildGradedSceneContext(
  world: LifeWorld,
  events: ReadonlyArray<LifeEvent>,
  plan: GradedPlan,
): GradedQuestionSceneContext {
  const speakerName =
    plan.kind === 'comprehension' ? plan.speakerName ?? undefined : undefined;
  const recentBeats = events
    .filter((e) => e.kind === 'beat')
    .slice(-3)
    .map((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return typeof p.practiceText === 'string' ? p.practiceText : '';
    })
    .filter(Boolean);
  return {
    sagaTitle: world.saga?.title?.trim() || undefined,
    locationLabel: world.currentLocationLabel?.trim() || undefined,
    speakerName,
    recentBeats,
    difficulty: world.difficulty,
    // LIFE-LANG-7/8: the graded instruction/interpretation language.
    systemLanguage: world.systemLanguage ?? world.nativeLanguage,
  };
}

/** LIFE-EX-PLAN-3: distinct fill-blank targets already practised.
 *  Moved verbatim from runLifeStep.ts. */
export function recentGenerationTargets(
  events: ReadonlyArray<LifeEvent>,
): string[] {
  const seen = new Set<string>();
  for (const e of events) {
    if (e.kind !== 'correction') continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (p.kind !== 'generation') continue;
    const target = typeof p.correctAnswer === 'string'
      ? p.correctAnswer.trim().toLowerCase()
      : '';
    if (target) seen.add(target);
  }
  return Array.from(seen).slice(-20);
}

function safeParseJson(raw: string): unknown {
  const text = stripFences(raw);
  try {
    return JSON.parse(text);
  } catch {
    return parseUpToBalance(text);
  }
}

/**
 * LIFE-NODE-19 — one stray closing brace does not cost a 21k-token turn.
 *
 * Observed twice in a single playthrough run, with an identical signature: a
 * complete, well-formed response followed by ONE extra `}`. `JSON.parse`
 * rejects it, the whole `life_step` call is thrown away, and the retry is
 * another ~21k input tokens — for a typo. `LIFE-NODE-16` already names this
 * class ("repair what has ONE correct reading; retry what needs regenerating")
 * and the step path had only fence-stripping.
 *
 * Trailing EXCESS closers are unambiguous: the value ended, and what follows is
 * junk. A TRUNCATED tail (more openers than closers) is NOT repaired — inventing
 * the missing content is a guess, and a guess is worse than the retry.
 */
export function parseUpToBalance(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]!;
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      // The value closed here. Anything after it is the stray tail.
      if (depth === 0) {
        try {
          return JSON.parse(trimmed.slice(0, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  lines.shift();
  if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
  return lines.join('\n').trim();
}
