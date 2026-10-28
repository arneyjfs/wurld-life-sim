/**
 * LIFE-WORLD-ARC-1 / LIFE-DATA-*: completed chapter arcs as a
 * Firestore SUBcollection.
 *
 * `completedArcs` used to be an unbounded array on the lifeWorld doc —
 * the #1 doc-growth driver against Firestore's 1 MiB ceiling AND a
 * write-amplification cost (every chapter archive rewrote the whole
 * array). Archived chapters now live one-doc-per-chapter at
 *
 *   users/{uid}/lifeWorlds/{worldId}/completedArcs/{arcId}
 *
 * (arcId = `chapter-${chapterNumber}`), matching the backdrops/ + npcs/ +
 * scenes/ subcollection pattern. The world doc keeps only a cheap
 * `completedArcCount` scalar so the overview WorldCard badge doesn't
 * need a per-card subcollection read.
 *
 * CLEAN BREAK: no migration / dual-read / backfill. Worlds created
 * before this change don't carry the new shape and don't need to.
 *
 * Spec: docs/specs/life-sim.md §10.7 (LIFE-WORLD-ARC-*), §1 (LIFE-DATA-*).
 */
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { ZWorldArc, type WorldArc } from '@/types/firestore';

function completedArcsCollection(uid: string, worldId: string) {
  return collection(db, 'users', uid, 'lifeWorlds', worldId, 'completedArcs');
}

/** Stable per-chapter doc id — one arc per chapter, so re-archiving the
 *  same chapter (an idempotent retry) overwrites rather than
 *  duplicates. */
function arcDocId(chapterNumber: number): string {
  return `chapter-${chapterNumber}`;
}

/** Strip undefined values — Firestore rejects them. Matches the
 *  helper pattern in world.ts / npcs.ts. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

/** LIFE-WORLD-ARC-1: persist one resolved chapter arc to the
 *  subcollection. Caller (archiveActiveArc) also bumps the world's
 *  `completedArcCount` scalar in the same flow. */
export async function appendCompletedArc(
  uid: string,
  worldId: string,
  arc: WorldArc,
): Promise<void> {
  const ref = doc(completedArcsCollection(uid, worldId), arcDocId(arc.chapterNumber));
  await setDoc(ref, stripUndefined(arc as unknown as Record<string, unknown>));
}

/** LIFE-WORLD-ARC-1: read all archived arcs for a world, parsed via
 *  ZWorldArc and ordered by chapterNumber ascending (oldest → newest).
 *  Malformed docs are dropped rather than throwing so one bad row
 *  can't stall chapter generation. Sort is in-memory (the arc count is
 *  tiny — one per chapter), avoiding a Firestore index requirement. */
export async function readCompletedArcs(
  uid: string,
  worldId: string,
): Promise<WorldArc[]> {
  const snap = await getDocs(completedArcsCollection(uid, worldId));
  const arcs: WorldArc[] = [];
  for (const d of snap.docs) {
    const parsed = ZWorldArc.safeParse(d.data());
    if (parsed.success) arcs.push(parsed.data);
  }
  arcs.sort((a, b) => a.chapterNumber - b.chapterNumber);
  return arcs;
}

/**
 * LIFE-WORLD-ARC-7 — how many completed chapters the chapter-open prompt may
 * carry, and how many of the EARLIEST are kept when there are more.
 *
 * ## The bug this closes
 *
 * `readCompletedArcs` above returns the whole subcollection, and its own
 * comment rests on "the arc count is tiny — one per chapter". That holds right
 * up until somebody plays a world for a long time, and then it stops holding
 * quietly. `buildWorldArcPrompt` renders every arc it is given, at roughly
 * 2.7 kB each on a rich world, against about 40 kB of headroom once the system
 * instruction and the world block are paid for — so the call crosses
 * `MAX_PROMPT_BYTES` at around FIFTEEN chapters and the endpoint refuses it.
 *
 * ⚠ It then fails **silently**: `runWorldArcGenerate` catches and falls back to
 * `trivialArc`, which is the right behaviour for a transient fault and exactly
 * the wrong signal for a permanent one. A long-played world simply stops
 * getting authored chapters, and the worlds that break first are the ones
 * someone cared enough about to keep playing.
 *
 * Measured while migrating this prompt server-side (SRV-PROMPT-8..13 batch 3),
 * which is the only reason it surfaced: the built path sums the two halves
 * against the cap and rejected outright, where the legacy path caps them
 * separately and merely postpones the same cliff by a few chapters.
 *
 * ## Why head-and-tail, and why these numbers
 *
 * Same scheme as `capStoryLog` and `capCanon`, for the same reason those
 * chose it: chapter one is where the premise, the cast and the world's terms
 * were established, so a plain `.slice(-cap)` drops precisely the chapters the
 * through-line rests on and keeps the churn. `capStoryLog`'s comment records
 * making that mistake.
 *
 * ## Five, not eight — and why this is a MARGIN and not a ceiling
 *
 * ⚠ **This prompt's inputs are bounded in COUNT but not in LENGTH**, which is
 * the difference between it and `life_resume_recap`. That one was safe to
 * migrate because every input has a bound in code. Here `MAX_PRINCIPALS`,
 * `REGULARS_RENDER_CEILING`, `MAX_BIO_SCENE_MEMORIES`, `renderArc`'s six-memory
 * slice and this cap all hold the COUNTS — but `known`, `wants`, `nextMove`,
 * `routine`, `agenda`, `situation`, every `law`, every `premise` and every scene
 * `summary` is model-authored prose with no length bound anywhere. So NO value
 * here makes the payload a ceiling. It only buys headroom.
 *
 * Measured on a synthetic maximal world (`.playthroughs/` is gitignored and
 * absent, so the counts come from the code's own maxima and the prose lengths
 * are estimates anchored on the prompt's own asks):
 *
 *   uncapped, 20 chapters   148.8% of cap — rejected outright
 *   cap 8                    88.7%        — a near miss, ~2 chapters of drift
 *   cap 6                    78.7%
 *   cap 5                    73.7%        — the first that clears 75%
 *
 * Five is head 2 + tail 3, so the head-and-tail intent survives: the chapters
 * that founded the world, plus where it actually is now.
 *
 * ⚠ If this ever bites anyway, the real fix is not a smaller number — it is a
 * BYTE budget on the rendered arc block (render newest-first until the budget
 * is spent), which degrades smoothly on a pathological world instead of
 * stepping off a cliff. That is a behaviour change worth making deliberately,
 * not a tuning knob.
 */
export const COMPLETED_ARCS_CAP = 5;
export const COMPLETED_ARCS_HEAD = 2;

/**
 * Bound a world's arc history for the prompt, keeping the founding chapters and
 * the most recent, dropping the superseded middle.
 *
 * ⚠ Applied at the CALL SITE, not inside `readCompletedArcs`. The read is a
 * plain accessor and something else may one day want the full history (a
 * "chapters so far" view is already anticipated below); capping there would
 * silently truncate it. This is a fact about what a PROMPT can carry.
 */
export function capCompletedArcs(arcs: ReadonlyArray<WorldArc>): WorldArc[] {
  if (arcs.length <= COMPLETED_ARCS_CAP) return [...arcs];
  return [
    ...arcs.slice(0, COMPLETED_ARCS_HEAD),
    ...arcs.slice(arcs.length - (COMPLETED_ARCS_CAP - COMPLETED_ARCS_HEAD)),
  ];
}

/** Collection ref for any future snapshot-listener consumers (e.g. a
 *  "chapters so far" view). */
export { completedArcsCollection };
