/**
 * LIFE-CONFORM-1 — the 43 dropped rules, restated as assertions on OUTPUT.
 *
 *     npx tsx tests/playthrough/ruleConformance.ts <arm-a-glob> -- <arm-b-glob>
 *
 * ── WHY THE 43 TESTS DID NOT CATCH ANYTHING ─────────────────────────────────
 *
 * `step.test.ts` asserts the system instruction CONTAINS a phrase. That is a
 * test of the prompt's text, not of the model's behaviour, and the gap between
 * the two is the whole story of `LIFE-SI-LEAN-3`: a rewrite dropped ~25
 * invariants and 43 assertions went red, with no way to tell which of them
 * described something the model had actually stopped doing.
 *
 * It fails in the other direction too. `LIFE-NPC-MEM-1`'s phrase is in the
 * shipped SI and its behaviour runs at ~20%. The string test passes while the
 * rule fails. Green told us nothing either way.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 *
 * Named predicates over PARSED `life_step` archives, each returning a hit/total
 * so a rule reads as a RATE. Point them at two arms and the question becomes
 * "does the model still DO this", which is the only question the 43 were ever
 * trying to ask.
 *
 * Rates, not pass/fail, deliberately. `LIFE-BENCH-8` measured what a proportion
 * out of ~100 can resolve: a Wilson interval at n=119 is roughly ±9 points, so
 * a fixed threshold would fire on noise. Two arms, two intervals, and an
 * overlap means NOT SHOWN TO DIFFER.
 *
 * ── THREE SHAPE TRAPS, ALL THREE HIT WHILE WRITING THIS ─────────────────────
 *
 * The first draft of this file measured nothing, three times over, and every
 * one of them looked like a working number:
 *
 *  1. **Options live in three places.** `response.options` (the common case),
 *     `node.options` (occasionally), and `node.resolution.options` (every
 *     question node). Reading only the first drops ~40% of all options and
 *     every single one belonging to a question.
 *  2. **A missing `speechAct` is not a defect.** `stepSpeech.ts` says `"act"`
 *     is the DEFAULT and instructs the model to OMIT it. An earlier audit
 *     scored "options carry speechAct" at 73% vs 66% and read a regression
 *     into it; it was measuring compliance with the opposite of the rule.
 *  3. **`continue` options are not choices.** A continuation node carries one
 *     synthetic `id: "continue"` chip with no speechAct and often no
 *     actionType. Left in the denominator it drags every option-shaped rate
 *     down by ~12%, unequally between arms, because the arms emit
 *     continuations at very different rates.
 *
 * Which is the anomalySweep lesson again: look at the underlying rows before
 * believing an aggregate, especially one that agrees with you.
 *
 * ── WHAT IT CANNOT DO, STATED SO IT IS NOT MISTAKEN FOR COVERAGE ────────────
 *
 * Of the 43, roughly a dozen are not mechanically checkable: the figurative-
 * line cap, establish→converse→bridge rhythm, whether a scene has stalled,
 * gentle introductions, prose register, whether a name was reached for as mood.
 * `bannedLexicon.ts` makes the same admission about its own noun list — "a
 * ship's deck really is salted" — and only the IDIOM list is counted here.
 * Those need a judge (±0.2, `LIFE-BENCH-7`) or a human reading transcripts.
 * **Nothing here covers them.** Pretending a substring test did is how they
 * went missing in the first place.
 *
 * Offline and free: reads archives, calls no model.
 */
import fs from 'node:fs';
import { BANNED_IDIOMS } from '@/lib/life/prompts/bannedLexicon';

type Call = {
  seq: number;
  category: string;
  attempt: number;
  prompt: string;
  response: string;
};

