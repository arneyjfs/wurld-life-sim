/**
 * LANG-TIER — the upgrade surface.
 *
 * Spec: docs/specs/language-tiers.md §4.
 *
 * Three claims in this sheet are load-bearing, and each one is a place the
 * product can be mis-sold by a copy edit:
 *
 *   1. FREE IS NOT CRIPPLED. LANG-TIER-1 says the free tier keeps the whole
 *      language-learning experience — it is constrained in WHICH languages, not
 *      in what it can do with them. A sheet that describes free as "basic" or
 *      "limited translation" describes a different product.
 *   2. ONE PLUS COVERS THE ROOM. The design's commercial claim. If this sheet
 *      implies everybody in a group has to pay, the reader prices it at N×
 *      and does not come back to check.
 *   3. THE BUTTON SAYS WHAT IT DOES (BILL-MANAGE-5, 2026-09-27). Until then
 *      this read "IT IS NOT ON SALE" — there was no purchase path. There is
 *      one now, so the sheet carries a purchase button that names the product,
 *      the store's price and the period, and is hidden from anyone who already
 *      has paid or given Plus (BILL-MANAGE-2). See the last describe block.
 *
 * ## 2026-09-22 — the eleven skipped assertions are BACK
 *
 * They were skipped when the sheet collapsed to one flat list: most of them
 * queried a Free box and an "Also in Plus" list that the flat list had
 * deleted. The sheet is TWO SECTIONS again (`plus-sheet-free` /
 * `plus-sheet-plus`), so the structure they pin exists once more and every one
 * of them runs. Four needed their assertion moved rather than their query:
 *
 *   - "describes free as unlimited, in the room's languages" — the copy no
 *     longer says *"already in the room"* anywhere (the owner's rewrite), and
 *     LANG-FREE-8's condition is now carried explicitly by the two `Free ↔`
 *     rows, which the very next test asserts. The half of the old assertion
 *     that was about the CLAIM is kept; the half that pinned a deleted
 *     sentence is replaced by what the section says instead.
 *   - "the free box promises BOTH making and reviewing a deck" — the copy says
 *     *"revise"*, not *"review"*. LANG-TIER-1.1's intent is that both halves
 *     of the deck (build it, read back through it) are free, and *revise* says
 *     that; the regex was over-strict about one word.
 *   - "states the real language count" — the count moved from `plus.plusBody`
 *     into `plus.itemAllLanguages`, whose sentence is *"Translate to {count}
 *     languages across all chats"*. Still interpolated from
 *     `SUPPORTED_LANGUAGES.length`, never typed, which is the whole invariant.
 *   - "creating a group is on the list too" — this one asserted a RETIRED
 *     invariant. LANG-TIER-2 was retired 2026-09-21 and LANG-TIER-1.1's table
 *     now reads *"Creating a group | ✓ | ✓"*, so selling group creation here
 *     would be the contradiction 1.1 forbids. It is inverted: what must be on
 *     the Plus list is the group LANGUAGE freedom, and what must NOT be is the
 *     group itself.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// BILL-MANAGE-* — the sheet reads the signed-in user (to hide the offer from
// someone who already has Plus) and calls the purchase module. Both are mocked:
// by default there is NO user, which is what every copy test above renders.
const purchaseState = vi.hoisted(() => ({
  uid: null as string | null,
  data: null as Record<string, unknown> | null,
  loading: false,
}));
vi.mock('@/hooks/useCurrentUid', () => ({ useCurrentUid: () => purchaseState.uid }));
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => ({ data: purchaseState.data, loading: purchaseState.loading, error: null }),
}));
const billing = vi.hoisted(() => ({
  purchasePlus: vi.fn(),
  getPlusPrice: vi.fn(async () => '$2.99' as string | null),
  restorePurchases: vi.fn(),
}));
vi.mock('@/lib/billing/purchase', () => billing);

// BILL-MANAGE-7 — the visitor's web price, switchable per test (USD by default,
// matching the UTC time zone the unit suite runs in).
const webPriceState = vi.hoisted(() => ({
  value: { currency: 'USD', display: '$2.99', taxIncluded: false } as {
    currency: 'USD' | 'GBP' | 'EUR';
    display: string;
    taxIncluded: boolean;
  },
}));
vi.mock('@/lib/billing/webPrice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/billing/webPrice')>()),
  get WEB_PLUS_PRICE() {
    return webPriceState.value;
  },
}));
const caps = vi.hoisted(() => ({ appleIap: false }));
vi.mock('@/lib/capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/capabilities')>()),
  canUseAppleIap: () => caps.appleIap,
}));

import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import { PLUS_PRICE } from '@/lib/trial';
import en from '@/i18n/locales/en';
import { PlusSheet } from './PlusSheet';

const setup = () => {
  const onClose = vi.fn();
  render(<PlusSheet open onClose={onClose} />);
  return { onClose, user: userEvent.setup() };
};

const textOf = (testId: string) => screen.getByTestId(testId).textContent ?? '';

/** Every row in the sheet, both sections, in render order. */
const allRows = () => [
  ...screen.getAllByTestId('plus-sheet-item-free'),
  ...screen.getAllByTestId('plus-sheet-item-plus'),
];

