/**
 * THE QUALITY BENCHMARK — the dimensions, the scale, and the checks code owns.
 *
 * The point of this file is to make "is it getting better or worse?" a NUMBER
 * rather than a memory of how the last read-through felt. Every prompt change
 * from here is measured against it.
 *
 * ── TWO LAYERS, AND THE SPLIT IS THE WHOLE DESIGN ────────────────────────────
 *
 * MEASURED (this file). Facts. Question cadence, option-type spread, whether an
 * option names something no beat has shown, cliché density, subject repetition.
 * A model is never asked to score these, because it does not need to be asked:
 * the answer is computable, and a computed answer cannot be flattered.
 *
 * JUDGED (`judge.ts`). Opinions. Is the question worth answering? Is the prose
 * alive? Does anybody sound like a person? Those cannot be counted, so they go
 * to a model — under anchors strict enough that "fine" scores 2, not 4.
 *
 * The reason for the split is the failure this suite already had once: the five
 * original watch-list signals ALL PASSED on a world that read back as one scene
 * told ten times. Soft signals agree with you. Counts do not.
 *
 * ── THE SCALE ───────────────────────────────────────────────────────────────
 *
 *   0  BROKEN      actively bad; a player would notice and mind
 *   1  POOR        the failure mode this dimension exists to catch, present
 *   2  PASSABLE    nothing wrong, nothing good. The DEFAULT for adequate work.
 *   3  GOOD        a player would notice this favourably
 *   4  EXCELLENT   as good as this dimension gets, and rare
 *
 * 2 is the honest resting point for competent generation. A run averaging 2.5
 * is doing fine; a run averaging 3.5 would be suspicious and should be spot-
 * checked against the transcript before being believed.
 *
 * ── GATES ───────────────────────────────────────────────────────────────────
 *
 * Some dimensions do not average. A story that leaks what the player has not
 * seen, or contradicts itself, is not "good with one flaw" — it is broken, and
 * a mean would hide that behind nine good scores. Gate dimensions report
 * separately and fail the run outright.
 */
import type { OptionType } from '@/types/lifeState';

export type Dimension = {
  id: string;
  /** What a player would say if this scored 0. Kept because a dimension whose
   *  failure cannot be stated concretely is a dimension nobody can score. */
  failure: string;
  scope: 'scene' | 'story';
  /** Gate dimensions fail the run rather than averaging into it. */
  gate?: boolean;
  /** Measured dimensions are scored in code; the judge never sees them. */
  measured?: boolean;
};

