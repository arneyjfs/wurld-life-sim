/**
 * LIFE-ARCH — `sceneOpen`. Replaces `runSceneGenerate`.
 *
 * Spec: docs/specs/story-architecture.md §3.
 *
 * The old call authored a scene's FUTURE before the player had acted once:
 * `candidateEndings` (which `sceneReplan` could only ever narrow — measured
 * going 3 → 2 → 1 until the scene was about nothing), `completionTriggers`
 * (exit conditions written for a scene nobody had played), `openBranches`
 * ("safe detours", i.e. the ones that did not count) and `estimatedPhaseCount`.
 * This one puts the player somewhere specific, with someone specific, with
 * something at stake right now, and stops.
 *
 * WHAT THE ENGINE OWNS, NOT THE MODEL. Four of this call's inputs are decided
 * in code and handed over as instructions, because each is a rule a model can
 * satisfy by doing nothing:
 *
 *  - `focus` (LIFE-SCENE-2) — whose scene this is, ROTATED. The front's driver
 *    is the most salient person in the planner's context, so left to choose it
 *    picks them every time, forever. Measured: ten scenes, one subject.
 *  - `needSign` (LIFE-FRONT-8) — which pressures must become perceivable, from
 *    clocks the planner never sees (LIFE-FRONT-1.1).
 *  - `ironyAvailable` (LIFE-CAST-2) — beliefs the player can now see through,
 *    detected by comparing `wrongAbout.aboutId` against canon.
 *  - the dormancy order (LIFE-CANON-6) — longest-away material first.
 *
 * THE FALLBACK IS KEPT, unlike `sagaOpen`'s. A world that opens badly plays
 * badly for its whole life, so `sagaOpen` fails loudly; a SCENE that opens
 * badly is over in ten turns, and having no scene at all is worse — the engine
 * re-attempts generation on every turn that lands without one (LIFE-SCENE-24).
 * The fallback is stored-future-free like the real path: it is a thin
 * situation, not a thin plot.
 *
 * ── SRV-PROMPT-8..13 batch 4 ────────────────────────────────────────────────
 *
 * THE PROMPT IS GONE FROM HERE. `prompts/sceneOpen.ts` is DELETED
 * (SRV-PROMPT-3) and both halves plus the response schema are built by
 * `functions/src/prompts/lifeSceneOpen.ts`. What stayed is everything this file
 * was already for: the four ENGINE DECISIONS (`focus`, `needSign`,
 * `ironyAvailable`, the dormancy order), the generation parameters
 * (SRV-PROMPT-5 / MSG-PIPE-23 — a temperature named out loud), the parse, the
 * `who` resolution against the live cast, and the fallback.
 *
 * ⚠ The category is `life_scene_gen` and it is the OPEN; `runSceneClose` sends
 * `life_scene`. Inverted-looking, not a typo, and not renameable — see
 * SRV-PROMPT-4 and `functions/src/observability/queries.ts`.
 */
import { generateGemini } from '../gemini';
import { parseJsonLoose } from './parseJsonLoose';
import { LIFE_SCENE_GEN_MODEL, LIFE_TEMPERATURE } from './modelConfig';
import { lifeDebug, lifeFailed } from './debugLog';
import { generateOnceWithRetry } from './generateOnceWithRetry';
import { acceptedSignOf, frontsNeedingSign } from './fronts';
import { focusForScene } from './sceneFocus';
import { canonDormancy } from './canon';
import { cleanText } from './cast';
import type { CastMember, Front } from '@/types/lifeState';
import type { LifeWorld, SceneOutline } from '@/types/firestore';
import type { WorldCanon } from '@/types/lifeNarrative';
import type { LifeSceneOpenPromptSpec } from '@/lib/practicePromptSpec';

export type RunSceneOpenInput = {
  world: LifeWorld;
  cast: CastMember[];
  fronts: Front[];
  canon: WorldCanon;
  /** Saga history, oldest → newest. One line per closed scene. */
  history: string[];
  recentSubjects: string[];
  /** Scenes opened in this world so far — the rotation index. */
  sceneIndex: number;
};

export type RunSceneOpenResult =
  | { kind: 'ok'; outline: SceneOutline; usedFallback: false }
  | { kind: 'fallback'; outline: SceneOutline; usedFallback: true; reason: string };

