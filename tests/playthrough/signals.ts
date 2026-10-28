/**
 * The five watch-list signals from docs/specs/story-architecture.md §7.1,
 * computed from a playthrough's state dump.
 *
 * WHY THESE AND NOT "READ THE STORY". Judging a saga by reading it back takes a
 * full playthrough per verdict, and the owner's constraint is explicit: they
 * cannot afford to discover a design mistake that way. Flatness shows up in the
 * STATE ledger long before it shows up in a retrospective — a history of
 * escalations, clocks that all move, beliefs never contradicted, scenes that
 * only ever draw on the newest thing, standings that only travel one way.
 *
 * Signal 1 is the sharpest and the only one needing judgement: does the history
 * read as a list of CHANGES or a list of ESCALATIONS? It is scored lexically
 * here as a first pass, and the raw lines are always printed so the call can be
 * made by eye.
 */
import type { CastMember, Front } from '@/types/lifeState';

export type SceneRecord = {
  index: number;
  historyLine: string;
  /** The MODEL's deltas only. Code-owned drift is tracked separately so signal 2
   *  keeps measuring the thing it was written to measure — whether the delta
   *  budget is biting on the model. */
  deltas: { frontId: string; delta: number; reason: string }[];
  drifted: { frontId: string; delta: number; reason: string }[];
  drawsOn: string[];
  /**
   * `scenesSince` for every canon id EXACTLY AS PRESENTED TO `sceneOpen`.
   *
   * The first version recorded ages after the scene had already refreshed them,
   * so anything the scene drew on scored age 0 by construction and signal 4
   * could only ever say FAIL. These are the numbers the planner actually saw,
   * which is the only thing its choice can be judged against.
   */
  presentedAges: { id: string; scenesSince: number }[];
  castAfter: CastMember[];
  frontsAfter: Front[];
  /** LIFE-CAST-2: principals whose `wrongAbout` the player can now see through. */
  ironyAvailable: string[];
};

export type SignalReport = {
  escalationRatio: number;
  zeroDeltaRatio: number;
  ironyRate: number;
  drawsOnMeanAge: number;
  standingSwingRatio: number;
  restatementRatio: number;
  verdicts: string[];
};

/** Words that mark a history line as pure escalation rather than change. A line
 *  about somebody CHANGING (deciding, refusing, admitting, leaving) is healthy;
 *  a line about pressure MOUNTING is the failure mode. */
const ESCALATION = [
  'worse', 'closer', 'tighter', 'mounted', 'mounting', 'pressed', 'pressure',
  'deadline', 'running out', 'less time', 'nearer', 'escalat', 'intensif',
  'more urgent', 'darker', 'threat',
];
const CHANGE = [
  'decided', 'refused', 'agreed', 'admitted', 'confessed', 'changed', 'turned out',
  'revealed', 'apolog', 'forgave', 'left', 'arrived', 'offered', 'accepted',
  'discovered', 'learned', 'stopped', 'started', 'gave up', 'made up', 'fell out',
];

function classify(line: string): 'escalation' | 'change' | 'neutral' {
  const l = line.toLowerCase();
  const e = ESCALATION.some((w) => l.includes(w));
  const c = CHANGE.some((w) => l.includes(w));
  if (c && !e) return 'change';
  if (e && !c) return 'escalation';
  return 'neutral';
}

