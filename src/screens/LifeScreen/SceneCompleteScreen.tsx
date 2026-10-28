/**
 * LIFE-SCENE-10: completion overlay shown after the model emits a
 * resolution beat. Renders the scene title, outcome line, and
 * graded-question stats computed from the event log during the
 * scene's window. CTA archives the scene + returns the player
 * to idle.
 *
 * Spec: docs/specs/life-sim.md §11 (LIFE-SCENE-10).
 */
import { CheckCircle2, Flame, PartyPopper, RefreshCw } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { ChapterResultsList } from './ChapterResultsList';
import { missedQuizHref, missedWords } from '@/lib/life/missedWordsQuiz';
import type { PractisedWord } from '@/lib/life/vocabRecap';

export type SceneCompleteScreenProps = {
  title: string;
  /** LIFE-SCENE-31: what `runSceneClose` recorded for this scene — the line the
   *  world keeps and every later turn reads. Null while that close is still in
   *  flight; the screen shows a placeholder rather than waiting for it. */
  summary: string | null;
  /** LIFE-GOAL-8: the live objective's text, restated here so the count chip
   *  in the header keeps meaning something. Null ⇒ the row hides. */
  liveObjective?: string | null;
  /** LIFE-SCENE-31.1: the close has REPORTED. `summary === null` with this
   *  false means still in flight (shimmer); with it TRUE it means there is no
   *  record, and the card must stop pretending one is coming. */
  summaryDone?: boolean;
  tone: string;
  /** LIFE-DAY-6: the two type cells render `correct/total`, so a day the player
   *  aced on one type and missed on the other stops reading like an even one. */
  stats: {
    gradedCount: number;
    correctCount: number;
    generationCount: number;
    generationCorrect: number;
    comprehensionCount: number;
    comprehensionCorrect: number;
  };
  /** LIFE-VOCAB-RECAP-2: words practised during the scene window — derived
   *  reactively by the parent from the live events + `snapshot.windowStartSec`
   *  (never a frozen resolve-time list; see LifeCompletionOverlays). */
  words: PractisedWord[];
  /** LIFE-DAY-1: whether this scene ALSO ends the chapter. When it does the
   *  WorldArcCompleteScreen follows immediately with a Continue CTA, so the
   *  continuation teaser is suppressed — closing the story down one beat
   *  before offering to carry on contradicts itself. */
  chapterAlsoEnding?: boolean;
  /** LIFE-DAY-5 — where the missed-words practice sends the player when it
   *  ends. Practice defaults to `/cards`; from a wurld that is the wrong
   *  place, so the world's own path travels with the link. */
  returnTo?: string;
  /** LIFE-DAY-3: navigate to the missed-words practice session. The screen
   *  builds the href; the caller owns routing so the overlay stays
   *  presentational (and testable without a Router). */
  onPractiseMissed?: (href: string) => void;
  /** LIFE-VOCAB-RECAP-4: needed by the per-row save button. */
  uid?: string;
  practiceLanguage?: string;
  nativeLanguage?: string;
  /** LIFE-SCENE-29: resume the story where it left off. This is what the old
   *  single "Return home" button actually did, now labelled honestly. */
  onClose: () => void;
  /** LIFE-SCENE-29: leave the wurld for the overview. Absent on the
   *  chapter-ending path, where the chapter screen owns the exit. */
  onReturnToWurlds?: () => void;
  closing?: boolean;
};

