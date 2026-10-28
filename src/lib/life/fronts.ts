/**
 * Front + clock mechanics. Every rule the model is NOT trusted with.
 *
 * Spec: docs/specs/story-architecture.md §2, §6.5.
 *
 * THE PRINCIPLE THIS FILE EXISTS FOR: a model is good at writing a sentence
 * given a situation, and bad at maintaining a system. So `sceneClose` is asked
 * only for prose and a small local judgement (a delta and a reason); every
 * quantity, count, threshold and transition is decided here.
 *
 * That split is not a style choice — it is the fix for four measured model
 * weaknesses at once: arithmetic drift, inability to answer "no change",
 * unreliable "at most one X", and self-reported thresholds.
 */
import type { CastMember, Front, FrontKind } from '@/types/lifeState';

/** LIFE-FRONT-2: how far one clock may move in a single scene close. */
export const DELTA_PER_FRONT = 2;

/**
 * LIFE-FRONT-2.1: how far ALL clocks may move, summed, in one scene close.
 *
 * Models do not do restraint. Asked for a delta they produce a non-zero one,
 * for every front, every time — and three fronts across eight scenes takes
 * everything to maximum inside a single chapter. The prompt says 0 is the
 * normal answer; this is what makes that true.
 */
export const DELTA_BUDGET = 2;

/** LIFE-FRONT-3.1: at most one `threat` front live at a time. */
export const MAX_LIVE_THREATS = 1;

/**
 * LIFE-FRONT-10: scene closes a SAGA-scope front must wait between advances.
 *
 * A saga front is the arc. `DELTA_BUDGET` caps what one close can do and is
 * blind to the run, so a front the player is actively engaged with advances
 * every single close — measured at 5 of 6 in the second playthrough, filling an
 * 8-clock inside one chapter. Chapter fronts are exempt: they are SUPPOSED to
 * resolve inside a chapter, and rationing them would just make them inert.
 *
 * With drift at 3 and this at 2, an 8-clock saga front needs 16+ scenes to fill
 * however it is played. That is the ratchet the design asks for: always moving,
 * never fast.
 */
export const SAGA_ADVANCE_COOLDOWN = 2;

/** LIFE-CAST-1.1 / LIFE-CAST-3: cast bounds. The floor is inherited from the
 *  deleted `storyStage` ladder — it fixed a DIFFERENT reported failure
 *  ("characters are never introduced") and must not be lost with it. The
 *  ceiling is new: regulars otherwise accumulate to 30 named people by chapter
 *  five, which is prompt bloat and a cast the player cannot track. */
export const MAX_PRINCIPALS = 3;
export const REGULARS_FLOOR = 2;
export const REGULARS_RENDER_CEILING = 8;

export type ClockDelta = { frontId: string; delta: number; reason: string };

export function isLive(f: Front): boolean {
  return f.resolved == null;
}

/** LIFE-FRONT-8: a clock past half must be made perceivable by the next scene.
 *  Hidden pressure the player cannot see is indistinguishable from things going
 *  wrong for no reason — the difference between an agency design and an
 *  on-rails one. */
export function needsSign(f: Front): boolean {
  return isLive(f) && f.clock.filled * 2 >= f.clock.size;
}

export function frontsNeedingSign(fronts: readonly Front[]): Front[] {
  return fronts.filter(needsSign);
}

/**
 * LIFE-FRONT-8.1 — accept a scene's `signOf` only when the code ASKED for one.
 *
 * `signOf` is a STRING field in the scene schema, and the second playthrough
 * showed the model filling it every single scene whether or not
 * `<makePerceivable>` named anything. That silently marked the front attended on
 * every close, so LIFE-FRONT-9's drift never fired once in 18 scenes and a
 * world's saga front sat at 0/8 throughout. A field the model can volunteer is
 * not a signal about the world; it is a signal about the model.
 */
export function acceptedSignOf(
  signOf: string | null | undefined,
  requestedIds: readonly string[],
): string | null {
  const id = (signOf ?? '').trim();
  if (!id) return null;
  return requestedIds.includes(id) ? id : null;
}

/**
 * Apply the model's deltas under the budget. Pure — returns new fronts.
 *
 * Order matters and is deliberate: deltas are sorted by DESCENDING absolute
 * size before the budget is spent, so when the model over-reaches (which it
 * will) the movement it considered most significant is the one that survives.
 * Truncating in emission order would keep whichever front happened to be first
 * in the array, which is arbitrary.
 *
 * Negative deltas are NOT budgeted. The budget exists to stop runaway
 * escalation; a player pushing pressure back is the thing we want to happen
 * freely, and rationing it would make relief feel arbitrary.
 */
