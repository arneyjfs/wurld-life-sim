/**
 * MSG-VIEW-7 / LIFE-LANG-3 — the view-settings sheet, shared by the chat
 * screen and the life sim.
 *
 * One sheet, two surfaces. The life sim renders exactly this minus the last
 * two rows (apply-across-all-chats and the per-chat language override), which
 * are the only chat-specific things in it — passed as `chatExtras` rather than
 * branched on a screen name, so the component has no idea which screen it is
 * on and neither surface can drift from the other.
 *
 * Layout, top → bottom:
 *   1. MAIN ROW radio group — practice / native, each with a description.
 *      Labels are the REAL language names. (A third option, Mixed / easy
 *      mode, was retired — MSG-VIEW-7.12.)
 *   2. SHOW SECOND ROW — the same toggle the header eye drives, repeated here
 *      with a description. The eye is the shortcut; this is where it is
 *      explained.
 *   3. `chatExtras` — chat only.
 *
 * The eye in the header and this row are the SAME state deliberately: a
 * control that appears in two places must not have two meanings.
 */
import { type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { cn } from '@/lib/cn';
import { getBaseLanguageName, localizedLanguageName } from '@/lib/languages';
import { useT } from '@/i18n';
import { useI18nStore } from '@/i18n/store';
import {
  secondRowLanguage,
  type PrimaryRow,
  type ViewSettings,
} from '@/lib/viewSettings';
import { haptics } from '@/lib/haptics';

type RowsProps = {
  settings: ViewSettings;
  onChange: (next: ViewSettings) => void;
  practiceLanguage: string | undefined;
  nativeLanguage: string | undefined;
  /** MSG-VIEW-7.10 — the route to the chat's LANGUAGES, rendered directly under
   *  the radio group. Injected rather than branched (MSG-VIEW-7.6): it points at
   *  `/chat/:id/info`, which the life sim has no equivalent of, and the life sim
   *  passes nothing. */
  languagesLink?: ReactNode;
};

type Props = RowsProps & {
  open: boolean;
  onClose: () => void;
  /** Chat-only rows (apply-across-all-chats). The per-chat language row that
   *  used to live here became `languagesLink` above when LANG-SET-8 moved the
   *  pickers to the chat info screen. The life sim passes nothing. */
  chatExtras?: ReactNode;
  /** COMP-KB-25.4 — the backdrop tap that closes the sheet. */
  onOverlayTap?: () => void;
};

/**
 * The rows themselves, with no container of their own — the shared surface.
 *
 * Split out because the two screens do NOT share a menu container: chat opens
 * a dedicated bottom sheet for view settings, while the life sim already had a
 * ⋯ dropdown carrying the wurld's own actions (difficulty, exit, delete) and
 * a second ⋯ beside it would be nonsense. What has to be identical is the
 * copy and the semantics, which is exactly what lives here.
 */
export function ViewSettingsRows({
  settings,
  onChange,
  practiceLanguage,
  nativeLanguage,
  languagesLink,
}: RowsProps) {
  const t = useT();
  const locale = useI18nStore((s) => s.locale);
  // Strip the parenthetical qualifier then localise, so a British-English
  // reader sees "English" rather than the database canonical
  // "English (British)" in a sentence.
  const native = localizedLanguageName(
    getBaseLanguageName(nativeLanguage ?? 'English'),
    locale,
  );
  const practice = practiceLanguage
    ? localizedLanguageName(getBaseLanguageName(practiceLanguage), locale)
    : native;

  const secondLang = secondRowLanguage(settings);
  const secondLangName = secondLang === 'native' ? native : practice;

  const options: Array<{ value: PrimaryRow; label: string; desc: string }> = [
    {
      value: 'practice',
      label: t('view.settings.mainRowPractice', { practice }),
      desc: t('view.settings.mainRowPracticeDesc', { practice }),
    },
    {
      value: 'native',
      label: t('view.settings.mainRowNative', { native }),
      desc: t('view.settings.mainRowNativeDesc', { native }),
    },
  ];

  return (
    <>
      {/* MSG-VIEW-7.3 / 7.10 — the heading, with the route to the chat's
          languages pinned to its right. They share a row because they are about
          the same thing and neither needs a full line: the rows below say
          "English first", and this says which languages those names come from.
          The link was a full-width row with a subtitle naming both languages
          until 2026-09-18 — the longest line on the sheet, for the one control
          that only navigates. */}
      <div className="flex items-baseline gap-3 px-4 pt-1 pb-1">
        <h3
          data-testid="ViewSettings-primary-heading"
          className="flex-1 min-w-0 text-xs font-semibold uppercase tracking-wide text-(--color-fg-muted)"
        >
          {t('view.settings.mainRowHeading')}
        </h3>
        {languagesLink}
      </div>
      <div
        role="radiogroup"
        aria-label={t('view.settings.mainRow')}
        data-testid="ViewSettings-primary-group"
        className="px-1"
      >
        {options.map((o) => {
          const selected = settings.primary === o.value;
          return (
            <div key={o.value}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`ViewSettings-primary-${o.value}`}
                onClick={() => onChange({ ...settings, primary: o.value })}
                className="flex w-full items-start gap-3 px-3 py-3 text-left rounded-md hover:bg-(--color-bg-hover)"
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 transition-colors',
                    selected
                      ? 'border-(--color-accent-strong) bg-(--color-accent-strong) ring-2 ring-inset ring-(--color-bg)'
                      : 'border-(--color-border)',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-(--color-fg-muted)">
                    {o.desc}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="border-t border-(--color-border)" />

      <button
        type="button"
        role="switch"
        aria-checked={settings.secondRow}
        data-testid="ViewSettings-second-row"
        onClick={() => {
          void haptics.selection(); // CHROME-HAPTIC-2
          onChange({ ...settings, secondRow: !settings.secondRow });
        }}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-(--color-bg-hover)"
      >
        {/* MSG-VIEW-7.4 — the same glyph the header eye shows. The row and
            the header are one state, so they have to LOOK like one state. */}
        {settings.secondRow ? (
          <Eye
            size={18}
            aria-hidden
            data-testid="ViewSettings-second-row-icon"
            data-open="true"
            className="shrink-0 text-(--color-fg-muted)"
          />
        ) : (
          <EyeOff
            size={18}
            aria-hidden
            data-testid="ViewSettings-second-row-icon"
            data-open="false"
            className="shrink-0 text-(--color-fg-muted)"
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {t('view.settings.secondRow')}
          </span>
          <span className="block text-xs text-(--color-fg-muted)">
            {settings.secondRow
              ? t('view.settings.secondRowOnDesc', { language: secondLangName })
              : t('view.settings.secondRowOffDesc', { language: secondLangName })}
          </span>
        </span>
        <span
          aria-hidden
          className={cn(
            'relative h-6 w-10 shrink-0 rounded-full transition-colors',
            settings.secondRow ? 'bg-(--color-accent-strong)' : 'bg-(--color-border)',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all',
              settings.secondRow ? 'left-[18px]' : 'left-0.5',
            )}
          />
        </span>
      </button>

    </>
  );
}

export function ViewSettingsSheet({
  open,
  onClose,
  onOverlayTap,
  chatExtras,
  ...rows
}: Props) {
  const t = useT();
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      onOverlayTap={onOverlayTap}
      ariaLabel={t('view.settings.heading')}
      desktopWidthClass="sm:max-w-sm"
    >
      <h2
        className="px-4 pt-1 pb-2 text-base font-semibold text-(--color-fg)"
        data-testid="ViewSettings-heading"
      >
        {t('view.settings.heading')}
      </h2>
      <ViewSettingsRows {...rows} />
      {chatExtras}
    </BottomSheet>
  );
}
