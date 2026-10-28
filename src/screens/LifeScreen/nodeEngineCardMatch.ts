/**
 * LIFE-EX-10/13: the card-matching review's engine handlers, extracted from
 * `nodeEngineActions` (which is at the 600-LOC cap).
 *
 * LIFE-EX-13 moved the trigger: the resolve path calls `tryEnterSceneReview`
 * when a scene ENDS, ahead of the summary card, instead of `arriveAtNode`
 * stealing an arbitrary mid-scene graded slot. The UI still calls
 * `completeCardMatch` when the grid is solved — but there is no continuation
 * to run any more, because the scene is over; solving it simply hands the
 * screen back to the waiting summary chip.
 *
 * Spec: docs/specs/life-sim.md — LIFE-EX-10 (mechanics), LIFE-EX-13 (cadence
 * + source).
 */
import {
  buildSceneReviewPairs,
  CARD_MATCH_MIN_PAIRS,
} from '@/lib/life/cardMatch';
import { lifeDebug } from '@/lib/life/debugLog';
import type { LifeEvent } from '@/types/firestore';
import type { EngineDeps } from './nodeEngineTypes';

/** Graded questions resolved so far this wurld (one `correction` event each) —
 *  the card-match cadence counter + the exercise-variant rotation seed. Mirrors
 *  LifeScreen's `exerciseSeed`. */
export function countCorrections(events: ReadonlyArray<LifeEvent>): number {
  return events.reduce((n, e) => (e.kind === 'correction' ? n + 1 : n), 0);
}

type CardMatchCtx = {
  deps: EngineDeps;
  currentEvents: () => LifeEvent[];
};

export function createCardMatchHandlers({
  deps,
  currentEvents,
}: CardMatchCtx): {
  armSceneReview: () => void;
  tryEnterSceneReview: () => boolean;
  completeCardMatch: () => void;
} {
  const { propsRef, machineRef, prefetchRef, transition } = deps;
  /**
   * LIFE-EX-13.2 — the review is ARMED on resolve and OPENED when the turn
   * settles, which are not the same moment.
   *
   * It used to open immediately inside `handleSignals`. `handleSignals` runs
   * from the middle of `arriveAtNode`, which then goes on to set the phase for
   * whatever node it is arriving at — so the grid was built and overwritten in
   * the same tick. `LIFE-EX-13.1` fixed that for the two `options-ready`
   * writes and missed the other two: a `question` node goes straight to
   * `question-authoring` SYNCHRONOUSLY, and the graded-demote path to
   * `options-loading`. Reported 2026-08-07, after the first fix: *"I'm still
   * not getting card matching exercise before the scene summary."*
   *
   * Guarding the remaining two writes would be the third round of the same
   * whack-a-mole, and would still be wrong for the question case — the player
   * should ANSWER the question that ended the scene, and get the review after
   * it, not instead of it. So the trigger moves to where a turn comes to rest:
   * the review opens at the settle point, whatever route the turn took to get
   * there.
   */
  let armed = false;
  // LIFE-EX-13: one review per scene. The counter is the scene the last review
  // fired for, so a resolve that re-renders (or a snapshot arriving twice)
  // cannot re-open a grid the player already solved. Resets per mount, which
  // is correct: re-entering a wurld mid-scene should not owe a review for a
  // scene that has not ended yet.
  let reviewedSceneId: string | null = null;

  /**
   * LIFE-EX-13: enter the END-OF-SCENE review, ahead of the summary card.
   *
   * Replaces the mid-scene `REVIEW_EVERY`-questions trigger. That fired at an
   * arbitrary point in a scene and drew on an arbitrary window; this fires at
   * the one moment a review is obviously wanted — the scene is over, and the
   * next screen is about to tell the player what happened in it.
   *
   * Returns true when the review took the screen, so the caller holds the
   * summary chip back until it is solved.
   */
  function tryEnterSceneReview(): boolean {
    if (!armed) return false;
    const p = propsRef.current;
    if (!p.uid || !p.world || !p.scene) return false;
    if (reviewedSceneId === p.scene.id) {
      armed = false;
      transition({ cardMatchPending: false });
      return false;
    }
    const pairs = buildSceneReviewPairs(currentEvents());
    // Below the floor a grid is not a game — two tiles match themselves. The
    // scene simply goes straight to its summary, which is the pre-LIFE-EX-13
    // behaviour and perfectly fine.
    if (pairs.length < CARD_MATCH_MIN_PAIRS) {
      // Disarm: the scene has settled and the review declined. Leaving it armed
      // would open a grid on some later turn, after the summary, which reads as
      // a random interruption rather than a review of anything.
      armed = false;
      // LIFE-EX-13.3: drop the shimmer with the review. A pending flag left set
      // by a decline would hold the summary chip off screen for the rest of the
      // scene — the review would not appear AND neither would the summary.
      transition({ cardMatchPending: false });
      lifeDebug('SCENE-COMPLETE', 'scene review declined — too little vocab', {
        pairs: pairs.length,
        need: CARD_MATCH_MIN_PAIRS,
        sceneId: p.scene.id,
      });
      return false;
    }
    armed = false;
    reviewedSceneId = p.scene.id;
    lifeDebug('SCENE-COMPLETE', 'scene review opened', { pairs: pairs.length, sceneId: p.scene.id });
    transition({
      phase: 'card-match',
      nodeKind: 'question',
      options: [],
      question: null,
      cardMatch: { pairs, seed: countCorrections(currentEvents()) },
      cardMatchPending: false,
    });
    // NO continuation prefetch, unlike the mid-scene review this replaces: the
    // scene is over. What follows is the summary card the player opens, and
    // the next scene's opening turn is started by that flow — generating a
    // live turn here would author a beat for a scene that has ended.
    return true;
  }

  /** The review is solved. The scene is already over (LIFE-EX-13), so this
   *  just hands the screen back — `sceneSummaryPending` is still set, and
   *  `LifeScreenBottom` renders the "View scene summary" chip the moment the
   *  card-match stops counting as mid-activity. */
  function completeCardMatch(): void {
    if (machineRef.current.phase !== 'card-match') return;
    prefetchRef.current = null;
    transition({ phase: 'options-ready', cardMatch: null });
  }

  /** LIFE-EX-13.2/13.3: owed, not yet shown. The flag is what the UI reads to
   *  hold the summary chip back and show the ordinary question-loading shimmer
   *  for the gap. */
  function armSceneReview(): void {
    armed = true;
    transition({ cardMatchPending: true });
  }

  return { armSceneReview, tryEnterSceneReview, completeCardMatch };
}
