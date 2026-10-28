import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PRACTICE-OWN-9 — the spec is REBUILT field by field, and this file is the
 * only place that can see it.
 *
 * ⚠ WRITTEN BECAUSE A MUTATION SURVIVED. Forwarding `s.cast` and `s.fronts`
 * WHOLE — validating every element and then assigning the raw objects through
 * — passed every other test in this batch, including the one named "an extra
 * key on a nested ELEMENT cannot reach a template". It passed because
 * `buildBioPrompt` reads two fields per element today, so nothing extra can
 * reach a template *yet*. The rebuild is what keeps that true on the day
 * someone adds a third field to the builder: an extra wire key is then already
 * sitting in the object it renders from.
 *
 * That is not observable through `resolveServerPrompt`'s return value, which is
 * two strings. So the builder is STUBBED here and the input it was handed is
 * asserted directly — which is the contract itself rather than a proxy for it.
 * The whole file mocks `../prompts/lifeBio`, which is why it is a file of its
 * own: `serverPromptSpec.test.ts` compares against the REAL builder and must
 * not have it replaced underneath.
 */
vi.mock("../prompts/lifeBio", () => ({
  bioSystemInstruction: vi.fn(() => "STUB-SI"),
  buildBioPrompt: vi.fn(() => "STUB-PROMPT"),
}));

import { buildBioPrompt } from "../prompts/lifeBio";
import { resolveServerPrompt } from "../prompts/serverPromptSpec";

const buildBioPromptMock = buildBioPrompt as unknown as ReturnType<typeof vi.fn>;

const SPEC = {
  kind: "life_bio",
  characterName: "Alice",
  practiceLanguage: "French",
  nativeLanguage: "English",
  worldSeedKey: "heist",
  worldMode: "realistic",
} as Record<string, unknown>;

/** The single input `resolveServerPrompt` handed the builder. */
const handed = (): Record<string, unknown> =>
  buildBioPromptMock.mock.calls[0]![0] as Record<string, unknown>;

const resolve = (spec: Record<string, unknown>) => resolveServerPrompt(spec.kind, spec);

beforeEach(() => {
  buildBioPromptMock.mockClear();
});

describe("PRACTICE-OWN-9 — life_bio hands the builder ONLY the spec's own fields", () => {
  it("the top level is rebuilt: an unknown key never reaches the builder", () => {
    const r = resolve({ ...SPEC, worldId: "w1", systemLanguage: "English", note: "hello" });
    expect(r.status).toBe("built");
    expect(handed()).toEqual({
      characterName: "Alice",
      practiceLanguage: "French",
      nativeLanguage: "English",
      worldSeedKey: "heist",
      worldMode: "realistic",
    });
  });

  it("every cast ELEMENT is rebuilt to {name, known} and nothing else", () => {
    resolve({
      ...SPEC,
      story: {
        title: "T",
        tone: "t",
        situation: "s",
        cast: [
          {
            name: "Bébert",
            known: "Runs the roster office.",
            id: "p1",
            tier: "principal",
            voice: "clipped",
            standing: 3,
            wants: "w",
            nextMove: "n",
            limit: "l",
            routine: "r",
            wrongAbout: { aboutId: "r1", believes: "b" },
            ties: [{ id: "r1", how: "h" }],
          },
        ],
        fronts: [],
      },
    });
    const story = handed().story as { cast: Record<string, unknown>[] };
    expect(story.cast).toEqual([{ name: "Bébert", known: "Runs the roster office." }]);
    expect(Object.keys(story.cast[0]!).sort()).toEqual(["known", "name"]);
  });

  it("every front ELEMENT is rebuilt to {agenda, resolved?} — the clock never travels", () => {
    // LIFE-FRONT-1.1 withholds `clock.consequence` from prompts on measured
    // evidence: a model handed "3/6 → the bakery is sold" writes a countdown.
    resolve({
      ...SPEC,
      story: {
        title: "T",
        tone: "t",
        situation: "s",
        cast: [],
        fronts: [
          {
            agenda: "The lease is being bought out.",
            resolved: null,
            id: "f1",
            name: "The lease",
            driverId: "p1",
            kind: "obligation",
            scope: "saga",
            clock: { filled: 3, size: 8, consequence: "the yard changes hands", peak: 3 },
          },
        ],
      },
    });
    const story = handed().story as { fronts: Record<string, unknown>[] };
    expect(story.fronts).toEqual([
      { agenda: "The lease is being bought out.", resolved: null },
    ]);
    expect(Object.keys(story.fronts[0]!).sort()).toEqual(["agenda", "resolved"]);
  });

  it("the story object itself is rebuilt — an extra key beside cast/fronts is dropped", () => {
    resolve({
      ...SPEC,
      story: { title: "T", tone: "t", situation: "s", cast: [], fronts: [], premise: "P" },
    });
    expect(Object.keys(handed().story as object).sort()).toEqual([
      "cast",
      "fronts",
      "situation",
      "title",
      "tone",
    ]);
  });

  it("an ABSENT `resolved` stays absent — the rebuild invents no null", () => {
    // Absent and `null` are both LIVE to the builder's `== null` filter, so this
    // is not observable in the rendered prompt at all. It is asserted here
    // because a rebuild that normalised one into the other would be changing the
    // wire contract silently, and this is the only place the difference shows.
    resolve({
      ...SPEC,
      story: {
        title: "T",
        tone: "t",
        situation: "s",
        cast: [],
        fronts: [{ agenda: "a" }, { agenda: "b", resolved: null }],
      },
    });
    const fronts = (handed().story as { fronts: Record<string, unknown>[] }).fronts;
    expect("resolved" in fronts[0]!).toBe(false);
    expect("resolved" in fronts[1]!).toBe(true);
    expect(fronts[1]!.resolved).toBeNull();
  });

  it("an optional top-level field is ABSENT, never present-and-undefined", () => {
    resolve({
      kind: "life_bio",
      characterName: "Alice",
      practiceLanguage: "French",
      nativeLanguage: "English",
      worldSeedKey: "heist",
    });
    const input = handed();
    expect("worldMode" in input).toBe(false);
    expect("worldSeedText" in input).toBe(false);
    expect("story" in input).toBe(false);
  });

  it("the stub is actually wired — these assertions are not reading a real build", () => {
    // Non-vacuous: if the mock stopped applying, `handed()` would be reading the
    // REAL builder's argument, which is the same object — but a broken mock
    // would throw on `mock.calls` instead of quietly passing, and a mock that
    // silently no-op'd would leave the call log empty. Both are pinned.
    const r = resolve(SPEC);
    if (r.status !== "built") throw new Error("expected built");
    expect(r.prompt).toBe("STUB-PROMPT");
    expect(r.systemInstruction).toBe("STUB-SI");
    expect(buildBioPromptMock.mock.calls).toHaveLength(1);
  });
});
