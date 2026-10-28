/**
 * LIFE-NPC-2: generate a small portrait SVG for a persistent NPC.
 *
 * Mirrors `generateBackdrop.ts` — small focused Gemini call with the
 * SVG sanitiser on the response. Returns either the cleaned SVG or
 * a typed failure that the caller logs + tolerates (the UI falls
 * back to an initials circle when no avatar is present).
 *
 * Fired ASYNC after `promoteOrTouchNpc` returns `isNew: true`.
 * Never blocks the lifeStep response.
 *
 * ── SRV-PROMPT-8..13 batch 2 — BOTH PROMPTS LEFT THE BUNDLE ────────────────
 *
 * The parts-picker SI/prompt now live in
 * `functions/src/prompts/lifeAvatarParams.ts` and the direct-draw pair in
 * `functions/src/prompts/lifeNpcAvatar.ts`. What stays here is what the client
 * genuinely owns: the two-step ladder, the generation parameters
 * (SRV-PROMPT-5), `ZAvatarParams` + `assembleAvatar` (which READ the model's
 * answer rather than instructing it, and draw the portrait locally), and the
 * SVG sanitiser.
 *
 * The PART LIBRARY (`avatar/parts.ts`) deliberately did NOT move. It is SVG
 * geometry the client draws with; the server needs only the slot NAMES, which
 * it holds in its own table. That leaves the names live on both sides — a
 * disclosed duplication with no expiry, guarded by `avatar/parts.test.ts`.
 */
import { generateGemini } from '../gemini';
import * as log from '../log';
import { sanitiseSvg } from './sanitizeSvg';
import { ZAvatarParams, assembleAvatar } from './avatar/assemble';
import { LIFE_NPC_AVATAR_MODEL, LIFE_TEMPERATURE_ART } from './modelConfig';
import type {
  LifeAvatarParamsPromptSpec,
  LifeNpcAvatarPromptSpec,
} from '../practicePromptSpec';

export type NpcAvatarGenResult =
  | { kind: 'ok'; svg: string; via: 'parts' | 'draw' }
  | { kind: 'sanitise-failed'; raw: string }
  | { kind: 'error'; error: unknown };

/**
 * The generator's own argument, for BOTH steps — they differ in what the model
 * is asked to do, never in what it is told about the character.
 *
 * It was `NpcAvatarPromptInput`, exported by the now-deleted client prompt
 * module; the server declares the same shape for the prompts it builds. This
 * one is the CALL's signature (`commitNode` reaches it through
 * `Parameters<typeof generateNpcAvatar>[0]`), so it is the client's to own, and
 * the nullable `role` matches what `kickoffNpcAssets` actually holds.
 */
export type NpcAvatarInput = {
  /** Display name, or the player's own character name. */
  name: string;
  /** Short role / relationship. Drives clothing + bearing. */
  role?: string | null;
  /** Saga tone or world-seed register (modern, noir, fantasy, sci-fi). */
  worldVibe: string;
};

/**
 * SRV-PROMPT-8..13 — the fields both prompts read, as DATA, under whichever
 * kind is being run.
 *
 * An absent role is ABSENT from the spec rather than null: the server rejects a
 * null instead of reading it as absent, so the day `kickoffNpcAssets` stops
 * resolving a role is a 400 in the logs rather than a portrait drawn — as
 * LIFE-NPC-8 puts it — "without anyone knowing she sells flowers".
 */
function avatarSpec(input: NpcAvatarInput, kind: 'life_npc_avatar'): LifeNpcAvatarPromptSpec;
function avatarSpec(
  input: NpcAvatarInput,
  kind: 'life_npc_avatar_params',
): LifeAvatarParamsPromptSpec;
function avatarSpec(
  input: NpcAvatarInput,
  kind: 'life_npc_avatar' | 'life_npc_avatar_params',
): LifeNpcAvatarPromptSpec | LifeAvatarParamsPromptSpec {
  return {
    kind,
    name: input.name,
    worldVibe: input.worldVibe,
    ...(input.role ? { role: input.role } : {}),
  };
}

/**
 * LIFE-NPC-2 (v2): try the cheap PARTS path first — the model picks a part per
 * slot (~120 output tokens) and we assemble the portrait locally. Fall back to
 * the direct SVG draw (~8× the output) only when the model says the library
 * can't represent the character, or it names a part that doesn't exist.
 */
