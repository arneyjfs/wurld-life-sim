/**
 * BILL-MANAGE-1 / BILL-APPLE-1/2/4 / BILL-GOOGLE-1/2 — the client purchase path.
 *
 * Spec: docs/specs/billing.md.
 *
 * The plugin (`@capgo/native-purchases`) is mocked: native builds have never
 * been compiled, so these tests are the only proof the calls are made with the
 * right options. Each platform is selected through the capability predicates
 * (never `Platform.OS`), which are mocked per test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const caps = vi.hoisted(() => ({ ios: false, android: false }));
vi.mock('@/lib/capabilities', () => ({
  canUseAppleIap: () => caps.ios,
  canUsePlayBilling: () => caps.android,
  canUseWebCheckout: () => !caps.ios && !caps.android,
}));

const plugin = vi.hoisted(() => ({
  purchaseProduct: vi.fn(),
  acknowledgePurchase: vi.fn(),
  getPurchases: vi.fn(),
  restorePurchases: vi.fn(),
  getProducts: vi.fn(),
  manageSubscriptions: vi.fn(),
  addListener: vi.fn(),
}));
vi.mock('@capgo/native-purchases', () => ({
  NativePurchases: plugin,
  PURCHASE_TYPE: { INAPP: 'inapp', SUBS: 'subs' },
}));

const http = vi.hoisted(() => ({ callHttp: vi.fn() }));
vi.mock('@/lib/endpoints', () => ({ callHttp: http.callHttp }));

const web = vi.hoisted(() => ({ startWebCheckout: vi.fn(), openStripePortal: vi.fn() }));
vi.mock('@/lib/billing/webCheckout', () => web);

const logMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/log', () => logMock);

vi.mock('@/lib/accountToken', () => ({
  accountTokenForUid: vi.fn(async (uid: string) => `token-for-${uid}`),
}));

import {
  getPlusPrice,
  listenForStoreTransactions,
  purchasePlus,
  resetPlusPriceCache,
  restorePurchases,
  syncOutstandingPurchases,
} from './purchase';
import { PLUS_PRODUCTS } from './products';
import { PLUS_PRICE } from '@/lib/trial';

/** How `callHttp` rejects a non-2xx (status kept in the message). */
const httpError = (name: string, status: number) => new Error(`callHttp ${name} ${status}`);
/** How Capacitor surfaces a plugin `call.reject(message, code)`. */
const pluginError = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {});

beforeEach(() => {
  vi.clearAllMocks();
  caps.ios = false;
  caps.android = false;
  resetPlusPriceCache();
  http.callHttp.mockResolvedValue({ entitled: true, projection: {} });
  plugin.acknowledgePurchase.mockResolvedValue(undefined);
  plugin.restorePurchases.mockResolvedValue(undefined);
});

describe('BILL-MANAGE-1 — the surface follows the runtime', () => {
  it('BILL-MANAGE-1 — web goes to Stripe Checkout and never touches the store plugin', async () => {
    web.startWebCheckout.mockResolvedValue(undefined);
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'redirected' });
    expect(web.startWebCheckout).toHaveBeenCalledTimes(1);
    expect(plugin.purchaseProduct).not.toHaveBeenCalled();
  });

  it('BILL-MANAGE-2 — web: a 409 from checkout is "already entitled", not a failure', async () => {
    web.startWebCheckout.mockRejectedValue(new Error('already_entitled'));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'already_entitled' });
  });

  it('BILL-MANAGE-1 — web: any other checkout error is a typed failure', async () => {
    web.startWebCheckout.mockRejectedValue(new Error('network'));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'failed' });
  });
});