export function applyClockDeltas(
  fronts: readonly Front[],
  deltas: readonly ClockDelta[],
): { fronts: Front[]; applied: ClockDelta[]; dropped: ClockDelta[] } {
  const byId = new Map(fronts.map((f) => [f.id, f]));
  const clamped = deltas
    .filter((d) => byId.has(d.frontId) && isLive(byId.get(d.frontId)!) && d.delta !== 0)
    .map((d) => ({
      ...d,
      delta: Math.max(-DELTA_PER_FRONT, Math.min(DELTA_PER_FRONT, Math.trunc(d.delta))),
    }));

  const negatives = clamped.filter((d) => d.delta < 0);
  const positives = clamped
    .filter((d) => d.delta > 0)
    .sort((a, b) => b.delta - a.delta);

  const applied: ClockDelta[] = [...negatives];
  const dropped: ClockDelta[] = [];

  // LIFE-FRONT-10 — a saga front on cooldown cannot advance, and when it does
  // it advances ONE notch. Both halves are needed: the cooldown alone limits
  // how OFTEN, and a maximally pushy model still took an 8-clock in 7 closes by
  // moving two at a time. One notch, every other close, is the ratchet.
  // Filtered BEFORE the budget so a rationed saga delta does not eat a chapter
  // front's room.
  const cooled: ClockDelta[] = [];
  for (const d of positives) {
    const f = byId.get(d.frontId)!;
    if (f.scope !== 'saga') {
      cooled.push(d);
      continue;
    }
    if (f.clock.sinceAdvance < SAGA_ADVANCE_COOLDOWN) {
      dropped.push(d);
      continue;
    }
    cooled.push({ ...d, delta: 1 });
    if (d.delta > 1) dropped.push({ ...d, delta: d.delta - 1 });
  }
  let spent = 0;
  for (const d of cooled) {
    const room = DELTA_BUDGET - spent;
    if (room <= 0) {
      dropped.push(d);
      continue;
    }
    const take = Math.min(d.delta, room);
    applied.push({ ...d, delta: take });
    spent += take;
    if (take < d.delta) dropped.push({ ...d, delta: d.delta - take });
  }

  const deltaById = new Map<string, number>();
  for (const d of applied) {
    deltaById.set(d.frontId, (deltaById.get(d.frontId) ?? 0) + d.delta);
  }

  const next = fronts.map((f) => {
    const d = deltaById.get(f.id);
    if (!d || !isLive(f)) return f;
    return tick(f, d);
  });

  return { fronts: next, applied, dropped };
}

/**
 * Move one clock and read its resolution off the integer. The model NEVER
 * decides whether a clock is full or cleared — it emits a delta and a reason,
 * and every transition is decided here.
 */
function tick(f: Front, d: number): Front {
  const filled = Math.max(0, Math.min(f.clock.size, f.clock.filled + d));
  const peak = Math.max(f.clock.peak, filled);
  // LIFE-FRONT-5.1: CLEARED means the player pushed a real pressure back to
  // nothing — not that a pressure which never moved was nudged downward. See
  // `ZClock.peak` for the playthrough that made this necessary.
  const resolved: Front['resolved'] =
    filled >= f.clock.size
      ? 'filled'
      : filled === 0 && peak * 2 >= f.clock.size
        ? 'cleared'
        : null;
  return {
    ...f,
    clock: {
      ...f.clock,
      filled,
      peak,
      unattended: 0,
      sinceAdvance: d > 0 ? 0 : f.clock.sinceAdvance,
    },
    resolved,
  };
}

/**
 * LIFE-FRONT-9 — how many consecutive unattended scene closes before a front
 * advances on its own.
 *
 * Three is chosen against the other two numbers in this file: with
 * `DELTA_BUDGET` of 2 and a saga clock of 8-12, drift alone fills a saga front
 * in 24-36 scenes — several chapters of a world nobody is steering, which is
 * about right for "weather". Any faster and the drift becomes the story; any
 * slower and it is decoration.
 */
export const UNATTENDED_DRIFT_SCENES = 3;

