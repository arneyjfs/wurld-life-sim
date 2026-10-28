import { describe, expect, it } from "vitest";
import {
  BACKDROP_SYSTEM_INSTRUCTION,
  BACKDROP_TIMES_OF_DAY,
  BACKDROP_TIME_OF_DAY_GLOSS,
  buildBackdropUserPrompt,
  renderTimeOfDayForBackdrop,
} from "../prompts/lifeBackdrop";

/**
 * SRV-PROMPT-8..13 batch 1 — the backdrop USER prompt, now built by the server.
 *
 * THESE ASSERTIONS MOVED (SRV-PROMPT-3 / PRACTICE-OWN-8). `buildBackdropPrompt`
 * lived at `src/lib/life/prompts/backdrop.ts` and had no test file of its own;
 * what coverage it had was spread across `src/lib/life/generateBackdrop.test.ts`
 * (which asserted the CALL, not the text) and the two backdrop-clause cases in
 * `src/lib/life/timeOfDay.test.ts`. Deleting the client module without landing
 * them here would have retired this prompt's only assertions at the moment it
 * became the only copy.
 *
 * The system instruction was ALREADY server-owned (LIFE-BACKDROP-30); only the
 * user prompt moved in this batch. That is why the SI assertions here are about
 * its IDENTITY — the explicit context cache (LIFE-BACKDROP-14) is keyed on a
 * digest of these exact bytes, so a change to them is a change to which cache
 * record is served, not a cosmetic edit.
 */

const D = {
  locationType: "fruit_market",
  vibe: "modern_city",
  persistent: true,
  practice: "French",
};

describe("SRV-PROMPT-8..13 — server-built backdrop user prompt", () => {
  it("LIFE-BACKDROP-5 — names the location, the vibe and the practice language", () => {
    const out = buildBackdropUserPrompt(D);
    expect(out).toContain("Generate a scene SVG.");
    // Underscores are unfolded for the model — `fruit_market` reads as a token,
    // `fruit market` as a place.
    expect(out).toContain("Location: fruit market.");
    expect(out).toContain("World vibe: modern city.");
    expect(out).toContain(
      "Practice language (ALL text inside the SVG must be in this language): French.",
    );
    expect(out).toContain("First-person camera; the player is NOT in the scene.");
  });

  it("LIFE-BACKDROP-5 — the persistent and transient branches say DIFFERENT things", () => {
    // Asserted BOTH ways. A test that only exercised `persistent: true` would
    // pass against a builder that had lost the branch entirely, and the branch
    // is the one that decides how much detail the model is asked to spend.
    const persistent = buildBackdropUserPrompt({ ...D, persistent: true });
    const transient = buildBackdropUserPrompt({ ...D, persistent: false });

    expect(persistent).toContain("This scene is PERSISTENT");
    expect(persistent).toContain("render it with detail and personality");
    expect(persistent).not.toContain("TRANSIENT");

    expect(transient).toContain("This scene is TRANSIENT");
    expect(transient).toContain("Keep it simple and atmospheric");
    expect(transient).not.toContain("PERSISTENT");
  });

  it("LIFE-TIME-1 — the time-of-day clause is present, and OVERRIDES the vibe", () => {
    // THE BUG this clause exists for: `vibe: "ominous"` steered the SVG
    // generator dark with nothing to contradict it, so a bay at mid-morning
    // came back as night. The clause has to outrank mood explicitly, not merely
    // sit beside it.
    const out = buildBackdropUserPrompt({ ...D, timeOfDay: "morning" });
    expect(out).toContain("Time of day: mid-morning");
    expect(out).toContain("overrides any mood in the vibe");
    expect(out).toContain("ominous place at mid-morning is still brightly lit");
  });

  it("LIFE-TIME-1 — no timeOfDay means NO clause, not an empty one", () => {
    // `.filter(Boolean)` is load-bearing: a legacy descriptor has no clock, and
    // an empty clause would leave a double space where the sentence was.
    const out = buildBackdropUserPrompt(D);
    expect(out).not.toContain("Time of day:");
    expect(out).not.toContain("  ");
  });

  it("LIFE-TIME-1 — every time of day has a gloss; a missing one would render `undefined`", () => {
    for (const t of BACKDROP_TIMES_OF_DAY) {
      expect(renderTimeOfDayForBackdrop(t), t).not.toContain("undefined");
      expect(buildBackdropUserPrompt({ ...D, timeOfDay: t }), t).not.toContain("undefined");
      expect(BACKDROP_TIME_OF_DAY_GLOSS[t], t).toBeTruthy();
    }
  });

  it("LIFE-BACKDROP-2 — flavour rides the prompt when present and is absent when not", () => {
    // `flavour` is deliberately NOT part of the cache key (cosmetic variants
    // reuse one SVG) but it IS handed to the generator.
    const withFlavour = buildBackdropUserPrompt({ ...D, flavour: "bustling, rainy" });
    expect(withFlavour).toContain("Flavour cues: bustling, rainy.");
    expect(buildBackdropUserPrompt(D)).not.toContain("Flavour cues");
  });

  it("LIFE-BACKDROP-2 — the place LABEL never reaches the prompt", () => {
    // The descriptor carries `label` (and `labelNative`) for the cache key and
    // the location ribbon. The prompt has never used either, so the spec does
    // not carry them — a field on the wire that reaches nothing is a field
    // someone later wires INTO something.
    const out = buildBackdropUserPrompt(D);
    expect(out).not.toContain("Marché Bastille");
    expect(out.toLowerCase()).not.toContain("label");
  });

  it("SRV-PROMPT-9 — SI + user prompt together sit far under the byte cap", () => {
    // The gate this batch was measured against. The legacy path capped the two
    // SEPARATELY; the built path caps their SUM, so a category that fits today
    // can stop fitting on the day it moves with no change to its content.
    // Measured: 10,722 + ~1,000 = ~11.7 KiB against 65,536.
    const prompt = buildBackdropUserPrompt({
      ...D,
      timeOfDay: "evening",
      flavour: "low tide, gulls over the breakwater, fog rolling in off the water",
    });
    const sum =
      Buffer.byteLength(BACKDROP_SYSTEM_INSTRUCTION, "utf8") + Buffer.byteLength(prompt, "utf8");
    expect(sum).toBeLessThan(65_536 / 4);
  });
});
