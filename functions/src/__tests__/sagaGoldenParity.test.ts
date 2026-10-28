import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSagaOpenPrompt,
  sagaOpenResponseSchema,
  sagaOpenSystemInstruction,
  type SagaOpenPromptInput,
} from "../prompts/lifeSagaOpen";

/**
 * SRV-PROMPT-3 — THE PORT DID NOT CHANGE A BYTE, and this is the evidence.
 *
 * Same shape as `sceneGoldenParity.test.ts` and for the same reason: the usual
 * live comparison (`tests/playthrough/serverPromptParity.test.ts`) runs both
 * copies over one input and diffs the bytes, which is only available while both
 * copies exist. `src/lib/life/prompts/sagaOpen.ts` is DELETED — that is what
 * SRV-PROMPT-3 requires — so there is nothing live to compare against.
 *
 * `fixtures/sagaGolden.json` is therefore a CAPTURE: the exact output of the
 * client builders, taken immediately before they were deleted, across fifteen
 * prompt shapes, five system instructions and BOTH response schemas.
 *
 * ⚠ THE FIXTURE IS ONLY EVER DELETED, NEVER REFRESHED. Regenerating it from the
 * SERVER would make every assertion here vacuous — it would compare the port
 * with itself and report agreement. A genuine change to this prompt retires the
 * affected rows rather than re-recording them.
 *
 * ── WHY THESE FIFTEEN SHAPES ────────────────────────────────────────────────
 *
 * Every branch in `buildSagaOpenPrompt`, and the pairs that tell two plausible
 * mis-ports apart:
 *
 *  - `universe` present / absent — the succession fork, which also decides
 *    whether `<texture>` renders at all;
 *  - `survivingCast` and `priorSagaHistory` present WITHOUT a universe, because
 *    the three blocks are independent in the client and a port that folded them
 *    under one `if (succession)` would still pass every succession row;
 *  - both arrays EMPTY, because `input.survivingCast?.length` and
 *    `input.survivingCast != null` are indistinguishable on a non-empty array.
 *    The two rows that collide with their minimal counterparts are the ones
 *    doing that work — see the SHAPE assertions at the bottom, which pin the
 *    collisions so a fixture that lost them fails instead of passing;
 *  - a history of 14 lines, which is the only input that can tell `.slice(-10)`
 *    from no slice at all;
 *  - three different `world.id`s, because the `<texture>` block is hashed from
 *    it and a port that dropped the salt would render one texture for all three;
 *  - XML-breaking characters in every attribute and every text node, on both
 *    arms, because `esc` and `escT` are different functions and a port that used
 *    one for both would only diverge on a `"`.
 */

type PromptCase = { input: Record<string, unknown>; out: string };
type SiCase = {
  opts: {
    practiceLanguage: string;
    systemLanguage: string;
    succession: boolean;
    realistic: boolean;
  };
  out: string;
};
type Golden = {
  note: string;
  si: Record<string, SiCase>;
  schema: Record<string, unknown>;
  prompts: Record<string, PromptCase>;
};

const golden: Golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "sagaGolden.json"), "utf8"),
) as Golden;

/** The fifteen prompt rows, named. A row missing from the fixture is a fixture
 *  that quietly lost a branch, which is how a golden test starts passing
 *  vacuously — so the names are asserted as well as the bytes. */
const PROMPT_CASES = [
  "minimal new world — no mode, no seed text",
  "new world with mode and a manual seed description",
  "new world, XML-breaking characters everywhere",
  "new world, a DIFFERENT world id (texture must move)",
  "new world, third world id (texture spread)",
  "succession — universe only, no cast, no history",
  "succession — universe with EMPTY laws and places",
  "succession — universe + surviving cast, both tiers",
  "succession — history at EXACTLY the 10-line slice",
  "succession — history at 14 lines (distinguishes the slice(-10))",
  "succession — everything, with XML-breaking characters",
  "surviving cast WITHOUT a universe — texture STAYS (branches are independent)",
  "prior history WITHOUT a universe — texture STAYS",
  "EMPTY arrays — neither block may render (distinguishes ?.length from != null)",
  "succession with EMPTY arrays — universe renders, the other two do not",
];

