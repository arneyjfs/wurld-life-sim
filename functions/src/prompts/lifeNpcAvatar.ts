/**
 * LIFE-NPC-2 — the NPC avatar DIRECT-DRAW generator, owned by the server.
 *
 * This is the FALLBACK path. Since LIFE-NPC-2b the first attempt is the parts
 * picker (`lifeAvatarParams.ts`), which returns ~120 output tokens the client
 * assembles locally; this prompt runs only when the model says the library
 * cannot represent the character, or names a part that does not exist. It is
 * roughly 8x the output of the parts path, which is why the order matters and
 * why the two kinds must never be confused in dispatch.
 *
 * ── WHY IT LIVES HERE NOW (SRV-PROMPT-8..13, batch 2) ──────────────────────
 *
 * It was `src/lib/life/prompts/npcAvatar.ts`, sent up with every call. A prompt
 * in the bundle can only be corrected by an App Store review; the identical
 * prompt in `functions/` is one `deploy:prod:functions` away (§6.7). The bytes
 * moved UNCHANGED — a reworded art prompt would have made the migration and an
 * unmeasured quality change one indivisible diff.
 *
 * NO `cacheSlot` and NO `responseSchema`. The response is raw SVG on
 * `text/plain`, so there is no schema to own; and `explicitSiCache.ts` already
 * records why this category is not cacheable in terms — "a portrait renders
 * roughly once per NPC ever, so the hourly rate is not reliably above
 * break-even", and below break-even an explicit cache costs strictly more than
 * no cache.
 */
import { npcCharacterBlocks } from "./lifeNpcXml";

/**
 * The fields both avatar prompts read. Shared because the two kinds differ in
 * what the model is asked to DO, never in what it is told about the character.
 *
 * All three are model-authored world state (`name` and `role` from the turn or
 * the saga, `worldVibe` from the saga tone or the world seed) — carried but not
 * trusted, blast radius one portrait.
 */
export type NpcAvatarPromptInput = {
  /** Display name ("Sophie", "Marc the Boulanger", or the player's
   *  own character name). */
  name: string;
  /** Short role / relationship description ("café owner", "fellow
   *  resistance fighter", "elderly neighbour", or for the player:
   *  "the player's own character — protagonist of the saga"). Drives
   *  clothing + bearing. */
  role?: string | null;
  /** World vibe — usually inherited from the world's `worldSeedKey`
   *  / saga tone. Drives the aesthetic register (modern, noir,
   *  fantasy, sci-fi, etc.). */
  worldVibe: string;
};

export const NPC_AVATAR_SYSTEM_INSTRUCTION = [
  `You draw small character portraits as SVG. Each one fills a 32px circular slot on a chat bubble — there's no zoomed-in view, so detail beyond what reads at small size is wasted effort.`,
  ``,
  `OUTPUT:`,
  `Return ONLY the SVG. Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">…</svg>. No width/height on the root. No <text>, no <script>, no <image href>, no external URLs, no animations.`,
  ``,
  `STYLE:`,
  `Friendly children's-book / Studio Ghibli illustration. Warm pastels, gentle gradients, soft rounded shapes. Avoid harsh outlines, avoid hyper-realism, avoid creepy or uncanny features.`,
  ``,
  `COMPOSITION:`,
  `A solid pastel background fills the whole canvas. On top: head + shoulders, centred, face roughly the upper-middle 50% of the canvas. The face is the focal point — make it warm and characterful.`,
  ``,
  `FACE — get this right:`,
  `• Eyes are two ovals or rounded shapes, with a small dark pupil. NOT just dots — give them shape and life.`,
  `• Mouth is a soft curve or shape suggesting a faint expression (small smile, thoughtful pause, sly half-smile). Pick one that fits the character. Avoid a generic grim line.`,
  `• Nose: EITHER omit it entirely (normal in this style) OR draw a small, simple mark — a short vertical stroke, a soft dot, a tiny side-curve. It must NOT be a horizontal or U-shaped curve. A curve sitting between the eyes and the mouth reads as a SECOND MOUTH or a moustache, which is a reported defect.`,
  `• The lower face carries exactly ONE mouth, and at most one nose mark. Never stack two curved shapes there.`,
  `• Hair has style + colour — a fringe, waves, a bun, cropped, etc. Match the character's age and world.`,
  `• Skin has a single soft tone with optional cheek blush or shadow. Don't leave it grey.`,
  ``,
  `CLOTHING:`,
  `Read <role> and <worldVibe>. A baker has an apron + collar; a noir detective has a trench + tie; a magic apprentice has a robe collar; the player's own character wears clothing appropriate to the world without being a fancy outfit. Just the collar/upper shoulders are visible — keep it simple.`,
  ``,
  `CHARACTER:`,
  `Make this PERSON specific — pick hair colour, skin tone, age range, and one expressive detail (a freckle, a hat, a scarf, an eyepatch, a thoughtful eyebrow). The reader will see this avatar dozens of times; sameness is worse than a quirky choice.`,
  ``,
  `Return only the SVG. No prose.`,
].join("\n");

export function buildNpcAvatarUserPrompt(input: NpcAvatarPromptInput): string {
  return [
    ...npcCharacterBlocks(input),
    `Draw the avatar. Head-and-shoulders portrait, soft pastel background, no text, no scene.`,
  ].join("\n\n");
}
