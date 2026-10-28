/**
 * LIFE-WORLD-ARC-*: one-shot worldArc generation. Fires at world
 * creation (chapter 1) and on every "Continue your life" (chapter
 * N+1) — the model designs the chapter's premise + themes + which
 * recurring NPCs it'll lean on.
 *
 * Falls back to a trivial inline outline on failure so the world
 * never stalls — the scene generator will improvise around the
 * trivial chapter.
 *
 * SRV-PROMPT-8..13 batch 3: the prompt and the system instruction are built by
 * the SERVER from `functions/src/prompts/lifeWorldArc.ts`; this file sends
 * no `prompt`, only a validated spec and holds no prompt text. The client
 * module `prompts/worldArc.ts` is DELETED (SRV-PROMPT-3).
 *
 * ⚠ THE FALLBACK BELOW IS WHY THIS CALL WAS PICKED FOR BATCH 3 — AND IT IS ALSO
 * WHAT HID A REAL BUG FOR THE LIFE OF THE FEATURE. `readCompletedArcs` returned
 * the whole subcollection uncapped and the prompt rendered all of it, so a
 * long-played world eventually exceeded `MAX_PROMPT_BYTES`, the endpoint
 * refused the call, and the `catch` here turned that into `trivialArc` without
 * a word. The worlds that broke first were the ones someone cared enough about
 * to keep playing. `LIFE-WORLD-ARC-7` bounds the input; `capCompletedArcs`
 * below is that fix, and it runs BEFORE the spec is built so the cap governs
 * what crosses the wire and not just what renders.
 *
 * Spec: docs/specs/life-sim.md §10.7 (LIFE-WORLD-ARC-*).
 */
import { generateGemini } from '../gemini';
import { z } from 'zod';
import { LIFE_TEMPERATURE, LIFE_WORLD_ARC_MODEL } from './modelConfig';
import { lifeDebug, lifeFailed } from './debugLog';
import { capCompletedArcs, readCompletedArcs } from './arcs';
import { generateOnceWithRetry } from './generateOnceWithRetry';
import type { LifeWorldArcPromptSpec } from '../practicePromptSpec';
import type { LifeWorld, WorldArc } from '@/types/firestore';

const ZGeneratedArc = z.object({
  premise: z.string(),
  // LIFE-WORLD-ARC-REGISTER: spoiler-safe player-facing teaser. Optional/default
  // so a model that omits it (or a legacy fixture) still parses.
  playerTeaser: z.string().default(''),
  themes: z.array(z.string()).default([]),
  recurringNpcIds: z.array(z.string()).default([]),
});

export type RunWorldArcGenerateInput = {
  /** Owner uid — needed to read the completed-arc subcollection
   *  (LIFE-WORLD-ARC-1 / LIFE-DATA-*). */
  uid: string;
  world: LifeWorld;
  chapterNumber: number;
};

export type RunWorldArcGenerateResult =
  | { kind: 'ok'; arc: WorldArc; usedFallback: false }
  | { kind: 'fallback'; arc: WorldArc; usedFallback: true; reason: string };

/**
 * SRV-PROMPT-8..13 batch 3 — the fields the prompt reads, as DATA.
 *
 * NOT the `LifeWorld`. The world doc carries canon, a goal ladder, a story log,
 * a saga, the ACTIVE arc and a scene history, none of which this prompt has
 * ever read — and a field that travels without being read is one someone later
 * wires into something.
 *
 * Three things deliberately stay on the SERVER and are visible here by their
 * ABSENCE, because each decides what the model is SHOWN:
 *   - the LIVE-front filter — fronts travel with `resolved` and the prompt
 *     drops the closed ones. The clock and the consequence do not travel at
 *     all (LIFE-FRONT-1.1): withholding them is a prompt DECISION, and the
 *     safest place for it is the one where they never reach the wire;
 *   - the regulars ceiling — the whole cast travels and the prompt renders
 *     eight regulars plus every principal (LIFE-CAST-3);
 *   - the six-memory slice on each prior chapter.
 *
 * `previousArcs` is capped HERE and not there, unlike the recap's event window.
 * That window is bounded at 40 so shipping all of it is free; a world's arc
 * history is bounded by nothing, so `capCompletedArcs` (LIFE-WORLD-ARC-7) runs
 * before the spec is built and at most `COMPLETED_ARCS_CAP` chapters ever go up.
 *
 * `playerTeaser` is NOT sent (LIFE-WORLD-ARC-REGISTER). The recap is
 * PLAYER-facing and renders `playerTeaser || premise`; this prompt is read by
 * the MODEL and renders the planner premise, which may name tensions the player
 * has not discovered. Omitting the teaser rather than sending it and ignoring
 * it is what makes the spoiler rule structural.
 */
