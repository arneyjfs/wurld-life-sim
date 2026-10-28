/**
 * LIFE-WORLD-ARC-*: chapter-complete celebration overlay.
 *
 * Shown after a scene resolves with `arcStage: 'concluding'`
 * AND the player dismisses the SceneCompleteScreen. Surfaces:
 *  - Chapter number + premise.
 *  - Aggregated stats across the chapter (scenes completed,
 *    practice questions, accuracy).
 *  - The recurring NPCs the player built up.
 *  - Two CTAs:
 *      "Continue your life"  → runWorldArcGenerate(chapter+1).
 *      "Pause for now"       → navigate to /life/overview.
 *
 * Spec: docs/specs/life-sim.md §10.7 (LIFE-WORLD-ARC-*).
 */
import { Flame } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { ChapterResultsList } from './ChapterResultsList';
import type { PractisedWord } from '@/lib/life/vocabRecap';
import type { WorldArc } from '@/types/firestore';

export type WorldArcCompleteScreenProps = {
  arc: WorldArc;
  /** Display names for the recurring NPCs (model-promoted), for the
   *  "people you'll see again" line. */
  recurringNpcNames: string[];
  /** LIFE-VOCAB-RECAP-4: needed by the per-row save button. */
  uid?: string;
  practiceLanguage?: string;
  nativeLanguage?: string;
  /** LIFE-VOCAB-RECAP-3: the chapter's KEY WORDS — the story's recurring
   *  vocabulary (from beat annotations), frequency-ranked. */
  keyWords: PractisedWord[];
  /** True while runWorldArcGenerate is in flight after Continue. */
  generatingNext: boolean;
  onContinue: () => void;
  onPause: () => void;
};

