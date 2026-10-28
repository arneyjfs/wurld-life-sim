/**
 * LIFE-ARCH-4 — `sceneClose`. Replaces `runSceneReplan` entirely.
 *
 * Spec: docs/specs/story-architecture.md §3, §5.
 *
 * WHY IT REPLACES REPLAN — the audit's #1 finding, with a production timestamp
 * on it. `sceneReplan`'s prompt carried only the outline and the last dozen
 * events: no saga, no chapter, no canon. The one mechanism that adapted the
 * plan to the player could not re-anchor to the story, so it could only ERODE
 * the outline it was handed. Measured 2026-08-03 across two ticks of a single
 * scene: the premise was rewritten each time to describe what had JUST
 * HAPPENED ("has successfully retrieved…", "are currently hiding…"), the
 * candidate endings narrowed 3 → 2 → 1, and the scene the player was in stopped
 * being a scene about anything.
 *
 * This call does FOUR jobs in ONE generation:
 *   1. compact the scene into one line of saga history,
 *   2. advance clocks (a delta + a reason per front),
 *   3. revise latent cast state,
 *   4. hand back the scene's new canon entities.
 *
 * Compaction is therefore FREE — the call already holds the scene log to judge
 * the clocks, so folding the summary into the same response costs no extra
 * call.
 *
 * TWO GUARANTEES THAT ARE STRUCTURAL, NOT ASKED FOR:
 *
 *  - **Deltas only.** A model asked to re-emit the cast REWRITES the cast, and
 *    that is the telephone-game drift mutability buys. Asked instead which
 *    fields changed, untouched things stay untouched by construction.
 *  - **Canon fields are not in the schema.** `known`, ids and names cannot be
 *    emitted here at all, so a revision cannot contradict witnessed truth
 *    (LIFE-ARCH-2.1). Impossible by construction beats checked-for, and a
 *    general semantic contradiction check is not implementable anyway.
 *
 * ── SRV-PROMPT-8..13 batch 4 ────────────────────────────────────────────────
 *
 * THE PROMPT IS GONE FROM HERE. `prompts/sceneClose.ts` is DELETED
 * (SRV-PROMPT-3) and both halves plus the response schema are built by
 * `functions/src/prompts/lifeSceneClose.ts`. What stayed is the CODE-OWNED half
 * of the close — the delta clamp and budget (`applyClockDeltas`), the drift
 * (`driftUnattended`), the sign acceptance (`acceptedSignOf`), the threat cap
 * and `sagaResolution`'s integer comparison — plus the generation parameters
 * (SRV-PROMPT-5 / MSG-PIPE-23).
 *
 * ⚠ The category is `life_scene` and it is the CLOSE; `runSceneOpen` sends
 * `life_scene_gen`. Inverted-looking, not a typo, and not renameable — see
 * SRV-PROMPT-4 and `functions/src/observability/queries.ts`.
 *
 * ⚠ SRV-PROMPT-12 does NOT apply here. `life_step` and `life_graded_question`
 * append a rendered critic hint between retry attempts, which would re-open the
 * proxy through the retry path; this call's ladder is `generateOnceWithRetry`,
 * which re-issues the identical request. Asserted in `runSceneClose.test.ts`,
 * because the day someone adds a hint is the day that stops being true.
 */
import { generateGemini } from '../gemini';
import { parseJsonLoose } from './parseJsonLoose';
import { LIFE_SCENE_GEN_MODEL, LIFE_TEMPERATURE } from './modelConfig';
import { lifeDebug, lifeFailed } from './debugLog';
import { generateOnceWithRetry } from './generateOnceWithRetry';
import {
  acceptedSignOf,
  applyClockDeltas,
  capThreats,
  driftUnattended,
  sagaResolution,
  type ClockDelta,
} from './fronts';
import { applyCastChanges, cleanText, type CastChange } from './cast';
import type { CastMember, Front } from '@/types/lifeState';
import type { LifeSceneClosePromptSpec } from '@/lib/practicePromptSpec';

export type SceneCloseResult =
  | {
      kind: 'ok';
      historyLine: string;
      fronts: Front[];
      cast: CastMember[];
      situation: string | null;
      newCanon: { id: string; name: string; kind: string; note: string }[];
      /** LIFE-FRONT-5: set when the SAGA-scope front resolved. Detected by
       *  integer comparison in `sagaResolution`, never self-reported. */
      sagaResolved: 'filled' | 'cleared' | null;
      /** LIFE-GOAL-11: the close's ruling on the live objective. `stands` when
       *  there was none, so the caller never has to special-case it. */
      objectiveVerdict: string;
      objectiveBecause: string | null;
    }
  | { kind: 'failed'; reason: string };

type RawClose = {
  history?: string;
  objectiveVerdict?: string;
  objectiveBecause?: string | null;
  clockDeltas?: ClockDelta[];
  castChanges?: CastChange[];
  situation?: string | null;
  newCanon?: { id: string; name: string; kind: string; note: string }[];
};

