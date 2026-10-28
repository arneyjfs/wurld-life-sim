import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGradedQuestionPrompt,
  gradedQuestionSystemInstruction,
  type GradedQuestionPromptInput,
  type LifeGradedQuestionPlan,
} from "../prompts/lifeGradedQuestion";
import {
  GRADED_VIOLATION_CODES,
  renderGradedViolation,
  type GradedViolation,
  type GradedViolationPlan,
} from "../prompts/lifeGradedViolations";

/**
 * SRV-PROMPT-3 — THE PORT DID NOT CHANGE A BYTE, and this is the evidence.
 *
 * Same shape as `bioGoldenParity.test.ts` / `sagaGoldenParity.test.ts`, and for
 * the same reason: the usual live comparison
 * (`tests/playthrough/serverPromptParity.test.ts`) runs both copies over one
 * input and diffs the bytes, which is only available while both copies exist.
 * `src/lib/life/prompts/gradedQuestion.ts` is DELETED — that is what
 * SRV-PROMPT-3 requires — so there is nothing live to compare against.
 *
 * `fixtures/gradedQuestionGolden.json` is therefore a CAPTURE: the exact output
 * of the client builders AND of the client critic, taken immediately before the
 * prompt half was deleted, across three system instructions, seventeen prompt
 * shapes and thirty-seven violation verdicts.
 *
 * ⚠ THE FIXTURE IS ONLY EVER DELETED, NEVER REFRESHED. Regenerating it from the
 * SERVER would make every assertion here vacuous — it would compare the port
 * with itself and report agreement. A genuine change to this prompt retires the
 * affected rows rather than re-recording them.
 *
 * ── WHY THESE SHAPES ────────────────────────────────────────────────────────
 *
 * PROMPTS: every branch of `buildGradedQuestionPrompt`, and the pairs that tell
 * two plausible mis-ports apart — a NAMED versus an UNNAMED speaker (the
 * direction block's two arms, which differ by an attribute AND by three
 * sentences); a scene `speakerName` on a PLAYER direction versus an NPC one
 * (the `<npcInScene>` suppression, invisible on either alone); an EMPTY scene
 * object and an empty `recentBeats` array, because `scene ? …` on the object
 * and `backdropSections.length ? …` on the result are indistinguishable when
 * something renders; a `null` and an EMPTY-STRING hint, because the old code
 * tested a falsy string where the new one tests an array length.
 *
 * VIOLATIONS: one row per `out.push` site in `leakViolations` /
 * `vocabViolations`, every branch of `directionViolations`, the Zod-issue path
 * and the invalid-JSON path — each isolated so that exactly one guard fires,
 * plus `L-CX`, which fires four at once and is the only row that can show the
 * ORDER survived.
 *
 * ⚠ ONE DIVERGENCE, DELIBERATE AND PINNED BELOW: the server ESCAPES `&<>` in
 * every violation parameter and the client did not. Four captured rows carry
 * markup and are asserted as the escaped form of the client's bytes rather than
 * as equal to them — including `Z schema issues, an array-length failure`,
 * whose `>=` comes from Zod itself and therefore diverges in PRODUCTION, not
 * only in a hostile fixture. Everything else is byte-identical.
 */

type Golden = {
  note: string;
  si: Record<string, { practiceLanguage: string; systemLanguage: string; difficulty: number; out: string }>;
  prompts: Record<string, { input: Record<string, unknown>; out: string }>;
  violations: Record<string, { out: string[] }>;
};

const golden: Golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "gradedQuestionGolden.json"), "utf8"),
) as Golden;

const SI_CASES = [
  "French / English / 3",
  "Japanese / German / 1",
  "Spanish / English (British) / 7",
];

/**
 * Each prompt row, and the `violations` that reproduce the hint the client
 * rendered as a string.
 *
 * ⚠ THE CODES ARE THE POINT OF THIS TABLE. The golden records a `violationHint`
 * STRING because that is what the client held; the replay rebuilds it from the
 * structured verdict, so a byte match proves the whole SRV-PROMPT-12 path —
 * templates, order, join and framing — and not merely that the surrounding
 * blocks are unchanged.
 */
