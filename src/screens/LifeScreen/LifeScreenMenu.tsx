/**
 * LIFE-SETTINGS-6: three-dot menu in the LifeScreen header. Currently
 * exposes a single action — "Delete & restart" — which wipes the
 * world doc, all subcollections (events / NPCs / scenes /
 * lifeScene), and the lifeAssets/{uid} Storage prefix, then
 * navigates the player to the onboarding screen so they can begin a
 * fresh world.
 *
 * Future actions (character sheet, settings) can plug in here.
 *
 * Spec: docs/specs/life-sim.md §13 (LIFE-SETTINGS-*).
 */
import { useState } from 'react';
import { useOverlayBack } from '@/hooks/useOverlayBack';
import { ChevronDown, FileText, Gauge, LogOut, MoreVertical, RotateCcw, X } from 'lucide-react';
import { useT, type MessageKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { deleteLifeWorld, updateLifeWorld } from '@/lib/life/world';
import type { LifeErrorSink } from './nodeEngineTypes';
import type { Difficulty } from '@/types/firestore';
import type { ViewSettings } from '@/lib/viewSettings';
import { ViewSettingsRows } from '@/components/ViewSettingsSheet';
import { LifeDebugLogOverlay } from './LifeDebugLogOverlay';

/** LIFE-SETTINGS-7: the 1-7 levels; labels reuse the Settings catalogue
 *  (settings.difficulty.level{N}.label) so the wording stays in one place. */
const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5, 6, 7] as const;
function levelLabelKey(n: number): MessageKey {
  return `settings.difficulty.level${n}.label` as MessageKey;
}

export type LifeScreenMenuProps = {
  uid: string;
  /** LIFE-WORLD-*: required — delete scopes to this world only. */
  worldId: string;
  /** LIFE-LANG-3 / MSG-VIEW-7 — the shared view-settings rows render at the
   *  TOP of this menu. Life has no second ⋯ to put them behind, and the
   *  header eye is only a shortcut for one of them. */
  viewSettings: ViewSettings;
  onSetViewSettings: (next: ViewSettings) => void;
  practiceLanguage: string | undefined;
  nativeLanguage: string | undefined;
  /** LIFE-SETTINGS-7: current per-wurld difficulty pin. A number pins the
   *  wurld to that level; null/undefined ⇒ following the global setting. */
  difficultyPinned: Difficulty | null | undefined;
  /** LIFE-SETTINGS-7: live global profile difficulty — drives the
   *  "Following global · Level X" automatic state + the picker highlight. */
  globalDifficulty: Difficulty;
  /** Optional: when present, the menu renders an "Exit to overview"
   *  option in addition to delete. */
  onExit?: () => void;
  /** Pushed onto the navigate stack after delete completes — usually
   *  the overview route. */
  onDeleted: () => void;
  /** Surfaces a toast (and a Sentry event, OBS-COVER-7) for a failure. */
  onError: LifeErrorSink;
};