export const DIMENSIONS: Dimension[] = [
  // ── learning ──────────────────────────────────────────────────────────────
  { id: 'LEARN-VALUE', scope: 'scene',
    failure: 'The graded moments taught nothing worth keeping — trivial words, or ones the player already had.' },
  { id: 'Q-QUALITY', scope: 'scene',
    failure: 'The question was unanswerable from context, or answerable without reading anything.' },
  { id: 'Q-TIMING', scope: 'scene',
    failure: 'The question was bolted onto a moment with no line in it — a pop quiz interrupting the story.' },
  { id: 'Q-CADENCE', scope: 'scene', measured: true,
    failure: 'Questions clustered or vanished: the gap between them is outside the 2-3 turn band.' },
  { id: 'Q-DIRECTION', scope: 'scene', measured: true,
    failure: 'One direction never fires. All production and no comprehension, or the reverse.' },

  // ── options ───────────────────────────────────────────────────────────────
  { id: 'OPT-FREEDOM', scope: 'scene',
    failure: 'The options were three ways of saying the same thing; the player had no real choice.' },
  { id: 'OPT-SPREAD', scope: 'scene', measured: true,
    failure: 'The grid repeated an action TYPE, or repeated the previous turn\'s shapes.' },
  /**
   * JUDGED ONLY. There is no `scoreLeak` any more, and the deletion is the
   * finding.
   *
   * A word-presence test was tried three times and narrowed twice — stem-fold
   * the inflections, skip the leading imperative, require a RUN of adjacent
   * unshown words rather than a lone one, plus capitalised names. Measured
   * false-positive rates after all of that, on a real four-world run: 28%, 32%,
   * 41%, 67%. What it was flagging by the end was "still works", "stool next",
   * "break room", "installation process" — ordinary English noun phrases, not
   * leaked story.
   *
   * The signal is not in the text. Deciding whether "the bandage cabinet" is a
   * leak or a fixture needs to know whether the story has a bandage cabinet,
   * and that question is answered by the CANON, not by earlier prose.
   *
   * Which is where it is already answered: `canonViolations` refuses an option
   * whose `targetId` is not in <canon>, at commit time, before the player sees
   * it. Prevention over detection — the codebase's own rule. Re-checking it
   * here could only ever score a vacuous 4, the exact trap OPT-SPREAD fell into.
   *
   * So the gate stays, and the JUDGE owns it: reading a transcript and asking
   * "was I ever shown this?" is a comprehension task, and comprehension is what
   * the judged layer is for. A gate that fires on all four worlds of every run
   * is not a gate — it is a light nobody looks at.
   */
  { id: 'OPT-LEAK', scope: 'scene', gate: true,
    failure: 'An option named something no beat had shown the player — the "ask about the hidden wire" bug.' },
  { id: 'INTENT', scope: 'scene',
    failure: 'What the player chose did not visibly shape what happened next; the story ran on regardless.' },

  // ── writing ───────────────────────────────────────────────────────────────
  { id: 'PROSE', scope: 'scene',
    failure: 'Overwritten, generic, or reaching for portent. Reads like every other LLM story.' },
  /**
   * JUDGED, not measured — the third check in this file to reach that verdict.
   *
   * A substring count matched `ash` inside "wash-house" and "cash flow", and
   * `final` inside "finally", and scored 0/4 on two worlds whose prose was
   * fine. Adding word boundaries fixed that and left the harder half untouched:
   * the lexicon bans these words as ATMOSPHERE and explicitly permits them
   * doing concrete work ("a burnt house really does have ash"), and no text
   * test can tell "the dusty toolbox" from "the Archive of Dust".
   *
   * That is a question about meaning, so it goes to something that can hold an
   * opinion about meaning. See the CLICHE entry in `markScheme.ts`, which
   * carries the distinction and a real anchor for it.
   */
  { id: 'CLICHE', scope: 'scene',
    failure: 'Stock idioms in dialogue, or the portentous-noun family supplying mood.' },
  /** LIFE-STORY-LEXICON-1's actual subject: what things are CALLED.
   *
   *  STILL MEASURED, and the exception proves the rule above: a NAME is a closed
   *  string with no surrounding sentence to judge, so "The Syndicate of Silence"
   *  needs no interpretation. Zero false positives across 74 names of a real
   *  run, where the prose check was wrong 28-67% of the time. */
  { id: 'CLICHE-NAME', scope: 'story', measured: true,
    failure: 'A title, place, faction or chapter name built from the portentous-noun family — "the Syndicate of Silence".' },
  { id: 'CHARACTER', scope: 'scene',
    failure: 'Nobody sounds like anybody. Two characters could swap lines and nothing would change.' },
  { id: 'HUMOUR', scope: 'scene',
    failure: 'Uniformly earnest, or joking in a register the scene has not earned.' },
  { id: 'DRAMA-FIT', scope: 'scene',
    failure: 'Drama out of proportion to where the story is — a thriller beat on day one, or nothing at all by day ten.' },
  { id: 'INTRIGUE', scope: 'scene',
    failure: 'No reason to take another turn. Nothing is pulling.' },

  // ── the story, read back whole ────────────────────────────────────────────
  { id: 'COHERENCE', scope: 'story', gate: true,
    failure: 'Scenes contradict each other, or a character acts against their own established description.' },
  { id: 'SUBJECT-SPREAD', scope: 'story', measured: true,
    failure: 'Scenes restate one another — the same subject rediscovered.' },
  { id: 'PACING', scope: 'story',
    failure: 'Sags, or sprints. The middle is where this fails.' },
  { id: 'ARC', scope: 'story',
    failure: 'A sequence of events rather than a story. Nothing is building.' },
  { id: 'ENDING', scope: 'story',
    failure: 'Scenes stop rather than land; outcomes are unearned or arbitrary.' },
  { id: 'CAST-DEPTH', scope: 'story',
    failure: 'Characters are functions, not people. Nobody wants anything of their own.' },
];

export type Score = { dimension: string; score: number; evidence: string; note: string };