describe('LANG-TIER-1 — free keeps the experience, not a fragment of it', () => {
  it('LANG-TIER-1 — describes free as unlimited, and names the whole surface', () => {
    // Pins the CLAIM, not the sentence: a free member gets messaging and
    // translation without a cap, and the deck built out of them. What they
    // give up is CHOOSING the languages, which is the Plus section's job.
    setup();
    const free = textOf('plus-sheet-free');
    expect(free).toMatch(/unlimited/i);
    // ⚠ This assertion has now been re-pinned TWICE in two days — from
    // `/unlimited translations/` to `/all included/` to this — and the churn
    // is the point rather than a nuisance: the CLAIM has never moved, only the
    // sentence carrying it. A free member's translation is the whole feature
    // subject to one condition, not a cut-down version of it.
    //
    // Pinned on the FEATURE LIST, which is the most stable expression of it:
    // whatever the wording, free has to name what it actually gets, and
    // "corrections and hint words" is the part a thinner product would drop
    // first.
    // LANG-LEARNWITH-15 — the free benefit in the rule's own words: learn any
    // language a friend on Plus uses.
    expect(free).toMatch(/learn any language they use/i);
    expect(free).toMatch(/flashcard/i);
  });

  it('LANG-FREE-8 — does not promise FREE users translation unconditionally', () => {
    // The sheet is one tap from the passthrough offer, which has just told two
    // free users their messages are NOT translated. The old copy — "Unlimited
    // chats and translation, in any language pair already in the room" —
    // contradicted that strip at the exact moment somebody is deciding whether
    // to pay. Translation for free members is conditional on SOMEBODY in the
    // room holding Plus, and the free section has to say so.
    setup();
    const free = textOf('plus-sheet-free');
    expect(free).toMatch(/unlimited/i);
    expect(free, 'the free section must not claim translation with no condition')
      .not.toMatch(/unlimited chats and translation/i);
    expect(free, 'it must name the condition').toMatch(/\bPlus\b/);
  });

  it('LANG-TIER-1 — never calls the free tier basic, limited or a trial', () => {
    // The invariant most likely to be eroded by a later "make free a bit
    // smaller" copy edit. A free tier that is only translation is a different
    // product with different economics.
    const { container } = render(<PlusSheet open onClose={vi.fn()} />);
    expect(container.textContent).not.toMatch(/\b(basic|limited|trial|taster)\b/i);
  });
});

/**
 * The owner's 2026-09-22 restructure: two blocks, not one list, *"to make the
 * page prettier"*. The test-visible half of that is the structure — which rows
 * belong to which tier, and that the Plus block reads as an ADDITION to Free
 * rather than a rival column.
 */
