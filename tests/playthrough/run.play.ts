/**
 * THE BENCHMARK RUN — four worlds, scored.
 *
 *   npx vitest run --config tests/playthrough/vitest.config.ts run.play
 *
 * Spends real money against the real model. Never in `npm test`.
 *
 * ── THE FOUR WORLDS, AND WHY THESE FOUR ─────────────────────────────────────
 *
 * TWO LONG, played far enough that clocks move, cast standing swings, and the
 * story has to become about something rather than stay about its premise. These
 * are where pacing, arc and character depth are actually testable — a 2-scene
 * run cannot fail those dimensions, so a benchmark made only of short runs
 * would report health it never measured.
 *
 * TWO SHORT, in deliberately different fields, played only through world
 * creation and its first scenes. World creation is a separate risk surface: it
 * is where the universe, the cast, the opening front and the register are all
 * decided at once, and where a seed in an unusual genre most easily produces a
 * generic result. Cheap to test, and a different failure from the long ones.
 *
 * The four differ on every axis that has ever broken something: register
 * (realistic vs heightened), language, difficulty, and whether the seed is a
 * stock key or the player's own words.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The ONE substitution — real Gemini, no Firebase hop. See transport.ts.
vi.mock('@/lib/gemini', async () => await import('./transport'));
vi.mock('@/lib/life/arcs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  readCompletedArcs: async () => [],
}));

const { playWorld } = await import('./playWorld');
const { judgeScene, judgeStory, judgeAssets, renderTranscript } = await import('./judge');
const { scoreCadence, scoreDirections, scoreLeaningMovement, scoreLexiconNames, scoreSpread,
  scoreSubjects, collapse, composite, medianScores } = await import('./rubric');
const { totals, byCategory, calls } = await import('./transport');
const { BANNED_LEXICON } = await import('@/lib/life/prompts/bannedLexicon');
const { SCENE_OVERDUE } = await import('@/lib/life/prompts/stepRender');
const { lexiconNames } = await import('./lexiconNames');

import type { WorldSpec } from './playWorld';
import type { Score } from './rubric';
import { chapterWorlds, parsePlaySeeds, smokeWorlds } from './playSeeds';

const OUT = path.resolve(__dirname, '../../.playthroughs');
/**
 * The per-scene turn ceiling is DERIVED from the app's own overdue threshold,
 * not chosen.
 *
 * It used to default to 9, and `SCENE_OVERDUE` is 12 — so the harness cut every
 * scene three turns BEFORE `<scenePace>` ever said "you are past the ceiling,
 * land it". Measured 2026-08-04: eight scenes, eight "never resolved" failures,
 * and an ENDING score for a story the harness had not let end. The scenes were
 * not failing to resolve; they were being executed before they could.
 *
 * `+2` because the overdue block asks for the resolution beat "THIS turn or
 * next", so a scene needs at least one turn past the threshold to comply — and
 * the ceiling is a runaway guard, not a target. A scene that resolves at 7
 * still resolves at 7.
 */
const LONG_SCENES = Number(process.env.PLAY_LONG_SCENES ?? '8');
const LONG_TURNS = Number(process.env.PLAY_LONG_TURNS ?? String(SCENE_OVERDUE + 2));
const SHORT_SCENES = Number(process.env.PLAY_SHORT_SCENES ?? '2');
const SHORT_TURNS = Number(process.env.PLAY_SHORT_TURNS ?? String(SCENE_OVERDUE + 2));

const DEFAULT_WORLDS: WorldSpec[] = [
  // ── LONG ─────────────────────────────────────────────────────────────
  {
    name: 'Alice', label: 'LONG · realistic · village',
    seedKey: 'farm_life', mode: 'realistic',
    practiceLanguage: 'French', systemLanguage: 'English (British)', difficulty: 3,
    scenes: LONG_SCENES, turnsPerScene: LONG_TURNS,
  },
  {
    name: 'Ines', label: 'LONG · fantasy · apprentice',
    seedKey: 'magic_university', mode: 'fantasy',
    practiceLanguage: 'Spanish', systemLanguage: 'English (British)', difficulty: 4,
    scenes: LONG_SCENES, turnsPerScene: LONG_TURNS,
  },
  // ── SHORT — world creation in different fields ───────────────────────
  {
    name: 'Tomas', label: 'SHORT · realistic · free-text seed',
    seedKey: 'manual', mode: 'realistic',
    seedText: 'a night-shift nurse in a hospital that is quietly running out of money',
    practiceLanguage: 'German', systemLanguage: 'English (British)', difficulty: 5,
    scenes: SHORT_SCENES, turnsPerScene: SHORT_TURNS,
  },
  {
    name: 'Yuki', label: 'SHORT · fantasy · frontier',
    seedKey: 'frontier_colony', mode: 'fantasy',
    practiceLanguage: 'Japanese', systemLanguage: 'English (British)', difficulty: 2,
    scenes: SHORT_SCENES, turnsPerScene: SHORT_TURNS,
  },
];

