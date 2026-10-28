/**
 * Every NAME a playthrough produced, in one flat list.
 *
 * `scoreLexiconNames` measures LIFE-STORY-LEXICON-1 on the surface the rule was
 * actually written for — *"titles, chapter names, place names, faction names,
 * character epithets"* — so it needs those, and only those. Prose is a separate
 * question, and a much harder one (see `scoreCliche`).
 *
 * Lives here rather than in `rubric.ts` so the rubric keeps taking plain
 * strings and never imports the capture types: the same separation that lets
 * `rescore.ts` re-run the whole measured layer without touching the transport.
 */
import type { WorldRun } from './playWorld';

export function lexiconNames(run: WorldRun): string[] {
  const out: string[] = [run.title, run.chapterPremise];
  for (const s of run.scenes) {
    out.push(s.title, s.where, s.backdropLabel, s.subject);
    // The cast + fronts AFTER the last scene: both grow during play, and a
    // faction invented in scene 6 is exactly where the portentous naming turns
    // up once the opening has been reviewed.
    for (const c of s.castAfter) out.push(c.name, c.known);
    for (const f of s.frontsAfter) out.push(f.name ?? '', f.id ?? '');
  }
  for (const b of run.npcBios) out.push(b.name, b.role);
  return out.map((n) => (n ?? '').trim()).filter(Boolean);
}
