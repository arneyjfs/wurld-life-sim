import { describe, expect, it } from "vitest";
import { resolveServerPrompt } from "../prompts/serverPromptSpec";

/**
 * SRV-PROMPT-9 — the byte gate for `life_step`, and THE ONE BATCH WHOSE
 * MEASUREMENT COULD NOT BE TAKEN AGAINST A REAL WORLD.
 *
 * ⚠ EVERY NUMBER IN THIS FILE IS SYNTHETIC. SRV-PROMPT-9 asks for a measured
 * 95th percentile against a LONG-PLAYED world, and says in terms where those
 * worlds live: `.playthroughs/`, which is gitignored and absent from a fresh
 * checkout. There is no archived world in this repository, so there is nothing
 * to take a percentile OF — and a migration that "measured" it without one has
 * measured an empty world, which is the case that always fits.
 *
 * What is measured instead is a CEILING built from the caps the CODE enforces.
 * That is weaker than a percentile in one specific way and stronger in another:
 * weaker because it says nothing about what a typical world actually weighs, and
 * stronger because a ceiling that fits means every world under those caps fits,
 * whatever the distribution. Where a term has NO code cap it is named below
 * rather than given a plausible value, because the terms without caps are the
 * ones that matter — `LIFE-WORLD-ARC-7` was exactly that shape and it cost
 * batch 3 a stop.
 *
 * ── THE CODE-ENFORCED CAPS THIS FIXTURE IS BUILT FROM ───────────────────────
 *
 *   | term                  | cap | enforced by                              |
 *   |-----------------------|-----|------------------------------------------|
 *   | `events`              |  40 | `useLifeEvents`' Firestore `limit(40)`   |
 *   | rendered events       |  20 | `STEP_EVENT_WINDOW` (render only)        |
 *   | `storyLogEntries`     |  60 | `STORY_LOG_CAP` (`commitNode`)           |
 *   | canon, per bucket     |  48 | `CANON_BUCKET_CAP` (`capCanon`)          |
 *   | rendered regulars     |   8 | `REGULARS_RENDER_CEILING`                |
 *   | principals            |   3 | `MAX_PRINCIPALS` (`fronts.ts`, at open)  |
 *   | retry violations      |   8 | `MAX_STEP_VIOLATIONS`                    |
 *   | recurring NPC block   |   — | no cap; the block warns over 8           |
 *   | `<npcRoster>` rows    |   — | no cap; LIFE-CAST-3 expects ~30 by ch. 5 |
 *
 * ── THE UNBOUNDED TERMS, NAMED ──────────────────────────────────────────────
 *
 * Six terms are bounded in COUNT and unbounded in LENGTH, which is the
 * `LIFE-WORLD-ARC-7` shape — the one that crossed the cap silently and fell
 * back to `trivialArc`:
 *
 *   · `bio`               — a stored Firestore string with no cap anywhere
 *   · `storyLogEntries[]` — 60 rows, each an unbounded model-written sentence
 *   · `canon[].note`      — one per entity, unbounded, 192 of them at the cap
 *   · `events[].payload`  — 20 rendered rows of unbounded beat text
 *   · `npcs[].oneLineMemory` — "≤30 words" is asked for, never enforced
 *   · `universe.laws[]`   — unbounded COUNT as well as length
 *
 * `SRV-PROMPT-17`'s field caps do NOT bound most of these: they bound the
 * LABEL-shaped and LANGUAGE-shaped fields, and a 400-character `sentence` cap
 * on sixty story-log rows is still 24 kB. The fixture below therefore drives
 * every one of them to a deliberately harsh length and reports what happens,
 * which is the honest substitute for a percentile.
 */

const MAX_PROMPT_BYTES = 65_536;
const bytes = (s: string) => Buffer.byteLength(s, "utf8");

function built(spec: Record<string, unknown>) {
  const r = resolveServerPrompt("life_step", spec);
  if (r.status !== "built") throw new Error(`rejected: ${JSON.stringify(r)}`);
  return { si: bytes(r.systemInstruction), prompt: bytes(r.prompt) };
}

const pct = (n: number) => `${((n / MAX_PROMPT_BYTES) * 100).toFixed(1)}%`;

/** A model-written sentence of roughly `n` characters. */
const line = (n: number, seed: string) =>
  `${seed} `.repeat(Math.ceil(n / (seed.length + 1))).slice(0, n).trim();

