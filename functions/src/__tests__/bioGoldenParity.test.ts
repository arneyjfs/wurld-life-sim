import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bioSystemInstruction,
  buildBioPrompt,
  type BioPromptInput,
} from "../prompts/lifeBio";

/**
 * SRV-PROMPT-3 — THE PORT DID NOT CHANGE A BYTE, and this is the evidence.
 *
 * Same shape as `sagaGoldenParity.test.ts` / `sceneGoldenParity.test.ts`, and
 * for the same reason: the usual live comparison
 * (`tests/playthrough/serverPromptParity.test.ts`) runs both copies over one
 * input and diffs the bytes, which is only available while both copies exist.
 * `src/lib/life/prompts/bio.ts` is DELETED — that is what SRV-PROMPT-3 requires
 * — so there is nothing live to compare against.
 *
 * `fixtures/bioGolden.json` is therefore a CAPTURE: the exact output of the
 * client builders, taken immediately before they were deleted, across fifteen
 * prompt shapes and three system instructions.
 *
 * ⚠ THE FIXTURE IS ONLY EVER DELETED, NEVER REFRESHED. Regenerating it from the
 * SERVER would make every assertion here vacuous — it would compare the port
 * with itself and report agreement. A genuine change to this prompt retires the
 * affected rows rather than re-recording them.
 *
 * ── WHY THESE FIFTEEN SHAPES ────────────────────────────────────────────────
 *
 * Every branch in `buildBioPrompt`, and the pairs that tell two plausible
 * mis-ports apart:
 *
 *  - seed text present / absent — the two mutually exclusive seed lines;
 *  - `worldMode` absent / realistic / fantasy — three arms, two of which differ
 *    only in a gloss a port could easily swap;
 *  - `story` present / absent / explicitly NULL, because the call site passes
 *    `null` when `sagaOpen` failed and a port reading it as truthy would render
 *    `<world title="undefined">`;
 *  - EMPTY `cast` and EMPTY `fronts`, separately and together, because
 *    `cast ? …` on the JOINED STRING and `cast.length ? …` on the array are
 *    indistinguishable on a non-empty list;
 *  - `resolved` at `null`, `'filled'` and `'cleared'` in ONE list, which is the
 *    only shape that can tell the live filter from no filter;
 *  - XML-breaking characters in every attribute AND every text node, because
 *    this builder uses ONE `esc` for both positions where its neighbours split
 *    `esc`/`escT` — a port that reached for the split idiom would diverge only
 *    on a `"` inside a text node;
 *  - a second language pair, because the SI interpolates one of them.
 *
 * ⚠ ONE SHAPE THIS FIXTURE CANNOT HOLD: `resolved: undefined` versus the key
 * being ABSENT. `JSON.stringify` drops both to the same thing, so the recorded
 * INPUT cannot distinguish them even though the recorded OUTPUT is correct for
 * both. That distinction is asserted in `lifeBio.test.ts`, in TypeScript, where
 * it is representable — it is exactly the mutation that survived batch 3's
 * parity guard (`== null` vs `=== null`), so it is checked somewhere rather
 * than assumed everywhere.
 */

type PromptCase = { input: Record<string, unknown>; out: string };
type SiCase = { practiceLanguage: string; out: string };
type Golden = {
  note: string;
  si: Record<string, SiCase>;
  prompts: Record<string, PromptCase>;
};

const golden: Golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "bioGolden.json"), "utf8"),
) as Golden;

/** The fifteen prompt rows, named. A row missing from the fixture is a fixture
 *  that quietly lost a branch, which is how a golden test starts passing
 *  vacuously — so the names are asserted as well as the bytes. */