export function assess(scenes: readonly SceneRecord[]): SignalReport {
  const verdicts: string[] = [];
  const n = Math.max(1, scenes.length);

  // 1 — does the history read as changes or escalations?
  const kinds = scenes.map((s) => classify(s.historyLine));
  const esc = kinds.filter((k) => k === 'escalation').length;
  const chg = kinds.filter((k) => k === 'change').length;
  const escalationRatio = esc / n;
  verdicts.push(
    escalationRatio > 0.5
      ? `FAIL signal 1 — history reads as escalation (${esc} escalation / ${chg} change of ${n})`
      : `ok signal 1 — ${chg} change / ${esc} escalation of ${n}`,
  );

  // 2 — most scene closes should move NOTHING.
  const zeroCloses = scenes.filter(
    (s) => s.deltas.filter((d) => d.delta !== 0).length === 0,
  ).length;
  const zeroDeltaRatio = zeroCloses / n;
  verdicts.push(
    zeroDeltaRatio < 0.4
      ? `FAIL signal 2 — only ${zeroCloses}/${n} closes moved no clock; the budget is not biting`
      : `ok signal 2 — ${zeroCloses}/${n} closes moved nothing`,
  );

  // 3 — is dramatic irony actually becoming available?
  const ironyScenes = scenes.filter((s) => s.ironyAvailable.length > 0).length;
  const ironyRate = ironyScenes / n;
  verdicts.push(
    ironyRate === 0
      ? `FAIL signal 3 — no principal belief ever became visibly false`
      : `ok signal 3 — irony available in ${ironyScenes}/${n} scenes`,
  );

  // 4 — payoff needs OLD material, not just the most recent entity.
  const ages: number[] = [];
  let oldestAvailable = 0;
  for (const s of scenes) {
    const byId = new Map(s.presentedAges.map((c) => [c.id, c.scenesSince]));
    for (const id of s.drawsOn) {
      const since = byId.get(id);
      if (since != null) ages.push(Math.max(0, since));
    }
    oldestAvailable = Math.max(oldestAvailable, ...s.presentedAges.map((c) => c.scenesSince), 0);
  }
  const drawsOnMeanAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
  verdicts.push(
    // Below 3 scenes every canon id was touched this scene or last, so the mean
    // age is pinned near zero by arithmetic rather than by behaviour. Reporting
    // FAIL there would be the harness marking its own homework.
    scenes.length < 3
      ? `n/a signal 4 — needs 3+ scenes before dormancy means anything`
      : ages.length === 0
        ? `FAIL signal 4 — no scene drew on prior canon at all`
        : drawsOnMeanAge < 1.0
          ? `FAIL signal 4 — scenes only draw on the newest thing (mean age ${drawsOnMeanAge.toFixed(1)}, oldest available ${oldestAvailable})`
          : `ok signal 4 — mean drawn-on age ${drawsOnMeanAge.toFixed(1)} (oldest available ${oldestAvailable})`,
  );

  // 5 — do relationships move both ways?
  const traj = new Map<string, number[]>();
  for (const s of scenes) {
    for (const c of s.castAfter) {
      traj.set(c.id, [...(traj.get(c.id) ?? []), c.standing]);
    }
  }
  let swung = 0;
  let tracked = 0;
  for (const series of traj.values()) {
    if (series.length < 3) continue;
    tracked += 1;
    let up = false;
    let down = false;
    for (let i = 1; i < series.length; i += 1) {
      if (series[i]! > series[i - 1]!) up = true;
      if (series[i]! < series[i - 1]!) down = true;
    }
    if (up && down) swung += 1;
  }
  const standingSwingRatio = tracked ? swung / tracked : 0;
  verdicts.push(
    tracked === 0
      ? `n/a signal 5 — not enough scenes to see standing trajectories`
      : standingSwingRatio === 0
        ? `FAIL signal 5 — every tracked character's standing is monotone`
        : `ok signal 5 — ${swung}/${tracked} characters swung both ways`,
  );

  // 6 — is the history TEN LINES, or one line told ten times?
  //
  // Added after a run where signals 1-4 all passed and the story was still
  // broken: the village world's ten history lines were all "Pierre is closing
  // the bakery because of his health", rediscovered. Nothing escalated, every
  // scene drew on old canon, and the world had one subject. The lexical
  // escalation check cannot see this, and it is the failure a player would
  // notice first on a read-back.
  const lines = scenes.map((s) => s.historyLine);
  const restated = repeatedLines(lines);
  const restatementRatio = scenes.length > 1 ? restated.length / (scenes.length - 1) : 0;
  const top = topicCoverage(lines);
  // Two views, because neither alone separates the measured cases. Pairwise
  // overlap misses a fact restated in genuinely different words; topic coverage
  // catches "every line is about Pierre" but says nothing about repetition
  // within a healthy multi-subject world. On the run that prompted this, the
  // dominant word covered 10/10 lines in the broken world against 8/10 and 5/10
  // in the two healthy ones.
  const dominance = top[0]?.share ?? 0;
  verdicts.push(
    scenes.length < 4
      ? `n/a signal 6 — needs 4+ scenes to see a loop`
      : dominance >= 0.9 || restatementRatio > 0.34
        ? `FAIL signal 6 — the history is one subject: "${top[0]?.word}" in ${(dominance * 100).toFixed(0)}% of lines, ${restated.length} restatements`
        : `ok signal 6 — ${restated.length} restatements, top subject "${top[0]?.word}" in ${(dominance * 100).toFixed(0)}% of lines`,
  );
  verdicts.push(`     history spread: ${top.map((t) => `${t.word} ${(t.share * 100).toFixed(0)}%`).join(' · ')}`);
  for (const r of restated) verdicts.push(`     restated: ${r}`);

  return {
    escalationRatio,
    zeroDeltaRatio,
    ironyRate,
    drawsOnMeanAge,
    standingSwingRatio,
    restatementRatio,
    verdicts,
  };
}

