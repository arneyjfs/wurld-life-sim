import { useEffect, useRef } from 'react';
import * as log from '@/lib/log';
import { runWorldArcGenerate } from '@/lib/life/runWorldArcGenerate';
import { updateLifeWorld } from '@/lib/life/world';
import type { LifeWorld } from '@/types/firestore';

/**
 * LIFE-WORLD-ARC-9 — a world with no `currentArc` regenerates one on open.
 *
 * `archiveActiveArc` sets `currentArc: null` on chapter close by design
 * (LIFE-WORLD-ARC-1/6). Until 2026-07-31 the ONLY thing that ever refilled it
 * was the *Continue your wurld* CTA on `WorldArcCompleteScreen` — so choosing
 * *Pause for now*, or one failed call, stranded the world in a state that is
 * still playable and cannot recover:
 *
 *   - `sceneGenerate` renders an EMPTY `<worldArc>`, so new scenes serve
 *     no through-line;
 *   - the idle `<scene>` block has no chapter to offer a hook into
 *     (LIFE-WORLD-ARC-4);
 *   - `archiveActiveArc` early-returns on `!active`, so the chapter can NEVER
 *     complete again — the completion screen is unreachable for that world.
 *
 * Measured on a real world (`w-1785453145426-8w0ffo`, 2026-07-31):
 * `completedArcCount: 1`, `currentArc: null`, `storyLog.turns: 37`, and ONE
 * `scene_hook_offered` across 110 events. The only chapter that ever ended
 * did so because the player typed "and the chapter" into free-text.
 *
 * Non-blocking and failure-tolerant, mirroring LIFE-WORLD-ARC-3's chapter-1
 * behaviour: play continues while the arc lands, and a failure leaves the world
 * exactly as it was rather than blocking entry.
 */
export function useArcSelfHeal(opts: {
  uid: string | null;
  world: LifeWorld | null;
}): void {
  const { uid, world } = opts;
  const worldId = world?.id ?? null;
  const hasArc = !!world?.currentArc;
  const completedArcCount = world?.completedArcCount ?? 0;
  // The write round-trips through a Firestore listener, so the precondition
  // stays TRUE for several renders after the call is made. Without this latch
  // every one of those renders fires another billed generate.
  const firedRef = useRef<string | null>(null);
  // LIFE-WORLD-ARC-10: did this world ever have an arc while we were watching?
  // If so, it did not arrive stranded — a chapter COMPLETED here, and the
  // *Continue your wurld* CTA owns what comes next.
  const sawArcRef = useRef<string | null>(null);
  // Declared BEFORE the heal effect so it has already recorded the arc by the
  // render on which the arc goes missing. A ref, not state: this must not
  // itself cause a render, and it must survive the snapshot churn that makes
  // `world` a new object every time.
  useEffect(() => {
    if (hasArc && worldId) sawArcRef.current = worldId;
  }, [hasArc, worldId]);

  useEffect(() => {
    if (!uid || !worldId) return;
    if (hasArc) return;
    // LIFE-WORLD-ARC-10 — the CTA's chapter, not ours.
    //
    // PRODUCTION, 2026-08-06: chapter 2 was generated TWICE. `archiveActiveArc`
    // nulls `currentArc`, so the moment the chapter-complete screen appears
    // this hook's precondition is satisfied — while `continueToNextChapter` is
    // about to generate the SAME chapter number from the CTA. Two billed calls
    // for one chapter, last write wins, and the chapter the player was shown is
    // not necessarily the one that got stored.
    //
    // This is the `completedArcCount <= 0` guard below with a different owner:
    // that one keeps chapter 1 for `LifeStartScreen`, this one keeps chapter
    // N+1 for the CTA. The distinguishing fact is the same — WHOSE JOB IS IT —
    // and it is answered by whether the arc was missing on arrival (stranded,
    // nobody else is coming) or vanished mid-session (a chapter just ended
    // here). Per MOUNT, so pausing and re-entering still heals a real strand.
    if (sawArcRef.current === worldId) return;
    // completedArcCount 0 + no arc = world creation still in flight.
    // LIFE-WORLD-ARC-3 owns chapter 1; firing here would race LifeStartScreen
    // and write a second one.
    if (completedArcCount <= 0) return;
    if (firedRef.current === worldId) return;
    firedRef.current = worldId;

    void (async () => {
      try {
        // The archived arcs are the only record of what completed, and the
        // scalar is what the clean-break data model keeps for exactly this
        // (LIFE-WORLD-ARC-1).
        const result = await runWorldArcGenerate({
          uid,
          world: world as Parameters<typeof runWorldArcGenerate>[0]['world'],
          chapterNumber: completedArcCount + 1,
        });
        await updateLifeWorld(uid, worldId, { currentArc: result.arc });
        log.info('life.worldArc.self-healed', {
          worldId,
          chapterNumber: completedArcCount + 1,
        });
      } catch (err) {
        // Deliberately NOT retried on the next render: the latch stays set, so
        // a persistent failure costs one call per session rather than one per
        // frame. Re-opening the world tries again.
        log.warn('life.worldArc.self-heal-failed', { err: String(err), worldId });
      }
    })();
    // `world` is intentionally not a dep — it changes identity on every
    // snapshot, and the latch plus the three scalars above are what actually
    // gate this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, worldId, hasArc, completedArcCount]);
}
