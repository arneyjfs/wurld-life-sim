import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the side-effectful modules so mounting the screen never touches
// Firebase / Gemini. The setup-warning render is a pure function of the
// active locale + profile languages (LIFE-LANG-7).
// NAV-BACK-2: the header arrow is now `<BackButton />`, which reads the
// location (`useParentPath`) as well as navigating. `useLocation` is stubbed
// here rather than mounting a real router because ~30 `render(<LifeStartScreen
// />)` call sites would otherwise need wrapping — and stubbing the LOCATION
// keeps the interesting half real: `useAppBack` / `useParentPath` below run
// their genuine `resolveParent` logic against it, so the arrow's destination
// is actually asserted rather than mocked into agreement.
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/wurlds/start', search: '', hash: '', state: null, key: 'k' }),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { uid: string } }) => unknown) =>
    sel({ user: { uid: 'u1' } }),
}));
vi.mock('@/store/uiStore', () => ({
  useUIStore: (sel: (s: { pushToast: () => void }) => unknown) =>
    sel({ pushToast: vi.fn() }),
}));
// Mutable so a test can put the profile doc back in flight (LIFE-ONBOARD-2).
const PROFILE_LOADED = {
  data: {
    nativeLanguage: 'English',
    learningLanguage: 'French',
    difficulty: 2,
    displayName: 'Alex',
  },
  loading: false,
};
let profileState: { data: unknown; loading: boolean } = PROFILE_LOADED;
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => profileState,
}));
vi.mock('@/lib/life/world', () => ({
  createLifeWorld: vi.fn(),
  newWorldId: () => 'w-test',
  setLastSeenWorld: vi.fn(),
  updateLifeWorld: vi.fn(),
}));
vi.mock('@/lib/life/generateBio', () => ({
  generateCharacterBio: vi.fn(),
  renderBioForPrompt: vi.fn(),
}));
vi.mock('@/lib/life/runWorldArcGenerate', () => ({ runWorldArcGenerate: vi.fn() }));
vi.mock('@/lib/life/runWorldSagaGenerate', () => ({ runWorldSagaGenerate: vi.fn() }));

// COMP-KB-22 — the seed-field correction is driven by the SETTLED keyboard
// height, so the tests drive that value directly. The real hook is a
// `useSyncExternalStore` over the controller singleton (COMP-KB-15); mutating
// this and re-rendering is the same input the controller would deliver.
let kbState: { visible: boolean; height: number } = { visible: false, height: 0 };
vi.mock('@/hooks/useKeyboardState', () => ({
  useKeyboardState: () => kbState,
}));

// LIFE-ONBOARD-2: stub the SHARED picker. What is under test here is this
// screen's wiring — that the row opens it, that it is seeded with the
// profile's practice language, and that a pick reaches the world doc. The
// picker's own behaviour (search, recents, the vaul sheet) has its own
// coverage, and rendering it here would test that instead.
vi.mock('@/components/LanguagePicker', () => ({
  LanguagePicker: ({
    open,
    value,
    onChange,
  }: {
    open: boolean;
    value: string | undefined;
    onChange: (l: string) => void;
  }) =>
    open ? (
      <div data-testid="stub-picker" data-value={value}>
        <button type="button" onClick={() => onChange('German')}>
          pick German
        </button>
      </div>
    ) : null,
}));

import { LifeStartScreen } from './LifeStartScreen';
import { useI18nStore } from '@/i18n/store';
import { createLifeWorld } from '@/lib/life/world';

function setLocale(code: string) {
  useI18nStore.setState({ locale: code });
}

afterEach(() => {
  setLocale('en');
  profileState = PROFILE_LOADED;
  kbState = { visible: false, height: 0 };
});