type Beat = {
  speaker?: string;
  practiceText?: string;
  nativeText?: string;
  wordTranslations?: Record<string, string>;
};
type Option = {
  id?: string;
  nativeText?: string;
  actionType?: string;
  speechAct?: string;
  saysLine?: { practiceText?: string } | null;
  gradeTarget?: string;
};
type Node = {
  kind?: string;
  beats?: Beat[];
  options?: Option[];
  gradedPlan?: { kind?: string; testTarget?: string; npcUtterance?: string };
  resolution?: { beats?: Beat[]; options?: Option[] };
};
type Res = {
  node?: Node;
  options?: Option[];
  scene?: { sceneProgress?: number | null };
  logLine?: string;
  npcMemoryUpdates?: unknown[];
};

/** One `life_step` call, prompt included — half these rules are CROSS-TURN
 *  (what the model did given what the player picked), and the pick only exists
 *  in the prompt. */
export type Turn = { seq: number; attempt: number; prompt: string; res: Res | null };

export type Rate = { hit: number; total: number };
const rate = (hit: number, total: number): Rate => ({ hit, total });

// ── reading an archive ──────────────────────────────────────────────────────

/**
 * `attempts: 'last'` (default) keeps the response the PLAYER SAW — one row per
 * turn, post-validation. `'all'` keeps every attempt, which is the model's RAW
 * rate on anything the validator enforces. They answer different questions and
 * the difference is the retry rate, so neither is "the" number: cadence rules
 * need 'last' (a retried turn is still one turn), contract rules are more
 * honest on 'all'.
 *
 * **A RETRY DOES NOT SHARE ITS TURN'S `seq`.** The first version of this
 * function deduped on `seq` and silently kept everything, so every REJECTED
 * attempt was counted as a turn the player saw — which read as a 62% lead-in
 * omission rate on a prompt whose validator rejects exactly that. The archive's
 * only marker of a retry is `attempt` counting up across CONSECUTIVE calls, so
 * a turn is the run from an `attempt: 0` up to the next one.
 */
export function readTurns(files: readonly string[], attempts: 'last' | 'all' = 'last'): Turn[] {
  const out: Turn[] = [];
  for (const file of files) {
    const archive = JSON.parse(fs.readFileSync(file, 'utf8')) as { calls?: Call[] };
    const steps = (archive.calls ?? []).filter((c) => c.category === 'life_step');
    const keep = attempts === 'all' ? steps : lastAttempts(steps);
    for (const c of keep) {
      // An unparseable response is a real OUTCOME, not a row to skip — it is
      // the thing `response parsed` measures, and dropping it would make every
      // other rate read off a population the run did not have.
      let res: Res | null;
      try {
        res = JSON.parse(c.response) as Res;
      } catch {
        res = null;
      }
      out.push({ seq: c.seq, attempt: c.attempt, prompt: c.prompt, res });
    }
  }
  return out;
}

/** The final attempt of each turn: drop any call the NEXT call is a retry of.
 *  Works for a ladder of any depth, and for an archive that never retried. */
export function lastAttempts(steps: readonly Call[]): Call[] {
  return steps.filter((c, i) => {
    const next = steps[i + 1];
    return !next || next.attempt <= c.attempt;
  });
}

// ── shape helpers (see TRAPS above — each of these exists because of one) ────

const node = (t: Turn): Node => t.res?.node ?? {};

/** Every option the turn produced, from all THREE places they hide. */
export function options(t: Turn): Option[] {
  const n = node(t);
  return [...(t.res?.options ?? []), ...(n.options ?? []), ...(n.resolution?.options ?? [])];
}

/** Options the player could actually CHOOSE BETWEEN — the synthetic Continue
 *  chip is a tap, not a decision, and it obeys none of the option rules. */
const choices = (t: Turn): Option[] => options(t).filter((o) => o.id !== 'continue');

/** Beats the player saw, node and resolution alike. */
export function beats(t: Turn): Beat[] {
  const n = node(t);
  return [...(n.beats ?? []), ...(n.resolution?.beats ?? [])];
}

