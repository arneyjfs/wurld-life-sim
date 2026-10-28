/**
 * HOW MUCH DOES THE JUDGE MOVE WHEN NOTHING DOES?
 *
 * This session read INTENT 1.63 → 1.13 as a regression and CHARACTER 1.88 →
 * 1.38 as collateral damage. Both are differences between two PLAYTHROUGHS,
 * scored by a model at temperature, and nothing in this harness has ever
 * established what that model's spread is on a FIXED transcript. If re-judging
 * the same run twice moves INTENT by 0.5, then most of the deltas driving this
 * work are noise and the conclusions drawn from them are unearned.
 *
 * `rejudge` already holds the transcript fixed and re-runs only the judged
 * layer, which is exactly the instrument needed — this just runs it N times and
 * reports the spread per dimension. ~$0.02 a pass.
 *
 *   PLAY_RUN=.playthroughs/<stamp>-Alice.json JUDGE_PASSES=3 \
 *     npx vitest run --config tests/playthrough/vitest.config.ts judgeVariance
 *
 * Read the output before trusting any single-run comparison: a dimension whose
 * own re-judge spread is wider than the effect being claimed cannot support the
 * claim, however tidy the story around it.
 */
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { rejudge } from './rejudge';
import { collapse, type Score } from './rubric';

const RUN = process.env.PLAY_RUN ?? '';
const PASSES = Number(process.env.JUDGE_PASSES ?? '3');

describe('judge variance — the instrument, measured on a fixed transcript', () => {
  it('re-judges one run N times and reports the per-dimension spread', {
    timeout: 60 * 60_000,
  }, async () => {
    if (!RUN || !fs.existsSync(RUN)) return;
    const file = JSON.parse(fs.readFileSync(RUN, 'utf8'));

    /** dimension -> one score per pass */
    const byDim = new Map<string, number[]>();
    for (let pass = 0; pass < PASSES; pass += 1) {
      const { perScene, story, assets } = await rejudge(file);
      // Same collapse the report uses, so the spread is measured on the number
      // a human actually reads — not on a per-scene row nobody compares.
      const scores: Score[] = [
        ...collapse(perScene.flatMap((p) => p.scores)),
        ...story,
        ...assets,
      ];
      for (const s of scores) {
        if (s.score < 0) continue; // UNMEASURED contributes no spread
        const arr = byDim.get(s.dimension) ?? [];
        arr.push(s.score);
        byDim.set(s.dimension, arr);
      }
    }

    const rows = [...byDim.entries()]
      .map(([dim, vals]) => {
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        return { dim, min, max, mean, spread: max - min, vals };
      })
      .sort((a, b) => b.spread - a.spread);

    const out = [
      `${RUN} — ${PASSES} independent judge passes over the SAME transcript`,
      '',
      'DIMENSION        mean    min    max  SPREAD   passes',
      ...rows.map((r) =>
        `${r.dim.padEnd(15)} ${r.mean.toFixed(2).padStart(5)} ` +
        `${r.min.toFixed(2).padStart(6)} ${r.max.toFixed(2).padStart(6)} ` +
        `${r.spread.toFixed(2).padStart(7)}   [${r.vals.map((v) => v.toFixed(2)).join(', ')}]`),
      '',
      `Widest spread: ${rows[0]?.dim} at ${rows[0]?.spread.toFixed(2)}.`,
      'A claimed effect smaller than a dimension\'s own spread is not an effect.',
    ].join('\n');
    fs.writeFileSync('.playthroughs/judge-variance.txt', out);

    expect(rows.length).toBeGreaterThan(0);
  });
});