describe('LifeStartScreen — system language (LIFE-LANG-7)', () => {
  // The on-screen narration warning was REMOVED 2026-07-31 (owner: narration
  // behaviour has changed, so the warning no longer described what happens).
  // What survives is the VALUE — still resolved, still written to the world
  // doc — and these two tests pin exactly that split, so a future reader
  // cannot mistake "the warning is gone" for "the resolution is gone".
  it('LIFE-LANG-7 — the narration warning is GONE, in every locale that used to raise it', () => {
    for (const locale of ['fr', 'de', 'en']) {
      setLocale(locale);
      const { unmount } = render(<LifeStartScreen />);
      expect(
        screen.queryByTestId('LifeStart-SystemLangWarning'),
      ).not.toBeInTheDocument();
      unmount();
    }
  });

  it('LIFE-LANG-7 — the system language is STILL captured and written to the world doc', () => {
    setLocale('de');
    render(<LifeStartScreen />);
    // The chip is incidental here — any seed exercises the write. Uses one
    // from the DEFAULT row (LIFE-ONBOARD-15: fantasy) rather than switching
    // mode first, since the mode is not what this test is about.
    fireEvent.click(screen.getByTestId('LifeStart-Seed-magic_university'));
    expect(vi.mocked(createLifeWorld)).toHaveBeenCalledWith(
      expect.objectContaining({ systemLanguage: 'German' }),
    );
    vi.mocked(createLifeWorld).mockClear();
  });

  it('LIFE-ONBOARD-9 — the safe-area padding is on the header, NOT on the scroll container', () => {
    // Reported: the subtitle rendered over the status bar with the header
    // below it. Cause: the header was `sticky top-0` INSIDE a scroller that
    // carried `pt-safe-top`, so it parked below that padding while content
    // scrolled up through it. Asserting WHERE the padding lives is the fix's
    // actual contract — a jsdom render has no layout to measure, and
    // "the header still renders" would pass against the bug.
    render(<LifeStartScreen />);
    const scroll = screen.getByTestId('LifeStart-Scroll');
    expect(scroll).not.toHaveClass('pt-safe-top');
    const header = document.querySelector('header');
    expect(header).not.toBeNull();
    expect(header).toHaveClass('pt-safe-top');
    // The header must not be INSIDE the scroller, or the strip is reachable
    // again however it is padded.
    expect(scroll.contains(header)).toBe(false);
  });

  it('COMP-KB-14 — the scrollable form pads for the keyboard (`.pb-keyboard`) so the name / seed fields clear it', () => {
    setLocale('en');
    render(<LifeStartScreen />);
    expect(screen.getByTestId('LifeStart-Scroll')).toHaveClass('pb-keyboard');
  });
});

// ── LIFE-ONBOARD-3/4/5: the world-mode toggle redesign ───────────────
const REALISTIC_CHIPS = [
  'city_life',
  'studying_abroad',
  'farm_life',
  'restaurant',
];
const FANTASY_CHIPS = [
  'magic_university',
  'outlaw_trail',
  'frontier_colony',
  'noir_detective',
];

/**
 * LIFE-ONBOARD-15: fantasy is the default now, so a test that needs the
 * REALISTIC row has to switch to it first. A named helper rather than a
 * repeated `fireEvent.click` so the reason is stated once — and so flipping
 * the default again is one edit.
 */
function renderOnRealistic() {
  render(<LifeStartScreen />);
  fireEvent.click(screen.getByTestId('LifeStart-Mode-realistic'));
}

