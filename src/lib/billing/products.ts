/**
 * BILL-* — the ONE Plus product, as each source names it.
 * TWIN of functions/src/billing/products.ts (parity-tested).
 */
export const PLUS_PRODUCTS = {
  apple: { productId: 'com.wurld.app.plus.monthly' },
  google: { productId: 'wurld_plus', basePlanId: 'monthly' },
  stripe: { priceLookupKey: 'wurld_plus_monthly' },
} as const;

/** Android package / iOS bundle id (capacitor.config.ts appId). */
export const APP_ID = 'com.wurld.app';
