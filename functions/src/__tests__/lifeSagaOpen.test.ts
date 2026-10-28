/**
 * LIFE-ARCH-1/3 / LIFE-WORLD-SAGA-* — the world-open prompt, server-side.
 *
 * SRV-PROMPT-8..13 batch 5. `src/lib/life/prompts/sagaOpen.ts` is DELETED
 * (SRV-PROMPT-3) and everything below either MOVED here from a client test or
 * is new coverage the migration itself created:
 *
 *   MOVED from `src/lib/life/prompts/sagaOpen.test.ts` — LIFE-ARCH-8's teaser
 *   contract, TTS-VOICE-2's cast fields, LIFE-STORY-EXEMPLAR-2's texture wiring.
 *   MOVED from `src/lib/life/prompts/bannedLexicon.test.ts` — the row asserting
 *   the naming rule reaches this surface. The inverted `life_step` row STAYS
 *   there, because that surface is still client-side (batch 8).
 *   MOVED from `src/lib/life/prompts/exemplarBleed.test.ts` — the `sagaOpen`
 *   row of LIFE-STORY-EXEMPLAR-1's table, and its "asks for the ROLE a place
 *   fills" companion. Every other surface in that table is still client-side.
 *   NEW — the schema fork (SRV-PROMPT-1), and SRV-PROMPT-9's size gate.
 */
import { describe, expect, it } from "vitest";
import {
  buildSagaOpenPrompt,
  CHAPTER_ONE_MIN_CLOCK,
  sagaOpenResponseSchema,
  sagaOpenSystemInstruction,
  type SagaOpenPromptInput,
} from "../prompts/lifeSagaOpen";

const si = (
  over: Partial<Parameters<typeof sagaOpenSystemInstruction>[0]> = {},
): string =>
  sagaOpenSystemInstruction({
    practiceLanguage: "French",
    systemLanguage: "English (British)",
    succession: false,
    realistic: false,
    ...over,
  });

const base: SagaOpenPromptInput = {
  worldId: "w-1",
  characterName: "Alice",
  practiceLanguage: "French",
  nativeLanguage: "English",
  worldSeedKey: "heist",
};

// ---------------------------------------------------------------------------
// MOVED — LIFE-ARCH-8
// ---------------------------------------------------------------------------

/**
 * LIFE-ARCH-8 — the display record is GENERATED, not merely declared.
 *
 * `ZWorldSaga.playerFacingTeaser` is `z.string().default('')`, and three
 * player-facing screens read it. The prompt had never once contained the word
 * "teaser": the LIFE-ARCH migration carried the consumers across and left the
 * producer behind, and the schema default made that silent — every world created
 * since showed "Your story is being written…" for ever.
 *
 * So the contract is asserted at both ends it can drift between: the prose the
 * model reads, and the `responseSchema` the decoder is constrained by.
 */
describe("LIFE-ARCH-8 — playerFacingTeaser reaches the model", () => {
  it("the OUTPUT block names the field", () => {
    expect(si()).toContain('"playerFacingTeaser"');
  });

  it("the field is REQUIRED in the responseSchema, on both arms", () => {
    for (const succession of [false, true]) {
      const schema = sagaOpenResponseSchema(succession) as {
        properties: Record<string, unknown>;
        required: string[];
      };
      expect(schema.properties.playerFacingTeaser, `properties (succession=${succession})`)
        .toBeTruthy();
      expect(schema.required, `required (succession=${succession})`)
        .toContain("playerFacingTeaser");
    }
  });

  it("the brief states the register — plain facts with a loose end, not a logline", () => {
    const out = si().toLowerCase();
    expect(out).toContain("not a logline");
    expect(out).toContain("loose end");
    expect(out).toContain("stakes clause");
  });

  it('LIFE-STORY-STAGE-5 — the brief does NOT ask for "an unanswered question"', () => {
    // That phrasing IS the bug, measured: 4 of 4 teasers complied literally and
    // closed on a rhetorical interrogative naming the plot.
    expect(si().toLowerCase()).not.toContain("unanswered question");
  });

  it("the teaser is written in the SYSTEM language — it is chrome, not practice text", () => {
    const line = si()
      .split("\n")
      .find((l) => l.includes('"playerFacingTeaser"')) ?? "";
    expect(line).toContain("English (British)");
    expect(line).not.toContain("French");
  });

  it("LIFE-STORY-STAGE-5 — the teaser may not be phrased as a question", () => {
    expect(si().toLowerCase()).toContain("no question marks");
  });
});