export function SceneCompleteScreen({
  title,
  summary,
  summaryDone,
  liveObjective,
  tone,
  stats,
  words,
  chapterAlsoEnding,
  returnTo,
  onPractiseMissed,
  uid,
  practiceLanguage,
  nativeLanguage,
  onClose,
  onReturnToWurlds,
  closing,
}: SceneCompleteScreenProps) {
  const t = useT();
  const missedCount = missedWords(words).length;
  const missedHref = missedQuizHref(words, practiceLanguage, returnTo);
  const accuracyPct =
    stats.gradedCount > 0
      ? Math.round((stats.correctCount / stats.gradedCount) * 100)
      : 0;
  return (
    <div
      data-testid="LifeScreen-SceneComplete"
      className="fixed inset-0 z-(--z-modal) flex items-center justify-center p-4 pb-safe-bottom pt-safe-top bg-(--color-bg)/85 backdrop-blur-sm animate-in fade-in duration-300"
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
          <span>{t('life.sceneComplete.eyebrow')}</span>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-gradient-accent">{title}</h2>
          <p className="mt-1 text-xs italic text-(--color-fg-muted)">{tone}</p>
        </div>
        {/* LIFE-SCENE-31 — THE WORLD'S RECORD, not the last beat.
            `outcomeLine` is the resolution BEAT, which the player finished
            reading on the previous screen (LIFE-SCENE-30 parks this overlay
            behind a chip precisely so they see it in the story first). Showing
            it again here spent the summary slot on a line they had just read.
            What belongs here is what the world KEPT: the compacted line
            `runSceneClose` wrote, which every later turn reads back as
            history, so the card and the story agree about what happened.

            It is in the SYSTEM language by construction — the close reads the
            scene back to judge it and reasons in the system language — so the
            LIFE-SCENE-28 concern that put a gloss under the practice line does
            not arise: this line is already readable.

            NULL while the close is in flight. It is a separate generation
            kicked off by the resolving turn, and usually lands before the
            player promotes the chip; when it has not, the slot holds its own
            height with a pulse rather than letting the card jump. */}
        <blockquote className="border-l-2 border-(--color-accent)/40 pl-3 leading-relaxed">
          <span className="mb-1 block text-[10px] uppercase font-semibold tracking-wider text-(--color-fg-muted)">
            {t('life.sceneComplete.summaryLabel')}
          </span>
          {summary?.trim() ? (
            <span
              data-testid="LifeScreen-SceneComplete-Summary"
              className="block text-sm text-(--color-fg)"
            >
              {summary}
            </span>
          ) : summaryDone ? (
            // LIFE-SCENE-31.1 — the TERMINAL empty state, and the reason it
            // exists. The close has three silent failure modes and this slot
            // used to render the pulsing placeholder for `null` unconditionally,
            // so any of them shimmered for ever. A shimmer is a PROMISE that
            // something is coming; when nothing is, saying so plainly is the
            // only honest render.
            <span
              data-testid="LifeScreen-SceneComplete-SummaryUnavailable"
              className="block text-sm italic text-(--color-fg-muted)"
            >
              {t('life.sceneComplete.summaryUnavailable')}
            </span>
          ) : (
            <span
              data-testid="LifeScreen-SceneComplete-SummaryPending"
              className="block text-sm italic text-(--color-fg-muted) animate-pulse"
            >
              {t('life.sceneComplete.summaryPending')}
            </span>
          )}
        </blockquote>
        {/* LIFE-GOAL-8 — RESTATE THE OBJECTIVE, and this is load-bearing.
            `LIFE-GOAL-6` puts the goal behind a tap on a count chip, which is
            the owner's call and the right one for chrome — but a bare "12 days"
            means nothing to a player who has forgotten what it counts, and that
            is a mild version of the very symptom this feature exists to fix.
            This screen already fires every scene and is already a reading
            surface, so re-anchoring here costs nothing and is what makes the
            chip safe. Absent objective ⇒ absent row, never an empty label. */}
        {liveObjective?.trim() ? (
          <div data-testid="LifeScreen-SceneComplete-Objective">
            <span className="mb-1 block text-[10px] uppercase font-semibold tracking-wider text-(--color-fg-muted)">
              {t('life.goal.sceneClose')}
            </span>
            <span className="block text-sm text-(--color-fg)">{liveObjective}</span>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3 mt-2">
          <Stat
            label={t('life.sceneComplete.stats.practiced')}
            value={stats.gradedCount.toString()}
          />
          <Stat
            label={t('life.sceneComplete.stats.accuracy')}
            value={`${accuracyPct}%`}
            emphasis={accuracyPct >= 70}
          />
          {/* LIFE-DAY-6: `correct/total`, not a bare count. A type the day
              never asked still renders (0/0) — a grid whose cells come and go
              is harder to read than one that is always four. */}
          <Stat
            testid="LifeScreen-SceneComplete-FillBlank"
            label={t('life.sceneComplete.stats.fillBlank')}
            value={`${stats.generationCorrect}/${stats.generationCount}`}
            emphasis={
              stats.generationCount > 0 && stats.generationCorrect === stats.generationCount
            }
          />
          <Stat
            testid="LifeScreen-SceneComplete-Comprehension"
            label={t('life.sceneComplete.stats.comprehension')}
            value={`${stats.comprehensionCorrect}/${stats.comprehensionCount}`}
            emphasis={
              stats.comprehensionCount > 0 &&
              stats.comprehensionCorrect === stats.comprehensionCount
            }
          />
        </div>
        <ChapterResultsList
          words={words}
          uid={uid}
          practiceLanguage={practiceLanguage}
          nativeLanguage={nativeLanguage}
        />
        {/* LIFE-DAY-3: the summary showed what you missed and then had nothing
            to do about it. Routes through the existing practice intent
            contract; absent when there were no mistakes, because an empty
            "practise your mistakes" session is worse than no button. */}
        {missedHref && (
          <a
            href={missedHref}
            data-testid="LifeScreen-SceneComplete-PractiseMissed"
            onClick={(e) => {
              e.preventDefault();
              onPractiseMissed?.(missedHref);
            }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border border-(--color-danger)/40 text-(--color-danger) text-sm font-medium"
          >
            <RefreshCw size={15} />
            {missedCount === 1
              ? t('life.vocabRecap.reviewMistakesOne')
              : t('life.vocabRecap.reviewMistakes', { count: missedCount })}
          </a>
        )}
        {chapterAlsoEnding && (
          // LIFE-DAY-4 — the day AND the chapter both landed on this scene.
          // Without this the screen said "return home" and the chapter's own
          // summary was somewhere the player had no reason to look, so the
          // larger of the two milestones passed unmarked. The button leads to
          // it instead, and this says why the button changed.
          <div
            data-testid="LifeScreen-SceneComplete-ChapterEnd"
            className="rounded-xl border border-(--color-accent)/40 bg-(--color-accent)/10 px-4 py-3 flex items-start gap-2.5"
          >
            <PartyPopper size={18} className="shrink-0 mt-0.5 text-(--color-accent)" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-(--color-fg)">
                {t('life.sceneComplete.chapterEndTitle')}
              </div>
              <div className="text-xs text-(--color-fg-muted) leading-snug mt-0.5">
                {t('life.sceneComplete.chapterEndBody')}
              </div>
            </div>
          </div>
        )}
        {!chapterAlsoEnding && (
          <p
            data-testid="LifeScreen-SceneComplete-Tomorrow"
            className="text-xs text-(--color-fg-muted) leading-relaxed"
          >
            {t('life.sceneComplete.tomorrow')}
          </p>
        )}
        {/* LIFE-SCENE-29 — TWO destinations, each saying what it does. The
            single button said "Return home" and then called `continueTurn()`:
            it resumed the story, which is the opposite of what it promised.
            On the chapter-ending path there is still ONE button, because the
            chapter screen follows immediately and owns the exit — offering
            "return to Wurlds" here would skip it. */}
      {/* The pair sits in its OWN gap-2 stack: the card's gap-4 is the rhythm
            between sections, and two buttons that do related things reading a
            whole section apart is the wrong grouping. */}
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={!!closing}
            data-testid="LifeScreen-SceneComplete-Return"
            className={cn(
              'w-full py-3 rounded-full text-sm font-semibold bg-gradient-accent text-white',
              closing && 'opacity-60 cursor-not-allowed',
            )}
          >
            {closing
              ? t('life.sceneComplete.returning')
              : chapterAlsoEnding
                ? t('life.sceneComplete.seeChapterSummary')
                : t('life.sceneComplete.continueStory')}
          </button>
          {!chapterAlsoEnding && onReturnToWurlds && (
            <button
              type="button"
              onClick={onReturnToWurlds}
              disabled={!!closing}
              data-testid="LifeScreen-SceneComplete-ReturnToWurlds"
              className={cn(
                'w-full py-3 rounded-full text-sm font-semibold border border-(--color-border) text-(--color-fg)',
                closing && 'opacity-60 cursor-not-allowed',
              )}
            >
              {t('life.sceneComplete.returnToWurlds')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  emphasis,
  testid,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid}
      className="rounded-xl bg-(--color-bg-hover)/50 border border-(--color-border)/40 px-3 py-2"
    >
      <div className="text-[10px] uppercase font-semibold tracking-wider text-(--color-fg-muted) flex items-center gap-1">
        {emphasis && (
          <CheckCircle2 size={10} className="text-(--color-accent)" />
        )}
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold text-(--color-fg)">
        {value}
      </div>
    </div>
  );
}
