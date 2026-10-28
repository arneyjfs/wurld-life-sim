import { describe, expect, it } from "vitest";
import {
  buildNpcProfileUserPrompt,
  NPC_PROFILE_RESPONSE_SCHEMA,
  NPC_PROFILE_SYSTEM_INSTRUCTION as SI,
} from "../prompts/lifeNpcProfile";

/**
 * SRV-PROMPT-8..13 batch 2 — the NPC profile prompt, now built by the server.
 *
 * THESE ASSERTIONS MOVED (SRV-PROMPT-3 / PRACTICE-OWN-8). They lived at
 * `src/lib/life/prompts/npcProfile.test.ts` against the client module that is
 * now deleted. Deleting that file without landing them here would have retired
 * this prompt's only assertions at the moment it became the only copy — which
 * is the failure `SRV-PROMPT-3` names in terms ("its tests moved rather than
 * dying with the file").
 *
 * The SCHEMA assertions are NEW here, and deliberately so: `PROFILE_SCHEMA` sat
 * inline in `src/lib/life/generateNpcProfile.ts` and travelled in the request
 * body. Per SRV-PROMPT-1 the prompt and the schema it constrains are ONE
 * artefact — owning the prompt while trusting a client-sent schema leaves the
 * half that decides what the model may SAY inside the app bundle, where only an
 * App Store review can correct it.
 */

const INPUT = {
  name: "Sophie",
  role: "café owner",
  worldVibe: "modern city",
  sagaPremise: "You moved to Lyon to reopen your late aunt’s café.",
};

describe("npcProfile SI — LIFE-NPC-7 profile description contract", () => {
  it("LIFE-NPC-7 — instructs a strict JSON { \"description\": string } output", () => {
    expect(SI).toContain('{ "description": string }');
    expect(SI).toContain("No prose");
  });

  it("LIFE-NPC-7 — demands SECOND-PERSON voice addressing the player", () => {
    expect(SI).toContain("Second person");
    expect(SI).toContain("Your upstairs neighbour");
  });

  it("LIFE-NPC-7 — is spoiler-free: no future events, no foreshadowing", () => {
    expect(SI).toContain("SPOILER-FREE");
    expect(SI).toContain("never the future");
    expect(SI).toContain("NEVER foreshadow");
  });

  it("LIFE-NPC-7 — caps the length at 1-2 sentences", () => {
    expect(SI).toContain("1-2 sentences");
  });
});

describe("buildNpcProfileUserPrompt — LIFE-NPC-7 prompt assembly", () => {
  it("LIFE-NPC-7 — includes name, role, worldVibe and sagaPremise when all present", () => {
    const p = buildNpcProfileUserPrompt(INPUT);
    expect(p).toContain('name="Sophie"');
    expect(p).toContain("<role>café owner</role>");
    expect(p).toContain("<worldVibe>modern city</worldVibe>");
    expect(p).toContain("<sagaPremise>");
    expect(p).toContain("reopen your late aunt");
  });

  it("LIFE-NPC-7 — omits the role and sagaPremise tags when absent", () => {
    const p = buildNpcProfileUserPrompt({ name: "Léo", worldVibe: "noir city" });
    expect(p).not.toContain("<role>");
    expect(p).not.toContain("<sagaPremise>");
    expect(p).toContain('name="Léo"');
    expect(p).toContain("<worldVibe>noir city</worldVibe>");
  });

  it("LIFE-NPC-8 — emits <archetype>, and the SI makes it beat the saga vibe", () => {
    // The reported bug: with no archetype, the model had only a French name
    // and "theatrical espionage" and produced "your formidable vocal coach and
    // mentor" for a florist. The archetype is the field that carries the
    // answer, so it has to be BOTH present and authoritative — a premise about
    // grand theatre will otherwise out-shout a line about selling flowers.
    const p = buildNpcProfileUserPrompt({
      name: "Madame Roux",
      role: "The Handler",
      archetype: "The Handler — Madame Roux, a florist who delivers coded scripts.",
      worldVibe: "Lush, high-stakes theatrical espionage",
      sagaPremise: "Jimothée is the city’s most beloved stage actor…",
    });
    expect(p).toContain("<archetype>");
    expect(p).toContain("a florist who delivers coded scripts");
    // Ordered before <role> and <worldVibe> so the most specific fact is read
    // first, not last.
    expect(p.indexOf("<archetype>")).toBeLessThan(p.indexOf("<worldVibe>"));
    expect(SI).toMatch(/OVERRIDES any impression/i);
  });

  it("LIFE-NPC-8 — with nothing known, the SI asks for vague-but-true", () => {
    // The fallback must be silence rather than invention: a specific invented
    // job renders with exactly as much confidence as a real one.
    const p = buildNpcProfileUserPrompt({ name: "A stranger", worldVibe: "noir city" });
    expect(p).not.toContain("<archetype>");
    expect(SI).toMatch(/do not invent a job, a title, or a relationship/i);
  });

  it("LIFE-NPC-7 — escapes angle brackets / quotes in the name", () => {
    // The escaping moved WITH the prompt, and that is the point of moving it:
    // `name`, `role`, `archetype` and `sagaPremise` are model-authored world
    // state, and the tags around them are the only thing separating data from
    // instruction in this prompt.
    const p = buildNpcProfileUserPrompt({ name: 'A<b>"c"', worldVibe: "x" });
    expect(p).not.toContain("<b>");
    expect(p).toContain("&lt;b&gt;");
    expect(p).toContain("&quot;c&quot;");
  });

  it("LIFE-NPC-7 — closes every tag it opens, for every field combination", () => {
    // A cheap structural backstop: an unbalanced tag turns the rest of the
    // prompt into the contents of the field before it.
    const p = buildNpcProfileUserPrompt({
      ...INPUT,
      archetype: "a florist",
    });
    for (const tag of ["role", "worldVibe", "sagaPremise", "archetype"]) {
      expect(p.split(`<${tag}>`).length, tag).toBe(2);
      expect(p.split(`</${tag}>`).length, tag).toBe(2);
    }
  });
});