export function LifeScreenMenu({
  uid,
  worldId,
  viewSettings,
  onSetViewSettings,
  practiceLanguage,
  nativeLanguage,
  difficultyPinned,
  globalDifficulty,
  onExit,
  onDeleted,
  onError,
}: LifeScreenMenuProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // NAV-OVERLAY-2 — Android back closes this overlay before it leaves the page.
  useOverlayBack(confirming, () => {
    if (!deleting) setConfirming(false);
  });
  const [debugOpen, setDebugOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // LIFE-SETTINGS-7: `isPinned` ⇒ the wurld overrides the global; else it
  // follows it. `shownLevel` is the level the picker highlights + labels.
  const isPinned = difficultyPinned != null;
  const shownLevel: Difficulty = difficultyPinned ?? globalDifficulty;
  const stateLine = isPinned
    ? t('life.difficulty.pinned', {
        level: difficultyPinned,
        label: t(levelLabelKey(difficultyPinned)),
      })
    : t('life.difficulty.followingGlobal', {
        level: globalDifficulty,
        label: t(levelLabelKey(globalDifficulty)),
      });

  function writePin(next: Difficulty | null) {
    void updateLifeWorld(uid, worldId, { difficultyPinned: next }).catch(
      (err: unknown) => {
        onError(err, 'lifeDifficultyPin'); // OBS-COVER-7
      },
    );
  }

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await deleteLifeWorld(uid, worldId);
      onDeleted();
    } catch (err) {
      onError(err, 'lifeWorldDelete'); // OBS-COVER-7
    } finally {
      setDeleting(false);
      setConfirming(false);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="LifeScreen-MenuButton"
        aria-label={t('life.menu.label')}
        onClick={() => setOpen(true)}
        className="p-1.5 -mr-1 text-(--color-fg)"
      >
        <MoreVertical size={18} />
      </button>

      {open && (
        <div
          data-testid="LifeScreen-MenuOverlay"
          className="fixed inset-0 z-40"
        >
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/20"
          />
          <div
            role="menu"
            className="absolute right-3 top-12 w-[min(20rem,calc(100vw-1.5rem))] max-h-[calc(100vh-4.5rem)] overflow-y-auto rounded-xl bg-(--color-bg-elevated) border border-(--color-border) shadow-lg py-1 animate-in fade-in slide-in-from-top-1 duration-150"
          >
            {/* MSG-VIEW-7 — the SAME rows the chat sheet renders. */}
            <ViewSettingsRows
              settings={viewSettings}
              onChange={onSetViewSettings}
              practiceLanguage={practiceLanguage}
              nativeLanguage={nativeLanguage}
            />
            <div className="border-t border-(--color-border) my-1" />
            {onExit && (
              <button
                type="button"
                role="menuitem"
                data-testid="LifeScreen-Menu-Exit"
                onClick={() => {
                  setOpen(false);
                  onExit();
                }}
                className="w-full px-3 py-2 text-left text-sm text-(--color-fg) hover:bg-(--color-bg-hover) flex items-center gap-2"
              >
                <LogOut size={14} />
                {t('life.menu.exit')}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              data-testid="LifeScreen-Menu-Debug"
              onClick={() => {
                setOpen(false);
                setDebugOpen(true);
              }}
              className="w-full px-3 py-2 text-left text-sm text-(--color-fg) hover:bg-(--color-bg-hover) flex items-center gap-2"
            >
              <FileText size={14} />
              {t('life.menu.debug')}
            </button>
            {/* LIFE-SETTINGS-7: per-wurld difficulty override. Automatic
                by default (follows the global setting); an optional pin
                fixes this wurld to a level. */}
            <div className="border-t border-(--color-border) mt-1 pt-1">
              <div className="px-3 py-1 flex items-center gap-2 text-xs font-semibold text-(--color-fg-muted)">
                <Gauge size={14} />
                {t('life.difficulty.title')}
              </div>
              <button
                type="button"
                data-testid="LifeScreen-Menu-Difficulty"
                aria-expanded={pickerOpen}
                aria-label={t('life.difficulty.setForWurld')}
                onClick={() => setPickerOpen((v) => !v)}
                className="w-full px-3 py-1.5 text-left text-sm text-(--color-fg) hover:bg-(--color-bg-hover) flex items-center justify-between gap-2"
              >
                <span
                  data-testid="LifeScreen-Menu-Difficulty-State"
                  className="min-w-0 truncate"
                >
                  {stateLine}
                </span>
                <ChevronDown
                  size={14}
                  className={cn(
                    'shrink-0 text-(--color-fg-muted) transition-transform',
                    pickerOpen && 'rotate-180',
                  )}
                />
              </button>
              {pickerOpen && (
                <div
                  data-testid="LifeScreen-Menu-Difficulty-Picker"
                  className="px-3 pb-2 pt-1"
                >
                  <div className="flex items-center gap-1">
                    {DIFFICULTY_LEVELS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        data-testid={`LifeScreen-Menu-Difficulty-Level-${n}`}
                        aria-label={t(levelLabelKey(n))}
                        aria-pressed={n === shownLevel}
                        onClick={() => writePin(n)}
                        className={cn(
                          'flex-1 h-7 rounded-md text-xs font-semibold transition-colors',
                          n === shownLevel
                            ? 'bg-(--color-fg) text-(--color-bg)'
                            : 'bg-(--color-bg-hover) text-(--color-fg-muted) hover:text-(--color-fg)',
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-(--color-fg-muted)">
                    {t(levelLabelKey(shownLevel))}
                  </p>
                  {isPinned && (
                    <button
                      type="button"
                      data-testid="LifeScreen-Menu-Difficulty-UseGlobal"
                      onClick={() => writePin(null)}
                      className="mt-2 text-xs font-medium text-(--color-accent) hover:underline"
                    >
                      {t('life.difficulty.useGlobal')}
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              role="menuitem"
              data-testid="LifeScreen-Menu-DeleteRestart"
              onClick={() => setConfirming(true)}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-(--color-bg-hover) flex items-center gap-2 border-t border-(--color-border) mt-1 pt-2"
            >
              <RotateCcw size={14} />
              {t('life.menu.deleteRestart')}
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <div
          data-testid="LifeScreen-DeleteConfirm"
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
        >
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => !deleting && setConfirming(false)}
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          />
          <div className="relative w-full max-w-md rounded-2xl bg-(--color-bg-elevated) border border-(--color-border) shadow-xl p-5 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <button
              type="button"
              onClick={() => !deleting && setConfirming(false)}
              aria-label={t('common.close')}
              disabled={deleting}
              className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-(--color-bg-hover) text-(--color-fg-muted)"
            >
              <X size={16} />
            </button>
            <h2 className="text-base font-semibold text-(--color-fg)">
              {t('life.menu.deleteConfirm.title')}
            </h2>
            <p className="mt-2 text-sm text-(--color-fg-muted) leading-relaxed">
              {t('life.menu.deleteConfirm.body')}
            </p>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="px-4 py-2 rounded-full text-sm text-(--color-fg) bg-(--color-bg-hover) disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={deleting}
                data-testid="LifeScreen-DeleteConfirm-Confirm"
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-semibold text-white bg-red-600',
                  deleting && 'opacity-60 cursor-not-allowed',
                )}
              >
                {deleting
                  ? t('life.menu.deleteConfirm.deleting')
                  : t('life.menu.deleteConfirm.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {debugOpen && <LifeDebugLogOverlay onClose={() => setDebugOpen(false)} />}
    </>
  );
}
