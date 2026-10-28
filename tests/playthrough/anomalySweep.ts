/**
 * LIFE-BENCH-4 — the anomaly sweep. Reads ONE run's artefacts and reports what
 * the rubric does not.
 *
 *     npm run test:playthrough:sweep -- <stamp>
 *
 * WHY THIS EXISTS. The judge scores the STORY. Nothing scored the ENGINE, and
 * the engine's real costs and defects live in the call log — the retry column,
 * the latency spread, the responses that failed to parse. Written 2026-08-05
 * and it found four defects in one sitting, none of which any existing signal
 * would ever have shown: an unwinnable retry silently dropping questions
 * (`LIFE-EX-PLAN-6`), a HARD rule checked nowhere (`LIFE-EX-PLAN-7`), and two
 * spelling choices each costing a whole ~21k-token turn (`LIFE-NODE-16e`,
 * `LIFE-NODE-19`).
 *
 * HOW TO READ IT. Every check reports a NUMBER first and a judgement second,
 * and a check that fires ZERO is as informative as one that fires — "0 player
 * lines echoed by an NPC" is the evidence that `LIFE-SPEECH-6` works. Do not
 * delete the quiet ones.
 *
 * WHAT IT IS NOT. It cannot tell you whether a story is good; that is the
 * judge's job. It also cannot prove a defect on its own — every number here is
 * a lead. Two of its checks were WRONG on first use and reported real-looking
 * problems that did not exist:
 *
 *   - Orphan option targets read 18.5% because the check compared `targetId`
 *     against the CAST only; every hit was a `plac-` slug, and an option may
 *     legitimately target a place. Now filtered, and it reads 0.
 *   - "scenePace is ignored" came from substring-matching the word `overdue`
 *     anywhere in the prompt. Parsing the actual tag showed compliance climbing
 *     2% → 6% → 57% by stage; the ladder works.
 *
 * Both were caught by looking at the underlying rows instead of trusting the
 * aggregate. Do that before reporting anything from here as a bug.
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '.playthroughs';
const stamp = process.argv[2];
if (!stamp) throw new Error('usage: anomalySweep.ts <stamp>');

type Call = {
  seq: number; category: string; model: string; attempt: number; ms: number;
  inTokens: number; outTokens: number; prompt: string; response: string;
  error: string | null; systemInstructionRef: string;
};
type Beat = { speaker: string; name: string | null; practice: string; native: string };
type Opt = { id: string; type?: string; targetId?: string | null; label: string; speechAct?: string };
type Turn = {
  scene: number; turn: number; beats: Beat[]; options: Opt[]; chose?: string;
  graded?: {
    kind: string; target?: string; line?: string;
    /** LIFE-BENCH-6 changed this from a truncated JSON STRING to the prompt
     *  OBJECT. Both shapes are accepted — the sweep's whole job is reading
     *  ARCHIVED runs, and every transcript written before that change has the
     *  string. Read it through `promptOf`, never `JSON.parse` directly. */
    prompt?: string | Record<string, unknown>;
    choices?: unknown[];
  } | null;
  introduced?: unknown[];
};

/**
 * The graded prompt as an object, from either transcript generation.
 *
 * Worth the four lines: `JSON.parse` on an object stringifies it to
 * "[object Object]" and throws, and every call site here is wrapped in
 * `catch { continue }` — so the sweep would have reported ZERO on every
 * prompt-derived measure (lineVocab coverage, gloss-echo, duplicate
 * utterance) and looked like a clean bill of health rather than a broken
 * reader. Exactly the silent-empty failure this tool exists to find.
 */
