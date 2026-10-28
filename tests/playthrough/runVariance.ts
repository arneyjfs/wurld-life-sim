/**
 * LIFE-BENCH-7 — how much does the SCORE move when the CODE does not?
 *
 *   npx tsx tests/playthrough/runVariance.ts .playthroughs/*-Alice.json
 *
 * ── WHY THIS IS NOT `judgeVariance.probe.ts` ────────────────────────────────
 *
 * That probe holds ONE transcript fixed and re-judges it N times. It has been
 * run, and the answer was **0.00 spread on every dimension** — the judge is a
 * good ruler and does not wobble.
 *
 * That is the reassuring half, and it measures the wrong thing. The parallel
 * story-engine-v2 branch found the noise one level up (`LIFE-ENGINE-CMP-1`):
 * two consecutive 24-turn runs of **identical code** scored 3.38 and 2.38, and
 * their gate flipped between them. Re-judging the same transcript spread
 * 0.00–0.25 there too. So the judge is not the variable — **the RUN is.**
 * Twenty-four turns of sampling at temperature compound into genuinely better
 * and worse stories, and the engine emits a DISTRIBUTION of which a single
 * playthrough is one draw.
 *
 * This reads N runs of unchanged code and reports the per-dimension spread
 * ACROSS runs. That number is the resolution limit of the whole benchmark:
 *
 *   **A claimed effect smaller than a dimension's own run-to-run spread is not
 *   an effect, however tidy the story around it.**
 *
 * Every A/B this repo has drawn a conclusion from — ours and v2's — was a
 * single run per arm. Until this has been read, none of those deltas can be
 * distinguished from a coin flip.
 *
 * Pure and offline: reads archived runs, spends nothing, calls no model.
 */
import fs from 'node:fs';

type Score = { dimension: string; score: number; evidence?: string; note?: string };

/** `composite` is written as `{ mean, gateFailures, weakest }` by `rubric.ts`,
 *  but the REPORT prints a bare number and an earlier draft of this file
 *  assumed the report's shape — every composite came back `NaN`. Both are
 *  accepted, because a reader handed an archive should not have to know which
 *  vintage wrote it. */
type RunFile = {
  composite?: number | { mean?: number };
  scores?: Score[];
  spec?: { seed?: string };
};

export function compositeOf(run: RunFile): number {
  const c = run.composite;
  if (typeof c === 'number') return c;
  return typeof c?.mean === 'number' ? c.mean : Number.NaN;
}

export type DimensionSpread = {
  dimension: string;
  mean: number;
  min: number;
  max: number;
  spread: number;
  scores: number[];
};

/** A score below zero means UNMEASURED, not bad (`rubric.collapse`). Averaging
 *  it in would drag a dimension down for having been unobservable, which is the
 *  same error as scoring absent data. */
const measured = (n: number): boolean => Number.isFinite(n) && n >= 0;

export function spreadAcrossRuns(runs: readonly RunFile[]): DimensionSpread[] {
  const byDimension = new Map<string, number[]>();
  for (const run of runs) {
    for (const s of run.scores ?? []) {
      if (!measured(s.score)) continue;
      const list = byDimension.get(s.dimension) ?? [];
      list.push(s.score);
      byDimension.set(s.dimension, list);
    }
  }
  return [...byDimension.entries()]
    .map(([dimension, scores]) => ({
      dimension,
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
      min: Math.min(...scores),
      max: Math.max(...scores),
      spread: Math.max(...scores) - Math.min(...scores),
      scores,
    }))
    .sort((a, b) => b.spread - a.spread);
}

/** ENGINE2-SUITE-11's rule, adopted: judged metrics read the MEDIAN of N runs.
 *  The mean is wrong here — one catastrophic run (a world that failed to open)
 *  drags it in a way that does not describe the typical experience, and the
 *  median is what a player actually meets. */
export function median(values: readonly number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function render(files: readonly string[]): string {
  const runs = files.map((f) => JSON.parse(fs.readFileSync(f, 'utf8')) as RunFile);
  const composites = runs.map(compositeOf).filter((c) => Number.isFinite(c));
  const rows = spreadAcrossRuns(runs);
  const out: string[] = [];

  out.push(`${runs.length} runs of UNCHANGED code — per-dimension spread ACROSS runs\n`);
  for (const f of files) out.push(`  ${f}`);
  out.push('');
  out.push(
    `COMPOSITE  median ${median(composites).toFixed(2)}  ` +
      `min ${Math.min(...composites).toFixed(2)}  max ${Math.max(...composites).toFixed(2)}  ` +
      `SPREAD ${(Math.max(...composites) - Math.min(...composites)).toFixed(2)}   ` +
      `[${composites.map((c) => c.toFixed(2)).join(', ')}]`,
  );
  out.push('');
  out.push('DIMENSION         median   min    max  SPREAD   runs');
  for (const r of rows) {
    out.push(
      `${r.dimension.padEnd(16)} ${median(r.scores).toFixed(2).padStart(6)} ` +
        `${r.min.toFixed(2).padStart(6)} ${r.max.toFixed(2).padStart(6)} ` +
        `${r.spread.toFixed(2).padStart(7)}   [${r.scores.map((s) => s.toFixed(1)).join(', ')}]`,
    );
  }
  out.push('');
  const worst = rows[0];
  if (worst) {
    out.push(
      `Widest: ${worst.dimension} at ${worst.spread.toFixed(2)} across runs of the SAME code.`,
    );
  }
  out.push(
    'A claimed effect smaller than a dimension\'s own run-to-run spread is not an effect.',
  );
  return out.join('\n');
}

// CLI. Kept at the bottom so the pure functions above stay importable by tests.
const files = process.argv.slice(2).filter((a) => a.endsWith('.json'));
if (files.length >= 2) {
  // eslint-disable-next-line no-console
  console.log(render(files));
} else if (files.length) {
  // eslint-disable-next-line no-console
  console.error('runVariance: need at least 2 run files — variance of one run is not a thing.');
  process.exitCode = 1;
}