// ---------------------------------------------------------------------------
// MOVED — TTS-VOICE-2
// ---------------------------------------------------------------------------

/**
 * TTS-VOICE-2 — the cast is asked for a gender, in the CONTRACT and not only
 * the schema. LIFE-ARCH-8, LIFE-INTENT-2's `leaning` and LIFE-EX-VOCAB-4's
 * `lineVocab` all shipped as fields declared in the schema, described in prose,
 * and ABSENT from the JSON skeleton the model writes to — optional + absent =
 * silently never emitted.
 */
describe("TTS-VOICE-2 — sagaOpen authors gender + voiceRegister", () => {
  const out = () => si({ realistic: true });

  it("names both fields in the OUTPUT CONTRACT, on BOTH cast tiers", () => {
    const text = out();
    const principals = text.slice(text.indexOf('"principals"'), text.indexOf('"regulars"'));
    const regulars = text.slice(text.indexOf('"regulars"'), text.indexOf('"front"'));
    for (const [label, block] of [["principals", principals], ["regulars", regulars]] as const) {
      expect(block, label).toContain('"gender"');
      expect(block, label).toContain('"voiceRegister"');
    }
  });

  it("tells the model these drive a REAL voice, not decoration", () => {
    expect(out()).toMatch(/the app reads lines aloud/);
    expect(out()).toMatch(/it picks a real speaking voice/);
  });

  it('offers "other" as a genuine answer, not an escape hatch', () => {
    expect(out()).toMatch(/it is not a way to avoid deciding/);
  });

  it("warns against a cast whose registers are all the same", () => {
    expect(out()).toMatch(/sounds like one person doing accents/);
  });

  it("the guidance line is plain text — no nested-backtick interpolation", () => {
    expect(out()).toContain('gravelly and worn is "rough"');
    expect(out()).not.toContain("undefined");
  });
});

// ---------------------------------------------------------------------------
// MOVED — LIFE-STORY-EXEMPLAR-2
// ---------------------------------------------------------------------------

/**
 * LIFE-STORY-EXEMPLAR-2 — the texture reaches the call that chooses the cast.
 *
 * `lifeWorldTexture.test.ts` proves the pool spreads. This proves it is WIRED
 * into the ONE call it has to reach, and that succession is exempt — the two
 * ways this mechanism could be shipped and do nothing.
 */
describe("LIFE-STORY-EXEMPLAR-2 — <texture> reaches sagaOpen", () => {
  it("a NEW world carries a texture block", () => {
    expect(buildSagaOpenPrompt({ ...base })).toContain("<texture>");
  });

  it("two different worlds get DIFFERENT textures — the whole point", () => {
    const blocks = new Set(
      Array.from({ length: 30 }, (_, i) => {
        const p = buildSagaOpenPrompt({ ...base, worldId: `w-${i}` });
        return p.slice(p.indexOf("<texture>"), p.indexOf("</texture>"));
      }),
    );
    expect(blocks.size).toBeGreaterThan(10);
  });

  it("the SAME world gets the same texture on every build", () => {
    expect(buildSagaOpenPrompt({ ...base, worldId: "w-7" })).toBe(
      buildSagaOpenPrompt({ ...base, worldId: "w-7" }),
    );
  });

  it("SUCCESSION carries none — the people already have names", () => {
    const p = buildSagaOpenPrompt({
      ...base,
      universe: { setting: "A canal town", era: "now", laws: [], places: [] },
    });
    expect(p).not.toContain("<texture>");
  });
});