const PROMPT_CASES: Record<string, GradedViolation[] | undefined> = {
  "fill-blank — plan only, no scene, no recent targets, no hint": undefined,
  "comprehension — named speaker, no scene": undefined,
  "comprehension — UNNAMED speaker, the null-name direction arm": undefined,
  "comprehension — XML-breaking speaker name in BOTH attribute and text positions": undefined,
  "fill-blank — full scene block, every field": undefined,
  "comprehension — scene speakerName is SUPPRESSED when the direction already names one": undefined,
  "fill-blank — EMPTY scene object renders no sceneContext block": undefined,
  "fill-blank — scene with ONLY recentBeats": undefined,
  "fill-blank — scene with EMPTY recentBeats array renders no beats block": undefined,
  "fill-blank — XML-breaking characters in the plan and the scene": undefined,
  "fill-blank — a violationHint block": [
    { code: "fill-blank-chip-practice-empty", chipIndex: 1 },
    { code: "fill-blank-chip-too-long", chipIndex: 2, tokenCount: 5 },
  ],
  "comprehension — scene AND recent targets AND a violationHint together": [
    { code: "comprehension-question-empty" },
  ],
  "fill-blank — an EMPTY-STRING violationHint is falsy and renders nothing": [],
  "fill-blank — a NULL violationHint renders nothing": undefined,
  "comprehension — attempt 2, the JOINED multi-family violation hint": [
    { code: "comprehension-missing-why-wrong" },
    { code: "comprehension-question-empty" },
    { code: "comprehension-utterance-native-missing" },
    { code: "comprehension-chip-native-empty", chipIndex: 1 },
    { code: "direction-kind-mismatch" },
    { code: "line-vocab-missing" },
  ],
  "fill-blank — attempt 2, the INVALID-JSON hint": [{ code: "invalid-json" }],
};

const FILL: GradedViolationPlan = {
  kind: "generation",
  testTarget: "voudrais",
  sentenceContext: "Je voudrais un café, merci.",
};
/** The one row whose plan differs: `testTarget` is absent from the sentence, so
 *  the client's guard took the `not-in-sentence` arm rather than `diverges`. */
const FILL_ABSENT: GradedViolationPlan = {
  kind: "generation",
  testTarget: "absent",
  sentenceContext: "Je voudrais un café, merci.",
};
const COMP: GradedViolationPlan = { kind: "comprehension" };

