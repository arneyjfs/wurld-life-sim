/**
 * MOVED from `src/lib/life/prompts/` by SRV-PROMPT-8..13 batch 8 (SRV-PROMPT-3:
 * a retired client prompt module is deleted and its tests MOVE rather than die).
 * The assertions are unchanged; only the imports point at the server modules.
 */
import { describe, expect, it } from 'vitest';
import { leanStepSystemInstruction } from '../../prompts/lifeStepSI';
import { stepOutputSchemaBlock } from '../../prompts/lifeStepSI';

/** The block the lean and full SIs SHARE, so its cross-references have to
 *  resolve in both. */
const OPTION_SCHEMA_BLOCK = stepOutputSchemaBlock({
  practiceLanguage: 'French',
  systemLanguage: 'English (British)',
}).join('\n');

/**
 * LIFE-SI-LEAN-5 — the five rules ported back, and ONLY these five.
 *
 * These are string assertions, which `LIFE-CONFORM-1` spends a file explaining
 * cannot tell you whether a rule works. They are here for the one thing a
 * string test CAN do: stop a future rewrite from dropping a line again without
 * noticing. Each one names the MEASURED rate that justified porting it, so the
 * next person to delete it knows what it cost last time.
 *
 * The behavioural half lives in `tests/playthrough/ruleConformance.ts` and is
 * the test that actually decides. Neither replaces the other:
 *
 *   this file  — "the words are still in the prompt"     (free, per-commit)
 *   conformance — "the model still does the thing"        (needs a paid run)
 *
 * DELIBERATELY ABSENT — measured, and NOT ported (`LIFE-CONFORM-2`): the
 * figurative-line cap, difficulty-gated prose, prose register. Reading three
 * transcripts showed no difference between the arms without them. If a future
 * run shows one, port them then; do not port them on the strength of the full
 * SI having had them.
 */
const si = () =>
  leanStepSystemInstruction({
    practiceLanguage: 'French',
    nativeLanguage: 'English (British)',
    systemLanguage: 'English (British)',
    difficulty: 3,
  });

