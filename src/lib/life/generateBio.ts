/**
 * LIFE-ONBOARD-6: extended character bio generation.
 *
 * On world creation, fire a small Gemini call that fleshes out the
 * player's character + surrounding people + recurring quirks based
 * on the seed they picked. The result lives on lifeWorld so EVERY
 * subsequent lifeStep prompt includes it in the (stable) character-
 * sheet section — giving the model anchors to pull on for story
 * injection (LIFE-EX storyline rules).
 *
 * Failure non-fatal — the world starts with a bare characterName
 * and the model has to invent context per-turn. The bio just makes
 * the early sessions richer.
 *
 * ── SRV-PROMPT-8..13 batch 6 ────────────────────────────────────────────────
 *
 * THE PROMPT IS GONE FROM HERE. `prompts/bio.ts` is DELETED (SRV-PROMPT-3) and
 * both halves are built by `functions/src/prompts/lifeBio.ts`. What stayed is
 * everything this file was already for: the generation parameters
 * (SRV-PROMPT-5 / MSG-PIPE-23 — a temperature named out loud), the fence strip,
 * the `ZBio` parse, the debug line and the non-fatal contract.
 *
 * ⚠ BATCH 6 BECAUSE `story` IS BATCH 5'S OUTPUT — it is what `runSagaOpen` has
 * just written — so the spec's shape follows `LifeSagaOpenPromptSpec` wherever
 * the two describe the same thing. See `LifeBioPromptSpec` for the full list.
 *
 * ⚠ NO RESPONSE SCHEMA, before and after. This call has never sent one: the
 * output contract is the JSON shape inside the system instruction and `ZBio`
 * below defends against the answer. Acquiring one on migration would be a
 * behaviour change, not a port (LIFE-WORLD-SAGA-10 measured that a model under
 * a schema drops non-required fields far more readily).
 *
 * ⚠ `renderBioForPrompt` STAYS HERE, and batch 8 CONFIRMED that rather than
 * changing it. It renders the RESULT into the `<bio>` block stored as
 * `lifeWorld.bio` — a Firestore field that `life_world_arc` (server-owned since
 * batch 3) and `life_step` (since batch 8) read back as a payload string. It is
 * a WRITER of stored state, not part of any prompt, so nothing in the migration
 * made it movable; `LifeStartScreen` and `tests/playthrough/playWorld.ts` both
 * still call it. Earlier notes said "it moves in batch 8" — that was a forecast
 * rather than a requirement, and following it would have dragged a Firestore
 * field renderer into a prompt migration. Nothing is duplicated, so there is no
 * parity guard and nothing to expire.
 */
import { z } from 'zod';
import { generateGemini } from '../gemini';
import * as log from '../log';
import { LIFE_PRIMARY_MODEL, LIFE_TEMPERATURE } from './modelConfig';
import { lifeDebug } from './debugLog';
import type { LifeBioPromptSpec } from '@/lib/practicePromptSpec';

const ZBio = z.object({
  /** A handful of recurring people with names + 1-line vibes.
   *  The model uses these as the player's social anchors. */
  people: z
    .array(
      z.object({
        name: z.string(),
        relationship: z.string(),
        oneLine: z.string(),
      }),
    )
    .min(2)
    .max(5),
  /** Character details that ground the story. */
  job: z.string(),
  cityNeighborhood: z.string(),
  homeDescription: z.string(),
  quirks: z.array(z.string()).min(2).max(4),
  currentSituation: z.string(),
  /** Open story hooks the LLM can pull on — events the character
   *  is anticipating or worried about. */
  hooks: z.array(z.string()).min(2).max(4),
});
export type CharacterBio = z.infer<typeof ZBio>;

/**
 * The world's opening STATE as this call site holds it — WIDER than the wire
 * shape, on purpose. `LifeStartScreen` hands over `opened.state.cast` and
 * `.fronts`, which are whole `CastMember`s and `Front`s; the spec builder below
 * narrows each element to the two fields the prompt reads, so nothing else
 * leaves the device.
 */
export type BioStoryInput = {
  title: string;
  tone: string;
  situation: string;
  cast: readonly { name: string; known: string }[];
  fronts: readonly { agenda: string; resolved?: string | null }[];
};

export type GenerateBioInput = {
  characterName: string;
  practiceLanguage: string;
  nativeLanguage: string;
  worldSeedKey: string;
  worldSeedText?: string;
  /** LIFE-ONBOARD-3: the register the player picked. Absent on legacy worlds.
   *  The closed enum rather than a bare string — it picks a branch of the mode
   *  gloss, and the server validates it against the same set `life_saga` uses. */
  worldMode?: 'realistic' | 'fantasy';
  /** LIFE-ARCH-3: the world's opening STATE from `sagaOpen`. When present the
   *  bio MUST align with it — the job fits the place `situation` describes, the
   *  people do not duplicate anyone already in `cast`, and the hooks are the
   *  player's personal stake near what is already in motion. Null only on
   *  world-open failure, and a null becomes an OMISSION on the wire. */
  story?: BioStoryInput | null;
};

