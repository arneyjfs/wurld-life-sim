/**
 * LIFE-NPC-2b — the avatar PARAMS generator, owned by the server.
 *
 * The model does not draw the portrait — it DRESSES one, choosing a part per
 * slot from the fixed library and returning a tiny JSON the client assembles.
 * ~8x cheaper output than the direct draw (`lifeNpcAvatar.ts`), one art style
 * across every NPC, and structurally unable to emit broken SVG.
 *
 * ── WHY IT LIVES HERE NOW (SRV-PROMPT-8..13, batch 2) ──────────────────────
 *
 * It was `src/lib/life/prompts/avatarParams.ts`, sent up with every call. A
 * prompt in the bundle can only be corrected by an App Store review; the
 * identical prompt in `functions/` is one `deploy:prod:functions` away (§6.7).
 * The bytes moved UNCHANGED.
 *
 * NO `cacheSlot`: `explicitSiCache.ts` names this category explicitly as one it
 * will not cache — "a portrait renders roughly once per NPC ever, so the hourly
 * rate is not reliably above break-even" — and below break-even an explicit
 * cache costs strictly more than no cache.
 *
 * NO `responseSchema`, and that is a different decision from the profile's. The
 * client parses this answer with `ZAvatarParams`, a ZOD validator, which stays
 * client-side: a JSON schema CONSTRAINS the model, a Zod parse DEFENDS against
 * it, and those belong on opposite sides of the wire (the distinction
 * PRACTICE-OWN-10 draws for the card selector). The model's own escape hatch —
 * `{"fallback": true}` — also has to remain expressible, and a schema pinning
 * the eight slots would forbid it.
 *
 * ── ⚠ THE PART TABLE IS A SECOND LIVE COPY. DISCLOSED, NOT HIDDEN. ─────────
 *
 * `AVATAR_PART_OPTIONS` is the KEY SET of `src/lib/life/avatar/parts.ts`, which
 * CANNOT move here: that file is the SVG geometry, and `assembleAvatar` draws
 * the portrait on the client, which is the entire point of LIFE-NPC-2b. So the
 * names exist on both sides of the wire — the server needs them to tell the
 * model what is legal, the client needs the shapes behind them to draw.
 *
 * Shipping the list UP in the promptSpec instead was REJECTED: it is
 * interpolated verbatim into the system instruction below, so a client that
 * supplied it could write arbitrary text into the SI through it — the proxy
 * this migration exists to close, reached from the other direction
 * (SRV-PROMPT-12's point). Validating a client-sent list would need the server
 * to hold the table anyway.
 *
 * This duplication is the `PRACTICE-IMPORT-16` shape (two LIVE copies that must
 * agree), not the `PRACTICE-IMPORT-12` one (a mirror nobody reads), and unlike
 * batch 1's time-of-day glosses IT HAS NO EXPIRY — no later batch can merge
 * them, because drawing is client-side by design. Drift is silent in both
 * directions and expensive in one: a name here that the client cannot draw
 * sends every such call to the ~8x dearer direct draw. Guarded from the client
 * side by `src/lib/life/avatar/parts.test.ts`, which asserts the two tables
 * against each other rather than each against a literal.
 *
 * ADDING A PART: add it to `parts.ts` AND here, in the same position. Slot
 * names are a contract (stored avatars replay them), so names may be added but
 * never renamed or removed.
 */
import { npcCharacterBlocks } from "./lifeNpcXml";
import type { NpcAvatarPromptInput } from "./lifeNpcAvatar";

/** Option names per slot — mirrors `OPTIONS` in `src/lib/life/avatar/parts.ts`.
 *  See the header: this is a live duplicate, guarded by `parts.test.ts`. */
export const AVATAR_PART_OPTIONS = {
  eyes: ["almond", "wide", "sleepy", "happy", "squint", "sparkle", "dot"],
  brows: ["none", "neutral", "raised", "furrowed", "worried"],
  mouth: [
    "smile", "slight", "neutral", "frown", "smirk",
    "pout", "grin", "laugh", "open", "grimace",
  ],
  facialHair: [
    "none", "stubble", "mustache", "goatee",
    "shortBeard", "fullBeard", "longBeard", "muttonChops",
  ],
  hair: [
    "bald", "buzz", "short", "cropped", "sidePart", "fringe", "bob",
    "longStraight", "waves", "curly", "afro", "bun", "topKnot", "ponytail",
    "pigtails", "braids", "dreads", "spiky", "mohawk",
  ],
  headwear: [
    "none", "witchHat", "cap", "beanie", "bandana", "crown", "helmet", "hood",
    "strawHat", "topHat", "chefHat", "beret", "turban", "flowerCrown", "headband",
  ],
  outfit: [
    "plain", "tee", "sweater", "shirtTie", "suit", "labCoat", "robe", "cloak",
    "apron", "overalls", "armour", "uniform", "hoodie", "dress", "tank", "scarf",
  ],
  accessory: [
    "none", "glasses", "roundGlasses", "sunglasses", "eyepatch",
    "earrings", "freckles", "monocle", "scar",
  ],
} as const;

const list = (k: keyof typeof AVATAR_PART_OPTIONS): string =>
  `${k}: ${AVATAR_PART_OPTIONS[k].join(" | ")}`;

export const AVATAR_PARAMS_SYSTEM_INSTRUCTION = [
  `You style a small, cute character portrait by CHOOSING PARTS from a fixed library. You do NOT draw — you pick the options + colours that best capture the person and their role.`,
  ``,
  `OUTPUT — return ONLY this JSON (no prose, no markdown fence):`,
  `{"bg":"#hex","skin":"#hex","hair":{"style":"…","color":"#hex"},"facialHair":{"style":"…","color":"#hex"},"eyes":"…","brows":"…","mouth":"…","headwear":{"style":"…","color":"#hex"},"outfit":{"style":"…","color":"#hex"},"accessory":"…"}`,
  ``,
  `Every "style" MUST be one of these exact values:`,
  list("hair"),
  list("facialHair"),
  list("eyes"),
  list("brows"),
  list("mouth"),
  list("headwear"),
  list("outfit"),
  list("accessory"),
  ``,
  `GUIDANCE:`,
  `• Read <role> + <worldVibe> and pick the combination that makes THIS person unmistakable at a glance — a witch: witchHat + robe + a knowing mouth; a tired office worker: shirtTie + sleepy or furrowed brows + a flat mouth; a fisherman: cap + a full beard + apron (oilskins).`,
  `• USE THE HEADWEAR AND OUTFIT TOGETHER when a role implies both — a knight wears helmet AND armour, a chef wears chefHat AND apron, a monarch wears crown AND cloak. Leaving the head bare wastes the strongest signal.`,
  `• Use COLOUR to carry the role (a witch's purple/black, a fisherman's yellow oilskins, a knight's steel grey). bg is a soft complementary pastel — never the same hue as the hair or outfit.`,
  `• Match hair style/colour and skin tone to age + character. Use facialHair "none" unless it fits. Use accessory only when it adds character (glasses, freckles, an eyepatch).`,
  `• Sameness is worse than a bold choice: pick the distinctive option, not the safe one.`,
  ``,
  `FALLBACK — only if the library genuinely CANNOT represent this character (a non-human, a creature, a face-hiding mask): return exactly {"fallback": true} and nothing else. Prefer a good approximation over falling back.`,
].join("\n");

export function buildAvatarParamsUserPrompt(input: NpcAvatarPromptInput): string {
  return [...npcCharacterBlocks(input), `Choose this character's parts.`].join("\n\n");
}