/** One row per `out.push` site, mapped to the codes that replace it. */
const VIOLATION_CASES: Array<[string, GradedViolation[], GradedViolationPlan]> = [
  ["L-C1 comprehension plan, generation prompt", [{ code: "comprehension-kind-mismatch" }], COMP],
  ["L-C2 a wrong comprehension chip with no whyWrong", [{ code: "comprehension-missing-why-wrong" }], COMP],
  [
    "L-C3 the npcUtterance is narrated, attributed speech",
    [
      {
        code: "comprehension-utterance-narrated",
        quote: "« Il est déjà parti ce matin, et personne ne sait où il va m",
      },
    ],
    COMP,
  ],
  ["L-C4 an empty comprehension question", [{ code: "comprehension-question-empty" }], COMP],
  ["L-C5 a missing utteranceNativeText", [{ code: "comprehension-utterance-native-missing" }], COMP],
  [
    "L-C6 a chip practiceText echoing the utterance",
    [{ code: "comprehension-chip-echoes-utterance", chipIndex: 0 }],
    COMP,
  ],
  [
    "L-C7 a chip nativeText that is a substring of the utterance",
    [{ code: "comprehension-chip-native-in-utterance", chipIndex: 0 }],
    COMP,
  ],
  ["L-C8 a chip with empty nativeText", [{ code: "comprehension-chip-native-empty", chipIndex: 1 }], COMP],
  [
    "L-C9b two chips sharing a nativeText — no markup",
    [
      {
        code: "comprehension-chips-share-native",
        chipIndex: 1,
        otherChipIndex: 2,
        quote: "she offers A COFFEE and a seat",
      },
    ],
    COMP,
  ],
  [
    "L-CX three comprehension guards at once, in push order",
    [
      { code: "comprehension-missing-why-wrong" },
      { code: "comprehension-question-empty" },
      { code: "comprehension-utterance-native-missing" },
      { code: "comprehension-chip-native-empty", chipIndex: 1 },
    ],
    COMP,
  ],
  ["L-G1 generation plan, comprehension prompt", [{ code: "fill-blank-kind-mismatch" }], FILL],
  ["L-G2 the practiceText has no ___ marker", [{ code: "fill-blank-missing-blank-marker" }], FILL],
  ["L-G3 a missing completedNativeText", [{ code: "fill-blank-completed-native-missing" }], FILL],
  [
    "L-G4 a completedNativeText that still holds the blank",
    [{ code: "fill-blank-completed-native-has-blank" }],
    FILL,
  ],
  [
    "L-G5 the correct chip is not in the sentenceContext",
    [{ code: "fill-blank-correct-chip-not-in-sentence", quote: "aimerais" }],
    FILL_ABSENT,
  ],
  [
    "L-G6 the correct chip diverges from the testTarget",
    [{ code: "fill-blank-correct-chip-diverges", quote: "café" }],
    FILL,
  ],
  [
    "L-G7b a fill-blank chip carrying a native gloss — no markup",
    [{ code: "fill-blank-chip-has-native-gloss", chipIndex: 1, quote: "want (plain) and blunt" }],
    FILL,
  ],
  ["L-G8 a chip with empty practiceText", [{ code: "fill-blank-chip-practice-empty", chipIndex: 1 }], FILL],
  [
    "L-G9 a chip repeating the template text BEFORE the blank",
    [{ code: "fill-blank-chip-contains-template-before", chipIndex: 1, quote: "hier soir je" }],
    FILL,
  ],
  [
    "L-G10 a chip repeating the template text AFTER the blank",
    [{ code: "fill-blank-chip-contains-template-after", chipIndex: 1, quote: "un café, merci" }],
    FILL,
  ],
  [
    "L-G11 a chip that is four tokens long",
    [{ code: "fill-blank-chip-too-long", chipIndex: 1, tokenCount: 4 }],
    FILL,
  ],
  [
    "L-G12b two chips sharing a practiceText — no markup",
    [{ code: "fill-blank-chips-share-practice", chipIndex: 1, otherChipIndex: 2, quote: "veux DONC" }],
    FILL,
  ],
  ["L-G13 a missing disambiguation strategy", [{ code: "fill-blank-disambiguation-missing" }], FILL],
  ["L-G14 a wrong fill-blank chip with no whyWrong", [{ code: "fill-blank-missing-why-wrong" }], FILL],
  [
    "L-G15 a translation-anchor whose translation holds the answer",
    [{ code: "fill-blank-anchor-leaks-answer", quote: "voudrais" }],
    FILL,
  ],
  ["V1 a comprehension question with no lineVocab", [{ code: "line-vocab-missing" }], COMP],
  // BOTH arms of the one direction code, because the server derives the wrong
  // kind from the plan — a port that got the derivation backwards would pass on
  // either row alone.
  ["D1a player direction, comprehension prompt", [{ code: "direction-kind-mismatch" }], FILL],
  ["D1b npc direction, generation prompt", [{ code: "direction-kind-mismatch" }], COMP],
  [
    "D2 player direction, narrated practiceText",
    [
      {
        code: "direction-player-line-narrated",
        quote: "« Je ___ un café, merci, et je ne veux rien d'autre », dit-e",
      },
    ],
    FILL,
  ],
  [
    "D3 npc direction, narrated npcUtterance",
    [
      {
        code: "direction-npc-line-narrated",
        quote: "« Il est déjà parti ce matin, et personne ne sait où », dit-",
      },
    ],
    COMP,
  ],
  [
    "Z schema issues, the first four",
    [
      {
        code: "schema-issue",
        path: "practicePrompt.question",
        message: "Invalid input: expected string, received undefined",
      },
    ],
    COMP,
  ],
  ["J the invalid-JSON hint", [{ code: "invalid-json" }], FILL],
];

const asPlan = (raw: unknown): LifeGradedQuestionPlan => raw as LifeGradedQuestionPlan;

/**
 * The recorded input, NARROWED to what the spec carries.
 *
 * The client handed `buildGradedQuestionPrompt` a `practiceLanguage`, a
 * `nativeLanguage` and a six-field scene. The spec carries neither language and
 * four scene fields, so the replay rebuilds the input from ONLY those — a port
 * that started reading `scene.difficulty`, `scene.systemLanguage` or either
 * language would be fed them by a lazier replay and would agree here while
 * rendering a hole in production.
 */
