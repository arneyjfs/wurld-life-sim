/**
 * LIFE-BACKDROP-1: generate a backdrop SVG from a descriptor.
 *
 * Phase A.2: calls `generateGemini` directly (local-first prompt
 * iteration per LIFE-DEV-1/3). Cache lives in the caller —
 * `useLifeBackdrop` — backed by localStorage for now. Phase B moves
 * the cache to Firestore + Storage once the lifeWorld doc exists.
 */
import { generateGemini } from '../gemini';
import * as log from '../log';
import { sanitiseSvg } from './sanitizeSvg';
import { LIFE_BACKDROP_MODEL, LIFE_TEMPERATURE_ART } from './modelConfig';
import type { BackdropDescriptor } from './backdropDescriptor';
import type { LifeBackdropPromptSpec } from '../practicePromptSpec';

export type BackdropGenResult =
  | { kind: 'ok'; svg: string }
  | { kind: 'sanitise-failed'; raw: string }
  | { kind: 'error'; error: unknown };

export type GenerateBackdropInput = {
  descriptor: BackdropDescriptor;
  /** The world's practiceLanguage — every piece of text rendered
   *  inside the SVG (signs, menus, posters, shop names) MUST be in
   *  this language. A French-world café has French menu items. */
  practiceLanguage: string;
};

export async function generateBackdrop(
  input: GenerateBackdropInput,
): Promise<BackdropGenResult> {
  const { descriptor: d, practiceLanguage } = input;
  try {
    const raw = await generateGemini({
      // SRV-PROMPT-8..13 batch 1 — NO prompt text, and NO `systemInstruction`.
      // Both halves are built in `functions/src/prompts/lifeBackdrop.ts` and
      // resolved by `resolveServerPrompt` from the spec below.
      //
      // The SI left first (LIFE-BACKDROP-30) because the server creates a
      // BILLED context cache keyed on a digest of the bytes it receives, so two
      // app versions mid-rollout thrashed the one shared record. The USER
      // prompt stayed, on the true-but-insufficient argument that it is
      // per-world and never cached. PRACTICE-OWN-1 is the answer to that:
      // replacing only the SI leaves the hole open, because the user prompt is
      // the other place prose enters — and a prompt in the bundle can only be
      // corrected by an App Store review.
      promptSpec: backdropSpec(d, practiceLanguage),
      model: LIFE_BACKDROP_MODEL,
      // LIFE-BACKDROP-11: NO native thinking. Measured 2026-07-25 on
      // gemini-3.5-flash-lite across three backdrops — 'medium' spent 2365
      // thinking tokens per backdrop ($0.005913, FIFTY-NINE PERCENT of the
      // bill) and drew LESS for it: 25 drawing nodes vs 43 at 'minimal',
      // 1318 drawing tokens vs 2458. It is not a quality/cost trade —
      // native thinking was worse on both axes here. Consistent with the
      // design intent that reasoning belongs in guided output, not a
      // hidden pass whose tokens are billed and discarded unread.
      thinkingLevel: 'minimal',
      responseMimeType: 'text/plain',
      temperature: LIFE_TEMPERATURE_ART,
      category: 'life_backdrop',
    });
    const cleaned = sanitiseSvg(stripFences(raw));
    if (!cleaned) {
      log.warn('life.backdrop.sanitise-failed', { descriptor: d, rawLen: raw.length });
      return { kind: 'sanitise-failed', raw };
    }
    return { kind: 'ok', svg: cleaned };
  } catch (err) {
    log.warn('life.backdrop.gen-failed', { descriptor: d, err: String(err) });
    return { kind: 'error', error: err };
  }
}

/**
 * SRV-PROMPT-8..13 — the descriptor fields the prompt actually reads, as DATA.
 *
 * Field-by-field rather than the descriptor whole. `label` / `labelNative` key
 * the backdrop cache (LIFE-BACKDROP-2/28) and fill the location ribbon
 * (LIFE-BACKDROP-26); this prompt has never read either, so they do not travel.
 *
 * An absent optional is ABSENT from the spec rather than present-and-undefined
 * — the server tells the two apart, and `{flavour: undefined}` still serialises
 * the key on some transports.
 */
function backdropSpec(d: BackdropDescriptor, practiceLanguage: string): LifeBackdropPromptSpec {
  return {
    kind: 'life_backdrop',
    locationType: d.locationType,
    vibe: d.vibe,
    persistent: d.persistent,
    practice: practiceLanguage,
    ...(d.flavour !== undefined ? { flavour: d.flavour } : {}),
    ...(d.timeOfDay !== undefined ? { timeOfDay: d.timeOfDay } : {}),
  };
}

/** Defensive strip — sometimes the model still wraps output in
 *  markdown fences despite the SI telling it not to. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  // Drop the opening fence + any language tag.
  lines.shift();
  // Drop the closing fence if present.
  if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
  return lines.join('\n').trim();
}
