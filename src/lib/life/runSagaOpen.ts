/**
 * LIFE-ARCH — open a world's state. Replaces `runWorldSagaGenerate`.
 *
 * Spec: docs/specs/story-architecture.md §3.
 *
 * The difference from what it replaces is the whole redesign in one line: that
 * call asked for a NOVEL SYNOPSIS — midpoint twist, climax, candidate endings,
 * a chapter plan — and this one is forbidden from stating any outcome at all.
 * It writes the universe, the first page, the cast and the one thing already in
 * motion, and stops (LIFE-ARCH-3).
 *
 * NO FALLBACK SAGA. `runWorldSagaGenerate` synthesised a `trivialSaga` on
 * failure so a world could never stall, and that was right when the saga was a
 * synopsis nobody would notice was thin. It is wrong here: a world with an
 * invented front and no cast is a world that plays badly for its whole life,
 * silently. A failure returns `kind: 'failed'` and the caller retries or tells
 * the player — which is the honest version of "never stall".
 *
 * ── SRV-PROMPT-8..13 batch 5 ────────────────────────────────────────────────
 *
 * THE PROMPT IS GONE FROM HERE. `prompts/sagaOpen.ts` is DELETED
 * (SRV-PROMPT-3) and all three artefacts — system instruction, user prompt AND
 * response schema — are built by `functions/src/prompts/lifeSagaOpen.ts`. What
 * stayed is everything this file was already for: the generation parameters
 * (SRV-PROMPT-5 / MSG-PIPE-23 — a temperature named out loud), the parse, the
 * cast ingest, the front's clamps, LIFE-FRONT-7's opening check, the goal ladder
 * and the no-fallback rule.
 *
 * ⚠ THE SCHEMA IS WHY THIS IS BATCH 5. `sagaOpenResponseSchema(succession)` took
 * a flag computed HERE, so the half that constrains the ANSWER lived in the
 * bundle beside the half that constrains the question — SRV-PROMPT-1 in its own
 * words. Both moved, and the flag did not follow them: the spec carries no
 * `succession` and no `realistic`, because each is derivable server-side from a
 * field that has to travel anyway (`universe`, `worldMode`). Two copies of one
 * fact can be made to disagree, and both of these decide what the model may
 * write.
 */
import { generateGemini } from '../gemini';
import { parseJsonLoose } from './parseJsonLoose';
import { LIFE_SAGA_MODEL, LIFE_TEMPERATURE } from './modelConfig';
import { lifeDebug, lifeFailed } from './debugLog';
import { generateOnceWithRetry } from './generateOnceWithRetry';
import { EMPTY_FACTS, resolveNeed, type GoalLadder } from './goalLadder';
import {
  capThreats,
  conformsToOpeningRule,
  SAGA_ADVANCE_COOLDOWN,
} from './fronts';
import {
  cleanText,
  dropPlayerNameCollisions,
  ingestCast,
  principalsMissingDrive,
  type RawCastRow,
} from './cast';
import type { Front, CastMember } from '@/types/lifeState';
import type { LifeWorld } from '@/types/firestore';
import type { Universe } from '@/types/lifeNarrative';
import type { LifeSagaOpenPromptSpec } from '@/lib/practicePromptSpec';

export type SagaOpenState = {
  universe: Universe | null;
  title: string;
  titleNative: string;
  /** LIFE-ARCH-8 — the one PLAYER-facing prose field in the display record.
   *  Empty only when the model omitted it despite the schema requiring it;
   *  every consumer falls back to the pending stub. */
  playerFacingTeaser: string;
  tone: string;
  situation: string;
  cast: CastMember[];
  fronts: Front[];
  /** LIFE-GOAL-1/2 — the ladder the world opens with. Null when the model
   *  omitted the goal despite the schema requiring it; the world then plays
   *  without direction rather than failing to open, and `lifeDebug` says so. */
  ladder: GoalLadder | null;
};

export type RunSagaOpenResult =
  | { kind: 'ok'; state: SagaOpenState }
  | { kind: 'failed'; reason: string };

type RawSagaOpen = {
  universe?: Universe;
  title?: string;
  titleNative?: string;
  playerFacingTeaser?: string;
  goal?: { text?: string; when?: string; days?: number };
  firstObjective?: string;
  firstObjectiveNeed?: string;
  tone?: string;
  situation?: string;
  principals?: RawCastRow[];
  regulars?: RawCastRow[];
  front?: {
    id?: string;
    name?: string;
    driverId?: string;
    agenda?: string;
    kind?: Front['kind'];
    clock?: { size?: number; consequence?: string };
  };
};

