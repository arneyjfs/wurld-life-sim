/**
 * RE-JUDGE a captured run against the CURRENT mark scheme — no replay.
 *
 *   npx tsx tests/playthrough/rejudge.ts .playthroughs/<stamp>-<Name>.json
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * `rescore.ts` re-runs the MEASURED layer for free. This does the same for the
 * JUDGED layer at the cost of the judge calls alone (~$0.02 a world), and it
 * exists for the same reason: iterating the mark scheme by replaying four
 * worlds changes the STORIES as well as the ruler, so a score that moves tells
 * you nothing about which one moved it.
 *
 * Holding the transcript fixed is the only way to answer "did the mark scheme
 * make the judge more discriminating?" — which is a question about the
 * instrument, not the product, and must not be paid for in playthroughs.
 *
 * Writes `<name>.rejudged.json` with per-scene rows intact.
 */
import fs from 'node:fs';
import path from 'node:path';
import { judgeScene, judgeStory, judgeAssets } from './judge';
import { collapse, composite, type Score } from './rubric';
import type { WorldRun, WorldSpec } from './playWorld';

type RunFile = {
  spec: WorldSpec;
  run: WorldRun;
  scores: Score[];
  perScene?: Score[][];
  composite: { mean: number; gateFailures: Score[]; weakest?: Score[] };
};

export async function rejudge(file: RunFile): Promise<{
  perScene: { scene: number; subject: string; scores: Score[] }[];
  story: Score[];
  assets: Score[];
}> {
  const { spec, run } = file;
  const perScene: { scene: number; subject: string; scores: Score[] }[] = [];
  for (const sc of run.scenes) {
    if (sc.turns.length === 0) continue;
    perScene.push({
      scene: sc.index + 1,
      subject: sc.subject || sc.title,
      scores: await judgeScene({
        worldName: spec.name, sceneIndex: sc.index,
        subject: sc.subject || sc.title, turns: sc.turns,
      }),
    });
  }
  const { renderTranscript } = await import('./judge');
  const transcript = run.scenes
    .map((s) => `── SCENE ${s.index + 1}: ${s.title} (${s.subject}) ──\n${renderTranscript(s.turns)}`)
    .join('\n\n');
  const story = await judgeStory({
    worldName: spec.name, title: run.title, situation: run.situation,
    history: run.scenes.map((s) => s.historyLine).filter(Boolean),
    cast: run.cast.map((c) => ({ name: c.name, known: c.known, wants: c.wants })),
    transcript: transcript.slice(0, 60_000),
    sceneCount: run.scenes.filter((s) => s.turns.length > 0).length,
  });
  const assets = await judgeAssets({
    worldName: spec.name,
    backdrops: run.scenes.map((s) => ({
      label: s.backdropLabel, subject: s.subject,
      svgHead: (s.backdropSvg ?? '(none)').slice(0, 300),
    })),
    bios: run.npcBios,
    questions: run.scenes.flatMap((s) => s.turns).flatMap((t) =>
      t.graded ? [{ kind: t.graded.kind, line: t.graded.line, choices: t.graded.choices.map((c) => c.text) }] : []),
    history: run.scenes.map((s) => s.historyLine).filter(Boolean),
  });
  return { perScene, story, assets };
}

/* CLI. Wrapped in an async IIFE rather than using top-level await: `gemini.ts`
 * reads `__dirname`, and a module with both `require()` and top-level await is
 * ambiguous to the loader (ERR_AMBIGUOUS_MODULE_SYNTAX). */
const [, , target] = process.argv;
if (target) void (async () => {
  const src = JSON.parse(fs.readFileSync(path.resolve(target), 'utf8')) as RunFile;
  const out = await rejudge(src);
  const flat: Score[] = [
    ...out.perScene.flatMap((p) => p.scores),
    ...out.story,
    ...out.assets,
  ];
  // Scene rows average per dimension, exactly as `run.play` composes them.
  const dims = new Set(out.perScene.flatMap((p) => p.scores).map((s) => s.dimension));
  const sceneMean: Score[] = [...dims].map((d) => {
    const xs = out.perScene.flatMap((p) => p.scores).filter((s) => s.dimension === d);
    const worst = xs.reduce((a, b) => (b.score < a.score ? b : a));
    const worstAt = out.perScene.find((p) => p.scores.includes(worst));
    return {
      dimension: d,
      score: xs.reduce((a, s) => a + s.score, 0) / xs.length,
      evidence: worst.evidence,
      note: `mean of ${xs.length} scenes; worst ${worst.score} in scene ${worstAt?.scene ?? '?'} — ${worst.note}`,
    };
  });
  const all = [...sceneMean, ...out.story, ...out.assets];
  const c = composite(all);
  const dest = path.resolve(target).replace(/\.json$/, '.rejudged.json');
  fs.writeFileSync(dest, JSON.stringify(
    { spec: src.spec, perScene: out.perScene, scores: collapse(all), composite: c, raw: flat }, null, 2));
  for (const s of collapse(all).sort((a, b) => a.score - b.score)) {
    // eslint-disable-next-line no-console
    console.log(`${String(s.score).padStart(5)}  ${s.dimension.padEnd(15)} ${s.note.slice(0, 110)}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\ncomposite ${c.mean.toFixed(2)} → ${dest}`);
})();
