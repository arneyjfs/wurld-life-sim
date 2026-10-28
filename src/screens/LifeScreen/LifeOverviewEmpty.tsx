/**
 * Empty-state for the LifeOverviewScreen — a landing hero that
 * explains the concept + shows illustrative example worlds so a
 * brand-new user feels the range of "what could you live".
 *
 * The sample cards are NOT selectable. Tapping any of them routes
 * to onboarding — the player picks their own seed there.
 *
 * LIFE-WORLD-12: the sample cards are THEME-AWARE. They wear the same
 * surface as a real `WorldCard` (--color-bg-elevated + --color-border +
 * --color-fg/-muted text); their per-world identity comes from a low
 * -opacity tint of `sample.tint` mixed over that surface, never from an
 * opaque fill. See docs/specs/life-sim.md §10.6.
 */
import type { CSSProperties } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useI18nStore } from '@/i18n/store';
import { localizedLanguageName } from '@/lib/languages';
import { SAMPLE_WORLDS } from './overviewSamples';

/** The sample's hue mixed down to `pct`% — the rest is left transparent
 *  so whatever themed surface sits underneath shows through. */
function tint(pct: number): string {
  return `color-mix(in srgb, var(--sample-tint) ${pct}%, transparent)`;
}

export function LifeOverviewEmpty() {
  const t = useT();
  const locale = useI18nStore((st) => st.locale);
  const navigate = useNavigate();
  return (
    <div
      data-testid="LifeOverview-Empty"
      className="page-measure px-4 flex flex-col gap-6 pt-4 pb-4"
    >
      {/* Hero */}
      <div className="flex flex-col items-center text-center gap-3 py-6">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] uppercase font-semibold tracking-wider text-(--color-fg-muted) bg-(--color-bg-elevated) border border-(--color-border)">
          <Sparkles size={11} className="text-(--color-accent)" />
          {t('life.overview.empty.eyebrow')}
        </div>
        <h1 className="text-3xl font-semibold leading-tight">
          <span className="text-gradient-accent">
            {t('life.overview.empty.title')}
          </span>
        </h1>
        <p className="text-sm text-(--color-fg-muted) leading-relaxed max-w-xs">
          {t('life.overview.empty.body')}
        </p>
      </div>

      {/* Imagined-worlds section */}
      <div className="flex flex-col gap-3">
        <div className="text-[11px] uppercase font-semibold tracking-wider text-(--color-fg-muted) px-1">
          {t('life.overview.empty.couldBe')}
        </div>
        <div className="flex flex-col gap-2">
          {SAMPLE_WORLDS.map((w, i) => (
            <button
              key={i}
              type="button"
              onClick={() => navigate('/wurlds/start')}
              data-testid="LifeOverview-Sample"
              // The hue enters the card as ONE custom property; every
              // layer below mixes it over a themed surface rather than
              // painting it. Nothing here is theme-specific.
              style={
                {
                  '--sample-tint': w.tint,
                  borderColor: `color-mix(in srgb, var(--sample-tint) 32%, var(--color-border))`,
                } as CSSProperties
              }
              className="group relative rounded-2xl p-4 text-left overflow-hidden bg-(--color-bg-elevated) border shadow-sm hover:shadow-md active:scale-[0.99] transition"
            >
              {/* The tint wash. Sits BETWEEN the themed surface and the
                  content: never fully transparent (so the whole card
                  carries the hue, not just one corner) and never opaque
                  (so --color-fg text keeps its contrast in both themes). */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `linear-gradient(150deg, ${tint(20)} 0%, ${tint(8)} 100%)`,
                }}
              />
              <div className="relative flex items-start gap-3">
                {/* Emoji medallion — the strongest statement of the hue on
                    the card, still a mix rather than a fill. */}
                <span
                  aria-hidden
                  className="shrink-0 grid place-items-center size-9 rounded-xl text-lg leading-none"
                  style={{
                    background: tint(22),
                    boxShadow: `inset 0 0 0 1px ${tint(38)}`,
                  }}
                >
                  {w.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-(--color-fg)">
                    {w.title}
                  </div>
                  <div className="mt-1 text-xs text-(--color-fg-muted) leading-relaxed">
                    {w.premise}
                  </div>
                  <div className="mt-2 inline-flex items-center gap-1 text-[10px] uppercase font-semibold tracking-wider text-(--color-fg-muted)">
                    {/* I18N-EDGE-5 — `overviewSamples` stores the CANONICAL
                        English name, because it is data the rest of the app
                        matches on. A label chip is its display form, and it
                        has to be the reader's. */}
                    {localizedLanguageName(w.language, locale, { style: 'label' })}
                    <ArrowRight
                      size={10}
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    />
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
        <p className="text-[11px] italic text-(--color-fg-muted) px-1">
          {t('life.overview.empty.samplesHint')}
        </p>
      </div>
    </div>
  );
}