describe('LIFE-SI-LEAN-5 — the ported five', () => {
  it('LIFE-SPEECH-3 — `gradeTarget` has a CADENCE, not just a schema line', () => {
    // 0 of 130 say options carried it with the field described in the schema
    // block and nowhere else. 12% with the full SI's section. It is the only
    // route by which a player ever PRODUCES language.
    const text = si();
    expect(text).toContain('gradeTarget');
    expect(text).toMatch(/ONE "say" option per graded moment/);
    expect(text).toMatch(/VERBATIM inside that option's own `saysLine/);
  });

  it('LIFE-SPEECH-3 — carries the WORKED example, not just the rule', () => {
    // LIFE-SI-LEAN-6: stating the cadence took gradeTarget from 0% to 2%, which
    // is not the ~12% the full SI gets. The full SI's other difference is that
    // it shows the mechanism end to end — option, saysLine, target, blank.
    expect(si()).toMatch(/ça fait ___/);
  });

  it('LIFE-SI-LEAN-6 — the section is NAMED what the schema block points at', () => {
    // `stepOutputSchemaBlock` is shared with the full SI byte for byte and its
    // gradeTarget line ends "See OUTBOUND GRADING below." Two rewrites of this
    // rule moved nothing (0% -> 2% -> 0%) because the schema's own
    // cross-reference pointed at a section that did not exist in this variant.
    // If the shared block ever renames the target, this test is what says so.
    expect(OPTION_SCHEMA_BLOCK).toMatch(/See OUTBOUND GRADING below/);
    expect(si()).toMatch(/^OUTBOUND GRADING/m);
  });

  it('LIFE-SPEECH-3 — and the node route is closed in the same breath', () => {
    // 75% vs 97%: the lean arm did not merely stop grading speech, it graded it
    // in the form the rule closes.
    expect(si()).toMatch(/nothing left to intercept/);
  });

  it('LIFE-NODE-7 — the continuation states a DEFAULT, never an allowance', () => {
    // "At most ~1 node in 4" produced 24% continuations; the full SI, which
    // states no number, produced 1%. A bound with no stated purpose reads as a
    // target to spend — the same failure `beatBudgetRule` was written around.
    const text = si();
    expect(text).toMatch(/"continuation" — RARE/);
    expect(text).toMatch(/TWO IN A ROW IS A CUTSCENE/);
    expect(text).not.toMatch(/At most ~1 node in 4/);
  });

  it('LIFE-OPT-VARIETY — a set differs in KIND, not in wording', () => {
    // 90% vs 100%. The owner's report is "the same options every time".
    expect(si()).toMatch(/differs? in KIND, not just in wording/);
    expect(si()).toMatch(/do \/ move \/ offer \/ leave/);
  });

  it('LIFE-INTRO — a person arrives with a relationship, not just a name', () => {
    // Ported on a reading, not a rate: Beñat, Elur Vaz, Miren Sol and Zorion
    // each arrived already speaking with nothing saying who they were.
    expect(si()).toMatch(/FIRST time a person appears, one clause says who they are TO THE PLAYER/);
  });

  it('LIFE-SCENE-25 — the scene stays on its declared subject', () => {
    // A lean scene declared "clearing an obstruction in the passage" and then
    // ran eight turns about a sealed satchel.
    expect(si()).toMatch(/declares ONE subject and everything this turn serves it/);
  });
});

describe('LIFE-SI-LEAN-5 — the prompt does not drift back toward 73k', () => {
  /**
   * A CEILING on the whole instruction, not a frozen delta against a baseline.
   *
   * This started as "the port adds < 2,000 characters against the 19,121 it was
   * before" — and it fired, correctly, the moment two later fixes landed
   * (`LIFE-EX-16`, `LIFE-SPEECH-7`). But a frozen delta guards the wrong thing:
   * it treats every future addition as drift, including ones that come with a
   * measurement, which would make the honest response "raise the number" every
   * time and the guard meaningless.
   *
   * The real risk is the walk back to 73,000 one defensible line at a time. So:
   * a ceiling, generous enough that a rule with evidence can be added without
   * ceremony, tight enough that a dozen cannot. At 22,000 the instruction is
   * still 70% smaller than the one it replaced.
   *
   * **The rule that goes with the number: every addition since the port carries
   * its measurement at the point it was added.** `LIFE-SI-LEAN-5` (five rules,
   * four measured regressions plus one transcript reading), `LIFE-EX-16` (the
   * level band, `LIFE-LANG-9.1`'s cut), `LIFE-SPEECH-7` (4 of 4 `hear` options
   * were ambient sound, 2 of them corrupted the following node). If you are
   * adding to this file and cannot write that sentence, that is the signal —
   * not the byte count.
   *
   * ── RAISED 22,000 → 23,000 for `LIFE-REP-1`, and the sentence it owes ──────
   *
   * The guard fired on the STANDING block, which is what it is for, so this is
   * not a quiet bump. What the rule asks for is a measurement, and a NEW
   * contract cannot have a prior one — so the honest version is a commitment
   * instead: **the standing block ships behind the `LIFE-GOAL-10` gate
   * (median of ≥3 runs, two fixtures), and if that gate does not move, this
   * block comes out rather than staying on plausibility.** That is the same
   * bargain `LIFE-PRECEDENCE-1` made and then honoured by reverting.
   *
   * It is in the SI rather than the per-turn tail for a measured reason that
   * cuts AGAINST this session's usual preference: the SI is the top of the
   * cache prefix (~76% cached, `LIFE-CTX-17`) while a volatile-tail block is
   * paid in full every turn. "Standing is reputation" is also genuinely stable —
   * it does not vary by turn, which is the actual test for which half it
   * belongs in.
   */
  const CEILING = 23_000;

  it(`stays under ${CEILING} characters — the full SI it replaced was ~73,000`, () => {
    expect(si().length).toBeLessThan(CEILING);
  });

  it('does NOT re-import the rules the transcripts cleared', () => {
    // The figurative-line cap is the sharpest of these: a countable rule, in
    // the 43, and the arms are indistinguishable without it. Porting it back
    // "to be safe" is how a prompt returns to 73k one defensible line at a time.
    expect(si()).not.toMatch(/figurative/i);
  });
});

/**
 * LIFE-EX-16 — the grading band is DYNAMIC on the player's level.
 *
 * Owner, 2026-08-10: *"Maybe we should change the prompt to be dynamic based on
 * user level so that we can only suggest types that are actually allowed."* For
 * the RENDER variants that turned out to be the wrong layer — code picks those,
 * not the model (`LIFE-EX-15`). But it is exactly right here: the rule said "at
 * the player's level" and never said what that meant at THIS level.
 */
describe('LIFE-EX-16 — OUTBOUND GRADING states the band, not the abstraction', () => {
  const at = (difficulty: number) =>
    leanStepSystemInstruction({
      practiceLanguage: 'French',
      nativeLanguage: 'English (British)',
      systemLanguage: 'English (British)',
      difficulty,
    });

  it('a beginner is told the concrete floor AND the failure to avoid', () => {
    expect(at(1)).toMatch(/high-frequency concrete word/);
    expect(at(1)).toMatch(/Testing "voudrais" here is the EXACT failure/);
  });

  it('an intermediate is told everyday grammar, and NOT the beginner band', () => {
    expect(at(3)).toMatch(/everyday grammar/);
    expect(at(3)).not.toMatch(/high-frequency concrete word/);
  });

  it('an advanced player gets the subjunctive band and neither of the others', () => {
    expect(at(6)).toMatch(/subjunctive, idiom\/nuance/);
    expect(at(6)).not.toMatch(/everyday grammar/);
    expect(at(6)).not.toMatch(/high-frequency concrete word/);
  });

  it('costs one band, not three — the LIFE-LANG-9.1 cut', () => {
    // Sending all three bands on every call is what levelLadder was measured
    // and cut for. Repeating that here would undo it in a second place.
    const bands = [/high-frequency concrete word/, /everyday grammar/, /subjunctive, idiom/];
    for (const d of [1, 2, 3, 4, 5, 6, 7]) {
      expect(bands.filter((b) => b.test(at(d))).length, `level ${d}`).toBe(1);
    }
  });
});