describe('LANG-TIER-1.1 — two sections, Free first', () => {
  it('LANG-TIER-1.1 — the sheet has a Free section and a Plus section', () => {
    setup();
    expect(screen.getByTestId('plus-sheet-free')).toBeInTheDocument();
    expect(screen.getByTestId('plus-sheet-plus')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^free$/i })).toBeInTheDocument();
  });

  it('LANG-TIER-1.1 — the Plus section leads with "all of free, plus…"', () => {
    // Owner's words. The lead is what stops the second block reading as a
    // rival column that silently takes the first one's features away.
    setup();
    expect(screen.getByRole('heading', { name: /all of free, plus/i })).toBeInTheDocument();
  });

  it('LANG-TIER-1.1 — every row sits inside its own tier’s section', () => {
    // The tier signal. With the bullet no longer carrying it, containment is
    // what a reader (and this test) uses to tell a Free row from a Plus row.
    setup();
    const freeSection = screen.getByTestId('plus-sheet-free');
    const plusSection = screen.getByTestId('plus-sheet-plus');
    for (const row of screen.getAllByTestId('plus-sheet-item-free')) {
      expect(freeSection).toContainElement(row);
    }
    for (const row of screen.getAllByTestId('plus-sheet-item-plus')) {
      expect(plusSection).toContainElement(row);
    }
    expect(freeSection).not.toContainElement(plusSection);
  });

  it('LANG-SET-6/LANG-FREE-8 — Free is rendered before Plus', () => {
    // "A list that leads with what they cannot have reads as a wall."
    // `querySelectorAll` returns document order, which is what "first" means
    // to a reader scrolling the sheet.
    setup();
    const inOrder = Array.from(
      screen
        .getByTestId('plus-sheet')
        .querySelectorAll('[data-testid="plus-sheet-free"], [data-testid="plus-sheet-plus"]'),
    ).map((el) => el.getAttribute('data-testid'));
    expect(inOrder).toEqual(['plus-sheet-free', 'plus-sheet-plus']);
  });
});

/**
 * Feature icons, restored 2026-09-22.
 *
 * The flat list spent every row's icon on the TIER — `Check` for free,
 * `Sparkles` for Plus — so twelve rows carried two glyphs between them. With
 * the tier carried by the block, the icon is free to say what the row is
 * about. These assertions pin that it is not quietly collapsed back.
 *
 * ⚠ `data-icon` rather than lucide's generated class name: selecting on class
 * names is forbidden by `docs/conventions.md`, and the attribute is written
 * from `Icon.displayName` so it cannot describe a glyph the row is not
 * rendering.
 */
describe('LANG-TIER-1.1 — the rows carry feature icons', () => {
  it('LANG-TIER-1.1 — every row renders an icon', () => {
    setup();
    const rows = allRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.getAttribute('data-icon'), `no icon on: ${row.textContent ?? ''}`).toBeTruthy();
      expect(row.querySelector('svg'), `no svg on: ${row.textContent ?? ''}`).not.toBeNull();
    }
  });

  it('LANG-TIER-1.1 — the icons are per-feature, not one mark per tier', () => {
    // The regression this guards: both sections going back to a single bullet
    // each, which passes "every row renders an icon" perfectly.
    setup();
    const iconsIn = (testId: string) =>
      new Set(screen.getAllByTestId(testId).map((r) => r.getAttribute('data-icon')));
    expect(iconsIn('plus-sheet-item-free').size, 'the Free rows share one bullet').toBeGreaterThan(1);
    expect(iconsIn('plus-sheet-item-plus').size, 'the Plus rows share one bullet').toBeGreaterThan(1);
    const distinct = new Set(allRows().map((r) => r.getAttribute('data-icon')));
    expect(distinct.size).toBeGreaterThanOrEqual(6);
  });

  it('LANG-LEARNWITH-15 — groups are named in FREE, and no Plus row sells them', () => {
    setup();
    expect(textOf('plus-sheet-free')).toMatch(/groups/i);
    expect(textOf('plus-sheet-plus')).not.toMatch(/group/i);
  });
});