const PROMPT_CASES = [
  "minimal — chip seed, no mode, no story",
  "manual seed text — the free-text branch",
  "worldMode realistic — the plausible-life gloss",
  "worldMode fantasy — the heightened-genre gloss",
  "mode AND manual seed text together",
  "story present — title, tone, situation, cast and inMotion all render",
  "story present, EMPTY cast — no <cast> block",
  "story present, EMPTY fronts — no <inMotion> block",
  "story present, EMPTY cast AND fronts — the bare <world> block",
  "story = null — identical to no story at all",
  "fronts: resolved ABSENT, undefined and null all count as live",
  "fronts: 'filled' and 'cleared' are dropped, the live one stays",
  "fronts: EVERY front resolved — no <inMotion> block",
  "XML-breaking characters in every attribute and every text node",
  "a second language pair (ja/de) with a fantasy mode and a story",
];

const SI_CASES = ["French", "Japanese", "Chinese (Traditional)"];

/**
 * The fixture records the CLIENT's input, which for the cast and fronts was a
 * full `CastMember` / `Front` — the call site handed the whole object over and
 * the builder read two fields off it. The SERVER's input is NARROWED (the spec
 * sends `{name, known}` and `{agenda, resolved?}` and nothing else), so the
 * replay hands the recorded objects straight to the narrowed builder: any field
 * the port started reading that the spec does not carry would be present here
 * and absent in production, which is the one way this golden could agree with a
 * port that is wrong. Asserted directly, below.
 */
const toInput = (raw: Record<string, unknown>): BioPromptInput =>
  raw as unknown as BioPromptInput;

describe("SRV-PROMPT-3 — life_bio is byte-identical to the deleted client builder", () => {
  it("the SYSTEM INSTRUCTION matches, on three languages", () => {
    for (const label of SI_CASES) {
      const row = golden.si[label];
      expect(row, `missing SI fixture: ${label}`).toBeTruthy();
      expect(bioSystemInstruction(row!.practiceLanguage), label).toBe(row!.out);
    }
  });

  it("the USER PROMPT matches, on every captured shape", () => {
    for (const label of PROMPT_CASES) {
      const row = golden.prompts[label];
      expect(row, `missing prompt fixture: ${label}`).toBeTruthy();
      expect(buildBioPrompt(toInput(row!.input)), label).toBe(row!.out);
    }
  });

  it("the SPEC carries every field the golden's inputs use — no hidden reader", () => {
    // The replay above hands the builder the CLIENT's fat objects. If the port
    // had started reading a field the wire does not carry (`tier`, `voice`,
    // `driverId`, `clock`…), the replay would still pass while production
    // rendered a hole. So the narrowed shape is asserted directly: rebuilding
    // each cast member and front from ONLY the spec's fields must produce the
    // same bytes.
    for (const label of PROMPT_CASES) {
      const input = toInput(golden.prompts[label]!.input);
      if (!input.story) continue;
      const narrowed: BioPromptInput = {
        ...input,
        story: {
          title: input.story.title,
          tone: input.story.tone,
          situation: input.story.situation,
          cast: input.story.cast.map((c) => ({ name: c.name, known: c.known })),
          fronts: input.story.fronts.map((f) =>
            "resolved" in f ? { agenda: f.agenda, resolved: f.resolved } : { agenda: f.agenda },
          ),
        },
      };
      expect(buildBioPrompt(narrowed), label).toBe(golden.prompts[label]!.out);
    }
  });
});

/**
 * ── MUTATION CHECKS ON THE GOLDEN ITSELF ────────────────────────────────────
 *
 * A golden passes vacuously if the fixture is empty, if a row's `out` is "", if
 * the comparison reads the wrong key, or if two rows that are supposed to
 * DIFFER happen to be recorded identically. Every one of those has happened to
 * a guard in this migration, so each is checked rather than assumed.
 */
