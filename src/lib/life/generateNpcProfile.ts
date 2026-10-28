/**
 * LIFE-NPC-7: generate a short profile description for a persistent
 * NPC — the 1-2 sentence "who they are + how they fit into your story"
 * line that renders on the avatar card.
 *
 * Mirrors `generateNpcAvatar.ts` — a small focused Gemini call with a
 * typed result the caller tolerates. Runs flash-lite (cheap text, no
 * SVG). Fired ASYNC via `kickoffNpcAssets`; never blocks a commit.
 *
 * Unlike avatars (LIFE-FAIL-5), a failed profile has NO permanent
 * failure marker: `description` stays null and the commitNode roster
 * sweep re-attempts on a later turn until it lands.
 *
 * ── SRV-PROMPT-8..13 batch 2 — THE PROMPT AND ITS SCHEMA LEFT THE BUNDLE ───
 *
 * The prompt, the system instruction AND the response schema now live in
 * `functions/src/prompts/lifeNpcProfile.ts`. What stays here is what the client
 * genuinely owns: the generation parameters (SRV-PROMPT-5), the tolerant parse,
 * and the typed result.
 *
 * `PROFILE_SCHEMA` going with the prompt is SRV-PROMPT-1, not tidying: a schema
 * is the half of the artefact that decides what the model may SAY, so shipping
 * the prompt server-side while trusting a client-sent schema would leave half
 * the tuning surface frozen inside the app bundle — where `webDir: 'dist'` with
 * no `server.url` means only an App Store review can change it.
 */
import { z } from 'zod';
import { generateGemini } from '../gemini';
import * as log from '../log';
import { LIFE_PRIMARY_MODEL, LIFE_TEMPERATURE } from './modelConfig';
import type { LifeNpcProfilePromptSpec } from '../practicePromptSpec';

export type NpcProfileGenResult =
  | { kind: 'ok'; description: string }
  | { kind: 'error'; error: unknown };

/**
 * The generator's own argument. It was `NpcProfilePromptInput`, exported by the
 * now-deleted client prompt module; the server declares the same shape for the
 * prompt it builds. This one is the CALL's signature — `commitNode` and the
 * playthrough harness both reach it through `Parameters<typeof …>` — so it is
 * the client's to own, and the nullable optionals match what
 * `kickoffNpcAssets` actually holds.
 */
export type NpcProfileInput = {
  /** Display name ("Sophie", "Marc the Boulanger"). */
  name: string;
  /** Short role / relationship ("café owner", "elderly neighbour"). */
  role?: string | null;
  /** World vibe — saga tone or world seed. Sets the register. */
  worldVibe: string;
  /** LIFE-NPC-8: the fuller "who they are" line. Carries the ANSWER. */
  archetype?: string | null;
  /** The world's situation, when it has one. */
  sagaPremise?: string | null;
};

const ZProfileOut = z.object({ description: z.string().min(1) });

/**
 * The first balanced JSON object in a string, or the whole string if there is
 * none to find. Depth-counted rather than regex-matched because a description
 * legitimately contains braces-free prose but may contain quotes and escapes,
 * and a lazy `/\{.*\}/` would stop at the first `}` inside a nested value.
 *
 * Kept client-side on purpose: it READS the model's output rather than
 * instructing it, and it is the belt to the server schema's braces — a schema
 * is a strong request, not a guarantee (SRV-PROMPT-6 keeps the Explain parser
 * client-side for the same reason).
 */
function firstJsonObject(s: string): string {
  const start = s.indexOf('{');
  if (start === -1) return s;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i]!;
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}

/**
 * SRV-PROMPT-8..13 — the fields the prompt reads, as DATA.
 *
 * An absent optional is ABSENT from the spec rather than present-and-undefined
 * or null: the server tells them apart and REJECTS a null, so the day
 * `kickoffNpcAssets` stops resolving a role is a 400 in the logs rather than a
 * silently role-less profile. That is LIFE-NPC-8's own defect, and it was
 * invisible for long enough to ship.
 */
function profileSpec(input: NpcProfileInput): LifeNpcProfilePromptSpec {
  return {
    kind: 'life_npc_profile',
    name: input.name,
    worldVibe: input.worldVibe,
    ...(input.role ? { role: input.role } : {}),
    ...(input.archetype ? { archetype: input.archetype } : {}),
    ...(input.sagaPremise ? { sagaPremise: input.sagaPremise } : {}),
  };
}

export async function generateNpcProfile(
  input: NpcProfileInput,
): Promise<NpcProfileGenResult> {
  try {
    const raw = await generateGemini({
      // SRV-PROMPT-8..13 batch 2 — NO prompt text, NO `systemInstruction` and
      // NO `responseSchema`. All three are built in
      // `functions/src/prompts/lifeNpcProfile.ts` and resolved by
      // `resolveServerPrompt` from the spec below.
      promptSpec: profileSpec(input),
      model: LIFE_PRIMARY_MODEL,
      // Short, well-constrained output — minimal thinking is enough.
      thinkingLevel: 'minimal',
      responseMimeType: 'application/json',
      category: 'life_npc_profile',
      temperature: LIFE_TEMPERATURE,
    });
    const stripped = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const parsed = ZProfileOut.safeParse(JSON.parse(firstJsonObject(stripped)));
    if (!parsed.success) {
      log.warn('life.npc-profile.schema-failed', {
        name: input.name,
        issues: parsed.error.issues.slice(0, 3),
      });
      return { kind: 'error', error: parsed.error };
    }
    return { kind: 'ok', description: parsed.data.description.trim() };
  } catch (err) {
    log.warn('life.npc-profile.gen-failed', {
      name: input.name,
      err: String(err),
    });
    return { kind: 'error', error: err };
  }
}
