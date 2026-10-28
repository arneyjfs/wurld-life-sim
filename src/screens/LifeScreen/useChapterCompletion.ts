/**
 * LIFE-WORLD-ARC-*: encapsulates the scene-close + chapter-close
 * action handlers used by LifeScreen so the screen's render layer
 * stays focused on UI. Returns three callables the screen wires to
 * the two completion screens' CTAs.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  archiveActiveArc,
  closeSceneFlow,
  type SceneCompletionSnapshot,
} from '@/lib/life/sceneLifecycle';
import { runWorldArcGenerate } from '@/lib/life/runWorldArcGenerate';
import { updateLifeWorld } from '@/lib/life/world';
import { recordStreakCompletion } from '@/lib/streak';
import type { LifeErrorSink } from './nodeEngineTypes';
import type { LifeScene, LifeWorld, WorldArc } from '@/types/firestore';


export type CloseSceneResult =
  | { kind: 'continue' }
  | { kind: 'chapter-complete'; arc: WorldArc };

export function useChapterCompletion(opts: {
  uid: string | null;
  world: LifeWorld | null;
  scene: LifeScene | null;
  onError: LifeErrorSink;
}) {
  const navigate = useNavigate();

  const closeScene = useCallback(
    async (
      snapshot: SceneCompletionSnapshot,
    ): Promise<CloseSceneResult> => {
      if (!opts.uid || !opts.world || !opts.scene) {
        return { kind: 'continue' };
      }
      let archivedArc: WorldArc | null = null;
      try {
        const closedArc = await closeSceneFlow({
          uid: opts.uid,
          world: opts.world,
          scene: opts.scene,
          snapshot,
        });
        if (snapshot.arcStage === 'concluding') {
          archivedArc = await archiveActiveArc({
            uid: opts.uid,
            // LIFE-DAY-2.1: the arc AS JUST CLOSED, not `opts.world`'s copy.
            // `opts.world` is the render-time snapshot and predates the write
            // `closeSceneFlow` made a line ago, so archiving from it dropped
            // the day that had just finished — every chapter recap was one day
            // short, and a one-scene chapter archived an empty day list.
            world: closedArc ? { ...opts.world, currentArc: closedArc } : opts.world,
            snapshot,
          });
        }
      } catch (err) {
        opts.onError(err, 'lifeArchiveScene'); // OBS-COVER-7 — the screen reports it
      }
      if (archivedArc) {
        // LIFE-STREAK-1: completing a wurld chapter advances the GLOBAL
        // engagement streak (shared with practice-session completion).
        // Fire-and-forget + idempotent per local day.
        void recordStreakCompletion(opts.uid);
      }
      return archivedArc
        ? { kind: 'chapter-complete', arc: archivedArc }
        : { kind: 'continue' };
    },
    [opts],
  );

  const continueToNextChapter = useCallback(
    async (currentArc: WorldArc): Promise<void> => {
      if (!opts.uid || !opts.world) return;
      try {
        const nextNumber = currentArc.chapterNumber + 1;
        const result = await runWorldArcGenerate({
          uid: opts.uid,
          world: opts.world,
          chapterNumber: nextNumber,
        });
        await updateLifeWorld(opts.uid, opts.world.id, {
          currentArc: result.arc,
        });
      } catch (err) {
        opts.onError(err, 'lifeNextChapter'); // OBS-COVER-7
      }
    },
    [opts],
  );

  const pauseToOverview = useCallback(() => {
    navigate('/wurlds');
  }, [navigate]);

  return { closeScene, continueToNextChapter, pauseToOverview };
}