export async function runSceneClose(input: {
  sceneLog: string[];
  subject: string;
  atStake: string;
  cast: CastMember[];
  fronts: Front[];
  realistic: boolean;
  /** The front ids the engine ASKED this scene to make perceivable. `signOf`
   *  counts as attention only when it is one of these (LIFE-FRONT-8.1) — the
   *  model fills the field regardless, and honouring it unconditionally is what
   *  suppressed LIFE-FRONT-9's drift for eighteen straight scenes. */
  requestedSignIds: readonly string[];
  signOf?: string | null;
  /** LIFE-GOAL-11: the live near objective, for the close to rule on. */
  objective?: { id: string; text: string } | null;
}): Promise<SceneCloseResult> {
  // SRV-PROMPT-8..13 batch 4 — a validated SPEC, never prose. Narrowed row by
  // row rather than spread: `Front` carries `peak` / `unattended` /
  // `sinceAdvance` / `scope` / `resolved` and `CastMember` carries `known`,
  // none of which this prompt has ever rendered. LIFE-ARCH-2.1 keeps witnessed
  // truth out of the RESPONSE schema so a revision cannot contradict it; there
  // is no reason for it to enter through the prompt either.
  const promptSpec: LifeSceneClosePromptSpec = {
    kind: 'life_scene',
    sceneLog: [...input.sceneLog],
    subject: input.subject,
    atStake: input.atStake,
    cast: input.cast.map((c) => ({
      id: c.id,
      name: c.name,
      tier: c.tier,
      standing: c.standing,
      ...(c.wants !== undefined ? { wants: c.wants } : {}),
      ...(c.nextMove !== undefined ? { nextMove: c.nextMove } : {}),
      ...(c.routine !== undefined ? { routine: c.routine } : {}),
    })),
    // The close DOES see clocks — it is the only caller that decides deltas,
    // and it cannot judge "how much closer" without knowing where things stand.
    fronts: input.fronts.map((f) => ({
      id: f.id,
      kind: f.kind,
      driverId: f.driverId,
      agenda: f.agenda,
      clock: {
        filled: f.clock.filled,
        size: f.clock.size,
        consequence: f.clock.consequence,
      },
    })),
    realistic: input.realistic,
    // LIFE-GOAL-11: ABSENT when there is none, rather than `null` — the server
    // omits the block either way, and a spec that carries a dead key invites a
    // later reader to render it.
    ...(input.objective ? { objective: { id: input.objective.id, text: input.objective.text } } : {}),
  };

  let raw: string;
  try {
    raw = await generateOnceWithRetry(
      () =>
        generateGemini({
          // SRV-PROMPT-8..13: the server builds both halves and the schema.
          // sending NO `prompt` is load-bearing — see `runSceneOpen.ts`.
          promptSpec,
          model: LIFE_SCENE_GEN_MODEL,
          thinkingLevel: 'minimal',
          responseMimeType: 'application/json',
          category: 'life_scene',
          temperature: LIFE_TEMPERATURE,
        }),
      (err) => lifeDebug('SCENE-CLOSE', 'sceneClose transport retry', { err: String(err) }),
    );
  } catch (err) {
    lifeFailed('SCENE-CLOSE', 'sceneClose generation failed', { err: String(err) });
    return { kind: 'failed', reason: String(err) };
  }

  const parsed = parseJsonLoose(raw) as RawClose | null;
  if (!parsed || typeof parsed !== 'object') {
    lifeFailed('SCENE-CLOSE', 'sceneClose returned unparseable JSON', {
      chars: raw.length,
      endsAbruptly: !raw.trimEnd().endsWith('}'),
      sample: raw.slice(0, 400),
    });
    return { kind: 'failed', reason: 'unparseable' };
  }

  // ── clocks: the model's deltas under the budget, then code-owned drift ──
  const { fronts: afterDeltas, applied, dropped } = applyClockDeltas(
    input.fronts,
    parsed.clockDeltas ?? [],
  );
  const signOf = acceptedSignOf(input.signOf, input.requestedSignIds);
  const attended = [...applied.map((d) => d.frontId), ...(signOf ? [signOf] : [])];
  const { fronts: drifted, drifted: driftDeltas } = driftUnattended(afterDeltas, attended);
  const fronts = capThreats(drifted);

  const cast = applyCastChanges(input.cast, parsed.castChanges ?? []);
  // `cleanText`, not truthiness: the model says "unchanged" through a
  // STRING-typed field by writing the WORD null, and `if (s)` accepts it
  // (LIFE-CAST-4).
  const situation = cleanText(parsed.situation);
  const historyLine = cleanText(parsed.history) ?? '';

  lifeDebug('SCENE-CLOSE', `scene closed — ${historyLine || '(no change)'}`, {
    history: historyLine,
    modelDeltas: applied.map((d) => `${d.frontId}${d.delta > 0 ? '+' : ''}${d.delta}`),
    droppedDeltas: dropped.length,
    drift: driftDeltas.map((d) => d.frontId),
    clocks: fronts.map((f) => `${f.id} ${f.clock.filled}/${f.clock.size}`),
    castChanged: (parsed.castChanges ?? []).map((c) => c.id),
    situationMoved: situation != null,
    newCanon: (parsed.newCanon ?? []).map((c) => c.id),
  });

  return {
    kind: 'ok',
    historyLine,
    // LIFE-GOAL-11: defaulted to 'stands', which is both the common answer and
    // the safe one — a close that came back without a verdict must leave the
    // player's objective where it is.
    objectiveVerdict: cleanText(parsed.objectiveVerdict) ?? 'stands',
    objectiveBecause: cleanText(parsed.objectiveBecause) ?? null,
    fronts,
    cast,
    situation,
    newCanon: parsed.newCanon ?? [],
    sagaResolved: sagaResolution(fronts),
  };
}
