import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSceneOpenPrompt,
  sceneOpenSystemInstruction,
  SCENE_OPEN_SCHEMA,
} from "../prompts/lifeSceneOpen";
import {
  buildSceneClosePrompt,
  sceneCloseSystemInstruction,
  SCENE_CLOSE_SCHEMA,
} from "../prompts/lifeSceneClose";

/**
 * SRV-PROMPT-3 — THE PORT DID NOT CHANGE A BYTE, and this is the evidence.
 *
 * ── WHY A FROZEN FIXTURE AND NOT A LIVE COMPARISON ──────────────────────────
 *
 * The usual parity shape (`tests/playthrough/serverPromptParity.test.ts`) runs
 * BOTH copies over the same input and diffs the bytes. That is only available
 * while both copies exist. These two prompts have no surviving client copy —
 * `src/lib/life/prompts/{sceneOpen,sceneClose}.ts` are DELETED, which is the
 * whole point of SRV-PROMPT-3 — so there is nothing live to compare against.
 *
 * `fixtures/sceneGolden.json` is therefore a CAPTURE: the exact output of the
 * client builders, taken immediately before they were deleted, across ten input
 * shapes chosen to reach every branch plus both system instructions and both
 * response schemas. The server copies are asserted to reproduce it byte for
 * byte.
 *
 * ⚠ THE FIXTURE IS ONLY EVER DELETED, NEVER REFRESHED. Regenerating it from the
 * SERVER would make every assertion below vacuous — it would compare the port
 * with itself and report agreement. It is a record of what the client built on
 * the day it stopped existing, and a genuine change to either prompt retires
 * the corresponding rows rather than re-recording them.
 *
 * ── WHY A GOLDEN AND NOT A DIGEST ───────────────────────────────────────────
 *
 * A stored hash would prove the same thing and tell whoever broke it nothing.
 * The full text means a failure prints the diff, so "the port dropped a
 * newline" and "the port dropped the canon block" are distinguishable at the
 * moment of failure rather than after an hour of bisecting.
 *
 * ── MUTATION-CHECKED ────────────────────────────────────────────────────────
 *
 * A golden test passes vacuously if it reads the wrong key, or if the fixture
 * is empty, or if the comparison is `toContain` where it should be `toBe`. The
 * two rows at the bottom pin the SHAPE of the fixture — every case named here
 * must exist in it and must be non-trivial — so a fixture that silently lost
 * its cases fails loudly instead of passing with nothing to say.
 */

type GoldenCase = { input: Record<string, unknown>; out: string };
type Golden = {
  note: string;
  sceneOpenSi: Record<string, string>;
  sceneCloseSi: { realistic: string; fantasy: string };
  sceneOpenSchema: Record<string, unknown>;
  sceneCloseSchema: Record<string, unknown>;
  sceneOpenPrompts: Record<string, GoldenCase>;
  sceneClosePrompts: Record<string, GoldenCase>;
};

const golden: Golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "sceneGolden.json"), "utf8"),
) as Golden;

/**
 * ⚠ THE BOUNDARY CASES ARE NOT PADDING. Two of the fixture groups exist because
 * a mutation SURVIVED the first version of this file:
 *
 *  - moving `STAGE_STIRRING_AT` from 13 to 12 changed NOTHING, because no
 *    fixture sat on a rung of the ladder — 8 is settling either way and 14 is
 *    stirring either way. The six `stage boundary` cases straddle all three
 *    thresholds, so any change to any of them moves at least one golden;
 *  - dropping `renderRecentSubjects`'s `.filter(Boolean)` changed nothing,
 *    because every fixture's subjects were non-empty.
 *
 * That is the recurring lesson batch 2 and batch 3 each learned the hard way:
 * a guard is worth only what its fixtures DISTINGUISH, and the mutations that
 * find the gap are the ones a future author might plausibly WRITE — a retuned
 * threshold, a moved slice — not ones chosen merely to differ.
 */
const OPEN_CASES = [
  "minimal",
  "ordinary-focus, sceneIndex 1, arrival stage",
  "full, stirring stage, sceneIndex 5",
  "XML-breaking characters everywhere, settling stage, sceneIndex 2",
  "no principals but a focus is null, underway, no stage block",
  "stage boundary: chapterTurns 5 (last arrival turn)",
  "stage boundary: chapterTurns 6 (first settling turn)",
  "stage boundary: chapterTurns 12 (last settling turn)",
  "stage boundary: chapterTurns 13 (first stirring turn)",
  "stage boundary: chapterTurns 20 (last stirring turn)",
  "stage boundary: chapterTurns 21 (first underway turn)",
  "stage: chapter fields ABSENT (defaults to arrival)",
  "recentSubjects holding empty strings (distinguishes filter(Boolean))",
  "recentSubjects ALL empty (the block must vanish, not render empty)",
];
const CLOSE_CASES = [
  "minimal, no fronts, no objective",
  "objective present, mixed cast, one front",
  "fantasy register",
  "long scene log, past the 24 slice",
  "scene log EXACTLY at the 24 slice",
  "principal and regular with NO optional fields (the empty-tag branch)",
  "two fronts, different kinds and clock positions",
  "XML-breaking characters everywhere",
];

