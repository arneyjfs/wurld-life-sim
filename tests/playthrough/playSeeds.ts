/**
 * LIFE-BENCH-3 — `PLAY_SEEDS` smoke-tests specific seeds without editing the
 * benchmark.
 *
 *     PLAY_SEEDS=restaurant,heist npm run test:playthrough
 *
 * Written after doing it the other way. Checking that six new seeds generated
 * sane worlds meant hand-editing `DEFAULT_WORLDS` in `run.play.ts`, running,
 * and remembering to revert — and the revert is the part that goes wrong. Left
 * in, it silently replaces the benchmark's 8/8/2/2 mix with whatever the smoke
 * test needed, so every composite measured afterwards sits on a different
 * baseline and nothing says so. That is worse than the inconvenience it saves,
 * and it is the kind of thing that hides for weeks.
 *
 * This lives in its own module rather than inside `run.play.ts` so it can be
 * unit-tested. `run.play.ts` is a vitest FILE — importing it to test it would
 * run the benchmark, so anything asserted about it there would have to be a
 * copy of the logic, which is a test that passes forever and catches nothing.
 */
import { WORLD_MODES } from '@/screens/LifeScreen/worldModes';
import type { WorldSpec } from './playWorld';

/** Names and language/level pairs rotate, so a multi-seed run varies the
 *  learner rather than testing one language four times over. */
const SMOKE_NAMES = ['Alice', 'Ines', 'Tomas', 'Yuki', 'Bea', 'Karim', 'Nora', 'Otto'];
const SMOKE_LANGS: Array<readonly [string, number]> = [
  ['French', 3], ['Spanish', 4], ['German', 5], ['Japanese', 2],
  ['Italian', 3], ['Portuguese', 4], ['Dutch', 2], ['Polish', 5],
];

/**
 * The seed's mode comes from `WORLD_MODES` — the same table the chip grid
 * renders from — so a seed cannot be smoke-tested in a register the UI would
 * never offer it in. An unknown key THROWS rather than defaulting: a typo that
 * quietly fell through to the full benchmark would be read as a smoke-test
 * result, which is the expensive way to learn you misspelled `restaurant`.
 */
export function modeForSeed(seed: string): 'realistic' | 'fantasy' {
  for (const m of WORLD_MODES) {
    if (m.chips.some((c) => c.key === seed)) return m.mode;
  }
  throw new Error(
    `PLAY_SEEDS: "${seed}" is not a chip in WORLD_MODES. Known: ` +
      WORLD_MODES.flatMap((m) => m.chips.map((c) => c.key)).join(', '),
  );
}

/** Parse the env var. Empty / unset ⇒ [] ⇒ the caller keeps its defaults. */
export function parsePlaySeeds(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** One SHORT world per named seed. */
export function smokeWorlds(
  seeds: readonly string[],
  opts: { scenes: number; turnsPerScene: number; systemLanguage?: string },
): WorldSpec[] {
  return seeds.map((seedKey, i) => {
    const [practiceLanguage, difficulty] = SMOKE_LANGS[i % SMOKE_LANGS.length]!;
    return {
      name: SMOKE_NAMES[i % SMOKE_NAMES.length]!,
      label: `SMOKE · ${seedKey}`,
      seedKey,
      mode: modeForSeed(seedKey),
      practiceLanguage,
      systemLanguage: opts.systemLanguage ?? 'English (British)',
      difficulty,
      scenes: opts.scenes,
      turnsPerScene: opts.turnsPerScene,
    };
  });
}

/**
 * LIFE-BENCH-7 — `PLAY_CHAPTER` plays a seed to the END OF ITS CHAPTER.
 *
 *     PLAY_CHAPTER=noir_detective,restaurant,sea_voyage npm run test:playthrough
 *
 * Distinct from `PLAY_SEEDS`, which makes SHORT worlds to smoke-test world
 * CREATION. These are LONG worlds whose scene count is a CEILING: `playWorld`
 * stops the moment a scene resolves with `arcStage: 'concluding'`, so the run
 * ends where the story ends rather than where the loop runs out. That
 * distinction is the whole point — until it existed, no artefact could tell
 * "the chapter landed" apart from "the harness stopped counting".
 *
 * Same rotation as `smokeWorlds` over language + level, so three seeds are
 * three different learners rather than one language three times. Same
 * `modeForSeed` lookup, so a seed cannot be played in a register the UI would
 * never offer it in.
 */
export function chapterWorlds(
  seeds: readonly string[],
  opts: { scenes: number; turnsPerScene: number; systemLanguage?: string },
): WorldSpec[] {
  return seeds.map((seedKey, i) => {
    const [practiceLanguage, difficulty] = SMOKE_LANGS[i % SMOKE_LANGS.length]!;
    return {
      name: SMOKE_NAMES[i % SMOKE_NAMES.length]!,
      label: `CHAPTER · ${seedKey}`,
      seedKey,
      mode: modeForSeed(seedKey),
      practiceLanguage,
      systemLanguage: opts.systemLanguage ?? 'English (British)',
      difficulty,
      scenes: opts.scenes,
      turnsPerScene: opts.turnsPerScene,
      // The flag that makes `scenes` a CEILING rather than a target. OPT-IN:
      // `DEFAULT_WORLDS`' LONG runs must keep playing past a chapter boundary,
      // or the benchmark stops measuring the arc dimensions it exists for.
      stopAtChapterEnd: true,
    };
  });
}
