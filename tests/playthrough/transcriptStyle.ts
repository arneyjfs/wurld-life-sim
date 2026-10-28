/**
 * The transcript page's design tokens, as one stylesheet.
 *
 * Split from `transcriptPage.ts` only to keep both files under the 600-LOC cap.
 *
 * ── WHY IT LOOKS LIKE THIS ──────────────────────────────────────────────────
 *
 * The page is a diagnostic instrument that happens to contain fiction, and both
 * halves have to be readable at once: the prose as prose, the machine data as
 * data. So the type is split by role rather than by heading level — a serif for
 * anything the player read, a grotesque for the chrome, a monospace for
 * anything countable.
 *
 * COLOUR ENCODES THE OPTION TYPE, because that is real information rather than
 * decoration: OPT-SPREAD is scored on whether a grid's `actionType`s differ, so
 * a reader needs to see a same-type grid at a glance instead of comparing six
 * words. The palette is otherwise deliberately quiet — one accent for the
 * practice language (the thing the app exists for) and one for a graded moment.
 *
 * The neutrals carry a slight cool bias so they read as chosen rather than
 * inherited, and every colour is a token redefined under both the media query
 * and the viewer's explicit `data-theme`, so the toggle wins in both
 * directions.
 */
export const STYLE = `
:root {
  --paper: #FAF9F7;
  --panel: #FFFFFF;
  --ink: #191C22;
  --ink-soft: #5C6270;
  --ink-faint: #8A8F9A;
  --rule: #E4E2DC;
  --practice: #1F5673;
  --flag: #A8451E;
  --flag-bg: #FBF0EA;
  --ok: #3F7A5C;
  --t-ask: #4A6FA5;  --t-do: #3F7A5C;    --t-move: #A8763E;
  --t-observe: #7A5C8E; --t-offer: #9E5A6B; --t-leave: #6B7280;
  --serif: ui-serif, Georgia, "Iowan Old Style", "Palatino Linotype", serif;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #14161A; --panel: #1B1E24; --ink: #E8E6E1; --ink-soft: #9AA0AC;
    --ink-faint: #6E7480; --rule: #2A2E36; --practice: #86BBD8; --flag: #E39468;
    --flag-bg: #251C18; --ok: #6FB08C;
    --t-ask: #7FA3D4; --t-do: #6FB08C; --t-move: #D3A566;
    --t-observe: #AE8FC0; --t-offer: #C88E9C; --t-leave: #9AA0AC;
  }
}
:root[data-theme="dark"] {
  --paper: #14161A; --panel: #1B1E24; --ink: #E8E6E1; --ink-soft: #9AA0AC;
  --ink-faint: #6E7480; --rule: #2A2E36; --practice: #86BBD8; --flag: #E39468;
  --flag-bg: #251C18; --ok: #6FB08C;
  --t-ask: #7FA3D4; --t-do: #6FB08C; --t-move: #D3A566;
  --t-observe: #AE8FC0; --t-offer: #C88E9C; --t-leave: #9AA0AC;
}
:root[data-theme="light"] {
  --paper: #FAF9F7; --panel: #FFFFFF; --ink: #191C22; --ink-soft: #5C6270;
  --ink-faint: #8A8F9A; --rule: #E4E2DC; --practice: #1F5673; --flag: #A8451E;
  --flag-bg: #FBF0EA; --ok: #3F7A5C;
  --t-ask: #4A6FA5; --t-do: #3F7A5C; --t-move: #A8763E;
  --t-observe: #7A5C8E; --t-offer: #9E5A6B; --t-leave: #6B7280;
}

body { background: var(--paper); color: var(--ink); font-family: var(--sans);
  line-height: 1.55; -webkit-text-size-adjust: 100%; }
.wrap { max-width: 54rem; margin: 0 auto; padding: 3rem 1.25rem 6rem; }
h1, h2, h3 { text-wrap: balance; line-height: 1.2; margin: 0; }

/* ── masthead ─────────────────────────────────────────────────────────── */
.eyebrow { font-family: var(--mono); font-size: .72rem; letter-spacing: .14em;
  text-transform: uppercase; color: var(--ink-faint); }
h1 { font-family: var(--serif); font-size: clamp(2rem, 5vw, 2.9rem); font-weight: 600;
  margin: .5rem 0 .35rem; }
.situation { font-family: var(--serif); font-size: 1.13rem; color: var(--ink-soft);
  max-width: 60ch; }
.meta { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; margin-top: 1.25rem;
  font-size: .82rem; color: var(--ink-soft); font-family: var(--mono); }
.meta b { color: var(--ink); font-weight: 600; }

/* ── panels ───────────────────────────────────────────────────────────── */
.panel { background: var(--panel); border: 1px solid var(--rule); border-radius: 10px;
  padding: 1.4rem 1.5rem; margin: 2rem 0; }
.panel > h2 { font-size: .78rem; font-family: var(--mono); letter-spacing: .13em;
  text-transform: uppercase; color: var(--ink-faint); margin-bottom: 1rem; }

/* ── scores ───────────────────────────────────────────────────────────── */
.scores { display: grid; gap: .45rem; }
.row { display: grid; grid-template-columns: 9.5rem 5rem 2.4rem 1fr; gap: .75rem;
  align-items: baseline; font-size: .84rem; }
.row .dim { font-family: var(--mono); font-size: .78rem; }
.row .val { font-family: var(--mono); font-variant-numeric: tabular-nums;
  text-align: right; font-weight: 600; }
.bar { height: 5px; border-radius: 3px; background: var(--rule); overflow: hidden;
  align-self: center; }
.bar i { display: block; height: 100%; background: var(--sc); }
.row .why { color: var(--ink-soft); font-size: .8rem; }
.gate { color: var(--flag); font-weight: 600; }

/* ── scene ────────────────────────────────────────────────────────────── */
.scene { margin: 3.5rem 0 0; }
.scene-head { border-top: 2px solid var(--ink); padding-top: 1rem; }
.scene-n { font-family: var(--mono); font-size: .72rem; letter-spacing: .13em;
  text-transform: uppercase; color: var(--ink-faint); }
.scene h2 { font-family: var(--serif); font-size: 1.65rem; font-weight: 600;
  margin: .3rem 0 .4rem; }
.subject { font-size: .88rem; color: var(--ink-soft); max-width: 62ch; }
.backdrop { margin: 1.25rem 0; border: 1px solid var(--rule); border-radius: 8px;
  overflow: hidden; aspect-ratio: 16 / 7; background: var(--panel); }
.backdrop svg { width: 100%; height: 100%; display: block; }
.backdrop-missing { display: grid; place-items: center; height: 100%;
  font-family: var(--mono); font-size: .78rem; color: var(--ink-faint); }

/* ── turns ────────────────────────────────────────────────────────────── */
.turn { display: grid; grid-template-columns: 2.75rem 1fr; gap: 0 .75rem;
  padding: 1.4rem 0; border-bottom: 1px solid var(--rule); }
.turn-n { font-family: var(--mono); font-size: .72rem; color: var(--ink-faint);
  font-variant-numeric: tabular-nums; padding-top: .3rem; }
.beat { margin-bottom: .9rem; }
.who { font-family: var(--sans); font-size: .7rem; letter-spacing: .1em;
  text-transform: uppercase; color: var(--ink-faint); margin-bottom: .2rem; }
.practice { font-family: var(--serif); font-size: 1.08rem; color: var(--practice); }
.gloss { font-family: var(--serif); font-size: .97rem; color: var(--ink-soft);
  margin-top: .1rem; }
.narr { font-family: var(--serif); font-size: 1.05rem; max-width: 64ch; }

/* ── options ──────────────────────────────────────────────────────────── */
.opts { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .9rem; }
.opt { display: inline-flex; align-items: baseline; gap: .45rem; font-size: .84rem;
  border: 1px solid var(--rule); border-radius: 999px; padding: .3rem .7rem .32rem;
  color: var(--ink-soft); }
.opt.taken { border-color: var(--ink); color: var(--ink); font-weight: 500; }
.opt .tag { font-family: var(--mono); font-size: .66rem; letter-spacing: .06em;
  text-transform: uppercase; color: var(--tc, var(--ink-faint)); }
.opt .say { font-family: var(--mono); font-size: .66rem; color: var(--practice); }
.taken-mark { color: var(--ink-faint); font-family: var(--mono); font-size: .7rem; }

/* ── graded question ──────────────────────────────────────────────────── */
.q { margin-top: 1rem; background: var(--flag-bg); border-left: 3px solid var(--flag);
  border-radius: 0 6px 6px 0; padding: .85rem 1rem; }
.q-head { font-family: var(--mono); font-size: .68rem; letter-spacing: .1em;
  text-transform: uppercase; color: var(--flag); margin-bottom: .45rem; }
.q-line { font-family: var(--serif); font-size: 1rem; color: var(--ink); }
.q-target { font-family: var(--mono); font-size: .78rem; color: var(--ink-soft);
  margin-top: .3rem; }
.chips { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .55rem; }
.chip { font-size: .8rem; border: 1px solid var(--rule); background: var(--panel);
  border-radius: 6px; padding: .2rem .55rem; }
/* LIFE-BENCH-6: the verdict, so a reader can see at a glance whether the
   correct chip was distinguishable from its distractors — the question the
   LIFE-EX-8.2 analysis had to leave the transcript to answer. */
.chip.correct { border-color: var(--ok); color: var(--ok); font-weight: 600; }
.chip.wrong[title] { border-style: dashed; cursor: help; }
.q-anchor { font-family: var(--serif); font-size: .85rem; color: var(--ink-soft);
  margin-top: .3rem; font-style: italic; }

/* ── close ────────────────────────────────────────────────────────────── */
.close { margin-top: 1.25rem; padding: .8rem 1rem; border-left: 3px solid var(--ok);
  background: var(--panel); border-radius: 0 6px 6px 0; }
.close .lbl { font-family: var(--mono); font-size: .68rem; letter-spacing: .1em;
  text-transform: uppercase; color: var(--ink-faint); }
.close p { font-family: var(--serif); margin: .25rem 0 0; }

/* ── cast ─────────────────────────────────────────────────────────────── */
.cast { display: grid; gap: 1rem; }
.person { border-bottom: 1px solid var(--rule); padding-bottom: 1rem; }
.person:last-child { border-bottom: 0; padding-bottom: 0; }
.person h3 { font-family: var(--serif); font-size: 1.05rem; font-weight: 600; }
.person .role { font-size: .82rem; color: var(--ink-soft); margin: .15rem 0 .4rem; }
.person p { font-family: var(--serif); font-size: .95rem; color: var(--ink-soft);
  margin: 0; max-width: 64ch; }

.fail { font-family: var(--mono); font-size: .78rem; color: var(--flag); }
.note { font-size: .84rem; color: var(--ink-soft); max-width: 64ch; }

@media (max-width: 640px) {
  .row { grid-template-columns: 1fr 4rem 2.2rem; }
  .row .why { grid-column: 1 / -1; }
  .turn { grid-template-columns: 1fr; }
  .turn-n { padding-top: 0; margin-bottom: .35rem; }
}
`;