const SI_CASES = [
  "fr/en succession=false realistic=false",
  "fr/en succession=false realistic=true",
  "fr/en succession=true realistic=false",
  "fr/en succession=true realistic=true",
  "ja/de succession=false realistic=true (a second language pair)",
];

/**
 * The fixture records the CLIENT's input — a nested `{ world, universe,
 * survivingCast, priorSagaHistory }` — because that is what the deleted builder
 * took. The server's input is FLAT, because the spec is (`life_world_arc`'s
 * precedent: the client does not send a `LifeWorld`). That reshaping is the ONE
 * difference between the two signatures, so it is written out here rather than
 * cast away — a blanket `as` would let a renamed field pass as `undefined` and
 * the golden would then be comparing the port with a hole in it.
 */
const toInput = (raw: Record<string, unknown>): SagaOpenPromptInput => {
  const w = raw.world as Record<string, unknown>;
  const u = raw.universe as Record<string, unknown> | undefined;
  return {
    worldId: w.id as string,
    characterName: w.characterName as string,
    practiceLanguage: w.practiceLanguage as string,
    nativeLanguage: w.nativeLanguage as string,
    worldSeedKey: w.worldSeedKey as string,
    ...(w.worldMode !== undefined
      ? { worldMode: w.worldMode as "realistic" | "fantasy" }
      : {}),
    ...(w.worldSeedText !== undefined ? { worldSeedText: w.worldSeedText as string } : {}),
    ...(u !== undefined
      ? {
          universe: {
            setting: u.setting as string,
            era: u.era as string,
            laws: u.laws as string[],
            places: u.places as string[],
          },
        }
      : {}),
    ...(raw.survivingCast !== undefined
      ? { survivingCast: raw.survivingCast as SagaOpenPromptInput["survivingCast"] }
      : {}),
    ...(raw.priorSagaHistory !== undefined
      ? { priorSagaHistory: raw.priorSagaHistory as string[] }
      : {}),
  };
};

describe("SRV-PROMPT-3 — life_saga is byte-identical to the deleted client builder", () => {
  /**
   * ⚠ ONE DELIBERATE DIVERGENCE FROM THE CAPTURED BYTES, pinned rather than
   * regenerated away (SRV-PROMPT-18).
   *
   * `LEXICON_RULES` — shared by `life_saga` and `life_world_arc` — said *"Their
   * `<voice>` row is the source"*. No builder anywhere emits a `<voice>`
   * ELEMENT: `voice` is an attribute on `<person>`, in both consumers. It was
   * one of three dangling tag references the SRV-PROMPT-18 guard turned up.
   *
   * This golden's job is "byte-identical to the deleted client builder", and
   * that claim is now intentionally false for exactly one substring. Asserting
   * the TRANSFORM instead of recapturing the fixture is what keeps the claim
   * honest: recapturing would make the divergence invisible and the test would
   * go on reporting byte-identity it no longer has. If anything ELSE in the SI
   * moves, these still fail.
   */
  const FIXED_VOICE_REF = (s: string) =>
    s.replace('Their <voice> row is the source;', 'Their voice="…" attribute is the source;');

  it("the SYSTEM INSTRUCTION matches, on all four flag combinations and a second language pair", () => {
    for (const label of SI_CASES) {
      const row = golden.si[label];
      expect(row, `missing SI fixture: ${label}`).toBeTruthy();
      expect(sagaOpenSystemInstruction(row!.opts), label).toBe(FIXED_VOICE_REF(row!.out));
    }
  });

  it("SRV-PROMPT-18 — the divergence is REAL and is the only one", () => {
    // Without this the assertion above would pass vacuously if the captured
    // bytes had never contained `<voice>` — a transform applied to nothing is
    // indistinguishable from byte-identity, which is exactly the shape of
    // pass-on-nothing this migration has hit five times.
    const someRow = golden.si[SI_CASES[0]!]!.out;
    expect(someRow).toContain("Their <voice> row is the source;");
    expect(FIXED_VOICE_REF(someRow)).not.toBe(someRow);
    // …and the live SI no longer names a `<voice>` element at all.
    expect(sagaOpenSystemInstruction(golden.si[SI_CASES[0]!]!.opts)).not.toContain("<voice>");
  });

  it("the RESPONSE SCHEMA matches on BOTH arms — SRV-PROMPT-1, it is half the artefact", () => {
    expect(sagaOpenResponseSchema(false)).toEqual(
      golden.schema["new world (succession=false)"],
    );
    expect(sagaOpenResponseSchema(true)).toEqual(golden.schema["succession (succession=true)"]);
  });

  it("the USER PROMPT matches, on every captured shape", () => {
    for (const label of PROMPT_CASES) {
      const row = golden.prompts[label];
      expect(row, `missing prompt fixture: ${label}`).toBeTruthy();
      expect(buildSagaOpenPrompt(toInput(row!.input)), label).toBe(row!.out);
    }
  });
});

