/**
 * Small "how worlds work" explainer block rendered under the world
 * list on the populated overview state. Three short bullet-points
 * that anchor the concept for return visits without taking over the
 * screen.
 */
import { BookOpen, Users, Layers } from 'lucide-react';
import { useT } from '@/i18n';

export function LifeOverviewExplainer() {
  const t = useT();
  return (
    <div
      data-testid="LifeOverview-Explainer"
      className="mt-6 max-w-md mx-auto rounded-2xl bg-(--color-bg-elevated) border border-(--color-border) p-4"
    >
      <div className="text-[11px] uppercase font-semibold tracking-wider text-(--color-fg-muted) mb-2">
        {t('life.overview.explainer.title')}
      </div>
      <ul className="flex flex-col gap-2.5 text-sm text-(--color-fg) leading-snug">
        <li className="flex items-start gap-2">
          <BookOpen
            size={14}
            className="text-(--color-accent) mt-0.5 shrink-0"
          />
          <span>{t('life.overview.explainer.chapters')}</span>
        </li>
        <li className="flex items-start gap-2">
          <Users
            size={14}
            className="text-(--color-accent) mt-0.5 shrink-0"
          />
          <span>{t('life.overview.explainer.recurring')}</span>
        </li>
        <li className="flex items-start gap-2">
          <Layers
            size={14}
            className="text-(--color-accent) mt-0.5 shrink-0"
          />
          <span>{t('life.overview.explainer.parallel')}</span>
        </li>
      </ul>
    </div>
  );
}