export async function generateNpcAvatar(
  input: NpcAvatarInput,
): Promise<NpcAvatarGenResult> {
  const parts = await tryPartsAvatar(input);
  if (parts) return { kind: 'ok', svg: parts, via: 'parts' };
  return drawNpcAvatar(input);
}

/** Returns an assembled SVG, or null to signal "fall back to drawing". */
async function tryPartsAvatar(input: NpcAvatarInput): Promise<string | null> {
  try {
    const raw = await generateGemini({
      // SRV-PROMPT-8..13 batch 2 — NO prompt text and NO `systemInstruction`.
      // Both halves are built in `functions/src/prompts/lifeAvatarParams.ts`.
      // NO `responseSchema` either, and that is a decision: `ZAvatarParams`
      // below is a Zod validator that DEFENDS against the answer, which is the
      // opposite job from a JSON schema that constrains it — and a schema
      // pinning the eight slots would forbid the model's `{"fallback": true}`
      // escape hatch, which this ladder depends on.
      promptSpec: avatarSpec(input, 'life_npc_avatar_params'),
      model: LIFE_NPC_AVATAR_MODEL,
      thinkingLevel: 'minimal',
      responseMimeType: 'application/json',
      temperature: LIFE_TEMPERATURE_ART,
      category: 'life_npc_avatar_params',
    });
    const parsed = ZAvatarParams.safeParse(JSON.parse(stripFences(raw)));
    if (!parsed.success) {
      log.warn('life.npc-avatar.params-invalid', { name: input.name });
      return null;
    }
    if (parsed.data.fallback) return null; // model asked to draw instead
    const { svg, errors } = assembleAvatar(parsed.data);
    if (!svg) {
      log.warn('life.npc-avatar.params-unknown-part', {
        name: input.name,
        errors: errors.join(','),
      });
      return null;
    }
    return svg;
  } catch (err) {
    log.warn('life.npc-avatar.params-failed', { name: input.name, err: String(err) });
    return null;
  }
}

/** The original direct-SVG draw — now the FALLBACK path. */
async function drawNpcAvatar(
  input: NpcAvatarInput,
): Promise<NpcAvatarGenResult> {
  try {
    const raw = await generateGemini({
      // SRV-PROMPT-8..13 batch 2 — NO prompt text, NO `systemInstruction`.
      // Both halves are built in `functions/src/prompts/lifeNpcAvatar.ts`. No
      // response schema: the answer is raw SVG on `text/plain`.
      promptSpec: avatarSpec(input, 'life_npc_avatar'),
      model: LIFE_NPC_AVATAR_MODEL,
      // Simpler subject than backdrops — minimal thinking is enough.
      thinkingLevel: 'minimal',
      responseMimeType: 'text/plain',
      temperature: LIFE_TEMPERATURE_ART,
      category: 'life_npc_avatar',
    });
    const cleaned = sanitiseSvg(stripFences(raw));
    if (!cleaned) {
      log.warn('life.npc-avatar.sanitise-failed', {
        name: input.name,
        rawLen: raw.length,
      });
      return { kind: 'sanitise-failed', raw };
    }
    return { kind: 'ok', svg: cleaned, via: 'draw' };
  } catch (err) {
    log.warn('life.npc-avatar.gen-failed', {
      name: input.name,
      err: String(err),
    });
    return { kind: 'error', error: err };
  }
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  lines.shift();
  if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
  return lines.join('\n').trim();
}

/** Encode a sanitised SVG string into a data URI the Avatar component
 *  can use directly via <img src>. SVG bytes go up cleanly — no
 *  base64 needed; we URL-encode the awkward characters and ship as
 *  utf8 to keep the doc small. */
export function svgToDataUri(svg: string): string {
  // Strip XML decl if present (most generators don't emit it, but
  // defensive) and any newlines that bloat the URI.
  const compact = svg.replace(/^<\?xml[^>]*\?>\s*/i, '').replace(/\s+/g, ' ').trim();
  const encoded = compact
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/"/g, "'")
    .replace(/&/g, '%26')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E');
  return `data:image/svg+xml;utf8,${encoded}`;
}
