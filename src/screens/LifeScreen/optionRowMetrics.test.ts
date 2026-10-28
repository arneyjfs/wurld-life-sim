import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OPTION_BAR_CLASS,
  OPTION_CHIP_MIN_H,
  OPTION_CHIP_SKELETON_H,
  OPTION_FRAME_CLASS,
  OPTION_FRAME_COLUMN_CLASS,
  OPTION_FRAME_SLOT_CLASS,
  OPTION_GRID_CLASS,
  OPTION_GRID_MIN_H,
  SKELETON_CHIP_COUNT,
} from './optionRowMetrics';

/**
 * LIFE-UI-10 — the options row reserves the same box in every phase.
 *
 * Asserted against the SOURCE rather than a render, because the defect is that
 * three different components each picked their own height. A render test would
 * have to mount all three phases and measure, and jsdom does not do layout —
 * it would pass while the heights disagreed. What actually has to hold is that
 * the three call sites read from ONE constant, and that is a source fact.
 */
const read = (f: string) =>
  readFileSync(join(__dirname, f), 'utf8');

describe('LIFE-UI-10 — one reserved height for the options row', () => {
  it('LIFE-UI-10 — the chip floor and the skeleton height are the same number', () => {
    // The swap from skeleton to real chips is the moment the jump was visible.
    const floor = OPTION_CHIP_MIN_H.match(/\[([\d.]+)rem\]/)?.[1];
    const skeleton = OPTION_CHIP_SKELETON_H.match(/\[([\d.]+)rem\]/)?.[1];
    expect(floor).toBeDefined();
    expect(skeleton).toBe(floor);
  });

  it('LIFE-UI-10 — the grid reserves two chip rows plus the gap', () => {
    const chip = Number(OPTION_CHIP_MIN_H.match(/\[([\d.]+)rem\]/)![1]);
    const grid = Number(OPTION_GRID_MIN_H.match(/\[([\d.]+)rem\]/)![1]);
    // gap-2 = 0.5rem between the two rows.
    expect(grid).toBeCloseTo(chip * 2 + 0.5, 2);
  });

  it('LIFE-UI-10 — ActionBar chips use the shared floor, not a literal', () => {
    const src = read('ActionBar.tsx');
    expect(src).toContain('OPTION_CHIP_MIN_H');
  });

  it('LIFE-UI-10 — the skeleton and the thinking bar use the shared metrics', () => {
    const src = read('LifeScreenBottom.tsx');
    expect(src).toContain('OPTION_CHIP_SKELETON_H');
    expect(src).toContain('OPTION_GRID_MIN_H');
    // The old hand-rolled height must be gone from both, or the row can still
    // disagree with itself.
    expect(src).not.toContain('h-[3.25rem]');
  });
});

/**
 * LIFE-UI-12 — the LOADING options block is the LOADED options block with its
 * content replaced. The measurements are shared constants, so the two states
 * cannot drift apart in the way LIFE-UI-10's `min-h` floor alone could not
 * prevent (the floor said "at least this tall"; the frame row above the grid
 * was simply absent while loading, so the block was a whole row shorter).
 *
 * Same reasoning as above for asserting on the CONSTANTS + the source rather
 * than on a rendered height: jsdom does no layout.
 */
const rem = (cls: string): number =>
  Number(cls.match(/\[([\d.]+)rem\]/)![1]);
/** Tailwind spacing step → rem (`gap-2` = 0.5rem). */
const spacing = (n: number): number => n * 0.25;

