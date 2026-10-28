/**
 * LIFE-WORLD-*: a single world card on the overview screen.
 *
 * Renders: scene-thumbnail banner (LIFE-WORLD-9 — read-only reuse of
 * the world's persisted scene SVG, absent for fresh worlds), character
 * name, current location label, practice language, and a chapter-status
 * line driven by `currentArc`. Tap → open the world. Three-dot menu
 * offers Delete. The streak is GLOBAL (LIFE-STREAK-4) and no longer
 * shown per-card — it lives in the overview header.
 *
 * Spec: docs/specs/life-sim.md §10.6 (LIFE-WORLD-*).
 */
import { useState } from 'react';
import { useOverlayBack } from '@/hooks/useOverlayBack';
import { useI18nStore } from '@/i18n/store';
import { localizedLanguageName } from '@/lib/languages';
import { MoreVertical, X, BookOpen, MapPin, ChevronDown, ChevronUp, User } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { useWorldThumbnail } from './useWorldThumbnail';
import { svgCover } from '@/lib/life/svgCover';
import type { LifeWorld, WorldSeedKey } from '@/types/firestore';

export type WorldCardProps = {
  world: LifeWorld;
  onOpen: () => void;
  onDelete: () => void;
  deleting?: boolean;
};

export function WorldCard({ world, onOpen, onDelete, deleting }: WorldCardProps) {
  const t = useT();
  const locale = useI18nStore((st) => st.locale);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // NAV-OVERLAY-2 — Android back closes this overlay before it leaves the page.
  useOverlayBack(confirming, () => {
    if (!deleting) setConfirming(false);
  });
  const [sagaOpen, setSagaOpen] = useState(false);
  const teaser = world.saga?.playerFacingTeaser?.trim() ?? '';
  const { svg: thumbSvg } = useWorldThumbnail(world);

  return (
    <div
      data-testid="LifeOverview-WorldCard"
      className="relative rounded-2xl bg-(--color-bg-elevated) border border-(--color-border) shadow-sm overflow-hidden"
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={!!deleting}
        className="w-full text-left flex flex-col hover:bg-(--color-bg-hover) active:scale-[0.99] transition disabled:opacity-50"
      >
        {/* LIFE-WORLD-9: scene-thumbnail banner. Read-only reuse of the
            world's persisted scene SVG — never triggers generation.
            null (fresh world, no currentBackdrop) → no banner at all; the
            card stays compact. Decorative (aria-hidden): the text rows
            below carry the meaning, same as BackdropStage. */}
        {thumbSvg !== null && (
          <div
            data-testid="LifeOverview-WorldCard-Thumb"
            aria-hidden
            className="relative h-24 w-full shrink-0 overflow-hidden rounded-t-2xl"
          >
            {/* LIFE-WORLD-9.1: COVER the strip. The sizing classes stretch the
                element box, but an inline <svg> still letterboxes its viewBox
                inside that box unless preserveAspectRatio says otherwise — so
                the artwork rendered as a small square in the middle. Applied
                here and not in the hook: BackdropStage shows the same SVG at full
                size, where fitting is correct and cropping would cut the scene. */}
            <div
              className="absolute inset-0 [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
              dangerouslySetInnerHTML={{ __html: svgCover(thumbSvg) }}
            />
            {/* Bottom scrim so the artwork fades cleanly into the card
                content below and the title row reads against a calm
                edge in both themes. */}
            <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/25 to-transparent" />
          </div>
        )}
        <div className="p-4 flex flex-col gap-1.5">
          {/* Title row: saga title (falls back to setting label until the
              saga lands) + meta. Reserve 2rem on the right so the
              absolute-positioned 3-dot menu doesn't overlap the chip. */}
          <div className="flex items-start justify-between gap-2 pr-8">
            <div className="min-w-0">
              <div className="text-base font-semibold text-gradient-accent truncate">
                {world.saga?.title?.trim() || describeSetting(world, t)}
              </div>
              {/* LIFE-WORLD-17: the wurld's name in the player's own language,
                  the same pairing WorldIntroScreen shows. Hidden when the saga
                  predates the field or the two strings are the same word —
                  "Marseille / Marseille" is noise, not a translation. */}
              {titleNative(world) && (
                <div
                  data-testid="LifeOverview-WorldCard-TitleNative"
                  className="text-xs text-(--color-fg-muted) truncate"
                >
                  {titleNative(world)}
                </div>
              )}
            </div>
            {/* LIFE-STREAK-4: the per-world flame badge was REMOVED — the
                streak is now GLOBAL and lives in the Wurlds overview
                header, not on each card. */}
            <div className="flex items-center gap-1 text-xs font-semibold text-(--color-fg-muted) shrink-0">
              {/* I18N-EDGE-5 — a label chip, so the variant stays. */}
              <span>
                {localizedLanguageName(world.practiceLanguage, locale, { style: 'label' })}
              </span>
            </div>
          </div>
          {/* Character row: who the player is playing in this world. */}
          <div className="inline-flex items-center gap-1.5 text-xs text-(--color-fg-muted) truncate">
            <User size={11} className="text-(--color-fg-muted) shrink-0" />
            <span className="truncate">{world.characterName}</span>
          </div>
          {/* Location with pin icon, only when set. */}
          {world.currentLocationLabel && (
            <div className="inline-flex items-center gap-1.5 text-xs text-(--color-fg-muted) truncate">
              <MapPin size={11} className="text-(--color-fg-muted) shrink-0" />
              <span className="truncate">{world.currentLocationLabel}</span>
            </div>
          )}
          {/* Story line: the saga's spoiler-safe teaser. The main hook
              the player sees for the world. Line-clamped so the card
              doesn't blow out when the teaser is 3 sentences. Falls back
              to a stub when the saga is still being generated. */}
          <div className="mt-1 inline-flex items-start gap-1.5 text-xs text-(--color-fg)">
            <BookOpen size={11} className="text-(--color-accent) mt-0.5 shrink-0" />
            <span className="leading-snug line-clamp-3">
              {teaser || t('life.overview.story.pending')}
            </span>
          </div>
        </div>
      </button>

      {/* Chapter strip: the chapter number is always visible (compact
          context), but the chapter premise / status detail is tucked
          behind the toggle. */}
      <div className="border-t border-(--color-border)">
        <button
          type="button"
          data-testid="LifeOverview-WorldCard-ChapterToggle"
          onClick={(e) => {
            e.stopPropagation();
            setSagaOpen((v) => !v);
          }}
          className="w-full px-4 py-2 flex items-center justify-between text-xs font-semibold text-(--color-fg-muted) hover:bg-(--color-bg-hover)"
        >
          <span>{describeChapterBadge(world, t)}</span>
          {sagaOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {sagaOpen && (
          <div className="px-4 pb-4 pt-1 text-sm leading-relaxed text-(--color-fg)">
            {describeChapterPremise(world, t)}
          </div>
        )}
      </div>

      <button
        type="button"
        data-testid="LifeOverview-WorldCard-Menu"
        aria-label={t('life.overview.cardMenu')}
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(true);
        }}
        className={cn(
          'absolute top-2 right-2 p-1.5 rounded-full hover:bg-(--color-bg-hover) text-(--color-fg-muted)',
          // Over the thumbnail banner the muted icon can vanish into the
          // artwork — give it a translucent chip for contrast.
          thumbSvg !== null && 'bg-(--color-bg)/70 backdrop-blur-sm text-(--color-fg)',
        )}
      >
        <MoreVertical size={16} />
      </button>

      {menuOpen && (
        <div className="absolute inset-0 z-10">
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/10"
          />
          <div className="absolute right-3 top-10 min-w-[180px] rounded-xl bg-(--color-bg-elevated) border border-(--color-border) shadow-lg py-1">
            <button
              type="button"
              role="menuitem"
              data-testid="LifeOverview-WorldCard-Delete"
              onClick={() => {
                setConfirming(true);
                setMenuOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-(--color-bg-hover)"
            >
              {t('life.overview.cardDelete')}
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <div
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
          <div className="relative w-full max-w-md rounded-2xl bg-(--color-bg-elevated) border border-(--color-border) shadow-xl p-5">
            <button
              type="button"
              onClick={() => !deleting && setConfirming(false)}
              aria-label={t('common.close')}
              disabled={!!deleting}
              className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-(--color-bg-hover) text-(--color-fg-muted)"
            >
              <X size={16} />
            </button>
            <h2 className="text-base font-semibold text-(--color-fg)">
              {t('life.overview.deleteConfirm.title', { name: world.characterName })}
            </h2>
            <p className="mt-2 text-sm text-(--color-fg-muted) leading-relaxed">
              {t('life.overview.deleteConfirm.body')}
            </p>
            <div className="mt-5 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={!!deleting}
                className="px-4 py-2 rounded-full text-sm text-(--color-fg) bg-(--color-bg-hover) disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onDelete();
                }}
                disabled={!!deleting}
                data-testid="LifeOverview-WorldCard-DeleteConfirm"
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
    </div>
  );
}

/**
 * LIFE-WORLD-17 — the native title, or '' when there is nothing worth showing.
 *
 * Suppressed in three cases, all of which would otherwise print a second line
 * that says nothing: a legacy saga (`titleNative: ''`); a title that reads the
 * same in both languages; and a saga with a gloss but no title, where the
 * heading has already fallen back to the setting label — showing the
 * translation under THAT would claim the wurld is called something it is not.
 */
function titleNative(world: LifeWorld): string {
  const title = world.saga?.title?.trim() ?? '';
  const native = world.saga?.titleNative?.trim() ?? '';
  if (!title || !native) return '';
  return native.toLowerCase() === title.toLowerCase() ? '' : native;
}

/** Short "what kind of world" label derived from the seed. For
 *  manual seeds, prefer the user's own text (capped). */
function describeSetting(
  world: LifeWorld,
  t: ReturnType<typeof useT>,
): string {
  if (world.worldSeedKey === 'manual' && world.worldSeedText) {
    const text = world.worldSeedText.trim();
    return text.length > 80 ? `${text.slice(0, 80).trim()}…` : text;
  }
  const map: Record<WorldSeedKey, string> = {
    city_life: t('life.overview.setting.city_life'),
    studying_abroad: t('life.overview.setting.studying_abroad'),
    work_abroad: t('life.overview.setting.work_abroad'),
    family_country: t('life.overview.setting.family_country'),
    farm_life: t('life.overview.setting.farm_life'),
    retired_village: t('life.overview.setting.retired_village'),
    restaurant: t('life.overview.setting.restaurant'),
    local_team: t('life.overview.setting.local_team'),
    hostel: t('life.overview.setting.hostel'),
    magic_university: t('life.overview.setting.magic_university'),
    noir_detective: t('life.overview.setting.noir_detective'),
    alien_invasion: t('life.overview.setting.alien_invasion'),
    frontier_colony: t('life.overview.setting.frontier_colony'),
    sea_voyage: t('life.overview.setting.sea_voyage'),
    pilgrim_town: t('life.overview.setting.pilgrim_town'),
    outlaw_trail: t('life.overview.setting.outlaw_trail'),
    heist: t('life.overview.setting.heist'),
    haunted_house: t('life.overview.setting.haunted_house'),
    surprise: t('life.overview.setting.surprise'),
    manual: t('life.overview.setting.manual'),
  };
  return map[world.worldSeedKey];
}

/** Just the "Chapter N" label. The premise goes next to it via
 *  describeChapterPremise so we don't double up on the chapter
 *  number when the model echoes "Chapter N: ..." in its premise. */
function describeChapterBadge(
  world: LifeWorld,
  t: ReturnType<typeof useT>,
): string {
  const arc = world.currentArc;
  const completedCount = world.completedArcCount ?? 0;
  if (arc && arc.status === 'active') {
    return t('life.overview.chapter.number', { number: arc.chapterNumber });
  }
  if (completedCount > 0) {
    return t('life.overview.chapter.readyBadge', { number: completedCount + 1 });
  }
  return t('life.overview.chapter.startBadge');
}

/** The chapter's premise line, with any leading "Chapter N:" /
 *  "Chapter N -" prefix the model emitted stripped so we don't show
 *  the chapter number twice (it's already in the badge). */
function describeChapterPremise(
  world: LifeWorld,
  t: ReturnType<typeof useT>,
): string {
  const arc = world.currentArc;
  if (arc && arc.status === 'active') {
    // LIFE-WORLD-ARC-REGISTER: the card is PLAYER-facing — show the spoiler-safe
    // playerTeaser, falling back to the planner premise for legacy arcs.
    return stripChapterPrefix(arc.playerTeaser?.trim() || arc.premise);
  }
  if ((world.completedArcCount ?? 0) > 0) {
    return t('life.overview.chapter.readyPremise');
  }
  return t('life.overview.chapter.startPremise');
}

function stripChapterPrefix(s: string): string {
  // Matches "Chapter 1:", "Chapter 2 -", "Chapter 3 —" (etc.) at the
  // very start, case-insensitive. Followed by optional whitespace.
  return s.replace(/^chapter\s+\d+\s*[-—:]\s*/i, '').trim();
}