function worldArcSpec(
  world: LifeWorld,
  chapterNumber: number,
  previousArcs: readonly WorldArc[],
): LifeWorldArcPromptSpec {
  return {
    kind: 'life_world_arc',
    characterName: world.characterName,
    practiceLanguage: world.practiceLanguage,
    nativeLanguage: world.nativeLanguage,
    worldSeedKey: world.worldSeedKey,
    ...(world.worldSeedText !== undefined ? { worldSeedText: world.worldSeedText } : {}),
    ...(world.universe
      ? {
          universe: {
            setting: world.universe.setting,
            era: world.universe.era,
            laws: [...world.universe.laws],
            places: [...world.universe.places],
            figures: world.universe.figures.map((f) => ({ name: f.name, what: f.what })),
          },
        }
      : {}),
    ...(world.situation !== undefined ? { situation: world.situation } : {}),
    fronts: (world.fronts ?? []).map((f) => ({
      driverId: f.driverId,
      agenda: f.agenda,
      resolved: f.resolved ?? null,
    })),
    cast: (world.cast ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      voice: c.voice,
      standing: c.standing,
      tier: c.tier,
      known: c.known,
      ...(c.wants !== undefined ? { wants: c.wants } : {}),
      ...(c.nextMove !== undefined ? { nextMove: c.nextMove } : {}),
      ...(c.limit !== undefined ? { limit: c.limit } : {}),
      ...(c.routine !== undefined ? { routine: c.routine } : {}),
      ties: c.ties.map((t) => ({ id: t.id, how: t.how })),
    })),
    ...(world.bio !== undefined ? { bio: world.bio } : {}),
    ...(world.currentLocationLabel !== undefined
      ? { currentLocationLabel: world.currentLocationLabel }
      : {}),
    chapterNumber,
    previousArcs: previousArcs.map((a) => ({
      chapterNumber: a.chapterNumber,
      premise: a.premise,
      themes: [...a.themes],
      ...(a.outcomeLine !== undefined ? { outcomeLine: a.outcomeLine } : {}),
      completedSceneMemories: a.completedSceneMemories.map((m) => ({
        title: m.title,
        endingKey: m.endingKey,
        summary: m.summary,
      })),
    })),
  };
}

export async function runWorldArcGenerate(
  input: RunWorldArcGenerateInput,
): Promise<RunWorldArcGenerateResult> {
  // LIFE-WORLD-ARC-1: prior chapters now live in the completedArcs
  // subcollection — read them here and pass them into the prompt
  // builder explicitly (chapter 1 → empty).
  // LIFE-WORLD-ARC-7: bounded before it reaches the prompt, and before the SPEC
  // is built — so the cap governs what crosses the wire, not only what renders.
  // Unbounded, a long-played world's assembled pair reached 148.8% of
  // `MAX_PROMPT_BYTES` at twenty chapters (re-measured when this prompt moved
  // server-side) and the endpoint refuses the call — and because the catch
  // below falls back to `trivialArc`, the world would stop getting authored
  // chapters without saying so.
  const previousArcs = capCompletedArcs(
    await readCompletedArcs(input.uid, input.world.id),
  );

  let raw: string;
  try {
    // LIFE-FAIL-10: a chapter arc is generated exactly once and nothing later
    // re-attempts it, so one dropped socket cost a whole chapter its arc.
    raw = await generateOnceWithRetry(
      () =>
        generateGemini({
          // SRV-PROMPT-8..13 batch 3 — NO prompt text, NO `systemInstruction`
          // and NO `responseSchema`. All of it is built in
          // `functions/src/prompts/lifeWorldArc.ts` and resolved by
          // `resolveServerPrompt` from the spec below. sending NO `prompt` is
          // load-bearing: the endpoint's "Missing prompt" guard is skipped only
          // when the resolver returns `built`, so a resolver that stopped
          // recognising this kind would 400 every chapter in production with
          // the unit suite still green.
          promptSpec: worldArcSpec(input.world, input.chapterNumber, previousArcs),
          model: LIFE_WORLD_ARC_MODEL,
          // Rare one-shot call (once per chapter). High thinking
          // compensates for staying on flash-lite — see modelConfig.
          // Measured 2026-07 (thinking_ab.py arc): 3/3 both levels, 'high' cost
          // 868 thinking tokens — 2.8x the price, 4.7x the latency, no gain.
          thinkingLevel: 'minimal',
          responseMimeType: 'application/json',
          category: 'life_world_arc',
          temperature: LIFE_TEMPERATURE,
        }),
      (firstError) =>
        lifeDebug('WORLD-ARC', 'worldArc gen failed — retrying once', {
          err: String(firstError),
          chapterNumber: input.chapterNumber,
        }),
    );
  } catch (err) {
    lifeFailed('WORLD-ARC', 'worldArc generateGemini threw — falling back', {
      err: String(err),
      chapterNumber: input.chapterNumber,
    });
    return {
      kind: 'fallback',
      arc: trivialArc(input),
      usedFallback: true,
      reason: `gen-failed: ${String(err)}`,
    };
  }

  const parsed = safeParseJson(raw);
  if (!parsed) {
    lifeFailed('WORLD-ARC', 'worldArc response was not valid JSON', {
      raw: raw.slice(0, 400),
    });
    return {
      kind: 'fallback',
      arc: trivialArc(input),
      usedFallback: true,
      reason: 'parse-failed',
    };
  }

  const result = ZGeneratedArc.safeParse(parsed);
  if (!result.success) {
    lifeFailed('WORLD-ARC', 'worldArc failed schema validation', {
      issues: result.error.issues.slice(0, 4),
    });
    return {
      kind: 'fallback',
      arc: trivialArc(input),
      usedFallback: true,
      reason: 'schema-failed',
    };
  }

  const arc: WorldArc = {
    chapterNumber: input.chapterNumber,
    premise: result.data.premise,
    playerTeaser: result.data.playerTeaser,
    themes: result.data.themes,
    status: 'active',
    recurringNpcIds: result.data.recurringNpcIds,
    completedSceneMemories: [],
  };
  lifeDebug('WORLD-ARC', `chapter ${input.chapterNumber} ready`, {
    chapterNumber: input.chapterNumber,
    premise: arc.premise,
    themes: arc.themes,
    recurringNpcIds: arc.recurringNpcIds,
  });
  return { kind: 'ok', arc, usedFallback: false };
}

function trivialArc(input: RunWorldArcGenerateInput): WorldArc {
  return {
    chapterNumber: input.chapterNumber,
    premise: `Chapter ${input.chapterNumber}: the story continues.`,
    playerTeaser: `Chapter ${input.chapterNumber}: your story continues.`,
    themes: [],
    status: 'active',
    recurringNpcIds: [],
    completedSceneMemories: [],
  };
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    return null;
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