function narrowed(input: Record<string, unknown>, violations?: GradedViolation[]): GradedQuestionPromptInput {
  const s = input.scene as Record<string, unknown> | undefined;
  return {
    plan: asPlan(input.plan),
    recentTargets: (input.recentTargets ?? []) as string[],
    ...(s !== undefined
      ? {
          scene: {
            ...(s.sagaTitle !== undefined ? { sagaTitle: s.sagaTitle as string } : {}),
            ...(s.locationLabel !== undefined ? { locationLabel: s.locationLabel as string } : {}),
            ...(s.speakerName !== undefined ? { speakerName: s.speakerName as string } : {}),
            ...(s.recentBeats !== undefined ? { recentBeats: s.recentBeats as string[] } : {}),
          },
        }
      : {}),
    ...(violations !== undefined ? { violations } : {}),
  };
}

describe("SRV-PROMPT-3 — life_graded_question is byte-identical to the deleted client builder", () => {
  it("the SYSTEM INSTRUCTION matches, on three language/difficulty triples", () => {
    for (const label of SI_CASES) {
      const row = golden.si[label];
      expect(row, `missing SI fixture: ${label}`).toBeTruthy();
      expect(gradedQuestionSystemInstruction(row!), label).toBe(row!.out);
    }
  });

  it("the USER PROMPT matches, on every captured shape — rebuilt from CODES", () => {
    for (const [label, violations] of Object.entries(PROMPT_CASES)) {
      const row = golden.prompts[label];
      expect(row, `missing prompt fixture: ${label}`).toBeTruthy();
      expect(buildGradedQuestionPrompt(narrowed(row!.input, violations)), label).toBe(row!.out);
    }
  });

  it("every VIOLATION TEMPLATE matches, one row per guard site", () => {
    for (const [label, codes, plan] of VIOLATION_CASES) {
      const row = golden.violations[label];
      expect(row, `missing violation fixture: ${label}`).toBeTruthy();
      expect(codes.map((c) => renderGradedViolation(c, plan)), label).toEqual(row!.out);
    }
  });
});

/**
 * ── THE ONE DIVERGENCE, PINNED RATHER THAN EXCUSED ──────────────────────────
 *
 * `<violationHint>` was the SINGLE unescaped interpolation in the client's
 * builder — the plan, the scene, the beats and the recent targets were all
 * escaped, and the hint (which carries MODEL text, and after this batch could
 * carry CALLER text) was not. The server escapes it.
 *
 * So these four rows are asserted as "the client's bytes, transformed" rather
 * than as equal. Asserting the TRANSFORM rather than skipping the rows is what
 * makes this a disclosure instead of a hole: if the server ever escaped
 * something else, or stopped escaping, these fail.
 *
 * ⚠ THE TRANSFORM IS TWO STEPS, AND THE SECOND EXISTS BECAUSE THE FIRST HAD A
 * SIDE EFFECT NOBODY WANTED. Escaping is correct — `message` is caller-supplied
 * text on the wire. But Zod writes its own bounds with `<=` / `>=`, and
 * `choices` is `.min(3).max(4)`, so the two commonest schema failures on this
 * call were exactly the two messages the escape mangled: the model was asked to
 * fix an array length and read `&gt;=3`. Spelling the operator removes the
 * character instead of encoding it, so the escape has nothing left to do on the
 * realistic path. Both steps are pinned here, in order.
 */
