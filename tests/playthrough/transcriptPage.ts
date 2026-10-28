/**
 * A playthrough, rendered as the page a person can actually read.
 *
 *   npx tsx tests/playthrough/transcriptPage.ts <run.json> [out.html]
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE JUDGE ───────────────────────────────
 *
 * `judge.ts` renders a transcript too, but for a MODEL — flat text, no assets,
 * trimmed to fit a context window. This one is for a person deciding whether
 * the thing is any good, which needs the opposite: the backdrop SVGs inlined
 * (they are what the player looks at, and a described image cannot be judged),
 * the option grid shown as a grid with its types visible, and the graded
 * questions shown where they interrupted rather than summarised at the end.
 *
 * Scores are printed WORST FIRST. A report sorted by dimension name buries the
 * finding under the alphabet.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STYLE } from './transcriptStyle';
import { collapse } from './rubric';
import type { CapturedScene, CapturedTurn, WorldRun, WorldSpec } from './playWorld';
import type { Score } from './rubric';

type RunFile = {
  spec: WorldSpec;
  run: WorldRun;
  scores: Score[];
  composite: { mean: number; gateFailures: Score[] };
};

const TYPE_COLOUR: Record<string, string> = {
  ask: 'var(--t-ask)', do: 'var(--t-do)', move: 'var(--t-move)',
  observe: 'var(--t-observe)', offer: 'var(--t-offer)', leave: 'var(--t-leave)',
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;');
}

/** A 0-4 as a proportion of the bar, coloured by how bad it is. */
function scoreBar(score: number): string {
  const pct = Math.max(0, Math.min(100, (score / 4) * 100));
  const hue = score >= 3 ? 'var(--ok)' : score >= 2 ? 'var(--t-move)' : 'var(--flag)';
  return `<span class="bar" style="--sc:${hue}"><i style="width:${pct.toFixed(0)}%"></i></span>`;
}

function scoreRows(scores: readonly Score[], gates: readonly Score[]): string {
  const gateIds = new Set(gates.map((g) => g.dimension));
  // Collapsed first: OPT-LEAK is scored by BOTH a substring check and the judge,
  // and printing the pair adjacent tells the reader nothing about which one the
  // composite used.
  return collapse(scores)
    .sort((a, b) => a.score - b.score)
    .map((s) => {
      const gate = gateIds.has(s.dimension);
      const why = esc(s.evidence || s.note).slice(0, 160);
      return `<div class="row">
        <span class="dim${gate ? ' gate' : ''}">${esc(s.dimension)}${gate ? ' ⚠' : ''}</span>
        ${scoreBar(s.score)}
        <span class="val">${s.score.toFixed(s.score % 1 ? 2 : 0)}</span>
        <span class="why">${why}</span>
      </div>`;
    })
    .join('\n');
}

function beatHtml(b: CapturedTurn['beats'][number]): string {
  if (b.speaker === 'narrator') {
    return `<div class="beat"><div class="narr">${esc(b.native)}</div></div>`;
  }
  const who = b.name ?? (b.speaker === 'user' ? 'You' : 'Someone');
  return `<div class="beat">
    <div class="who">${esc(who)}</div>
    <div class="practice">${esc(b.practice)}</div>
    <div class="gloss">${esc(b.native)}</div>
  </div>`;
}

function optionsHtml(t: CapturedTurn): string {
  if (t.options.length === 0) return '';
  const chips = t.options.map((o) => {
    const taken = t.chose !== null && o.label === t.chose;
    const colour = TYPE_COLOUR[o.type] ?? 'var(--ink-faint)';
    // `say` is worth showing on the chip: it is the flag that makes an option
    // eligible for LIFE-SPEECH-3's client-side fill-blank interception, so a
    // grid with no `say` in it cannot produce an outbound question at all.
    const say = o.speechAct === 'say' ? '<span class="say">say</span>' : '';
    return `<span class="opt${taken ? ' taken' : ''}">
      <span class="tag" style="--tc:${colour}">${esc(o.type || '—')}</span>
      ${esc(o.label)}${say}${taken ? '<span class="taken-mark">← taken</span>' : ''}
    </span>`;
  }).join('');
  return `<div class="opts">${chips}</div>`;
}

function questionHtml(g: NonNullable<CapturedTurn['graded']>): string {
  // LIFE-BENCH-6: the chip's VERDICT is what makes the transcript answerable —
  // "was the right answer distinguishable from the distractors" cannot be read
  // off four unmarked words. `whyWrong` rides as a tooltip rather than inline
  // so the chip row still scans as a chip row.
  const chips = g.choices
    .map((c) => {
      const cls = c.correctness ? ` ${c.correctness}` : '';
      const why = c.whyWrong ? ` title="${esc(c.whyWrong)}"` : '';
      return `<span class="chip${cls}"${why}>${esc(c.text) || '<i>(empty)</i>'}</span>`;
    })
    .join('');
  // LIFE-EX-8.2 — the native anchor the player reads above a fill-blank. The
  // single field the old 400-char truncation was most likely to swallow.
  const anchor = anchorOf(g.prompt);
  return `<div class="q">
    <div class="q-head">${esc(g.kind)} · ${esc(g.direction)} · authored by ${esc(g.origin)}</div>
    <div class="q-line">${esc(g.line)}</div>
    ${anchor ? `<div class="q-anchor">${esc(anchor)}</div>` : ''}
    ${g.target ? `<div class="q-target">tests: <b>${esc(g.target)}</b></div>` : ''}
    ${chips ? `<div class="chips">${chips}</div>` : ''}
  </div>`;
}