describe('BILL-APPLE-1/2 — iOS', () => {
  beforeEach(() => {
    caps.ios = true;
    plugin.purchaseProduct.mockResolvedValue({
      transactionId: '2000001',
      productIdentifier: PLUS_PRODUCTS.apple.productId,
      jwsRepresentation: 'signed.jws.value',
    });
  });

  it('BILL-APPLE-1 — purchases with appAccountToken = the uid\'s account token, and auto-finish OFF', async () => {
    await purchasePlus('u1');
    expect(plugin.purchaseProduct).toHaveBeenCalledWith({
      productIdentifier: PLUS_PRODUCTS.apple.productId,
      productType: 'subs',
      appAccountToken: 'token-for-u1',
      autoAcknowledgePurchases: false,
    });
  });

  it('BILL-APPLE-2 — posts the signed transaction, THEN finishes it', async () => {
    const order: string[] = [];
    http.callHttp.mockImplementation(async (name: string) => {
      order.push(name);
      return { entitled: true, projection: {} };
    });
    plugin.acknowledgePurchase.mockImplementation(async () => {
      order.push('finish');
    });
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'purchased' });
    expect(http.callHttp).toHaveBeenCalledWith('appleSyncTransaction', { signedTransactions: ['signed.jws.value'] });
    expect(plugin.acknowledgePurchase).toHaveBeenCalledWith({ purchaseToken: '2000001' });
    expect(order).toEqual(['appleSyncTransaction', 'finish']);
  });

  it.each([
    [403, 'wrong_account'],
    [409, 'already_entitled'],
    [500, 'failed'],
  ] as const)('BILL-APPLE-2 — a %i from the server leaves the transaction UNFINISHED (%s)', async (status, kind) => {
    http.callHttp.mockRejectedValue(httpError('appleSyncTransaction', status));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind });
    expect(plugin.acknowledgePurchase).not.toHaveBeenCalled();
  });

  it('BILL-APPLE-2 — a transaction with no signed payload is never posted or finished', async () => {
    plugin.purchaseProduct.mockResolvedValue({ transactionId: '2000001', productIdentifier: 'x' });
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'failed' });
    expect(http.callHttp).not.toHaveBeenCalled();
    expect(plugin.acknowledgePurchase).not.toHaveBeenCalled();
  });

  it('BILL-APPLE-2 — 2xx but not entitled (e.g. sandbox in prod): finished, reported as unconfirmed', async () => {
    http.callHttp.mockResolvedValue({ entitled: false, projection: {} });
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'unconfirmed' });
    expect(plugin.acknowledgePurchase).toHaveBeenCalled();
  });

  it('BILL-APPLE-2 — a failed finish after a grant is still a purchase (the server already granted)', async () => {
    plugin.acknowledgePurchase.mockRejectedValue(new Error('Transaction not found'));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'purchased' });
  });

  it('BILL-MANAGE-1 — a user-cancelled StoreKit sheet resolves quietly', async () => {
    plugin.purchaseProduct.mockRejectedValue(pluginError('User cancelled'));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'cancelled' });
    expect(http.callHttp).not.toHaveBeenCalled();
  });

  it('BILL-MANAGE-1 — Ask to Buy / deferred is "pending", not a failure', async () => {
    plugin.purchaseProduct.mockRejectedValue(pluginError('Transaction pending'));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'pending' });
  });

  it('BILL-MANAGE-1 — a missing product is "unavailable"', async () => {
    plugin.purchaseProduct.mockRejectedValue(pluginError('Cannot find product for id com.wurld.app.plus.monthly'));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'unavailable' });
  });

  it('BILL-MANAGE-1 — never calls web checkout on iOS (BILL-MANAGE-4: no link-out)', async () => {
    await purchasePlus('u1');
    expect(web.startWebCheckout).not.toHaveBeenCalled();
  });
});

describe('BILL-GOOGLE-1/2 — Android', () => {
  beforeEach(() => {
    caps.android = true;
    plugin.purchaseProduct.mockResolvedValue({
      transactionId: 'tok-1',
      productIdentifier: 'wurld_plus',
      purchaseToken: 'tok-1',
      purchaseState: '1',
    });
  });

  it('BILL-GOOGLE-1/2 — obfuscatedAccountId via appAccountToken, base plan named, auto-acknowledge OFF', async () => {
    await purchasePlus('u1');
    expect(plugin.purchaseProduct).toHaveBeenCalledWith({
      productIdentifier: PLUS_PRODUCTS.google.productId,
      planIdentifier: PLUS_PRODUCTS.google.basePlanId,
      productType: 'subs',
      appAccountToken: 'token-for-u1',
      autoAcknowledgePurchases: false,
    });
  });

  it('BILL-GOOGLE-2 — posts {purchaseToken, productId} and NEVER acknowledges client-side', async () => {
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'purchased' });
    expect(http.callHttp).toHaveBeenCalledWith('googleSyncPurchase', { purchaseToken: 'tok-1', productId: 'wurld_plus' });
    expect(plugin.acknowledgePurchase).not.toHaveBeenCalled();
  });

  it('BILL-MANAGE-1 — USER_CANCELED resolves quietly', async () => {
    plugin.purchaseProduct.mockRejectedValue(pluginError('Purchase is not purchased', 'USER_CANCELED'));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'cancelled' });
  });

  it('BILL-MANAGE-1 — a pending Play purchase is "pending"', async () => {
    plugin.purchaseProduct.mockRejectedValue(pluginError('Purchase is pending'));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'pending' });
  });

  it('BILL-MANAGE-1 — BILLING_UNAVAILABLE is "unavailable"', async () => {
    plugin.purchaseProduct.mockRejectedValue(pluginError('Purchase is not purchased', 'BILLING_UNAVAILABLE'));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'unavailable' });
  });

  it('BILL-GOOGLE-2 — ITEM_ALREADY_OWNED re-syncs the owned subscription instead of failing', async () => {
    plugin.purchaseProduct.mockRejectedValue(pluginError('Purchase is not purchased', 'ITEM_ALREADY_OWNED'));
    plugin.getPurchases.mockResolvedValue({
      purchases: [{ productIdentifier: 'wurld_plus', purchaseToken: 'owned-1', purchaseState: '1', transactionId: 'owned-1' }],
    });
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'purchased' });
    expect(http.callHttp).toHaveBeenCalledWith('googleSyncPurchase', { purchaseToken: 'owned-1', productId: 'wurld_plus' });
  });

  it('BILL-GOOGLE-2 — a 403 is "wrong_account"', async () => {
    http.callHttp.mockRejectedValue(httpError('googleSyncPurchase', 403));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'wrong_account' });
  });
});

