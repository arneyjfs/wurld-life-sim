import { describe, expect, it } from "vitest";
import {
  buildWorldArcUserPrompt,
  worldArcSystemInstruction,
  type WorldArcPromptInput,
} from "../prompts/lifeWorldArc";

/**
 * SRV-PROMPT-8..13 batch 3 (second half) — the chapter-arc prompt, now built by
 * the server.
 *
 * THESE ASSERTIONS MOVED (SRV-PROMPT-3 / PRACTICE-OWN-8). They lived at
 * `src/lib/life/prompts/worldArc.test.ts`, against the client module this change
 * deletes. Landing them here rather than dropping them is the rule SRV-PROMPT-3
 * states in terms: the server copy had no coverage of its own, so deleting them
 * would retire this prompt's only tests at the moment it became the only copy.
 *
 * Two more assertions arrived from ELSEWHERE, for the same reason — they were
 * pointed at the client SI and would have died silently with it:
 *   - the `LIFE-STORY-LEXICON-1` "reaches both naming surfaces" row, from
 *     `src/lib/life/prompts/bannedLexicon.test.ts`;
 *   - the `LIFE-STORY-EXEMPLAR-1` "names no bakery" row, from
 *     `src/lib/life/prompts/exemplarBleed.test.ts`.
 * Both of those files keep every row whose surface is still client-side.
 *
 * WHAT IS NEW, and why it is not padding: the SIZE GATE at the bottom
 * (SRV-PROMPT-9). This is the prompt that FAILED that gate on first measurement
 * and sent batch 3 back — see `LIFE-WORLD-ARC-7`.
 */

const SI = () =>
  worldArcSystemInstruction({ practiceLanguage: "French", nativeLanguage: "English" });

const base: WorldArcPromptInput = {
  characterName: "Marc",
  practiceLanguage: "French",
  nativeLanguage: "English",
  worldSeedKey: "city_life",
  fronts: [],
  cast: [],
  chapterNumber: 1,
  previousArcs: [],
};

const arc = (chapterNumber: number, premise: string): WorldArcPromptInput["previousArcs"][number] => ({
  chapterNumber,
  premise,
  themes: ["ambition"],
  outcomeLine: `Outcome ${chapterNumber}.`,
  completedSceneMemories: [],
});

// ---------------------------------------------------------------------------

describe("worldArcSystemInstruction — LIFE-WORLD-ARC-REGISTER + CYOA openness", () => {
  it("LIFE-WORLD-ARC-REGISTER — demands TWO registers: a planner premise and a spoiler-safe playerTeaser", () => {
    const out = SI();
    expect(out).toContain("TWO REGISTERS");
    expect(out).toMatch(/"premise":[^\n]*PLANNER/);
    expect(out).toMatch(/"playerTeaser":[^\n]*PLAYER/);
    expect(out).toMatch(/SPOILER-SAFE/i);
    expect(out).toMatch(/NO midpoint twist/i);
  });

  it("LIFE-STORY-SHAPE-1 — frames the premise as a LOOSE PULL, not a rail", () => {
    const out = SI();
    expect(out).toMatch(/LOOSE PULL/i);
    expect(out).toMatch(/not a rail/i);
    expect(out).toMatch(/survives the player going off-script/i);
  });

  it("SRV-PROMPT-8..13 — the SI carries BOTH languages, so it is not a constant", () => {
    // This is the fact that rules out a `cacheSlot` (asserted in
    // serverPromptSpec.test.ts) — recorded here against the SI itself.
    const a = worldArcSystemInstruction({ practiceLanguage: "French", nativeLanguage: "English" });
    const b = worldArcSystemInstruction({ practiceLanguage: "Japanese", nativeLanguage: "German" });
    expect(a).toContain("Practice language: French. Native language: English.");
    expect(b).toContain("Practice language: Japanese. Native language: German.");
    expect(a).not.toBe(b);
  });
});