describe("SRV-PROMPT-14 — the divergence is exactly the escape, plus the operator spelling", () => {
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

  /** Only `schema-issue` spells its operators, and that matters: a chip QUOTE
   *  carrying `<O'Brien>` must still arrive escaped, not as
   *  "less than O'Brien more than". Keying the transform on the code is what
   *  keeps this test from blessing the spelling where it would be wrong. */
  const spell = (s: string) =>
    s.replace(/<=\s*/g, "at most ").replace(/>=\s*/g, "at least ");

  const expectedFor = (code: GradedViolation, clientBytes: string) =>
    code.code === "schema-issue" ? esc(spell(clientBytes)) : esc(clientBytes);

  const MARKUP_CASES: Array<[string, GradedViolation[], GradedViolationPlan]> = [
    [
      "L-C9 two chips sharing a nativeText",
      [
        {
          code: "comprehension-chips-share-native",
          chipIndex: 1,
          otherChipIndex: 2,
          quote: 'she offers A "COFFEE" & a seat',
        },
      ],
      COMP,
    ],
    [
      "L-G7 a fill-blank chip carrying a native gloss",
      [{ code: "fill-blank-chip-has-native-gloss", chipIndex: 1, quote: 'want ("plain") & blunt' }],
      FILL,
    ],
    [
      "L-G12 two chips sharing a practiceText",
      [
        {
          code: "fill-blank-chips-share-practice",
          chipIndex: 1,
          otherChipIndex: 2,
          quote: 'veux & "CO"',
        },
      ],
      FILL,
    ],
    [
      // ⚠ THE ONE THAT DIVERGES IN PRODUCTION. Zod writes "expected array to
      // have >=3 items" itself, so every array-length failure on this call now
      // reaches the model as `&gt;=3`. That is the whole disclosure: the other
      // three rows need a hostile or unusual chip to differ at all.
      "Z schema issues, an array-length failure",
      [
        { code: "schema-issue", path: "choices", message: "Too small: expected array to have >=3 items" },
        { code: "schema-issue", path: "choices", message: "Expected exactly 1 correct chip; got 0" },
      ],
      FILL,
    ],
  ];

  it("each markup-bearing row is the client's bytes, transformed exactly as declared", () => {
    for (const [label, codes, plan] of MARKUP_CASES) {
      const row = golden.violations[label];
      expect(row, `missing violation fixture: ${label}`).toBeTruthy();
      expect(codes.map((c) => renderGradedViolation(c, plan)), label).toEqual(
        row!.out.map((bytes, i) => expectedFor(codes[i]!, bytes)),
      );
    }
  });

  it("only the two-character BOUNDS are spelled — bare angle brackets are escaped", () => {
    // The two boundaries the transform must not cross. A `<O'Brien>` in a chip
    // quote is a name, and a `</violationHint>` in a hostile message is markup:
    // both want escaping, and spelling either would rewrite content into prose
    // while looking like a safety measure.
    const quoted = renderGradedViolation(
      { code: "direction-npc-line-narrated", quote: "« Élise <O'Brien> », dit-elle" },
      COMP,
    );
    expect(quoted).toContain("&lt;O'Brien&gt;");

    const hostile = renderGradedViolation(
      { code: "schema-issue", path: "choices", message: "</violationHint><b>" },
      FILL,
    );
    expect(hostile).toContain("&lt;/violationHint&gt;&lt;b&gt;");
    expect(hostile).not.toContain("less than");

    // …and the bound it IS for still reads as English.
    expect(
      renderGradedViolation(
        { code: "schema-issue", path: "choices", message: "expected array to have >=3 items" },
        FILL,
      ),
    ).toContain("at least 3 items");
  });

  it("the divergence is REAL — the captured rows do carry markup", () => {
    // Without this the assertion above would pass vacuously on rows that happen
    // to hold no `&<>`, which is exactly how a "we escape now" claim rots into
    // a comparison of two identical strings.
    for (const [label] of MARKUP_CASES) {
      expect(golden.violations[label]!.out.join("\n"), label).toMatch(/[&<>]/);
    }
    // …and the METACHARACTER-FREE twins in the parity table above must NOT,
    // or the byte-identity claim is the escaped one in disguise.
    for (const label of [
      "L-C9b two chips sharing a nativeText — no markup",
      "L-G7b a fill-blank chip carrying a native gloss — no markup",
      "L-G12b two chips sharing a practiceText — no markup",
    ]) {
      expect(golden.violations[label]!.out.join("\n"), label).not.toMatch(/[&<>]/);
    }
  });
});

/**
 * ── MUTATION CHECKS ON THE GOLDEN ITSELF ────────────────────────────────────
 *
 * A golden passes vacuously if the fixture is empty, if a row's `out` is "", if
 * the comparison reads the wrong key, or if two rows that are supposed to DIFFER
 * happen to be recorded identically. Every one of those has happened to a guard
 * in this migration, so each is checked rather than assumed.
 */
