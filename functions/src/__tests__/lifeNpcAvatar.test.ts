import { describe, expect, it } from "vitest";
import {
  buildNpcAvatarUserPrompt,
  NPC_AVATAR_SYSTEM_INSTRUCTION as DRAW_SI,
} from "../prompts/lifeNpcAvatar";
import {
  AVATAR_PART_OPTIONS,
  AVATAR_PARAMS_SYSTEM_INSTRUCTION as PARAMS_SI,
  buildAvatarParamsUserPrompt,
} from "../prompts/lifeAvatarParams";

/**
 * SRV-PROMPT-8..13 batch 2 — the two avatar prompts, now built by the server.
 *
 * ⚠ THESE ASSERTIONS ARE NEW, NOT MOVED, and that is worth saying plainly.
 * `src/lib/life/prompts/npcAvatar.ts` and `.../avatarParams.ts` had NO test
 * files of their own — the only coverage either prompt ever had was
 * `avatar/assemble.test.ts` exercising the parts the second one advertises.
 * So this batch does not just relocate coverage for these two, it lands the
 * first coverage they have had, at the point where they became the only copy.
 *
 * The PARTS TABLE is the interesting one. `AVATAR_PART_OPTIONS` is the slot-name
 * list rendered into the params SI, and it is a SECOND live copy of the keys of
 * `src/lib/life/avatar/parts.ts` — which cannot move, because `assembleAvatar`
 * draws the portrait client-side. That duplication is disclosed rather than
 * hidden and guarded from the other side by `src/lib/life/avatar/parts.test.ts`.
 */

const INPUT = {
  name: "Madame Roux",
  role: "florist who delivers coded scripts",
  worldVibe: "Lush, high-stakes theatrical espionage",
};

describe("npcAvatar SI — LIFE-NPC-2 direct-draw contract", () => {
  it("LIFE-NPC-2 — pins the SVG root and the 200x200 viewBox the slot expects", () => {
    expect(DRAW_SI).toContain('viewBox="0 0 200 200"');
    expect(DRAW_SI).toContain("Return ONLY the SVG");
  });

  it("LIFE-NPC-2 — forbids the tags the sanitiser would strip anyway", () => {
    // Belt and braces: `sanitiseSvg` drops these client-side, but a prompt that
    // asks for them wastes the generation that produced them.
    for (const banned of ["<script>", "<image href>", "external URLs"]) {
      expect(DRAW_SI, banned).toContain(banned);
    }
  });

  it("LIFE-NPC-2 — carries the reported second-mouth defect rule", () => {
    // A curve between the eyes and the mouth reads as a second mouth or a
    // moustache. That is a defect that shipped and was visible on screen, so
    // the rule is contract text rather than style advice.
    expect(DRAW_SI).toContain("SECOND MOUTH");
    expect(DRAW_SI).toContain("exactly ONE mouth");
  });

  it("LIFE-NPC-2 — tells the model to read <role> and <worldVibe> for clothing", () => {
    expect(DRAW_SI).toContain("<role>");
    expect(DRAW_SI).toContain("<worldVibe>");
  });
});

describe("buildNpcAvatarUserPrompt — LIFE-NPC-2 prompt assembly", () => {
  it("LIFE-NPC-2 — names the character, the role and the world vibe", () => {
    const p = buildNpcAvatarUserPrompt(INPUT);
    expect(p).toContain('name="Madame Roux"');
    expect(p).toContain("<role>florist who delivers coded scripts</role>");
    expect(p).toContain("<worldVibe>Lush, high-stakes theatrical espionage</worldVibe>");
    expect(p).toContain("Draw the avatar.");
  });

  it("LIFE-NPC-8 — omits the <role> tag entirely when no role is known", () => {
    // Both branches, because the role is the field LIFE-NPC-8 was written about:
    // an NPC drawn without one is drawn "without anyone knowing she sells
    // flowers", and an empty `<role></role>` is a different prompt again.
    const p = buildNpcAvatarUserPrompt({ name: "Léo", worldVibe: "noir city" });
    expect(p).not.toContain("<role>");
    expect(p).toContain('name="Léo"');
    expect(p).toContain("<worldVibe>noir city</worldVibe>");
  });

  it("LIFE-NPC-2 — escapes angle brackets and quotes out of model-authored fields", () => {
    const p = buildNpcAvatarUserPrompt({
      name: 'A<b>"c"',
      role: "<role>nested</role>",
      worldVibe: "x & y",
    });
    expect(p).not.toContain("<b>");
    expect(p).toContain("&lt;b&gt;");
    expect(p).toContain("&quot;c&quot;");
    expect(p).toContain("&amp;");
    // The role tag is opened and closed exactly once — an unescaped `</role>`
    // inside the value would close it early and leave the rest as free prose.
    expect(p.split("</role>").length).toBe(2);
  });
});