/** Words carrying no subject information, so overlap on them means nothing. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'from',
  'you', 'your', 'he', 'she', 'they', 'his', 'her', 'their', 'it', 'its', 'that', 'this',
  'is', 'was', 'were', 'has', 'had', 'have', 'been', 'be', 'as', 'by', 'not', 'no', 'about',
  'learned', 'discovered', 'confirmed', 'found', 'saw', 'told', 'said', 'after', 'while',
]);

function contentWords(line: string): Set<string> {
  return new Set(
    line
      .toLowerCase()
      .replace(/[^a-zà-ÿ\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  );
}

/**
 * History lines that restate an EARLIER one, by content-word overlap.
 *
 * Compared against every earlier line rather than only the previous, because
 * the observed failure was a fact rediscovered at scenes 1, 3, 5, 7, 8, 9 and
 * 10 — adjacent-pair comparison would have called that fine.
 */
/** The content words appearing in the most history lines, with their share.
 *  A single word covering nearly every line is a world with one subject in it. */
function topicCoverage(lines: readonly string[]): { word: string; share: number }[] {
  const counts = new Map<string, number>();
  for (const l of lines) {
    for (const w of contentWords(l)) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([word, n]) => ({ word, share: n / Math.max(1, lines.length) }));
}

function repeatedLines(lines: readonly string[]): string[] {
  const sets = lines.map(contentWords);
  const out: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const a = sets[i]!;
    if (a.size < 3) continue;
    for (let j = 0; j < i; j += 1) {
      const b = sets[j]!;
      if (b.size < 3) continue;
      const shared = [...a].filter((w) => b.has(w)).length;
      // Half the smaller line's content is the same content: the same subject
      // in different words.
      if (shared / Math.min(a.size, b.size) >= 0.5) {
        out.push(`${j + 1}→${i + 1}: ${lines[i]!.slice(0, 90)}`);
        break;
      }
    }
  }
  return out;
}

/** Option-grid health, graded straight off what was offered turn by turn.
 *  This is the reported complaint, so it is measured directly rather than
 *  inferred. */
export function assessOptions(
  sets: readonly { type: string; targetId: string | null }[][],
): string[] {
  const out: string[] = [];
  const real = sets.filter((s) => s.length >= 2);
  if (real.length === 0) return ['n/a — no branch sets offered'];

  const allSame = real.filter((s) => new Set(s.map((o) => o.type)).size === 1).length;
  out.push(
    allSame === 0
      ? `ok — no all-one-type grids in ${real.length} sets`
      : `FAIL — ${allSame}/${real.length} grids are all one action type`,
  );

  let repeats = 0;
  const key = (s: readonly { type: string; targetId: string | null }[]) =>
    s.map((o) => `${o.type}:${o.targetId ?? ''}`).sort().join('|');
  for (let i = 1; i < real.length; i += 1) {
    if (key(real[i]!) === key(real[i - 1]!)) repeats += 1;
  }
  out.push(
    repeats === 0
      ? `ok — no consecutive identical grids`
      : `FAIL — ${repeats} consecutive identical grids`,
  );

  const typeCounts = new Map<string, number>();
  for (const s of real) for (const o of s) typeCounts.set(o.type, (typeCounts.get(o.type) ?? 0) + 1);
  const total = [...typeCounts.values()].reduce((a, b) => a + b, 0);
  const askShare = (typeCounts.get('ask') ?? 0) / Math.max(1, total);
  out.push(
    askShare > 0.5
      ? `FAIL — ${(askShare * 100).toFixed(0)}% of all options are ASK (interrogation drift)`
      : `ok — ASK is ${(askShare * 100).toFixed(0)}% of options`,
  );
  out.push(`   type mix: ${[...typeCounts].map(([t, c]) => `${t}=${c}`).join(' ')}`);

  return out;
}
