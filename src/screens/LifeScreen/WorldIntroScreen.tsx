/**
 * LIFE-WORLD-SAGA-*: shown on first entry to a brand-new world,
 * after the saga lands but before the opening lifeStep fires.
 *
 * Surfaces the spoiler-safe `playerFacingTeaser` so the player has
 * a moment to absorb what kind of story they're about to live —
 * without spoiling the antagonist, twists, or ending. Tapping
 * "Begin" releases the opening-step gate.
 *
 * Resume flows skip this — the player has already seen it.
 */
import { Sparkles } from 'lucide-react';
import { useT } from '@/i18n';

export type WorldIntroScreenProps = {
  title: string;
  /** LIFE-LANG-14: the display-language translation of `title` (which is
   *  in the practice language). Rendered under the title; hidden when
   *  empty (legacy sagas) or identical to the title (system == practice). */
  titleTranslation?: string;
  teaser: string;
  /** LIFE-GOAL-5: the saga goal + its named day, stated ONCE, here. This is
   *  the only place the goal is spelled out unprompted — after this it lives
   *  behind the header's count chip (`LIFE-GOAL-6`). */
  goal?: { text: string; when: string } | null;
  /** LIFE-GOAL-5: the first near objective, so the player leaves this screen
   *  knowing what to actually DO, not only what the story is about. */
  firstObjective?: string | null;
  tone: string;
  onBegin: () => void;
};

export function WorldIntroScreen({
  title,
  titleTranslation,
  teaser,
  goal,
  firstObjective,
  tone,
  onBegin,
}: WorldIntroScreenProps) {
  const t = useT();
  return (
    <div
      data-testid="LifeScreen-WorldIntro"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-(--z-life-overlay) flex items-center justify-center p-4 pb-safe-bottom pt-safe-top bg-(--color-bg)/85 backdrop-blur-sm animate-in fade-in duration-300"
    >
      {/* LIFE-UI-15: `max-h-full` resolves against the safe-area-padded shell,
          so a long saga teaser scrolls inside the card instead of running the
          card off the screen. */}
      <div className="max-w-md w-full max-h-full overflow-y-auto overscroll-contain rounded-2xl bg-(--color-bg-elevated) border border-(--color-border) shadow-xl p-6 flex flex-col gap-4 animate-in slide-in-from-bottom-4 duration-300">
        <div className="flex items-center gap-1.5 text-(--color-fg-muted) text-[11px] uppercase font-semibold tracking-wider">
          <Sparkles size={12} className="text-(--color-accent)" />
          <span>{t('life.intro.eyebrow')}</span>
        </div>
        <div>
          <h2 className="text-2xl font-semibold leading-tight text-gradient-accent">
            {title}
          </h2>
          {titleTranslation && titleTranslation !== title && (
            <p
              data-testid="LifeScreen-WorldIntro-TitleTranslation"
              className="mt-1 text-sm text-(--color-fg-muted)"
            >
              {titleTranslation}
            </p>
          )}
          <p className="mt-1 text-xs italic text-(--color-fg-muted)">{tone}</p>
        </div>
        <p className="text-sm text-(--color-fg) leading-relaxed">{teaser}</p>
        {/* LIFE-GOAL-5 — the goal, stated once, on the screen the player is
            already reading before their first turn. Everything after this is
            behind the count chip, which is the owner's call: chrome stays out
            of the story. Absent goal ⇒ absent block (every world made before
            this shipped), never an empty heading. */}
        {goal?.text?.trim() ? (
          <div
            data-testid="LifeScreen-WorldIntro-Goal"
            className="rounded-xl border border-(--color-border) p-3"
          >
            <p className="text-[10px] uppercase font-semibold tracking-wider text-(--color-fg-muted)">
              {t('life.goal.introLabel')}
            </p>
            <p className="mt-1 text-sm text-(--color-fg)">{goal.text}</p>
            <p className="mt-0.5 text-xs text-(--color-fg-muted)">
              {t('life.goal.by', { when: goal.when })}
            </p>
            {firstObjective?.trim() ? (
              <p
                className="mt-2 text-sm text-(--color-fg)"
                data-testid="LifeScreen-WorldIntro-FirstObjective"
              >
                {t('life.goal.startWith', { what: firstObjective })}
              </p>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          onClick={onBegin}
          data-testid="LifeScreen-WorldIntro-Begin"
          className="mt-2 w-full py-3 rounded-full text-sm font-semibold bg-gradient-accent text-white"
        >
          {t('life.intro.begin')}
        </button>
      </div>
    </div>
  );
}