describe('the offer', () => {
  it('LANG-SET-6.1 — states the real language count, not a rounded marketing number', () => {
    // Read from the same array the picker draws from, so the sheet cannot
    // drift from what the app actually offers when a language is added.
    setup();
    expect(textOf('plus-sheet-plus')).toContain(`${SUPPORTED_LANGUAGES.length} languages`);
  });

  it('LANG-TIER-1 — says one Plus covers the whole chat', () => {
    // The commercial claim, pinned as a CLAIM: the people you talk to are
    // covered by YOUR subscription and pay nothing for it. If this sheet ever
    // implies each of them needs their own, the reader prices Plus at N× and
    // does not come back to check.
    //
    // ⚠ Was `/free members/i` + `/language set/i`. Both pinned JARGON the
    // 2026-09-23 rewrite removed on purpose — "language set" is this
    // codebase's term, not a reader's, and "free members" made the claim
    // sound like charity rather than inclusion. The two halves are asserted
    // against the new wording: WHO is covered, and that it costs them nothing.
    setup();
    const plus = textOf('plus-sheet-plus');
    expect(plus).toMatch(/anyone you chat with/i);
    expect(plus).toMatch(/without paying/i);
  });

  it('LANG-TIER-1.1 — lists the subscriber-only surfaces', () => {
    // LANG-TIER-1.1 replaces LANG-TIER-1's looser list. Explain and the tutor
    // are unchanged; "cards" is NOT on it any more (see the LANG-TIER-1.1
    // block below) and practice is on it as a SESSION.
    setup();
    const plus = textOf('plus-sheet-plus');
    expect(plus).toMatch(/explain/i);
    expect(plus).toMatch(/tutor/i);
    expect(plus).toMatch(/session/i);
  });
});

/**
 * LANG-TIER-1.1 — the sheet says exactly what the table says.
 *
 * The table draws the flashcard line between the CARD and the SESSION: a user
 * may build a deck and read back through it for nothing, because those are
 * their own words saved from their own chats. What Plus buys is the
 * spaced-repetition session built on top.
 *
 * The sheet previously sold "Flashcards and spaced-repetition practice" as one
 * Plus extra. Half of that sentence was a feature the reader already had for
 * free — which LANG-TIER-1.1 calls out by name as worse than a shorter sheet,
 * because the reader who checks discovers the sheet overstates the offer, and
 * then has no reason to believe the rest of it.
 */
describe('LANG-TIER-1.1 — the card/session line', () => {
  it('LANG-TIER-1.1 — flashcards are named in the FREE section', () => {
    setup();
    expect(textOf('plus-sheet-free')).toMatch(/flashcard/i);
  });

  it('LANG-TIER-1.1 — the free section promises BOTH making and reviewing a deck', () => {
    // Either half missing and the sheet has not actually described the line.
    // ⚠ `revis` as well as `review`: the shipped copy is *"Save words to
    // flashcards to revise later"*, which is the same promise in the owner's
    // word. The old regex was strict about the synonym, not about the claim.
    setup();
    const free = textOf('plus-sheet-free');
    expect(free).toMatch(/save|make|create|build/i);
    expect(free).toMatch(/review|revis/i);
  });

  it('LANG-TIER-1.1 — flashcards are NOT sold as a Plus extra', () => {
    // THE CONTRADICTION. `plus.extraPractice` read "Flashcards and
    // spaced-repetition practice".
    setup();
    expect(textOf('plus-sheet-plus')).not.toMatch(/flashcard/i);
  });

  it('LANG-TIER-1.1 — what Plus buys is the practice SESSION', () => {
    setup();
    const plus = textOf('plus-sheet-plus');
    expect(plus).toMatch(/practice/i);
    expect(plus).toMatch(/session/i);
  });

  it('LANG-TIER-1.1 — the chat quiz is sold in the Plus section, never the Free one (QUIZ-GATE-1)', () => {
    setup();
    expect(textOf('plus-sheet-plus')).toMatch(/quiz/i);
    expect(textOf('plus-sheet-free')).not.toMatch(/quiz/i);
  });

  it('LANG-TIER-1.1 — explain is sold, because it is now actually gated', () => {
    setup();
    expect(textOf('plus-sheet-plus')).toMatch(/explain/i);
  });
});