export async function generateCharacterBio(
  input: GenerateBioInput,
): Promise<CharacterBio | null> {
  // SRV-PROMPT-8..13 batch 6 — a validated SPEC, never prose, narrowed field by
  // field at every depth. The cast and fronts in particular are rebuilt rather
  // than forwarded: a `CastMember` carries `wrongAbout`, `ties` and `nextMove`
  // and a `Front` carries `clock.consequence`, which LIFE-FRONT-1.1 withholds
  // from prompts on measured evidence. None of them has any business on the
  // wire, and a field that travels is a field someone later renders.
  const promptSpec: LifeBioPromptSpec = {
    kind: 'life_bio',
    characterName: input.characterName,
    practiceLanguage: input.practiceLanguage,
    nativeLanguage: input.nativeLanguage,
    worldSeedKey: input.worldSeedKey,
    ...(input.worldMode !== undefined ? { worldMode: input.worldMode } : {}),
    ...(input.worldSeedText !== undefined ? { worldSeedText: input.worldSeedText } : {}),
    // Absent, never null: the server rejects a null rather than reading it as
    // absent, because this field's PRESENCE is what the `<world>` block renders
    // on (the `life_saga` `universe` precedent). `story` is null whenever
    // `sagaOpen` failed, so this branch is a live path, not a defensive one.
    ...(input.story
      ? {
          story: {
            title: input.story.title,
            tone: input.story.tone,
            situation: input.story.situation,
            cast: input.story.cast.map((c) => ({ name: c.name, known: c.known })),
            // `resolved` travels — absent and null are both LIVE to the
            // server's filter, and WHICH fronts the model sees is a prompt rule
            // that stays server-side. Absent stays absent rather than becoming
            // an invented null.
            fronts: input.story.fronts.map((f) => ({
              agenda: f.agenda,
              ...(f.resolved !== undefined ? { resolved: f.resolved } : {}),
            })),
          },
        }
      : {}),
  };

  try {
    const raw = await generateGemini({
      // SRV-PROMPT-8..13: the server builds both halves from `promptSpec`.
      // sending NO `prompt` is load-bearing — the endpoint's "Missing prompt" guard is
      // skipped only when the resolver returns `built`, so this is also what
      // makes a resolver regression visible.
      promptSpec,
      model: LIFE_PRIMARY_MODEL,
      // flash-lite default; bumped from 'minimal' to 'medium' to
      // compensate for the smaller model — bio quality benefits
      // from a bit more reasoning. If quality still slips, upgrade
      // the model rather than crank thinking higher.
      // Measured 2026-07 (thinking_ab.py bio): 3/3 both levels, and the two
      // bios were read side by side — 'medium' was not richer, just slower
      // (403 thinking tokens, 1.7x price, 2.6x latency). This replaces the
      // earlier comment's UNMEASURED claim that "bio quality benefits from a
      // bit more reasoning"; it does not.
      thinkingLevel: 'minimal',
      responseMimeType: 'application/json',
      category: 'life_bio',
      temperature: LIFE_TEMPERATURE,
    });
    const stripped = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const parsed = ZBio.safeParse(JSON.parse(stripped));
    if (!parsed.success) {
      log.warn('life.bio.schema-failed', {
        issues: parsed.error.issues.slice(0, 3),
      });
      return null;
    }
    lifeDebug('BIO', `bio ready for ${input.characterName}`, {
      characterName: input.characterName,
      worldSeedKey: input.worldSeedKey,
      peopleCount: parsed.data.people.length,
      cityNeighborhood: parsed.data.cityNeighborhood,
      job: parsed.data.job,
      currentSituation: parsed.data.currentSituation,
      hooks: parsed.data.hooks,
    });
    return parsed.data;
  } catch (err) {
    log.warn('life.bio.gen-failed', { err: String(err) });
    return null;
  }
}

/** Renders the bio as a stable XML block the lifeStep prompt
 *  assembler can embed in the character-sheet section. */
export function renderBioForPrompt(bio: CharacterBio): string {
  const peopleLines = bio.people
    .map(
      (p) =>
        `  <person name="${escapeAttr(p.name)}" relationship="${escapeAttr(p.relationship)}">${escapeText(p.oneLine)}</person>`,
    )
    .join('\n');
  const quirkLines = bio.quirks
    .map((q) => `  <quirk>${escapeText(q)}</quirk>`)
    .join('\n');
  const hookLines = bio.hooks
    .map((h) => `  <hook>${escapeText(h)}</hook>`)
    .join('\n');
  return [
    `<bio>`,
    `  <job>${escapeText(bio.job)}</job>`,
    `  <neighborhood>${escapeText(bio.cityNeighborhood)}</neighborhood>`,
    `  <home>${escapeText(bio.homeDescription)}</home>`,
    `  <situation>${escapeText(bio.currentSituation)}</situation>`,
    `  <people>\n${peopleLines}\n  </people>`,
    `  <quirks>\n${quirkLines}\n  </quirks>`,
    `  <hooks>\n${hookLines}\n  </hooks>`,
    `</bio>`,
  ].join('\n');
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
  );
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