type RawSceneOpen = {
  title?: string;
  where?: string;
  who?: string[];
  subject?: string;
  openQuestion?: string;
  atStake?: string;
  drawsOn?: string[];
  signOf?: string | null;
};

export async function runSceneOpen(
  input: RunSceneOpenInput,
): Promise<RunSceneOpenResult> {
  const needSign = frontsNeedingSign(input.fronts).map((f) => f.id);
  const focus = focusForScene(input.sceneIndex, input.cast);

  // LIFE-CAST-2 — irony is only irony when the player can SEE the gap. A
  // principal wrong about something the player has never met is just a
  // character with a private belief; offering it here would ask the planner to
  // explain the thing in order to use it, which is the opposite of the effect.
  const known = new Set(
    [
      ...input.canon.characters,
      ...input.canon.places,
      ...input.canon.objects,
      ...input.canon.facts,
    ].map((e) => e.id),
  );
  const ironyAvailable = input.cast
    .filter((c) => c.tier === 'principal' && c.wrongAbout && known.has(c.wrongAbout.aboutId))
    .map((c) => ({ castId: c.id, believes: c.wrongAbout!.believes }));

  // SRV-PROMPT-8..13 batch 4 — a validated SPEC, never prose. Narrowed row by
  // row rather than spread from the world's own objects: `Front` carries a
  // clock the planner must never see (LIFE-FRONT-1.1) and `CastMember` carries
  // the `wrongAbout` that `ironyAvailable` is derived from (LIFE-CAST-2), so
  // spreading either would put the undecided input beside the decided output.
  const universe = input.world.universe;
  const promptSpec: LifeSceneOpenPromptSpec = {
    kind: 'life_scene_gen',
    characterName: input.world.characterName,
    practiceLanguage: input.world.practiceLanguage,
    ...(universe
      ? {
          universe: {
            setting: universe.setting,
            laws: [...universe.laws],
            places: [...universe.places],
          },
        }
      : {}),
    situation: input.world.situation ?? '',
    cast: input.cast.map((c) => ({
      id: c.id,
      name: c.name,
      tier: c.tier,
      standing: c.standing,
      known: c.known,
      ...(c.wants !== undefined ? { wants: c.wants } : {}),
      ...(c.nextMove !== undefined ? { nextMove: c.nextMove } : {}),
      ...(c.routine !== undefined ? { routine: c.routine } : {}),
    })),
    fronts: input.fronts
      .filter((f) => f.resolved == null)
      .map((f) => ({ id: f.id, driverId: f.driverId, agenda: f.agenda })),
    canon: canonDormancy(input.canon, input.history),
    history: [...input.history],
    sceneIndex: input.sceneIndex,
    needSign,
    ironyAvailable,
    focus,
    recentSubjects: [...input.recentSubjects],
    chapterNumber: input.world.currentArc?.chapterNumber ?? 1,
    chapterTurns: input.world.storyLog?.turns ?? 0,
  };

  let raw: string;
  try {
    raw = await generateOnceWithRetry(
      () =>
        generateGemini({
          // SRV-PROMPT-8..13: the server builds both halves and the schema from
          // `promptSpec`. sending NO `prompt` is load-bearing — the endpoint's
          // "Missing prompt" guard is skipped only when the resolver returns
          // `built`, so this is also what makes a resolver regression visible.
          promptSpec,
          model: LIFE_SCENE_GEN_MODEL,
          thinkingLevel: 'minimal',
          responseMimeType: 'application/json',
          category: 'life_scene_gen',
          temperature: LIFE_TEMPERATURE,
        }),
      (err) => lifeDebug('SCENE-GEN', 'sceneOpen transport retry', { err: String(err) }),
    );
  } catch (err) {
    lifeFailed('SCENE-GEN', 'sceneOpen generation failed — thin scene', {
      err: String(err),
    });
    return { kind: 'fallback', outline: thinScene(), usedFallback: true, reason: `gen-failed: ${String(err)}` };
  }

  const parsed = parseJsonLoose(raw) as RawSceneOpen | null;
  if (!parsed || typeof parsed !== 'object' || !cleanText(parsed.subject)) {
    lifeFailed('SCENE-GEN', 'sceneOpen returned no usable scene — thin scene', {
      chars: raw.length,
      sample: raw.slice(0, 400),
    });
    return { kind: 'fallback', outline: thinScene(), usedFallback: true, reason: 'unparseable' };
  }

  // `who` names CAST ids. A hallucinated one would pre-promote an NPC with no
  // name and no voice, and the roster would carry that ghost for the rest of
  // the world's life — so it is resolved against the cast, not trusted.
  const byId = new Map(input.cast.map((c) => [c.id, c]));
  const keyNpcs = (parsed.who ?? [])
    .map((id) => byId.get(id))
    .filter((c): c is CastMember => c != null)
    .map((c) => ({ npcId: c.id, name: c.name, role: c.known || 'someone the player knows' }));

  const subject = cleanText(parsed.subject) ?? '';
  const openQuestion = cleanText(parsed.openQuestion);
  const where = cleanText(parsed.where);
  const outline: SceneOutline = {
    title: cleanText(parsed.title) ?? subject,
    premise: cleanText(parsed.atStake) ?? subject,
    subject,
    // LIFE-INTENT-2. Left ABSENT when the model omits it rather than
    // synthesised from the subject: a question derived from the destination is
    // the destination again, and the whole point is that it can come out
    // differently. `renderSceneQuestion` omits the block when it is absent, so
    // an unanswered scene degrades to exactly the pre-LIFE-INTENT-2 behaviour.
    //
    // LIFE-CAST-6 — SPREAD-WHEN-PRESENT, as `normaliseMember` does, and for the
    // same reason: `x: cleanText(...) ?? undefined` leaves an explicit key
    // HOLDING undefined, which the Firestore SDK rejects outright rather than
    // ignoring. Both fields are `required` in the schema, so the model always
    // emits them — and per LIFE-CAST-4 it satisfies a required string it has
    // nothing for with `""` / `"none"`, which `cleanText` maps to null. So this
    // is the ordinary case, not the malformed one, and the cost is the whole
    // `createScene` write: no active scene, and per LIFE-SCENE-24 a chapter
    // that cannot end while a billed `sceneOpen` re-fires every turn.
    ...(openQuestion ? { openQuestion } : {}),
    ...(where ? { where } : {}),
    drawsOn: (parsed.drawsOn ?? []).filter((id) => known.has(id)),
    // LIFE-FRONT-8.1: only a sign the engine ASKED for counts as attention.
    // Accepting an unrequested one is what suppressed drift for eighteen
    // straight scenes. Via `acceptedSignOf` rather than an inline
    // `needSign.includes(...)`: the inline copy answered TRUE for an OMITTED
    // signOf whenever a requested id was empty, and then wrote `parsed.signOf!`
    // — undefined — onto the outline (LIFE-CAST-6). The helper is the one
    // implementation of this rule and it returns null, never undefined.
    signOf: acceptedSignOf(parsed.signOf, needSign),
    tone: '',
    practiceFocus: [],
    keyNpcs,
    // LIFE-ARCH-3 — the four stored futures. Written empty, deliberately and
    // permanently; `renderScene` omits each block when its array is empty.
    openBranches: [],
    candidateEndings: [],
    completionTriggers: [],
  };

  lifeDebug('SCENE-GEN', `scene opened — "${outline.title}"`, {
    subject: outline.subject,
    openQuestion: outline.openQuestion,
    where: outline.where,
    who: keyNpcs.map((n) => n.name),
    drawsOn: outline.drawsOn,
    focus: focus?.name ?? '(ordinary day)',
    requestedSign: needSign,
    signOf: outline.signOf,
    ironyOffered: ironyAvailable.map((i) => i.castId),
  });
  return { kind: 'ok', outline, usedFallback: false };
}

/** The scene that runs when generation fails: a situation with no content of
 *  its own, which the step engine improvises inside from the world state it
 *  already has. No endings, no triggers, no branches — a thin scene, never a
 *  thin plot. */
function thinScene(): SceneOutline {
  return {
    title: 'The day continues',
    premise: 'Whatever is already in motion carries on.',
    subject: 'the day as it stands',
    drawsOn: [],
    signOf: null,
    tone: '',
    practiceFocus: [],
    keyNpcs: [],
    openBranches: [],
    candidateEndings: [],
    completionTriggers: [],
  };
}
