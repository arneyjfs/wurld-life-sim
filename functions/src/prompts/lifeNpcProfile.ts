/**
 * LIFE-NPC-7 — the NPC profile-description generator, owned by the server.
 *
 * Persistent NPCs get a 1-2 sentence blurb that renders on the avatar card when
 * the player taps their portrait — "who they are + how they fit into your
 * story". Second person, warm, SPOILER-FREE.
 *
 * ── WHY IT LIVES HERE NOW (SRV-PROMPT-8..13, batch 2) ──────────────────────
 *
 * It was `src/lib/life/prompts/npcProfile.ts`, sent up with every call.
 * `capacitor.config.ts` sets `webDir: 'dist'` with no `server.url`, so a native
 * binary freezes its JS at build time: a prompt in the bundle can only be
 * corrected by an App Store review, while the identical prompt in `functions/`
 * is one `deploy:prod:functions` away. Prompts are the part of this app most
 * likely to need correcting after release (§6.7).
 *
 * The bytes moved UNCHANGED. A reworded prompt would have made the migration
 * and a quality change one indivisible diff, and this is an unmeasured
 * surface — `docs/specs/life-sim.md` LIFE-NPC-8 records that the current SI
 * wording was itself the fix for a mis-described character.
 *
 * ── THE SCHEMA CAME WITH IT (SRV-PROMPT-1) ─────────────────────────────────
 *
 * `NPC_PROFILE_RESPONSE_SCHEMA` was `PROFILE_SCHEMA`, declared inline in
 * `src/lib/life/generateNpcProfile.ts` and sent in the request body. Prompt and
 * schema are ONE artefact: the schema is the half that decides what the model
 * may SAY, so shipping the prompt server-side while trusting a client-sent
 * schema leaves half the tuning surface frozen inside the app bundle.
 *
 * NO `cacheSlot`, and this one is a cost decision rather than a style one. The
 * SI is a byte-constant global, which is the FIRST of `explicitSiCache.ts`'s two
 * conditions — but the second is call rate, and a profile is generated roughly
 * once per NPC ever. That is nowhere near the ~5.8 calls/hour break-even
 * flash-lite needs per distinct cache, and below it caching costs strictly more
 * than not caching. `explicitSiCache.ts` already says exactly this about the
 * two avatar kinds; the profile is the same shape.
 */
import { escapeAttr, escapeText } from "./lifeNpcXml";

/**
 * The fields the profile prompt reads. FLAT and rebuilt field-by-field on the
 * way in, so an extra key on the wire cannot reach the template.
 *
 * Every one of these is model-authored WORLD STATE rather than instruction:
 * `archetype` comes from the turn's own `introduces[].note` or the saga's
 * `keyArchetypes`, `sagaPremise` is `world.situation`. Carried but not trusted
 * — the same standing as the planner's per-slot briefing (PRACTICE-OWN-9) —
 * which is why the tags around them are escaped here rather than on the client.
 */
export type NpcProfilePromptInput = {
  /** Display name ("Sophie", "Marc the Boulanger"). */
  name: string;
  /** Short role / relationship ("café owner", "rival baker",
   *  "elderly neighbour"). Drives how the character is framed. */
  role?: string | null;
  /** World vibe — inherited from the world's saga tone / seed. Sets
   *  the register (modern, noir, fantasy, sci-fi). */
  worldVibe: string;
  /** LIFE-NPC-8: the fuller "who they are" line — the turn's own
   *  `introduces[].note` and/or the saga archetype that names this character
   *  ("The Handler — Madame Roux, a florist who delivers coded scripts…").
   *  This is the field that carries the ANSWER; `role` is only a label.
   *  Without it the model has a name and a genre, and invents the rest. */
  archetype?: string | null;
  /** The saga premise, when the world has one — lets the profile place
   *  the character inside the larger story without spoiling it. */
  sagaPremise?: string | null;
};

export const NPC_PROFILE_SYSTEM_INSTRUCTION = [
  `You write a one-or-two sentence profile of a character in a language-learning life story. The player sees this the moment they tap the character's avatar — it tells them who this person is and how they fit into the player's life.`,
  ``,
  `OUTPUT:`,
  `Return ONE JSON object and nothing else: { "description": string }. No prose, no markdown fences, no extra keys.`,
  ``,
  `VOICE:`,
  `Second person — address the PLAYER directly. Frame the character in relation to the player wherever it's natural: "Your upstairs neighbour, a retired chef who…", "A colleague at the gallery who…", "The barista who always remembers your order.". Warm, concrete, specific.`,
  ``,
  `LENGTH:`,
  `1-2 sentences. This is a glance, not a biography. One vivid detail beats three vague ones.`,
  ``,
  `SPOILER-FREE:`,
  `Describe who they are RIGHT NOW — their role, their bearing, their connection to the player. NEVER foreshadow or reveal future events, plot twists, hidden agendas, betrayals, or how their arc resolves. No "destined to", no "little do you know", no "will become". Present and past only, never the future.`,
  ``,
  `STYLE:`,
  `Ground the profile in <archetype> and <role> — that is WHO THIS PERSON IS, and it OVERRIDES any impression the rest of the context gives you. If <archetype> says they sell flowers, they sell flowers, however grand the saga around them sounds. Match <worldVibe> for tone only. If a <sagaPremise> is present, place the character inside that story — but reveal nothing the player hasn't met yet.`,
  ``,
  `If NEITHER <archetype> NOR <role> is present, say what you can from the name and the world alone and keep it SHORT — do not invent a job, a title, or a relationship to the player that nothing here supports. A vague true line beats a specific invented one.`,
  ``,
  `Return only the JSON object.`,
].join("\n");

/**
 * LIFE-NPC-7 — the structural half of "return one JSON object".
 *
 * `responseMimeType: 'application/json'` alone only asks for JSON; it does not
 * bound what comes AFTER the first object. Measured in a playthrough
 * (2026-08-04): one profile came back as a valid object followed by more text
 * and died on `SyntaxError: Unexpected non-whitespace character after JSON at
 * position 142`, so that character's avatar card had no bio at all.
 *
 * Prevention over detection: a constrained response cannot produce the trailing
 * text, rather than a parser learning to skip it. The tolerant parse on the
 * client stays as the belt to these braces, because a schema is a strong
 * request and not a guarantee.
 */
export const NPC_PROFILE_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: { description: { type: "STRING" } },
  required: ["description"],
};

export function buildNpcProfileUserPrompt(input: NpcProfilePromptInput): string {
  const parts: string[] = [];
  parts.push(`<character name="${escapeAttr(input.name)}"/>`);
  // LIFE-NPC-8 — <archetype> FIRST, before <role> and <worldVibe>, so the most
  // specific fact is read first rather than last. A premise about grand theatre
  // otherwise out-shouts a line about selling flowers.
  if (input.archetype) {
    parts.push(`<archetype>${escapeText(input.archetype)}</archetype>`);
  }
  if (input.role) {
    parts.push(`<role>${escapeText(input.role)}</role>`);
  }
  parts.push(`<worldVibe>${escapeText(input.worldVibe)}</worldVibe>`);
  if (input.sagaPremise) {
    parts.push(`<sagaPremise>${escapeText(input.sagaPremise)}</sagaPremise>`);
  }
  parts.push(
    `Write the profile: 1-2 sentences, second person, spoiler-free. Return only the JSON object.`,
  );
  return parts.join("\n\n");
}
