/**
 * LANG-SET-6.3 — the one upgrade CTA, drawn the same way everywhere it appears.
 *
 * Spec: docs/specs/language-tiers.md §2 (LANG-SET-6.2, LANG-SET-6.3).
 *
 * ⚠ **What this file guards is that the SECOND LINE is not a prop.** The offer
 * used to be spelled out per surface — a text link here, a small filled button
 * there, an outline pill somewhere else, each naming the product and the price
 * in its own words or not at all. Owner, 2026-09-21: *"I like the shared key.
 * Use a style like that for all modals."* So the product name and the price are
 * the component's own, read from `PLUS_PRICE`, and a caller cannot vary them.
 *
 * ⚠ **The FIRST line is a prop, and that is the whole reason this is not one
 * key.** "Unlock all 85 languages" is true on the language surfaces and false
 * on the practice gate, which is not about languages at all (`LANG-TIER-1.1`
 * lists what Plus unlocks, and it is a table rather than one sentence). One
 * style, one price, per-surface words.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import en from '@/i18n/locales/en';
import { PLUS_PRICE } from '@/lib/trial';
import { PlusCta } from './PlusCta';

const setup = (props: Partial<React.ComponentProps<typeof PlusCta>> = {}) => {
  const onClick = vi.fn();
  render(<PlusCta label="Unlock all 85 languages" onClick={onClick} testId="cta" {...props} />);
  return { onClick, user: userEvent.setup() };
};

describe('LANG-SET-6.3 — one CTA, one price, per-surface words', () => {
  it('LANG-SET-6.3 — the caller’s label is the first line', () => {
    setup({ label: 'Unlock the tutor' });
    expect(screen.getByTestId('cta')).toHaveTextContent(/unlock the tutor/i);
  });

  it('LANG-SET-6.3 — the product and the price are the component’s, not the caller’s', () => {
    // A surface cannot forget to name what it is selling, and cannot invent a
    // second phrasing of the price. That is the drift this replaces: three
    // surfaces, three shapes, two of which named the price and one of which
    // did not.
    setup();
    const cta = screen.getByTestId('cta');
    expect(cta).toHaveTextContent(/wurld plus/i);
    expect(cta).toHaveTextContent(PLUS_PRICE);
    expect(cta).toHaveTextContent(/month/i);
  });

  it('LANG-SET-6.2 — the price is INTERPOLATED, never typed into the string', () => {
    // A literal goes stale on every surface at once now, which is worse than
    // the drift it replaced rather than better.
    expect(en['plus.ctaPeriod']).toContain('{price}');
    expect(en['plus.ctaPeriod']).not.toMatch(/\d/);
  });

  it('LANG-SET-6.1 — the second line NAMES the product, so no caller has to', () => {
    // Entitlement includes trialists, so "paid" is false (LANG-SET-6.1) and the
    // product name is the only accurate word. Holding it here is what stops the
    // next surface shipping a priced button that never says what it sells —
    // which is exactly what happened when the label was the only line.
    expect(en['plus.ctaPeriod']).toMatch(/plus/i);
  });

  it('LANG-SET-6.3 — it calls back rather than navigating', () => {
    // Every caller opens `PlusSheet`, which is the one place a claim about the
    // tier is made (LANG-TIER-1.1). The component does not own that sheet —
    // three of the callers already mount their own.
    const { onClick } = setup();
    return userEvent.click(screen.getByTestId('cta')).then(() => {
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });

  it('LANG-SEC-3 — it never reads as checkout', () => {
    // There is no purchase path in this build, so what this opens has to be a
    // sheet that says so. "Unlock" is a verb about access; "Buy"/"Subscribe"
    // would promise a transaction that opens nothing.
    setup();
    expect(screen.getByTestId('cta').textContent ?? '')
      .not.toMatch(/\b(subscribe|buy|purchase|pay|checkout)\b/i);
  });

  it('LANG-SET-6.3 — the ROW variant carries the same two lines', () => {
    // Chat info is a settings list, not a sheet, and the owner asked for the
    // row shape there. Same copy, same price, different box — if the two could
    // drift, the shared component would have bought nothing.
    setup({ variant: 'row' });
    const cta = screen.getByTestId('cta');
    expect(cta).toHaveTextContent(/unlock all 85 languages/i);
    expect(cta).toHaveTextContent(PLUS_PRICE);
  });

  it('LANG-SET-6.3 — and the row carries NO chevron', () => {
    // Owner: *"no arrow on far right like the pickers."* The rows above it open
    // a picker and come back; this one leaves for a sheet. A chevron would
    // promise the same gesture for a different outcome.
    setup({ variant: 'row' });
    expect(screen.getByTestId('cta').querySelector('svg.lucide-chevron-right')).toBeNull();
  });
});
