/**
 * LIFE-CONTRACT-EX-6 — the lead-in beats on a question node.
 *
 * A question node may now narrate the PLAYER'S ACTION before the teaching
 * moment intercepts. It may not narrate the line under test.
 *
 * The distinction is the whole invariant. `LIFE-CONTRACT-EX-1` places the
 * intercept "between the decision and the speech": the decision's physical
 * consequence belongs before it, the speech after it. With no beat slot on the
 * node at all, a pick that triggered a question vanished from the story —
 * reported as picking "grab the letter by force" and going straight to a
 * comprehension question about the reply, with no event of the grab.
 *
 * WHY A CODE CHECK AND NOT A PROMPT RULE. Pre-empting the tested line does not
 * look like a defect in the output — it reads as a perfectly good beat. The
 * model has no way to know it has destroyed the question, and a rule it can
 * satisfy by believing it complied is not a mechanism (the lesson from
 * `LIFE-SCENE-24`, `LIFE-ARC-PACE-3` and `LIFE-STORY-STAGE-5`). So the client
 * checks, and a leak is a retry.
 */
import { spokenKey } from './beatRepair';
import type { GradedPlan, StepBeat } from './stepSchema';

/** THE SAME normalisation the `LIFE-SPEECH-6` echo guard uses — imported, not
 *  re-implemented. Both are asking "is this line already accounted for?" of
 *  different sources, and two copies would drift into answering it
 *  differently. (Writing the second copy is how the shared bug in it was
 *  found: neither stripped whitespace that sat between two punctuation marks.) */
export { spokenKey };

/** The line this plan is about to test, whichever direction it runs in. */
export function testedLineOf(plan: GradedPlan): string {
  return plan.kind === 'generation' ? plan.sentenceContext : plan.npcUtterance;
}

/**
 * True when a lead-in beat has already said the line the question is about to
 * test — in which case the question is spent before it is asked.
 *
 * EQUALITY on the normalised key, not containment. A beat that legitimately
 * mentions one word of the tested sentence ("the letter") is not a leak, and a
 * containment test would reject most honest lead-ins; the failure this guards
 * is the whole line arriving early, which is what makes the question pointless.
 * Same call made for the same reason in `beatRepair.isEchoOfSpokenLine`.
 */
export function leadInLeaksTestedLine(
  beats: readonly Pick<StepBeat, 'practiceText'>[],
  plan: GradedPlan,
): boolean {
  const target = spokenKey(testedLineOf(plan) ?? '');
  if (!target) return false;
  return beats.some((b) => spokenKey(b.practiceText ?? '') === target);
}

/**
 * LIFE-CONTRACT-EX-8 — drop the beats that say the tested line.
 *
 * `LIFE-CONTRACT-EX-6` made a leak a RETRY, on the reasoning that the model
 * cannot see the fault and so has to be told. True, and not enough: the retry
 * has to land somewhere, and `LIFE-CONTRACT-EX-7` — which shipped one day
 * before this was reported — sends it straight back. EX-7 rejects a question
 * node with no lead-in and hints *"what they did, and the world reacting to
 * it"*; for a comprehension, the world reacting IS the utterance under test.
 * With `MAX_ATTEMPTS = 2` the ladder is: attempt 0 omits the lead-in and is
 * rejected, attempt 1 obeys the hint into a leak, and there is no attempt 2 —
 * so the leak SHIPS, every time the run takes that path. Once shipped it also
 * duplicates, because the resolution bubble emits the same line again a moment
 * later (`buildResolvedBubble`, which has no idea it is already on screen).
 *
 * A retry cannot fix a rule pair that contradicts itself, so this stops being
 * a retry. The leaking beat is REMOVED and the rest of the turn is kept: in
 * the reported case that leaves the player climbing the stool and takes away
 * only Madame Mora's warning, which is precisely the edit a human would make.
 *
 * Deliberately runs BEFORE validation, not after. The repaired node is what
 * EX-7 then judges — so a node whose only beat WAS the leak is told it
 * narrated nothing, which is the true and actionable complaint, instead of
 * being told off for a leak it no longer contains.
 */
export function stripLeakingLeadIns<T extends Pick<StepBeat, 'practiceText'>>(
  beats: readonly T[],
  plan: GradedPlan,
): readonly T[] {
  const target = spokenKey(testedLineOf(plan) ?? '');
  if (!target) return beats;
  const kept = beats.filter((b) => spokenKey(b.practiceText ?? '') !== target);
  // Identity when nothing changed, so callers can cheaply tell a repaired node
  // from an untouched one without re-running the comparison.
  return kept.length === beats.length ? beats : kept;
}
