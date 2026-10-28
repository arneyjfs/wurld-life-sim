/**
 * LIFE-BENCH-3 — `PLAY_SEEDS` builds a valid world list and leaves the
 * benchmark's own defaults alone.
 *
 * Free: pure logic over `WORLD_MODES`, no API calls, so it runs in `npm test`
 * with everything else. (The money-spending harness files are `.probe.ts` /
 * `run.play.ts` and are excluded from the main config by name — this one is
 * deliberately a `.test.ts` because it costs nothing.)
 */
import { describe, expect, it } from 'vitest';
import { WORLD_MODES } from '@/screens/LifeScreen/worldModes';
import { chapterWorlds, modeForSeed, parsePlaySeeds, smokeWorlds } from './playSeeds';

const opts = { scenes: 2, turnsPerScene: 14 };

describe('LIFE-BENCH-3 — parsePlaySeeds', () => {
  it('unset or empty yields no seeds, so the caller keeps DEFAULT_WORLDS', () => {
    // The whole safety property: absent the flag, the benchmark is the benchmark.
    expect(parsePlaySeeds(undefined)).toEqual([]);
    expect(parsePlaySeeds('')).toEqual([]);
    expect(parsePlaySeeds('  ,  ,')).toEqual([]);
  });

  it('splits and trims a comma list', () => {
    expect(parsePlaySeeds(' restaurant , heist ')).toEqual(['restaurant', 'heist']);
  });
});

describe('LIFE-BENCH-3 — modeForSeed', () => {
  it('reads the mode off the chip grid rather than guessing', () => {
    expect(modeForSeed('restaurant')).toBe('realistic');
    expect(modeForSeed('heist')).toBe('fantasy');
    // The one that matters after LIFE-ONBOARD-18: a period western is fantasy
    // by MODE even though it contains no magic.
    expect(modeForSeed('outlaw_trail')).toBe('fantasy');
  });

  it('THROWS on a key that is not a chip — a typo must not fall through', () => {
    // The expensive failure this prevents: `PLAY_SEEDS=resturant` silently
    // running the full 8/8/2/2 benchmark, and the result being read as a
    // smoke test of a seed that was never exercised.
    expect(() => modeForSeed('resturant')).toThrow(/not a chip/);
    expect(() => modeForSeed('')).toThrow(/not a chip/);
  });

  it('every real chip key is smoke-testable', () => {
    for (const key of WORLD_MODES.flatMap((m) => m.chips.map((c) => c.key))) {
      if (key === 'surprise') continue;
      expect(() => modeForSeed(key), key).not.toThrow();
    }
  });
});

describe('LIFE-BENCH-3 — smokeWorlds', () => {
  it('varies learner, language and level across a multi-seed run', () => {
    const w = smokeWorlds(['restaurant', 'heist', 'outlaw_trail', 'magic_university'], opts);
    expect(w).toHaveLength(4);
    expect(new Set(w.map((x) => x.practiceLanguage)).size).toBe(4);
    expect(new Set(w.map((x) => x.name)).size).toBe(4);
    expect(w.map((x) => x.mode)).toEqual(['realistic', 'fantasy', 'fantasy', 'fantasy']);
  });

  it('carries the SHORT scene budget through', () => {
    const [w] = smokeWorlds(['restaurant'], { scenes: 3, turnsPerScene: 9 });
    expect(w!.scenes).toBe(3);
    expect(w!.turnsPerScene).toBe(9);
  });

  it('labels each world with its seed, so the report says what was tested', () => {
    expect(smokeWorlds(['heist'], opts)[0]!.label).toContain('heist');
  });

  it('wraps past the name/language table rather than producing undefined', () => {
    const many = smokeWorlds(Array.from({ length: 10 }, () => 'restaurant'), opts);
    expect(many.every((w) => !!w.name && !!w.practiceLanguage)).toBe(true);
  });
});

/**
 * LIFE-BENCH-7 — `chapterWorlds`. Long runs whose scene count is a CEILING,
 * because `playWorld` stops at `arcStage: 'concluding'`. The distinction from
 * `smokeWorlds` is not cosmetic: a SHORT world can never reach a chapter end,
 * so an artefact labelled SMOKE tells you nothing about whether the
 * through-line lands.
 */
describe('LIFE-BENCH-7 — chapterWorlds', () => {
  it('labels the run CHAPTER, so a report cannot be read as a smoke test', () => {
    expect(chapterWorlds(['restaurant'], opts)[0]!.label).toBe('CHAPTER · restaurant');
  });

  it('varies learner, language and level exactly as the smoke set does', () => {
    const w = chapterWorlds(['noir_detective', 'restaurant', 'sea_voyage'], opts);
    expect(new Set(w.map((x) => x.practiceLanguage)).size).toBe(3);
    expect(new Set(w.map((x) => x.difficulty)).size).toBe(3);
    expect(new Set(w.map((x) => x.name)).size).toBe(3);
  });

  it('resolves each seed to the mode the UI would offer it in', () => {
    const w = chapterWorlds(['restaurant', 'noir_detective'], opts);
    expect(w.map((x) => x.mode)).toEqual(['realistic', 'fantasy']);
  });

  it('rejects a seed that is not a chip, rather than defaulting it', () => {
    expect(() => chapterWorlds(['restarant'], opts)).toThrow(/not a chip/);
  });

  it('carries the scene ceiling through', () => {
    const [w] = chapterWorlds(['restaurant'], { scenes: 10, turnsPerScene: 14 });
    expect(w!.scenes).toBe(10);
    expect(w!.turnsPerScene).toBe(14);
  });

  it('sets stopAtChapterEnd — that flag is what makes `scenes` a CEILING', () => {
    expect(chapterWorlds(['restaurant'], opts)[0]!.stopAtChapterEnd).toBe(true);
  });

  it('smokeWorlds does NOT set it, and neither may any other spec by default', () => {
    // IT SHIPPED UNCONDITIONAL AND BROKE THE BENCHMARK. `DEFAULT_WORLDS`' LONG
    // runs exist because "a 2-scene run cannot fail those dimensions, so a
    // benchmark made only of short runs would report health it never
    // measured" — and the first baseline world after the change declared
    // `concluding` on scene 0 and produced a ONE-SCENE artefact where eight
    // were wanted. A measurement mode is not a default.
    expect(smokeWorlds(['restaurant'], opts)[0]!.stopAtChapterEnd).toBeUndefined();
  });
});