describe("LIFE-STORY-STAGE-3 — chapter 1 establishes; it does not advance the saga", () => {
  it("carves chapter 1 out of the \"MUST advance the saga\" rule, ABOVE that rule", () => {
    const out = SI();
    expect(out).toContain("CHAPTER 1 IS AN ESTABLISHING CHAPTER");
    expect(out.indexOf("CHAPTER 1 IS AN ESTABLISHING CHAPTER")).toBeLessThan(
      out.indexOf("READS THE WORLD AS IT STANDS"),
    );
  });

  it("bars the opposing force and the revelation from chapter 1, by name", () => {
    const out = SI();
    expect(out).toMatch(/Nothing in <inMotion> appears in chapter 1 as a plot the player is IN/i);
    expect(out).toMatch(/No twist, no secret revealed/i);
    expect(out).toMatch(/CHAPTER 2 is where the pressures in <inMotion> start to touch the player/i);
    expect(out).toMatch(/Do NOT invent a twist, a climax or an ending/i);
  });

  it("asks chapter 1 for an ORDINARY, personal dramatic question", () => {
    expect(SI()).toMatch(/dramatic question is PERSONAL and ORDINARY/i);
  });
});

describe("LIFE-STORY-STAGE-6 — chapter 1 keeps the story, drops the stakes", () => {
  it("still forbids the PLOT — the STAGE-3 restraint survives", () => {
    expect(SI()).toMatch(/Nothing in <inMotion> appears in chapter 1 as a plot the player is IN/);
    expect(SI()).toMatch(/No twist, no secret revealed/);
  });

  it("requires the saga PRINCIPALS in chapter 1, and names the field", () => {
    expect(SI()).toMatch(/recurringNpcIds/);
    expect(SI()).toMatch(/PRINCIPALS appear in chapter 1/);
  });

  it("requires the chapter to be built from the player's own hooks", () => {
    expect(SI()).toMatch(/hooks are what the chapter's ordinary question is about/i);
  });

  it("draws the line at the CLOCK, so \"restraint\" is checkable, not a mood", () => {
    expect(SI()).toMatch(/CLOCK does not move in chapter 1/);
    expect(SI()).toMatch(/nobody proposes the job/);
  });

  it("names the failure it is correcting, in the words it fails in", () => {
    expect(SI()).toMatch(/could be swapped into any other world/);
  });
});

/**
 * MOVED from `src/lib/life/prompts/bannedLexicon.test.ts` — the row that
 * asserted the lexicon rule reaches the chapter-arc SI. `sagaOpen`'s row and
 * the inverted `life_step` row stay there, because both surfaces are still
 * client-side; only this one crossed the wire.
 */
describe("LIFE-STORY-LEXICON-1 — the rule reaches the chapter-naming surface", () => {
  it("LIFE-STORY-LEXICON-1 — the chapter-arc prompt carries the naming rule", () => {
    expect(SI()).toContain("NAMING + WORD CHOICE");
  });

  it("LIFE-STORY-LEXICON-1 — and the vocabulary itself, not just the heading", () => {
    // The heading alone would pass if the word list were dropped in the port.
    for (const w of ["echo", "shadow", "silence", "unspoken", "last breath"]) {
      expect(SI(), `missing "${w}"`).toContain(w);
    }
  });

  it("LIFE-STORY-LEXICON-2 — and the stock-idiom ban", () => {
    expect(SI()).toContain("WHAT CHARACTERS SAY");
    expect(SI()).toContain("The walls have ears.");
  });
});

/**
 * MOVED from `src/lib/life/prompts/exemplarBleed.test.ts` (LIFE-STORY-EXEMPLAR-1).
 * Every other surface in that table is still client-side and stays there.
 */
describe("LIFE-STORY-EXEMPLAR-1 — the chapter-arc SI demonstrates no bakery", () => {
  it("names no specific ordinary place", () => {
    const found = ["bakery", "baker", "boulanger", "boulangerie"].filter((w) =>
      new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "iu").test(SI()),
    );
    expect(found, `worldArc still teaches: ${found.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

/**
 * SRV-PROMPT-18 — every XML block the SI NAMES is one the builder EMITS.
 *
 * THE BUG THIS EXISTS FOR. The SI said *"When a `<life>` block is present it is
 * the player's OWN biography … You may not contradict it"*, and named `<life>`
 * again in the chapter-1 rule. `renderBioForPrompt` has emitted `<bio>` since
 * it was written, so the antecedent was ALWAYS FALSE and every prohibition
 * hanging off it — do not give them a different job, do not move them, do not
 * replace the people — attached to a condition nothing could satisfy. Inherited
 * from the deleted client builder, so batch 3's byte-identical migration
 * carried it across faithfully rather than introducing it.
 *
 * ⚠ IT WAS INVISIBLE TO EVERY TEST THAT EXISTED, which is the point of this
 * one. The SI tests assert phrases, the prompt tests assert blocks, and a byte
 * golden would have PINNED the mistake rather than caught it. Nothing compared
 * the two halves, so a tag could be renamed on one side forever.
 *
 * ⚠ AND IT FOUND A SECOND ONE ON ITS FIRST RUN: the SI told the model to "pull
 * from the `<recurringNpcs>` list" in three places, and no builder anywhere
 * emits `<recurringNpcs>` — the NPCs are in `<cast>`. Also `<voice>`, in the
 * SHARED `lifeLexiconRules`, where `voice` is an ATTRIBUTE on `<person>` and
 * never an element. Three dangling references in one system instruction, none
 * of which any existing test could see.
 *
 * ⚠ NOT A BEHAVIOUR BUG, measured rather than assumed: 48 trials per arm
 * against real Gemini on a realistic chapter-3 payload found the bio's job
 * honoured 48/48 under BOTH tags and no contradiction in either (0/48). The
 * block is in the user prompt, so the model reads it whether or not the SI
 * names it. Worth fixing as correctness; not a fix for LIFE-ONBOARD-17.
 */
describe("SRV-PROMPT-18 — the SI names only blocks the prompt emits", () => {
  /**
   * Tags the SI may name without the builder emitting them. Kept EXPLICIT, with
   * a reason each, so adding one is a decision rather than a way to quiet the
   * test — an allowlist that grows on failure is how this guard would rot into
   * the thing it was written to catch.
   *
   * `adjective` is not a block reference at all: it is metasyntax inside a
   * BANNED TITLE SHAPE — `"The <adjective> <abstract noun>"` — describing a
   * pattern the model must not produce. Its sibling `<abstract noun>` carries a
   * space and so never reached this check, which is the tell.
   */
  const NOT_INPUT_BLOCKS = new Set<string>(["adjective"]);

  it("every tag the SI names appears in a built prompt", () => {
    const si = SI();
    // A maximal payload, so a block missing from the prompt means the BUILDER
    // never emits it — not that this fixture left it out.
    //
    // ⚠ `base` has EMPTY cast and fronts and both blocks are skipped when
    // empty, so inheriting them made `<cast>` and `<inMotion>` look dangling
    // when the builder emits both. That was this test's own first failure, and
    // it is the fixture error this guard is most likely to produce: a block
    // absent because nothing filled it reads exactly like one never written.
    const prompt = buildWorldArcUserPrompt({
      ...base,
      bio: "<bio>\n  <job>radio technician</job>\n</bio>",
      currentLocationLabel: "La halle aux grains",
      situation: "You have a room over the bakery.",
      fronts: [{ driverId: "p1", agenda: "Buying out the lease.", resolved: null }],
      cast: [
        {
          id: "p1",
          name: "Bebert",
          voice: "clipped",
          standing: 2,
          tier: "principal",
          known: "Runs the lock.",
          wants: "The roster changed.",
          nextMove: "Corner the clerk.",
          limit: "Nothing in writing.",
          ties: [],
        },
      ],
      universe: {
        setting: "A canal town",
        era: "now",
        laws: ["No barge moves without a slip."],
        places: ["The wash-house"],
        figures: [{ name: "Bebert", what: "Keeps the roster book." }],
      },
      previousArcs: [
        {
          chapterNumber: 1,
          premise: "P",
          themes: ["ambition"],
          outcomeLine: "O",
          completedSceneMemories: [{ title: "T", endingKey: "resolved_warm", summary: "S" }],
        },
      ],
    });

    const named = [...new Set([...si.matchAll(/<([a-zA-Z][\w-]*)>/g)].map((m) => m[1]!))]
      .filter((t) => !NOT_INPUT_BLOCKS.has(t))
      .sort();
    // Non-vacuous: a regex that stopped matching would report agreement about
    // nothing, which is how five guards in this programme have already failed.
    expect(named.length).toBeGreaterThanOrEqual(3);

    const emitted = new Set([...prompt.matchAll(/<\/?([a-zA-Z][\w-]*)[\s>]/g)].map((m) => m[1]!));
    const dangling = named.filter((t) => !emitted.has(t));
    expect(
      dangling,
      `the SI names ${dangling.join(", ")}, which the builder never emits — ` +
        `a rule about a block that is not there binds to nothing`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("buildWorldArcUserPrompt — LIFE-WORLD-ARC-*", () => {
  it("LIFE-WORLD-ARC-2 — renders <previousChapters> from previousArcs, one <chapter> each", () => {
    const prompt = buildWorldArcUserPrompt({
      ...base,
      chapterNumber: 3,
      previousArcs: [arc(1, "The arrival."), arc(2, "The rivalry.")],
    });
    expect(prompt).toContain("<previousChapters>");
    expect(prompt).toContain('<chapter number="1">');
    expect(prompt).toContain('<chapter number="2">');
    expect(prompt).toContain("The arrival.");
    expect(prompt).toContain("The rivalry.");
    expect(prompt).toContain("<chapterNumber>3</chapterNumber>");
  });

  it("LIFE-WORLD-ARC-* — omits <previousChapters> when previousArcs is empty (chapter 1)", () => {
    const prompt = buildWorldArcUserPrompt(base);
    expect(prompt).not.toContain("<previousChapters>");
    expect(prompt).toContain("<chapterNumber>1</chapterNumber>");
  });

  it("LIFE-WORLD-ARC-REGISTER — the PLANNER premise is what a prior chapter renders", () => {
    // The inverse of the recap's pick, and the reason both rules live with
    // their prompts: this output is read by the MODEL, so it gets the planner
    // register. `playerTeaser` is not even on this spec.
    const prompt = buildWorldArcUserPrompt({
      ...base,
      chapterNumber: 2,
      previousArcs: [arc(1, "PLANNER_PREMISE")],
    });
    expect(prompt).toContain("<premise>PLANNER_PREMISE</premise>");
  });

  it("LIFE-WORLD-ARC-* — caps a chapter's rendered memories at six", () => {
    const many = {
      ...arc(1, "p"),
      completedSceneMemories: Array.from({ length: 9 }, (_, i) => ({
        title: `t${i}`,
        endingKey: "resolved_warm",
        summary: `SUMMARY_${i}`,
      })),
    };
    const prompt = buildWorldArcUserPrompt({ ...base, chapterNumber: 2, previousArcs: [many] });
    expect(prompt.match(/<memory /g) ?? []).toHaveLength(6);
    expect(prompt).toContain("SUMMARY_0");
    expect(prompt).not.toContain("SUMMARY_6");
  });

  it("LIFE-WORLD-ARC-* — omits themes / outcomeLine / memories blocks when empty", () => {
    const bare = {
      chapterNumber: 1,
      premise: "p",
      themes: [],
      completedSceneMemories: [],
    };
    const prompt = buildWorldArcUserPrompt({ ...base, chapterNumber: 2, previousArcs: [bare] });
    expect(prompt).toContain("<premise>p</premise>");
    expect(prompt).not.toContain("<themes>");
    expect(prompt).not.toContain("<outcomeLine>");
    expect(prompt).not.toContain("<memories>");
    expect(prompt).not.toContain("undefined");
  });

  it("LIFE-ARCH-1 — renders <universe> laws / places / figures", () => {
    const prompt = buildWorldArcUserPrompt({
      ...base,
      universe: {
        setting: "A canal town",
        era: "now",
        laws: ["LAW_ONE"],
        places: ["PLACE_ONE"],
        figures: [{ name: "FIG_NAME", what: "FIG_WHAT" }],
      },
    });
    expect(prompt).toContain("<universe>");
    expect(prompt).toContain("<law>LAW_ONE</law>");
    expect(prompt).toContain("<place>PLACE_ONE</place>");
    expect(prompt).toContain('<figure name="FIG_NAME">FIG_WHAT</figure>');
  });

  it("LIFE-ARCH-1 — omits <universe> entirely when the world has none", () => {
    expect(buildWorldArcUserPrompt(base)).not.toContain("<universe");
  });

  it("LIFE-FRONT-1.1 — renders LIVE fronts as agenda + driver, and no clock", () => {
    const prompt = buildWorldArcUserPrompt({
      ...base,
      fronts: [
        { driverId: "p1", agenda: "LIVE_AGENDA" },
        { driverId: "p2", agenda: "RESOLVED_AGENDA", resolved: "filled" },
      ],
    });
    expect(prompt).toContain("<inMotion>");
    expect(prompt).toContain('<force driver="p1">LIVE_AGENDA</force>');
    // The resolved one is gone, and no clock field reaches the model.
    expect(prompt).not.toContain("RESOLVED_AGENDA");
    expect(prompt).not.toContain("clock");
    expect(prompt).not.toContain("consequence");
  });

  it("LIFE-FRONT-1.1 — a front with resolved: null is LIVE", () => {
    const prompt = buildWorldArcUserPrompt({
      ...base,
      fronts: [{ driverId: "p1", agenda: "LIVE_AGENDA", resolved: null }],
    });
    expect(prompt).toContain("LIVE_AGENDA");
  });

  it("LIFE-ARCH-3 — omits <inMotion> when nothing is live", () => {
    const prompt = buildWorldArcUserPrompt({
      ...base,
      fronts: [{ driverId: "p2", agenda: "RESOLVED_AGENDA", resolved: "cleared" }],
    });
    expect(prompt).not.toContain("<inMotion>");
    expect(prompt).not.toContain("<inMotionRule>");
  });

  it("LIFE-CAST-1 — principals render wants/nextMove, regulars render routine", () => {
    const prompt = buildWorldArcUserPrompt({
      ...base,
      cast: [
        {
          id: "p1",
          name: "Bebert",
          voice: "clipped",
          standing: 2,
          tier: "principal",
          known: "KNOWN_P",
          wants: "WANTS_P",
          nextMove: "NEXT_P",
          limit: "LIMIT_P",
          ties: [{ id: "r1", how: "TIE_HOW" }],
        },
        {
          id: "r1",
          name: "Sophie",
          voice: "warm",
          standing: 0,
          tier: "regular",
          known: "KNOWN_R",
          routine: "ROUTINE_R",
          ties: [],
        },
      ],
    });
    expect(prompt).toContain("<cast>");
    expect(prompt).toContain("<wants>WANTS_P</wants>");
    expect(prompt).toContain("<nextMove>NEXT_P</nextMove>");
    expect(prompt).toContain("<willNot>LIMIT_P</willNot>");
    expect(prompt).toContain('<tie to="r1">TIE_HOW</tie>');
    expect(prompt).toContain("<routine>ROUTINE_R</routine>");
    // A regular never carries an ambition into the prompt.
    expect(prompt).not.toContain("<wants>KNOWN_R");
  });

  it("LIFE-CAST-3 — regulars are capped at eight; principals never are", () => {
    const member = (i: number, tier: "principal" | "regular") => ({
      id: `${tier}-${i}`,
      name: `NAME_${tier}_${i}`,
      voice: "v",
      standing: 0,
      tier,
      known: "k",
      ...(tier === "principal" ? { wants: "w", nextMove: "n" } : { routine: "r" }),
      ties: [],
    });
    const prompt = buildWorldArcUserPrompt({
      ...base,
      cast: [
        ...Array.from({ length: 5 }, (_, i) => member(i, "principal")),
        ...Array.from({ length: 12 }, (_, i) => member(i, "regular")),
      ],
    });
    // All five principals survive; regulars stop at eight.
    expect(prompt).toContain("NAME_principal_4");
    expect(prompt).toContain("NAME_regular_7");
    expect(prompt).not.toContain("NAME_regular_8");
    expect(prompt.match(/<person /g) ?? []).toHaveLength(13);
  });

  it("LIFE-ARCH-3 — omits <cast> when the world has none", () => {
    expect(buildWorldArcUserPrompt(base)).not.toContain("<cast>");
  });

  it("LIFE-ONBOARD-17 — the bio is emitted verbatim when present, omitted when not", () => {
    expect(buildWorldArcUserPrompt({ ...base, bio: "<life>BIO_MARKER</life>" })).toContain(
      "<life>BIO_MARKER</life>",
    );
    expect(buildWorldArcUserPrompt(base)).not.toContain("<life>");
  });

  it("LIFE-WORLD-ARC-* — renders the seed, and the seed text only when present", () => {
    expect(buildWorldArcUserPrompt(base)).toContain('<world seed="city_life"/>');
    expect(
      buildWorldArcUserPrompt({ ...base, worldSeedKey: "manual", worldSeedText: "SEED_TEXT" }),
    ).toContain('<world seed="manual" description="SEED_TEXT"/>');
  });

  it("LIFE-BACKDROP-26 — renders currentLocation only when the world has one", () => {
    expect(buildWorldArcUserPrompt({ ...base, currentLocationLabel: "LOC" })).toContain(
      "<currentLocation>LOC</currentLocation>",
    );
    expect(buildWorldArcUserPrompt(base)).not.toContain("<currentLocation>");
  });

  it("LIFE-ARCH-3 — omits <situation> when the world has none, renders it when it does", () => {
    expect(buildWorldArcUserPrompt(base)).not.toContain("<situation>");
    expect(buildWorldArcUserPrompt({ ...base, situation: "SIT" })).toContain(
      "<situation>SIT</situation>",
    );
  });

  it("LIFE-WORLD-ARC-* — closes with the task line", () => {
    expect(buildWorldArcUserPrompt(base).trimEnd().endsWith("Design the chapter outline.")).toBe(
      true,
    );
  });

  it("SRV-PROMPT-8..13 — escapes XML-breaking characters in text and attributes", () => {
    const prompt = buildWorldArcUserPrompt({
      ...base,
      characterName: 'M&M "the kid" <Marc>',
      situation: "a < b & c",
      cast: [
        {
          id: "p1",
          name: 'Sophie" injected="yes',
          voice: "v",
          standing: 0,
          tier: "regular",
          known: "k",
          routine: "r",
          ties: [],
        },
      ],
    });
    expect(prompt).toContain("M&amp;M &quot;the kid&quot; &lt;Marc&gt;");
    expect(prompt).toContain("a &lt; b &amp; c");
    // Model-authored, so the attribute escaping moved server-side WITH the prompt.
    expect(prompt).not.toContain('injected="yes"');
  });
});

/**
 * SRV-PROMPT-9 — THE GATE. This is the prompt that FAILED it.
 *
 * Batch 3 shipped `life_resume_recap` and STOPPED here: `readCompletedArcs`
 * returned the whole subcollection and a long-played world's assembled pair
 * crossed `MAX_PROMPT_BYTES` — measured 148.8% of cap at twenty chapters, which
 * the built path answers with `too-large` and `runWorldArcGenerate` then hides
 * behind `trivialArc`. `LIFE-WORLD-ARC-7` bounded it; this asserts the bound.
 *
 * ⚠ THE MARGIN IS NOT A CEILING, and that distinction is the whole reason this
 * prompt took two attempts. `life_resume_recap` is safe because every input is
 * bounded in code. Here the COUNTS are bounded — `MAX_PRINCIPALS`,
 * `REGULARS_RENDER_CEILING`, `MAX_BIO_SCENE_MEMORIES`, the six-memory slice
 * below and `COMPLETED_ARCS_CAP` — but `known`, `wants`, `agenda`, `situation`,
 * every law and every summary is model-authored prose with no length bound
 * anywhere. So this measures a REALISTIC maximum, not a provable one, and the
 * fixture is built to the code's own count maxima with prose at the top of what
 * the prompts themselves ask for.
 *
 * ⚠ THE FIXTURE IS SYNTHETIC. `SRV-PROMPT-9` notes the archived worlds live in
 * `.playthroughs/`, which is gitignored and absent from a fresh checkout.
 */
describe("SRV-PROMPT-9 — assembled size against the byte cap", () => {
  const CAP = 65_536;
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");
  const rep = (n: number) =>
    "You went back to the lock at first light and found the roster book already open on the clerk’s desk, and the week you needed promised to a name you did not recognise. "
      .repeat(20)
      .slice(0, n);

  /** COMPLETED_ARCS_CAP — client-side (`src/lib/life/arcs.ts`), so it is
   *  restated as a literal here rather than imported across the project split.
   *  `serverPromptSpec.test.ts` asserts the resolver rejects anything larger. */
  const COMPLETED_ARCS_CAP = 5;

  const worstCase: WorldArcPromptInput = {
    characterName: "Marguerite-Anne Lavalle-Beaumont",
    practiceLanguage: "French",
    nativeLanguage: "English",
    worldSeedKey: "manual",
    worldSeedText: rep(200),
    currentLocationLabel: "La halle aux grains, sous les remparts est",
    universe: {
      setting: rep(220),
      era: "the present day, late winter",
      // sagaOpen asks for 3-6 of each; the top of its own range.
      laws: Array.from({ length: 6 }, () => rep(185)),
      places: Array.from({ length: 6 }, () => rep(100)),
      figures: Array.from({ length: 6 }, (_, i) => ({
        name: `Figure ${i} Bébert-Castellane`,
        what: rep(140),
      })),
    },
    situation: rep(400),
    // Only ONE front is ever created (`runSagaOpen`); nothing in the app makes
    // a second, so one is the code maximum rather than a modest choice.
    fronts: [{ driverId: "principal-0", agenda: rep(185) }],
    cast: [
      // MAX_PRINCIPALS = 3, and everything past REGULARS_RENDER_CEILING = 8 is
      // sliced off by the renderer — so twelve regulars cost what eight do.
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `principal-${i}`,
        name: `Principal ${i} de Montfaucon-Villeneuve`,
        voice: "slow, formal, quotes regulations he has not read",
        standing: 2,
        tier: "principal" as const,
        known: rep(240),
        wants: rep(180),
        nextMove: rep(180),
        limit: rep(130),
        ties: Array.from({ length: 3 }, (_, t) => ({ id: `principal-${t}`, how: rep(95) })),
      })),
      ...Array.from({ length: 12 }, (_, i) => ({
        id: `regular-${i}`,
        name: `Regular ${i} Duchamp-Arnaud`,
        voice: "warm, gossipy, loud, never lets you leave",
        standing: 0,
        tier: "regular" as const,
        known: rep(185),
        routine: rep(165),
        ties: Array.from({ length: 2 }, (_, t) => ({ id: `principal-${t}`, how: rep(90) })),
      })),
    ],
    // The <bio> sheet plus its MAX_BIO_SCENE_MEMORIES-capped tail.
    bio:
      `<life>${rep(1800)}</life>` +
      Array.from(
        { length: 8 },
        (_, i) =>
          `\n<completedScene title="The wash-house, scene ${i}" ending="resolved_warm">${rep(260)}</completedScene>`,
      ).join(""),
    chapterNumber: 21,
    previousArcs: Array.from({ length: COMPLETED_ARCS_CAP }, (_, i) => ({
      chapterNumber: i + 1,
      // The SI caps the premise at "2-4 sentences MAX".
      premise: rep(400),
      themes: ["ambition", "loyalty", "home", "debt"],
      outcomeLine: rep(200),
      completedSceneMemories: Array.from({ length: 9 }, (_, m) => ({
        title: `The wash-house under the second lock ${m}`,
        endingKey: "resolved_warm",
        summary: rep(300),
      })),
    })),
  };

  it("SRV-PROMPT-9 — SI + the realistic worst case stays under three quarters of the cap", () => {
    const sum = bytes(SI()) + bytes(buildWorldArcUserPrompt(worstCase));
    // Measured 48,275 B = 73.7% with COMPLETED_ARCS_CAP at 5. The bar is the
    // one the migration was held to: comfortably inside, not merely inside.
    expect(sum).toBeLessThan(CAP * 0.75);
  });

  it("SRV-PROMPT-9 — the regulars slice is what makes the cast term O(1)", () => {
    // Twelve regulars must cost exactly what eight do. If the slice is ever
    // removed this is the assertion that fails, rather than the byte total
    // drifting up unremarked.
    const eight = {
      ...worstCase,
      cast: worstCase.cast.filter((c) => c.tier === "principal" || Number(c.id.split("-")[1]) < 8),
    };
    expect(bytes(buildWorldArcUserPrompt(worstCase))).toBe(
      bytes(buildWorldArcUserPrompt(eight)),
    );
  });

  it("SRV-PROMPT-9 — the six-memory slice makes a chapter's cost O(1) too", () => {
    const six = {
      ...worstCase,
      previousArcs: worstCase.previousArcs.map((a) => ({
        ...a,
        completedSceneMemories: a.completedSceneMemories.slice(0, 6),
      })),
    };
    expect(bytes(buildWorldArcUserPrompt(worstCase))).toBe(bytes(buildWorldArcUserPrompt(six)));
  });

  it("SRV-PROMPT-9 — an UNBOUNDED arc history is what the gate caught, and it still fails", () => {
    // LIFE-WORLD-ARC-7's own evidence, kept executable: twenty chapters is what
    // `readCompletedArcs` used to hand in, and it is over the cap. If a future
    // change reintroduces an uncapped read, this is the number it lands on.
    const uncapped = {
      ...worstCase,
      previousArcs: Array.from({ length: 20 }, (_, i) => ({
        ...worstCase.previousArcs[0]!,
        chapterNumber: i + 1,
      })),
    };
    expect(bytes(SI()) + bytes(buildWorldArcUserPrompt(uncapped))).toBeGreaterThan(CAP);
  });
});
