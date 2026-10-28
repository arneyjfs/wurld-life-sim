/**
 * LIFE-EX-PLAN-5: turning a question node's PRE-AUTHORED continuation into the
 * same arrival shape a live turn would have produced.
 *
 * A graded turn used to cost two `life_step` calls — the one that emits the
 * question node (measured: ~15,400 input tokens for 93 output tokens, a
 * `gradedPlan` and nothing else) and a second full-context call after the
 * player answers, purely to narrate what happens next. The question node now
 * carries that continuation itself, and this maps it onto `arriveAtNode`'s
 * inputs so the render path is byte-identical to a live landing.
 *
 * Extracted from nodeEngineActions.ts for the 600-LOC cap, and it earns the
 * split: the mapping is pure, so the "presented as a branch, not a
 * continuation" decision below is unit-testable without mounting the engine.
 */
import { appendLifeEvent } from '@/lib/life/world';
import { localQuestionDemotedEvent } from '@/lib/life/mergeLocalEvents';
import type { LifeEvent } from '@/types/firestore';
import type { GenerateStepOptionsResult } from '@/lib/life/generateStepOptions';
import type { CommitAction } from '@/lib/life/commitNode';
import type { NodePreview, QuestionResolution } from '@/lib/life/stepSchema';

export type ResolutionArrival = {
  node: NodePreview;
  liveResult: Extract<GenerateStepOptionsResult, { kind: 'ok' }>;
};

/**
 * Build the node + result pair for a resolved graded turn.
 *
 * The resolution is presented as a **branch**, never a continuation: it carries
 * 2-3 options out of the resolved moment, whereas a `continuation` node means
 * exactly one option whose id is `"continue"` (`optionCountIssues`). Calling it
 * a continuation would either fail that rule or silently collapse the player's
 * choices to one.
 *
 * `beats` may legitimately be empty — `LIFE-EX-3` allows it after an inbound
 * comprehension answer, where the NPC's line is still the current line and the
 * turn is just the options for responding to it.
 */
export function resolutionToArrival(
  resolution: QuestionResolution,
  nonce: number,
): ResolutionArrival {
  const node: NodePreview = {
    kind: 'branch',
    beats: resolution.beats,
    ...(resolution.backdropIntent ? { backdropIntent: resolution.backdropIntent } : {}),
  };
  return {
    node,
    liveResult: {
      kind: 'ok',
      node,
      options: resolution.options,
      // LIFE-STORY-LOG-1: the resolution is its own story moment, so its log
      // line rides through `handleSignals` exactly as a live turn's would.
      // Absent is fine — the question node's own logLine already recorded the
      // question itself.
      logLine: resolution.logLine,
      // LIFE-ARC-PACE-1: this arrival costs no `life_step` generation, so it is
      // not a turn for pacing purposes even though it is a story moment.
      fromResolution: true,
      nonce,
    },
  };
}

/** The `arriveAtNode` closure this hands off to (engine-private). */
type ArriveAtNode = (
  node: NodePreview,
  opts: {
    action: CommitAction;
    appendMode: 'reset' | 'append';
    liveResult: Extract<GenerateStepOptionsResult, { kind: 'ok' }> | null;
  },
) => void;

/**
 * Land a pre-authored resolution through the normal arrival path.
 *
 * `appendMode: 'append'` — the resolved-line bubble was appended with
 * `resetTurn` immediately before this, so the resolution's beats continue that
 * same turn rather than clearing it. The correction event is likewise already
 * committed, hence `action: 'none'`.
 */
export function arriveAtResolution(
  resolution: QuestionResolution,
  nonce: number,
  arriveAtNode: ArriveAtNode,
): void {
  const { node, liveResult } = resolutionToArrival(resolution, nonce);
  arriveAtNode(node, { action: { kind: 'none' }, appendMode: 'append', liveResult });
}

/**
 * Read and clear the held resolution in one step. A resolution is single-use:
 * leaving it set would apply a stale continuation to a later graded turn, so the
 * read and the clear must never be separable.
 */
export function takeResolution(ref: {
  current: QuestionResolution | null;
}): QuestionResolution | null {
  const held = ref.current;
  ref.current = null;
  return held;
}

/**
 * LIFE-EX-CADENCE-1: record that a graded slot was SPENT by a question the
 * generator rejected (the `LIFE-NODE-8` graceful demote).
 *
 * `cyoaStreak` resets on `correction` — an ANSWERED question — so a demoted one
 * used to leave the streak elevated, the `<practiceCadence>` directive re-fired
 * on the very next node, and the demote repeated. Each round cost three calls
 * (the question's `life_step`, the failed `life_graded_question`, and the
 * replacement options fetch) and the player experienced a run of forced
 * questions.
 *
 * Written locally AND to Firestore: the local row makes the reset visible to the
 * very next prompt build (before the listener round-trips), the persisted row
 * makes it survive a reload. Never rendered into the prompt.
 */
export function recordDemotedSlot(
  uid: string,
  worldId: string,
  reason: string,
  pushLocal: (events: LifeEvent[]) => void,
): void {
  pushLocal([localQuestionDemotedEvent(reason)]);
  void appendLifeEvent({ uid, worldId, kind: 'question_demoted', payload: { reason } }).catch(
    () => undefined,
  );
}