/** LIFE-BENCH-3: `PLAY_SEEDS=restaurant,heist npm run test:playthrough` swaps
 *  the benchmark for one SHORT world per named seed, leaving DEFAULT_WORLDS
 *  untouched. Implementation + reasoning in `playSeeds.ts` (it lives there so
 *  it can be unit-tested — this file IS a vitest file). */
/** BENCH-1 — judged passes per layer; the report states the median of these.
 *  1 by default (same cost as before); use >= 3 when COMPARING two arms. */
const JUDGE_PASSES = Math.max(1, Number(process.env.JUDGE_PASSES ?? '1'));
const PLAY_SEEDS = parsePlaySeeds(process.env.PLAY_SEEDS);
/** LIFE-BENCH-7: `PLAY_CHAPTER=a,b,c` plays each seed to the end of its
 *  CHAPTER — LONG worlds whose scene count is a ceiling, stopped by
 *  `arcStage: 'concluding'`. See `playSeeds.ts`. */
const PLAY_CHAPTER = parsePlaySeeds(process.env.PLAY_CHAPTER);
const CHAPTER_SCENES = Number(process.env.PLAY_CHAPTER_SCENES ?? '10');
const WORLDS: WorldSpec[] = PLAY_CHAPTER.length
  ? chapterWorlds(PLAY_CHAPTER, { scenes: CHAPTER_SCENES, turnsPerScene: LONG_TURNS })
  : PLAY_SEEDS.length
    ? smokeWorlds(PLAY_SEEDS, { scenes: SHORT_SCENES, turnsPerScene: SHORT_TURNS })
    : DEFAULT_WORLDS;


function fmt(scores: readonly Score[]): string {
  // Collapsed: a dimension scored by both layers prints once, at the worse of
  // the two — which is the number `composite` already used.
  return collapse(scores)
    .sort((a, b) => a.score - b.score)
    .map((s) => `    ${String(s.score)}  ${s.dimension.padEnd(16)} ${s.note.slice(0, 90)}`)
    .join('\n');
}

/** FNV-1a, so a system instruction can be stored once and referenced. Not a
 *  security hash — it only has to separate a handful of distinct prompts. */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}


