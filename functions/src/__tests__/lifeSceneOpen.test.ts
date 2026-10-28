import { describe, expect, it } from "vitest";
import {
  buildSceneOpenPrompt,
  renderRecentSubjects,
  renderSceneFocus,
  sceneOpenSystemInstruction,
  RECENT_SUBJECTS_WINDOW,
  SCENE_OPEN_SCHEMA,
  type SceneOpenPromptInput,
} from "../prompts/lifeSceneOpen";

/**
 * SRV-PROMPT-8..13 batch 4 — `life_scene_gen`, the scene OPEN planner.
 *
 * ⚠ THE KIND IS `life_scene_gen` AND IT IS THE OPEN. `life_scene` is the CLOSE.
 * The names read inverted and they are NOT a typo — they are the wire values
 * `runSceneOpen.ts` / `runSceneClose.ts` have always sent, and renaming either
 * moves a telemetry bucket and orphans every historical usage doc
 * (SRV-PROMPT-4, and `functions/src/observability/queries.ts` says the same).
 *
 * THESE ASSERTIONS MOVED (SRV-PROMPT-3 / PRACTICE-OWN-8). They lived against
 * `src/lib/life/prompts/sceneOpen.ts` and `src/lib/life/sceneFocus.ts`, which
 * this change deletes and reduces respectively. The server copy had no coverage
 * of its own, so dropping them would retire this prompt's only tests at the
 * moment it became the only copy.
 *
 * Rows that arrived from ELSEWHERE for the same reason:
 *   - `renderSceneFocus` / `renderRecentSubjects`, from `sceneFocus.test.ts` —
 *     their last non-test consumer was this prompt, so they MOVED rather than
 *     being duplicated;
 *   - the `renderSceneStage` rows, from `prompts/storyStage.test.ts` — same
 *     reason (`renderStoryStage`, the STEP block, stays client-side until
 *     batch 8).
 */

const SI = (practiceLanguage = "French") => sceneOpenSystemInstruction({ practiceLanguage });

const base: SceneOpenPromptInput = {
  characterName: "Marc",
  practiceLanguage: "French",
  situation: "You have a room over the bakery.",
  cast: [],
  fronts: [],
  canon: [],
  history: [],
  sceneIndex: 0,
  needSign: [],
  ironyAvailable: [],
  focus: null,
  recentSubjects: [],
};

const principal = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  tier: "principal" as const,
  standing: 0,
  known: `${name} is known`,
  wants: "something",
  nextMove: "does a thing",
  ...over,
});

const regular = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  tier: "regular" as const,
  standing: -1,
  known: `${name} is known`,
  routine: "opens at five",
  ...over,
});

// ---------------------------------------------------------------------------