describe("SRV-PROMPT-3 — the bio golden fixture is not vacuous", () => {
  it("every named row exists, is non-trivial, and carries its input", () => {
    expect(Object.keys(golden.prompts).sort()).toEqual([...PROMPT_CASES].sort());
    expect(Object.keys(golden.si).sort()).toEqual([...SI_CASES].sort());
    for (const [label, row] of Object.entries(golden.prompts)) {
      expect(row.out.length, label).toBeGreaterThan(80);
      expect(row.input.characterName, label).toBeTruthy();
    }
    for (const [label, row] of Object.entries(golden.si)) {
      expect(row.out.length, label).toBeGreaterThan(2_000);
    }
  });

  it("the NULL-story row is recorded as IDENTICAL to the story-less one", () => {
    // That equality is the assertion, not an accident: `s ? … : ''` renders
    // nothing for `null` where `'story' in input` would render a `<world>` block
    // full of `undefined`. Pinning it here means a fixture regenerated from a
    // port that got this wrong fails loudly instead of recording the new
    // behaviour as the contract.
    expect(golden.prompts["story = null — identical to no story at all"]!.out).toBe(
      golden.prompts["minimal — chip seed, no mode, no story"]!.out,
    );
  });

  it("the EMPTY-array rows drop their blocks, and the bare row drops both", () => {
    const full = golden.prompts[
      "story present — title, tone, situation, cast and inMotion all render"
    ]!.out;
    const noCast = golden.prompts["story present, EMPTY cast — no <cast> block"]!.out;
    const noFronts = golden.prompts["story present, EMPTY fronts — no <inMotion> block"]!.out;
    const bare = golden.prompts[
      "story present, EMPTY cast AND fronts — the bare <world> block"
    ]!.out;
    expect(full).toContain("<cast>");
    expect(full).toContain("<inMotion>");
    expect(noCast).not.toContain("<cast>");
    expect(noCast).toContain("<inMotion>");
    expect(noFronts).toContain("<cast>");
    expect(noFronts).not.toContain("<inMotion>");
    expect(bare).toContain("<world ");
    expect(bare).not.toContain("<cast>");
    expect(bare).not.toContain("<inMotion>");
  });

  it("the LIVE-filter rows are captured: three live, then one of three", () => {
    // If the filter were dropped in the port these two rows would both render
    // three forces and every other assertion would still pass.
    const live = golden.prompts["fronts: resolved ABSENT, undefined and null all count as live"]!.out;
    const mixed = golden.prompts["fronts: 'filled' and 'cleared' are dropped, the live one stays"]!.out;
    const none = golden.prompts["fronts: EVERY front resolved — no <inMotion> block"]!.out;
    expect((live.match(/<force>/g) ?? []).length).toBe(3);
    expect((mixed.match(/<force>/g) ?? []).length).toBe(1);
    expect(mixed).toContain("Live: the roster week is still promised elsewhere.");
    expect(mixed).not.toContain("Filled:");
    expect(mixed).not.toContain("Cleared:");
    expect(none).not.toContain("<inMotion>");
  });

  it("the three mode rows are three DIFFERENT strings", () => {
    const outs = [
      golden.prompts["minimal — chip seed, no mode, no story"]!.out,
      golden.prompts["worldMode realistic — the plausible-life gloss"]!.out,
      golden.prompts["worldMode fantasy — the heightened-genre gloss"]!.out,
    ];
    expect(new Set(outs).size).toBe(3);
  });

  it("the escaping row carries BOTH escape classes in a TEXT node", () => {
    // The one-`esc`-for-everything property, pinned in the fixture as well as in
    // the builder test: a `&quot;` inside `<situation>` is what a split
    // `esc`/`escT` port would lose, and nothing else in this fixture would move.
    const out = golden.prompts["XML-breaking characters in every attribute and every text node"]!.out;
    expect(out).toContain("<situation>She said &quot;no&quot; &amp; left &lt;the yard&gt;.</situation>");
    expect(out).toContain("&lt;");
    expect(out).toContain("&amp;");
  });

  it("the three SI rows are three DIFFERENT strings", () => {
    const outs = SI_CASES.map((l) => golden.si[l]!.out);
    expect(new Set(outs).size).toBe(3);
  });
});
