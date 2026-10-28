// @vitest-environment jsdom
/**
 * BILL-STRIPE-1 / BILL-STRIPE-5 / BILL-MANAGE-2 — the web purchase and
 * management calls.
 *
 * Spec: docs/specs/billing.md §BILL-STRIPE. Signatures are fixed: the
 * purchase UI (`purchase.ts`, `manageSubscriptions.ts`) calls these.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ callHttp: vi.fn() }));
vi.mock('@/lib/endpoints', () => ({ callHttp: http.callHttp }));
// NATIVE-STORE-3 — the runtime gate; true (browser / PWA) unless a test says otherwise.
const caps = vi.hoisted(() => ({ webPurchase: true }));
vi.mock('@/lib/capabilities', () => ({ canLinkToWebPurchase: () => caps.webPurchase }));

import { _setNavigateForTest, openStripePortal, startWebCheckout } from './webCheckout';

/** How `callHttp` rejects a non-2xx (status kept in the message). */
const httpError = (name: string, status: number) => new Error(`callHttp ${name} ${status}`);

const navigate = vi.fn();

beforeEach(() => {
  caps.webPurchase = true;
  vi.clearAllMocks();
  _setNavigateForTest(navigate);
  window.history.replaceState(null, '', '/settings?tab=plan#x');
});

describe('BILL-STRIPE-1 — startWebCheckout', () => {
  it('BILL-STRIPE-1 — posts stripeCreateCheckout with this page as returnTo, then navigates to the Checkout url', async () => {
    http.callHttp.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_1', id: 'cs_1' });
    await startWebCheckout();
    expect(http.callHttp).toHaveBeenCalledWith('stripeCreateCheckout', {
      returnTo: `${window.location.origin}/settings`,
    });
    expect(navigate).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1');
  });

  it('BILL-STRIPE-6 — Checkout started from a CHAT page still returns to /settings, where its result is shown', async () => {
    window.history.replaceState(null, '', '/chat/abc123/info');
    http.callHttp.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_2', id: 'cs_2' });
    await startWebCheckout();
    expect(http.callHttp).toHaveBeenCalledWith('stripeCreateCheckout', {
      returnTo: `${window.location.origin}/settings`,
    });
  });

  it("BILL-MANAGE-2 — a 409 rejects with Error('already_entitled') and navigates nowhere", async () => {
    http.callHttp.mockRejectedValue(httpError('stripeCreateCheckout', 409));
    await expect(startWebCheckout()).rejects.toThrow(/^already_entitled$/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('BILL-STRIPE-1 — any other failure rejects as it came (no navigation)', async () => {
    http.callHttp.mockRejectedValue(httpError('stripeCreateCheckout', 502));
    await expect(startWebCheckout()).rejects.toThrow('callHttp stripeCreateCheckout 502');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('BILL-STRIPE-1 — a response without an https url is refused, never navigated to', async () => {
    for (const url of ['javascript:alert(1)', 'http://checkout.stripe.com/x', '', undefined]) {
      http.callHttp.mockResolvedValue({ url });
      await expect(startWebCheckout()).rejects.toThrow('bad_checkout_url');
    }
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('BILL-STRIPE-5 — openStripePortal', () => {
  it('BILL-STRIPE-5 — posts stripeCreatePortal and navigates to the portal url', async () => {
    http.callHttp.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/abc' });
    await openStripePortal();
    expect(http.callHttp).toHaveBeenCalledWith('stripeCreatePortal', {
      returnTo: `${window.location.origin}/settings`,
    });
    expect(navigate).toHaveBeenCalledWith('https://billing.stripe.com/p/session/abc');
  });

  it("BILL-STRIPE-5 — a 404 rejects with Error('no_customer')", async () => {
    http.callHttp.mockRejectedValue(httpError('stripeCreatePortal', 404));
    await expect(openStripePortal()).rejects.toThrow(/^no_customer$/);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('BILL-STRIPE-5 — other failures pass through', async () => {
    http.callHttp.mockRejectedValue(httpError('stripeCreatePortal', 500));
    await expect(openStripePortal()).rejects.toThrow('callHttp stripeCreatePortal 500');
  });
});

describe('NATIVE-STORE-3 — the web purchase calls refuse in a native shell', () => {
  it('NATIVE-STORE-3 — startWebCheckout rejects before any network call or navigation', async () => {
    caps.webPurchase = false;
    http.callHttp.mockResolvedValue({ url: 'https://checkout.stripe.com/c/pay/cs_1' });
    await expect(startWebCheckout()).rejects.toThrow(/^web_purchase_unavailable$/);
    expect(http.callHttp).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('NATIVE-STORE-3 — openStripePortal rejects before any network call or navigation', async () => {
    caps.webPurchase = false;
    http.callHttp.mockResolvedValue({ url: 'https://billing.stripe.com/p/session/abc' });
    await expect(openStripePortal()).rejects.toThrow(/^web_purchase_unavailable$/);
    expect(http.callHttp).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