describe("avatarParams SI — LIFE-NPC-2b parts-first contract", () => {
  it("LIFE-NPC-2b — states the exact JSON the assembler parses", () => {
    expect(PARAMS_SI).toContain('{"bg":"#hex","skin":"#hex"');
    expect(PARAMS_SI).toContain("no markdown fence");
  });

  it("LIFE-NPC-2b — advertises EVERY slot's options, from the server's own table", () => {
    // The advertised names are a CONTRACT (LIFE-NPC-2b): the prompt lists them
    // and stored avatars replay them. A slot missing from the SI is a slot the
    // model will never fill correctly, and the fallback is the ~8x dearer
    // direct draw.
    for (const [slot, names] of Object.entries(AVATAR_PART_OPTIONS)) {
      expect(PARAMS_SI, slot).toContain(`${slot}: ${names.join(" | ")}`);
    }
  });

  it("LIFE-NPC-2b — keeps the explicit fallback signal the client branches on", () => {
    // `{"fallback": true}` is not decoration: `tryPartsAvatar` reads it and
    // routes to the direct draw. Dropping it from the SI would leave the model
    // approximating a character the library cannot do.
    expect(PARAMS_SI).toContain('{"fallback": true}');
    expect(PARAMS_SI).toContain("Prefer a good approximation over falling back");
  });

  it("LIFE-NPC-2b — every advertised slot appears in the output shape line", () => {
    // Asserted against each other rather than against a literal list: the shape
    // line and the options block are two halves of one instruction, and a slot
    // in one but not the other is a slot the model cannot answer.
    const shape = PARAMS_SI.split("\n").find((l) => l.startsWith('{"bg"')) ?? "";
    for (const slot of Object.keys(AVATAR_PART_OPTIONS)) {
      expect(shape, slot).toContain(`"${slot}"`);
    }
  });
});

describe("buildAvatarParamsUserPrompt — LIFE-NPC-2b prompt assembly", () => {
  it("LIFE-NPC-2b — names the character, the role and the world vibe", () => {
    const p = buildAvatarParamsUserPrompt(INPUT);
    expect(p).toContain('name="Madame Roux"');
    expect(p).toContain("<role>florist who delivers coded scripts</role>");
    expect(p).toContain("<worldVibe>Lush, high-stakes theatrical espionage</worldVibe>");
    expect(p).toContain("Choose this character's parts.");
  });

  it("LIFE-NPC-8 — omits the <role> tag entirely when no role is known", () => {
    const p = buildAvatarParamsUserPrompt({ name: "Léo", worldVibe: "noir city" });
    expect(p).not.toContain("<role>");
    expect(p).toContain("<worldVibe>noir city</worldVibe>");
  });

  it("LIFE-NPC-2b — the user prompt does NOT repeat the parts table", () => {
    // The table is ~1.6 KiB and belongs in the SI, which is the same bytes on
    // every call. Repeating it per call would pay for it twice.
    const p = buildAvatarParamsUserPrompt(INPUT);
    expect(p).not.toContain("witchHat");
    expect(p.length).toBeLessThan(400);
  });
});

describe("SRV-PROMPT-9 — assembled size against the byte cap", () => {
  // THE GATE. The legacy path capped `prompt` and `systemInstruction`
  // SEPARATELY against MAX_PROMPT_BYTES; the built path caps their SUM after
  // assembly. A category that fits today can therefore stop fitting on the day
  // it moves, with no change to its content. Measured before the migration was
  // written, not after.
  const CAP = 65_536;
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");

  it("SRV-PROMPT-9 — life_npc_avatar sits far under the cap, worst case included", () => {
    // Worst case: every field at a length nothing upstream bounds. `role` is
    // capped at 48 chars by `npcRole.MAX_RELATIONSHIP_CHARS`; `name` and
    // `worldVibe` are model-authored with no cap at all, so they are stretched.
    const worst = buildNpcAvatarUserPrompt({
      name: "x".repeat(120),
      role: "y".repeat(48),
      worldVibe: "z".repeat(400),
    });
    expect(bytes(DRAW_SI) + bytes(worst)).toBeLessThan(CAP / 8);
  });

  it("SRV-PROMPT-9 — life_npc_avatar_params sits far under the cap, worst case included", () => {
    const worst = buildAvatarParamsUserPrompt({
      name: "x".repeat(120),
      role: "y".repeat(48),
      worldVibe: "z".repeat(400),
    });
    expect(bytes(PARAMS_SI) + bytes(worst)).toBeLessThan(CAP / 8);
  });
});
