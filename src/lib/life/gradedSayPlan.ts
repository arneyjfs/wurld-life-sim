/**
 * LIFE-SPEECH-3: turn a `say` option's declared `gradeTarget` into the outbound
 * fill-blank plan for that pick — or decline, and let the line simply land.
 *
 * THE BUG THIS EXISTS FOR. Reported 2026-08-02: "Questions seem to not be
 * triggering for things I say, ie they are all comprehension questions so far."
 * They were structurally unreachable. `optionSpeechActIssues` makes `saysLine`
 * REQUIRED on every `say` option, and `pick()` prepends that line as the
 * player's bubble the instant they pick — so by the time `life_step` authors
 * the node the pick leads to, the line has ALREADY been said, and a fill-blank
 * is defined as intercepting a line the player is about to say. Nothing was
 * left to intercept. `hear` picks are locked to comprehension and `act` picks
 * naturally produce it, so EVERY graded moment came out comprehension.
 *
 * This regressed with `LIFE-NODE-2`: before the lookahead was removed, a `say`
 * option's `next` could BE the question node, so the option itself declared the
 * interception. This restores that, in the minimal form — one string, not an
 * authored branch.
 *
 * WHY THE PLAN IS BUILT IN CODE. The model authors `gradeTarget` in the same
 * breath as the line, which is the only moment it holds the level ceiling,
 * `<recentlyPracticed>` and the cognate rule together. Everything after that is
 * mechanical: the plan is assembled from fields the schema already validated,
 * so there is no "the model didn't make it a question" failure mode to recover
 * from — the failure mode the node route has.
 *
 * DECLINING IS NOT FAILING. Every rejection here degrades to the ordinary
 * non-graded `say` path: the line lands as the player's bubble exactly as it
 * does today. A dropped grade costs one practice moment; the alternative —
 * shipping a plan the generator's own guards will reject — costs a retry and a
 * visible wait for the same outcome.
 */
import type { GradedPlan, StepOption } from './stepSchema';

/** Fold for the two comparisons below: the target's presence in its own line,
 *  and its identity against the recently-practised list. Case and edge
 *  whitespace only — no accent stripping, because `clé`/`cle` are different
 *  words and treating them as one would silently recycle a target. */
function fold(s: string): string {
  return s.trim().toLowerCase();
}

export function gradedSayPlan(
  option: StepOption,
  recentTargets: ReadonlyArray<string>,
): GradedPlan | null {
  // Direction is structural: only a `say` pick produces a player line, so only
  // a `say` pick can be gated into an outbound fill-blank. An absent
  // `speechAct` means `act` (LIFE-UI-11).
  if (option.speechAct !== 'say') return null;

  const line = option.saysLine?.practiceText?.trim();
  const target = option.gradeTarget?.trim();
  if (!line || !target) return null;

  // `leakViolations` rejects a plan whose testTarget is absent from its
  // sentenceContext ("the generator can't reliably blank out something not in
  // the sentence"), and burns a retry doing it. Catch it here instead.
  if (!fold(line).includes(fold(target))) return null;

  // LIFE-EX-PLAN fresh-targets rule. Recycling is worse than not grading: the
  // player answers from memory of the last turn, not from the language.
  if (recentTargets.some((t) => fold(t) === fold(target))) return null;

  return { kind: 'generation', testTarget: target, sentenceContext: line };
}
