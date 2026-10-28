/**
 * LIFE-ONBOARD-6 / LIFE-ARCH-3 — the character-bio prompt, server-side.
 *
 * SRV-PROMPT-8..13 batch 6. `src/lib/life/prompts/bio.ts` is DELETED
 * (SRV-PROMPT-3) and everything below either MOVED here from a client test or
 * is new coverage the migration itself created:
 *
 *   MOVED from `src/lib/life/prompts/exemplarBleed.test.ts` — the `bio` row of
 *   LIFE-STORY-EXEMPLAR-1's table. It was the last world-CREATION surface left
 *   in that table (`sagaOpen` left in batch 5, `worldArc` in batch 3); what
 *   remains there are the two per-TURN surfaces, which are batch 8's.
 *   NEW — the `<world>` block's branches, the live-front filter at every shape
 *   `resolved` can take, and SRV-PROMPT-9's size gate.
 *
 * ⚠ THE PROMPT TEXT IS NOT EDITED BY THIS BATCH. Byte-identity against the
 * deleted client builder is asserted separately, in `bioGoldenParity.test.ts`,
 * against a capture taken immediately before the deletion. The assertions here
 * are about CONTRACT — what the prompt must contain and how it must branch —
 * and would survive a future, measured edit to the wording; the golden would
 * not, and says so at its head.
 */
import { describe, expect, it } from "vitest";
import {
  bioSystemInstruction,
  buildBioPrompt,
  type BioPromptInput,
  type BioStory,
} from "../prompts/lifeBio";

const base: BioPromptInput = {
  characterName: "Marc",
  practiceLanguage: "French",
  nativeLanguage: "English",
  worldSeedKey: "city_life",
};

const story = (over: Partial<BioStory> = {}): BioStory => ({
  title: "Le 14 rue Cendrillon",
  tone: "wry, unhurried",
  situation: "You have a room over the lock.",
  cast: [{ name: "Bébert", known: "Runs the roster office." }],
  fronts: [{ agenda: "The lease is being bought out.", resolved: null }],
  ...over,
});

// ---------------------------------------------------------------------------
// MOVED — LIFE-STORY-EXEMPLAR-1
// ---------------------------------------------------------------------------

/**
 * LIFE-STORY-EXEMPLAR-1 — a world-creation prompt may not name a specific
 * ORDINARY PLACE as its worked example.
 *
 * ⚠ THIS ROW MOVED rather than dying (SRV-PROMPT-3). It was the LAST
 * world-creation surface in `exemplarBleed.test.ts`'s table: `worldArc` moved
 * in batch 3 and `sagaOpen` in batch 5, and what is left there are the two
 * per-TURN prose surfaces. Deleting it there without landing it here would have
 * retired the guard on the prompt that writes the player's own JOB and
 * NEIGHBOURHOOD — the two fields most able to put a bakery in a life.
 *
 * Same four nouns and the same regex as the client table, so a diff between the
 * two reads clean.
 */
const RECYCLED_PLACES = ["bakery", "baker", "boulanger", "boulangerie"] as const;

describe("LIFE-STORY-EXEMPLAR-1 — the bio SI demonstrates no bakery", () => {
  it("names no specific ordinary place", () => {
    const text = bioSystemInstruction("French");
    const found = RECYCLED_PLACES.filter((w) =>
      new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "iu").test(text),
    );
    expect(found, `bio still teaches: ${found.join(", ")}`).toEqual([]);
  });

  it("the surface under test is non-trivial — the guard is not reading an empty string", () => {
    // The client table asserted `text.length > 200` for exactly this reason: a
    // `filter` over a prompt that had become "" would report agreement.
    expect(bioSystemInstruction("French").length).toBeGreaterThan(200);
  });
});

// ---------------------------------------------------------------------------
// NEW — the system instruction's contract
// ---------------------------------------------------------------------------

