/**
 * LIFE-UI-* / LIFE-LANG-3: the top header bar on /life.
 *
 * Back button, world title (the saga title — falls back to character name
 * until saga lands), the second-row EYE, and the 3-dot menu. Pulled out of
 * LifeScreen.tsx so that file stays under the 600-LOC cap. No streak badge —
 * the streak is GLOBAL (LIFE-STREAK-4) and shown in the Wurlds overview
 * header, not while inside a wurld.
 *
 * MSG-VIEW-7.7 — the eye is the SAME control as the chat header's: one tap,
 * one row, nothing else. It replaces the 3-way Eye→EyeOff→Languages cycle,
 * which had to be tapped up to three times to reach a state and never said
 * what the states were. The three main-row choices now live in the ⋯ menu
 * that was already sitting to its right, as the shared `ViewSettingsRows`.
 */
import { BackButton } from '@/components/nav/BackButton';
import { Eye, EyeOff } from 'lucide-react';
import { useT } from '@/i18n';
import type { Difficulty } from '@/types/firestore';
import type { ViewSettings } from '@/lib/viewSettings';
import { LifeScreenMenu } from './LifeScreenMenu';
import { GoalChip } from './GoalChip';
import type { GoalLadderDoc } from '@/types/lifeGoal';
import type { LifeErrorSink } from './nodeEngineTypes';

export type LifeScreenHeaderProps = {
  uid: string;
  worldId: string;
  title: string;
  /** LIFE-LANG-3: the wurld's current view settings. */
  viewSettings: ViewSettings;
  /** LIFE-LANG-3: fired with the NEXT settings. LifeScreen persists them
   *  via updateLifeWorld. */
  onSetViewSettings: (next: ViewSettings) => void;
  /** The wurld's languages — the sheet labels its options with the REAL
   *  names, never the words "practice" / "native" (MSG-VIEW-7.3). */
  practiceLanguage: string | undefined;
  nativeLanguage: string | undefined;
  /** LIFE-SETTINGS-7: threaded to the ⋯ menu's difficulty control. */
  difficultyPinned: Difficulty | null | undefined;
  globalDifficulty: Difficulty;
  /** LIFE-GOAL-6: the ladder behind the count chip. Absent ⇒ no chip. */
  goalLadder?: GoalLadderDoc | null;
  onExit: () => void;
  onDeleted: () => void;
  onError: LifeErrorSink;
};

export function LifeScreenHeader({
  uid,
  worldId,
  title,
  viewSettings,
  onSetViewSettings,
  practiceLanguage,
  nativeLanguage,
  difficultyPinned,
  globalDifficulty,
  goalLadder,
  onExit,
  onDeleted,
  onError,
}: LifeScreenHeaderProps) {
  const t = useT();
  return (
    <header className="flex items-center justify-between px-3 pt-safe-top pb-2 bg-(--color-bg)">
      <BackButton className="p-1.5" />
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold truncate max-w-[60vw]">{title}</h1>
      </div>
      <div className="flex items-center gap-1">
        {/* LIFE-GOAL-6 — left of the eye, so the two story-facing controls
            (what am I doing, what can I read) sit together and the ⋯ menu
            stays the rightmost thing as it is everywhere else. */}
        <GoalChip ladder={goalLadder} />
        <button
          type="button"
          onClick={() =>
            onSetViewSettings({ ...viewSettings, secondRow: !viewSettings.secondRow })
          }
          data-testid="LifeScreen-EyeButton"
          aria-pressed={viewSettings.secondRow}
          aria-label={t('view.settings.eyeAria')}
          title={t('view.settings.eyeAria')}
          className="p-1.5 text-(--color-fg-muted) hover:text-(--color-fg)"
        >
          {viewSettings.secondRow ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
        <LifeScreenMenu
          uid={uid}
          worldId={worldId}
          viewSettings={viewSettings}
          onSetViewSettings={onSetViewSettings}
          practiceLanguage={practiceLanguage}
          nativeLanguage={nativeLanguage}
          difficultyPinned={difficultyPinned}
          globalDifficulty={globalDifficulty}
          onExit={onExit}
          onDeleted={onDeleted}
          onError={onError}
        />
      </div>
    </header>
  );
}
