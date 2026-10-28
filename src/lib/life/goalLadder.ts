/**
 * LIFE-GOAL-* / LIFE-NEED-* — the goal ladder, and what stands in its way.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Owner, 2026-08-10, after playing a scene: *"I was asked to find a key, I saw
 * it but picked a different option on that turn — the key never came back up
 * again, until suddenly it seems like the scene is about something else."*
 *
 * v1 already had a goals feature and it was DEAD. `currentGoals`,
 * `worldDelta.addGoals` / `removeGoals`, the merge in `commitNode` and a
 * `<goals>` prompt block were all wired end to end. Measured over 4 runs / 95
 * turns: **0 goals added, 0 removed, 0 ever live.** The schema offered
 * `"addGoals": ["..."]` and nothing anywhere told the model when to use it —
 * `LIFE-SPEECH-8`'s lesson one level up, where a field with no forcing function
 * is authored zero times. No wording fixes that; a mechanism has to ASK.
 *
 * So the key was a chip on ONE turn, minted fresh, and when the player did not
 * take it nothing anywhere recorded that it had ever mattered.
 *
 * ── THE LADDER, AND WHY IT IS NOT ONE DEADLINE ──────────────────────────────
 *
 * Owner: *"a deadline should be maybe a few scenes. Although smaller deadlines
 * can be easier and quicker to attain building to the main deadline that may not
 * occur until 20 scenes later."* That is a better design than the v2 branch's
 * and it resolves a contradiction that branch measured itself into:
 *
 *   · a deadline REACHED inside a sitting scores FUN 2 — the last turns become
 *     wind-down, so the clock has to outlast a sitting;
 *   · but a payoff that far out *"pays out once, twelve days away, which in a
 *     sitting-length window is never"* — the write-only ledger that left their
 *     AGENCY at 2/5.
 *
 * A ladder is the only shape that satisfies both: the near objective pays out
 * inside the sitting, the saga goal outlasts it. It is NOT the "two deadlines"
 * v2 rejected — that warned against two COMPETING clocks splitting attention.
 * Here the objective is a step toward the goal, so there is one direction with
 * milestones on it.
 *
 * ── CODE OWNS THE LADDER ────────────────────────────────────────────────────
 *
 * Same division as `LIFE-TIME-1`'s clock and `LIFE-FRONT-9`'s drift: the model
 * reports a local judgement ("this objective is done", "the next one is X"), and
 * the arithmetic happens here. In particular the model can NEVER silently drop
 * an objective — `applyLadderDelta` ignores a proposed replacement while one is
 * still live, which is the whole of `LIFE-GOAL-3`.
 */
import type { TimeAdvance } from './timeOfDay';

/** LIFE-NEED-1: the three things an objective can be waiting on. */
export type GoalNeedKind = 'who' | 'what' | 'where';
export type GoalNeed = { kind: GoalNeedKind; name: string };

export type Objective = {
  id: string;
  text: string;
  /** LIFE-NEED-1: at most ONE. Absent is common and correct — a free push is
   *  part of the rhythm, and a world where everything is gated is a corridor. */
  need?: GoalNeed | null;
};

export type LadderEntry = {
  text: string;
  how: 'done' | 'closed';
  /** Present on `closed` only: why the world took it off the table. */
  because?: string;
};

export type GoalLadder = {
  /** LIFE-GOAL-1: the distant thing. Null only for a world generated before
   *  this shipped, which reads as "no ladder" rather than as a broken one. */
  saga: { text: string; when: string; days: number } | null;
  /** LIFE-GOAL-2: the ONE live near thing. */
  objective: Objective | null;
  done: LadderEntry[];
  /** LIFE-GOAL-7: days elapsed, driven by the clock v1 already has. */
  dayIndex: number;
};

export const EMPTY_LADDER: GoalLadder = {
  saga: null,
  objective: null,
  done: [],
  dayIndex: 0,
};

/**
 * LIFE-NEED-6 — a person-need's reputation floor, and the model never sets it.
 *
 * It names WHO; code decides HOW MUCH. A number the model chooses is a number
 * it will drift on, and a floor that varied per step would be an invisible
 * difficulty knob — the thing `ENGINE2-EXPOSE-B4` warns exposure must not
 * become. One value, stated once.
 */