describe("bioSystemInstruction — the output contract and the world rule", () => {
  it("names every field the Zod parser requires", () => {
    const si = bioSystemInstruction("French");
    // `ZBio` in `generateBio.ts` is the other end of this contract. A field the
    // SI stops naming parses as missing and the whole bio is dropped
    // (`life.bio.schema-failed`), which is silent — the world simply starts
    // without one.
    for (const field of [
      "people",
      "job",
      "cityNeighborhood",
      "homeDescription",
      "quirks",
      "currentSituation",
      "hooks",
    ]) {
      expect(si, field).toContain(`"${field}"`);
    }
  });

  it("SRV-PROMPT-11 shape — the output contract is PROSE, and there is no schema to carry it", () => {
    // `life_bio` sends `responseMimeType: 'application/json'` and NO
    // `responseSchema`, before this batch and after it. So the only thing
    // telling the model what JSON to return is this text, which is why the
    // field list above is asserted rather than a schema's `required` array.
    const si = bioSystemInstruction("French");
    expect(si).toContain("Return ONE JSON object matching this schema:");
    expect(si).toContain("Return ONLY the JSON. No prose, no markdown fences.");
  });

  it("LIFE-ARCH-3 — the world is authoritative over the bio, and says so in both directions", () => {
    const si = bioSystemInstruction("French");
    expect(si).toContain("THE WORLD (when a <world> block is present)");
    expect(si).toContain("the world is right and the bio is wrong");
    // The three block names the user prompt actually renders. An SI that
    // described a block the builder stopped emitting would instruct the model
    // about something it never sees.
    expect(si).toContain("<situation>");
    expect(si).toContain("<cast>");
    expect(si).toContain("<inMotion>");
  });

  it("interpolates the PRACTICE language, and only it", () => {
    const fr = bioSystemInstruction("French");
    const ja = bioSystemInstruction("Japanese");
    expect(fr).toContain("appropriate to the practice language: French.");
    expect(ja).toContain("appropriate to the practice language: Japanese.");
    expect(fr).not.toBe(ja);
    // PRACTICE-CACHE-1's precondition, stated as a test rather than a comment:
    // the SI is NOT byte-constant across the population, so it cannot carry a
    // `cacheSlot` — every call would be a billed cache CREATE.
    expect(fr.replace(/French/g, "Japanese")).toBe(ja);
  });
});

// ---------------------------------------------------------------------------
// NEW — the user prompt's branches
// ---------------------------------------------------------------------------

describe("buildBioPrompt — the seed branch", () => {
  it("a chip seed renders the VIBE KEY line and the closed menu", () => {
    const out = buildBioPrompt(base);
    expect(out).toContain("Vibe key: city_life (one of: city_life,");
    expect(out).not.toContain("User's free-text seed");
  });

  it("a manual seed renders the user's own text INSTEAD, never both", () => {
    const out = buildBioPrompt({ ...base, worldSeedKey: "manual", worldSeedText: "a canal town" });
    expect(out).toContain(`User's free-text seed: "a canal town"`);
    expect(out).not.toContain("Vibe key:");
  });

  it("an EMPTY seed text falls back to the vibe key — the branch is on truthiness", () => {
    // `input.worldSeedText ? … : …`, so "" takes the key branch. Worth pinning:
    // a port that switched to `!== undefined` would render
    // `User's free-text seed: ""` and tell the model the player described
    // nothing, which is a different world.
    const out = buildBioPrompt({ ...base, worldSeedText: "" });
    expect(out).toContain("Vibe key: city_life");
    expect(out).not.toContain("free-text seed");
  });
});

describe("buildBioPrompt — the mode branch (LIFE-ONBOARD-3)", () => {
  it("absent mode renders NO mode line at all", () => {
    expect(buildBioPrompt(base)).not.toContain("World mode:");
  });

  it("realistic and fantasy render DIFFERENT glosses", () => {
    const realistic = buildBioPrompt({ ...base, worldMode: "realistic" });
    const fantasy = buildBioPrompt({ ...base, worldMode: "fantasy" });
    expect(realistic).toContain("World mode: realistic — a life the player could plausibly live.");
    expect(fantasy).toContain("World mode: fantasy — heightened genre.");
    expect(realistic).not.toBe(fantasy);
  });
});