/**
 * CLOSE THE SCENE for the fronts: advance whatever nothing touched, and age
 * every live clock by one close. Runs exactly once per scene close, AFTER
 * `applyClockDeltas`.
 *
 * "Attended" is deliberately generous — a delta in either direction, or the
 * scene having been asked to make this front perceivable (LIFE-FRONT-8). The
 * player engaging with a pressure and the model judging that it moved are both
 * evidence it is live in the fiction; drift is for the pressures genuinely
 * being ignored.
 */
export function driftUnattended(
  fronts: readonly Front[],
  attendedIds: readonly string[],
): { fronts: Front[]; drifted: ClockDelta[] } {
  const attended = new Set(attendedIds);
  const drifted: ClockDelta[] = [];

  const next = fronts.map((f) => {
    if (!isLive(f)) return f;
    // Every live clock ages by one close, whatever else happens to it — this is
    // the only place that knows a close occurred, so LIFE-FRONT-10's counter is
    // maintained here.
    const aged = { ...f, clock: { ...f.clock, sinceAdvance: f.clock.sinceAdvance + 1 } };
    if (attended.has(f.id)) return aged;

    const unattended = aged.clock.unattended + 1;
    if (unattended < UNATTENDED_DRIFT_SCENES) {
      return { ...aged, clock: { ...aged.clock, unattended } };
    }
    drifted.push({
      frontId: f.id,
      delta: 1,
      reason: `unattended for ${UNATTENDED_DRIFT_SCENES} scenes`,
    });
    return tick(aged, 1);
  });

  return { fronts: next, drifted };
}

/**
 * LIFE-FRONT-5: has the saga's top pressure resolved?
 *
 * The whole "detect that the story is over" problem, answered by an integer
 * comparison. No extra call, no model self-report — which is the only reason it
 * can be trusted.
 */
export function sagaResolution(fronts: readonly Front[]): 'filled' | 'cleared' | null {
  const top = fronts.find((f) => f.scope === 'saga');
  return top?.resolved ?? null;
}

/** LIFE-FRONT-3.1, enforced rather than requested. Surplus threats are demoted
 *  to the closest non-threat kind rather than dropped: the pressure the model
 *  wanted is real, it just may not all be menace. */
export function capThreats(fronts: readonly Front[]): Front[] {
  let seen = 0;
  return fronts.map((f) => {
    if (!isLive(f) || f.kind !== 'threat') return f;
    seen += 1;
    return seen <= MAX_LIVE_THREATS ? f : { ...f, kind: 'obligation' as FrontKind };
  });
}

/**
 * LIFE-FRONT-6 — the stakes ceiling.
 *
 * The front MODEL travels across genres; the SEVERITY does not, and that is
 * exactly where a conference world turns into a thriller. Realistic worlds cap
 * at social / professional / financial / personal cost.
 *
 * Deliberately a PROMPT constraint plus a lexical backstop rather than a
 * semantic check: "is this consequence too severe" is a judgement, and asking a
 * model to make it is the unobservable-rule failure again. The word list only
 * has to catch the flagrant cases.
 */
const OVER_CEILING = [
  'kill', 'kills', 'killed', 'murder', 'dies', 'die', 'death', 'dead',
  'burn down', 'burns down', 'explode', 'explodes', 'explosion', 'bomb',
  'kidnap', 'kidnapped', 'shot', 'stabbed', 'assassinat',
];

export function breachesRealisticCeiling(consequence: string): boolean {
  const c = consequence.toLowerCase();
  return OVER_CEILING.some((w) => c.includes(w));
}

/** LIFE-FRONT-7: chapter 1 carries no threat and no fast clock. `storyStage` is
 *  deleted by this design, so its measured win — "stop dropping the player into
 *  high drama from the off" — has to be preserved STRUCTURALLY rather than by
 *  exhortation. This is that structure. */
export const CHAPTER_ONE_MIN_CLOCK = 8;

export function conformsToOpeningRule(f: Front): boolean {
  return f.kind !== 'threat' && f.clock.size >= CHAPTER_ONE_MIN_CLOCK;
}

/** Principals over the cap are demoted, newest first — an established principal
 *  has more of the player's attention invested in them than a fresh one. */
export function capPrincipals(cast: readonly CastMember[]): CastMember[] {
  let seen = 0;
  return cast.map((c) => {
    if (c.tier !== 'principal') return c;
    seen += 1;
    return seen <= MAX_PRINCIPALS ? c : { ...c, tier: 'regular' as const };
  });
}