export async function runSagaOpen(input: {
  world: LifeWorld;
  /** SUCCESSION only (LIFE-ARCH-6): the universe is fixed and passed in. */
  universe?: Universe | null;
  survivingCast?: CastMember[];
  priorSagaHistory?: string[];
}): Promise<RunSagaOpenResult> {
  const w = input.world;
  // SRV-PROMPT-8..13 batch 5 — a validated SPEC, never prose, and narrowed
  // field by field rather than spread from the world doc. The SUCCESSION fork
  // rides the PAYLOAD (`universe` present or absent) rather than a flag, because
  // the server derives the response schema from the same bit: a boolean beside
  // it could ask for the succession schema with a new-world payload, and the
  // model would never be asked to author a universe at all.
  const promptSpec: LifeSagaOpenPromptSpec = {
    kind: 'life_saga',
    worldId: w.id,
    characterName: w.characterName,
    practiceLanguage: w.practiceLanguage,
    nativeLanguage: w.nativeLanguage,
    // LIFE-LANG-8 — resolved ONCE, here. It used to be resolved at this call
    // site for the SI while the `<character>` tag read `nativeLanguage`
    // separately, and two copies of one rule is how they come to disagree.
    systemLanguage: w.systemLanguage ?? w.nativeLanguage,
    worldSeedKey: w.worldSeedKey,
    // LIFE-FRONT-6 — the register is DERIVED from this server-side, so no
    // `realistic` boolean travels beside it.
    ...(w.worldMode !== undefined ? { worldMode: w.worldMode } : {}),
    ...(w.worldSeedText !== undefined ? { worldSeedText: w.worldSeedText } : {}),
    // Absent, never null: the server rejects a null rather than reading it as
    // absent (LIFE-NPC-8's precedent), so this is the one place that turns
    // "there is no previous act" into an omission. `figures` does not travel —
    // the prompt renders setting, era, laws and places.
    ...(input.universe
      ? {
          universe: {
            setting: input.universe.setting,
            era: input.universe.era,
            laws: [...input.universe.laws],
            places: [...input.universe.places],
          },
        }
      : {}),
    // An empty array renders no block at all, so sending one would be a field
    // that reaches nothing.
    ...(input.survivingCast?.length
      ? {
          survivingCast: input.survivingCast.map((c) => ({
            id: c.id,
            name: c.name,
            tier: c.tier,
            known: c.known,
          })),
        }
      : {}),
    ...(input.priorSagaHistory?.length
      ? { priorSagaHistory: [...input.priorSagaHistory] }
      : {}),
  };

  let raw: string;
  try {
    raw = await generateOnceWithRetry(
      () =>
        generateGemini({
          // SRV-PROMPT-8..13: the server builds both halves AND the schema from
          // `promptSpec`. sending NO `prompt` is load-bearing — the endpoint's
          // "Missing prompt" guard is skipped only when the resolver returns
          // `built`, so this is also what makes a resolver regression visible.
          promptSpec,
          model: LIFE_SAGA_MODEL,
          thinkingLevel: 'minimal',
          responseMimeType: 'application/json',
          category: 'life_saga',
          temperature: LIFE_TEMPERATURE,
        }),
      (err) => lifeDebug('SAGA', 'sagaOpen transport retry', { err: String(err) }),
    );
  } catch (err) {
    lifeFailed('SAGA', 'sagaOpen generation failed', { err: String(err) });
    return { kind: 'failed', reason: String(err) };
  }

  const parsed = parseJsonLoose(raw) as RawSagaOpen | null;
  if (!parsed || typeof parsed !== 'object') {
    lifeFailed('SAGA', 'sagaOpen returned unparseable JSON', {
      chars: raw.length,
      endsAbruptly: !raw.trimEnd().endsWith('}'),
      sample: raw.slice(0, 400),
    });
    return { kind: 'failed', reason: 'unparseable' };
  }

  // ── cast ────────────────────────────────────────────────────────────
  const ingested = dropPlayerNameCollisions(
    ingestCast({ principals: parsed.principals, regulars: parsed.regulars }),
    input.world.characterName,
  );
  const cast = ingested.cast;
  if (ingested.dropped.length) {
    lifeDebug('SAGA', 'LIFE-CAST-5: dropped cast sharing the player name', {
      dropped: ingested.dropped,
    });
  }
  const missingDrive = principalsMissingDrive(cast);
  if (missingDrive.length) {
    lifeDebug('SAGA', 'LIFE-CAST-1: principals arrived without drive', { missingDrive });
  }
  if (cast.length === 0) {
    lifeFailed('SAGA', 'sagaOpen produced no usable cast', {});
    return { kind: 'failed', reason: 'empty cast' };
  }

  // ── the one front ───────────────────────────────────────────────────
  const f = parsed.front;
  if (!f?.agenda || !f.kind || !f.clock?.consequence) {
    lifeFailed('SAGA', 'sagaOpen produced no usable front', { front: f ?? null });
    return { kind: 'failed', reason: 'no front' };
  }
  const fronts = capThreats([
    {
      id: cleanText(f.id) ?? 'opening-front',
      name: cleanText(f.name) ?? 'the thing in motion',
      driverId: cleanText(f.driverId) ?? 'circumstance',
      agenda: f.agenda,
      kind: f.kind,
      scope: 'saga',
      resolved: null,
      clock: {
        filled: 0,
        size: Math.max(4, Math.min(12, Math.trunc(f.clock.size ?? 8))),
        consequence: f.clock.consequence,
        peak: 0,
        unattended: 0,
        // The opening front has never advanced, so nothing is owed before it
        // may move for the first time (LIFE-FRONT-10).
        sinceAdvance: SAGA_ADVANCE_COOLDOWN,
      },
    },
  ]);

  // LIFE-FRONT-7 — the opening must be slow and non-threatening. CHECKED, not
  // hoped for: this replaces the deleted `storyStage` ladder and is the single
  // most important regression guard in the migration.
  if (!conformsToOpeningRule(fronts[0]!)) {
    lifeDebug('SAGA', 'LIFE-FRONT-7: opening front breached the slow-start rule', {
      kind: fronts[0]!.kind,
      size: fronts[0]!.clock.size,
    });
  }

  const state: SagaOpenState = {
    universe: parsed.universe ?? input.universe ?? null,
    title: cleanText(parsed.title) ?? 'Untitled',
    titleNative: cleanText(parsed.titleNative) ?? '',
    playerFacingTeaser: cleanText(parsed.playerFacingTeaser) ?? '',
    tone: cleanText(parsed.tone) ?? '',
    situation: cleanText(parsed.situation) ?? '',
    cast,
    fronts,
    ladder: buildOpeningLadder(parsed, cast),
  };

  // LIFE-ARCH-8 — say so. The whole cost of this defect was that it was
  // SILENT: `.default('')` on the Zod side meant a missing teaser produced a
  // world that looked fine and showed the pending stub for ever. It is
  // `required` in the schema now, so this should never fire; if it does, that
  // is the thing worth knowing, not a caption to shrug at.
  if (!state.playerFacingTeaser) {
    lifeDebug('SAGA', 'LIFE-ARCH-8: saga arrived with no playerFacingTeaser', {
      title: state.title,
    });
  }

  lifeDebug('SAGA', `world opened — "${state.title}"`, {
    title: state.title,
    principals: cast.filter((c) => c.tier === 'principal').map((c) => c.name),
    regulars: cast.filter((c) => c.tier === 'regular').map((c) => c.name),
    front: `[${fronts[0]!.kind}] ${fronts[0]!.agenda} · 0/${fronts[0]!.clock.size}`,
  });
  return { kind: 'ok', state };
}