function promptOf(g: { prompt?: string | Record<string, unknown> } | null | undefined):
  Record<string, unknown> | null {
  const p = g?.prompt;
  if (!p) return null;
  if (typeof p !== 'string') return p;
  try {
    const parsed = JSON.parse(p) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
type Scene = {
  index: number; title: string; subject: string; where: string; turns: Turn[];
  castAfter?: { id?: string; name?: string }[];
};

const calls: Call[] = JSON.parse(
  fs.readFileSync(path.join(DIR, `${stamp}-calls.json`), 'utf8'),
).calls;

const names = fs
  .readdirSync(DIR)
  .filter((f) => f.startsWith(stamp) && /-(?!calls|REPORT)[A-Za-z]+\.json$/.test(f))
  .filter((f) => !f.includes('rejudged'));

const runs = names.map((f) => ({
  name: f.replace(stamp + '-', '').replace('.json', ''),
  d: JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')),
}));

const out: string[] = [];
const say = (s = '') => out.push(s);
const pct = (a: number, b: number) => (b === 0 ? '-' : `${((100 * a) / b).toFixed(1)}%`);

// ══════════════════════════════════════════════════════════ CALL LOG

say('══ 1. RETRIES per category (attempt>0 = the model got it wrong once)');
{
  const by = new Map<string, { calls: number; retried: number; maxAttempt: number }>();
  const seqSeen = new Map<number, string>();
  for (const c of calls) {
    seqSeen.set(c.seq, c.category);
    const r = by.get(c.category) ?? { calls: 0, retried: 0, maxAttempt: 0 };
    if (c.attempt === 0) r.calls += 1;
    else r.retried += 1;
    r.maxAttempt = Math.max(r.maxAttempt, c.attempt);
    by.set(c.category, r);
  }
  for (const [k, v] of [...by].sort((a, b) => b[1].retried - a[1].retried)) {
    say(`  ${k.padEnd(26)} first-tries ${String(v.calls).padStart(4)}  retries ${String(v.retried).padStart(3)}  (${pct(v.retried, v.calls)})  worst attempt ${v.maxAttempt}`);
  }
}

say();
say('══ 2. TERMINAL FAILURES (error on the last attempt of a seq)');
{
  const last = new Map<number, Call>();
  for (const c of calls) {
    const prev = last.get(c.seq);
    if (!prev || c.attempt > prev.attempt) last.set(c.seq, c);
  }
  const failed = [...last.values()].filter((c) => c.error);
  say(`  ${failed.length} of ${last.size} logical calls ended in error (${pct(failed.length, last.size)})`);
  for (const f of failed.slice(0, 10)) say(`    seq ${f.seq} ${f.category}: ${String(f.error).slice(0, 140)}`);
}

say();
say('══ 3. LATENCY per category (a slow call is a UX defect, not just a cost)');
{
  const by = new Map<string, number[]>();
  for (const c of calls) (by.get(c.category) ?? by.set(c.category, []).get(c.category)!).push(c.ms);
  const q = (a: number[], p: number) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)] ?? 0;
  for (const [k, v] of [...by].sort((a, b) => q(b[1], 0.95) - q(a[1], 0.95))) {
    say(`  ${k.padEnd(26)} n=${String(v.length).padStart(4)}  p50 ${(q(v, 0.5) / 1000).toFixed(1)}s  p95 ${(q(v, 0.95) / 1000).toFixed(1)}s  max ${(Math.max(...v) / 1000).toFixed(1)}s`);
  }
}

say();
say('══ 4. UNPARSEABLE / TRUNCATED responses (JSON that does not close)');
{
  let bad = 0; const ex: string[] = [];
  for (const c of calls) {
    if (c.error) continue;
    const r = (c.response ?? '').trim();
    if (!r.startsWith('{') && !r.startsWith('[') && !r.startsWith('<')) continue;
    if (r.startsWith('<')) continue; // SVG
    try { JSON.parse(r); } catch {
      bad += 1;
      if (ex.length < 5) ex.push(`seq ${c.seq} ${c.category} attempt ${c.attempt} — ends: …${r.slice(-70)}`);
    }
  }
  say(`  ${bad} responses did not parse`);
  ex.forEach((e) => say('    ' + e));
}

say();
say('══ 5. PROMPT GROWTH — does any category grow unbounded across the run?');
{
  const by = new Map<string, { seq: number; t: number }[]>();
  for (const c of calls) {
    if (c.attempt !== 0) continue;
    (by.get(c.category) ?? by.set(c.category, []).get(c.category)!).push({ seq: c.seq, t: c.inTokens });
  }
  for (const [k, v] of by) {
    if (v.length < 6) continue;
    const first = v.slice(0, 3).reduce((a, b) => a + b.t, 0) / 3;
    const last = v.slice(-3).reduce((a, b) => a + b.t, 0) / 3;
    const flag = last > first * 1.8 ? '  ← GROWING' : '';
    say(`  ${k.padEnd(26)} first3 ${first.toFixed(0)} → last3 ${last.toFixed(0)} tokens (×${(last / first).toFixed(2)})${flag}`);
  }
}

