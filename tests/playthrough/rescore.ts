/**
 * RE-SCORE a captured run against the CURRENT rubric — no model calls.
 *
 *   npx tsx tests/playthrough/rescore.ts .playthroughs/<stamp>-<Name>.json
 *   npx tsx tests/playthrough/rescore.ts .playthroughs/<stamp>          # all four
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Every MEASURED dimension is a pure function of the captured turns, so a fix
 * to the rubric should not cost another paid playthrough. It repeatedly did:
 * each time a check turned out to be mis-calibrated — OPT-SPREAD passing on
 * zero options, OPT-LEAK flagging English inflections, CLICHE deciding a grade
 * band on one word of a 211-word sample — the only way to see the corrected
 * number was to re-run four worlds against a real model.
 *
 * That also made the fixes hard to trust. A re-run changes the STORIES as well
 * as the rubric, so a score that moved could be either. Re-scoring holds the
 * transcript fixed and changes only the ruler, which is the only way to tell a
 * calibration change from a quality change.
 *
 * JUDGED scores are carried through untouched — they cost money and cannot be
 * recomputed. The one exception is withholding: whether a run was long enough
 * to be judged on ARC / ENDING / PACING is a function of its scene count, so
 * that rule is re-applied here and the affected rows become UNMEASURED.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  collapse, composite, scoreCadence, scoreDirections, scoreLexiconNames,
  scoreSpread, scoreSubjects, scoreLeaningMovement, storyDimensionsFor, withheldStoryDimensions,
  type Score,
} from './rubric';

import { BANNED_LEXICON } from '@/lib/life/prompts/bannedLexicon';
import { lexiconNames } from './lexiconNames';
import type { WorldRun, WorldSpec } from './playWorld';

type RunFile = {
  spec: WorldSpec;
  run: WorldRun;
  scores: Score[];
  composite: { mean: number; gateFailures: Score[]; weakest?: Score[] };
};

/** Dimensions code owns — recomputed, and the stored copies discarded. */
const MEASURED = new Set([
  'Q-CADENCE', 'Q-DIRECTION', 'OPT-SPREAD', 'CLICHE-NAME', 'SUBJECT-SPREAD',
  'INTENT-MOVED',
]);

export function rescore(file: RunFile): RunFile {
  const turns = file.run.scenes.flatMap((s) => s.turns);
  const history = file.run.scenes.map((s) => s.historyLine).filter(Boolean);
  const playedScenes = file.run.scenes.filter((s) => s.turns.length > 0).length;

  const measured: Score[] = [
    scoreCadence(turns),
    scoreDirections(turns),
    scoreSpread(turns),
    scoreLexiconNames(lexiconNames(file.run), BANNED_LEXICON),
    scoreSubjects(history),
    scoreLeaningMovement(file.run.leaningClaims ?? []),
  ];

  const askable = new Set(storyDimensionsFor(playedScenes));
  const carried = file.scores.filter((s) => {
    if (MEASURED.has(s.dimension)) return false;
    // A stored ARC/ENDING/PACING from a run too short to have earned one is
    // dropped in favour of the UNMEASURED row below.
    if (['ARC', 'ENDING', 'PACING'].includes(s.dimension) && !askable.has(s.dimension)) return false;
    // OPT-LEAK is JUDGED ONLY now; drop any stored MEASURED copy, which is
    // recognisable by the rate it reports in `note`.
    if (s.dimension === 'OPT-LEAK' && /leaks across|candidate leaks/.test(s.note)) return false;
    return true;
  });

  const scores = [...measured, ...carried, ...withheldStoryDimensions(playedScenes)];
  return { ...file, scores: collapse(scores), composite: composite(scores) };
}

const [, , target] = process.argv;
if (target) {
  const files = fs.existsSync(target) && target.endsWith('.json')
    ? [target]
    : fs.readdirSync(path.dirname(target))
            // `.rescored.json` files are OUTPUT — including them re-scores the
      // re-scores, which double-counts nothing but reports every world twice.
      .filter((f) => f.startsWith(path.basename(target)) && f.endsWith('.json')
        && !f.includes('calls') && !f.includes('.rescored.'))
      .map((f) => path.join(path.dirname(target), f));

  for (const f of files) {
    const src = JSON.parse(fs.readFileSync(f, 'utf8')) as RunFile;
    const out = rescore(src);
    fs.writeFileSync(f.replace(/\.json$/, '.rescored.json'), JSON.stringify(out, null, 2));
    const gates = out.composite.gateFailures.map((g) => g.dimension).join(', ');
    // eslint-disable-next-line no-console
    console.log(
      `${src.spec.name.padEnd(6)} ${src.composite.mean.toFixed(2)} → ${out.composite.mean.toFixed(2)}` +
      `${gates ? `  ⚠ ${gates}` : ''}`,
    );
  }
}