describe('LifeStartScreen — world-mode toggle (LIFE-ONBOARD-3/4/5)', () => {
  afterEach(() => vi.mocked(createLifeWorld).mockClear());

  it('LIFE-ONBOARD-3 — renders BOTH mode segments, each carrying its own subtitle', () => {
    render(<LifeStartScreen />);
    const realistic = screen.getByTestId('LifeStart-Mode-realistic');
    const fantasy = screen.getByTestId('LifeStart-Mode-fantasy');
    // The subtitle is the realism nudge — it has to be readable on the
    // segment itself, not only once the segment is chosen, or the
    // player cannot compare the two before deciding.
    expect(realistic).toHaveTextContent(/in-laws/i);
    expect(fantasy).toHaveTextContent(/gripping/i);
  });

  it('LIFE-ONBOARD-15 — FANTASY is selected by default, and renders FIRST', () => {
    // Owner, 2026-08-01: "Fantasy should be the default story type, realistic
    // second." Asserted as DOM ORDER as well as selection, because the
    // default and the order are the same decision and used to be able to
    // disagree — the screen carried its own ['realistic','fantasy'] literal.
    render(<LifeStartScreen />);
    expect(screen.getByTestId('LifeStart-Mode-fantasy')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByTestId('LifeStart-Mode-realistic')).toHaveAttribute(
      'aria-checked',
      'false',
    );
    const segments = screen
      .getAllByRole('radio')
      .map((el) => el.getAttribute('data-testid'));
    expect(segments).toEqual(['LifeStart-Mode-fantasy', 'LifeStart-Mode-realistic']);
  });

  it('LIFE-ONBOARD-4 — the seed examples are FILTERED by the active mode, and switching mode swaps them', () => {
    // LIFE-ONBOARD-15: fantasy is the default, so that row is what renders
    // first and realistic is what the switch reveals.
    render(<LifeStartScreen />);
    for (const key of FANTASY_CHIPS) {
      expect(screen.getByTestId(`LifeStart-Seed-${key}`)).toBeInTheDocument();
    }
    for (const key of REALISTIC_CHIPS) {
      expect(
        screen.queryByTestId(`LifeStart-Seed-${key}`),
      ).not.toBeInTheDocument();
    }

    fireEvent.click(screen.getByTestId('LifeStart-Mode-realistic'));

    for (const key of REALISTIC_CHIPS) {
      expect(screen.getByTestId(`LifeStart-Seed-${key}`)).toBeInTheDocument();
    }
    for (const key of FANTASY_CHIPS) {
      expect(
        screen.queryByTestId(`LifeStart-Seed-${key}`),
      ).not.toBeInTheDocument();
    }
  });

  it('LIFE-ONBOARD-4 — "surprise" survives BOTH modes: it is the one chip whose key carries no register', () => {
    render(<LifeStartScreen />);
    expect(screen.getByTestId('LifeStart-Seed-surprise')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('LifeStart-Mode-fantasy'));
    expect(screen.getByTestId('LifeStart-Seed-surprise')).toBeInTheDocument();
  });

  it('LIFE-ONBOARD-5 — the free-text seed is visible with NO expand affordance, and its placeholder is a worked example for the active mode', () => {
    render(<LifeStartScreen />);
    // The old "Write your own" disclosure is gone — the input is the
    // primary path now, not something hidden under the grid.
    expect(
      screen.queryByTestId('LifeStart-ManualToggle'),
    ).not.toBeInTheDocument();
    // LIFE-ONBOARD-15: fantasy is the default, so its placeholder is the one
    // on screen at render and realistic is a switch away.
    const fantasy = screen
      .getByTestId('LifeStart-ManualText')
      .getAttribute('placeholder');
    fireEvent.click(screen.getByTestId('LifeStart-Mode-realistic'));
    const realistic = screen
      .getByTestId('LifeStart-ManualText')
      .getAttribute('placeholder');

    // Assert the PROPERTIES rather than the prose, so a copy edit doesn't
    // fail a test that is really about the placeholder being mode-scoped and
    // worked-through. Both start "e.g." and are long enough to actually name
    // a person, a situation and a source of drama — a one-line "describe your
    // wurld" placeholder would pass a mere non-empty check.
    for (const p of [realistic, fantasy]) {
      expect(p).toMatch(/^e\.g\./);
      expect(p!.length).toBeGreaterThan(80);
    }
    expect(realistic).not.toBe(fantasy);
    // One anchor each, so a swap of the two would still be caught.
    expect(fantasy).toMatch(/astronaut/i);
    expect(realistic).not.toMatch(/astronaut/i);
    expect(realistic).toMatch(/conference/i);
    expect(fantasy).not.toMatch(/conference/i);
  });

  it('LIFE-ONBOARD-5 — the realistic placeholder SPANS several situations, not one scene', () => {
    // Owner, 2026-07-31: the worked example should show that a seed can
    // cover a run of situations in different registers — a conference talk,
    // questions from the floor, finding your way around the venue, and the
    // drinks evening afterwards — rather than a single frozen scene. A
    // one-situation example teaches the player to write a one-situation
    // seed, and the saga generator has less to pull on.
    renderOnRealistic();
    const realistic = screen
      .getByTestId('LifeStart-ManualText')
      .getAttribute('placeholder')!;
    for (const beat of [/conference/i, /question/i, /venue/i, /drinks/i]) {
      expect(realistic, `placeholder is missing ${beat}`).toMatch(beat);
    }
  });

  it('LIFE-ONBOARD-3 — the chosen mode is PERSISTED on the world doc for a free-text seed', () => {
    render(<LifeStartScreen />);
    fireEvent.click(screen.getByTestId('LifeStart-Mode-fantasy'));
    fireEvent.change(screen.getByTestId('LifeStart-ManualText'), {
      target: { value: 'a lighthouse keeper who can hear the sea thinking' },
    });
    fireEvent.click(screen.getByTestId('LifeStart-ManualSubmit'));
    expect(vi.mocked(createLifeWorld)).toHaveBeenCalledWith(
      expect.objectContaining({ worldSeedKey: 'manual', worldMode: 'fantasy' }),
    );
  });

  it('LIFE-ONBOARD-4/5 — the examples come FIRST; the free-text seed is the LAST section, so the player scrolls PAST the chips to reach it', () => {
    // Owner, 2026-07-31: "Let's put the example wurld cards above the free
    // text input again so the user has to scroll past them." This reverses
    // the redesign that promoted the box above the chips. The discovery
    // mechanism changes with it — LIFE-ONBOARD-11 relied on a scroll that
    // OVERSHOOTS the box to reveal the chips; now the chips are on the
    // route to the box and cannot be missed.
    //
    // Asserted as DOM order rather than "both render", because both
    // rendered before this change too.
    render(<LifeStartScreen />);
    const chip = screen.getByTestId('LifeStart-Seed-magic_university');
    const seed = screen.getByTestId('LifeStart-ManualText');
    expect(
      chip.compareDocumentPosition(seed) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const sections = [
      ...screen.getByTestId('LifeStart-Scroll').querySelectorAll('section'),
    ];
    const chipSection = sections.findIndex((s) => s.contains(chip));
    const seedSection = sections.findIndex((s) => s.contains(seed));
    expect(chipSection).toBeGreaterThanOrEqual(0);
    expect(chipSection).toBeLessThan(seedSection);
    // The box is the FLOOR of the form — nothing may be reordered under it.
    expect(seedSection).toBe(sections.length - 1);
  });

  it('LIFE-ONBOARD-4/5 — the headings follow the order: the examples LEAD, and the free-text box is the "or" alternative', () => {
    // "Or start from an example" was an alternative to a box the player had
    // already been shown. Read above that box it is an alternative to
    // nothing, so the "or" moves with the section it belongs to.
    render(<LifeStartScreen />);
    const examples = screen.getByText('Start from an example');
    const manual = screen.getByText('Or write your own');
    expect(examples).toBeInTheDocument();
    expect(manual).toBeInTheDocument();
    expect(
      screen.queryByText('Or start from an example'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Write your own')).not.toBeInTheDocument();
    expect(
      examples.compareDocumentPosition(manual) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('LIFE-ONBOARD-2 — while the profile doc is IN FLIGHT the form does not render at all', () => {
    // Not merely "the row is blank": the seed chips must be unreachable too.
    // The bug was that a chip tapped before the doc landed created a wurld in
    // the hard-coded 'French' fallback rather than the player's real setting,
    // so hiding the row alone would have left the write race open.
    profileState = { data: null, loading: true };
    render(<LifeStartScreen />);
    expect(screen.getByTestId('LifeStart-ProfileLoading')).toBeInTheDocument();
    expect(screen.queryByTestId('LifeStart-Language')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('LifeStart-Seed-magic_university'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('LifeStart-ManualText')).not.toBeInTheDocument();
  });

  it('LIFE-ONBOARD-2 — once the profile lands, the row shows ITS language, not the fallback', () => {
    profileState = {
      data: { nativeLanguage: 'English', learningLanguage: 'German', difficulty: 2 },
      loading: false,
    };
    render(<LifeStartScreen />);
    expect(screen.getByTestId('LifeStart-Language')).toHaveTextContent('German');
    expect(screen.getByTestId('LifeStart-Language')).not.toHaveTextContent(
      'French',
    );
  });

  it('LIFE-ONBOARD-2 — the language row opens the SHARED picker, seeded with the profile practice language', () => {
    render(<LifeStartScreen />);
    expect(screen.queryByTestId('stub-picker')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('LifeStart-Language'));
    expect(screen.getByTestId('stub-picker')).toHaveAttribute(
      'data-value',
      'French',
    );
  });

  it('LIFE-ONBOARD-2 — the row shows the profile language by DEFAULT, and the picked one after a pick', () => {
    render(<LifeStartScreen />);
    expect(screen.getByTestId('LifeStart-Language')).toHaveTextContent('French');
    fireEvent.click(screen.getByTestId('LifeStart-Language'));
    fireEvent.click(screen.getByText('pick German'));
    expect(screen.getByTestId('LifeStart-Language')).toHaveTextContent('German');
    expect(screen.getByTestId('LifeStart-Language')).not.toHaveTextContent(
      'French',
    );
  });

  it('LIFE-ONBOARD-2 — the PICKED language is what the wurld is created in, not the profile default', () => {
    render(<LifeStartScreen />);
    fireEvent.click(screen.getByTestId('LifeStart-Language'));
    fireEvent.click(screen.getByText('pick German'));
    fireEvent.click(screen.getByTestId('LifeStart-Seed-magic_university'));
    expect(vi.mocked(createLifeWorld)).toHaveBeenCalledWith(
      expect.objectContaining({ practiceLanguage: 'German' }),
    );
  });

  it('LIFE-ONBOARD-2 / LIFE-LANG-7 — the picked language drives the narration-language resolution, not the profile one', () => {
    // App running in French, native English. With the profile default
    // (practice = French) the active locale resolves THROUGH the practice
    // language, so `systemLanguage` is exactly 'French'. Picking German for
    // this wurld must not leave that resolution reading a stale profile
    // value — the warning still names the real narration language.
    setLocale('fr');
    render(<LifeStartScreen />);
    fireEvent.click(screen.getByTestId('LifeStart-Language'));
    fireEvent.click(screen.getByText('pick German'));
    fireEvent.click(screen.getByTestId('LifeStart-Seed-magic_university'));
    expect(vi.mocked(createLifeWorld)).toHaveBeenCalledWith(
      expect.objectContaining({
        practiceLanguage: 'German',
        systemLanguage: 'French',
      }),
    );
  });

  it('LIFE-ONBOARD-3 — the mode is persisted for a CHIP seed too, so "surprise" knows which register to roll in', () => {
    // `surprise` is the one chip in BOTH rows and carries no register of its
    // own, which is exactly why `worldMode` has to be persisted rather than
    // derived from the key. Asserted on both modes, so a default flip
    // (LIFE-ONBOARD-15) cannot make this pass for the wrong reason.
    render(<LifeStartScreen />);
    fireEvent.click(screen.getByTestId('LifeStart-Seed-surprise'));
    expect(vi.mocked(createLifeWorld)).toHaveBeenCalledWith(
      expect.objectContaining({ worldSeedKey: 'surprise', worldMode: 'fantasy' }),
    );

  });

  it('LIFE-ONBOARD-3 — the same chip persists the OTHER mode when that is the one selected', () => {
    // The half that proves the mode is read rather than assumed: a default
    // flip (LIFE-ONBOARD-15) would make a single-mode assertion pass for the
    // wrong reason. Its own `it` so the first render is torn down — two
    // renders in one test leave two toggles in the container.
    renderOnRealistic();
    fireEvent.click(screen.getByTestId('LifeStart-Seed-surprise'));
    expect(vi.mocked(createLifeWorld)).toHaveBeenCalledWith(
      expect.objectContaining({ worldSeedKey: 'surprise', worldMode: 'realistic' }),
    );
  });
});

// ── LIFE-ONBOARD-11: the form is spacious ON PURPOSE ─────────────────
describe('LifeStartScreen — deliberate vertical rhythm (LIFE-ONBOARD-11)', () => {
  const MIN_SECTION_GAP = 8;
  const MIN_SEED_ROWS = 6;

  it('LIFE-ONBOARD-11 — every section keeps a generous gap; chasing the fold by tightening them is the regression', () => {
    // The examples sitting below the fold is the DESIGN, not a defect: the
    // player has to scroll to reach the seed box, and a scroll that overshoots
    // reveals the chips. A previous pass tightened these to `mb-5` and shrank
    // the textarea trying to lift the chips above the fold, which read as
    // crammed (owner, 2026-07-31).
    //
    // Asserted as a FLOOR rather than an exact class: the contract is "at
    // least this much air", so a later designer may open it up further
    // without editing a test, but cannot close it back down silently.
    render(<LifeStartScreen />);
    const sections = [
      ...screen.getByTestId('LifeStart-Scroll').querySelectorAll('section'),
    ];
    expect(sections.length).toBeGreaterThanOrEqual(4);
    for (const section of sections) {
      const gap = [...section.classList].find((c) => /^mb-\d+$/.test(c));
      expect(gap, `no mb-* rhythm class on: ${section.className}`).toBeTruthy();
      expect(Number(gap!.slice(3))).toBeGreaterThanOrEqual(MIN_SECTION_GAP);
    }
  });

  it('LIFE-ONBOARD-11 / LIFE-ONBOARD-5 — the free-text seed is a TALL box, not a three-line slot', () => {
    render(<LifeStartScreen />);
    const rows = Number(
      screen.getByTestId('LifeStart-ManualText').getAttribute('rows'),
    );
    expect(rows).toBeGreaterThanOrEqual(MIN_SEED_ROWS);
  });
});

// ── LIFE-ONBOARD-10 / COMP-KB-22: the seed field vs. the keyboard ────
describe('LifeStartScreen — the seed field clears the keyboard (LIFE-ONBOARD-10 / COMP-KB-22)', () => {
  const INNER_H = 800;
  const KB_H = 320;
  /** Where the keyboard's top edge lands, in viewport coordinates. */
  const KB_TOP = INNER_H - KB_H;

  /**
   * A `getBoundingClientRect` that MOVES with its scroller, so an idempotent
   * correction is genuinely exercised: a second pass over a field that has
   * already been lifted must find nothing left to do. A static rect would let
   * a double-applying implementation pass.
   */
  function stubRect(
    el: Element,
    top: number,
    bottom: number,
    scrolledBy: () => number = () => 0,
  ): void {
    el.getBoundingClientRect = () => {
      const y = scrolledBy();
      return {
        top: top - y,
        bottom: bottom - y,
        y: top - y,
        height: bottom - top,
        left: 0,
        right: 0,
        x: 0,
        width: 0,
        toJSON: () => ({}),
      } as DOMRect;
    };
  }

  /** jsdom has no scrolling box, so `scrollTop` writes go nowhere. Record them. */
  function trackScrollTop(el: HTMLElement): () => number {
    let value = 0;
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => value,
      set: (next: number) => {
        value = next;
      },
    });
    return () => value;
  }

  /** Focus the seed, raise the keyboard, and let every timer drain. */
  function focusSeedWithKeyboardUp(rerender: (ui: React.ReactElement) => void) {
    fireEvent.focus(screen.getByTestId('LifeStart-ManualText'));
    kbState = { visible: true, height: KB_H };
    rerender(<LifeStartScreen />);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: INNER_H,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  it('COMP-KB-22 — focusing the seed NEVER asks the DOCUMENT to scroll', () => {
    // This is the jitter. `keyboardInset.ts` owns the window scroll position
    // while a keyboard opens: a 350ms rAF loop forcing `scrollTo(0, 0)`
    // (COMP-KB-10, keyboardInset.ts:73-87) plus a permanent
    // `visualViewport.scroll` snap-back (keyboardInset.ts:70-72). And
    // `scrollIntoView` scrolls EVERY scrollable ancestor — the viewport
    // included. A `behavior:'smooth'` call landing inside that window is a
    // second writer of the same number, once per frame, for the whole
    // animation. Correcting only the field's OWN scroller removes our half of
    // the loop by construction.
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    const { rerender } = render(<LifeStartScreen />);
    focusSeedWithKeyboardUp(rerender);

    expect(intoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });

  it('COMP-KB-22 — a field bisected by the keyboard top is lifted clear, via its OWN scroller', () => {
    const { rerender } = render(<LifeStartScreen />);
    const scroller = screen.getByTestId('LifeStart-Scroll');
    const scrollTop = trackScrollTop(scroller);
    stubRect(scroller, 100, INNER_H);
    // Straddles the keyboard top (480): visible above it, covered below.
    stubRect(screen.getByTestId('LifeStart-ManualText'), 600, 700, scrollTop);

    focusSeedWithKeyboardUp(rerender);

    // 700 (field bottom) − 480 (keyboard top) = 220, and no more: the
    // follow-up pass after the `.pb-keyboard` transition must find the field
    // already clear. A non-idempotent correction lands at 440 here.
    expect(scrollTop()).toBe(700 - KB_TOP);
  });

  it('COMP-KB-22 — a field already clear of the keyboard is not touched at all', () => {
    // The anti-oscillation half. Any correction that fires unconditionally can
    // be re-triggered by the layout change it just caused; one that is a no-op
    // once satisfied cannot.
    const { rerender } = render(<LifeStartScreen />);
    const scroller = screen.getByTestId('LifeStart-Scroll');
    const scrollTop = trackScrollTop(scroller);
    stubRect(scroller, 100, INNER_H);
    stubRect(screen.getByTestId('LifeStart-ManualText'), 200, 300, scrollTop);

    focusSeedWithKeyboardUp(rerender);

    expect(scrollTop()).toBe(0);
  });
});

describe('NAV-BACK-2 — the wurld onboarding header uses the shared back affordance', () => {
  it('NAV-BACK-2 — renders `nav-back`, pointing at the hierarchy parent of /wurlds/start', () => {
    render(<LifeStartScreen />);
    // Derived, not hard-coded: `resolveParent('/wurlds/start')` is `/wurlds`.
    // This screen used to call `useAppBack` and draw its own arrow.
    expect(screen.getByTestId('nav-back')).toHaveAttribute('href', '/wurlds');
  });
});