describe("sceneOpenSystemInstruction — LIFE-SCENE-* contract text", () => {
  it("LIFE-INTENT-2 — demands an OPEN QUESTION and forbids naming its answer", () => {
    const out = SI();
    expect(out).toContain("THE OPEN QUESTION");
    expect(out).toMatch(/Write it as a QUESTION/);
    expect(out).toMatch(/name NO answer/);
    expect(out).toMatch(/not allowed to know how it comes out/);
  });

  it("LIFE-ARCH-3 — a scene is a SITUATION, never a plot with stored endings", () => {
    const out = SI();
    expect(out).toMatch(/WHAT A SCENE IS NOT: a plot/);
    expect(out).toMatch(/do NOT list possible endings/);
    expect(out).toMatch(/do NOT write conditions for when it is over/);
  });

  it("LIFE-CANON-6 — makes reuse compulsory and prefers the longest-dormant", () => {
    const out = SI();
    expect(out).toMatch(/PICK IT UP, DON'T MAKE IT UP/);
    expect(out).toMatch(/MUST draw on at least one of them/);
    expect(out).toMatch(/prefer the ones that have been away a while/);
  });

  it("LIFE-FRONT-8 — a requested sign must be CONCRETE, and it is the page's most important rule", () => {
    const out = SI();
    expect(out).toMatch(/<makePerceivable>/);
    expect(out).toMatch(/concrete, physical SIGN/);
    expect(out).toMatch(/NOT a warning, NOT a portent/);
    expect(out).toMatch(/most important instruction on this page/);
  });

  it("LIFE-SCENE-2 — the focus is already decided and must not be re-decided", () => {
    expect(SI()).toMatch(/That choice is already made — do not re-decide it/);
  });

  it("SRV-PROMPT-8..13 — the SI carries the PRACTICE language, so it is not a constant", () => {
    // This is the fact that rules out a `cacheSlot` (asserted in
    // serverPromptSpec.test.ts): one cache per practice language is fragmentation,
    // not caching. Recorded here against the SI itself.
    const a = SI("French");
    const b = SI("Japanese");
    expect(a).toContain("everything in French");
    expect(b).toContain("everything in Japanese");
    expect(a).not.toBe(b);
  });
});

describe("SCENE_OPEN_SCHEMA — LIFE-CAST-6 / LIFE-INTENT-2", () => {
  it("requires the fields the outline cannot be built without", () => {
    expect(SCENE_OPEN_SCHEMA.required).toEqual([
      "title",
      "where",
      "who",
      "subject",
      "openQuestion",
      "atStake",
      "drawsOn",
    ]);
  });

  it("leaves signOf OPTIONAL — a scene with no requested sign has nothing to name", () => {
    expect(SCENE_OPEN_SCHEMA.required).not.toContain("signOf");
    const props = SCENE_OPEN_SCHEMA.properties as Record<string, { type?: string }>;
    expect(props.signOf?.type).toBe("STRING");
  });

  it("declares who/drawsOn as string ARRAYS — they carry ids, not prose", () => {
    const props = SCENE_OPEN_SCHEMA.properties as Record<
      string,
      { type?: string; items?: { type?: string } }
    >;
    for (const f of ["who", "drawsOn"]) {
      expect(props[f]?.type).toBe("ARRAY");
      expect(props[f]?.items?.type).toBe("STRING");
    }
  });
});

// ── the moved sceneFocus renderers (LIFE-SCENE-2) ──────────────────────────

describe("renderSceneFocus — LIFE-SCENE-2 (moved from sceneFocus.test.ts)", () => {
  it("names the cast id when the scene belongs to someone", () => {
    expect(renderSceneFocus({ castId: "pierre", name: "Pierre" })).toContain('castId="pierre"');
  });

  it("says plainly that an ordinary day belongs to NOBODY's ambition", () => {
    const s = renderSceneFocus(null);
    expect(s).toContain('kind="ordinary"');
    expect(s).toMatch(/NOBODY'S AMBITION/);
    expect(s).toMatch(/do not smuggle the story in through the back of one/);
  });

  it("escapes a quote in the name, so a cast row cannot break the attribute", () => {
    expect(renderSceneFocus({ castId: "x", name: 'A "B"' })).not.toContain('"B"');
  });
});

describe("renderRecentSubjects — LIFE-SCENE-2 (moved from sceneFocus.test.ts)", () => {
  it("renders the subjects plus the rule against repeating one", () => {
    const s = renderRecentSubjects(["the bakery lease", "the missing key"]);
    expect(s).toContain("<alreadyBeenAbout>");
    expect(s).toContain("the bakery lease");
    expect(s).toMatch(/must be about something ELSE/);
  });

  it("shows only the last RECENT_SUBJECTS_WINDOW", () => {
    const many = Array.from({ length: RECENT_SUBJECTS_WINDOW + 4 }, (_, i) => `subject ${i}`);
    const s = renderRecentSubjects(many);
    expect(s).not.toContain("subject 0");
    expect(s).toContain(`subject ${RECENT_SUBJECTS_WINDOW + 3}`);
  });

  it("is EMPTY with nothing recent, so the block is omitted rather than empty", () => {
    expect(renderRecentSubjects([])).toBe("");
  });
});

// ── the user prompt, branch by branch ──────────────────────────────────────

describe("buildSceneOpenPrompt — every conditional, both ways", () => {
  it("omits universe / history / fronts / makePerceivable / irony / canon when empty", () => {
    const p = buildSceneOpenPrompt(base);
    expect(p).not.toContain("<universe>");
    expect(p).not.toContain("<whatHasHappened>");
    expect(p).not.toContain("<fronts>");
    expect(p).not.toContain("makePerceivable");
    expect(p).not.toContain("ironyAvailable");
    expect(p).not.toContain("<canon>");
    expect(p).not.toContain("undefined");
  });

  it("renders universe SETTING, LAWS and PLACES — and nothing else about it", () => {
    const p = buildSceneOpenPrompt({
      ...base,
      universe: {
        setting: "A canal town",
        laws: ["No barge moves without a slip."],
        places: ["The wash-house"],
      },
    });
    expect(p).toContain("<setting>A canal town</setting>");
    expect(p).toContain("<law>No barge moves without a slip.</law>");
    expect(p).toContain("<place>The wash-house</place>");
  });

  it("LIFE-ARCH-2.2 — shows only the last six history lines", () => {
    const p = buildSceneOpenPrompt({
      ...base,
      history: Array.from({ length: 12 }, (_, i) => `line-${i}`),
    });
    expect(p).not.toContain("line-5");
    expect(p).toContain("line-6");
    expect(p).toContain("line-11");
  });

  it("renders a principal with wants + nextMove and a regular with a routine", () => {
    const p = buildSceneOpenPrompt({
      ...base,
      cast: [principal("p1", "Bébert"), regular("r1", "Sophie")],
    });
    expect(p).toContain('tier="principal"');
    expect(p).toContain("<wants>something</wants>");
    expect(p).toContain("<nextMove>does a thing</nextMove>");
    expect(p).toContain('tier="regular"');
    expect(p).toContain("<routine>opens at five</routine>");
    // A principal's row must not carry a routine, nor a regular's a nextMove.
    expect(p.split("\n").find((l) => l.includes('id="p1"'))).not.toContain("<routine>");
    expect(p.split("\n").find((l) => l.includes('id="r1"'))).not.toContain("<nextMove>");
  });

  it("renders a principal missing wants/nextMove as EMPTY tags, never `undefined`", () => {
    const p = buildSceneOpenPrompt({
      ...base,
      cast: [{ id: "p1", name: "Marc", tier: "principal", standing: 0, known: "known" }],
    });
    expect(p).toContain("<wants></wants>");
    expect(p).toContain("<nextMove></nextMove>");
    expect(p).not.toContain("undefined");
  });

  it("LIFE-FRONT-1.1 — a front renders agenda + driver and NO clock, ever", () => {
    const p = buildSceneOpenPrompt({
      ...base,
      fronts: [{ id: "f1", driverId: "p1", agenda: "Buying the lease." }],
    });
    expect(p).toContain('<front id="f1" driver="p1">Buying the lease.</front>');
    expect(p).not.toContain("clock");
    expect(p).not.toContain("consequence");
    expect(p).not.toContain("ifItFills");
  });

  it("LIFE-FRONT-8 — needSign renders the ids space-separated", () => {
    const p = buildSceneOpenPrompt({ ...base, needSign: ["f1", "f2"] });
    expect(p).toContain("<makePerceivable>f1 f2</makePerceivable>");
  });

  it("LIFE-CAST-2 — irony renders one row per available belief", () => {
    const p = buildSceneOpenPrompt({
      ...base,
      ironyAvailable: [{ castId: "p1", believes: "the crate is safe" }],
    });
    expect(p).toContain('<person id="p1" stillBelieves="the crate is safe"/>');
  });

  it("LIFE-CANON-6 — canon renders id, name, note and scenesSince in the order given", () => {
    const p = buildSceneOpenPrompt({
      ...base,
      canon: [
        { id: "stale", name: "The lock", note: "away a while", scenesSince: 7 },
        { id: "fresh", name: "The book", note: "just seen", scenesSince: 0 },
      ],
    });
    expect(p).toContain('<entity id="stale" name="The lock" scenesSince="7">away a while</entity>');
    expect(p.indexOf("stale")).toBeLessThan(p.indexOf("fresh"));
  });

  it("LIFE-CANON-6 — the closing line demands canon reuse only from scene 3 onward", () => {
    // The engine counts from zero, so `sceneIndex >= 2` is the THIRD scene. The
    // first two have almost no canon to reuse, and demanding it there produces
    // a scene about the one thing the player has seen.
    expect(buildSceneOpenPrompt({ ...base, sceneIndex: 0 })).toContain("Open scene 1.");
    expect(buildSceneOpenPrompt({ ...base, sceneIndex: 1 })).toContain("Open scene 2.");
    expect(buildSceneOpenPrompt({ ...base, sceneIndex: 1 })).not.toContain("MUST draw on");
    const third = buildSceneOpenPrompt({ ...base, sceneIndex: 2 });
    expect(third).toContain("Open scene 3.");
    expect(third).toContain("MUST draw on something already in <canon>");
  });

  it("LIFE-STORY-STAGE-3 — an early chapter-1 scene carries a storyStage block", () => {
    const arrival = buildSceneOpenPrompt({ ...base, chapterNumber: 1, chapterTurns: 0 });
    expect(arrival).toContain('<storyStage stage="arrival">');
    expect(arrival).toMatch(/Its subject is ORDINARY/);
  });

  it("LIFE-STORY-STAGE-3 — the stirring stage may notice one concrete thing", () => {
    const stirring = buildSceneOpenPrompt({ ...base, chapterNumber: 1, chapterTurns: 14 });
    expect(stirring).toContain('<storyStage stage="stirring">');
    expect(stirring).toMatch(/FIRST small, concrete thing/);
    expect(stirring).toMatch(/nobody explains it/i);
  });

  it("LIFE-STORY-STAGE-3 — the block costs NOTHING once the world is underway", () => {
    expect(buildSceneOpenPrompt({ ...base, chapterNumber: 2, chapterTurns: 0 })).not.toContain(
      "<storyStage",
    );
    expect(buildSceneOpenPrompt({ ...base, chapterNumber: 1, chapterTurns: 21 })).not.toContain(
      "<storyStage",
    );
  });

  it("defaults an absent chapterNumber/chapterTurns to chapter 1 turn 0 (arrival)", () => {
    // The client used `?? 1` / `?? 0`, and a world mid-migration can genuinely
    // have neither. Absent must not mean "no stage block".
    expect(buildSceneOpenPrompt(base)).toContain('<storyStage stage="arrival">');
  });

  it("escapes XML in every interpolated position", () => {
    const p = buildSceneOpenPrompt({
      ...base,
      characterName: 'A "B" & <C>',
      situation: "a < b & c",
      universe: { setting: "<locks> & gates", laws: ['a "law"'], places: ["<here>"] },
      cast: [principal('p"1', "B&B", { known: "<known>", wants: "a & b" })],
      fronts: [{ id: 'f"1', driverId: 'p"1', agenda: "A & B <together>" }],
      canon: [{ id: "c&1", name: "The <lock>", note: "a & b", scenesSince: 1 }],
      ironyAvailable: [{ castId: 'p"1', believes: 'it is "safe"' }],
      focus: { castId: 'p"1', name: 'Bébert "the clerk"' },
      recentSubjects: ["a & b"],
    });
    expect(p).toContain("&amp;");
    expect(p).toContain("&lt;");
    expect(p).toContain("&quot;");
    // No raw `<` survives inside a rendered value.
    expect(p).not.toContain("<locks>");
    expect(p).not.toContain("A & B <together>");
  });
});

/**
 * SRV-PROMPT-9 — assembled size against the byte cap.
 *
 * ⚠ THE FIXTURE IS SYNTHETIC. `SRV-PROMPT-9` records that the archived worlds
 * its evidence would otherwise come from live in `.playthroughs/`, which is
 * gitignored and absent from a fresh checkout. So this is built to the maxima
 * the CODE enforces, with prose at the top of what the prompts themselves ask
 * for — a realistic maximum, not a provable one.
 *
 * ⚠ THE ONE TERM WITH NO BOUND AT ALL IS THE CAST COUNT. `renderWorldStory`
 * (the arc / step block) slices regulars at `REGULARS_RENDER_CEILING`; THIS
 * prompt does not, and never has. `MAX_PRINCIPALS` caps principals at 3, but
 * regulars accumulate for the life of the world — LIFE-CAST-3's own note says
 * "thirty named people by chapter five". Thirty is the figure this fixture uses.
 * Measured crossing point: ~91 regulars at this prose length. That is a long way
 * past anything observed, which is why this migrated rather than stopping — but
 * it is a slope, not a ceiling, and the fix if it ever bites is a byte budget on
 * the rendered cast (the `LIFE-WORLD-ARC-7` shape), not a smaller count.
 */
describe("SRV-PROMPT-9 — assembled size against the byte cap", () => {
  const CAP = 65_536;
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");
  const rep = (n: number) =>
    "You went back to the lock at first light and found the roster book already open on the clerk’s desk, and the week you needed promised to a name you did not recognise. "
      .repeat(30)
      .slice(0, n);

  /** LIFE-CAST-3's own figure for a long-played world. */
  const REGULARS_AT_CHAPTER_FIVE = 30;
  /** `CANON_DIGEST_CAP`, client-side (`src/lib/life/canon.ts`) — restated as a
   *  literal rather than imported across the project split. */
  const CANON_DIGEST_CAP = 24;
  /** `RECENT_SUBJECTS_WINDOW` and the history slice are both 6. */

  const worstCase: SceneOpenPromptInput = {
    characterName: "Marguerite-Anne Lavalle-Beaumont",
    practiceLanguage: "French",
    universe: {
      setting: rep(220),
      // sagaOpen asks for 3-6 of each; the top of its own range.
      laws: Array.from({ length: 6 }, () => rep(185)),
      places: Array.from({ length: 6 }, () => rep(100)),
    },
    situation: rep(400),
    cast: [
      // MAX_PRINCIPALS = 3.
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `principal-${i}`,
        name: `Principal ${i} de Montfaucon-Villeneuve`,
        tier: "principal" as const,
        standing: 2,
        known: rep(240),
        wants: rep(180),
        nextMove: rep(180),
      })),
      ...Array.from({ length: REGULARS_AT_CHAPTER_FIVE }, (_, i) => ({
        id: `regular-${i}`,
        name: `Regular ${i} Duchamp-Arnaud`,
        tier: "regular" as const,
        standing: 0,
        known: rep(185),
        routine: rep(165),
      })),
    ],
    // Only ONE front is ever created (`runSagaOpen`); nothing in the app makes
    // a second, so one is the code maximum rather than a modest choice.
    fronts: [{ id: "opening-front", driverId: "principal-0", agenda: rep(185) }],
    canon: Array.from({ length: CANON_DIGEST_CAP }, (_, i) => ({
      id: `canon-${i}`,
      name: `The wash-house under the second lock ${i}`,
      note: rep(220),
      scenesSince: i,
    })),
    history: Array.from({ length: 60 }, () => rep(300)),
    sceneIndex: 40,
    needSign: ["opening-front"],
    ironyAvailable: Array.from({ length: 3 }, (_, i) => ({
      castId: `principal-${i}`,
      believes: rep(150),
    })),
    focus: { castId: "principal-0", name: "Principal 0 de Montfaucon-Villeneuve" },
    recentSubjects: Array.from({ length: 60 }, () => rep(90)),
    chapterNumber: 1,
    chapterTurns: 14,
  };

  it("SRV-PROMPT-9 — SI + the realistic worst case stays well under the cap", () => {
    const sum = bytes(SI()) + bytes(buildSceneOpenPrompt(worstCase));
    // Measured 36,046 B = 55.0%. The bar is the one the migration was held to:
    // comfortably inside, not merely inside.
    expect(sum).toBeLessThan(CAP * 0.6);
  });

  it("SRV-PROMPT-9 — the history slice makes a long saga cost O(1)", () => {
    // Sixty history lines must cost exactly what six do. If the slice is ever
    // removed this is the assertion that fails, rather than the byte total
    // drifting up unremarked.
    const six = { ...worstCase, history: worstCase.history.slice(0, 6) };
    expect(bytes(buildSceneOpenPrompt(worstCase))).toBe(bytes(buildSceneOpenPrompt(six)));
  });

  it("SRV-PROMPT-9 — the recent-subjects window makes a long world cost O(1) too", () => {
    const six = { ...worstCase, recentSubjects: worstCase.recentSubjects.slice(0, 6) };
    expect(bytes(buildSceneOpenPrompt(worstCase))).toBe(bytes(buildSceneOpenPrompt(six)));
  });

  it("SRV-PROMPT-9 — the CAST is the one term with no bound, and it is a slope", () => {
    // Recorded rather than asserted away: this is the number to re-read if a
    // `too-large` ever appears on `life_scene_gen`. At this prose length the
    // assembled pair crosses `MAX_PROMPT_BYTES` at ~91 regulars; thirty (the
    // chapter-five figure in LIFE-CAST-3) is a long way short of that.
    const at = (regulars: number) =>
      bytes(SI()) +
      bytes(
        buildSceneOpenPrompt({
          ...worstCase,
          cast: [
            ...worstCase.cast.filter((c) => c.tier === "principal"),
            ...Array.from({ length: regulars }, (_, i) => ({
              id: `regular-${i}`,
              name: `Regular ${i} Duchamp-Arnaud`,
              tier: "regular" as const,
              standing: 0,
              known: rep(185),
              routine: rep(165),
            })),
          ],
        }),
      );
    expect(at(REGULARS_AT_CHAPTER_FIVE)).toBeLessThan(CAP);
    expect(at(60)).toBeLessThan(CAP);
    expect(at(120)).toBeGreaterThan(CAP);
  });
});