/**
 * ── MUTATION CHECKS ON THE GOLDEN ITSELF ────────────────────────────────────
 *
 * A golden passes vacuously if the fixture is empty, if a row's `out` is "",
 * if the comparison reads the wrong key, or if two rows that are supposed to
 * DIFFER happen to be recorded identically. Every one of those has happened to
 * a guard in this migration, so each is checked rather than assumed.
 */
describe("SRV-PROMPT-3 — the golden fixture is not vacuous", () => {
  it("every named row exists, is non-trivial, and carries its input", () => {
    expect(Object.keys(golden.prompts).sort()).toEqual([...PROMPT_CASES].sort());
    expect(Object.keys(golden.si).sort()).toEqual([...SI_CASES].sort());
    for (const [label, row] of Object.entries(golden.prompts)) {
      expect(row.out.length, label).toBeGreaterThan(80);
      expect(row.input.world, label).toBeTruthy();
    }
    for (const [label, row] of Object.entries(golden.si)) {
      expect(row.out.length, label).toBeGreaterThan(5_000);
    }
  });

  it("the three world ids produce three DIFFERENT textures", () => {
    // LIFE-STORY-EXEMPLAR-2's whole point. If the salt were dropped in the port
    // these three rows would agree and every other assertion would still pass.
    const texture = (label: string) => {
      const out = golden.prompts[label]!.out;
      return out.slice(out.indexOf("<texture>"), out.indexOf("</texture>"));
    };
    const seen = new Set([
      texture("minimal new world — no mode, no seed text"),
      texture("new world, a DIFFERENT world id (texture must move)"),
      texture("new world, third world id (texture spread)"),
    ]);
    expect(seen.size).toBe(3);
    for (const t of seen) expect(t.length).toBeGreaterThan(50);
  });

  it("the EMPTY-array rows are recorded as IDENTICAL to their minimal counterparts", () => {
    // That equality is the assertion, not an accident: `?.length` renders
    // nothing for `[]` where `!= null` would render an empty block. Pinning it
    // here means a fixture regenerated from a port that got this wrong fails
    // loudly instead of recording the new behaviour as the contract.
    expect(
      golden.prompts["EMPTY arrays — neither block may render (distinguishes ?.length from != null)"]!
        .out,
    ).toBe(golden.prompts["minimal new world — no mode, no seed text"]!.out);
    expect(
      golden.prompts["succession with EMPTY arrays — universe renders, the other two do not"]!.out,
    ).toBe(golden.prompts["succession — universe only, no cast, no history"]!.out);
  });

  it("the 14-line history row is SHORTER than 14 lines' worth — the slice is captured", () => {
    const ten = golden.prompts["succession — history at EXACTLY the 10-line slice"]!.out;
    const fourteen = golden.prompts[
      "succession — history at 14 lines (distinguishes the slice(-10))"
    ]!.out;
    // Ten lines and fourteen must render the same NUMBER of rows…
    expect((ten.match(/<line>/g) ?? []).length).toBe(10);
    expect((fourteen.match(/<line>/g) ?? []).length).toBe(10);
    // …but not the same rows: the slice keeps the LAST ten, so the fourteen-line
    // row starts at "Line 4." A port that sliced from the head would agree on the
    // count and disagree here.
    expect(fourteen).toContain("<line>Line 4.</line>");
    expect(fourteen).not.toContain("<line>Line 3.</line>");
    expect(ten).toContain("<line>Line 0.</line>");
  });

  it("the four SI flag combinations are four DIFFERENT strings", () => {
    const outs = SI_CASES.slice(0, 4).map((l) => golden.si[l]!.out);
    expect(new Set(outs).size).toBe(4);
  });
});