// ---------------------------------------------------------------------------
// MOVED — LIFE-STORY-LEXICON-1/2
// ---------------------------------------------------------------------------

/**
 * MOVED from `src/lib/life/prompts/bannedLexicon.test.ts`, which asserted this
 * rule reaches the two naming surfaces. `life_world_arc` crossed in batch 3 and
 * its row moved to `lifeWorldArc.test.ts`; this one crossed in batch 5. The
 * INVERTED `life_step` row stays client-side, because that surface has not moved
 * and LIFE-SI-LEAN-7's measured decision to drop the rule there is still the
 * thing worth pinning.
 *
 * Strengthened in the move, as the arc's was: the VOCABULARY and the idiom list
 * are asserted, not just the heading. A port that dropped the word list would
 * still have carried the heading.
 */
describe("LIFE-STORY-LEXICON-1 — the rule reaches the world-naming surface", () => {
  it("LIFE-STORY-LEXICON-1 — the world-opening prompt carries the naming rule", () => {
    expect(si()).toContain("NAMING + WORD CHOICE");
  });

  it("LIFE-STORY-LEXICON-1 — and the vocabulary itself, not just the heading", () => {
    for (const w of ["echo", "shadow", "silence", "unspoken", "last breath"]) {
      expect(si(), `missing "${w}"`).toContain(w);
    }
  });

  it("LIFE-STORY-LEXICON-2 — and the stock-idiom ban", () => {
    expect(si()).toContain("WHAT CHARACTERS SAY");
    expect(si()).toContain("The walls have ears.");
  });

  it("LIFE-STORY-LEXICON-1 — on the SUCCESSION arm too", () => {
    // The succession arm drops the seed table and the universe block; the naming
    // rule is not part of either, and a succession still mints a title and a
    // front name. Asserted because the two arms are built by one function with
    // two large omissions, and "which half did that line sit in" is exactly the
    // question a port gets wrong.
    expect(si({ succession: true })).toContain("NAMING + WORD CHOICE");
  });
});

// ---------------------------------------------------------------------------
// MOVED — LIFE-STORY-EXEMPLAR-1
// ---------------------------------------------------------------------------

/**
 * MOVED from `src/lib/life/prompts/exemplarBleed.test.ts` — the `sagaOpen` row
 * of that table, plus its companion assertion. `sagaOpen` is the FIRST call in
 * the chain and its `places` feed everything downstream, so a noun demonstrated
 * here becomes the world: measured, the bakery appeared in 9 of 10 `country_life`
 * worlds. The other rows in that table (`bio`, `vocabRules`, `lifeStep`) are
 * still client-side and stay there.
 */
describe("LIFE-STORY-EXEMPLAR-1 — the world-open SI demonstrates no bakery", () => {
  it("names no specific ordinary place, on BOTH arms", () => {
    for (const succession of [false, true]) {
      const text = si({ succession });
      const found = ["bakery", "baker", "boulanger", "boulangerie"].filter((w) =>
        new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "iu").test(text),
      );
      expect(found, `sagaOpen (succession=${succession}) still teaches: ${found.join(", ")}`)
        .toEqual([]);
    }
  });

  it("asks for the ROLE a place fills, not an instance of one", () => {
    // The replacement has to keep the original's actual point — that a world
    // needs somewhere ordinary, not only a palace and a vault — or this trades a
    // recycled bakery for worlds with nowhere to have breakfast.
    expect(si()).toMatch(/somewhere they eat/i);
    expect(si()).toMatch(/nowhere to have breakfast/i);
  });
});

// ---------------------------------------------------------------------------
// NEW — the schema fork (SRV-PROMPT-1) and the two SI arms
// ---------------------------------------------------------------------------

