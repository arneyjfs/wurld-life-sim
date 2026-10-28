import { describe, expect, it } from 'vitest';
import {
  composeSlots,
  gridHasActiveType,
  gridSizeFor,
  renderSlots,
  slotTypesAreValid,
} from './composeSlots';

/**
 * LIFE-SLOTS-1 — the grid decided in code.
 *
 * The properties asserted here are the ones that CANNOT be guaranteed while the
 * model owns the shape, which is the entire argument for moving it: a grid of
 * three identical types, or the same three rows every turn, are the two
 * complaints that started this work and both are now impossible by
 * construction rather than by instruction.
 */
describe('LIFE-SLOTS-1 — composeSlots', () => {
  it('is pure and reproducible for a given turn', () => {
    expect(composeSlots(7)).toEqual(composeSlots(7));
  });

  it('never repeats a TYPE inside one grid', () => {
    // Three `ask` chips is "the same options every time" in its purest form.
    for (let t = 0; t < 60; t += 1) {
      const types = composeSlots(t).map((s) => s.type);
      expect(new Set(types).size).toBe(types.length);
    }
  });

  it('varies the grid SIZE — a fixed three is sameness one level up', () => {
    const sizes = new Set(Array.from({ length: 40 }, (_, t) => gridSizeFor(t)));
    expect(sizes.size).toBeGreaterThan(1);
    for (const s of sizes) {
      expect(s).toBeGreaterThanOrEqual(2);
      expect(s).toBeLessThanOrEqual(4);
    }
  });

  it('never repeats a grid inside 15 turns — measured, not assumed', () => {
    // Two earlier claims here were wrong: a 40-turn period argued from
    // coprimality, then a 12-turn window. The real smallest gap under the old
    // two-rotation scheme was FIVE, i.e. inside a scene. The cycle is now the
    // 15 distinct (size, offset) grids taken once each, so the gap is 15 by
    // construction. This asserts the property that actually protects a player.
    const sig = (t: number) => `${composeSlots(t).length}:${composeSlots(t).map((s) => s.type).join(',')}`;
    for (let start = 0; start < 30; start += 1) {
      const seen = new Set<string>();
      for (let t = start; t < start + 15; t += 1) seen.add(sig(t));
      expect(seen.size).toBe(15);
    }
  });

  it('ALWAYS offers at least one option that acts on the world', () => {
    // Previously a rule asked of the model; now a property of the composer.
    for (let t = 0; t < 60; t += 1) expect(gridHasActiveType(composeSlots(t))).toBe(true);
  });

  it('ids are o1..oN in order, with no gaps', () => {
    for (const t of [0, 1, 2, 3, 11]) {
      const slots = composeSlots(t);
      expect(slots.map((s) => s.id)).toEqual(slots.map((_, i) => `o${i + 1}`));
    }
  });

  it('only ever emits types the client understands', () => {
    for (let t = 0; t < 40; t += 1) expect(slotTypesAreValid(composeSlots(t))).toBe(true);
  });

  it('handles a negative or fractional turn index rather than throwing', () => {
    // `turnIndex` is `input.turnIndex ?? input.events.length` at the call site,
    // and a resumed world has produced surprising values there before.
    expect(() => composeSlots(-3)).not.toThrow();
    expect(composeSlots(-3).length).toBeGreaterThan(0);
    expect(composeSlots(2.7)).toEqual(composeSlots(2));
  });
});

describe('LIFE-SLOTS-1 — renderSlots', () => {
  it('renders one row per slot, carrying id and type', () => {
    const block = renderSlots(composeSlots(0));
    for (const s of composeSlots(0)) {
      expect(block).toContain(`id="${s.id}"`);
      expect(block).toContain(`type="${s.type}"`);
    }
  });

  it('tells the model to echo ids and to phrase from the last beat', () => {
    const block = renderSlots(composeSlots(1));
    expect(block).toMatch(/echoing each/i);
    expect(block).toMatch(/never invent an id/i);
    // v2's F.4 left this open: the grid and the beat are written in one call and
    // nothing made the labels react to the beat. Stated where the labels are
    // written, not in a general rule three hundred lines away.
    expect(block).toMatch(/plausible next move from the last beat/i);
  });
});