describe('BILL-APPLE-4 — restore', () => {
  it('BILL-APPLE-4 — iOS: syncs the store, then posts every CURRENT Plus entitlement\'s signed transaction', async () => {
    caps.ios = true;
    plugin.getPurchases.mockResolvedValue({
      purchases: [
        { transactionId: '1', productIdentifier: PLUS_PRODUCTS.apple.productId, jwsRepresentation: 'jws-1' },
        { transactionId: '2', productIdentifier: 'some.other.product', jwsRepresentation: 'jws-other' },
        { transactionId: '3', productIdentifier: PLUS_PRODUCTS.apple.productId },
      ],
    });
    await expect(restorePurchases('u1')).resolves.toEqual({ kind: 'restored' });
    expect(plugin.restorePurchases).toHaveBeenCalled();
    expect(plugin.getPurchases).toHaveBeenCalledWith({ onlyCurrentEntitlements: true, productType: 'subs' });
    expect(http.callHttp).toHaveBeenCalledWith('appleSyncTransaction', { signedTransactions: ['jws-1'] });
    expect(plugin.acknowledgePurchase).toHaveBeenCalledWith({ purchaseToken: '1' });
  });

  it('BILL-APPLE-4 — iOS: nothing to restore posts nothing', async () => {
    caps.ios = true;
    plugin.getPurchases.mockResolvedValue({ purchases: [] });
    await expect(restorePurchases('u1')).resolves.toEqual({ kind: 'nothing' });
    expect(http.callHttp).not.toHaveBeenCalled();
  });

  it('BILL-APPLE-4 — iOS: a restore of another account\'s purchase is "wrong_account"', async () => {
    caps.ios = true;
    plugin.getPurchases.mockResolvedValue({
      purchases: [{ transactionId: '1', productIdentifier: PLUS_PRODUCTS.apple.productId, jwsRepresentation: 'jws-1' }],
    });
    http.callHttp.mockRejectedValue(httpError('appleSyncTransaction', 403));
    await expect(restorePurchases('u1')).resolves.toEqual({ kind: 'wrong_account' });
    expect(plugin.acknowledgePurchase).not.toHaveBeenCalled();
  });

  it('BILL-GOOGLE-2 — Android: syncs each PURCHASED Plus purchase', async () => {
    caps.android = true;
    plugin.getPurchases.mockResolvedValue({
      purchases: [
        { productIdentifier: 'wurld_plus', purchaseToken: 'a', purchaseState: '1', transactionId: 'a' },
        { productIdentifier: 'wurld_plus', purchaseToken: 'pending', purchaseState: '0', transactionId: 'pending' },
      ],
    });
    await expect(restorePurchases('u1')).resolves.toEqual({ kind: 'restored' });
    expect(plugin.getPurchases).toHaveBeenCalledWith({ productType: 'subs' });
    expect(http.callHttp).toHaveBeenCalledTimes(1);
    expect(http.callHttp).toHaveBeenCalledWith('googleSyncPurchase', { purchaseToken: 'a', productId: 'wurld_plus' });
  });

  it('BILL-APPLE-4 — web has nothing to restore', async () => {
    await expect(restorePurchases('u1')).resolves.toEqual({ kind: 'unavailable' });
    expect(plugin.getPurchases).not.toHaveBeenCalled();
  });
});

