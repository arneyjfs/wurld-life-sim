/**
 * LIFE-TIME-1 — the world clock as the model reads it, and the duplication that
 * batch 8 was supposed to retire.
 *
 * ⚠ MOVED from `src/lib/life/timeOfDay.test.ts` by SRV-PROMPT-8..13 batch 8,
 * and CHANGED — the change is the point.
 *
 * Batch 1 moved `renderTimeOfDayForBackdrop` server-side and had to leave the
 * six gloss strings behind, because `renderTimeOfDay` still needed them and its
 * consumer (`prompts/step.ts`) did not migrate until batch 8. The guard that
 * kept the two copies in step carried a stated expiry: *"DELETE THIS TEST when
 * batch 8 lands `life_step` server-side and the client's copy goes with it."*
 *
 * ⚠ DELETING IT WOULD HAVE BEEN WRONG, and this is the batch-5 lesson arriving
 * from the other direction. The client copy did not go away — it MOVED. Porting
 * `renderTimeOfDay` into `lifeStepBlocks.ts` with its own `GLOSS` would have
 * left both tables in the repository, one file apart instead of one wire apart,
 * with the guard that noticed them deleted on schedule. The duplication would
 * have survived its own expiry.
 *
 * So `lifeStepBlocks.ts` IMPORTS `BACKDROP_TIME_OF_DAY_GLOSS`, there is one
 * authoritative table, and what this file asserts is that single-copy property
 * rather than the agreement of two. That is strictly stronger: agreement can be
 * restored by editing both, and a second declaration cannot come back without
 * failing here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BACKDROP_TIMES_OF_DAY, BACKDROP_TIME_OF_DAY_GLOSS } from "../../prompts/lifeBackdrop";
import { TIMES_OF_DAY, readTimeOfDay, renderTimeOfDay } from "../../prompts/lifeStepBlocks";

const stepBlocksSrc = () =>
  readFileSync(join(__dirname, "..", "..", "prompts", "lifeStepBlocks.ts"), "utf8");

describe("LIFE-TIME-1 — the story clause", () => {
  it("names the value and forbids moving the clock in prose", () => {
    const out = renderTimeOfDay("evening");
    expect(out).toContain('value="evening"');
    expect(out).toContain("Do not move the clock in your prose");
  });

  it('every time of day has a gloss — a missing one would render "undefined"', () => {
    for (const t of TIMES_OF_DAY) {
      expect(renderTimeOfDay(t), t).not.toContain("undefined");
    }
  });

  it("an unreadable clock NEUTRALISES to morning rather than failing the turn", () => {
    // SRV-PROMPT-10 — a rejected `life_step` is a hard loop, so a legacy world
    // holding a value this enum never had must still get a turn. Same coercion
    // the client's `readTimeOfDay` applied before the move.
    for (const bad of ["teatime", "", 7, null, undefined, {}]) {
      expect(readTimeOfDay(bad), String(bad)).toBe("morning");
    }
    for (const t of TIMES_OF_DAY) expect(readTimeOfDay(t)).toBe(t);
  });
});

describe("LIFE-TIME-1 — there is exactly ONE gloss table", () => {
  it("LIFE-TIME-1 — the step block quotes the BACKDROP table, not a copy of it", () => {
    // Behavioural: the story clause has to contain the same gloss the
    // illustrator is given, or the prose describes one hour and the picture
    // behind it is lit for another — LIFE-TIME-1's own defect by a new route.
    for (const t of BACKDROP_TIMES_OF_DAY) {
      const gloss = BACKDROP_TIME_OF_DAY_GLOSS[t];
      expect(gloss, t).toBeTruthy();
      expect(renderTimeOfDay(t), t).toContain(gloss);
    }
  });

  it("LIFE-TIME-1 — and the two enums are the same six values", () => {
    expect([...TIMES_OF_DAY]).toEqual([...BACKDROP_TIMES_OF_DAY]);
  });

  it("LIFE-TIME-1 — no SECOND table is declared beside the import", () => {
    // ⚠ THE ASSERTION THE OLD GUARD COULD NOT MAKE. Containment above would
    // still pass if someone re-declared the six strings here and they happened
    // to agree on the day it was written — which is exactly how this
    // duplication existed for eight batches. Asserted against a DECLARATION
    // rather than a mention, because the file's own prose explains the history.
    const src = stepBlocksSrc();
    expect(src).toContain("const GLOSS = BACKDROP_TIME_OF_DAY_GLOSS;");
    expect(src, "a second gloss table has been declared here").not.toMatch(
      /const\s+GLOSS[^=]*=\s*\{/,
    );
    // ...and the check is not passing because the import went away.
    expect(src).toMatch(/import \{ BACKDROP_TIME_OF_DAY_GLOSS \} from "\.\/lifeBackdrop";/);
  });
});