/* ─────────────────────────── MEASURED CHECKS ──────────────────────────────
 * Each returns a 0-4 on the same scale so it composes with the judged ones,
 * plus the raw number it was derived from — the score is for the trend line,
 * the raw figure is what you actually debug against.
 */

export type TurnLike = {
  beats: { speaker: string; name: string | null; practice: string; native: string }[];
  /** `type: ''` is a REAL production shape, not a capture artefact: LIFE-GRID-1.1
   *  makes `actionType` optional in the schema on purpose, so a missing or
   *  unusable one degrades to an untyped option instead of failing the turn's
   *  parse. `optionSpreadIssues` skips a set it cannot type, and so does
   *  `scoreSpread` — reporting the count rather than scoring it either way. */
  options: { id: string; type: OptionType | ''; targetId: string | null; label: string }[];
  /** The option the player actually took, by label.
   *
   *  ABSENT UNTIL 2026-08-04, and its absence made INTENT unjudgeable: the
   *  transcript listed every option and marked none of them, so the judge was
   *  asked "did the player's choice shape what followed" while unable to see
   *  which choice was made. It scored a flat 2 on every world, which is what a
   *  judge returns when it cannot tell. */
  chose?: string | null;
  /** The graded question this turn carried, if it was a question turn. */
  graded?: { kind: string; target: string | null; line: string } | null;
  /** Canon ids/names this turn introduced — what the player can now be shown. */
  introduced?: string[];
};

/** Q-CADENCE — LIFE-EX-CADENCE: a question every 2-3 turns. */
export function scoreCadence(turns: readonly TurnLike[]): Score {
  const at: number[] = [];
  turns.forEach((t, i) => { if (t.graded) at.push(i); });
  if (at.length === 0) {
    return { dimension: 'Q-CADENCE', score: 0, evidence: `${turns.length} turns, 0 questions`,
      note: 'No graded moment at all — the app is a story with no lesson in it.' };
  }
  const gaps: number[] = [];
  let prev = -1;
  for (const i of at) { gaps.push(i - prev); prev = i; }
  const inBand = gaps.filter((g) => g >= 2 && g <= 3).length / gaps.length;
  const score = inBand >= 0.8 ? 4 : inBand >= 0.6 ? 3 : inBand >= 0.4 ? 2 : inBand > 0 ? 1 : 0;
  return { dimension: 'Q-CADENCE', score,
    evidence: `gaps [${gaps.join(', ')}] — ${Math.round(inBand * 100)}% in the 2-3 band`,
    note: `${at.length} questions across ${turns.length} turns.` };
}

/**
 * Q-DIRECTION — LIFE-SPEECH-1: both directions must actually fire.
 *
 * A learner who only ever PRODUCES language never learns to understand it, and
 * one who only ever interprets never learns to speak. The two are paced
 * separately and reach the player by different routes — outbound fill-blanks are
 * intercepted in the CLIENT off a `say` pick (`gradedSayPlan`, LIFE-SPEECH-3),
 * inbound comprehensions are authored by the MODEL inside the step call — so a
 * single aggregate question count can look healthy while one whole route is
 * dead. That is the specific thing this check exists to make visible; `origin`
 * rides in the evidence so a dead route names itself.
 */
export function scoreDirections(
  turns: readonly { graded?: { direction?: string; origin?: string } | null }[],
): Score {
  const qs = turns.map((t) => t.graded).filter((g): g is NonNullable<typeof g> => !!g);
  if (qs.length === 0) {
    return { dimension: 'Q-DIRECTION', score: 0,
      evidence: `0 questions across ${turns.length} turns`,
      note: 'Nothing to split — see Q-CADENCE.' };
  }
  const out = qs.filter((g) => g.direction === 'outbound').length;
  const inb = qs.filter((g) => g.direction === 'inbound').length;
  const byOrigin = `client ${qs.filter((g) => g.origin === 'client').length} / model ${qs.filter((g) => g.origin === 'model').length}`;
  // Balance, not parity: anywhere in 35-65% is fine, one direction at zero is not.
  const share = Math.min(out, inb) / qs.length;
  const score = share >= 0.35 ? 4 : share >= 0.25 ? 3 : share >= 0.15 ? 2 : share > 0 ? 1 : 0;
  return { dimension: 'Q-DIRECTION', score,
    evidence: `${out} outbound (produce) / ${inb} inbound (comprehend) — by origin: ${byOrigin}`,
    // Name the DEAD route, not the live one — that is the actionable half.
    note: share === 0
      ? `Only ${out ? 'outbound' : 'inbound'} questions ever fired: the ${out ? 'inbound' : 'outbound'} route is dead.`
      : `${Math.round(share * 100)}% of questions are in the smaller direction.` };
}