/**
 * SRV-PROMPT-1 — prompt and schema are ONE artefact, and this prompt is the case
 * that invariant was written about: the schema is DERIVED, so owning the prompt
 * while trusting a client-sent schema would leave the half that constrains the
 * ANSWER in the bundle.
 *
 * The fork is a single bit — is there a universe already? — and the two halves
 * must move together. `universe` in the SCHEMA is what the model is allowed to
 * write; `<universe FIXED="true">` in the PROMPT is what it is told not to
 * reinvent. A build where one said yes and the other no would either ask for a
 * universe it already has or forbid the one it needs.
 */
describe("SRV-PROMPT-1 — the response schema forks with the prompt", () => {
  it("a NEW world's schema asks for the universe; a SUCCESSION's does not", () => {
    const fresh = sagaOpenResponseSchema(false) as { properties: Record<string, unknown> };
    const succ = sagaOpenResponseSchema(true) as { properties: Record<string, unknown> };
    expect(fresh.properties.universe).toBeTruthy();
    expect(succ.properties).not.toHaveProperty("universe");
  });

  it("everything else is identical between the two arms", () => {
    // The fork is ONE property. A port that rebuilt the succession arm by hand
    // could lose a required field on one side only, and nothing else here would
    // notice.
    const fresh = sagaOpenResponseSchema(false) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    const succ = sagaOpenResponseSchema(true) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    const { universe, ...freshRest } = fresh.properties;
    expect(universe).toBeTruthy();
    expect(succ.properties).toEqual(freshRest);
    expect(succ.required).toEqual(fresh.required);
  });

  it("LIFE-WORLD-SAGA-10 — the load-bearing fields are REQUIRED on both arms", () => {
    // Measured: under a responseSchema a model drops a non-required field far
    // more readily than in free JSON, so anything the app reads unconditionally
    // has to be required or it eventually is not sent.
    for (const succession of [false, true]) {
      const s = sagaOpenResponseSchema(succession) as { required: string[] };
      for (const f of [
        "title",
        "titleNative",
        "playerFacingTeaser",
        "tone",
        "situation",
        "principals",
        "regulars",
        "front",
        "goal",
        "firstObjective",
      ]) {
        expect(s.required, `${f} (succession=${succession})`).toContain(f);
      }
      // …and `firstObjectiveNeed` is deliberately NOT required (LIFE-NEED-6).
      expect(s.required).not.toContain("firstObjectiveNeed");
    }
  });

  it("LIFE-CAST-1 — a regular has no `wants` property to be handed an ambition in", () => {
    const s = sagaOpenResponseSchema(false) as {
      properties: {
        regulars: { items: { properties: Record<string, unknown>; required: string[] } };
        principals: { items: { properties: Record<string, unknown>; required: string[] } };
      };
    };
    expect(s.properties.regulars.items.properties).not.toHaveProperty("wants");
    expect(s.properties.regulars.items.properties).not.toHaveProperty("nextMove");
    expect(s.properties.principals.items.required).toContain("wants");
    expect(s.properties.principals.items.required).toContain("nextMove");
    expect(s.properties.principals.items.required).toContain("wrongAbout");
  });
});

describe("LIFE-ARCH-6 — the two SI arms say opposite things about the universe", () => {
  it("a NEW world is told to author it; a SUCCESSION is told not to", () => {
    expect(si({ succession: false })).toContain("THIS IS A NEW WORLD.");
    expect(si({ succession: true })).toContain("THIS IS A SUCCESSION.");
    expect(si({ succession: true })).toContain("do not re-invent it");
  });

  it("the SEED TABLE is on the new-world arm only", () => {
    // A succession's genre was decided by the act that came before, and
    // re-running the seed register would let it drift mid-life.
    expect(si({ succession: false })).toContain("THE SEED DECIDES THE GENRE");
    expect(si({ succession: true })).not.toContain("THE SEED DECIDES THE GENRE");
  });

  it("LIFE-FRONT-6 — `realistic` picks the consequence ceiling", () => {
    expect(si({ realistic: true })).toContain("REGISTER — REALISTIC.");
    expect(si({ realistic: false })).toContain("REGISTER — FANTASY.");
    expect(si({ realistic: true })).not.toContain("REGISTER — FANTASY.");
  });
});

