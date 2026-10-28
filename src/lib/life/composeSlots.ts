/**
 * LIFE-SLOTS-1 — CODE composes the whole option grid; the model only phrases it.
 *
 * ── WHAT ALREADY EXISTED, so the increment is honest ────────────────────────
 *
 * v1 is not starting from zero. `requiredTypeForTurn` already rotates ONE
 * required action type per turn and injects it (`optionGrid.ts`, the PREVENT
 * half), with `gradeOptionSet` as a reject-backstop. So partial code ownership
 * of the grid has shipped and works.
 *
 * What this adds is the rest of it: **how MANY chips, and the type of EVERY
 * one**, decided in code and handed to the model as filled-in slots. The model
 * stops choosing the shape of the grid and only writes the labels.
 *
 * ── WHY IT MIGHT MATTER, AND WHY THAT IS NOT ASSUMED ────────────────────────
 *
 * Two separate claims, and only one is being tested here:
 *
 *  1. **PROMPT LENGTH.** The structural option rules — how many, which types,
 *     spread, freedom, required-type injection — are ~12% of the SI (measured;
 *     an earlier estimate of 38% conflated them with the PHRASING rules, which
 *     survive because the model still writes labels). If stories hold, that 12%
 *     is deletable. **This is the claim under test.**
 *
 *  2. **AGENCY.** The parallel v2 engine moved the grid into code for this
 *     reason and it did NOT work: three free options scored AGENCY 2/5, adding
 *     a cost trilemma left it at 2/5, and adding failure reached 3 on one
 *     fixture and 2 on the other, missing its own gate (`LIFE-ENGINE-CMP-2`).
 *     **Nothing here rests on that claim** and this module deliberately does
 *     not implement the deadline or the trilemma.
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────
 *
 * Pure, keyed on `turnIndex`. No `Math.random`, so a grid is reproducible in a
 * replay, a test and the harness — the same property `requiredTypeForTurn`
 * already relies on.
 */
import { ACTIVE_OPTION_TYPES, ZOptionType, type OptionType } from '@/types/lifeState';

export type Slot = { id: string; type: OptionType; brief: string };

const TYPE_ROTATION: readonly OptionType[] = ['do', 'ask', 'move', 'observe', 'offer'];

/**
 * The grid cycle: `[size, typeOffset]` per turn, indexed by `turnIndex % 15`.
 *
 * A TABLE rather than two independent rotations, and the reason is measured.
 * The first version rotated size on 8 and offset on 5 and the comment claimed a
 * 40-turn period from coprimality. Wrong twice: the real period was 15, and
 * worse, the smallest gap between two IDENTICAL grids was **5 turns** — inside
 * a scene, so a player could meet the same shape twice in one scene, which is
 * precisely the sameness this module exists to prevent. A search over stride
 * and size-array variants could not beat 5, and the reason is arithmetic: sizes
 * {2,3,4} x offsets {0..4} is only 15 distinct grids, so nothing shorter than a
 * full 15-cycle can space them evenly.
 *
 * So the cycle IS the 15 combinations, each exactly once. Minimum gap between
 * repeats is therefore 15 by construction — provable, not searched for, and
 * comfortably past a scene. Sizes run 3,2,4 so adjacent grids differ in width.
 */
const GRID_CYCLE: readonly (readonly [number, number])[] = [
  [3, 0], [2, 1], [4, 2], [3, 3], [2, 4],
  [4, 0], [3, 1], [2, 2], [4, 3], [3, 4],
  [2, 0], [4, 1], [3, 2], [2, 3], [4, 4],
];

const BRIEF: Record<OptionType, string> = {
  ask: 'ask someone here a question — about the situation, themselves, or what happens next',
  do: 'act physically on an object, a task, or a person in this place',
  move: 'go somewhere, follow someone, or leave for another place',
  observe: 'look closer, listen, wait, or read something here',
  offer: 'propose, agree, refuse, or change the subject',
  leave: 'step away from the situation entirely',
};

const cycleFor = (turnIndex: number): readonly [number, number] =>
  GRID_CYCLE[Math.abs(Math.trunc(turnIndex)) % GRID_CYCLE.length]!;

export function gridSizeFor(turnIndex: number): number {
  return cycleFor(turnIndex)[0];
}

/**
 * The grid for one turn: `size` slots, types drawn from the rotation without
 * repeating within the grid, ids `o1..oN`.
 *
 * Types never repeat inside one grid — a grid of three `ask` chips is the
 * "same options every time" complaint in its purest form, and preventing it in
 * code is exactly the point of moving the decision here.
 */
export function composeSlots(turnIndex: number): Slot[] {
  const [size, offset] = cycleFor(turnIndex);
  const out: Slot[] = [];
  for (let i = 0; i < size; i += 1) {
    const type = TYPE_ROTATION[(offset + i) % TYPE_ROTATION.length]!;
    out.push({ id: `o${i + 1}`, type, brief: BRIEF[type] });
  }
  return out;
}

/** The `<slots>` block the model fills in. Ids are echoed back verbatim. */
export function renderSlots(slots: readonly Slot[]): string {
  const rows = slots
    .map((s) => `  <slot id="${s.id}" type="${s.type}">${s.brief}</slot>`)
    .join('\n');
  return [
    `<slots>`,
    rows,
    `</slots>`,
    `Return EXACTLY one option per slot, in this order, echoing each \`id\` and \`type\` verbatim. Never add a slot, never drop one, never invent an id. The slot says WHAT the option is about; the moment on screen says how it is phrased — each label must be a plausible next move from the last beat.`,
  ].join('\n');
}

/**
 * Every type the composer emits parses as an `OptionType`.
 *
 * A first version checked against `ACTIVE_OPTION_TYPES` and failed its own
 * test — that constant is the ACT-ON-THE-WORLD subset (`do`/`move`/`offer`/
 * `leave`), not the list of valid types, and `ask`/`observe` are perfectly
 * legal. Checked against the schema itself now, which cannot drift from it.
 */
export function slotTypesAreValid(slots: readonly Slot[]): boolean {
  return slots.every((s) => ZOptionType.safeParse(s.type).success);
}

/**
 * LIFE-GRID: at least one option per grid must ACT on the world rather than
 * interrogate it — the rule that keeps a warm, low-key world from reading as a
 * Q&A bot. It was previously requested of the model; here it is a property of
 * the composer, so it cannot be missed.
 */
export function gridHasActiveType(slots: readonly Slot[]): boolean {
  return slots.some((s) => (ACTIVE_OPTION_TYPES as readonly string[]).includes(s.type));
}
