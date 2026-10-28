/**
 * LIFE-TIME-1 — the world clock.
 *
 * REPORTED 2026-08-03: a morning at the bakery, one walk to the bay, and the
 * bay rendered as night.
 */
import { describe, expect, it } from 'vitest';
import {
  advanceTimeOfDay,
  readTimeAdvance,
  readTimeOfDay,
  TIMES_OF_DAY,
} from './timeOfDay';

/**
 * SRV-PROMPT-8..13 batch 1 — the backdrop half of this module moved to the
 * server. Read as TEXT rather than imported, exactly as `modelConfig.test.ts`
 * reads the backdrop SI: this is the `app` vitest project, the prompt is in the
 * `functions` one, and `no-restricted-imports` bans reaching across with a
 * `../../../` path. The assertion is over the file's bytes either way.
 */
describe('advanceTimeOfDay', () => {
  it('LIFE-TIME-1 — "none" holds the clock still', () => {
    expect(advanceTimeOfDay('morning', 'none')).toBe('morning');
  });

  it('LIFE-TIME-1 — "some" is one step, "lots" is two', () => {
    expect(advanceTimeOfDay('morning', 'some')).toBe('midday');
    expect(advanceTimeOfDay('morning', 'lots')).toBe('afternoon');
  });

  it('LIFE-TIME-1 — the clock NEVER runs backwards', () => {
    // The whole reason the model reports an ADVANCE rather than a target: asked
    // "what time is it", it answers "morning" in the evening, because most
    // scenes read like mornings. There is no input to this function that moves
    // time backwards.
    for (const from of TIMES_OF_DAY) {
      for (const adv of ['none', 'some', 'lots'] as const) {
        const to = advanceTimeOfDay(from, adv);
        expect(TIMES_OF_DAY.indexOf(to), `${from} + ${adv}`).toBeGreaterThanOrEqual(
          TIMES_OF_DAY.indexOf(from),
        );
      }
    }
  });

  it('LIFE-TIME-1 — clamps at night rather than rolling over silently', () => {
    // "And then it was suddenly morning again" is something the player must be
    // TOLD, not something a counter does behind their back.
    expect(advanceTimeOfDay('evening', 'lots')).toBe('night');
    expect(advanceTimeOfDay('night', 'lots')).toBe('night');
  });

  it('LIFE-TIME-1 — only nextMorning wraps, and it wraps to morning not dawn', () => {
    expect(advanceTimeOfDay('night', 'nextMorning')).toBe('morning');
    expect(advanceTimeOfDay('midday', 'nextMorning')).toBe('morning');
  });
});

describe('readTimeAdvance', () => {
  it('LIFE-CAST-4 — anything unusable means no time passed', () => {
    for (const v of [null, undefined, '', 'later', 7, {}, 'NONE']) {
      expect(readTimeAdvance(v), String(v)).toBe('none');
    }
  });

  it('passes the four real values through', () => {
    for (const v of ['none', 'some', 'lots', 'nextMorning'] as const) {
      expect(readTimeAdvance(v)).toBe(v);
    }
  });
});

describe('readTimeOfDay', () => {
  it('defaults to morning for a world that has never set one', () => {
    expect(readTimeOfDay(undefined)).toBe('morning');
    expect(readTimeOfDay(null)).toBe('morning');
    expect(readTimeOfDay('teatime')).toBe('morning');
  });

  it('passes every real value through', () => {
    for (const t of TIMES_OF_DAY) expect(readTimeOfDay(t)).toBe(t);
  });
});

/**
 * ✅ THE RENDER + DRIFT BLOCKS MOVED with SRV-PROMPT-8..13 batch 8, to
 * `functions/src/__tests__/life/timeOfDayGloss.test.ts`.
 *
 * ⚠ AND THE DUPLICATION THEY GUARDED DID NOT SIMPLY EXPIRE — it very nearly
 * became a SECOND one. `renderTimeOfDay` moved server-side with `life_step`,
 * which would have put BOTH gloss tables on the server rather than merging
 * them. `lifeStepBlocks.ts` now imports `BACKDROP_TIME_OF_DAY_GLOSS` instead,
 * so there is one copy and nothing left to compare; the moved test asserts
 * THAT, which is strictly stronger than the agreement it used to check.
 *
 * What stays here is the RATCHET — `advanceTimeOfDay`, `readTimeAdvance`,
 * `readTimeOfDay` — which is code owning the number and never migrates.
 */
