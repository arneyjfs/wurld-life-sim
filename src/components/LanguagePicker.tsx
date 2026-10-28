import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Search, Sparkles, VolumeX, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  SUPPORTED_LANGUAGES,
  getLanguageFlag,
  getLanguageRegion,
  isSpeechSupported,
  localizedLanguageName,
} from '@/lib/languages';
import {
  useLanguageRecentsStore,
  type LanguageBucket,
} from '@/store/languageRecentsStore';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Avatar } from '@/components/Avatar/Avatar';
import { hideKeyboard } from '@/lib/keyboardInset';
import { useT } from '@/i18n';
import { useI18nStore } from '@/i18n/store';

/** I18N-12 — one row of a picker that is NOT over the chat languages (the UI locales). */
export type PickerOption = { value: string; label: string; hint?: string };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Currently selected language name. Used for the checkmark + recents filter. */
  value: string | undefined;
  onChange: (language: string) => void;
  /** Title shown at the top of the picker. */
  title?: string;
  /** Recents bucket — keeps "native / practice / chat" lists separate. */
  bucket?: LanguageBucket;
  /**
   * Extra suggestions to surface in the Recent row (e.g. languages active
   * in other chats — caller passes those in).
   */
  extraRecents?: string[];
  /**
   * LANG-SET — the languages this chat offers, when the picker is constrained.
   *
   * `undefined` means UNCONSTRAINED: a subscriber, or any call site that has
   * nothing to do with a chat. An EMPTY array also means unconstrained, and
   * that is deliberate rather than sloppy — `chatLanguageOptions` returns `[]`
   * when the server has not computed the chat's targets yet, which is
   * "unknown", not "no languages". Rendering an empty picker to somebody whose
   * chat simply has not synced would be a bug dressed as a constraint, so the
   * safe direction is to over-offer for that moment.
   */
  availableLanguages?: string[];
  /** Shown as the way out when a search finds nothing in the chat's set. */
  onRequestUpgrade?: () => void;
  /** LANG-LEARNWITH-11 — the second line of each FREE row ("Included in
   *  Tom's Plus"), keyed by language. */
  freeHints?: Record<string, string>;
  /** LANG-LEARNWITH-11 — the practice picker's "No translation · Just
   *  {native}" row: the reading language, written as an equal pair. Never
   *  listed a second time as an ordinary row. */
  noTranslation?: string;
  /** Its display name, for "Just {native}". */
  noTranslationName?: string;
  /** LANG-LEARNWITH-11 — the member's own language: first in the Plus group,
   *  greyed like the rest, and named by the upgrade notice. */
  ownLanguage?: string;
  ownLanguageName?: string;
  /**
   * LANG-SET-1 — WHO is paying for each language in `availableLanguages`,
   * from `chatLanguageHolders`. Their avatars sit on the row, which is the
   * answer to a question the constrained picker never used to address: not
   * "why is this list short" but "who would I be learning WITH".
   *
   * Optional, and absent is not an error: the unconstrained picker has no
   * room to speak of, and a caller that has the pool but not the profiles
   * gets a correct list with no faces rather than nothing.
   */
  languageHolders?: Record<string, ReadonlyArray<{
    uid: string;
    name: string;
    photoUrl?: string | undefined;
  }>>;
  /**
   * I18N-12 — the SAME sheet over a list that is not the chat languages (the
   * App language row passes `SUPPORTED_LOCALES`). Rows show `label` and
   * `hint`, no flag, no region or speech line; there is no Recent row and a
   * pick never touches the chat-language recents. `value` / `onChange` speak
   * the option's `value`.
   */
  options?: ReadonlyArray<PickerOption>;
};

/**
 * Bottom-sheet language picker. Source equivalent: a full-height modal with
 * a search box at top, a "Recent" pill row, and the alphabetical list of
 * supported languages with flags + region hints.
 *
 * Mounted as a swipe-to-dismiss `BottomSheet` (vaul) — the scrollable list
 * yields the vertical gesture to the sheet only once scrollTop === 0.
 */