describe('benchmark', () => {
  it('plays four worlds and scores them', { timeout: 120 * 60_000 }, async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const report: string[] = [`# Playthrough benchmark — ${stamp}`, ''];

    for (const spec of WORLDS) {
      // eslint-disable-next-line no-console
      console.log(`\n▶ ${spec.label} (${spec.scenes} scenes × ${spec.turnsPerScene} turns)`);
      const run = await playWorld(spec);

      // ── MEASURED (code owns these) ───────────────────────────────────
      const allTurns = run.scenes.flatMap((s) => s.turns);
      const measured: Score[] = [
        scoreCadence(allTurns),
        scoreDirections(allTurns),
        scoreSpread(allTurns),
        scoreLexiconNames(lexiconNames(run), BANNED_LEXICON),
        scoreSubjects(run.scenes.map((s) => s.historyLine).filter(Boolean)),
        scoreLeaningMovement(run.leaningClaims),
      ];

      // ── JUDGED ───────────────────────────────────────────────────────
      //
      // BENCH-1: each judged layer runs JUDGE_PASSES times and reports the
      // per-dimension MEDIAN. Default 1 — identical behaviour and identical
      // cost to before, so nobody is surprised by a tripled bill — but the
      // number is now LABELLED with the passes behind it, which is the half
      // that stops a single-pass score being read as a stable one.
      //
      // Comparisons between arms should use >= 3. `judgeVariance.probe.ts`
      // measured why: the judge's own spread on a FIXED transcript is ~0.2
      // composite, so a claimed effect smaller than that is unearned at 1 pass.
      const medianOf = async (run1: () => Promise<Score[]>): Promise<Score[]> => {
        const passes: Score[][] = [];
        for (let i = 0; i < JUDGE_PASSES; i += 1) passes.push(await run1());
        return medianScores(passes);
      };

      const perScene: Score[][] = [];
      for (const sc of run.scenes) {
        if (sc.turns.length === 0) continue;
        perScene.push(
          await medianOf(() => judgeScene({
            worldName: spec.name, sceneIndex: sc.index,
            subject: sc.subject || sc.title, turns: sc.turns,
          })),
        );
      }
      const fullTranscript = run.scenes
        .map((s) => `── SCENE ${s.index + 1}: ${s.title} (${s.subject}) ──\n${renderTranscript(s.turns)}`)
        .join('\n\n');
      const story = await medianOf(() => judgeStory({
        worldName: spec.name, title: run.title, situation: run.situation,
        history: run.scenes.map((s) => s.historyLine).filter(Boolean),
        cast: run.cast.map((c) => ({ name: c.name, known: c.known, wants: c.wants })),
        transcript: fullTranscript.slice(0, 60_000),
        // Decides which arc dimensions are askable at all — a 2-scene run
        // stopped by the harness cannot be judged on how it ends.
        sceneCount: run.scenes.filter((s) => s.turns.length > 0).length,
      }));
      const assets = await medianOf(() => judgeAssets({
        worldName: spec.name,
        backdrops: run.scenes.map((s) => ({
          label: s.backdropLabel, subject: s.subject,
          svgHead: (s.backdropSvg ?? '(none)').slice(0, 300),
        })),
        bios: run.npcBios,
        questions: allTurns.flatMap((t) =>
          t.graded ? [{ kind: t.graded.kind, line: t.graded.line, choices: t.graded.choices.map((c) => c.text) }] : []),
        history: run.scenes.map((s) => s.historyLine).filter(Boolean),
      }));

      // Scene scores average per dimension across scenes. The PER-SCENE rows
      // are kept separately in the JSON: collapsing to a mean threw away every
      // note and quote the judge wrote, so "INTENT 1.75, worst 1" could not be
      // read back to find WHICH scene scored 1 or why. The mean is the trend
      // line; the per-scene rows are what you debug against.
      const sceneMean: Score[] = [];
      const dims = new Set(perScene.flat().map((s) => s.dimension));
      for (const d of dims) {
        const xs = perScene.flat().filter((s) => s.dimension === d);
        sceneMean.push({
          dimension: d,
          score: xs.reduce((a, s) => a + s.score, 0) / xs.length,
          evidence: '',
          note: `mean of ${xs.length} scenes; worst ${Math.min(...xs.map((x) => x.score))}`,
        });
      }

      const all = [...measured, ...sceneMean, ...story, ...assets];
      const c = composite(all);
      const cost = totals();

      report.push(
        `## ${spec.label} — ${spec.name}`,
        `**${run.title}** — ${run.situation}`,
        '',
        `Composite **${c.mean.toFixed(2)} / 4**${c.gateFailures.length ? `  ⚠ GATE FAILURES: ${c.gateFailures.map((g) => g.dimension).join(', ')}` : ''}`,
        '',
        '```',
        fmt(all),
        '```',
        '',
        `Scenes ${run.scenes.length} · turns ${allTurns.length} · questions ${allTurns.filter((t) => t.graded).length} · backdrops ${run.scenes.filter((s) => s.backdropSvg).length}/${run.scenes.length}`,
        run.failures.length ? `\n**Failures (${run.failures.length}):**\n${run.failures.map((f) => `- ${f}`).join('\n')}` : '',
        '',
        '### What happened',
        ...run.scenes.map((s, i) => `${i + 1}. ${s.historyLine || '(close failed)'}`),
        '',
      );

      fs.writeFileSync(
        path.join(OUT, `${stamp}-${spec.name}.json`),
        JSON.stringify({ spec, run, scores: all, perScene, composite: c }, null, 2),
      );
      // eslint-disable-next-line no-console
      console.log(`  composite ${c.mean.toFixed(2)} · $${cost.usd.toFixed(3)} so far · ${run.failures.length} failures`);
      if (c.gateFailures.length) {
        // eslint-disable-next-line no-console
        console.log(`  ⚠ GATES: ${c.gateFailures.map((g) => `${g.dimension}=${g.score}`).join(', ')}`);
      }
    }

    const cost = totals();
    report.push('## Cost + call diagnostics', '```', JSON.stringify(byCategory(), null, 2), '```',
      `Total: ${cost.calls} calls, $${cost.usd.toFixed(3)}`);
    fs.writeFileSync(path.join(OUT, `${stamp}-REPORT.md`), report.join('\n'));
    // THE VOLATILE TAIL IS THE INTERESTING HALF, and this used to keep the
    // other one. `prompt` was truncated to 2000 chars while the ~72k system
    // instruction — the CACHED PREFIX, byte-identical on every call — was
    // written out in full 169 times. That is ~12 MB of duplicate and a
    // guaranteed dead end for any question of the form "did <block> render this
    // turn", because every per-turn block lives in the tail that got cut.
    // Now: prompts in full, system instructions deduped by content.
    const sis = new Map<string, string>();
    const rows = calls().map((c) => {
      const si = c.systemInstruction ?? '';
      const ref = `si-${hashString(si)}`;
      if (!sis.has(ref)) sis.set(ref, si);
      const { systemInstruction: _si, ...rest } = c;
      return { ...rest, systemInstructionRef: ref };
    });
    fs.writeFileSync(
      path.join(OUT, `${stamp}-calls.json`),
      JSON.stringify({ systemInstructions: Object.fromEntries(sis), calls: rows }, null, 2),
    );
    // eslint-disable-next-line no-console
    console.log(`\n■ report → .playthroughs/${stamp}-REPORT.md · $${cost.usd.toFixed(3)}`);
    expect(cost.calls).toBeGreaterThan(0);
  });
});