say();
say('══ 6. PREFIX CHURN — one category, more than one system instruction');
{
  const by = new Map<string, Set<string>>();
  for (const c of calls) (by.get(c.category) ?? by.set(c.category, new Set()).get(c.category)!).add(c.systemInstructionRef);
  for (const [k, v] of by) if (v.size > 1) say(`  ${k.padEnd(26)} ${v.size} distinct SIs: ${[...v].join(' ')}`);
  say('  (>1 is EXPECTED across four worlds — different languages/levels. Flagged for eyeballing.)');
}

say();
say('══ 7. BACK-TO-BACK DUPLICATE CALLS (same category, ~same prompt)');
{
  let dup = 0; const ex: string[] = [];
  const firsts = calls.filter((c) => c.attempt === 0);
  for (let i = 1; i < firsts.length; i += 1) {
    const a = firsts[i - 1]!, b = firsts[i]!;
    if (a.category !== b.category) continue;
    if (a.prompt.length !== b.prompt.length) continue;
    if (a.prompt !== b.prompt) continue;
    dup += 1;
    if (ex.length < 5) ex.push(`seq ${a.seq}+${b.seq} ${a.category} — byte-identical prompt`);
  }
  say(`  ${dup} adjacent byte-identical prompt pairs`);
  ex.forEach((e) => say('    ' + e));
}

// ══════════════════════════════════════════════════════════ TRANSCRIPTS

const allScenes: { who: string; s: Scene }[] = [];
for (const r of runs) for (const s of (r.d?.run?.scenes ?? []) as Scene[]) allScenes.push({ who: r.name, s });
const allTurns: { who: string; s: Scene; t: Turn }[] = [];
for (const { who, s } of allScenes) for (const t of s.turns ?? []) allTurns.push({ who, s, t });

say();
say(`══ transcripts: ${runs.map((r) => r.name).join(', ')} — ${allScenes.length} scenes, ${allTurns.length} turns`);

say();
say('══ 8. OPTION GRID DEGENERACY');
{
  let grids = 0, dupLabel = 0, oneType = 0, twoOpt = 0;
  const ex: string[] = [];
  for (const { who, s, t } of allTurns) {
    const o = t.options ?? [];
    if (o.length === 0) continue;
    grids += 1;
    if (o.length <= 2) twoOpt += 1;
    const labels = o.map((x) => (x.label ?? '').trim().toLowerCase());
    if (new Set(labels).size !== labels.length) {
      dupLabel += 1;
      if (ex.length < 5) ex.push(`${who} s${s.index}t${t.turn}: ${labels.join(' | ')}`);
    }
    const types = new Set(o.map((x) => x.type ?? 'do'));
    if (types.size === 1 && o.length >= 3) oneType += 1;
  }
  say(`  grids ${grids} | duplicate labels ${dupLabel} (${pct(dupLabel, grids)}) | all-same-type (3+) ${oneType} (${pct(oneType, grids)}) | only 2 options ${twoOpt} (${pct(twoOpt, grids)})`);
  ex.forEach((e) => say('    ' + e));
}

say();
say('══ 9. SPEAKER NOT IN CAST (an NPC bubble from someone the roster does not know)');
{
  let npcBeats = 0, unknown = 0; const ex = new Set<string>();
  for (const { who, s, t } of allTurns) {
    const cast = new Set(((s.castAfter ?? []) as { name?: string }[]).map((c) => (c.name ?? '').trim().toLowerCase()).filter(Boolean));
    if (cast.size === 0) continue;
    for (const b of t.beats ?? []) {
      if (b.speaker !== 'npc' || !b.name) continue;
      npcBeats += 1;
      const n = b.name.trim().toLowerCase();
      if (![...cast].some((c) => c.includes(n) || n.includes(c))) {
        unknown += 1;
        if (ex.size < 8) ex.add(`${who} s${s.index}t${t.turn}: "${b.name}" not in [${[...cast].join(', ')}]`);
      }
    }
  }
  say(`  npc beats ${npcBeats} | speaker absent from the scene's cast ${unknown} (${pct(unknown, npcBeats)})`);
  [...ex].forEach((e) => say('    ' + e));
}

