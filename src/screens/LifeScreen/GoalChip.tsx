/**
 * LIFE-GOAL-6 — the ONE piece of goal chrome that is always on screen.
 *
 * Owner's call, and it is deliberately lighter than the v2 branch's permanent
 * ribbon: *"only put the goal in an opening modal. Show a deadline icon with
 * '12 days' — if clicked it could list the goals."*
 *
 * Why an icon and not a banner. v1's chrome stance keeps mechanics out of the
 * story — the location pill, the eye, the ⋯ menu are all one glyph each — and
 * v2's own `C6` warns that a second countable thing on screen is *"what made v1
 * unreadable"*. A count is one countable thing; the goal text beside it, every
 * turn, forever, is a second.
 *
 * **The cost of that, stated because it is real:** a bare "12 days" means
 * nothing to a player who has forgotten what it counts, which is a mild version
 * of the symptom this whole feature exists to fix. `LIFE-GOAL-8` is what pays
 * it — `SceneCompleteScreen` restates the live objective every scene, on a
 * surface the player is already reading. This chip is the reminder that a clock
 * exists; that screen is what keeps it meaningful.
 */
import { useState } from 'react';
import { useOverlayBack } from '@/hooks/useOverlayBack';
import { CalendarClock, Check, X } from 'lucide-react';
import { useT } from '@/i18n';
import { daysLeft, type GoalLadder } from '@/lib/life/goalLadder';
import type { GoalLadderDoc } from '@/types/lifeGoal';

export type GoalChipProps = {
  ladder: GoalLadderDoc | null | undefined;
};

export function GoalChip({ ladder }: GoalChipProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // NAV-OVERLAY-2 — Android back closes this overlay before it leaves the page.
  useOverlayBack(open, () => setOpen(false));

  // A world with no saga goal renders NOTHING rather than a zero. Every world
  // made before this shipped is such a world, and a "0 days" badge on a story
  // with no deadline would be worse than no badge at all.
  const left = ladder
    ? daysLeft({
        saga: ladder.saga ?? null,
        objective: null,
        done: [],
        dayIndex: ladder.dayIndex ?? 0,
      } as GoalLadder)
    : null;
  if (left === null || !ladder?.saga) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="LifeScreen-GoalChip"
        aria-label={t('life.goal.chipAria')}
        title={ladder.saga.text}
        className="flex items-center gap-1 rounded-full px-2 py-1 text-xs
                   text-(--color-fg-muted) hover:text-(--color-fg)"
      >
        <CalendarClock size={16} />
        {/* tabular-nums so the chip does not jiggle as the count ticks down */}
        <span className="tabular-nums">{t('life.goal.daysLeft', { count: left })}</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setOpen(false)}
          data-testid="LifeScreen-GoalSheet-Backdrop"
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-(--color-bg) p-4 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            data-testid="LifeScreen-GoalSheet"
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-(--color-fg)">
                {t('life.goal.sheetTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('common.close')}
                className="p-1 text-(--color-fg-muted) hover:text-(--color-fg)"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-base text-(--color-fg)">{ladder.saga.text}</p>
            <p className="mt-1 text-xs text-(--color-fg-muted)">
              {t('life.goal.by', { when: ladder.saga.when })} ·{' '}
              {t('life.goal.daysLeft', { count: left })}
            </p>

            {ladder.objective ? (
              <div className="mt-4">
                <p className="text-xs uppercase tracking-wide text-(--color-fg-muted)">
                  {t('life.goal.nowLabel')}
                </p>
                <p
                  className="mt-1 text-base text-(--color-fg)"
                  data-testid="LifeScreen-GoalSheet-Objective"
                >
                  {ladder.objective.text}
                </p>
              </div>
            ) : null}

            {(ladder.done ?? []).length > 0 ? (
              <ul className="mt-4 space-y-1" data-testid="LifeScreen-GoalSheet-Done">
                {(ladder.done ?? []).slice(-6).map((d, i) => (
                  <li
                    key={`${d.text}-${i}`}
                    className="flex items-start gap-2 text-sm text-(--color-fg-muted)"
                  >
                    {/* LIFE-GOAL-3: a CLOSED objective is not a failure state and
                        must not read as one — it is the world moving on, with a
                        reason. Different glyph, same muted row. */}
                    {d.how === 'done' ? (
                      <Check size={14} className="mt-1 shrink-0" />
                    ) : (
                      <X size={14} className="mt-1 shrink-0" />
                    )}
                    <span>
                      {d.text}
                      {d.because ? ` — ${d.because}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