/**
 * The speechAct of the pick that led to this turn, read off the prompt.
 *
 * `null` when this turn had no choice behind it (an opening, a Continue). A
 * `<turn kind="choice">` with NO attribute means the option omitted `speechAct`
 * — which per `stepSpeech.ts` means `act`, not "unknown". Getting that wrong is
 * trap 2 above.
 *
 * The `([^>]*)` is not decoration: a `>`-terminated match excludes precisely
 * the turns that CARRY the attribute, which is the population the rule is about.
 */
export function pickSpeechAct(t: Turn): 'say' | 'act' | null {
  const tag = /<turn kind="choice"([^>]*)>/.exec(t.prompt);
  if (!tag) return null;
  const attr = /speechAct="(say|hear|act)"/.exec(tag[1] ?? '');
  return attr ? (attr[1] as 'say' | 'act') : 'act';
}

const isQuestion = (t: Turn): boolean => node(t).kind === 'question' || Boolean(node(t).gradedPlan);
const text = (b: Beat): string => `${b.practiceText ?? ''} ${b.nativeText ?? ''}`;

// ── the rules ───────────────────────────────────────────────────────────────

/**
 * Each entry names the invariant AND, where one exists, the string test from
 * the 43 that it replaces. A rule with no counterpart in the 43 is marked
 * `(new)` — those come from the same reading and are here because the archive
 * happened to make them free.
 */
