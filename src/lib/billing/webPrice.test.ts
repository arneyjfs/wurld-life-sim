import { describe, expect, it } from 'vitest';
import { WEB_PRICE_AMOUNT, currencyForTimeZone, webPlusPrice } from '@/lib/billing/webPrice';

describe('webPrice — the web price for the visitor’s region', () => {
  it.each([
    ['Europe/London', 'GBP'],
    ['Europe/Belfast', 'GBP'],
    ['Europe/Jersey', 'GBP'],
    ['Europe/Paris', 'EUR'],
    ['Europe/Berlin', 'EUR'],
    ['Europe/Dublin', 'EUR'],
    ['Atlantic/Canary', 'EUR'],
    ['Europe/Sofia', 'EUR'],
    ['America/New_York', 'USD'],
    ['America/Los_Angeles', 'USD'],
    ['Europe/Warsaw', 'USD'],
    ['Europe/Stockholm', 'USD'],
    ['Europe/Zurich', 'USD'],
    ['Asia/Tokyo', 'USD'],
    ['UTC', 'USD'],
  ] as const)('BILL-MANAGE-7 — %s pays in %s', (tz, currency) => {
    expect(currencyForTimeZone(tz)).toBe(currency);
  });

  it('BILL-MANAGE-7 — no time zone at all falls back to USD, the Price’s default currency', () => {
    expect(currencyForTimeZone(undefined)).toBe('USD');
    expect(currencyForTimeZone('')).toBe('USD');
  });

  it('BILL-MANAGE-7 — every currency charges the same 2.99', () => {
    expect(WEB_PRICE_AMOUNT).toBe(2.99);
  });

  it('BILL-MANAGE-7.1 — the amount is formatted in the visitor’s locale', () => {
    expect(webPlusPrice('Europe/London', 'en-GB').display).toBe('£2.99');
    expect(webPlusPrice('America/New_York', 'en-US').display).toBe('$2.99');
    // French puts the euro after the amount, with a comma and a narrow space.
    expect(webPlusPrice('Europe/Paris', 'fr-FR').display.replace(/\s/g, ' ')).toBe('2,99 €');
  });

  it('BILL-MANAGE-7.2 — GBP and EUR include VAT; USD adds sales tax at checkout', () => {
    expect(webPlusPrice('Europe/London', 'en-GB').taxIncluded).toBe(true);
    expect(webPlusPrice('Europe/Paris', 'en-GB').taxIncluded).toBe(true);
    expect(webPlusPrice('America/New_York', 'en-US').taxIncluded).toBe(false);
  });

  it('BILL-MANAGE-7 — an unknown locale still yields a price rather than throwing', () => {
    expect(webPlusPrice('Europe/London', 'not-a-locale!!').display).toContain('2.99');
  });
});
