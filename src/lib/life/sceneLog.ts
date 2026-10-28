/**
 * LIFE-ARCH-2.2 — the scene, read back for `sceneClose`, WITH ITS WHOS AND ALL
 * OF ITSELF.
 *
 * MEASURED 2026-08-04. A four-world benchmark tripped the COHERENCE gate on a
 * world whose very first history line said *"you failed to secure the paper
 * from Elder Kaito, who redirected you to investigate the southern fields"* —
 * when the transcript had Elder Kaito sending the player NORTH to find Miki,
 * and a different character, Hina, doing the redirecting later. The line was
 * wrong about who and wrong about where, and it is written into the world's
 * permanent memory, so every later prompt read it as fact.
 *
 * TWO CAUSES, ONE CALL SITE, AND NEITHER IS THE MODEL'S FAULT.
 *
 * 1. THE LOG HAD NO SPEAKERS. It was built as `payload.nativeText` per event —
 *    a flat list of unattributed sentences. `sceneClose`'s own instructions ask
 *    it to record "who decided something, who refused, who turned out not to be
 *    what they seemed"; it was being asked to name people from lines with no
 *    names on them. Attribution was not lost in summarisation, it was never
 *    supplied.
 *
 * 2. THE WINDOW WAS THE LAST TWELVE EVENTS. A turn emits one or two beats plus
 *    a decision, so twelve events is roughly the last four turns — and scenes
 *    run six to twelve. The summary of a whole scene was written from its final
 *    third, which is exactly the shape of error observed: the ending recalled
 *    correctly, the opening invented. The window is now the SCENE, found by its
 *    `scene_started` marker.
 *
 * The bound moves to a line CAP rather than an event count, so the guard is
 * against an unbounded prompt (the reason a limit existed) instead of against
 * long scenes (which are normal). It keeps the TAIL when it bites, because a
 * scene that overran its ceiling is one whose recent half matters most — but
 * at the ordinary 6-12 turns nothing is dropped at all.
 */
import type { LifeEvent } from '@/types/firestore';

/** Lines of scene log handed to `sceneClose`. Generous: a 12-turn scene at two
 *  beats plus a decision per turn lands near 36, so the cap is a runaway guard
 *  rather than a budget the ordinary scene spends. */
export const SCENE_LOG_CAP = 60;

/**
 * Build the attributed, scene-scoped log `sceneClose` summarises from.
 *
 * SYSTEM-LANGUAGE ROW, deliberately: the close call reasons in English and
 * writes bookkeeping, so handing it the practice-language row would make it
 * translate before it can judge. Decisions carry `text`; beats carry both rows.
 */
export function buildSceneLog(events: ReadonlyArray<LifeEvent>): string[] {
  // Everything since this scene began. A world whose log has been compacted
  // past its own `scene_started` falls back to the whole window rather than to
  // nothing — a short log is recoverable, an empty one silently produces a
  // history line about a scene the model never saw.
  let start = 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]!.kind === 'scene_started') { start = i + 1; break; }
  }

  const lines: string[] = [];
  for (const e of events.slice(start)) {
    if (e.kind !== 'beat' && e.kind !== 'decision') continue;
    const pl = (e.payload ?? {}) as Record<string, unknown>;
    const raw = pl.nativeText ?? pl.text ?? pl.practiceText;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    lines.push(`${speakerLabel(e.kind, pl)}: ${raw.trim()}`);
  }
  return lines.slice(-SCENE_LOG_CAP);
}

/** Who said or did it. A decision is always the player — that is what a
 *  decision IS — and an unnamed beat is the narrator, which is the same
 *  reading the renderer applies. */
function speakerLabel(kind: 'beat' | 'decision', pl: Record<string, unknown>): string {
  if (kind === 'decision') return 'You';
  const name = typeof pl.speakerName === 'string' ? pl.speakerName.trim() : '';
  if (name) return name;
  return pl.speaker === 'user' ? 'You' : 'Narration';
}
