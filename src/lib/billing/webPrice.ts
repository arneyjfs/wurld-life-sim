/**
 * BILL-MANAGE-7 — the web price for the visitor's region.
 *
 * The Stripe Price (`wurld_plus_monthly`) is USD 2.99 tax-EXCLUSIVE by default,
 * with currency options GBP 2.99 and EUR 2.99, both VAT-INCLUSIVE. Checkout
 * picks the option for the customer's location; we cannot see that location,
 * so we infer it from the browser's time zone. A wrong guess only changes what
 * our page says: Checkout shows the real currency and total before payment
 * (BILL-MANAGE-7.3).
 *
 * ⚠ These tables mirror the Price's `currency_options`. Adding a currency in
 * Stripe means adding its zones here. Two copies follow this file, never edit
 * them by hand: `functions/src/billing/webPrice.ts` (the server twin that
 * prices `billingSummary`, held equal by `webPriceParity.test.ts`) and
 * wurld-welcome's `src/synced/webPrice.ts`, a byte-for-byte copy made by its
 * `npm run sync:app` and drift-checked by its `npm run check:sync`. So this
 * file must stay import-free.
 */

export type WebCurrency = 'USD' | 'GBP' | 'EUR';

/** The same amount in every currency (owner decision 2026-09-27). */
export const WEB_PRICE_AMOUNT = 2.99;

const GBP_ZONES = new Set([
  'Europe/London',
  'Europe/Belfast',
  'Europe/Guernsey',
  'Europe/Jersey',
  'Europe/Isle_of_Man',
  'GB',
  'GB-Eire',
]);

/** The euro area, Bulgaria included from 2026. Non-euro EU states pay USD. */
const EUR_ZONES = new Set([
  'Europe/Vienna',
  'Europe/Brussels',
  'Europe/Zagreb',
  'Asia/Nicosia',
  'Asia/Famagusta',
  'Europe/Nicosia',
  'Europe/Tallinn',
  'Europe/Helsinki',
  'Europe/Mariehamn',
  'Europe/Paris',
  'Europe/Monaco',
  'Europe/Berlin',
  'Europe/Athens',
  'Europe/Dublin',
  'Eire',
  'Europe/Rome',
  'Europe/Vatican',
  'Europe/San_Marino',
  'Europe/Riga',
  'Europe/Vilnius',
  'Europe/Luxembourg',
  'Europe/Malta',
  'Europe/Amsterdam',
  'Europe/Lisbon',
  'Portugal',
  'Atlantic/Madeira',
  'Atlantic/Azores',
  'Europe/Bratislava',
  'Europe/Ljubljana',
  'Europe/Madrid',
  'Africa/Ceuta',
  'Atlantic/Canary',
  'Europe/Sofia',
  'Europe/Andorra',
]);

export function currencyForTimeZone(timeZone: string | undefined): WebCurrency {
  if (!timeZone) return 'USD';
  if (GBP_ZONES.has(timeZone)) return 'GBP';
  if (EUR_ZONES.has(timeZone)) return 'EUR';
  return 'USD';
}

export interface WebPlusPrice {
  currency: WebCurrency;
  /** Formatted for the visitor's locale, e.g. `£2.99`, `2,99 €`. */
  display: string;
  /** GBP and EUR include VAT; USD has sales tax added at checkout (BILL-MANAGE-7.2). */
  taxIncluded: boolean;
}

function format(currency: WebCurrency, locale: string | undefined): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(WEB_PRICE_AMOUNT);
  } catch {
    // A malformed locale string throws a RangeError; fall back to English.
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(WEB_PRICE_AMOUNT);
  }
}

export function webPlusPrice(timeZone: string | undefined, locale: string | undefined): WebPlusPrice {
  const currency = currencyForTimeZone(timeZone);
  return { currency, display: format(currency, locale), taxIncluded: currency !== 'USD' };
}

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** The price for THIS browser. Resolved once: a time zone does not change mid-session. */
export const WEB_PLUS_PRICE: WebPlusPrice = webPlusPrice(
  browserTimeZone(),
  typeof navigator !== 'undefined' ? navigator.language : undefined,
);