describe("LIFE-FRONT-7 — the opening front is slow and non-threatening", () => {
  it("the SI states the ENGINE's minimum clock, not a hand-written number", () => {
    // `conformsToOpeningRule` checks the answer against `CHAPTER_ONE_MIN_CLOCK`
    // client-side. If the prose and the check disagreed, every world would open
    // with a logged breach nobody caused.
    expect(si()).toContain(`its clock size must be at least ${CHAPTER_ONE_MIN_CLOCK}`);
    expect(si()).toContain(`"size": ${CHAPTER_ONE_MIN_CLOCK}`);
  });

  it('it may NOT be kind "threat"', () => {
    expect(si()).toContain('it may NOT be kind "threat"');
  });
});

// ---------------------------------------------------------------------------
// NEW — the user prompt's blocks
// ---------------------------------------------------------------------------

describe("buildSagaOpenPrompt — the blocks and their independence", () => {
  it("renders the character and world tags, escaping attributes", () => {
    const p = buildSagaOpenPrompt({
      ...base,
      characterName: 'Bébert "the clerk" & <son>',
      worldSeedKey: "manual",
      worldMode: "fantasy",
      worldSeedText: 'a < b & "c"',
    });
    expect(p).toContain('name="Bébert &quot;the clerk&quot; &amp; &lt;son&gt;"');
    expect(p).toContain('<world seed="manual" mode="fantasy" description="a &lt; b &amp; &quot;c&quot;"/>');
  });

  it("omits the mode and description attributes when absent", () => {
    expect(buildSagaOpenPrompt({ ...base })).toContain('<world seed="heist"/>');
  });

  it("LIFE-ARCH-6 — the universe block carries setting, era, laws and places only", () => {
    const p = buildSagaOpenPrompt({
      ...base,
      universe: {
        setting: "A canal town",
        era: "now",
        laws: ["No barge moves without a slip."],
        places: ["The wash-house"],
      },
    });
    expect(p).toContain('<universe FIXED="true">');
    expect(p).toContain("<setting>A canal town</setting>");
    expect(p).toContain("<law>No barge moves without a slip.</law>");
    expect(p).toContain("<place>The wash-house</place>");
    // `figures` is on the world's `Universe` and this prompt has never rendered
    // it, so it is not on the spec at all.
    expect(p).not.toContain("<figure");
  });

  it("the three optional blocks are INDEPENDENT of each other", () => {
    // A port that folded `survivingCast` / `priorSagaHistory` under the
    // succession fork would pass every succession fixture and silently drop both
    // on the arm where they are legal but unusual.
    const cast = buildSagaOpenPrompt({
      ...base,
      survivingCast: [{ id: "p1", name: "Bébert", tier: "principal", known: "Runs the office." }],
    });
    expect(cast).toContain("<survivingCast>");
    expect(cast).toContain("<texture>");
    const hist = buildSagaOpenPrompt({ ...base, priorSagaHistory: ["Something happened."] });
    expect(hist).toContain("<whatHasHappened>");
    expect(hist).toContain("<texture>");
  });

  it("an EMPTY array renders no block at all", () => {
    const p = buildSagaOpenPrompt({ ...base, survivingCast: [], priorSagaHistory: [] });
    expect(p).not.toContain("<survivingCast>");
    expect(p).not.toContain("<whatHasHappened>");
    expect(p).toBe(buildSagaOpenPrompt({ ...base }));
  });

  it("the history renders the LAST ten lines", () => {
    const p = buildSagaOpenPrompt({
      ...base,
      priorSagaHistory: Array.from({ length: 14 }, (_, i) => `Line ${i}.`),
    });
    expect((p.match(/<line>/g) ?? []).length).toBe(10);
    expect(p).toContain("<line>Line 13.</line>");
    expect(p).not.toContain("<line>Line 3.</line>");
  });

  it("the closing instruction differs between the arms", () => {
    expect(buildSagaOpenPrompt({ ...base })).toContain("Open the world.");
    expect(
      buildSagaOpenPrompt({
        ...base,
        universe: { setting: "s", era: "e", laws: [], places: [] },
      }),
    ).toContain("Open the next act.");
  });
});