describe('LIFE-UI-12 — the loading block is the loaded block, same box', () => {
  it('LIFE-UI-12 — the skeleton fills exactly two grid rows', () => {
    const cols = Number(OPTION_GRID_CLASS.match(/grid-cols-(\d+)/)![1]);
    expect(SKELETON_CHIP_COUNT % cols).toBe(0);
    expect(SKELETON_CHIP_COUNT / cols).toBe(2);
  });

  it('LIFE-UI-12 — the reserved grid height IS the skeleton grid height', () => {
    // Derived from the SAME class string the real grid uses, so a change to
    // `gap-2` or `grid-cols-2` has to be reflected in the reservation.
    const cols = Number(OPTION_GRID_CLASS.match(/grid-cols-(\d+)/)![1]);
    const gap = spacing(Number(OPTION_GRID_CLASS.match(/gap-(\d+)/)![1]));
    const rows = SKELETON_CHIP_COUNT / cols;
    const skeletonGrid = rows * rem(OPTION_CHIP_SKELETON_H) + (rows - 1) * gap;
    expect(rem(OPTION_GRID_MIN_H)).toBeCloseTo(skeletonGrid, 2);
  });

  it('LIFE-UI-12 — the frame slot has a FIXED height, so its content cannot resize it', () => {
    // The eyebrow ("What do you do?") and the thinking phrase are different
    // strings with a dots indicator on one of them. A content-sized slot would
    // let them differ by a pixel or two; a fixed height cannot.
    expect(OPTION_FRAME_SLOT_CLASS).toMatch(/(?:^|\s)h-\d/);
  });

  it('LIFE-UI-12 — ActionBar is built from the shared bar + grid classes, not literals', () => {
    const src = read('ActionBar.tsx');
    expect(src).toContain('OPTION_BAR_CLASS');
    expect(src).toContain('OPTION_GRID_CLASS');
    expect(src).not.toContain("'grid grid-cols-2 gap-2 max-w-md mx-auto'");
    expect(src).not.toContain('"px-3 pt-2 pb-keyboard bg-(--color-bg)"');
  });

  it('LIFE-UI-12 — the loading branch is built from the SAME shared classes', () => {
    const src = read('LifeScreenBottom.tsx');
    for (const name of [
      'OPTION_FRAME_CLASS',
      'OPTION_FRAME_SLOT_CLASS',
      'OPTION_BAR_CLASS',
      'OPTION_GRID_CLASS',
      'SKELETON_CHIP_COUNT',
    ]) {
      expect(src).toContain(name);
    }
    // The old one-line centred thinking bar reserved the grid but had no frame
    // row and its own padding — the whole reason the block changed height.
    expect(src).not.toContain('px-4 pt-3 pb-[max(var(--spacing-safe-bottom),1rem)]');
  });

  it('LIFE-UI-12 — the bar class still carries `.pb-keyboard` (COMP-KB-14)', () => {
    expect(OPTION_BAR_CLASS).toContain('pb-keyboard');
    // The frame sits directly above the bar and must not add its own bottom
    // padding, or the two states pick up different seams.
    expect(OPTION_FRAME_CLASS).not.toMatch(/(?:^|\s)pb-/);
  });
});

/**
 * LIFE-UI-15 — the eyebrow labels the column it is labelling.
 *
 * Found 2026-08-09 in the v2 branch's handover, and confirmed here: the chip
 * grid is `max-w-md mx-auto` (centred, 28rem) while `OPTION_FRAME_CLASS` had NO
 * width constraint, so "WHAT DO YOU DO?" spanned the full viewport. On a 1280px
 * desktop the label sat at x≈12 and the chips it labels began at x≈416.
 *
 * Invisible on a phone — below 448px `max-w-md` never binds, so the two agree
 * by accident. That is why it survived: every screenshot review was a phone.
 *
 * A CLASS assertion, not a layout proof. jsdom has no layout, and the v2
 * handover's own hardest-won lesson is that 171 green unit tests coexisted with
 * a page that put the grid above the dialogue. This pins the constraint the two
 * containers must SHARE; only a real viewport can prove they line up.
 */
describe('LIFE-UI-15 — the eyebrow shares the chip grid\'s column', () => {
  it('the frame column and the chip grid carry the SAME width constraint', () => {
    const width = (c: string) =>
      c.split(/\s+/).filter((t) => t === 'max-w-md' || t === 'mx-auto').sort().join(' ');
    expect(width(OPTION_FRAME_COLUMN_CLASS)).toBe(width(OPTION_GRID_CLASS));
    expect(width(OPTION_FRAME_COLUMN_CLASS)).not.toBe('');
  });

  it('the frame and the bar share the same horizontal inset', () => {
    // Same column is not enough: a different px would offset the label inside
    // it on any screen narrower than the column.
    const inset = (c: string) => c.split(/\s+/).find((t) => /^px-\d/.test(t));
    expect(inset(OPTION_FRAME_CLASS)).toBe(inset(OPTION_BAR_CLASS));
  });
});
