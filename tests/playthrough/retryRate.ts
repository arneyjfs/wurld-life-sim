/**
 * LIFE-BENCH-8 — the retry rate, POOLED across runs, with an interval.
 *
 *   npx tsx tests/playthrough/retryRate.ts .playthroughs/<stamp>-calls.json ...
 *
 * ── WHY POOLED, AND WHY AN INTERVAL ─────────────────────────────────────────
 *
 * The retry rate was treated as a cheap contract metric — a count, not an
 * opinion, so readable from one run where a judged score is not. That is half
 * right. It IS a count, but it is a count out of ~30 `life_step` calls, so it
 * carries binomial sampling noise like any proportion.
 *
 * MEASURED (`LIFE-BENCH-7`), four runs of IDENTICAL code:
 *
 *     retry rate    17.2% – 22.6%   spread 5.3 points
 *     omit / q-node 35.7% – 50.0%   spread 14.3 points
 *
 * `LIFE-CONTRACT-EX-9` compared three arms at 18.9 / 19.1 / 18.2% and concluded
 * the differences were noise. **That conclusion was right and was reached
 * without this number** — the noise band was asserted, not measured. It is
 * measured now, and it is wide enough that the same three arms could have
 * hidden a real but modest improvement, which is worth stating plainly: a
 * single 30-call run cannot see anything smaller than a very large move.
 *
 * So arms are pooled and reported with a Wilson score interval. Wilson rather
 * than the normal approximation because at n≈120 and p≈0.2 the normal interval
 * is already visibly wrong near the tails, and because it cannot produce the
 * negative lower bound that makes a reader stop trusting the tool.
 *
 * **Two arms whose intervals overlap have not been shown to differ.** That is
 * the whole point of printing them.
 *
 * Offline and free: reads archives, calls no model.
 */
import fs from 'node:fs';

type Call = {
  category: string;
  attempt: number;
  seq: number;
  prompt: string;
  response: string;
};
type Archive = { calls: Call[] };

export type Pooled = {
  runs: number;
  calls: number;
  retries: number;
  rate: number;
  lo: number;
  hi: number;
  attribution: Record<string, number>;
};

/**
 * Wilson score interval for a binomial proportion, 95%.
 *
 * Returns [0, 0] for no observations rather than NaN — an arm with no calls
 * has no rate, and a NaN propagating into a comparison is how a tool starts
 * lying quietly (`LIFE-BENCH-7` had exactly that bug).
 */
export function wilson(successes: number, total: number, z = 1.96): [number, number] {
  if (total <= 0) return [0, 0];
  const p = successes / total;
  const d = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const half = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, (centre - half) / d), Math.min(1, (centre + half) / d)];
}

const canonIds = (prompt: string): Set<string> | null => {
  const m = prompt.match(/<canon>([\s\S]*?)<\/canon>/);
  if (!m) return null;
  return new Set([...m[1]!.matchAll(/id="([^"]+)"/g)].map((x) => x[1]!));
};

/** The pick's declared direction, read from the rendered turn tag.
 *  NOTE the `[^>]*` — an earlier reading used `<turn kind="choice">` with the
 *  `>` fixed in place, which excluded every turn that actually CARRIES the
 *  attribute and reported 0 of them. */
const pickAct = (prompt: string): string | null => {
  const m = prompt.match(/<turn kind="choice"([^>]*)>/);
  if (!m) return null;
  const a = m[1]!.match(/speechAct="([a-z]+)"/);
  return a ? a[1]! : null;
};

/** Which blocking rule most plausibly rejected a response, reconstructed from
 *  the archived prompt + response. Mirrors `validateStep`'s ARMING conditions,
 *  including the one an earlier pass omitted: `question-omits-lead-in` only
 *  fires when a pick exists and was not `hear`. */
export function classifyRejection(prompt: string, response: string): string {
  let parsed: { node?: Record<string, unknown> } & Record<string, unknown>;
  try {
    parsed = JSON.parse(response);
  } catch {
    return 'not-json';
  }
  const node = (parsed.node ?? parsed) as Record<string, unknown>;
  const options = (parsed.options ?? []) as { targetId?: string }[];
  const ids = canonIds(prompt);
  if (ids && ids.size > 0 && options.some((o) => o.targetId && !ids.has(o.targetId))) {
    return 'unknown-entity-ref';
  }
  const isQuestion = node.kind === 'question' || Boolean(node.gradedPlan);
  const beats = (node.beats ?? []) as unknown[];
  const act = pickAct(prompt);
  if (isQuestion && beats.length === 0) {
    return act && act !== 'hear' ? 'question-omits-lead-in' : 'beatless-question (check disarmed)';
  }
  return 'other';
}

export function poolRuns(archives: readonly Archive[]): Pooled {
  let calls = 0;
  let retries = 0;
  const attribution: Record<string, number> = {};
  for (const archive of archives) {
    const steps = archive.calls
      .filter((c) => c.category === 'life_step')
      .sort((a, b) => a.seq - b.seq);
    calls += steps.length;
    for (let i = 0; i < steps.length; i += 1) {
      if (steps[i]!.attempt === 0) continue;
      retries += 1;
      const rejected = steps[i - 1];
      if (!rejected) continue;
      const code = classifyRejection(rejected.prompt, rejected.response);
      attribution[code] = (attribution[code] ?? 0) + 1;
    }
  }
  const [lo, hi] = wilson(retries, calls);
  return { runs: archives.length, calls, retries, rate: calls ? retries / calls : 0, lo, hi, attribution };
}

export function describeArm(label: string, p: Pooled): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const rows = Object.entries(p.attribution).sort((a, b) => b[1] - a[1]);
  return [
    `${label}: ${p.runs} runs pooled — ${p.retries}/${p.calls} calls retried`,
    `  rate ${pct(p.rate)}   95% CI [${pct(p.lo)}, ${pct(p.hi)}]`,
    ...rows.map(([code, n]) => `    ${String(n).padStart(3)}  ${code}`),
  ].join('\n');
}

const read = (f: string): Archive => JSON.parse(fs.readFileSync(f, 'utf8')) as Archive;

// CLI: files before `--` are arm A, after are arm B. One list = one arm.
const argv = process.argv.slice(2);
const split = argv.indexOf('--');
if (argv.length) {
  const a = (split === -1 ? argv : argv.slice(0, split)).filter((x) => x.endsWith('.json'));
  const b = (split === -1 ? [] : argv.slice(split + 1)).filter((x) => x.endsWith('.json'));
  const armA = poolRuns(a.map(read));
  // eslint-disable-next-line no-console
  console.log(describeArm(b.length ? 'BASELINE' : 'POOLED', armA));
  if (b.length) {
    const armB = poolRuns(b.map(read));
    // eslint-disable-next-line no-console
    console.log('\n' + describeArm('ARM', armB));
    const overlap = armB.lo <= armA.hi && armA.lo <= armB.hi;
    // eslint-disable-next-line no-console
    console.log(
      `\n${overlap ? 'INTERVALS OVERLAP — no difference shown.' : 'Intervals are disjoint — a real difference.'}`,
    );
  }
}