export const RULES: Record<string, (ts: readonly Turn[]) => Rate> = {
  // ── LIFE-SPEECH ───────────────────────────────────────────────────────────

  /** LIFE-SPEECH-3 — "the ONLY way a player ever practises PRODUCING language".
   *  Replaces "outbound grading is instructed ON THE OPTION". Cadence is ~1 per
   *  graded moment, so this is a low rate by design; ZERO is not low, it is the
   *  feature being absent. */
  'LIFE-SPEECH-3 say option carries gradeTarget': (ts) => {
    const say = ts.flatMap(choices).filter((o) => o.speechAct === 'say');
    return rate(say.filter((o) => o.gradeTarget?.trim()).length, say.length);
  },

  /** LIFE-SPEECH-3 — a gradeTarget the line does not literally contain is
   *  SILENTLY DROPPED, so a broken one costs the exercise with no error
   *  anywhere. Nothing in the validator or the parser sees this. */
  'LIFE-SPEECH-3 gradeTarget appears verbatim in its own saysLine': (ts) => {
    const g = ts.flatMap(choices).filter((o) => o.gradeTarget?.trim());
    return rate(
      g.filter((o) => (o.saysLine?.practiceText ?? '').includes(o.gradeTarget!.trim())).length,
      g.length,
    );
  },

  /** LIFE-SPEECH-1 — "a 'say' option MUST carry saysLine or the pick surfaces
   *  NO player bubble". Schema-enforced, so read this on `attempts: 'all'` for
   *  the model's raw rate. */
  'LIFE-SPEECH-1 say option carries saysLine': (ts) => {
    const say = ts.flatMap(choices).filter((o) => o.speechAct === 'say');
    return rate(say.filter((o) => o.saysLine).length, say.length);
  },

  /** LIFE-SPEECH-1 — saysLine belongs to a `say` and nowhere else. */
  'LIFE-SPEECH-1 non-say option carries no saysLine': (ts) => {
    const other = ts.flatMap(choices).filter((o) => o.speechAct !== 'say');
    return rate(other.filter((o) => !o.saysLine).length, other.length);
  },

  /**
   * LIFE-SPEECH-8 — `LIFE-SPEECH-4 question after a hear pick is comprehension`
   * was here and is REMOVED with the value it measured.
   *
   * It reported `— —  0/0` on every arm it was ever run against, which is the
   * honest output of a rule whose population is empty: `hear` was authored 4
   * times in 2,110 options. A row that can only print a dash is not coverage,
   * it is a line item that makes the table look more thorough than it is —
   * which is the exact failure mode this file's own header warns about.
   */

  /**
   * LIFE-SPEECH-3 — "DO NOT author this as a node": after a speech pick the
   * line is already spoken, so there is nothing left to intercept. Counted as
   * CONFORMANCE (absence of the node), so 100% is good like every other row.
   *
   * **READ THIS ROW MORE SOFTLY THAN THE OTHERS.** It is an authoring
   * PREFERENCE, not a contract: nothing rejects a fill-blank node after a `say`
   * pick. The player gets a working exercise on a line they are about to say;
   * it is just not the route the design prefers, and it spends a whole node on
   * what an option could have carried. A low rate here is a design smell, not a
   * defect.
   *
   * **It got MORE informative under LIFE-EX-18, not less.** It used to be
   * partly an artefact: the say→fill-blank repair FORCED post-`say` question
   * nodes into this shape, so the row was measuring the repair as much as the
   * model. With the repair gone and the kind derived from the plan's own fields,
   * what this counts is what the model actually chose to author.
   */
  'LIFE-SPEECH-3 no fill-blank NODE after a say pick': (ts) => {
    const after = ts.filter((t) => pickSpeechAct(t) === 'say');
    return rate(after.filter((t) => node(t).gradedPlan?.kind !== 'generation').length, after.length);
  },

  // ── LIFE-NODE / cadence ───────────────────────────────────────────────────

  /** LIFE-NODE-7 — replaces "states the question + continuation cadences". A
   *  continuation is a turn the player TAPS THROUGH instead of choosing in, so
   *  this rate is the share of turns that took the player's agency away. Low is
   *  good; it is phrased as "is a real choice" so the column reads like the
   *  others. */
  'LIFE-NODE-7 turn offers a choice (not a continuation)': (ts) =>
    rate(ts.filter((t) => node(t).kind !== 'continuation').length, ts.length),

  /** LIFE-NODE-7 — the question cadence is ~1 in 3. Reported as a rate with no
   *  threshold: both a drill and a story with no practice in it are failures,
   *  and only the two arms side by side say which way a change moved. */
  'LIFE-NODE-7 turn is a question (cadence, target ~1 in 3)': (ts) =>
    rate(ts.filter(isQuestion).length, ts.length),

  /** LIFE-EX-PLAN-5 — the question pre-authors what happens after the answer,
   *  in the SAME call. Without it the turn dead-ends at resolution. */
  'LIFE-EX-PLAN-5 question carries a resolution': (ts) => {
    const q = ts.filter(isQuestion);
    return rate(q.filter((t) => node(t).resolution).length, q.length);
  },

  /** LIFE-CONTRACT-EX-6/9 — a question reached by an ACTION pick narrates the
   *  action first. Conditional on the pick: after a `say` the line is already on
   *  screen and `beats: []` is correct, which is the exact confusion that made
   *  `question-omits-lead-in` reject 9 valid responses (`LIFE-CONTRACT-EX-10`). */
  'LIFE-CONTRACT-EX-6 question after an act pick has a lead-in beat': (ts) => {
    const q = ts.filter((t) => isQuestion(t) && pickSpeechAct(t) === 'act');
    return rate(q.filter((t) => (node(t).beats ?? []).length > 0).length, q.length);
  },

  /** LIFE-CONTRACT-EX-6 — the lead-in must not pre-empt the tested line.
   *
   *  Measures the MODEL, not the app: `stripLeakingLeadIns` drops the offending
   *  beat downstream (`LIFE-CONTRACT-EX-8`), so a low rate here costs the
   *  player nothing directly — it costs a beat, and it says the rule is not
   *  landing. */
  'LIFE-CONTRACT-EX-6 lead-in does not leak the tested line': (ts) => {
    const q = ts.filter((t) => isQuestion(t) && (node(t).beats ?? []).length > 0);
    return rate(
      q.filter((t) => {
        const target = node(t).gradedPlan?.testTarget?.trim();
        const utterance = node(t).gradedPlan?.npcUtterance?.trim();
        const body = (node(t).beats ?? []).map((b) => b.practiceText ?? '').join(' ');
        if (utterance && body.includes(utterance)) return false;
        return !(target && containsWord(body, target));
      }).length,
      q.length,
    );
  },

  /**
   * LIFE-CONTRACT-EX-6, the exact case — *"NEVER emit the npcUtterance as a
   * beat anywhere"*. Sharper than the leak rule above and worth its own row: a
   * comprehension question whose tested line is sitting on screen, glossed,
   * directly above it is not a question. The player reads the answer.
   *
   * The app does not ship it — `stripLeakingLeadIns` drops the beat — so the
   * cost is a question that arrives with NO lead-in, which is
   * `LIFE-CONTRACT-EX-7`'s defect reached by another road.
   */
  'LIFE-CONTRACT-EX-6 comprehension does not show the tested line first': (ts) => {
    const q = ts.filter((t) => node(t).gradedPlan?.npcUtterance);
    return rate(
      q.filter((t) => {
        const line = node(t).gradedPlan!.npcUtterance!.trim();
        return !(node(t).beats ?? []).some((b) => (b.practiceText ?? '').trim() === line);
      }).length,
      q.length,
    );
  },

  // ── LIFE-OPT ──────────────────────────────────────────────────────────────

  /** LIFE-OPT-VARIETY — "the same options every time", the owner's own report.
   *  A grid whose every chip shares one type is the purest form of it. */
  'LIFE-OPT-VARIETY grid mixes action types': (ts) => {
    const grids = ts.map(choices).filter((g) => g.length >= 2);
    return rate(grids.filter((g) => new Set(g.map((o) => o.actionType)).size > 1).length, grids.length);
  },

  /** LIFE-OPT-VARIETY — "at least one DO/GO per set", or the turn is a Q&A bot. */
  'LIFE-OPT-VARIETY grid has an act-on-the-world option': (ts) => {
    const active = new Set(['do', 'move', 'offer', 'leave']);
    const grids = ts.map(choices).filter((g) => g.length >= 2);
    return rate(grids.filter((g) => g.some((o) => active.has(String(o.actionType)))).length, grids.length);
  },

  /** LIFE-GRID (new) — an untyped option has no shape, so the variety machinery
   *  cannot see it and `recentActions` cannot record it. */
  'LIFE-GRID option carries actionType': (ts) => {
    const o = ts.flatMap(choices);
    return rate(o.filter((x) => x.actionType).length, o.length);
  },

  // ── LIFE-LANG / bubble contract ───────────────────────────────────────────

  /** LIFE-LANG-13 — the PLAYER-VOICE rule: the model never writes the player's
   *  bubble; the client does, from `saysLine`. */
  'LIFE-LANG-13 no beat is spoken by the player': (ts) => {
    const b = ts.flatMap(beats);
    return rate(b.filter((x) => x.speaker !== 'user').length, b.length);
  },

  /** LIFE-LANG-13c — after a `say` pick the player's own line already occupies
   *  one of the turn's ~2 visible slots, so the node carries AT MOST ONE beat. */
  'LIFE-LANG-13c at most one beat after a say pick': (ts) => {
    const after = ts.filter((t) => pickSpeechAct(t) === 'say' && t.res);
    return rate(after.filter((t) => (node(t).beats ?? []).length <= 1).length, after.length);
  },

  /** LIFE-LANG-8 — one practice channel. An empty `practiceText` is a blank
   *  bubble; a missing gloss is an untappable one. */
  'LIFE-LANG-8 beat carries both languages': (ts) => {
    const b = ts.flatMap(beats);
    return rate(b.filter((x) => x.practiceText?.trim() && x.nativeText?.trim()).length, b.length);
  },

  /** LIFE-LANG-18 (new) — the vocab channel the flashcard deck reads. */
  'LIFE-LANG-18 beat carries wordTranslations': (ts) => {
    const b = ts.flatMap(beats);
    return rate(b.filter((x) => Object.keys(x.wordTranslations ?? {}).length > 0).length, b.length);
  },

  /** LIFE-CONTRACT-BUBBLE — the UI draws the bubble, so quotes inside the text
   *  render as doubled punctuation. */
  'LIFE-CONTRACT-BUBBLE beat carries no quote marks': (ts) => {
    const b = ts.flatMap(beats);
    return rate(b.filter((x) => !/[«»"]/.test(x.practiceText ?? '')).length, b.length);
  },

  /** LIFE-LANG-13 — "…, dit-elle" is the attribution the avatar already gives,
   *  and "…, demandes-tu" is the player's line mislabelled as someone else's. */
  'LIFE-LANG-13 beat carries no attribution tag': (ts) => {
    const b = ts.flatMap(beats);
    return rate(
      b.filter((x) => !/,\s*(dit|demande|répond|dis|ajoute)[- ]?(-?[a-zé]+)?\b/i.test(x.practiceText ?? ''))
        .length,
      b.length,
    );
  },

  /** LIFE-STORY-LEXICON-2 — the stock warning-idiom. Only the IDIOM list is
   *  counted, never `BANNED_LEXICON`: that file says so itself, because a
   *  banned NOUN has an innocent concrete use and an idiom does not. Read on
   *  `nativeText`, which is the faithful English of the same line. */
  'LIFE-STORY-LEXICON-2 no stock warning idiom': (ts) => {
    const b = ts.flatMap(beats);
    return rate(
      b.filter((x) => !BANNED_IDIOMS.some((s) => text(x).toLowerCase().includes(s))).length,
      b.length,
    );
  },

  // ── per-response fields ───────────────────────────────────────────────────

  /** LIFE-SCENE-25 — "asks for sceneProgress EVERY turn, and says it is not
   *  gated". The scene boundary reads this; a turn without it is a turn the
   *  pacing cannot see. */
  'LIFE-SCENE-25 sceneProgress emitted': (ts) =>
    rate(ts.filter((t) => t.res?.scene?.sceneProgress != null).length, ts.length),

  /** LIFE-STORY-LOG-1 — the append-only spine every later prompt reads back. */
  'LIFE-STORY-LOG-1 logLine emitted': (ts) =>
    rate(ts.filter((t) => t.res?.logLine?.trim()).length, ts.length),

  /** LIFE-NPC-MEM-1 — MEASURED AT ~20% WITH THE RULE IN THE SHIPPED PROMPT.
   *  Kept because it is the counter-example this whole file exists to make
   *  visible: a passing string test beside a failing behaviour. It is also
   *  conditional by design ("only on real advancement"), so a low rate is not
   *  automatically wrong — only a DIFFERENCE between arms is readable. */
  'LIFE-NPC-MEM-1 npcMemoryUpdates emitted': (ts) =>
    rate(
      ts.filter((t) => Array.isArray(t.res?.npcMemoryUpdates) && t.res!.npcMemoryUpdates!.length > 0)
        .length,
      ts.length,
    ),

  /** The parse rate, so a rule set can never be read off responses that were
   *  not there. Bottom row on purpose: if this moves, nothing above it means
   *  what it says. */
  'response parsed': (ts) => rate(ts.filter((t) => t.res).length, ts.length),
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word containment that survives ACCENTS.
 *
 * NOT `\b`: JavaScript's word boundary is ASCII, so `\bétouffante\b` does not
 * match `l'air étouffante` — the boundary before `é` needs the preceding
 * character to be a word char, and `é` itself is not one. Every French target
 * carrying an accent would silently read as "no leak", which is the failure
 * mode where a check reports 100% because it can never fire. `\p{L}`
 * lookarounds under the `u` flag are the version that means what `\b` looks
 * like it means. (Third time this bug has appeared in this harness.)
 */
export function containsWord(body: string, word: string): boolean {
  return new RegExp(`(?<!\\p{L})${escapeRe(word)}(?!\\p{L})`, 'iu').test(body);
}

// ── comparison ──────────────────────────────────────────────────────────────

/** 95% Wilson interval — same reasoning as `retryRate.ts`: at these n the
 *  normal approximation produces bounds outside [0,1] and stops being believed. */
export function wilson(hit: number, total: number, z = 1.96): [number, number] {
  if (total <= 0) return [0, 0];
  const p = hit / total;
  const d = 1 + (z * z) / total;
  const c = p + (z * z) / (2 * total);
  const h = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

export type Comparison = {
  rule: string;
  a: Rate;
  b: Rate;
  /** b is BELOW a with the two intervals DISJOINT. An overlap is not a
   *  regression — that distinction is the whole of `LIFE-PRECEDENCE-1`, which
   *  was reverted for exactly this reason. */
  worse: boolean;
  /** b is ABOVE a, disjoint. Reported so an improvement cannot be mistaken for
   *  noise either. */
  better: boolean;
};

export function compareArms(a: readonly Turn[], b: readonly Turn[]): Comparison[] {
  return Object.entries(RULES).map(([rule, f]) => {
    const ra = f(a);
    const rb = f(b);
    return { rule, a: ra, b: rb, worse: disjointBelow(rb, ra), better: disjointBelow(ra, rb) };
  });
}

/** True when `lo`'s interval sits entirely BELOW `hi`'s. */
function disjointBelow(lo: Rate, hi: Rate): boolean {
  if (lo.total === 0 || hi.total === 0) return false;
  const [, loHi] = wilson(lo.hit, lo.total);
  const [hiLo] = wilson(hi.hit, hi.total);
  return loHi < hiLo;
}

export function conformance(ts: readonly Turn[]): Record<string, Rate> {
  return Object.fromEntries(Object.entries(RULES).map(([k, f]) => [k, f(ts)]));
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const pct = (r: Rate): string => {
  if (r.total === 0) return '     —    ';
  const [lo, hi] = wilson(r.hit, r.total);
  return `${(100 * (r.hit / r.total)).toFixed(0).padStart(3)}% [${(100 * lo).toFixed(0).padStart(2)},${(100 * hi).toFixed(0).padStart(3)}]`;
};

export function report(a: readonly Turn[], b: readonly Turn[], names: [string, string]): string {
  const rows = compareArms(a, b);
  const w = Math.max(...rows.map((r) => r.rule.length));
  const lines = [
    `${'rule'.padEnd(w)}  ${names[0].padEnd(14)}  ${names[1].padEnd(14)}  n(a)/n(b)`,
    '─'.repeat(w + 50),
  ];
  for (const r of rows) {
    const flag = r.worse ? '  ← WORSE' : r.better ? '  ← better' : '';
    lines.push(
      `${r.rule.padEnd(w)}  ${pct(r.a)}  ${pct(r.b)}  ${r.a.total}/${r.b.total}${flag}`,
    );
  }
  return lines.join('\n');
}

const isMain = process.argv[1]?.endsWith('ruleConformance.ts');
if (isMain) {
  const split = process.argv.indexOf('--');
  if (split < 3) throw new Error('usage: ruleConformance.ts <a-files...> -- <b-files...>');
  const aFiles = process.argv.slice(2, split);
  const bFiles = process.argv.slice(split + 1);
  const mode = (process.env.ATTEMPTS === 'all' ? 'all' : 'last') as 'last' | 'all';
  const a = readTurns(aFiles, mode);
  const b = readTurns(bFiles, mode);
  process.stdout.write(
    `attempts=${mode}  A=${aFiles.length} runs / ${a.length} turns  B=${bFiles.length} runs / ${b.length} turns\n\n`,
  );
  process.stdout.write(`${report(a, b, ['A', 'B'])}\n`);
}