/**
 * LANG-TIER-1.1 — the group line, corrected 2026-09-22.
 *
 * It used to read *"In group chats, one Plus lets everyone read along in their
 * own language"*, and that is FALSE. LANG-SET-4 binds a free member's reading
 * AND practice language to the chat's language set; LANG-SET-1 builds that set
 * from the entitled members' own pairs. So a free member in your group reads
 * along in YOUR set — picking freely from all 85 is the thing Plus is being
 * sold for, and the sheet was giving it away in the same sentence.
 *
 * The other half of the correction is LANG-TIER-2's retirement: creating a
 * group is FREE, so the Plus block must not sell it.
 */
describe('LANG-LEARNWITH-15 — the rule in one vocabulary', () => {
  it('LANG-SET-4 — friends learn YOUR languages, never one of their own', () => {
    setup();
    const plus = textOf('plus-sheet-plus');
    expect(plus).toMatch(/learn your languages/i);
    expect(plus).not.toMatch(/their own language/i);
  });

  it('LANG-LEARNWITH-15 — "No ads" is a Free row: "We never sell your data."', () => {
    setup();
    const free = textOf('plus-sheet-free');
    expect(free).toMatch(/no ads/i);
    expect(free).toContain('We never sell your data.');
  });

  it('LANG-LEARNWITH-15 — the "Help support Wurld" note sits after both sections', () => {
    setup();
    const note = screen.getByTestId('plus-sheet-support');
    expect(note).toHaveTextContent('Help support Wurld');
    expect(note).toHaveTextContent('Please consider upgrading if you can to support our effort.');
    expect(screen.getByTestId('plus-sheet-plus').compareDocumentPosition(note)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('LANG-TIER-2 (retired) — creating a group is not sold as a Plus extra', () => {
    setup();
    const sheet = textOf('plus-sheet');
    expect(sheet).not.toMatch(/creat(e|ing) (a |your )?group/i);
    expect(sheet).not.toMatch(/groups? (need|require)/i);
  });
});

describe('I18N-EDGE-6 — the sheet renders no English literal', () => {
  it('I18N-EDGE-6 — every row and heading is an en.ts value', () => {
    // The static guard only catches a literal whose text is ALSO a catalogue
    // key's value. A brand-new literal typed straight into this sheet is
    // invisible to it and ships English to all 80 locales, so the check is
    // made here from the other end: everything this sheet renders has to come
    // out of the catalogue.
    // ⚠ A row is TWO catalogue strings since 2026-09-23 — a heading and an
    // explainer — so its `textContent` is their concatenation and can never
    // equal a single catalogue value. Each SPAN is checked instead, which is
    // also the stricter reading: a literal smuggled into either line is caught,
    // where checking the joined text would have needed the pair to be wrong
    // together.
    setup();
    const catalogue = new Set(
      Object.values(en).map((v) => v.replace('{count}', String(SUPPORTED_LANGUAGES.length))),
    );
    const rowLines = allRows().flatMap((el) =>
      [...el.querySelectorAll('span')]
        // Only the leaves: the wrapper span holds both lines joined.
        .filter((n) => n.querySelector('span') === null)
        .map((n) => n.textContent ?? ''),
    );
    const rendered = [
      ...rowLines,
      ...screen.getAllByRole('heading').map((el) => el.textContent ?? ''),
    ].map((s) => s.trim()).filter(Boolean);
    expect(rendered.length, 'the rows must actually render text').toBeGreaterThan(0);
    expect(rendered.filter((s) => !catalogue.has(s))).toEqual([]);
  });
});

/**
 * BILL-MANAGE-1/2/5 — the sheet SELLS now (billing.md), and 2026-09-27 is when
 * the old "honesty about availability" block was replaced, deliberately.
 *
 * ⚠ What it replaced: "says Plus is not on sale yet" and "offers no purchase
 * affordance". Both were true of a build with no purchase path (LANG-SEC-3) and
 * both are false of this one. BILL-MANAGE-5 names them as the tests to retire.
 * What survives from them is the rule underneath — a control must say what it
 * does — which is now asserted the other way round: the button names the
 * product, the price and the period, and uses LANG-SET-6.3's "Unlock" verb,
 * never "Buy"/"Subscribe"/"Checkout".
 */
describe('BILL-MANAGE-5 — the purchase affordance', () => {
  const HOUR = 60 * 60 * 1000;
  const future = () => ({ toMillis: () => Date.now() + 3 * HOUR });

  beforeEach(() => {
    vi.clearAllMocks();
    purchaseState.uid = 'u1';
    purchaseState.data = { trialEndsAt: future() };
    purchaseState.loading = false;
    billing.getPlusPrice.mockResolvedValue(PLUS_PRICE);
    billing.purchasePlus.mockResolvedValue({ kind: 'redirected' });
  });
  afterEach(() => {
    purchaseState.uid = null;
    purchaseState.data = null;
  });

  it('BILL-MANAGE-2 — a trialist is still offered Plus, with the price and the period', async () => {
    render(<PlusSheet open onClose={vi.fn()} />);
    const button = await screen.findByTestId('plus-sheet-purchase');
    await waitFor(() => expect(button).toHaveTextContent(PLUS_PRICE));
    expect(button).toHaveTextContent(/wurld plus/i);
    expect(button).toHaveTextContent(/month/i);
    expect(button).toBeEnabled();
  });

  it('LANG-SET-6.3 — the verb is "Unlock", never buy / subscribe / checkout', async () => {
    render(<PlusSheet open onClose={vi.fn()} />);
    const button = await screen.findByTestId('plus-sheet-purchase');
    expect(button).toHaveTextContent(/unlock/i);
    expect(button.textContent ?? '').not.toMatch(/\b(buy|subscribe|checkout|purchase)\b/i);
  });

  it('BILL-MANAGE-5 — states that it renews until cancelled', async () => {
    render(<PlusSheet open onClose={vi.fn()} />);
    expect(await screen.findByTestId('plus-sheet-terms')).toHaveTextContent(/renews monthly/i);
  });

  describe('BILL-MANAGE-7.2 — the sales-tax note', () => {
    afterEach(() => {
      webPriceState.value = { currency: 'USD', display: '$2.99', taxIncluded: false };
      caps.appleIap = false;
    });

    it('BILL-MANAGE-7.2 — a US-dollar web visitor is told sales tax is added at checkout', async () => {
      render(<PlusSheet open onClose={vi.fn()} />);
      expect(await screen.findByTestId('plus-sheet-terms')).toHaveTextContent(en['plus.salesTaxNote']);
    });

    it('BILL-MANAGE-7.2 — a UK web visitor sees the VAT-inclusive price and no tax note', async () => {
      webPriceState.value = { currency: 'GBP', display: '£2.99', taxIncluded: true };
      render(<PlusSheet open onClose={vi.fn()} />);
      expect(await screen.findByTestId('plus-sheet-terms')).not.toHaveTextContent(en['plus.salesTaxNote']);
    });

    it('BILL-MANAGE-7.2 — a store build never shows the web tax note (the store states its own terms)', async () => {
      caps.appleIap = true;
      render(<PlusSheet open onClose={vi.fn()} />);
      expect(await screen.findByTestId('plus-sheet-terms')).not.toHaveTextContent(en['plus.salesTaxNote']);
    });
  });

  it('BILL-MANAGE-5 — the old "not on sale yet" line is gone', async () => {
    render(<PlusSheet open onClose={vi.fn()} />);
    await screen.findByTestId('plus-sheet-purchase');
    expect(screen.queryByText(/isn.t on sale yet/i)).toBeNull();
  });

  it('BILL-MANAGE-5 — the store\'s localised price is what the button shows', async () => {
    billing.getPlusPrice.mockResolvedValue('2,99 €');
    render(<PlusSheet open onClose={vi.fn()} />);
    const button = await screen.findByTestId('plus-sheet-purchase');
    await waitFor(() => expect(button).toHaveTextContent('2,99 €'));
    expect(button.textContent).not.toContain(PLUS_PRICE);
  });

  it('BILL-MANAGE-5 — no price, no purchase: a store that cannot price it disables the button and says so', async () => {
    billing.getPlusPrice.mockResolvedValue(null);
    render(<PlusSheet open onClose={vi.fn()} />);
    const button = await screen.findByTestId('plus-sheet-purchase');
    await waitFor(() => expect(screen.getByTestId('plus-sheet-status')).toHaveTextContent(/aren.t available/i));
    expect(button).toBeDisabled();
  });

  it('BILL-MANAGE-1 — tapping it starts the purchase for the signed-in user', async () => {
    const user = userEvent.setup();
    render(<PlusSheet open onClose={vi.fn()} />);
    const button = await screen.findByTestId('plus-sheet-purchase');
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(billing.purchasePlus).toHaveBeenCalledWith('u1');
  });

  it('BILL-MANAGE-1 — while it runs the button is busy, so a double tap cannot buy twice', async () => {
    let finish: (v: { kind: 'purchased' }) => void = () => undefined;
    billing.purchasePlus.mockImplementation(() => new Promise((r) => { finish = r; }));
    const user = userEvent.setup();
    render(<PlusSheet open onClose={vi.fn()} />);
    const button = await screen.findByTestId('plus-sheet-purchase');
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await user.click(button);
    expect(billing.purchasePlus).toHaveBeenCalledTimes(1);
    await act(async () => finish({ kind: 'purchased' }));
  });

  it.each([
    ['pending', /waiting for approval/i],
    ['already_entitled', /already have plus/i],
    ['wrong_account', /different wurld account/i],
    ['unconfirmed', /couldn.t switch plus on yet/i],
    ['failed', /didn.t go through/i],
    ['unavailable', /aren.t available/i],
  ] as const)('BILL-MANAGE-1 — a %s result is explained, not swallowed', async (kind, copy) => {
    billing.purchasePlus.mockResolvedValue({ kind });
    const user = userEvent.setup();
    render(<PlusSheet open onClose={vi.fn()} />);
    const button = await screen.findByTestId('plus-sheet-purchase');
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(await screen.findByTestId('plus-sheet-status')).toHaveTextContent(copy);
  });

  it('BILL-MANAGE-1 — a cancelled purchase says nothing and leaves the button ready', async () => {
    billing.purchasePlus.mockResolvedValue({ kind: 'cancelled' });
    const user = userEvent.setup();
    render(<PlusSheet open onClose={vi.fn()} />);
    const button = await screen.findByTestId('plus-sheet-purchase');
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.queryByTestId('plus-sheet-status')).toBeNull();
  });

  it.each([
    ['a paying subscriber', { plan: 'pro', planSources: ['stripe'] }],
    ['a manual grant', { plan: 'pro', planUntil: null, planSources: ['manual'] }],
    ['a grandfathered account', { plan: 'pro' }],
  ])('BILL-MANAGE-2 — %s is offered nothing to buy', async (_label, doc) => {
    purchaseState.data = doc;
    render(<PlusSheet open onClose={vi.fn()} />);
    expect(await screen.findByTestId('plus-sheet-has-plus')).toBeInTheDocument();
    expect(screen.queryByTestId('plus-sheet-purchase')).toBeNull();
    expect(screen.getByTestId('plus-sheet').textContent).not.toMatch(/\/month/);
  });

  it('BILL-MANAGE-2 — a plan that lapsed by the clock is offered Plus again', async () => {
    purchaseState.data = { plan: 'pro', planUntil: { toMillis: () => Date.now() - HOUR } };
    render(<PlusSheet open onClose={vi.fn()} />);
    expect(await screen.findByTestId('plus-sheet-purchase')).toBeInTheDocument();
  });

  it('BILL-MANAGE-2 — nothing is offered while the profile is still loading (fail closed to not selling)', () => {
    purchaseState.loading = true;
    purchaseState.data = null;
    render(<PlusSheet open onClose={vi.fn()} />);
    expect(screen.queryByTestId('plus-sheet-purchase')).toBeNull();
  });

  it('the dismiss button still closes the sheet', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PlusSheet open onClose={onClose} />);
    await user.click(screen.getByTestId('plus-sheet-close'));
    expect(onClose).toHaveBeenCalled();
  });
});