export function LanguagePicker({
  open,
  onClose,
  value,
  onChange,
  title,
  bucket = 'native',
  extraRecents,
  availableLanguages,
  onRequestUpgrade,
  freeHints,
  noTranslation,
  noTranslationName,
  ownLanguage,
  ownLanguageName,
  languageHolders,
  options,
}: Props) {
  const t = useT();
  const locale = useI18nStore((s) => s.locale);
  const resolvedTitle = title ?? t('languagePicker.title');
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  // `bucket` is kept on the call signature so each picker call-site
  // self-documents its intent ('native' / 'practice' / 'chat'), but the
  // store now keeps a single shared list — every pick anywhere bumps
  // every picker's recents row. Users were confused by per-intent
  // silos: picking Spanish for chat left it absent from the native /
  // practice recents and felt arbitrary.
  const recents = useLanguageRecentsStore((s) => s.recents);
  const pushRecent = useLanguageRecentsStore((s) => s.pushRecent);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  // Dismiss the on-screen keyboard when the user starts a SCROLL gesture
  // anywhere outside the search input. Tap-to-pick already closes the
  // picker; this targets the "scroll to find" intent without flickering
  // the dynamic viewport mid-close.
  useEffect(() => {
    if (!open) return;
    let startedAt: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) {
        startedAt = null;
        return;
      }
      if (inputRef.current && inputRef.current.contains(t)) {
        startedAt = null;
        return;
      }
      startedAt = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!startedAt) return;
      const dx = e.clientX - startedAt.x;
      const dy = e.clientY - startedAt.y;
      if (dx * dx + dy * dy > 64) {
        hideKeyboard();
        startedAt = null;
      }
    };
    const onPointerEnd = () => {
      startedAt = null;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerEnd, true);
    document.addEventListener('pointercancel', onPointerEnd, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerEnd, true);
      document.removeEventListener('pointercancel', onPointerEnd, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery('');
  }, [open]);

  // LANG-SET — the pool this picker draws from. See `availableLanguages`:
  // absent OR empty means unconstrained.
  const constrained = !!availableLanguages && availableLanguages.length > 0;

  /**
   * LANG-SET-7 — the Recent row obeys the pool.
   *
   * ⚠ Recents come from the member's OTHER chats, so an unfiltered row routinely
   * offered languages this room cannot carry. Tapping one produced the worst
   * outcome available: the write SUCCEEDED, the UI showed the new language, and
   * the server snapped it away on the next resolve — the member's own screen
   * disagreeing with what the room would do, with nothing anywhere saying so.
   * Filtering the list while leaving a shortcut past it is not a constraint, it
   * is a trap.
   */
  const recentRow = useMemo(() => {
    const allowed = constrained ? new Set(availableLanguages) : null;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const lang of [...recents, ...(extraRecents ?? [])]) {
      if (!lang || lang === value || seen.has(lang)) continue;
      if (allowed && !allowed.has(lang)) continue;
      seen.add(lang);
      out.push(lang);
      if (out.length >= 6) break;
    }
    return out;
  }, [recents, extraRecents, value, constrained, availableLanguages]);
  /**
   * LANG-SET-7 — the room's set, as a lookup. `null` when unconstrained.
   *
   * ⚠ **It no longer FILTERS the list**, and that is the 2026-09-22 change.
   * Everything Wurld supports is rendered; what the set decides is which rows
   * are SELECTABLE. Owner: *"don't filter the rest out, disable them and put a
   * subtitle saying upgrade to select."*
   *
   * The filtered list was defensible and wrong in practice. It made the
   * picker inexplicably short, and it put the only explanation behind a search
   * for a language that is absent — so the rule was disclosed to readers who
   * had already guessed it, and to nobody else. A greyed row with a reason on
   * it turns every locked language into the explanation.
   */
  const allowed = useMemo(
    () => (constrained ? new Set(availableLanguages) : null),
    [constrained, availableLanguages],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = SUPPORTED_LANGUAGES;
    if (!q) return pool;
    // Match against BOTH the English canonical name AND the localised
    // label form, so a French-UI user typing "anglais" finds English,
    // and someone typing "English" still finds it too. The English
    // name remains the underlying value passed to onChange — only the
    // surface match changes.
    return pool.filter((l) => {
      if (l.name.toLowerCase().includes(q)) return true;
      const localised = localizedLanguageName(l.name, locale, {
        style: 'label',
      }).toLowerCase();
      return localised.includes(q);
    });
  }, [query, locale]);

  /**
   * The room's languages FIRST, everything else after — owner, 2026-09-22.
   *
   * ⚠ A stable partition, not a sort. Each half keeps `SUPPORTED_LANGUAGES`'
   * own order, so a language does not move within its group when the query
   * changes, and the alphabetical list a reader is scanning stays
   * alphabetical.
   *
   * Unconstrained, `locked` is empty and this is exactly the list that shipped
   * before.
   */
  const { open: openLangs, locked, none } = useMemo(() => {
    if (!allowed) return { open: filtered, locked: [] as typeof filtered, none: null };
    const open: typeof filtered = [];
    const locked: typeof filtered = [];
    let none: (typeof filtered)[number] | null = null;
    for (const l of filtered) {
      if (l.name === noTranslation) none = l;
      else (allowed.has(l.name) ? open : locked).push(l);
    }
    // LANG-LEARNWITH-11 — the free group in the order the caller ranked it
    // (most holders first); the Plus group with the member's own language on
    // top. Everything else stays alphabetical.
    const rank = (n: string) => availableLanguages?.indexOf(n) ?? 0;
    open.sort((a, b) => rank(a.name) - rank(b.name));
    const own = locked.findIndex((l) => l.name === ownLanguage);
    if (own > 0) locked.unshift(...locked.splice(own, 1));
    return { open, locked, none };
  }, [filtered, allowed, availableLanguages, noTranslation, ownLanguage]);

  /** LANG-LEARNWITH-11 — a Plus language opens the Plus sheet, never a pick.
   *  Closed FIRST: two stacked sheets is the bug that looks like a frozen app. */
  function requestUpgrade() {
    onClose();
    onRequestUpgrade?.();
  }

  /**
   * ONE row, for both halves of the list.
   *
   * `locked` is "this room does not carry it": rendered, greyed, and not
   * tappable. `first` marks the top of the locked group and draws the only
   * divider — there is no heading, because the two groups already differ by
   * the thing that matters (faces against one, grey against the other) and a
   * label would be a third way of saying it.
   */
  function row(
    lang: (typeof SUPPORTED_LANGUAGES)[number],
    locked: boolean,
  ) {
    const selected = lang.name === value;
    const region = getLanguageRegion(lang.name);
    const holders = languageHolders?.[lang.name] ?? [];
    return (
      <li key={lang.name}>
        <button
          type="button"
          // LANG-SET-7 / LANG-LEARNWITH-11 — a greyed row is never PICKED. The
          // write would succeed, the UI would show it, and the server would
          // snap it away on the next resolve. It opens the Plus sheet instead.
          onClick={locked ? requestUpgrade : () => handlePick(lang.name)}
          data-testid={`language-picker-row-${lang.name}`}
          data-locked={locked || undefined}
          data-free-row={(constrained && !locked) || undefined}
          className={cn(
            'flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-(--color-bg-hover)',
            locked && 'opacity-45',
            selected && !locked && 'bg-(--color-bg-hover)',
          )}
        >
          <span className="text-xl leading-none flex-shrink-0">{lang.flag}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {localizedLanguageName(lang.name, locale, { style: 'label' })}
            </div>
            {region && lang.name.indexOf('(') < 0 && (
              <div className="text-xs text-(--color-fg-muted) truncate">{region}</div>
            )}
            {/* ⚠ AFTER the region line, which is where the owner put it: the
                region is a fact about the language and this is a fact about
                your account, so the language finishes describing itself
                first. */}
            {locked && lang.name === ownLanguage && (
              <div className="text-xs text-(--color-fg-muted) truncate">{t('languagePicker.yourLanguage')}</div>
            )}
            {!locked && freeHints?.[lang.name] && (
              <div
                className="text-xs text-(--color-fg-muted) truncate"
                data-testid={`language-picker-hint-${lang.name}`}
              >
                {freeHints[lang.name]}
              </div>
            )}
            {!isSpeechSupported(lang.name) && (
              <div className="flex items-center gap-1 text-xs text-(--color-fg-muted) truncate">
                <VolumeX size={12} className="flex-shrink-0" />
                <span>{t('languagePicker.speechNotSupported')}</span>
              </div>
            )}
          </div>
          {/* LANG-SET-1 — the faces of the members whose Plus subscription is
              why this language is here. Capped at three: past that they stop
              being recognisable people and become a texture, and the row has a
              language name to protect. */}
          {holders.length > 0 && (
            <span
              className="flex flex-shrink-0 -space-x-2"
              data-testid={`language-picker-holders-${lang.name}`}
            >
              {holders.slice(0, 3).map((h) => (
                <Avatar
                  key={h.uid}
                  photoUrl={h.photoUrl}
                  name={h.name}
                  seedId={h.uid}
                  size={22}
                  className="ring-2 ring-(--color-bg-elevated)"
                />
              ))}
            </span>
          )}
          {/* LANG-LEARNWITH-11 — the small Plus mark, in place of the retired
              "Upgrade to select" line. */}
          {locked && (
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-gradient-accent text-(--color-accent-fg)"
              data-testid={`language-picker-locked-${lang.name}`}
              aria-label={t('languagePicker.plusMark')}
              role="img"
            >
              <Sparkles size={11} aria-hidden />
            </span>
          )}
          {selected && !locked && <Check size={16} className="text-(--color-accent)" />}
        </button>
      </li>
    );
  }

  /** LANG-LEARNWITH-11 — a group label inside the list. */
  function heading(text: string, testId: string) {
    return (
      <li
        key={testId}
        data-testid={testId}
        className="border-t border-(--color-border) px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-(--color-fg-muted) first:border-t-0"
      >
        {text}
      </li>
    );
  }

  /** I18N-12 — search the native name, the English hint and the code. */
  const filteredOptions = useMemo(() => {
    if (!options) return [];
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      [o.label, o.hint ?? '', o.value].some((s) => s.toLowerCase().includes(q)),
    );
  }, [options, query]);

  /** I18N-12 — the option row: same box as a language row, without the flag. */
  function optionRow(o: PickerOption) {
    const selected = o.value === value;
    return (
      <li key={o.value}>
        <button
          type="button"
          onClick={() => {
            onChange(o.value);
            onClose();
          }}
          data-testid={`language-picker-row-${o.value}`}
          aria-current={selected || undefined}
          className={cn(
            'flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-(--color-bg-hover)',
            selected && 'bg-(--color-bg-hover)',
          )}
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{o.label}</div>
            {o.hint && <div className="text-xs text-(--color-fg-muted) truncate">{o.hint}</div>}
          </div>
          {selected && <Check size={16} className="text-(--color-accent)" />}
        </button>
      </li>
    );
  }

  function handlePick(lang: string) {
    pushRecent(bucket, lang);
    onChange(lang);
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={resolvedTitle}
      // COMP-KB-21 — do NOTHING about the keyboard. This picker focuses its
      // search field on open, so the keyboard is up for essentially its whole
      // life — but that field is the FIRST thing in the sheet, so it is clear
      // of the keyboard without any compensation at all.
      //
      // Padding (`.pb-keyboard`) put a keyboard-sized empty box inside the
      // sheet, which the list — the only `flex-1 min-h-0` child — paid for.
      // Lifting (`.kb-lift`) then over-corrected on platforms that already
      // shrink the viewport, leaving a band of background under the sheet.
      // Neither compensation was ever needed here (owner report 2026-07-31),
      // at this call site or any other: every consumer of this picker gets
      // the same top-anchored search field.
      //
      // Removing them from the stylesheet was only half of it — vaul was
      // re-applying the lift from JS as an inline `bottom`, which no class can
      // beat, so the padding was still there on the wurld-onboarding call site
      // after the CSS fix (owner, 2026-07-31). `'none'` now also turns vaul's
      // `repositionInputs` off; the reasoning lives on the prop in
      // `BottomSheet.tsx`.
      keyboardInset="none"
    >
      <header className="flex items-center justify-between px-4 pt-1 pb-2 shrink-0">
        <h2 className="text-base font-semibold">{resolvedTitle}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="p-1.5 rounded-md text-(--color-fg-muted) hover:bg-(--color-bg-hover)"
        >
          <X size={18} />
        </button>
      </header>

      <div className="px-4 pb-2 shrink-0">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-(--color-fg-muted) pointer-events-none"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('languagePicker.searchPlaceholder')}
            aria-label={t('languagePicker.searchPlaceholder')}
            className="w-full pl-9 pr-3 py-2.5 rounded-full bg-(--color-bg-hover) text-(--color-fg) placeholder:text-(--color-fg-muted) outline-none focus:ring-2 focus:ring-(--color-accent)"
          />
        </div>
      </div>

      {!options && recentRow.length > 0 && !query && (
        <div className="px-4 pb-2 shrink-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-(--color-fg-muted) mb-1.5">
            {t('languagePicker.recent')}
          </div>
          <div className="flex flex-wrap gap-2">
            {recentRow.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => handlePick(lang)}
                data-testid={`language-picker-recent-${lang}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border border-(--color-border) hover:bg-(--color-bg-hover)"
              >
                <span className="text-base leading-none">{getLanguageFlag(lang)}</span>
                <span>{localizedLanguageName(lang, locale, { style: 'label' })}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <ul
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto list-none p-0 m-0 border-t border-(--color-border)"
      >
        {/* ⚠ ONE row renderer for both halves, taking `locked`. Two renderers
            is how the greyed half quietly loses the speech warning, or the
            region line, or the check mark — every one of which is just as true
            of a language you cannot pick yet. */}
        {options ? (
          filteredOptions.map((o) => optionRow(o))
        ) : (
          <>
            {constrained && (openLangs.length > 0 || none) && heading(t('languagePicker.freeHere'), 'language-picker-free-heading')}
            {openLangs.map((lang) => row(lang, false))}
            {none && (
              <li key="none">
                <button
                  type="button"
                  onClick={() => handlePick(none.name)}
                  data-testid="language-picker-row-none"
                  className={cn(
                    'flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-(--color-bg-hover)',
                    value === none.name && 'bg-(--color-bg-hover)',
                  )}
                >
                  <span className="text-xl leading-none flex-shrink-0">{none.flag}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{t('languagePicker.noTranslation')}</div>
                    <div className="text-xs text-(--color-fg-muted) truncate">
                      {t('languagePicker.noTranslationHint', { native: noTranslationName ?? none.name })}
                    </div>
                  </div>
                  {value === none.name && <Check size={16} className="text-(--color-accent)" />}
                </button>
              </li>
            )}
            {locked.length > 0 && heading(t('languagePicker.withPlus'), 'language-picker-plus-heading')}
            {locked.length > 0 && onRequestUpgrade && !query && (
              <li key="plus-notice">
                <button
                  type="button"
                  onClick={requestUpgrade}
                  data-testid="language-picker-plus-notice"
                  className="flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-(--color-bg-hover)"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-accent text-(--color-accent-fg)">
                    <Sparkles size={13} aria-hidden />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-(--color-accent)">
                      {ownLanguageName
                        ? t('languagePicker.plusNotice', { practice: ownLanguageName })
                        : t('languagePicker.plusNoticeAny')}
                    </div>
                    <div className="text-xs text-(--color-fg-muted)">{t('languagePicker.plusNoticeHint')}</div>
                  </div>
                  <ChevronRight size={16} aria-hidden className="shrink-0 text-(--color-accent)" />
                </button>
              </li>
            )}
            {locked.map((lang) => row(lang, true))}
          </>
        )}
        {/* ⚠ The CONSTRAINED branch that stood here is GONE, and with it the
            second `PlusCta`. It existed because a language outside the room
            simply vanished from the list, so searching for one was the only
            way to learn it existed — *"French is not in this chat yet"* was
            the picker's way of admitting it had hidden something. Nothing is
            hidden now: search for French and the French row is there, greyed,
            saying why. What is left is a genuine no-match, which reads the
            same for both kinds of picker. */}
        {(options ? filteredOptions.length === 0 : openLangs.length === 0 && locked.length === 0 && !none) && (
          <li className="px-4 py-6 text-center text-sm text-(--color-fg-muted)">
            {t('languagePicker.noMatches', { query })}
          </li>
        )}
      </ul>
    </BottomSheet>
  );
}