export function WorldArcCompleteScreen({
  arc,
  recurringNpcNames,
  uid,
  practiceLanguage,
  nativeLanguage,
  keyWords,
  generatingNext,
  onContinue,
  onPause,
}: WorldArcCompleteScreenProps) {
  const t = useT();
  return (
    <div
      data-testid="LifeScreen-WorldArcComplete"
      className="fixed inset-0 z-(--z-modal) flex items-center justify-center p-4 pb-safe-bottom pt-safe-top bg-(--color-bg)/90 backdrop-blur-sm animate-in fade-in duration-300"
    >
      <div
        // LIFE-UI-14: cap the card at the viewport and scroll INSIDE it.
        // The recap list is unbounded — a long day pushes the card past the
        // screen, and because the backdrop centres with `items-center`, an
        // over-tall child overflows BOTH ways and its top goes off-screen.
        // That is why this read as "not centred" and as "the list pushes the
        // modal past the screen height": one cause, two symptoms.
        className="max-w-md w-full max-h-full overflow-y-auto overscroll-contain rounded-2xl bg-(--color-bg-elevated) border border-(--color-border) shadow-xl p-6 flex flex-col gap-4 animate-in slide-in-from-bottom-4 duration-300"
      >
        <div className="flex items-center gap-2 text-(--color-fg-muted) text-[11px] uppercase font-semibold tracking-wider">
          <Flame size={14} className="text-(--color-accent)" />
          <span>
            {t('life.arcComplete.eyebrow', { chapter: arc.chapterNumber })}
          </span>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-gradient-accent leading-tight">
            {t('life.arcComplete.title', { chapter: arc.chapterNumber })}
          </h2>
          <p className="mt-1 text-sm text-(--color-fg) leading-snug">
            {/* LIFE-WORLD-ARC-REGISTER: player-facing → spoiler-safe teaser (legacy: premise). */}
            {arc.playerTeaser?.trim() || arc.premise}
          </p>
        </div>
        {/* LIFE-SCENE-31 — the chapter leads with its RECORD too.
            The day list below was already here (LIFE-DAY-2); it sat under the
            resolving scene's `outcomeLine`, so the card opened on one beat of
            the last day and only then showed what the chapter had been. The
            beat is dropped for the same reason as on the scene screen — the
            player read it in the story a screen ago — and the record moves up
            to lead. */}
        {/* LIFE-DAY-2: the DAYS this chapter was made of — one line per
            resolved scene, from the arc's own memories. This is the thing
            the day screen cannot show, and it is what a chapter recap is
            actually for. */}
        {arc.completedSceneMemories.length > 0 && (
          <div data-testid="LifeScreen-WorldArcComplete-Days">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-(--color-fg-muted)">
              {t('life.arcComplete.daysHeading')}
            </div>
            <ol className="mt-2 flex flex-col gap-2">
              {arc.completedSceneMemories.map((m, i) => (
                <li
                  key={m.sceneId}
                  data-testid="LifeScreen-WorldArcComplete-Day"
                  className="flex gap-2.5 text-sm leading-snug"
                >
                  <span className="shrink-0 w-5 h-5 mt-px rounded-full bg-(--color-bg-hover) text-[11px] font-semibold text-(--color-fg-muted) flex items-center justify-center">
                    {i + 1}
                  </span>
                  {/* LIFE-SCENE-35: the practice line LEADS — it is the one
                      worth reading — with the system-language twin under it,
                      muted and smaller. Omitted entirely when absent (a
                      chapter recorded before the twin was stored) rather than
                      rendering a blank row, which reads as a failed
                      translation. */}
                  <span className="min-w-0">
                    <span className="font-medium text-(--color-fg)">{m.title}</span>
                    {m.summary && (
                      <span className="text-(--color-fg-muted)"> — {m.summary}</span>
                    )}
                    {m.summaryNative?.trim() && (
                      <span
                        data-testid="LifeScreen-WorldArcComplete-DayNative"
                        className="block text-xs text-(--color-fg-muted)/80 leading-snug mt-0.5"
                      >
                        {m.summaryNative}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {/* LIFE-VOCAB-RECAP-3/4: the chapter's story vocabulary. Ungraded — it
            was met in the narrative, never tested — so every row carries the
            neutral marker rather than a tick or a cross. It IS saveable: a word
            worth surfacing here is worth keeping, and whether it happened to be
            quizzed is irrelevant to that. */}
        <ChapterResultsList
          words={keyWords}
          uid={uid}
          practiceLanguage={practiceLanguage}
          nativeLanguage={nativeLanguage}
          title={t('life.arcComplete.keyWords')}
          testid="LifeScreen-KeyWords"
        />
        {recurringNpcNames.length > 0 && (
          <div className="text-xs text-(--color-fg-muted)">
            <span className="font-semibold">
              {t('life.arcComplete.recurring')}
            </span>{' '}
            {recurringNpcNames.join(' · ')}
          </div>
        )}
        {/* LIFE-DAY-2: forward-looking, and deliberately NON-SPECIFIC — the
            next chapter's arc is not generated until Continue is pressed, so
            naming its content here would be invention. The real teaser
            (`arc.playerTeaser`) shows on the resume screen once it exists. */}
        <p
          data-testid="LifeScreen-WorldArcComplete-NextTeaser"
          className="text-xs text-(--color-fg-muted) leading-relaxed"
        >
          {t('life.arcComplete.nextTeaser')}
        </p>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={onContinue}
            disabled={generatingNext}
            data-testid="LifeScreen-WorldArcComplete-Continue"
            className={cn(
              'w-full py-3 rounded-full text-sm font-semibold bg-gradient-accent text-white',
              generatingNext && 'opacity-60 cursor-not-allowed',
            )}
          >
            {generatingNext
              ? t('life.arcComplete.continuing')
              : t('life.arcComplete.continue')}
          </button>
          <button
            type="button"
            onClick={onPause}
            disabled={generatingNext}
            data-testid="LifeScreen-WorldArcComplete-Pause"
            className="w-full py-2.5 rounded-full text-sm font-semibold text-(--color-fg) bg-(--color-bg-hover) disabled:opacity-50"
          >
            {t('life.arcComplete.pause')}
          </button>
        </div>
      </div>
    </div>
  );
}