describe("buildBioPrompt — the <world> block (LIFE-ARCH-3)", () => {
  it("renders nothing when there is no story", () => {
    expect(buildBioPrompt(base)).not.toContain("<world");
  });

  it("story = null is INDISTINGUISHABLE from absent", () => {
    // The call site passes `null` when `sagaOpen` failed, so this is a live
    // path rather than a hypothetical. It is asserted here because the WIRE
    // rejects a null (see `serverPromptSpec.test.ts`): the builder tolerating
    // it and the validator refusing it are two deliberate, different answers.
    expect(buildBioPrompt({ ...base, story: null })).toBe(buildBioPrompt(base));
  });

  it("renders title and tone as ATTRIBUTES and situation as a text node", () => {
    const out = buildBioPrompt({ ...base, story: story() });
    expect(out).toContain('<world title="Le 14 rue Cendrillon" tone="wry, unhurried">');
    expect(out).toContain("<situation>You have a room over the lock.</situation>");
    expect(out).toContain("</world>");
  });

  it("renders each cast member as a <person>, name in the attribute and `known` as the body", () => {
    const out = buildBioPrompt({
      ...base,
      story: story({
        cast: [
          { name: "Bébert", known: "Runs the roster office." },
          { name: "Sophie", known: "Walks the dog past at six." },
        ],
      }),
    });
    expect(out).toContain('<person name="Bébert">Runs the roster office.</person>');
    expect(out).toContain('<person name="Sophie">Walks the dog past at six.</person>');
    expect((out.match(/<person /g) ?? []).length).toBe(2);
  });

  it("an EMPTY cast renders no <cast> block, and an empty fronts list no <inMotion>", () => {
    const out = buildBioPrompt({ ...base, story: story({ cast: [], fronts: [] }) });
    expect(out).toContain("<world ");
    expect(out).not.toContain("<cast>");
    expect(out).not.toContain("<inMotion>");
  });

  it("the two blocks are INDEPENDENT — one may render without the other", () => {
    // A port that folded them under one `if (cast.length)` would still pass
    // every fixture that sets both.
    const castOnly = buildBioPrompt({ ...base, story: story({ fronts: [] }) });
    expect(castOnly).toContain("<cast>");
    expect(castOnly).not.toContain("<inMotion>");
    const frontsOnly = buildBioPrompt({ ...base, story: story({ cast: [] }) });
    expect(frontsOnly).not.toContain("<cast>");
    expect(frontsOnly).toContain("<inMotion>");
  });
});

describe("buildBioPrompt — the LIVE-front filter, at every shape `resolved` can take", () => {
  // ⚠ THE FILTER IS `f.resolved == null`, which is TRUE for absent, `undefined`
  // AND `null` and false for every string. Batch 3's parity guard survived a
  // mutation from `== null` to `=== null` because every fixture set the field
  // explicitly — so all four shapes are constructed here, in TypeScript, where
  // a JSON fixture cannot tell absent from `undefined` at all.
  const agenda = (i: number) => `Force ${i} is under way.`;

  it("absent, undefined and null are ALL live", () => {
    const out = buildBioPrompt({
      ...base,
      story: story({
        fronts: [
          { agenda: agenda(1) },
          { agenda: agenda(2), resolved: undefined },
          { agenda: agenda(3), resolved: null },
        ],
      }),
    });
    expect((out.match(/<force>/g) ?? []).length).toBe(3);
    for (const i of [1, 2, 3]) expect(out).toContain(`<force>${agenda(i)}</force>`);
  });

  it("a resolved front is DROPPED — 'filled' and 'cleared' both", () => {
    const out = buildBioPrompt({
      ...base,
      story: story({
        fronts: [
          { agenda: agenda(1), resolved: "filled" },
          { agenda: agenda(2), resolved: null },
          { agenda: agenda(3), resolved: "cleared" },
        ],
      }),
    });
    expect((out.match(/<force>/g) ?? []).length).toBe(1);
    expect(out).toContain(`<force>${agenda(2)}</force>`);
    expect(out).not.toContain(agenda(1));
    expect(out).not.toContain(agenda(3));
  });

  it("EVERY front resolved renders no <inMotion> block at all", () => {
    const out = buildBioPrompt({
      ...base,
      story: story({
        fronts: [
          { agenda: agenda(1), resolved: "filled" },
          { agenda: agenda(2), resolved: "cleared" },
        ],
      }),
    });
    expect(out).toContain("<world ");
    expect(out).not.toContain("<inMotion>");
  });
});

