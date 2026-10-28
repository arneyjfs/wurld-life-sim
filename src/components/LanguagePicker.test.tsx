/**
 * LANG-SET — the picker when a chat constrains what a free member may pick.
 *
 * Spec: docs/specs/language-tiers.md §2.
 *
 * The case that carries the risk is the EMPTY array. `chatLanguageOptions`
 * returns `[]` when the server has not computed the chat's targets yet, which
 * means "unknown", not "no languages" — and a picker that treated it as a
 * constraint would show a member of a perfectly ordinary chat an empty list
 * and no way out. The safe direction is to over-offer for that moment, so it
 * is pinned here rather than left to the reader of the prop doc.
 *
 * ⚠ **The constrained picker no longer FILTERS (owner, 2026-09-22).** It renders
 * every supported language and DISABLES the ones this room does not carry,
 * with *"Upgrade to select"* under the region line. So "is it offered?" is
 * asserted on the row's `disabled` attribute (LANG-SET-7), never on absence.
 * The zero-results upgrade state is gone with it: nothing is hidden, so a
 * search for an absent language finds a greyed row, and the only upgrade CTA
 * is the pool note's `row`-variant `PlusCta`.
 *
 * Re-pinned 2026-09-30 against the final copy (task #58, audit DEAD-20 /
 * Q-14); nothing here is skipped.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguagePicker } from './LanguagePicker';
import en from '@/i18n/locales/en';

const EN = 'English (British)';
const ES = 'Spanish';
const FR = 'French';

const open = (props: Partial<React.ComponentProps<typeof LanguagePicker>> = {}) =>
  render(
    <LanguagePicker
      open
      onClose={props.onClose ?? vi.fn()}
      value={undefined}
      onChange={props.onChange ?? vi.fn()}
      {...props}
    />,
  );

const search = (q: string) => {
  // `type="search"` maps to the searchbox role, not textbox.
  const box = screen.getByRole('searchbox');
  fireEvent.change(box, { target: { value: q } });
};

const row = (lang: string) => screen.getByTestId(`language-picker-row-${lang}`);

describe('unconstrained — the existing behaviour', () => {
  it('LANG-SET-3 — offers every language, none of them locked', () => {
    open();
    search('Japanese');
    expect(row('Japanese')).not.toBeDisabled();
    expect(screen.queryByTestId('language-picker-locked-Japanese')).toBeNull();
  });

  it('shows the plain no-matches line for a nonsense query', () => {
    open();
    search('zzzzzz');
    expect(screen.getByText(/No languages match/i)).toBeInTheDocument();
  });
});

describe('LANG-LEARNWITH-11 — a constrained picker leads with what is free here', () => {
  const DE = 'German';

  it('LANG-LEARNWITH-11 — two groups: "Free in this chat", then "With Wurld Plus"', () => {
    open({ availableLanguages: [EN, ES], onRequestUpgrade: vi.fn() });
    const free = screen.getByTestId('language-picker-free-heading');
    const plus = screen.getByTestId('language-picker-plus-heading');
    expect(free).toHaveTextContent('Free in this chat');
    expect(plus).toHaveTextContent('With Wurld Plus');
    // Free first.
    expect(free.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('LANG-LEARNWITH-11 — a carried language is selectable, with its "Included in" line', () => {
    const onChange = vi.fn();
    open({ availableLanguages: [DE], freeHints: { [DE]: 'Included in Tom’s Plus' }, onChange });
    expect(screen.getByTestId(`language-picker-hint-${DE}`)).toHaveTextContent('Included in Tom’s Plus');
    fireEvent.click(row(DE));
    expect(onChange).toHaveBeenCalledWith(DE);
  });

  it('LANG-LEARNWITH-11 — the free group keeps the order it was given (most holders first)', () => {
    open({ availableLanguages: [ES, DE] });
    const ids = [...document.querySelectorAll('[data-free-row]')].map((el) => el.getAttribute('data-testid'));
    expect(ids).toEqual([`language-picker-row-${ES}`, `language-picker-row-${DE}`]);
  });

  it('LANG-LEARNWITH-11 — "No translation · Just English" with the English flag, writing the reading language', () => {
    const onChange = vi.fn();
    open({ availableLanguages: [DE, EN], noTranslation: EN, noTranslationName: 'English', onChange });
    const none = screen.getByTestId('language-picker-row-none');
    expect(none).toHaveTextContent('No translation');
    expect(none).toHaveTextContent('Just English');
    expect(none).toHaveTextContent('🇬🇧');
    // The reading language is THIS row, not a second ordinary one.
    expect(screen.queryByTestId(`language-picker-row-${EN}`)).toBeNull();
    fireEvent.click(none);
    expect(onChange).toHaveBeenCalledWith(EN);
  });

  it('LANG-LEARNWITH-11 — one upgrade notice about MY language, then every other language greyed, mine first', () => {
    const onRequestUpgrade = vi.fn();
    open({ availableLanguages: [DE], ownLanguage: FR, ownLanguageName: 'French', onRequestUpgrade });
    const notice = screen.getByTestId('language-picker-plus-notice');
    expect(notice).toHaveTextContent('Learn French here instead');
    expect(notice).toHaveTextContent('Get Wurld Plus to learn any of these');
    const locked = [...document.querySelectorAll('[data-locked]')];
    expect(locked[0]!.getAttribute('data-testid')).toBe(`language-picker-row-${FR}`);
    // My own practice language is greyed like the rest (owner, 2026-10-23).
    expect(screen.getByTestId(`language-picker-locked-${FR}`)).toBeInTheDocument();
  });

  it('LANG-SET-7 — a greyed language is never PICKED: a tap closes and opens Plus instead', () => {
    const calls: string[] = [];
    const onChange = vi.fn();
    open({
      availableLanguages: [EN, ES],
      onChange,
      onClose: () => calls.push('close'),
      onRequestUpgrade: () => calls.push('upgrade'),
    });
    fireEvent.click(row(FR));
    expect(onChange).not.toHaveBeenCalled();
    // Closed FIRST: two stacked sheets is the bug that looks like a frozen app.
    expect(calls).toEqual(['close', 'upgrade']);
  });

  it('LANG-SET-7 — the notice does the same', () => {
    const calls: string[] = [];
    open({
      availableLanguages: [EN, ES],
      onClose: () => calls.push('close'),
      onRequestUpgrade: () => calls.push('upgrade'),
    });
    fireEvent.click(screen.getByTestId('language-picker-plus-notice'));
    expect(calls).toEqual(['close', 'upgrade']);
  });

  it('LANG-LEARNWITH-11 — search still covers every language, greyed where it is Plus', () => {
    open({ availableLanguages: [EN, ES] });
    search('Japanese');
    expect(screen.getByTestId('language-picker-locked-Japanese')).toBeInTheDocument();
    search('Spanish');
    expect(row(ES)).not.toHaveAttribute('data-locked');
  });

  it('LANG-LEARNWITH-4 — no banned words in the constrained picker', () => {
    open({ availableLanguages: [EN, ES], onRequestUpgrade: vi.fn() });
    const text = document.body.textContent!.toLowerCase();
    for (const banned of ['premium', 'unavailable', 'paid for', 'basic plan', 'upgrade to select']) {
      expect(text).not.toContain(banned);
    }
  });
});

describe('an EMPTY set means unknown, never "no languages"', () => {
  it('behaves as unconstrained', () => {
    // chatLanguageOptions returns [] before the server has computed targets.
    // Treating that as a constraint would show an ordinary chat's member a
    // list of locked rows.
    open({ availableLanguages: [] });
    search('French');
    expect(row(FR)).not.toBeDisabled();
    expect(screen.queryByTestId(`language-picker-locked-${FR}`)).toBeNull();
  });

  it('an empty set locks nothing in the full list', () => {
    open({ availableLanguages: [] });
    expect(document.querySelectorAll('[data-locked]')).toHaveLength(0);
    expect(row('Japanese')).not.toBeDisabled();
  });
});

describe('LANG-SET-7 — nothing offers a language the room cannot carry', () => {
  it('LANG-SET-7 — the Recent row is filtered by the pool', () => {
    // THE TRAP. Recents come from the member's OTHER chats. Tapping one absent
    // from this room used to succeed, show the new language, and then be
    // silently snapped away by the server on the next resolve — the member's
    // own screen disagreeing with what the room would do.
    open({ availableLanguages: [EN, ES], extraRecents: [ES, FR] });
    // ⚠ The in-pool pill is asserted FIRST and deliberately: without it the
    // absence check below passes just as happily on a row that never rendered,
    // which is how the first version of this test passed against the bug.
    expect(screen.getByTestId(`language-picker-recent-${ES}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`language-picker-recent-${FR}`)).not.toBeInTheDocument();
  });

  it('LANG-SET-7 — an unconstrained picker keeps every recent', () => {
    // The filter must not empty the row for a subscriber, who has no pool.
    open({ extraRecents: [FR] });
    expect(screen.getByTestId(`language-picker-recent-${FR}`)).toBeInTheDocument();
  });

  it('LANG-SET-7 — an EMPTY set keeps every recent', () => {
    // [] is "unknown", so filtering against it would strip the row on exactly
    // the transient state where the member has done nothing wrong.
    open({ availableLanguages: [], extraRecents: [FR] });
    expect(screen.getByTestId(`language-picker-recent-${FR}`)).toBeInTheDocument();
  });
});

describe('LANG-SET-1 — the faces behind the room’s languages', () => {
  /**
   * These avatars shipped with no test at all, which is how they came to be a
   * GROUP-only feature by accident: `ChatInfoScreen` builds the holders below
   * its `!chat.isGroup` early return, so the 1:1 branch rendered the section
   * with the prop simply absent and nothing noticed. Owner, 2026-09-22:
   * *"I'd like user avatars in the language picker even for 1:1 chats."*
   *
   * The wiring fix is in `OneToOneInfo`; what these pin is the CONTRACT the
   * wiring has to satisfy, so a caller that drops the prop again fails here
   * rather than in somebody's screenshot.
   */
  const holder = (uid: string, name: string) => ({ uid, name, photoUrl: undefined });

  it('LANG-SET-1 — a language with holders shows their avatars on its row', () => {
    open({
      availableLanguages: [EN, ES],
      languageHolders: { [ES]: [holder('u-alice', 'Alice')] },
    });
    expect(screen.getByTestId(`language-picker-holders-${ES}`)).toBeInTheDocument();
  });

  it('LANG-SET-1 — a language with NO holders shows no avatar group', () => {
    // The negative control. Without it a row that always rendered the group —
    // empty, but present — would pass the test above.
    open({
      availableLanguages: [EN, ES],
      languageHolders: { [ES]: [holder('u-alice', 'Alice')] },
    });
    expect(screen.queryByTestId(`language-picker-holders-${EN}`)).not.toBeInTheDocument();
  });

  it('LANG-SET-1 — ONE holder is enough, which is the whole 1:1 case', () => {
    // A 1:1 room has exactly one other member, so if anything anywhere took
    // "holders" to mean "a crowd" the 1:1 picker would stay blank forever.
    open({
      availableLanguages: [ES],
      languageHolders: { [ES]: [holder('u-alice', 'Alice')] },
    });
    const group = screen.getByTestId(`language-picker-holders-${ES}`);
    // One avatar, not zero. Counted as CHILDREN rather than by tag: with no
    // `photoUrl` the Avatar renders initials, so an `img` selector matches
    // nothing and would pass this test against an empty group.
    expect(group.children.length).toBe(1);
  });

  it('LANG-SET-1 — past three they become a texture, so three is the cap', () => {
    open({
      availableLanguages: [ES],
      languageHolders: {
        [ES]: [
          holder('u-1', 'One'), holder('u-2', 'Two'),
          holder('u-3', 'Three'), holder('u-4', 'Four'), holder('u-5', 'Five'),
        ],
      },
    });
    const group = screen.getByTestId(`language-picker-holders-${ES}`);
    expect(group.children.length).toBe(3);
  });

  it('LANG-SET-1 — no holders prop at all renders the rows unharmed', () => {
    // `ProfileScreen` renders the 1:1 component with no chat, so the prop is
    // legitimately absent there. Absent must mean "no avatars", never "no row".
    open({ availableLanguages: [EN, ES] });
    expect(screen.getByTestId(`language-picker-row-${ES}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`language-picker-holders-${ES}`)).not.toBeInTheDocument();
  });
});

describe('I18N-12 — `options`: the same sheet over a list that is not the chat languages', () => {
  const OPTIONS = [
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'Français', hint: 'French' },
    { value: 'ja', label: '日本語', hint: 'Japanese' },
  ];

  it('I18N-12 — lists exactly the options given, no chat languages, no flags, no Recent row', () => {
    open({ options: OPTIONS, value: 'en' });
    expect(screen.getByTestId('language-picker-row-fr')).toHaveTextContent('Français');
    expect(screen.getByTestId('language-picker-row-fr')).toHaveTextContent('French');
    expect(screen.queryByTestId(`language-picker-row-${FR}`)).toBeNull();
    expect(screen.queryByText(en['languagePicker.recent'])).toBeNull();
    const list = screen.getByTestId('language-picker-row-ja').closest('ul')!;
    expect(list.textContent ?? '').not.toMatch(/\p{Regional_Indicator}/u);
    expect(screen.getByTestId('language-picker-row-en')).toHaveAttribute('aria-current', 'true');
  });

  it('I18N-12 — search matches the native name, the English hint or the code', () => {
    open({ options: OPTIONS });
    search('japan');
    expect(screen.getByTestId('language-picker-row-ja')).toBeInTheDocument();
    expect(screen.queryByTestId('language-picker-row-fr')).toBeNull();
    search('Franç');
    expect(screen.getByTestId('language-picker-row-fr')).toBeInTheDocument();
    search('ja');
    expect(screen.getByTestId('language-picker-row-ja')).toBeInTheDocument();
  });

  it('I18N-12 — a pick hands back the option value and closes', () => {
    const onChange = vi.fn();
    const onClose = vi.fn();
    open({ options: OPTIONS, onChange, onClose });
    fireEvent.click(screen.getByTestId('language-picker-row-ja'));
    expect(onChange).toHaveBeenCalledWith('ja');
    expect(onClose).toHaveBeenCalled();
  });
});