describe('BILL-MANAGE-5 — the price shown is the one that will be charged', () => {
  it('BILL-MANAGE-5 — web shows PLUS_PRICE (the tax-inclusive Stripe price)', async () => {
    await expect(getPlusPrice()).resolves.toBe(PLUS_PRICE);
    expect(plugin.getProducts).not.toHaveBeenCalled();
  });

  it('BILL-MANAGE-5 — iOS shows StoreKit\'s localised price string', async () => {
    caps.ios = true;
    plugin.getProducts.mockResolvedValue({
      products: [{ identifier: PLUS_PRODUCTS.apple.productId, priceString: '2,99 €' }],
    });
    await expect(getPlusPrice()).resolves.toBe('2,99 €');
    expect(plugin.getProducts).toHaveBeenCalledWith({
      productIdentifiers: [PLUS_PRODUCTS.apple.productId],
      productType: 'subs',
    });
  });

  it('BILL-MANAGE-5 — Android picks the monthly BASE plan (identifier = base plan id), not an offer', async () => {
    caps.android = true;
    plugin.getProducts.mockResolvedValue({
      products: [
        { identifier: 'monthly', planIdentifier: 'wurld_plus', offerId: 'intro', priceString: '£0.99' },
        { identifier: 'monthly', planIdentifier: 'wurld_plus', offerId: null, priceString: '£2.49' },
      ],
    });
    await expect(getPlusPrice()).resolves.toBe('£2.49');
    expect(plugin.getProducts).toHaveBeenCalledWith({ productIdentifiers: ['wurld_plus'], productType: 'subs' });
  });

  it('BILL-MANAGE-5 — a store that cannot price the product answers null, never a guessed price', async () => {
    caps.ios = true;
    plugin.getProducts.mockRejectedValue(new Error('offline'));
    await expect(getPlusPrice()).resolves.toBeNull();
  });
});

/**
 * BILL-APPLE-2 / BILL-GOOGLE-2 — a purchase whose sync never landed must still
 * reach the server. The server IGNORES a store notification for a subscription
 * it has no grant for (billing.md, Apple / Google decisions), so the client is
 * the only thing that creates the grant — and Play refunds an unacknowledged
 * purchase after 3 days.
 */