/** The native line shown with the question: the completed sentence on a
 *  fill-blank, the NPC's gloss on a comprehension. */
function anchorOf(p: NonNullable<CapturedTurn['graded']>['prompt']): string {
  const rec = p as unknown as Record<string, unknown>;
  const anchor = rec.completedNativeText ?? rec.utteranceNativeText;
  return typeof anchor === 'string' ? anchor.trim() : '';
}

function turnHtml(t: CapturedTurn, n: number): string {
  return `<div class="turn">
    <div class="turn-n">${n}</div>
    <div>
      ${t.beats.map(beatHtml).join('')}
      ${t.graded ? questionHtml(t.graded) : ''}
      ${optionsHtml(t)}
    </div>
  </div>`;
}

function sceneHtml(s: CapturedScene): string {
  // The real asset, inlined. A backdrop cannot be judged from its label.
  const backdrop = s.backdropSvg
    ? `<div class="backdrop">${s.backdropSvg}</div>`
    : `<div class="backdrop"><div class="backdrop-missing">no backdrop generated</div></div>`;
  const qs = s.turns.filter((t) => t.graded).length;
  return `<section class="scene">
    <div class="scene-head">
      <div class="scene-n">Scene ${s.index + 1}${s.where ? ` · ${esc(s.where)}` : ''} · ${s.turns.length} turns · ${qs} question${qs === 1 ? '' : 's'}</div>
      <h2>${esc(s.title)}</h2>
      ${s.subject ? `<p class="subject">${esc(s.subject)}</p>` : ''}
    </div>
    ${backdrop}
    ${s.turns.map((t, i) => turnHtml(t, i + 1)).join('')}
    ${s.historyLine
      ? `<div class="close"><div class="lbl">what the world recorded</div><p>${esc(s.historyLine)}</p></div>`
      : '<div class="close"><div class="lbl">scene close failed</div></div>'}
  </section>`;
}

export function renderPage(file: RunFile): string {
  const { spec, run, scores, composite } = file;
  const turns = run.scenes.flatMap((s) => s.turns);
  const questions = turns.filter((t) => t.graded);
  const out = questions.filter((t) => t.graded?.direction === 'outbound').length;

  const cast = run.npcBios.length
    ? run.npcBios.map((b) => `<div class="person">
        <h3>${esc(b.name)}</h3>
        <div class="role">${esc(b.role)}</div>
        <p>${esc(b.profile)}</p>
      </div>`).join('')
    : '<p class="note">No avatar bios were generated for this run.</p>';

  return `<title>${esc(run.title)} — playthrough transcript</title>
<style>${STYLE}</style>
<div class="wrap">
  <div class="eyebrow">${esc(spec.label)}</div>
  <h1>${esc(run.title)}</h1>
  <p class="situation">${esc(run.situation)}</p>
  <div class="meta">
    <span><b>${esc(spec.practiceLanguage)}</b> at difficulty ${spec.difficulty}</span>
    <span><b>${run.scenes.length}</b> scenes</span>
    <span><b>${turns.length}</b> turns</span>
    <span><b>${questions.length}</b> questions <span style="color:var(--ink-faint)">(${out} out / ${questions.length - out} in)</span></span>
    <span>composite <b>${composite.mean.toFixed(2)}</b> / 4</span>
  </div>

  <div class="panel">
    <h2>Scores — worst first</h2>
    <div class="scores">${scoreRows(scores, composite.gateFailures)}</div>
    ${composite.gateFailures.length
      ? `<p class="note" style="margin-top:1rem">⚠ marks a <b>gate</b>: reported apart from the mean, because averaging a leak against good prose hides it.</p>`
      : ''}
  </div>

  ${run.chapterPremise ? `<div class="panel"><h2>Chapter premise</h2><p class="note">${esc(run.chapterPremise)}</p></div>` : ''}

  <div class="panel">
    <h2>Avatar bios the player can open</h2>
    <div class="cast">${cast}</div>
  </div>

  ${run.failures.length
    ? `<div class="panel"><h2>Generator failures (${run.failures.length})</h2>
        ${run.failures.map((f) => `<div class="fail">${esc(f)}</div>`).join('')}</div>`
    : ''}

  ${run.scenes.map(sceneHtml).join('')}
</div>`;
}

/* CLI — `npx tsx transcriptPage.ts <run.json> [out.html]` */
const [, , input, output] = process.argv;
if (input) {
  const src = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8')) as RunFile;
  const dest = path.resolve(output ?? input.replace(/\.json$/, '.html'));
  fs.writeFileSync(dest, renderPage(src));
  // eslint-disable-next-line no-console
  console.log(dest);
}
