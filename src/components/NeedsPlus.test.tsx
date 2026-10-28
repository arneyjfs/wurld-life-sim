/**
 * LANG-TIER-1.1 / LANG-SET-6.3 — the panel a free user meets where a paid
 * surface would be, and the CTA on it.
 *
 * Spec: docs/specs/language-tiers.md §2 (LANG-SET-6.1, LANG-SET-6.3,
 * LANG-SEC-3), §4 (LANG-TIER-1.1), §5c (LANG-FREE-8).
 *
 * ⚠ **What this file exists for is the LABEL, and specifically the label this
 * surface must NOT borrow.** `LANG-TIER-1.1` is a TABLE of what Plus unlocks,
 * surface by surface — so "Unlock all 85 languages", which is exactly true on
 * the language pickers and the override sheet, is a true statement about Plus
 * and a false description of what the reader of THIS panel just hit. Explain,
 * the practice hub and the practice route are not about the language set. One
 * shared CTA with a per-surface first line is what lets them share the shape
 * without sharing the wrong claim; a single hard-coded label would have put the
 * languages sentence on the practice gate.
 *
 * The second line is not asserted for its wording here — `PlusCta.test.tsx`
 * owns that — only for the fact that this panel gets it, because that is what
 * keeps the product named on a gate whose own label never says "Plus".
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import en from '@/i18n/locales/en';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import { PLUS_PRICE } from '@/lib/trial';
import { NeedsPlus } from './NeedsPlus';

const renderPanel = () =>
  render(
    <NeedsPlus
      title="Your tutor is part of Plus"
      body="Practice with the tutor any time, in any language you are learning."
      testId="panel"
    />,
  );

describe('LANG-TIER-1.1 — the panel names the feature and offers the sheet', () => {
  it('LANG-TIER-1.1 — renders the caller’s heading and body', () => {
    renderPanel();
    const panel = screen.getByTestId('panel');
    expect(panel).toHaveTextContent('Your tutor is part of Plus');
    expect(panel).toHaveTextContent(/practice with the tutor/i);
  });

  it('LANG-TIER-1.1 — the CTA keeps the `${testId}-see-plus` contract', () => {
    // Three call sites and two E2E specs select on it
    // (`explain-needs-plus-see-plus`, `practice-needs-plus-see-plus`).
    renderPanel();
    expect(screen.getByTestId('panel-see-plus')).toBeInTheDocument();
  });

  it('LANG-FREE-8 — the only action opens the sheet where the decision is made', async () => {
    renderPanel();
    await userEvent.setup().click(screen.getByTestId('panel-see-plus'));
    expect(screen.getByTestId('plus-sheet')).toBeInTheDocument();
  });

  it('LANG-FREE-8 — it is an OFFER, not a wall', () => {
    // The copy is the caller's, but the panel's own furniture must not add a
    // breakage reading: this is the moment the product asks somebody to pay.
    renderPanel();
    expect(screen.getByTestId('panel').textContent ?? '')
      .not.toMatch(/paused|unavailable|not allowed|locked/i);
  });
});

describe('LANG-SET-6.3 — the shared CTA, with the label this gate can actually make', () => {
  it('LANG-SET-6.3 — the first line is `plus.ctaUnlock`, not the languages claim', () => {
    renderPanel();
    expect(screen.getByTestId('panel-see-plus')).toHaveTextContent(en['plus.ctaUnlock']);
  });

  it('LANG-TIER-1.1 — and it does NOT claim a number of languages', () => {
    // THE POINT OF THE SPLIT LABEL. This gate is not about the language set, so
    // borrowing `languageOverride.upgradeCta` here would answer a question the
    // reader did not ask and misdescribe what they just hit.
    //
    // ⚠ The count is asserted by NAME (`SUPPORTED_LANGUAGES.length`) and not as
    // "any two-digit number": the second line carries `$2.99`, so a bare
    // `\d{2,}` fails on the price and says nothing about the claim.
    renderPanel();
    const cta = screen.getByTestId('panel-see-plus').textContent ?? '';
    expect(cta).not.toMatch(/\blanguages?\b/i);
    expect(cta).not.toMatch(new RegExp(`\\b${SUPPORTED_LANGUAGES.length}\\b`));
    expect(cta).not.toContain(
      en['languageOverride.upgradeCta'].replace('{total}', String(SUPPORTED_LANGUAGES.length)),
    );
  });

  it('LANG-SET-6.1 — the second line still names the product and the price', () => {
    // The label never says "Plus", which is fine only because `PlusCta` says it
    // one line down on every surface. Without that, this is a gate that asks
    // for money without naming what it sells — the exact regression
    // LANG-SET-6.1's test caught on the override sheet.
    renderPanel();
    const cta = screen.getByTestId('panel-see-plus');
    expect(cta).toHaveTextContent(/wurld plus/i);
    expect(cta).toHaveTextContent(PLUS_PRICE);
  });

  it('LANG-SEC-3 — the CTA never reads as checkout', () => {
    renderPanel();
    expect(screen.getByTestId('panel-see-plus').textContent ?? '')
      .not.toMatch(/\b(buy|subscribe|pay|checkout|upgrade now)\b/i);
  });

  it('LANG-SET-6.3 — the retired "See Plus" wording is gone', () => {
    renderPanel();
    expect(screen.getByTestId('panel-see-plus')).not.toHaveTextContent(en['plus.seePlus']);
  });
});
