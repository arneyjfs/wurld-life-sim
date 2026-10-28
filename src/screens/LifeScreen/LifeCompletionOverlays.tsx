/**
 * LIFE-SCENE-10 / LIFE-WORLD-ARC-6/8 / LIFE-VOCAB-RECAP-2: the
 * scene + chapter completion overlays, extracted from LifeScreen
 * so the vocab-recap wiring lands here instead of growing the host
 * file (at the 600-counted-line ESLint cap when this was authored).
 * Pure presentation — LifeScreen owns all state and handlers.
 *
 * BOTH the scene and chapter word lists derive HERE at render time
 * from the live events window (scene: snapshot.windowStartSec → now;
 * chapter: arc.startedAt → now). Deriving reactively — rather than
 * freezing the scene list on the resolve-time snapshot — means a
 * Firestore-listener lag (events not yet in `p.events` at resolve) is
 * absorbed by re-render instead of permanently dropping words
 * (LIFE-VOCAB-RECAP-2). The derive call is pure and runs over ≤40 items —
 * an inline call in JSX, no `useMemo`, no hooks, so no hook-ordering risk.
 */
import { SceneCompleteScreen } from './SceneCompleteScreen';
import { WorldArcCompleteScreen } from './WorldArcCompleteScreen';
import {
  resolveRecurringNames,
  type SceneCompletionSnapshot,
} from '@/lib/life/sceneLifecycle';
import { deriveDayWords, deriveKeyWords, timestampSeconds } from '@/lib/life/vocabRecap';
import type { LifeEvent, LifeNpc, WorldArc } from '@/types/firestore';

export function LifeCompletionOverlays({
  completedScene,
  sceneSummary,
  sceneSummaryDone,
  liveObjective,
  arcComplete,
  busy,
  eventsData,
  npcs,
  uid,
  practiceLanguage,
  returnTo,
  nativeLanguage,
  onPractiseMissed,
  onCloseScene,
  onReturnToWurlds,
  onContinueChapter,
  onPauseChapter,
}: {
  completedScene: SceneCompletionSnapshot | null;
  /** LIFE-SCENE-31: what `runSceneClose` recorded, or null while it is still
   *  in flight. */
  sceneSummary: string | null;
  /** LIFE-SCENE-31.1: the close has reported. */
  sceneSummaryDone?: boolean;
  /** LIFE-GOAL-8: the live objective, restated on the scene-close card so the
   *  header's count chip keeps meaning something. */
  liveObjective?: string | null;
  arcComplete: { arc: WorldArc; snapshot: SceneCompletionSnapshot } | null;
  busy: boolean;
  /** Chronological `useLifeEvents` window (oldest → newest). */
  eventsData: LifeEvent[];
  npcs: ReadonlyMap<string, LifeNpc>;
  /** LIFE-VOCAB-RECAP-4: the per-row save button needs all three. */
  uid?: string;
  practiceLanguage?: string;
  /** LIFE-DAY-5 — the wurld's own path, carried into the practice link so the
   *  session's exit comes back here instead of the card deck. */
  returnTo?: string;
  nativeLanguage?: string;
  /** LIFE-DAY-3: routing for the missed-words practice CTA. */
  onPractiseMissed?: (href: string) => void;
  onCloseScene: () => void;
  /** LIFE-SCENE-29: the second destination — archive the scene, then leave for
   *  the Wurlds overview instead of resuming the story. */
  onReturnToWurlds: () => void;
  onContinueChapter: () => void;
  onPauseChapter: () => void;
}) {
  return (
    <>
      {completedScene && (
        <SceneCompleteScreen
          onPractiseMissed={onPractiseMissed}
          uid={uid}
          practiceLanguage={practiceLanguage}
          nativeLanguage={nativeLanguage}
          title={completedScene.title}
          chapterAlsoEnding={completedScene.arcStage === 'concluding'}
          returnTo={returnTo}
          summary={sceneSummary}
          summaryDone={sceneSummaryDone}
          liveObjective={liveObjective}
          tone={completedScene.tone}
          stats={completedScene.stats}
          // LIFE-VOCAB-RECAP-6: graded words PLUS the day's own story
          // vocabulary, so the list stops being a function of how many
          // questions the day happened to ask. Zero LLM, zero extra reads —
          // both halves derive from this same loaded event window.
          words={deriveDayWords(eventsData, completedScene.windowStartSec)}
          closing={busy}
          onClose={onCloseScene}
          onReturnToWurlds={onReturnToWurlds}
        />
      )}
      {arcComplete && (
        <WorldArcCompleteScreen
          uid={uid}
          practiceLanguage={practiceLanguage}
          nativeLanguage={nativeLanguage}
          arc={arcComplete.arc}
          recurringNpcNames={resolveRecurringNames(
            arcComplete.arc.recurringNpcIds,
            npcs,
          )}
          keyWords={deriveKeyWords(
            eventsData,
            timestampSeconds(arcComplete.arc.startedAt),
          )}
          generatingNext={busy}
          onContinue={onContinueChapter}
          onPause={onPauseChapter}
        />
      )}
    </>
  );
}