/**
 * LIFE-GOAL-1/2 — the opening ladder.
 *
 * Two clamps at the source, both because the value lands in CHROME the player
 * reads at a glance:
 *
 *   `when`  a SHORT named day. The v2 branch shipped "the second Friday of the
 *           month" into a one-row ribbon and it pushed the goal off the end, so
 *           this clamps on a word boundary rather than trusting the prompt's
 *           "2-3 words".
 *   `days`  bounded 6-20. Under ~6 the goal is reachable inside a sitting,
 *           which that branch MEASURED as FUN 2 — the last turns become
 *           wind-down and the player is reading a finished story.
 *
 * The first objective's need resolves against the CAST only: at world open
 * there is no canon and no location yet, so a `what` or `where` name could not
 * be checked, and `LIFE-NEED-6` forbids minting a need that cannot be met.
 */
function buildOpeningLadder(
  parsed: RawSagaOpen,
  cast: CastMember[],
): GoalLadder | null {
  const text = cleanText(parsed.goal?.text);
  if (!text) return null;
  const when = (cleanText(parsed.goal?.when) ?? '').split(/\s+/).slice(0, 3).join(' ');
  const days = Math.max(6, Math.min(20, Math.round(parsed.goal?.days ?? 12)));
  const objectiveText = cleanText(parsed.firstObjective);
  return {
    saga: { text, when: when || 'soon', days },
    objective: objectiveText
      ? {
          id: 'obj-open',
          text: objectiveText,
          need: resolveNeed(parsed.firstObjectiveNeed, {
            ...EMPTY_FACTS,
            people: cast.map((c) => ({ id: c.id, name: c.name, standing: c.standing ?? 0 })),
          }),
        }
      : null,
    done: [],
    dayIndex: 0,
  };
}
