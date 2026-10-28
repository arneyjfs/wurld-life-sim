import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { WORLD_MODES } from './worldModes';

/**
 * LIFE-ONBOARD-14 — a chip hint sets the UNIVERSE, not the storyline.
 *
 * The first pass at these hints wrote a plot hook for every seed. Read at the
 * moment of choosing, nine hooks compete with each other and none of them let
 * the player picture LIVING somewhere — and two of them actively sold the
 * wrong world ("backpacking sounds like someone's stalking you"; retirement
 * lost its whimsy to a menacing village). The story is generated downstream
 * from the same universe brief, so a hint that names the plot only pre-empts
 * that for everyone who picks the chip.
 *
 * The three checks below are the mechanically-testable part of that rule:
 * coverage, length, and the specific hook SHAPES that were reported. The old
 * copy is kept as negative fixtures so the shape check is known to fail on
 * the thing it exists to prevent — otherwise it is a regex that has never
 * caught anything.
 */

const HINT_MAX_CHARS = 90;

const chipKeys = [...new Set(WORLD_MODES.flatMap((m) => m.chips.map((c) => c.key)))];

const strings = en as Record<string, string>;
const hintOf = (key: string) => strings[`life.onboard.seed.chip.${key}.hint`];

/**
 * Hook shapes drawn from the copy that was reported, generalised only as far
 * as the defect goes:
 *  - a second-person reveal ("you can prove it", "you did not ask for")
 *  - another character acting ON the player ("keeps turning up", "would
 *    rather you had not asked", "who is lying")
 *  - a plot secret stated as fact ("is a forgery", "is keeping something
 *    from you", "someone has to decide")
 */
const HOOK_SHAPES: { name: string; re: RegExp }[] = [
  { name: 'second-person reveal', re: /\byou (can|could) prove\b|\byou did not ask\b|\byou had not\b/i },
  { name: 'someone acting on you', re: /\bkeeps? (turning up|appearing|following)\b|\bwould rather you\b|\bwho is lying\b/i },
  { name: 'plot secret as fact', re: /\bis a forgery\b|\bkeeping something from you\b|\bhas to decide\b|\bnever empty\b/i },
  // A universe is a standing state; reporting a CHANGE underway is already
  // narrating. "Lately the coastline has been moving to match them" is a
  // first sentence, not a setting.
  { name: 'a change already underway', re: /\blately\b|\bever since\b|\bhas (been|started) \w+ing\b|\bno longer\b/i },
];

describe('LIFE-ONBOARD-14 — chip hints describe the universe, not the plot', () => {
  it('every chip key has a non-empty label and hint in en.ts', () => {
    for (const key of chipKeys) {
      expect(strings[`life.onboard.seed.chip.${key}`], `label for ${key}`).toBeTruthy();
      expect(hintOf(key), `hint for ${key}`).toBeTruthy();
    }
  });

  it(`keeps every hint to one short line (≤ ${HINT_MAX_CHARS} chars)`, () => {
    for (const key of chipKeys) {
      const hint = hintOf(key)!;
      expect(hint.length, `${key}: "${hint}"`).toBeLessThanOrEqual(HINT_MAX_CHARS);
    }
  });

  it('uses none of the reported plot-hook shapes', () => {
    for (const key of chipKeys) {
      const hint = hintOf(key)!;
      for (const shape of HOOK_SHAPES) {
        expect(shape.re.test(hint), `${key} reads as a ${shape.name}: "${hint}"`).toBe(false);
      }
    }
  });

  /**
   * The guard on the guard. These are the exact strings that shipped before
   * 2026-08-01; if the checks above stop rejecting them, they have stopped
   * asserting anything.
   */
  describe('the checks reject the copy they were written against', () => {
    const OLD_HINTS = [
      'A hidden academy that is keeping something from you',
      'The family land, and someone has to decide its future',
      'You draw the maps. Lately the coastline has been moving to match them',
      'It runs every night to a station no timetable lists, and it is never empty',
      'The relic your town has guarded for four hundred years is a forgery, and you can prove it',
      'You came for a name on a headstone. The village knows the name, and would rather you had not asked',
      'A bunk, a night bus, and someone from the first hostel who keeps turning up in the next town',
      'You bought the house cheap. The village is kind, attentive, and will not discuss the family who left it',
      'Rain-slicked streets and a client who is lying',
    ];

    it.each(OLD_HINTS)('rejects %s', (hint) => {
      const tooLong = hint.length > HINT_MAX_CHARS;
      const hooked = HOOK_SHAPES.some((s) => s.re.test(hint));
      expect(tooLong || hooked).toBe(true);
    });
  });
});