export const REPUTATION_FLOOR = 1;

/** What the ladder needs to know about the world to resolve and check a need.
 *  A plain shape rather than the live documents so the whole module stays a
 *  pure function of state — same reason `LIFE-NEED-2` insists exposure is
 *  computed and never rolled: same state, same answer, in a replay and a test. */
export type WorldFacts = {
  people: ReadonlyArray<{ id: string; name: string; standing?: number | null }>;
  things: ReadonlyArray<string>;
  places: ReadonlyArray<string>;
  /** The location label the player is standing in, if any. */
  here: string | null;
  /** LIFE-NEED-1 `what`: things the player is carrying. */
  holding: ReadonlyArray<string>;
};

export const EMPTY_FACTS: WorldFacts = {
  people: [], things: [], places: [], here: null, holding: [],
};

/**
 * Build the facts from the live world + roster.
 *
 * `holding` is deliberately EMPTY for now, and that is a stated limitation
 * rather than an oversight: v1 has no inventory, so a `what` need can never be
 * met and `LIFE-NEED-6` forbids minting one that cannot. `resolveNeed` will
 * therefore never return `what` while `things` is sourced from canon objects
 * the player does not hold — which is the correct, conservative behaviour until
 * an inventory exists. Recorded here so the next reader knows the branch is
 * unreachable ON PURPOSE and does not "fix" it into a soft-lock.
 */
export function worldFactsFor(
  world: {
    canon?: { places?: ReadonlyArray<{ name: string }>; objects?: ReadonlyArray<{ name: string }> } | null;
    currentLocationLabel?: string | null;
  },
  npcs: ReadonlyArray<{ id: string; name: string; standing?: number | null }>,
): WorldFacts {
  return {
    people: npcs.map((n) => ({ id: n.id, name: n.name, standing: n.standing ?? 0 })),
    // Not `canon.objects`: see the note above. An object in canon is something
    // the story has mentioned, not something the player carries.
    things: [],
    places: (world.canon?.places ?? []).map((p) => p.name),
    here: world.currentLocationLabel ?? null,
    holding: [],
  };
}

const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const sameName = (a: string, b: string): boolean => fold(a) === fold(b);

/**
 * LIFE-NEED-5 — the model names a need as a FLAT STRING; code infers the kind.
 *
 * Flat because `LIFE-CTX-15` measured nested optional objects being silently
 * dropped from generated output, and a need that vanishes without trace is
 * worse than one that never existed — the objective would look free and block
 * nothing. A flat string either arrives or does not.
 *
 * Resolution order is people → things → places, which is the order of how
 * specific the match is: a person is a named individual, a thing is an object
 * in canon, a place is the loosest. Unresolvable returns null and the objective
 * simply has no need (`LIFE-NEED-6`: a need that can never be met must never be
 * minted, and an unresolvable name is exactly that).
 */
export function resolveNeed(
  raw: string | null | undefined,
  facts: WorldFacts,
): GoalNeed | null {
  const name = (raw ?? '').trim();
  if (!name) return null;
  const person = facts.people.find((p) => sameName(p.name, name) || sameName(p.id, name));
  if (person) return { kind: 'who', name: person.name };
  const thing = facts.things.find((t) => sameName(t, name));
  if (thing) return { kind: 'what', name: thing };
  const place = facts.places.find((p) => sameName(p, name));
  if (place) return { kind: 'where', name: place };
  return null;
}

/** LIFE-NEED-2: is the objective's need satisfied by the world as it stands? */
export function needMet(need: GoalNeed | null | undefined, facts: WorldFacts): boolean {
  if (!need) return true;
  if (need.kind === 'who') {
    const p = facts.people.find((x) => sameName(x.name, need.name));
    return !!p && (p.standing ?? 0) >= REPUTATION_FLOOR;
  }
  if (need.kind === 'what') return facts.holding.some((h) => sameName(h, need.name));
  return !!facts.here && sameName(facts.here, need.name);
}

/**
 * LIFE-NEED-3 — the block, phrased in FICTION and never as a number.
 *
 * Returned as a plain reason the caller renders under the option. "Risky" and a
 * percentage are both mechanics showing through; the player should read a fact
 * about the world. v2 measured the alternative and it is worse than it sounds:
 * asked to write its own cost lines the model drifted *"from concrete to generic
 * to incoherent"*, so this is code's job.
 *
 * Null when nothing is in the way, which is the common case.
 */