// ---------------------------------------------------------------------------
// NEW — SRV-PROMPT-9
// ---------------------------------------------------------------------------

/**
 * SRV-PROMPT-9 — assembled size against the byte cap.
 *
 * ⚠ THE FIXTURES ARE SYNTHETIC. `SRV-PROMPT-9` records that the archived worlds
 * its evidence would otherwise come from live in `.playthroughs/`, which is
 * gitignored and absent from a fresh checkout. These are built to the maxima the
 * CODE enforces, with prose at the top of what the prompt itself asks for.
 *
 * ── WHAT IS BOUNDED, AND BY WHAT ────────────────────────────────────────────
 *
 * IN CODE:      `priorSagaHistory` — `.slice(-10)` in the builder, so a
 *               forty-line history costs exactly what a ten-line one does.
 *               `worldSeedKey` / `worldMode` — closed enums.
 * IN THE UI ONLY: `characterName` (`maxLength={32}`) and `worldSeedText`
 *               (`maxLength={500}`) are capped by the onboarding form and by
 *               nothing in `src/lib/`. That is why the NEW-WORLD ceiling below
 *               is a ceiling in practice and a slope in principle.
 * NOT AT ALL:   every succession input. `universe.setting` / `era` / each `law`
 *               and `place`, and every surviving cast member's `known`, are
 *               model-authored prose with no bound anywhere; the cast COUNT is
 *               unbounded too (regulars accumulate for the life of a world —
 *               LIFE-CAST-3's own note says "thirty named people by chapter
 *               five"). The crossing point is recorded below rather than
 *               asserted away.
 *
 * ⚠ SUCCESSION IS NOT REACHABLE FROM THE APP TODAY. `runSagaOpen` has exactly
 * one production call site (`LifeStartScreen`) and it passes `{ world }` alone —
 * no universe, no surviving cast, no history. So the only payload that ships is
 * the NEW-WORLD one at ~32% of cap, and every succession figure here is a
 * measurement of a contract (LIFE-ARCH-6 / LIFE-FRONT-5) rather than of traffic.
 */