describe("buildBioPrompt — escaping", () => {
  it("ONE escape covers attributes AND text nodes, quotes included", () => {
    // ⚠ The bio uses a SINGLE `esc` for both positions, where `lifeSagaOpen` and
    // `lifeWorldState` split `esc` (attributes, escapes `"`) from `escT` (text,
    // does not). A port that reached for the two-function idiom would diverge
    // ONLY on a `"` inside a text node — which is why the assertion is on the
    // text nodes rather than on the attributes.
    const out = buildBioPrompt({
      ...base,
      characterName: 'Ma<rc "the & one">',
      story: story({
        situation: 'She said "no" & left <the yard>.',
        cast: [{ name: 'Bé<ber>t "the & clerk"', known: 'Runs the "roster" & <office>.' }],
        fronts: [{ agenda: 'The "lease" & <yard> are bought out.', resolved: null }],
      }),
    });
    expect(out).toContain("<situation>She said &quot;no&quot; &amp; left &lt;the yard&gt;.</situation>");
    expect(out).toContain(
      '<person name="Bé&lt;ber&gt;t &quot;the &amp; clerk&quot;">Runs the &quot;roster&quot; &amp; &lt;office&gt;.</person>',
    );
    expect(out).toContain("<force>The &quot;lease&quot; &amp; &lt;yard&gt; are bought out.</force>");
    // …and the character NAME is NOT escaped: it is interpolated into prose,
    // not into markup. Pinned so a port cannot "tidy" it into an escape and
    // silently change what the model reads.
    expect(out).toContain('Generate a bio for Ma<rc "the & one">, a French-speaking character.');
  });
});

describe("buildBioPrompt — the instruction tail", () => {
  it("names the character, the practice language and the native language", () => {
    const out = buildBioPrompt(base);
    expect(out).toContain("Generate a bio for Marc, a French-speaking character.");
    expect(out).toContain("Native language: English.");
    expect(out).toContain("Return ONLY the JSON.");
  });

  it("⚠ the <world> block runs straight into the instruction with NO separator", () => {
    // PRESERVED, NOT FIXED. The builder's array ends with a `` row that was
    // plainly meant to leave a blank line between `</world>` and `Generate a
    // bio…`, and `.filter(Boolean)` drops it — so the two run together. That is
    // what has shipped since the block was added, and byte-identity is this
    // batch's contract, so it is pinned here rather than quietly corrected: a
    // prompt-text change needs `npm run test:prompts` evidence, which is a
    // separate, measured piece of work.
    const out = buildBioPrompt({ ...base, story: story() });
    expect(out).toContain("</world>Generate a bio for Marc");
  });
});

// ---------------------------------------------------------------------------
// NEW — SRV-PROMPT-9
// ---------------------------------------------------------------------------