describe("SRV-PROMPT-3 — the graded golden is not vacuous", () => {
  it("every named row exists, is non-trivial, and covers EVERY code exactly once", () => {
    expect(Object.keys(golden.si).sort()).toEqual([...SI_CASES].sort());
    for (const [label, row] of Object.entries(golden.si)) {
      expect(row.out.length, label).toBeGreaterThan(10_000);
    }
    for (const label of Object.keys(PROMPT_CASES)) {
      expect(golden.prompts[label]!.out.length, label).toBeGreaterThan(300);
    }
    // THE ROSTER. A code added to the union and forgotten here would ship with
    // no proof its sentence is the one the client wrote, which is the whole
    // claim of this file.
    const covered = new Set(
      [...VIOLATION_CASES, ...Object.values(PROMPT_CASES).filter(Boolean).map((v) => ["", v!, FILL] as const)]
        .flatMap(([, codes]) => codes.map((c) => c.code)),
    );
    const missing = GRADED_VIOLATION_CODES.filter((c) => !covered.has(c));
    expect(missing, `codes with no golden row: ${missing.join(", ")}`).toEqual([]);
  });

  it("the NULL-hint and EMPTY-hint rows are recorded as IDENTICAL to the no-hint one", () => {
    // The old builder tested a falsy STRING; the new one tests an array LENGTH.
    // Pinning the equality is what makes `violations: []` provably the same
    // prompt as attempt 1 rather than a block containing nothing.
    const none = golden.prompts["fill-blank — plan only, no scene, no recent targets, no hint"]!.out;
    expect(golden.prompts["fill-blank — a NULL violationHint renders nothing"]!.out).toBe(none);
    expect(
      golden.prompts["fill-blank — an EMPTY-STRING violationHint is falsy and renders nothing"]!.out,
    ).toBe(none);
  });

  it("the two DIRECTION arms are two different strings, and the named one names its speaker", () => {
    const named = golden.prompts["comprehension — named speaker, no scene"]!.out;
    const unnamed = golden.prompts["comprehension — UNNAMED speaker, the null-name direction arm"]!.out;
    expect(named).not.toBe(unnamed);
    expect(named).toContain('<direction speaker="npc" name="Sophie">');
    expect(unnamed).toContain('<direction speaker="npc">');
    expect(unnamed).not.toContain('name="');
    expect(unnamed).toContain("that character's speech bubble");
  });

  it("the scene-suppression pair is captured, and it really differs", () => {
    // `<npcInScene>` renders on a PLAYER direction and is suppressed on an NPC
    // one. A port that dropped the suppression would still pass every other row.
    const player = golden.prompts["fill-blank — full scene block, every field"]!.out;
    const npc = golden.prompts[
      "comprehension — scene speakerName is SUPPRESSED when the direction already names one"
    ]!.out;
    expect(player).toContain("<npcInScene>Bébert</npcInScene>");
    expect(npc).toContain("<sceneContext>");
    expect(npc).not.toContain("npcInScene");
  });

  it("the EMPTY-scene rows drop their blocks entirely", () => {
    expect(golden.prompts["fill-blank — EMPTY scene object renders no sceneContext block"]!.out).not.toContain(
      "<sceneContext>",
    );
    const onlyBeats = golden.prompts["fill-blank — scene with ONLY recentBeats"]!.out;
    expect(onlyBeats).toContain("<recentBeats>");
    expect(onlyBeats).not.toContain("<saga>");
    const emptyBeats = golden.prompts["fill-blank — scene with EMPTY recentBeats array renders no beats block"]!.out;
    expect(emptyBeats).toContain("<saga>");
    expect(emptyBeats).not.toContain("recentBeats");
  });

  it("the ESCAPING rows carry every escape class, in attribute AND text position", () => {
    const plan = golden.prompts["fill-blank — XML-breaking characters in the plan and the scene"]!.out;
    expect(plan).toContain("<testTarget>A &amp; B</testTarget>");
    expect(plan).toContain("<sentenceContext>Je &lt;dis&gt; \"A &amp; B\" ici.</sentenceContext>");
    const attr = golden.prompts[
      "comprehension — XML-breaking speaker name in BOTH attribute and text positions"
    ]!.out;
    // `escapeAttr` adds `&quot;` on top of `escapeText`; the same name appears
    // unquoted in the TEXT node below it, which is the pair a port reaching for
    // one escape function would collapse.
    expect(attr).toContain("&quot;");
    expect(attr).toContain("&lt;O'Brien&gt;");
  });

  it("the JOINED multi-family row really holds four templates, newline-joined", () => {
    const out = golden.prompts["comprehension — attempt 2, the JOINED multi-family violation hint"]!.out;
    const body = out.slice(out.indexOf("re-emit:\n") + "re-emit:\n".length, out.indexOf("</violationHint>"));
    expect(body.split("\n")).toHaveLength(6);
  });

  it("the three SI rows are three DIFFERENT strings", () => {
    expect(new Set(SI_CASES.map((l) => golden.si[l]!.out)).size).toBe(3);
  });
});