describe("SRV-PROMPT-9 — assembled size against the byte cap", () => {
  const CAP = 65_536;
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");
  const rep = (n: number) =>
    "You went back to the lock at first light and found the roster book already open on the clerk’s desk, and the week you needed promised to a name you did not recognise. "
      .repeat(40)
      .slice(0, n);

  /** The onboarding form's own caps (`LifeStartScreen.tsx`). */
  const NAME_MAX = 32;
  const SEED_TEXT_MAX = 500;
  /** LIFE-CAST-3's figure for a long-played world. */
  const CAST_AT_CHAPTER_FIVE = 33;

  const cast = (n: number, known: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `person-${i}`,
      name: `Marguerite-Anne Lavalle-Beaumont ${i}`,
      tier: (i < 3 ? "principal" : "regular") as "principal" | "regular",
      known: rep(known),
    }));

  const universe = (prose: number) => ({
    setting: rep(prose),
    era: rep(Math.min(prose, 80)),
    // The prompt asks for 3-6 of each; the top of its own range.
    laws: Array.from({ length: 6 }, () => rep(185)),
    places: Array.from({ length: 6 }, () => rep(100)),
  });

  /** The biggest a NEW world can be: both UI caps maxed, and nothing else on
   *  this arm is caller-supplied at all. */
  const newWorldMax: SagaOpenPromptInput = {
    worldId: "w-abc123",
    characterName: "M".repeat(NAME_MAX),
    practiceLanguage: "French",
    nativeLanguage: "English",
    worldSeedKey: "manual",
    worldMode: "realistic",
    worldSeedText: rep(SEED_TEXT_MAX),
  };

  /** A realistic succession: chapter-five cast, prose at the length the prompt
   *  asks for, the history slice full. */
  const successionMax: SagaOpenPromptInput = {
    ...newWorldMax,
    universe: universe(220),
    survivingCast: cast(CAST_AT_CHAPTER_FIVE, 240),
    priorSagaHistory: Array.from({ length: 10 }, () => rep(300)),
  };

  /** Deliberately harsher, in the LIFE-WORLD-ARC-7 shape: every prose field at
   *  400 characters AND twice the chapter-five cast. */
  const harsher: SagaOpenPromptInput = {
    ...newWorldMax,
    universe: universe(400),
    survivingCast: cast(60, 400),
    priorSagaHistory: Array.from({ length: 10 }, () => rep(600)),
  };

  const sum = (i: SagaOpenPromptInput) =>
    bytes(sagaOpenSystemInstruction({
      practiceLanguage: "French",
      systemLanguage: "English (British)",
      succession: i.universe !== undefined,
      realistic: i.worldMode === "realistic",
    })) + bytes(buildSagaOpenPrompt(i));

  it("SRV-PROMPT-9 — the NEW-WORLD ceiling, the only payload that ships today", () => {
    // Measured 21,165 B = 32.3% of cap: a 19,798 B SI and a 1,367 B prompt.
    // Nothing on this arm accumulates — there is no cast, no history and no
    // universe — so this is a ceiling, not a sample.
    expect(sum(newWorldMax)).toBeLessThan(CAP * 0.4);
  });

  it("SRV-PROMPT-9 — a realistic SUCCESSION stays under half the cap", () => {
    // Measured 30,565 B = 46.6%. The succession SI is the SHORTER of the two
    // (13,152 B — it drops the seed table and the universe block), which is what
    // buys the room the bigger prompt needs.
    expect(sum(successionMax)).toBeLessThan(CAP * 0.5);
  });

  it("SRV-PROMPT-9 — the deliberately HARSHER succession is still under the cap", () => {
    // Measured 52,552 B = 80.2%, and recorded rather than smoothed over: it is
    // the one figure in this batch above the 75% bar, and it takes TWO
    // simultaneous exaggerations to reach — twice LIFE-CAST-3's chapter-five
    // cast AND every one-clause prose field at 400 characters. Either one alone
    // lands at 59.7% / 60.4%, and thirty members at 57.4%.
    expect(sum(harsher)).toBeLessThan(CAP);
    expect(sum(harsher)).toBeGreaterThan(CAP * 0.75);
  });

  it("SRV-PROMPT-9 — the history slice makes a long saga cost O(1)", () => {
    // Forty history lines must cost exactly what ten do. If the slice is ever
    // removed this is the assertion that fails, rather than the byte total
    // drifting up unremarked.
    const forty: SagaOpenPromptInput = {
      ...harsher,
      priorSagaHistory: Array.from({ length: 40 }, () => rep(600)),
    };
    expect(bytes(buildSagaOpenPrompt(forty))).toBe(bytes(buildSagaOpenPrompt(harsher)));
  });

  it("SRV-PROMPT-9 — the SURVIVING CAST is the term with no bound, and it is a slope", () => {
    // Recorded rather than asserted away: this is the number to re-read if a
    // `too-large` ever appears on `life_saga`. At 400-character prose the
    // assembled pair crosses `MAX_PROMPT_BYTES` at 87 members; at the prose
    // length the prompt actually asks for, ~139. Both are a long way past
    // LIFE-CAST-3's thirty, which is why this migrated rather than stopping.
    const at = (n: number) => sum({ ...harsher, survivingCast: cast(n, 400) });
    expect(at(30)).toBeLessThan(CAP * 0.6);
    expect(at(87)).toBeGreaterThan(CAP);
    expect(at(86)).toBeLessThan(CAP);
  });
});