say();
say('══ 10. GRADED TARGET REUSE (the fresh-target rule, measured)');
{
  for (const r of runs) {
    const seen = new Map<string, number>();
    for (const s of (r.d?.run?.scenes ?? []) as Scene[]) {
      for (const t of s.turns ?? []) {
        const g = t.graded; if (!g || g.kind !== 'generation' || !g.target) continue;
        const k = g.target.trim().toLowerCase();
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
    const reused = [...seen].filter(([, n]) => n > 1);
    say(`  ${r.name.padEnd(7)} distinct targets ${seen.size} | reused ${reused.length}${reused.length ? ': ' + reused.map(([k, n]) => `${k}×${n}`).join(', ') : ''}`);
  }
}

say();
say('══ 11. COGNATE TARGETS (target ≈ its own English gloss — teaches nothing)');
{
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const lev = (a: string, b: string): number => {
    const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j += 1) m[0]![j] = j;
    for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1)
      m[i]![j] = Math.min(m[i - 1]![j]! + 1, m[i]![j - 1]! + 1, m[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length]![b.length]!;
  };
  let n = 0; const hits: string[] = [];
  for (const r of runs) for (const s of (r.d?.run?.scenes ?? []) as Scene[]) for (const t of s.turns ?? []) {
    const g = t.graded; if (!g?.target) continue;
    const p = promptOf(g) as { lineVocab?: Record<string, string> } | null;
    if (!p) continue;
    const gloss =
      p.lineVocab?.[g.target] ??
      Object.entries(p.lineVocab ?? {}).find(([k]) => k.includes(g.target!))?.[1] ?? '';
    if (!gloss) continue;
    n += 1;
    const a = norm(g.target), b = norm(gloss);
    if (a.length >= 5 && lev(a, b) <= Math.max(1, Math.floor(a.length * 0.25))) hits.push(`${r.name} s${s.index}: "${g.target}" ≈ "${gloss}"`);
  }
  say(`  targets with a gloss ${n} | near-identical to their gloss ${hits.length} (${pct(hits.length, n)})`);
  hits.slice(0, 8).forEach((e) => say('    ' + e));
}

say();
say('══ 12. lineVocab COVERAGE on comprehension (LIFE-EX-VOCAB-4)');
{
  let comp = 0, withVocab = 0, fill = 0, fillVocab = 0;
  for (const { t } of allTurns) {
    const p = promptOf(t.graded) as { kind?: string; lineVocab?: Record<string, string> } | null;
    if (!p) continue;
    const has = !!p.lineVocab && Object.keys(p.lineVocab).length > 0;
    if (p.kind === 'comprehension') { comp += 1; if (has) withVocab += 1; }
    if (p.kind === 'generation') { fill += 1; if (has) fillVocab += 1; }
  }
  say(`  comprehension ${comp} | with lineVocab ${withVocab} (${pct(withVocab, comp)})   ← was 75% before LIFE-EX-VOCAB-4`);
  say(`  fill-blank    ${fill} | with lineVocab ${fillVocab} (${pct(fillVocab, fill)})`);
}

say();
say('══ 13. PLAYER LINE ECHOED BY AN NPC (LIFE-SPEECH-6)');
{
  const key = (s: string) => s.trim().toLowerCase().replace(/[«»""''"']/g, '').replace(/\s+/g, ' ').trim().replace(/[.!?…,;:]+$/, '').trim();
  let echoes = 0; const ex: string[] = [];
  for (const { who, s } of allScenes) {
    const flat = (s.turns ?? []).flatMap((t) => (t.beats ?? []).map((b) => ({ b, t })));
    for (let i = 1; i < flat.length; i += 1) {
      const prev = flat[i - 1]!.b, cur = flat[i]!.b;
      if (prev.speaker !== 'user' || cur.speaker === 'user') continue;
      if (!prev.practice || !cur.practice) continue;
      if (key(prev.practice) === key(cur.practice)) {
        echoes += 1;
        if (ex.length < 5) ex.push(`${who} s${s.index}: "${cur.practice.slice(0, 60)}"`);
      }
    }
  }
  say(`  adjacent user→non-user beats with the SAME line: ${echoes}`);
  ex.forEach((e) => say('    ' + e));
}

say();
say('══ 14. EVENT BUDGET — beats per turn (LIFE-LANG-13.1 wants ~2 visible)');
{
  const hist = new Map<number, number>();
  let over3 = 0;
  for (const { t } of allTurns) {
    const n = (t.beats ?? []).length;
    hist.set(n, (hist.get(n) ?? 0) + 1);
    if (n > 3) over3 += 1;
  }
  say('  ' + [...hist].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}beat×${v}`).join('  '));
  say(`  turns with >3 beats: ${over3} (${pct(over3, allTurns.length)})`);
}

say();
say('══ 15. SCENE OPENERS — does turn 0 belong to the new scene? (LIFE-SCENE-33)');
{
  const words = (s: string) => s.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 3);
  const bigrams = (s: string) => { const w = words(s); const o: string[] = []; for (let i = 0; i < w.length - 1; i += 1) o.push(w[i] + ' ' + w[i + 1]); return o; };
  let n = 0, narrFirst = 0, carry = 0;
  const worst: { ov: number; line: string }[] = [];
  for (const r of runs) {
    const sc = (r.d?.run?.scenes ?? []) as Scene[];
    for (let i = 1; i < sc.length; i += 1) {
      const t0 = sc[i]!.turns?.[0]; if (!t0) continue;
      n += 1;
      if ((t0.beats ?? [])[0]?.speaker === 'narrator') narrFirst += 1;
      const open = (t0.beats ?? []).map((b) => b.native || b.practice).join(' ');
      const tail = (sc[i - 1]!.turns ?? []).slice(-2).flatMap((t) => (t.beats ?? []).map((b) => b.native || b.practice)).join(' ');
      const a = new Set(bigrams(open)), b = new Set(bigrams(tail));
      if (a.size === 0) continue;
      let inter = 0; for (const g of a) if (b.has(g)) inter += 1;
      const ov = inter / a.size;
      if (ov >= 0.15) carry += 1;
      worst.push({ ov, line: `${r.name} s${i} (${(ov * 100).toFixed(0)}%) ${sc[i - 1]!.where} → ${sc[i]!.where}` });
    }
  }
  worst.sort((x, y) => y.ov - x.ov);
  say(`  openers ${n} | lead with a narrator establish ${narrFirst} (${pct(narrFirst, n)}) | ≥15% bigram carry-over ${carry}`);
  say('  highest carry-over:');
  worst.slice(0, 5).forEach((w) => say('    ' + w.line));
}

say();
say('══ 16. LANGUAGE LEAK — a practice bubble that is actually in the system language');
{
  // Crude but objective: the practice text is >60% ASCII English stopwords.
  const EN = new Set(['the', 'and', 'you', 'that', 'this', 'with', 'have', 'for', 'not', 'are', 'was', 'but', 'his', 'her', 'they', 'from', 'what', 'when', 'your', 'been', 'were']);
  let n = 0; const ex: string[] = [];
  for (const { who, s, t } of allTurns) for (const b of t.beats ?? []) {
    const w = (b.practice ?? '').toLowerCase().split(/[^a-z']+/).filter((x) => x.length > 2);
    if (w.length < 6) continue;
    const hits = w.filter((x) => EN.has(x)).length;
    if (hits / w.length > 0.25) { n += 1; if (ex.length < 5) ex.push(`${who} s${s.index}t${t.turn}: "${b.practice.slice(0, 70)}"`); }
  }
  say(`  practice beats reading as English: ${n}`);
  ex.forEach((e) => say('    ' + e));
}

say();
say('══ 17. EMPTY TURNS (no beats AND no options — a dead turn on screen)');
{
  const dead = allTurns.filter(({ t }) => (t.beats ?? []).length === 0 && (t.options ?? []).length === 0);
  const noBeats = allTurns.filter(({ t }) => (t.beats ?? []).length === 0);
  say(`  turns with no beats: ${noBeats.length} (${pct(noBeats.length, allTurns.length)}) | fully dead: ${dead.length}`);
  noBeats.slice(0, 5).forEach(({ who, s, t }) => say(`    ${who} s${s.index}t${t.turn} — ${(t.options ?? []).length} options, graded=${t.graded?.kind ?? 'none'}`));
}

say();
say('══ 18. HARNESS-REPORTED FAILURES');
for (const r of runs) {
  const f = (r.d?.run?.failures ?? []) as unknown[];
  say(`  ${r.name.padEnd(7)} ${f.length} failures`);
  f.slice(0, 6).forEach((x) => say('    ' + JSON.stringify(x).slice(0, 180)));
}


say();
say('══ 19. npcUtterance ALSO emitted as a beat (prompt says NEVER)');
{
  const key = (s: string) => s.trim().toLowerCase().replace(/[«»""''"']/g, '').replace(/\s+/g, ' ').replace(/[.!?…,;:]+$/, '');
  let comps = 0, dup = 0; const ex: string[] = [];
  for (const { who, s } of allScenes) {
    const beats = new Set((s.turns ?? []).flatMap((t) => (t.beats ?? []).map((b) => key(b.practice ?? ''))));
    for (const t of s.turns ?? []) {
      const g = t.graded;
      const p = promptOf(g) as { kind?: string } | null;
      if (!p || p.kind !== 'comprehension' || !g?.line) continue;
      comps += 1;
      // the utterance lands ONCE at resolution; a second copy is the defect
      const n = (s.turns ?? []).flatMap((x) => x.beats ?? []).filter((b) => key(b.practice ?? '') === key(g.line!)).length;
      void beats;
      if (n > 1) { dup += 1; if (ex.length < 5) ex.push(`${who} s${s.index}: "${g.line.slice(0, 55)}" ×${n}`); }
    }
  }
  say(`  comprehension questions ${comps} | utterance appears more than once as a beat ${dup}`);
  ex.forEach((e) => say('    ' + e));
}

say();
say('══ 20. OPTION targetId pointing at nobody in the scene cast');
{
  let withTarget = 0, orphan = 0; const ex = new Set<string>();
  for (const { who, s, t } of allTurns) {
    const ids = new Set(((s.castAfter ?? []) as { id?: string }[]).map((c) => (c.id ?? '').trim()).filter(Boolean));
    if (ids.size === 0) continue;
    for (const o of t.options ?? []) {
      if (!o.targetId) continue;
      // Only PERSON targets are checkable here: an option may legitimately
      // target a place or a front, and the transcript carries only the cast —
      // not the place canon. Flagging `plac-…` was a false positive.
      if (/^(plac|obj|front|sorrow)-/.test(o.targetId)) continue;
      withTarget += 1;
      if (!ids.has(o.targetId)) { orphan += 1; if (ex.size < 6) ex.add(`${who} s${s.index}t${t.turn}: targetId "${o.targetId}" ∉ [${[...ids].join(', ')}]`); }
    }
  }
  say(`  options with a targetId ${withTarget} | target not in cast ${orphan} (${pct(orphan, withTarget)})`);
  [...ex].forEach((e) => say('    ' + e));
}

say();
say('══ 21. NPC CHURN — how many speak once and are never heard again');
{
  for (const r of runs) {
    const count = new Map<string, number>();
    for (const s of (r.d?.run?.scenes ?? []) as Scene[]) for (const t of s.turns ?? []) for (const b of t.beats ?? []) {
      if (b.speaker === 'npc' && b.name) count.set(b.name, (count.get(b.name) ?? 0) + 1);
    }
    const once = [...count].filter(([, n]) => n === 1);
    say(`  ${r.name.padEnd(7)} distinct speakers ${count.size} | spoke exactly once ${once.length}${once.length ? ' — ' + once.map(([k]) => k).join(', ') : ''}`);
  }
}

say();
say('══ 22. SCENE LENGTH vs the resolve ceiling');
{
  for (const r of runs) {
    const sc = (r.d?.run?.scenes ?? []) as Scene[];
    say(`  ${r.name.padEnd(7)} ${sc.map((s) => (s.turns ?? []).length).join(', ')}  (ceiling cuts show as the max)`);
  }
}

say();
say('══ 23. QUESTION CADENCE — gaps between graded turns');
{
  for (const r of runs) {
    const flags: number[] = [];
    let i = 0;
    for (const s of (r.d?.run?.scenes ?? []) as Scene[]) for (const t of s.turns ?? []) { i += 1; if (t.graded) flags.push(i); }
    const gaps = flags.slice(1).map((v, k) => v - flags[k]!);
    const inBand = gaps.filter((g) => g >= 2 && g <= 3).length;
    say(`  ${r.name.padEnd(7)} ${flags.length} questions / ${i} turns | gaps ${gaps.join(',')} | in 2-3 band ${pct(inBand, gaps.length)}`);
  }
}

// eslint-disable-next-line no-console -- this IS a CLI; stdout is its output.
console.log(out.join('\n'));