function spec(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "life_step",
    practiceLanguage: "Spanish (Latin America)",
    nativeLanguage: "English",
    systemLanguage: "English",
    difficulty: 3,
    characterName: "Marc",
    worldSeedKey: "city_life",
    isOpeningBeat: false,
    requestKind: "live",
    ...over,
  };
}

describe("SRV-PROMPT-9 — life_step assembles under the cap (SYNTHETIC ceiling)", () => {
  it("SRV-PROMPT-9 — the SYSTEM INSTRUCTION alone, which is the fixed floor", () => {
    const { si } = built(spec());
    // The SI is invariant across callers except for four interpolated values,
    // so this is the floor every `life_step` call pays before a world exists.
    // ⚠ SYNTHETIC only in the sense that the LANGUAGE NAMES are the longest in
    // `SUPPORTED_LANGUAGES`; the rest is the shipped instruction byte for byte.
    expect(si).toBeGreaterThan(20_000);
    expect(si).toBeLessThan(26_000);
    console.log(`SRV-PROMPT-9 life_step SI floor: ${si} B (${pct(si)} of cap)`);
  });

  it("SRV-PROMPT-9 — a TYPICAL turn (synthetic, chapter-2 shaped)", () => {
    // Half the story log, half the canon, a smaller roster — a world a few
    // scenes in rather than one at every cap. Reported as the LOW end of the
    // three-point spread that stands in for a percentile.
    const { si, prompt } = built(
      spec({
        bio: "<bio>A baker from the coast.</bio>",
        universe: {
          setting: line(90, "A canal town"),
          era: "the present day",
          laws: [line(90, "no barge moves without a slip")],
          places: ["The wash-house"],
          figures: [{ name: "Bebert", what: line(70, "keeps the book") }],
        },
        story: {
          situation: line(120, "You have a room over the bakery"),
          fronts: [{ driverId: "p0", agenda: line(80, "buying the lease"), resolved: null }],
          cast: [
            {
              id: "p0", name: "Bebert", voice: "dry", standing: 1, tier: "principal",
              known: line(70, "runs the lock"), wants: line(50, "the roster changed"),
              nextMove: line(50, "corner the clerk"), ties: [],
            },
            ...Array.from({ length: 4 }, (_, i) => ({
              id: `r${i}`, name: `Regular ${i}`, voice: "clipped", standing: 0,
              tier: "regular", known: line(60, "opens at five"),
              routine: line(50, "sweeps the step"), ties: [],
            })),
          ],
        },
        canon: {
          characters: Array.from({ length: 8 }, (_, i) => ({
            id: `char-${i}`, name: `Person ${i}`, kind: "person", note: line(60, "met at the lock"),
          })),
          places: Array.from({ length: 4 }, (_, i) => ({
            id: `plac-${i}`, name: `Place ${i}`, kind: "place", note: "",
          })),
          objects: [], facts: [],
        },
        npcs: Array.from({ length: 6 }, (_, i) => ({
          id: `char-${i}`, name: `Person ${i}`, scope: i < 2 ? "world" : "scene",
          relationship: "the baker", oneLineMemory: line(80, "you paid her back"),
        })),
        recurringNpcIds: ["char-0", "char-1"],
        chapterNumber: 2,
        chapterTurns: 14,
        sceneTurns: 5,
        storyLogEntries: Array.from({ length: 24 }, (_, i) => line(100, `happened ${i}`)),
        currentLocationLabel: "The wash-house",
        timeOfDay: "morning",
        turnIndex: 14,
        events: Array.from({ length: 24 }, (_, i) => ({
          kind: i % 3 === 0 ? "decision" : "beat",
          payload:
            i % 3 === 0
              ? { text: `Ask about the gate ${i}`, actionType: "ask" }
              : { speaker: "narrator", practiceText: line(130, `beat ${i}`) },
          createdAtMs: 1_000 + i,
        })),
      }),
    );
    const total = si + prompt;
    console.log(
      `SRV-PROMPT-9 life_step TYPICAL (SYNTHETIC): SI ${si} B + prompt ${prompt} B = ${total} B (${pct(total)})`,
    );
    expect(total / MAX_PROMPT_BYTES).toBeLessThan(0.6);
  });

  it("SRV-PROMPT-9 — a HEAVY turn: every code-capped term AT its cap (synthetic, chapter-3 shaped)", () => {
    const { si, prompt } = built(
      spec({
        bio: "<bio>A baker from the coast, new to the canal town.</bio>",
        worldSeedText: line(160, "a canal town of locks and long evenings"),
        universe: {
          setting: line(90, "A canal town"),
          era: "the present day",
          laws: Array.from({ length: 4 }, (_, i) => line(90, `law ${i}`)),
          places: Array.from({ length: 5 }, (_, i) => `The place ${i}`),
          figures: Array.from({ length: 3 }, (_, i) => ({
            name: `Figure ${i}`,
            what: line(70, "keeps the book"),
          })),
        },
        story: {
          situation: line(120, "You have a room over the bakery"),
          fronts: Array.from({ length: 3 }, (_, i) => ({
            driverId: `p${i}`,
            agenda: line(80, `agenda ${i}`),
            resolved: null,
          })),
          cast: [
            ...Array.from({ length: 3 }, (_, i) => ({
              id: `p${i}`,
              name: `Principal ${i}`,
              voice: "clipped",
              standing: 1,
              tier: "principal",
              known: line(70, "runs the lock"),
              wants: line(50, "the roster changed"),
              nextMove: line(50, "corner the clerk"),
              limit: line(40, "nothing in writing"),
              ties: [{ id: `r${i}`, how: line(30, "owes them coal") }],
            })),
            ...Array.from({ length: 8 }, (_, i) => ({
              id: `r${i}`,
              name: `Regular ${i}`,
              voice: "dry",
              standing: 0,
              tier: "regular",
              known: line(60, "opens at five"),
              routine: line(50, "sweeps the step"),
              ties: [],
            })),
          ],
        },
        canon: {
          characters: Array.from({ length: 14 }, (_, i) => ({
            id: `char-${i}`,
            name: `Person ${i}`,
            kind: "person",
            note: line(60, "met at the lock"),
          })),
          places: Array.from({ length: 9 }, (_, i) => ({
            id: `plac-${i}`,
            name: `Place ${i}`,
            kind: "place",
            note: line(40, "by the water"),
          })),
          objects: Array.from({ length: 7 }, (_, i) => ({
            id: `obje-${i}`,
            name: `Thing ${i}`,
            kind: "object",
            note: line(40, "a list of names"),
          })),
          facts: Array.from({ length: 4 }, (_, i) => ({
            id: `fact-${i}`,
            name: `Fact ${i}`,
            kind: "fact",
            note: line(40, "the lease changes hands"),
          })),
        },
        npcs: Array.from({ length: 12 }, (_, i) => ({
          id: `char-${i}`,
          name: `Person ${i}`,
          scope: i < 4 ? "world" : "scene",
          sceneId: i < 4 ? null : "sc-1",
          relationship: "the baker",
          oneLineMemory: line(90, "you paid her back"),
        })),
        recurringNpcIds: Array.from({ length: 4 }, (_, i) => `char-${i}`),
        chapterNumber: 3,
        chapterTurns: 26,
        sceneTurns: 7,
        storyLogEntries: Array.from({ length: 60 }, (_, i) => line(110, `happened ${i}`)),
        arc: {
          chapterNumber: 3,
          premise: line(120, "the lease changes hands"),
          themes: ["obligation", "water"],
          recurringNpcIds: ["char-0"],
          completedSceneMemories: [
            { title: "The first delivery", summary: line(100, "you carried a crate") },
            { title: "A bad morning", summary: line(100, "the bread burned") },
          ],
        },
        scene: {
          id: "sc-1",
          currentPhase: "rising",
          turnsSinceReplan: 2,
          leaning: line(70, "refusing, harder than when you came in"),
          leaningStall: 0,
          outline: {
            title: "The locked gate",
            subject: line(60, "getting through the gate"),
            where: "The wash-house",
            premise: line(110, "the gate is locked and nobody will say why"),
            tone: "wry",
            openQuestion: line(70, "will Bruno hand it over"),
            practiceFocus: ["asking for things", "polite refusal"],
            keyNpcs: [{ npcId: "char-0", name: "Person 0", role: "the one with the key" }],
          },
        },
        currentLocationLabel: "The wash-house",
        goalLadder: {
          saga: { text: line(60, "keep the room"), when: "the end of the month", daysLeft: 9 },
          objective: { text: line(50, "get Hélène to look at your work"), need: { name: "Hélène" } },
          done: Array.from({ length: 3 }, (_, i) => ({
            how: "done",
            text: line(50, `settled ${i}`),
            because: line(40, "the lock changed"),
          })),
          blocked: "Hélène has no reason to do this for you yet",
        },
        timeOfDay: "evening",
        turnIndex: 26,
        events: Array.from({ length: 40 }, (_, i) => ({
          kind: i % 3 === 0 ? "decision" : "beat",
          payload:
            i % 3 === 0
              ? { text: `Ask about the gate ${i}`, actionType: "ask", targetId: `plac-${i % 9}` }
              : {
                  speaker: i % 2 ? "npc" : "narrator",
                  speakerName: "Person 0",
                  npcId: "char-0",
                  practiceText: line(160, `beat ${i} la grille est fermée`),
                },
          createdAtMs: 1_000 + i,
        })),
        choice: {
          id: "open-gate",
          practiceText: "Open the gate",
          speechAct: "say",
          saysLine: line(90, "Buenas tardes, vengo por la llave"),
        },
      }),
    );
    const total = si + prompt;
    console.log(
      `SRV-PROMPT-9 life_step HEAVY (SYNTHETIC): SI ${si} B + prompt ${prompt} B = ${total} B (${pct(total)})`,
    );
    // ⚠ THIS ONE LANDS ABOVE THE ~75% BAR THIS PROGRAMME HAS BEEN HOLDING, and
    // it is reported rather than tuned away. Batch 5 shipped an 80.2% arm on the
    // argument that no app call site reaches it; the argument here is
    // different and weaker, so it is stated plainly:
    //
    //   · EVERY code-capped term is AT its cap simultaneously — 60 story-log
    //     rows, 40 events, 34 canon entries with notes, 11 cast members with
    //     four prose fields each, 12 roster rows with memories. A real world
    //     hits its caps one at a time, and the TYPICAL fixture above (the same
    //     world a chapter earlier) is under 60%.
    //   · The SI is a 22.8 kB FIXED FLOOR (34.8% of cap) before any world
    //     exists, so the caller-driven headroom is ~43 kB rather than 64 kB.
    //     That floor is why this call has less margin than any other kind.
    //   · The slope test below says WHICH term crosses first and at what count,
    //     which is the number a future change actually needs.
    //
    // ⚠ AND IT CANNOT BE COMPARED TO A REAL WORLD, which is this batch's
    // disclosed gap: `.playthroughs/` is gitignored and absent, so there is no
    // archive to take a 95th percentile from. Whoever has a long-played save
    // should re-run this against it before relying on the margin.
    expect(total).toBeLessThan(MAX_PROMPT_BYTES);
    expect(total / MAX_PROMPT_BYTES).toBeLessThan(0.9);
  });

  it("SRV-PROMPT-9 — the CEILING is OVER the cap, and that is the batch's finding", () => {
    // ⚠ READ THIS ONE. Every code-capped term at its cap AT ONCE, with every
    // uncapped LENGTH driven harsh, does NOT fit — the resolver refuses with
    // `too-large`. Reported rather than tuned away, because it is the collision
    // between the two invariants this batch sits on:
    //
    //   · SRV-PROMPT-9 caps the SUM after assembly, where the legacy path
    //     capped the two halves separately — so this kind's budget HALVED on
    //     the day it migrated, with no change to its content.
    //   · SRV-PROMPT-10 says a rejected `life_step` does not degrade: the
    //     player gets "the story hit a snag" and a Continue chip that makes the
    //     same call again.
    //
    // So a world heavy enough to reach this is a world that cannot take a turn.
    // The SLOPE test below is the useful half: it says which term gets there
    // first and at what count, and every one of those counts is well clear of
    // the cap the code enforces — which is why the migration is safe TODAY and
    // why the note in the spec asks for a real save to be measured.
    const long = (n: number) => line(n, "una frase larga que el modelo escribió");
    const ceiling = (
      spec({
        bio: `<bio>${long(2_000)}</bio>`,
        worldSeedText: long(500),
        universe: {
          setting: long(300),
          era: long(60),
          laws: Array.from({ length: 12 }, () => long(300)),
          places: Array.from({ length: 12 }, (_, i) => `Place ${i}`),
          figures: Array.from({ length: 8 }, (_, i) => ({ name: `Figure ${i}`, what: long(200) })),
        },
        story: {
          situation: long(400),
          fronts: Array.from({ length: 6 }, (_, i) => ({
            driverId: `p${i}`,
            agenda: long(400),
            resolved: null,
          })),
          cast: [
            ...Array.from({ length: 3 }, (_, i) => ({
              id: `p${i}`,
              name: `Principal ${i}`,
              voice: long(60),
              standing: 2,
              tier: "principal",
              known: long(400),
              wants: long(400),
              nextMove: long(400),
              limit: long(400),
              ties: Array.from({ length: 3 }, (_, t) => ({ id: `r${t}`, how: long(120) })),
            })),
            // Only 8 regulars RENDER, but the array is uncapped — 30 in, 8 out.
            ...Array.from({ length: 30 }, (_, i) => ({
              id: `r${i}`,
              name: `Regular ${i}`,
              voice: long(60),
              standing: 0,
              tier: "regular",
              known: long(400),
              routine: long(400),
              ties: [],
            })),
          ],
        },
        canon: Object.fromEntries(
          ["characters", "places", "objects", "facts"].map((bucket) => [
            bucket,
            // CANON_BUCKET_CAP, with an unbounded note on every row.
            Array.from({ length: 48 }, (_, i) => ({
              id: `${bucket}-${i}`,
              name: `Entity ${bucket} ${i}`,
              kind: "person",
              note: long(300),
            })),
          ]),
        ),
        // No cap on the roster; LIFE-CAST-3 expects ~30 by chapter five.
        npcs: Array.from({ length: 30 }, (_, i) => ({
          id: `characters-${i}`,
          name: `Entity characters ${i}`,
          scope: "world",
          relationship: long(120),
          oneLineMemory: long(400),
        })),
        recurringNpcIds: Array.from({ length: 30 }, (_, i) => `characters-${i}`),
        chapterNumber: 5,
        chapterTurns: 44,
        sceneTurns: 14,
        storyLogEntries: Array.from({ length: 60 }, () => long(400)),
        arc: {
          chapterNumber: 5,
          premise: long(400),
          themes: Array.from({ length: 6 }, (_, i) => `theme ${i}`),
          recurringNpcIds: Array.from({ length: 12 }, (_, i) => `characters-${i}`),
          completedSceneMemories: Array.from({ length: 6 }, (_, i) => ({
            title: `Scene ${i}`,
            summary: long(400),
          })),
        },
        scene: null,
        currentLocationLabel: long(120),
        goalLadder: {
          saga: { text: long(400), when: long(120), daysLeft: 2 },
          objective: { text: long(400), need: { name: long(120) } },
          done: Array.from({ length: 6 }, () => ({
            how: "closed",
            text: long(400),
            because: long(400),
          })),
          blocked: long(400),
        },
        timeOfDay: "night",
        turnIndex: 44,
        // The Firestore `limit(40)` is the count cap; each beat is unbounded.
        events: Array.from({ length: 40 }, (_, i) => ({
          kind: "beat",
          payload: {
            speaker: "npc",
            speakerName: `Entity characters ${i % 30}`,
            npcId: `characters-${i % 30}`,
            practiceText: long(600),
          },
          createdAtMs: 1_000 + i,
        })),
        practiceOutcome: {
          kind: "generation",
          correct: false,
          picked: long(200),
          correctAnswer: long(200),
          promptSource: long(400),
          resolvedLine: long(400),
          resolvedSpeaker: "user",
        },
        // MAX_STEP_VIOLATIONS, all carrying their longest parameters.
        retry: Array.from({ length: 8 }, () => ({
          code: "schema-issue",
          path: long(120),
          message: long(400),
        })),
      })
    );
    const r = resolveServerPrompt("life_step", ceiling);
    console.log(
      `SRV-PROMPT-9 life_step CEILING (SYNTHETIC): ${r.status === "reject" ? r.reason : "built"}`,
    );
    // The refusal has to be the DOCUMENTED one — `too-large`, from the
    // after-assembly cap — rather than a crash or a silent truncation. That is
    // the difference between a turn the player can retry into a fixed world and
    // one that fails somewhere nobody can see.
    expect(r.status).toBe("reject");
    if (r.status !== "reject") throw new Error("unreachable");
    expect(r.code).toBe("too-large");
    expect(r.reason).toMatch(/over the 65536 cap/);
  });

  it("SRV-PROMPT-9 — the SLOPE: which term crosses the cap first", () => {
    // The useful half of the ceiling above. Each term is grown alone from the
    // realistic base until the resolver refuses, so the answer names a TERM
    // rather than a total — that is what a future change needs to know.
    const base = (over: Record<string, unknown>) =>
      spec({
        bio: "<bio>A baker.</bio>",
        storyLogEntries: [],
        events: [],
        npcs: [],
        canon: { characters: [], places: [], objects: [], facts: [] },
        ...over,
      });
    /** The exact row count at which the resolver first refuses, or -1 for a
     *  term the render window bounds regardless of how many rows arrive.
     *  Bisected rather than doubled, because "somewhere between 64 and 128" is
     *  not a number a future change can compare its cap against. */
    const crossAt = (grow: (n: number) => Record<string, unknown>): number => {
      const fits = (n: number) => resolveServerPrompt("life_step", base(grow(n))).status === "built";
      if (fits(4_000)) return -1;
      let lo = 0;
      let hi = 4_000;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      return hi;
    };

    const storyLogRows = crossAt((n) => ({
      storyLogEntries: Array.from({ length: n }, (_, i) => line(400, `happened ${i}`)),
    }));
    const eventRows = crossAt((n) => ({
      events: Array.from({ length: n }, (_, i) => ({
        kind: "beat",
        payload: { speaker: "narrator", practiceText: line(600, `beat ${i}`) },
        createdAtMs: i,
      })),
    }));
    const canonRows = crossAt((n) => ({
      canon: {
        characters: Array.from({ length: n }, (_, i) => ({
          id: `c${i}`,
          name: `N${i}`,
          kind: "person",
          note: line(300, "met at the lock"),
        })),
        places: [],
        objects: [],
        facts: [],
      },
    }));
    const rosterRows = crossAt((n) => ({
      npcs: Array.from({ length: n }, (_, i) => ({
        id: `c${i}`,
        name: `N${i}`,
        scope: "world",
        oneLineMemory: line(400, "you paid her back"),
      })),
    }));
    console.log(
      `SRV-PROMPT-9 life_step slopes (SYNTHETIC, 400-600 char rows): ` +
        `storyLog crosses at ${storyLogRows} (cap 60), ` +
        `events ${eventRows === -1 ? "NEVER (render window 20)" : `at ${eventRows}`} (loaded 40), ` +
        `canon crosses at ${canonRows} (cap 48/bucket), ` +
        `roster crosses at ${rosterRows} (NO CAP; LIFE-CAST-3 expects ~30)`,
    );

    // ⚠ THE ASSERTIONS ARE THE HEADROOM AGAINST THE CODE CAP, which is the only
    // part of this that protects anything. `STORY_LOG_CAP` is 60, the Firestore
    // event `limit` is 40, `CANON_BUCKET_CAP` is 48.
    expect(storyLogRows, "storyLog crosses at or below STORY_LOG_CAP").toBeGreaterThan(60);
    // ⚠ EVENTS NEVER CROSS, AT ANY COUNT, and that is a REAL structural result
    // rather than a fixture artefact: `STEP_EVENT_WINDOW` slices the render to
    // the last 20 rows, so a caller sending 4,000 events renders the same bytes
    // as one sending 20. The Firestore `limit(40)` bounds what the app loads;
    // the render window bounds what any caller can make of it. -1 is the
    // sentinel for "did not cross at 4,000".
    expect(eventRows, "the event window makes the count term unbounded-safe").toBe(-1);
    expect(canonRows, "one canon bucket crosses at or below CANON_BUCKET_CAP").toBeGreaterThan(48);
    // ⚠ THE ROSTER HAS NO CODE CAP AT ALL, so this is not headroom — it is the
    // number to watch. LIFE-CAST-3 expects ~30 named people by chapter five,
    // and `<npcRoster>` + `<npcMemory>` render every one of them.
    expect(rosterRows, "the roster is uncapped; report where it crosses").toBeGreaterThan(30);
  });

  it("SRV-PROMPT-9 — an over-cap payload is a `too-large` REJECT, not a truncation", () => {
    // The gate itself, exercised. `PRACTICE-OWN-6` caps the SUM after assembly,
    // and this call is the one where being wrong costs the player the turn — so
    // the refusal has to be the documented one rather than a silent slice.
    const r = resolveServerPrompt(
      "life_step",
      spec({
        storyLogEntries: Array.from({ length: 400 }, (_, i) => line(400, `happened ${i}`)),
      }),
    );
    expect(r.status).toBe("reject");
    if (r.status !== "reject") throw new Error("unreachable");
    expect(r.code).toBe("too-large");
  });
});