/** OPT-SPREAD — LIFE-GRID-1.2: types differ within a grid AND across turns. */
export function scoreSpread(turns: readonly TurnLike[]): Score {
  let sameWithin = 0;
  let repeatAcross = 0;
  let untyped = 0;
  let gradable = 0;
  let prev: Set<string> | null = null;
  for (const t of turns) {
    if (t.options.length < 2) continue;
    const types = t.options.map((o) => o.type);
    // An untyped grid cannot be scored for type variety — counting it as
    // single-type would invent a failure the player never saw. Counted and
    // reported instead, because a run that is MOSTLY untyped is its own defect.
    if (types.some((x) => x === '')) { untyped++; continue; }
    gradable++;
    if (new Set(types).size < 2) sameWithin++;
    const shapes = new Set(t.options.map((o) => `${o.type}:${o.targetId ?? ''}`));
    if (prev && [...shapes].every((s) => prev!.has(s))) repeatAcross++;
    prev = shapes;
  }
  // ABSENT DATA IS NOT A PASS. This divided by `|| 1` and scored 4 when NO turn
  // had options at all — reporting perfect option variety for a run with zero
  // options, which is how a harness bug came back as a clean bill of health.
  // A check that cannot see its subject must say so, not congratulate it.
  if (gradable === 0) {
    return { dimension: 'OPT-SPREAD', score: 0,
      evidence: `no typed grid across ${turns.length} turns (${untyped} untyped, ${turns.filter((t) => t.options.length >= 2).length} with 2+ options)`,
      note: 'NOT a variety failure — there was nothing to measure. Check the capture before reading this as a product defect.' };
  }
  const bad = (sameWithin + repeatAcross) / gradable;
  const score = bad === 0 ? 4 : bad <= 0.1 ? 3 : bad <= 0.25 ? 2 : bad <= 0.5 ? 1 : 0;
  return { dimension: 'OPT-SPREAD', score,
    evidence: `${sameWithin} single-type grids, ${repeatAcross} grids repeating the previous turn, of ${gradable} typed${untyped ? ` (+${untyped} untyped, unscored)` : ''}`,
    note: 'A grid where every option is the same TYPE is the reported "same options every time".' };
}