/**
 * SRV-PROMPT-9 — assembled size against the byte cap.
 *
 * The legacy path caps `prompt` and `systemInstruction` SEPARATELY; the built
 * path caps their SUM. So a category that fits today can stop fitting on the
 * day it moves, with no change to its content.
 *
 * ⚠ THE FIXTURES ARE SYNTHETIC. SRV-PROMPT-9 records that the archived worlds
 * its evidence would otherwise come from live in `.playthroughs/`, which is
 * gitignored and absent from a fresh checkout. These are built to the maxima the
 * CODE enforces, with prose at the top of what the prompt itself asks for.
 *
 * ── WHAT IS BOUNDED, AND BY WHAT ────────────────────────────────────────────
 *
 * IN CODE:       `worldMode` — a closed enum, validated server-side.
 * IN COUNT ONLY: `story.cast` and `story.fronts`. This prompt applies no render
 *                cap of its own (unlike `renderWorldStory`, which slices
 *                regulars at `REGULARS_RENDER_CEILING`). What bounds them is the
 *                CALL SITE: `generateCharacterBio` runs exactly once per world,
 *                immediately after `runSagaOpen`, whose response schema pins
 *                `principals` at 2-3 and `regulars` at 3-5 and emits ONE front.
 *                So the shipped payload is ≤ 8 cast and 1 front — a bound that
 *                lives in another prompt's schema, not in this one's code.
 * IN THE UI ONLY: `characterName` (`maxLength={32}`) and `worldSeedText`
 *                (`maxLength={500}`), capped by the onboarding form and by
 *                nothing in `src/lib/`.
 * NOT AT ALL:    every prose LENGTH — `title`, `tone`, `situation`, each cast
 *                member's `known`, each front's `agenda` are model-authored with
 *                no bound anywhere.
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
  /** `sagaOpenResponseSchema`'s ceiling: 3 principals + 5 regulars. */
  const SAGA_CAST_CEILING = 8;
  /** LIFE-CAST-3's figure for a long-played world — unreachable from this call
   *  site, measured anyway because the prompt itself does not know that. */
  const CAST_AT_CHAPTER_FIVE = 33;

  const cast = (n: number, known: number) =>
    Array.from({ length: n }, (_, i) => ({
      name: `Marguerite-Anne Lavalle-Beaumont ${i}`,
      known: rep(known),
    }));

  const fronts = (n: number, agenda: number) =>
    Array.from({ length: n }, () => ({ agenda: rep(agenda), resolved: null }));

  /** Both UI caps maxed; nothing else on a story-less call is caller-supplied. */
  const noStoryMax: BioPromptInput = {
    characterName: "M".repeat(NAME_MAX),
    practiceLanguage: "French",
    nativeLanguage: "English",
    worldSeedKey: "manual",
    worldMode: "realistic",
    worldSeedText: rep(SEED_TEXT_MAX),
  };

  /** The biggest payload the APP can produce: the saga schema's cast ceiling,
   *  its one front, and prose at the length the saga prompt asks for. */
  const shippedMax: BioPromptInput = {
    ...noStoryMax,
    story: {
      title: rep(60),
      tone: rep(80),
      situation: rep(400),
      cast: cast(SAGA_CAST_CEILING, 200),
      fronts: fronts(1, 200),
    },
  };

  /** Deliberately harsher, in the LIFE-WORLD-ARC-7 shape: LIFE-CAST-3's
   *  chapter-five cast, five fronts, and every prose field at 400 characters. */
  const harsher: BioPromptInput = {
    ...noStoryMax,
    story: {
      title: rep(400),
      tone: rep(400),
      situation: rep(400),
      cast: cast(CAST_AT_CHAPTER_FIVE, 400),
      fronts: fronts(5, 400),
    },
  };

  const sum = (i: BioPromptInput) =>
    bytes(bioSystemInstruction(i.practiceLanguage)) + bytes(buildBioPrompt(i));

  it("SRV-PROMPT-9 — the story-less call, where the SI is nearly the whole payload", () => {
    // Measured 3,622 B = 5.5% of cap (a 2,845 B SI and a 777 B prompt). This is
    // the arm a world takes when `sagaOpen` failed, and it is a CEILING: both
    // caller strings are at their form caps and nothing else varies.
    expect(sum(noStoryMax)).toBeLessThan(CAP * 0.1);
  });

  it("SRV-PROMPT-9 — the biggest payload the APP can send", () => {
    // Measured 6,621 B = 10.1% of cap. Bounded by another prompt's response
    // schema rather than by this one's code, which is why the slope below is
    // recorded as well as the point.
    expect(sum(shippedMax)).toBeLessThan(CAP * 0.15);
  });

  it("SRV-PROMPT-9 — a deliberately HARSHER world is still a fraction of the cap", () => {
    // Measured 22,526 B = 34.4%: four times LIFE-CAST-3's chapter-five cast
    // relative to what this call can actually receive, five fronts where the
    // saga emits one, and every prose field at 400 characters.
    expect(sum(harsher)).toBeLessThan(CAP * 0.4);
  });

  it("SRV-PROMPT-9 — the cast is the only slope, and the crossing point is far away", () => {
    // Recorded rather than asserted away: this is the number to re-read if a
    // `too-large` ever appears on `life_bio`. At 400-character prose the
    // assembled pair crosses `MAX_PROMPT_BYTES` at 125 cast members — against a
    // call site that can send 8.
    const at = (n: number) => sum({ ...harsher, story: { ...harsher.story!, cast: cast(n, 400) } });
    // At the saga's own cast ceiling, but with the harsher fixture's 400-char
    // prose and five fronts around it: 10,803 B = 16.5%.
    expect(at(SAGA_CAST_CEILING)).toBeLessThan(CAP * 0.2);
    expect(at(124)).toBeLessThan(CAP);
    expect(at(125)).toBeGreaterThan(CAP);
  });
});