describe("NPC_PROFILE_RESPONSE_SCHEMA — SRV-PROMPT-1, the schema travels with the prompt", () => {
  it("LIFE-NPC-7 — constrains the answer to one required `description` string", () => {
    // Prevention over detection, measured 2026-08-04: a profile came back as a
    // valid object followed by more text and died on `SyntaxError: Unexpected
    // non-whitespace character after JSON at position 142`, so that character's
    // avatar card had no bio at all. A constrained response cannot produce the
    // trailing text; the tolerant parse on the client stays as the belt.
    expect(NPC_PROFILE_RESPONSE_SCHEMA).toEqual({
      type: "OBJECT",
      properties: { description: { type: "STRING" } },
      required: ["description"],
    });
  });

  it("SRV-PROMPT-1 — the SI's stated output shape and the schema name the SAME key", () => {
    // Asserted against each other rather than each against a literal: a literal
    // on both sides agrees with nothing, and the prompt and the schema are the
    // two halves of one artefact.
    const required = (NPC_PROFILE_RESPONSE_SCHEMA as { required: string[] }).required;
    for (const key of required) expect(SI, key).toContain(`"${key}"`);
  });
});

describe("SRV-PROMPT-9 — assembled size against the byte cap", () => {
  // THE GATE. The legacy path capped `prompt` and `systemInstruction`
  // SEPARATELY against MAX_PROMPT_BYTES; the built path caps their SUM after
  // assembly, so a category that fits today can stop fitting on the day it
  // moves with no change to its content. Measured before the migration was
  // written, not after.
  //
  // This is the largest of the three batch-2 kinds, because `archetype` and
  // `sagaPremise` are model-authored prose that NOTHING upstream bounds —
  // `sagaPremise` is `world.situation`, whose Zod schema is a bare
  // `z.string().optional()`. The server's own `too-large` check is what bounds
  // them, which is exactly what PRACTICE-OWN-6 exists for; this asserts the
  // realistic worst case leaves room for it to matter.
  const CAP = 65_536;
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");

  it("SRV-PROMPT-9 — SI + a generously-sized user prompt stay under a quarter of the cap", () => {
    const worst = buildNpcProfileUserPrompt({
      name: "x".repeat(120),
      role: "y".repeat(48),
      archetype: "a".repeat(2_000),
      worldVibe: "z".repeat(400),
      sagaPremise: "s".repeat(2_000),
    });
    expect(bytes(SI) + bytes(worst)).toBeLessThan(CAP / 4);
  });
});