describe("SRV-PROMPT-3 — life_scene_gen is byte-identical to the deleted client builder", () => {
  it("the SYSTEM INSTRUCTION matches, for both captured languages", () => {
    for (const [practiceLanguage, want] of Object.entries(golden.sceneOpenSi)) {
      expect(sceneOpenSystemInstruction({ practiceLanguage }), practiceLanguage).toBe(want);
    }
  });

  it("the RESPONSE SCHEMA matches — SRV-PROMPT-1, it is half the artefact", () => {
    expect(SCENE_OPEN_SCHEMA).toEqual(golden.sceneOpenSchema);
  });

  for (const label of OPEN_CASES) {
    it(`the USER PROMPT matches: ${label}`, () => {
      const c = golden.sceneOpenPrompts[label];
      expect(c, `fixture is missing the case "${label}"`).toBeTruthy();
      expect(
        buildSceneOpenPrompt(c!.input as unknown as Parameters<typeof buildSceneOpenPrompt>[0]),
      ).toBe(c!.out);
    });
  }
});

describe("SRV-PROMPT-3 — life_scene is byte-identical to the deleted client builder", () => {
  it("the SYSTEM INSTRUCTION matches, in BOTH registers", () => {
    expect(sceneCloseSystemInstruction({ realistic: true })).toBe(golden.sceneCloseSi.realistic);
    expect(sceneCloseSystemInstruction({ realistic: false })).toBe(golden.sceneCloseSi.fantasy);
  });

  it("the RESPONSE SCHEMA matches — SRV-PROMPT-1, it is half the artefact", () => {
    expect(SCENE_CLOSE_SCHEMA).toEqual(golden.sceneCloseSchema);
  });

  for (const label of CLOSE_CASES) {
    it(`the USER PROMPT matches: ${label}`, () => {
      const c = golden.sceneClosePrompts[label];
      expect(c, `fixture is missing the case "${label}"`).toBeTruthy();
      expect(
        buildSceneClosePrompt(c!.input as unknown as Parameters<typeof buildSceneClosePrompt>[0]),
      ).toBe(c!.out);
    });
  }
});

/**
 * The anti-vacuity rows. Everything above compares against fixture entries; if
 * the fixture lost its content the loop above would simply run fewer — or
 * emptier — assertions and still go green. These make that a failure.
 */
describe("SRV-PROMPT-3 — the golden fixture cannot go quietly empty", () => {
  it("holds every case the loops above name, and each one is substantial", () => {
    expect(Object.keys(golden.sceneOpenPrompts).sort()).toEqual([...OPEN_CASES].sort());
    expect(Object.keys(golden.sceneClosePrompts).sort()).toEqual([...CLOSE_CASES].sort());
    for (const [label, c] of [
      ...Object.entries(golden.sceneOpenPrompts),
      ...Object.entries(golden.sceneClosePrompts),
    ]) {
      expect(typeof c.out, label).toBe("string");
      expect(c.out.length, label).toBeGreaterThan(80);
      expect(Object.keys(c.input).length, label).toBeGreaterThan(3);
    }
    // And the six stage-boundary goldens must actually differ from each other
    // across each rung — a fixture set that captured the same block six times
    // would satisfy every assertion above while distinguishing nothing.
    const stageOf = (label: string) =>
      /<storyStage stage="([a-z]+)"/.exec(golden.sceneOpenPrompts[label]!.out)?.[1] ?? "(none)";
    expect([
      stageOf("stage boundary: chapterTurns 5 (last arrival turn)"),
      stageOf("stage boundary: chapterTurns 6 (first settling turn)"),
      stageOf("stage boundary: chapterTurns 12 (last settling turn)"),
      stageOf("stage boundary: chapterTurns 13 (first stirring turn)"),
      stageOf("stage boundary: chapterTurns 20 (last stirring turn)"),
      stageOf("stage boundary: chapterTurns 21 (first underway turn)"),
    ]).toEqual(["arrival", "settling", "settling", "stirring", "stirring", "(none)"]);
  });

  it("holds both system instructions and both schemas, at full size", () => {
    expect(golden.sceneOpenSi.French!.length).toBeGreaterThan(3_000);
    expect(golden.sceneOpenSi.Japanese).not.toBe(golden.sceneOpenSi.French);
    expect(golden.sceneCloseSi.realistic.length).toBeGreaterThan(5_000);
    expect(golden.sceneCloseSi.fantasy).not.toBe(golden.sceneCloseSi.realistic);
    expect((golden.sceneOpenSchema.required as string[]).length).toBe(7);
    expect((golden.sceneCloseSchema.required as string[]).length).toBe(5);
  });

  it("says in its own note that it is a CAPTURE, not a regenerable snapshot", () => {
    // If someone regenerates this file from the server the note goes with it,
    // and the check that the comparison means anything goes with the note.
    expect(golden.note).toMatch(/FROZEN CAPTURE/);
    expect(golden.note).toMatch(/DELETED client builders/);
  });
});