export function exposureReason(
  objective: Objective | null | undefined,
  facts: WorldFacts,
): string | null {
  const need = objective?.need;
  if (!need || needMet(need, facts)) return null;
  if (need.kind === 'who') return `${need.name} has no reason to do this for you yet`;
  if (need.kind === 'what') return `you do not have ${need.name}`;
  return `that happens at ${need.name}`;
}

/**
 * LIFE-NEED-5 — the move that CLEARS the block, named so the grid can offer it.
 *
 * `LIFE-NEED-5` is the load-bearing invariant of the whole mechanic: a player
 * who can be blocked with no move that clears it has met a wall, and
 * information without an affordance is just being told off. This returns the
 * clearing move as a short phrase so the option grid can carry it on the same
 * turn the block is reported.
 */
export function clearingMove(
  objective: Objective | null | undefined,
  facts: WorldFacts,
): string | null {
  const need = objective?.need;
  if (!need || needMet(need, facts)) return null;
  if (need.kind === 'who') return `spend this turn on ${need.name}`;
  if (need.kind === 'what') return `get hold of ${need.name}`;
  return `go to ${need.name}`;
}

/**
 * LIFE-NEED-3 + LIFE-NEED-5 — the pair the option grid renders, or null.
 *
 * Both halves together or neither, because separately each one is a failure
 * mode this spec names: a reason with no move is `LIFE-NEED-5`'s wall ("being
 * told off"), and a move with no reason is a chip the player has no cause to
 * pick. Returning ONE object makes it impossible for the grid to render half.
 *
 * **Why the caller renders this ABOVE the grid rather than under the option
 * that would advance the objective**, which is what an earlier draft of
 * `goalPrompt` told the model was happening: code cannot know WHICH option
 * advances the objective. Only the model knows that, and asking it to tag one
 * is the shape of field this codebase has now twice measured being authored
 * essentially never — `hear` (4 of 2,110 options) and `addGoals` (0 of 95
 * turns). A tag that is usually absent puts the block under nothing, which is
 * strictly worse than putting it over everything.
 *
 * Above the grid it is also literally true: the objective is blocked, not one
 * chip, and every chip on the grid is being chosen in that light.
 */
export type ObjectiveBlock = {
  reason: string;
  clearing: string;
  /**
   * LIFE-REP-5 — the person this turn would be INVESTED IN, when the block is a
   * `who`. Null for `what` / `where`, which are not relationships.
   *
   * Carried on the block rather than re-derived downstream because the promise
   * is specifically about the door: *"Investing a turn in a person ALWAYS lands
   * and always buys exactly one step."* Code has to own that. Leaving it to the
   * model's `felt` would make the reliable move unreliable — and this codebase
   * has measured twice over what happens to a field the model is merely asked
   * for (`hear`, `addGoals`). The one move the player is told will work is the
   * last one that may quietly not.
   */
  investIn: string | null;
};

export function objectiveBlockFor(
  objective: Objective | null | undefined,
  facts: WorldFacts,
): ObjectiveBlock | null {
  const reason = exposureReason(objective, facts);
  const clearing = clearingMove(objective, facts);
  // Belt and braces: both are derived from the same `needMet` call, so one
  // without the other is impossible today. The guard is here so that a future
  // edit to either function cannot quietly ship the half-render.
  if (!reason || !clearing) return null;
  const need = objective?.need ?? null;
  return {
    reason,
    clearing,
    investIn: need && need.kind === 'who' ? need.name : null,
  };
}

/** What the model may say about the ladder on a turn. Every field optional and
 *  FLAT (`LIFE-NEED-5`'s reasoning applies to the whole block). */
export type LadderDelta = {
  /** The live objective was achieved this turn. */
  objectiveDone?: boolean;
  /** The world took it off the table; the string is WHY, in fiction. */
  objectiveClosed?: string | null;
  /** Proposed replacement. Read ONLY when the live one just ended, or when
   *  there is none — see `applyLadderDelta`. */
  nextObjective?: string | null;
  /** Flat name of the replacement's need (`LIFE-NEED-5`). */
  nextObjectiveNeed?: string | null;
};