describe('BILL-APPLE-2 / BILL-GOOGLE-2 — recovering a sync that never landed', () => {
  it('BILL-APPLE-2 — iOS: posts current Plus entitlements WITHOUT AppStore.sync (no sign-in prompt at launch)', async () => {
    caps.ios = true;
    plugin.getPurchases.mockResolvedValue({
      purchases: [{ transactionId: '9', productIdentifier: PLUS_PRODUCTS.apple.productId, jwsRepresentation: 'jws-9' }],
    });
    await syncOutstandingPurchases({ appleGrantLive: false });
    expect(plugin.restorePurchases).not.toHaveBeenCalled();
    expect(http.callHttp).toHaveBeenCalledWith('appleSyncTransaction', { signedTransactions: ['jws-9'] });
  });

  it('BILL-APPLE-2 — iOS: nothing to do when the account already has a live Apple grant', async () => {
    caps.ios = true;
    await syncOutstandingPurchases({ appleGrantLive: true });
    expect(plugin.getPurchases).not.toHaveBeenCalled();
    expect(http.callHttp).not.toHaveBeenCalled();
  });

  it('BILL-GOOGLE-2 — Android: posts only PURCHASED purchases the server has not acknowledged', async () => {
    caps.android = true;
    plugin.getPurchases.mockResolvedValue({
      purchases: [
        { productIdentifier: 'wurld_plus', purchaseToken: 'acked', purchaseState: '1', isAcknowledged: true },
        { productIdentifier: 'wurld_plus', purchaseToken: 'unacked', purchaseState: '1', isAcknowledged: false },
        { productIdentifier: 'wurld_plus', purchaseToken: 'pending', purchaseState: '0', isAcknowledged: false },
      ],
    });
    await syncOutstandingPurchases({ appleGrantLive: false });
    expect(http.callHttp).toHaveBeenCalledTimes(1);
    expect(http.callHttp).toHaveBeenCalledWith('googleSyncPurchase', { purchaseToken: 'unacked', productId: 'wurld_plus' });
  });

  it('BILL-MANAGE-1 — web: does nothing, and never throws', async () => {
    await expect(syncOutstandingPurchases({ appleGrantLive: false })).resolves.toBeUndefined();
    expect(plugin.getPurchases).not.toHaveBeenCalled();
  });

  it('BILL-APPLE-2 — a failure is swallowed (it runs at launch; it must never break boot)', async () => {
    caps.android = true;
    plugin.getPurchases.mockRejectedValue(new Error('QUERY_PURCHASES_FAILED'));
    await expect(syncOutstandingPurchases({ appleGrantLive: false })).resolves.toBeUndefined();
  });

  it('BILL-APPLE-2 — iOS: the plugin\'s transactionUpdated events (which it has already finished) are posted', async () => {
    caps.ios = true;
    const remove = vi.fn();
    let handler: (tx: unknown) => void = () => undefined;
    plugin.addListener.mockImplementation(async (_name: string, fn: (tx: unknown) => void) => {
      handler = fn;
      return { remove };
    });
    const stop = await listenForStoreTransactions();
    expect(plugin.addListener).toHaveBeenCalledWith('transactionUpdated', expect.any(Function));
    handler({ transactionId: '5', productIdentifier: PLUS_PRODUCTS.apple.productId, jwsRepresentation: 'jws-5' });
    handler({ transactionId: '6', productIdentifier: 'other', jwsRepresentation: 'jws-6' });
    await vi.waitFor(() =>
      expect(http.callHttp).toHaveBeenCalledWith('appleSyncTransaction', { signedTransactions: ['jws-5'] }),
    );
    expect(http.callHttp).toHaveBeenCalledTimes(1);
    stop();
    expect(remove).toHaveBeenCalled();
  });

  it('BILL-APPLE-2 — no listener off iOS', async () => {
    caps.android = true;
    const stop = await listenForStoreTransactions();
    expect(plugin.addListener).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});

describe('OBS-COVER-3 — billing failures reach Sentry with provider + action', () => {
  it('OBS-COVER-3 — a failed StoreKit purchase passes the error, provider apple', async () => {
    caps.ios = true;
    const err = pluginError('StoreKit exploded');
    plugin.purchaseProduct.mockRejectedValue(err);
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'failed' });
    expect(logMock.error).toHaveBeenCalledTimes(1);
    expect(logMock.error.mock.calls[0]?.[0]).toBe(err);
    expect(logMock.error.mock.calls[0]?.[1]).toMatchObject({ action: 'applePurchase', provider: 'apple' });
  });

  it('OBS-COVER-3 — a cancelled or pending purchase is not reported', async () => {
    caps.android = true;
    plugin.purchaseProduct.mockRejectedValueOnce(pluginError('cancelled', 'USER_CANCELED'));
    await purchasePlus('u1');
    plugin.purchaseProduct.mockRejectedValueOnce(pluginError('Purchase is pending'));
    await purchasePlus('u1');
    expect(logMock.error).not.toHaveBeenCalled();
  });

  it('OBS-COVER-3 — a failed server sync is reported with provider google + status', async () => {
    caps.android = true;
    plugin.purchaseProduct.mockResolvedValue({ purchaseToken: 'pt', productIdentifier: PLUS_PRODUCTS.google.productId });
    http.callHttp.mockRejectedValue(httpError('googleSyncPurchase', 500));
    await expect(purchasePlus('u1')).resolves.toEqual({ kind: 'failed' });
    expect(logMock.error).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'googleSyncPurchase', provider: 'google', httpStatus: 500 }),
    );
  });

  it('OBS-COVER-3 — a web checkout failure is reported with provider stripe', async () => {
    web.startWebCheckout.mockRejectedValue(new Error('boom'));
    await purchasePlus('u1');
    expect(logMock.error.mock.calls[0]?.[1]).toMatchObject({ action: 'purchasePlus', provider: 'stripe' });
  });

  it('OBS-COVER-3 — a restore failure is reported', async () => {
    caps.android = true;
    plugin.getPurchases.mockRejectedValue(new Error('play down'));
    await expect(restorePurchases('u1')).resolves.toEqual({ kind: 'failed' });
    expect(logMock.error.mock.calls[0]?.[1]).toMatchObject({ action: 'restorePurchases', provider: 'google' });
  });

  it('OBS-COVER-3 — the launch re-sync failure is reported (and still swallowed)', async () => {
    caps.ios = true;
    plugin.getPurchases.mockRejectedValue(new Error('storekit down'));
    await expect(syncOutstandingPurchases({ appleGrantLive: false })).resolves.toBeUndefined();
    expect(logMock.error.mock.calls[0]?.[1]).toMatchObject({ action: 'syncOutstandingPurchases', provider: 'apple' });
  });
});