/** Whole-word, case-insensitive, Unicode-safe. */
function countPhrase(haystack: string, phrase: string): number {
  const re = new RegExp(`(?<!\\p{L})${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'giu');
  return (haystack.match(re) ?? []).length;
}

/**
 * CLICHE-NAME — LIFE-STORY-LEXICON-1 measured on the surface it was written for.
 *
 * The lexicon's own words: the ban is on the ABSTRACT use, "in titles, chapter
 * names, place names, faction names, character epithets" — and a banned word in
 * a NAME is unambiguously that. "The Syndicate of Silence" is the reported
 * failure verbatim; "the dusty toolbox" is a toolbox.
 *
 * So this is the half of the rule a substring test can adjudicate honestly, and
 * it is precise: no morphology problem, no concrete/abstract judgement, no
 * false positives to tune away. `scoreCliche` below takes the half that is left
 * and is careful about how little it claims.
 */
export function scoreLexiconNames(names: readonly string[], banned: readonly string[]): Score {
  const real = names.map((n) => n.trim()).filter(Boolean);
  if (real.length === 0) {
    return { dimension: 'CLICHE-NAME', score: -1, evidence: 'no names captured',
      note: 'UNMEASURED — nothing to check.' };
  }
  const hits: string[] = [];
  for (const n of real) {
    for (const b of banned) if (countPhrase(n, b) > 0) hits.push(`"${n}" [${b}]`);
  }
  const rate = hits.length / real.length;
  const score = hits.length === 0 ? 4 : rate <= 0.05 ? 2 : rate <= 0.15 ? 1 : 0;
  return { dimension: 'CLICHE-NAME', score,
    evidence: hits.slice(0, 4).join(' · ') || `${real.length} names, none from the banned family`,
    note: `${hits.length} of ${real.length} names (titles, places, cast, fronts, chapters) reach for the portentous-noun family.` };
}

/**
 * SUBJECT-SPREAD — the read-back check that caught the ten-Pierres world.
 *
 * Two numbers, because they fail differently: how many history lines restate an
 * earlier one, and what share of lines the single most common content word
 * covers. On the known-bad run that word covered 10/10 lines.
 */
export function scoreSubjects(history: readonly string[]): Score {
  // DOMINANCE OVER TWO LINES IS NOT A MEASUREMENT. Any word shared by both is
  // 2/2 = 100%, which scored 0 on a 2-scene world whose two scenes were about
  // entirely different things — the check reported the ten-Pierres failure on a
  // run that could not exhibit it. Four lines is the fewest that can tell a
  // repeated subject from a coincidence.
  if (history.length < 4) {
    return { dimension: 'SUBJECT-SPREAD', score: -1,
      evidence: `${history.length} scene lines`,
      note: 'UNMEASURED — dominance needs at least 4 lines to distinguish a repeated subject from a shared word. Not a pass and not a failure.' };
  }
  const bag = (s: string) =>
    new Set(s.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 5));
  const bags = history.map(bag);
  let restated = 0;
  for (let i = 1; i < bags.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = bags[i]!; const b = bags[j]!;
      const shared = [...a].filter((w) => b.has(w)).length;
      if (shared / Math.max(1, Math.min(a.size, b.size)) >= 0.5) { restated++; break; }
    }
  }
  const counts = new Map<string, number>();
  for (const b of bags) for (const w of b) counts.set(w, (counts.get(w) ?? 0) + 1);
  const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0] ?? ['—', 0];
  const dominance = (top[1] as number) / history.length;
  const restatedRatio = restated / (history.length - 1);
  const score =
    dominance >= 0.9 || restatedRatio >= 0.6 ? 0
      : dominance >= 0.7 || restatedRatio >= 0.4 ? 1
        : dominance >= 0.5 || restatedRatio >= 0.25 ? 2
          : dominance >= 0.35 ? 3 : 4;
  return { dimension: 'SUBJECT-SPREAD', score,
    evidence: `"${top[0]}" in ${top[1]}/${history.length} lines; ${restated} restate an earlier line`,
    note: 'Dominance ≥0.9 is the ten-scenes-one-subject failure.' };
}

/**
 * The composite. Gates are reported apart from the mean, deliberately.
 *
 * A dimension scored by BOTH layers — `OPT-LEAK` is measured in code AND judged,
 * because a substring test cannot see a paraphrased leak and a judge cannot be
 * exhaustive — collapses to the WORSE of the two. A leak found by either is a
 * leak, and averaging them would let one layer forgive the other.
 *
 * A gate fails at 0-1, not at 2. Two is "nothing wrong, nothing good", which is
 * a perfectly shippable state for a dimension whose job is to be uneventful.
 */
/**
 * One score per dimension, keeping the worse of any duplicate.
 *
 * EXPORTED because `composite` used to do this privately, so the mean was right
 * while every printed report still listed the raw pair — `OPT-LEAK 0` from the
 * substring check and `OPT-LEAK 2` from the judge, adjacent, with nothing
 * saying which one drove the composite. A reader had to know the collapse rule
 * to read the table. Reports and pages call this first.
 */
export function collapse(scores: readonly Score[]): Score[] {
  const worst = new Map<string, Score>();
  for (const s of scores) {
    const prev = worst.get(s.dimension);
    if (!prev) { worst.set(s.dimension, s); continue; }
    // A NEGATIVE SCORE IS "UNMEASURED", NOT "WORST". Taking the minimum blindly
    // would let a layer that could not see its subject overrule one that could
    // — the same mistake as scoring absent data, one level up.
    if (prev.score < 0) { if (s.score >= 0) worst.set(s.dimension, s); continue; }
    if (s.score >= 0 && s.score < prev.score) worst.set(s.dimension, s);
  }
  return [...worst.values()];
}

/**
 * BENCH-1 — the MEDIAN of N judging passes over the same transcript.
 *
 * ── WHY THE SINGLE PASS IS NOT A RULER ──────────────────────────────────────
 *
 * `judgeVariance.probe.ts` exists because this session read INTENT 1.63 → 1.13
 * as a regression and CHARACTER 1.88 → 1.38 as collateral damage, both from
 * ONE pass per arm. A judge at temperature has its own spread on a FIXED
 * transcript (~0.2 composite), so a claimed effect smaller than that spread is
 * unearned however tidy the story around it. Every story-shaped change is
 * blocked on this, which is why it is a prerequisite and not an improvement.
 *
 * ── MEDIAN, NOT MEAN ────────────────────────────────────────────────────────
 *
 * The scale is 0-4 integers with a `-1` UNMEASURED sentinel, and the failure
 * being guarded against is a single pass landing a wild score. A mean drags
 * toward that outlier; a median ignores it, which is the whole point. It also
 * keeps the result ON the scale — a mean of [2,3,3] is 2.67, a number no band
 * in the mark scheme describes.
 *
 * ── UNMEASURED IS NOT ZERO, AGAIN ───────────────────────────────────────────
 *
 * Same trap as `collapse` and `composite`, for the third time in this file: a
 * `-1` means "this pass could not see its subject", not "this pass scored
 * badly". Including it in the sort would drag the median down on exactly the
 * dimensions least able to defend themselves. So `-1`s are dropped first, and
 * a dimension where EVERY pass was unmeasured stays unmeasured.
 *
 * The returned `note` carries the passes and the observed spread, so a reader
 * of the report can see the ruler's own precision beside the number instead of
 * having to remember it.
 */
export function medianScores(passes: readonly (readonly Score[])[]): Score[] {
  const byDim = new Map<string, Score[]>();
  for (const pass of passes) {
    for (const s of pass) {
      const list = byDim.get(s.dimension);
      if (list) list.push(s);
      else byDim.set(s.dimension, [s]);
    }
  }
  const out: Score[] = [];
  for (const all of byDim.values()) {
    const measured = all.filter((s) => s.score >= 0);
    if (measured.length === 0) {
      // Every pass was blind to this dimension. Keep one, unchanged — inventing
      // a score here is the exact thing the sentinel exists to prevent.
      out.push(all[0]!);
      continue;
    }
    const sorted = [...measured].sort((a, b) => a.score - b.score);
    // Lower-middle for an even count: with 0-4 integers the two middles are
    // usually adjacent, and rounding down is the conservative read of a tie.
    const pick = sorted[Math.floor((sorted.length - 1) / 2)]!;
    const spread = sorted[sorted.length - 1]!.score - sorted[0]!.score;
    out.push({
      ...pick,
      note: measured.length > 1
        ? `${pick.note} [median of ${measured.length}, spread ${spread}]`
        : pick.note,
    });
  }
  return out;
}

export function composite(scores: readonly Score[]): {
  mean: number; gateFailures: Score[]; weakest: Score[];
} {
  const byId = new Map(DIMENSIONS.map((d) => [d.id, d]));
  scores = collapse(scores);
  // `s.score >= 0` first: an UNMEASURED gate is not a failed one. Without it
  // the -1 sentinel reads as the worst possible score and fails the gate on
  // exactly the runs that could not check it.
  const gateFailures = scores.filter(
    (s) => byId.get(s.dimension)?.gate && s.score >= 0 && s.score <= 1);
  const scored = scores.filter((s) => s.score >= 0);
  const mean = scored.reduce((a, s) => a + s.score, 0) / (scored.length || 1);
  const weakest = [...scored].sort((a, b) => a.score - b.score).slice(0, 5);
  return { mean, gateFailures, weakest };
}

/** Story-scope dimensions the judge owns. Local so `rescore` can re-apply the
 *  withholding rule without importing the Gemini transport. */
function storyJudged(): string[] {
  return DIMENSIONS.filter((d) => d.scope === 'story' && !d.measured).map((d) => d.id);
}

/**
 * Dimensions that need a story long enough to HAVE one, and the floor they need.
 *
 * ── WHY THESE ARE WITHHELD RATHER THAN SCORED LOW ───────────────────────────
 *
 * The two SHORT worlds are played for two scenes on purpose — they exist to
 * test world CREATION in an unusual genre, not to reach a climax. Asked to
 * score them anyway, the judge said exactly what a reader would: *"the
 * playthrough simply stops during the movement to the basement; there is no
 * narrative resolution"* (ENDING 0) and *"a disconnected list of tasks... no
 * progression between the two scenes"* (ARC 1).
 *
 * Both observations are TRUE and neither is about the product. The run stopped
 * because the harness stopped it. Scoring that is the mirror of the vacuous
 * pass this benchmark already had to fix once: absent data is not a pass, and
 * it is not a failure either. A number the run could not earn drags the
 * aggregate and hides real movement in the dimensions that were measurable.
 *
 * (ENDING remains only partly trustworthy even on the long worlds: the loop
 * stops at a fixed turn count rather than when `scene.resolved` fires, so it
 * still measures where the harness cut as much as where the story landed.
 * Honouring `resolved` is the fix; until then read ENDING with that in mind.)
 */
const NEEDS_SCENES: Record<string, number> = { ARC: 4, ENDING: 4, PACING: 4 };

/** Story dimensions this run is long enough to be judged on. */
export function storyDimensionsFor(sceneCount: number): string[] {
  return storyJudged().filter((id) => sceneCount >= (NEEDS_SCENES[id] ?? 0));
}

/** The withheld ones, as explicit UNMEASURED rows rather than silent absence. */
export function withheldStoryDimensions(sceneCount: number): Score[] {
  return storyJudged()
    .filter((id) => sceneCount < (NEEDS_SCENES[id] ?? 0))
    .map((id) => ({
      dimension: id, score: -1, evidence: `${sceneCount} scenes played`,
      note: `UNMEASURED — needs ${NEEDS_SCENES[id]}+ scenes. A run the harness cut short cannot be judged on how it ends.`,
    }));
}

/**
 * INTENT-MOVED — LIFE-INTENT-2, and the reason it is MEASURED rather than judged.
 *
 * INTENT itself is a meaning-question and stays with the judge; three earlier
 * attempts to score narrative properties by substring all produced fake
 * findings. But "did the scene's leaning move this turn" is not a meaning
 * question — the model DECLARED it, per turn, in a boolean. That declaration is
 * countable, and counting it is the one number in this suite the model cannot
 * talk its way around: a run where the judge says choices matter and this says
 * 5% is a run where one of the two is wrong, and now we can tell.
 *
 * UNMEASURED (-1) when the run produced no claims at all — scenes opened before
 * LIFE-INTENT-2, or a run that never reached a live turn. Absent data is not a
 * pass and not a failure.
 */
export function scoreLeaningMovement(
  claims: readonly { moved: boolean; stall: number; restatedQuestion?: boolean }[],
): Score {
  if (claims.length === 0) {
    return { dimension: 'INTENT-MOVED', score: -1,
      evidence: 'no leaning claims recorded',
      note: 'UNMEASURED — the scenes in this run carry no openQuestion (pre-LIFE-INTENT-2).' };
  }
  const moved = claims.filter((c) => c.moved).length;
  const share = moved / claims.length;
  const worstStall = claims.reduce((m, c) => Math.max(m, c.stall), 0);
  // LIFE-INTENT-3: claimed moves REJECTED for restating the question rather
  // than taking a position. Reported separately because a low move-rate caused
  // by rejection and one caused by an honestly quiet scene want opposite fixes,
  // and collapsing them into a single percentage hides which one this is.
  const restated = claims.filter((c) => c.restatedQuestion).length;
  const restatedNote = restated ? ` — ${restated} claimed move(s) rejected as a restated question` : '';
  // A third of turns moving the scene is a story responding to its player; a
  // tenth is decoration. Not higher than ~a half by design — a scene where
  // EVERY turn swings the answer is as unreadable as one where none do, and
  // the escalation deliberately permits quiet turns.
  const score = share >= 0.33 ? 4 : share >= 0.25 ? 3 : share >= 0.15 ? 2 : share > 0 ? 1 : 0;
  return { dimension: 'INTENT-MOVED', score,
    evidence: `${moved} of ${claims.length} turns moved the scene's leaning (${Math.round(share * 100)}%) — longest stall ${worstStall}${restatedNote}`,
    note: share === 0
      ? 'No player action ever moved the scene: on rails by the engine\'s own accounting.'
      : `${Math.round(share * 100)}% of turns changed where the open question sits.` };
}