/**
 * LIFE-GOAL-3/4 — the reducer, and the ONE rule that fixes the reported bug.
 *
 * **A proposed replacement is IGNORED while an objective is still live.** That
 * single line is the difference between the ladder and the `currentGoals` list
 * it replaces: the old field let the model rewrite the objective set on any
 * turn for any reason, which is how "find the key" could stop existing because
 * the player looked at something else. An objective now ends exactly two ways —
 * completed, or closed with a reason the player is shown — and *not taking the
 * option that would advance it is neither of those.*
 *
 * Pure: takes the ladder and returns the next one, so a turn can be replayed.
 */
export function applyLadderDelta(
  ladder: GoalLadder,
  delta: LadderDelta,
  facts: WorldFacts,
  opts: { advance?: TimeAdvance; newId: string },
): GoalLadder {
  const closedReason = (delta.objectiveClosed ?? '').trim();
  const ended = !!ladder.objective && (delta.objectiveDone === true || closedReason !== '');

  const done = ended && ladder.objective
    ? [
        ...ladder.done,
        closedReason
          ? { text: ladder.objective.text, how: 'closed' as const, because: closedReason }
          : { text: ladder.objective.text, how: 'done' as const },
      ]
    : ladder.done;

  // The gate. A replacement lands only into an EMPTY slot.
  const slotFree = ended || !ladder.objective;
  const proposed = (delta.nextObjective ?? '').trim();
  const objective: Objective | null = slotFree
    ? (proposed
        ? { id: opts.newId, text: proposed, need: resolveNeed(delta.nextObjectiveNeed, facts) }
        : null)
    : ladder.objective;

  // LIFE-GOAL-7: `nextMorning` is the ONLY advance that wraps the clock
  // (`advanceTimeOfDay`), so it is the only one that turns a day. Reusing that
  // rather than adding a second counter is the point — the model already may
  // not state a date, and code already only moves this forward.
  const dayIndex = ladder.dayIndex + (opts.advance === 'nextMorning' ? 1 : 0);

  return { saga: ladder.saga, objective, done, dayIndex };
}

/**
 * LIFE-REP-3 — apply one turn's reactions to the roster. Code owns the sum.
 *
 * Two clamps, and they guard different things. **Per turn**: at most one step
 * per person however many times they are named, so a turn cannot swing a
 * relationship — `LIFE-REP-4` says most turns move nothing, and this makes the
 * ceiling structural rather than a request. **Absolute**: the total is bounded
 * so standing stays a scale the fiction can describe rather than a score that
 * runs away; ±3 is the range the seeding rule (`LIFE-REP-2`, never below −1 at
 * open) was written against.
 *
 * `who` is matched by id OR name because the model is being asked for a person,
 * not a key, and half the time it writes the name it just put in a bubble.
 */
export const STANDING_STEP_MAX = 1;
export const STANDING_ABS_MAX = 3;

export function applyFelt(
  people: ReadonlyArray<{ id: string; name: string; standing?: number | null }>,
  felt: ReadonlyArray<{ who: string; delta: number }>,
): Map<string, number> {
  const moved = new Map<string, number>();
  const seen = new Set<string>();
  for (const f of felt) {
    const step = Math.max(-STANDING_STEP_MAX, Math.min(STANDING_STEP_MAX, Math.trunc(f.delta)));
    if (step === 0) continue;
    const target = people.find((p) => sameName(p.id, f.who) || sameName(p.name, f.who));
    // An unresolvable name is DROPPED, not minted. A standing row for somebody
    // who is not in the cast would be a relationship the player can never see
    // or repair — the same objection `LIFE-NEED-6` makes to a need naming a
    // stranger.
    if (!target || seen.has(target.id)) continue;
    seen.add(target.id);
    const next = Math.max(
      -STANDING_ABS_MAX,
      Math.min(STANDING_ABS_MAX, (target.standing ?? 0) + step),
    );
    if (next !== (target.standing ?? 0)) moved.set(target.id, next);
  }
  return moved;
}

/** LIFE-GOAL-6: the number beside the icon. Null when the world has no saga
 *  goal, so the chrome can hide rather than render a meaningless zero. */
export function daysLeft(ladder: GoalLadder): number | null {
  if (!ladder.saga) return null;
  return Math.max(0, ladder.saga.days - ladder.dayIndex);
}
