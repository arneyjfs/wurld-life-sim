/**
 * BILL-STRIPE-1/5 — the web purchase + management calls (PWA / web build).
 * `wurld.chat/account` (wurld-welcome) calls the same two endpoints
 * (BILL-STRIPE-6).
 *
 * Signatures are FIXED: the purchase UI (`purchase.ts`,
 * `manageSubscriptions.ts`) calls them.
 *
 * - `returnTo` is this page (origin + path). The server accepts only our own
 *   origins and appends `?billing=success|cancel`; the app reads that marker
 *   with `useWebCheckoutReturn` (BILL-STRIPE-7).
 * - Only an `https:` URL from the server is ever navigated to.
 * - NATIVE-STORE-3 (docs/specs/native-shell.md): both refuse with
 *   Error('web_purchase_unavailable') in a store shell, before any network
 *   call or navigation (`canLinkToWebPurchase`).
 */
import { canLinkToWebPurchase } from '@/lib/capabilities';
import { callHttp } from '@/lib/endpoints';

let navigate: (url: string) => void = (url) => {
  window.location.assign(url);
};

/** Test-only: replace the navigation. */
export function _setNavigateForTest(fn: (url: string) => void): void {
  navigate = fn;
}

/** `callHttp` keeps the status in its message: `callHttp <name> <status>`. */
function httpStatus(err: unknown): number | null {
  const m = /^callHttp \S+ (\d{3})$/.exec((err as { message?: unknown })?.message as string ?? '');
  return m ? Number(m[1]) : null;
}

/** BILL-STRIPE-6 — Checkout always comes back to Settings, the one page that
 *  shows its outcome (`useWebCheckoutReturn` on the Plan card). Returning to
 *  a chat page would drop the "finishing up" state on the floor. */
function checkoutReturnTo(): string {
  return `${window.location.origin}/settings`;
}

/** The Portal returns to wherever the user opened it from. */
function returnTo(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/** NATIVE-STORE-3 — no web purchase or management page from a store shell. */
function assertWebPurchaseAllowed(): void {
  if (!canLinkToWebPurchase()) throw new Error('web_purchase_unavailable');
}

function safeHttpsUrl(url: unknown): string {
  if (typeof url !== 'string') throw new Error('bad_checkout_url');
  try {
    if (new URL(url).protocol === 'https:') return url;
  } catch {
    // fall through
  }
  throw new Error('bad_checkout_url');
}

/** Start Stripe Checkout for Plus and navigate the window to it.
 *  Rejects with Error('already_entitled') on 409. */
export async function startWebCheckout(): Promise<void> {
  assertWebPurchaseAllowed();
  let res: { url?: unknown };
  try {
    res = await callHttp<{ returnTo: string }, { url?: unknown }>('stripeCreateCheckout', { returnTo: checkoutReturnTo() });
  } catch (err) {
    if (httpStatus(err) === 409) throw new Error('already_entitled', { cause: err });
    throw err;
  }
  navigate(safeHttpsUrl(res?.url));
}

/** Open the Stripe Customer Portal for the signed-in user.
 *  Rejects with Error('no_customer') on 404. */
export async function openStripePortal(): Promise<void> {
  assertWebPurchaseAllowed();
  let res: { url?: unknown };
  try {
    res = await callHttp<{ returnTo: string }, { url?: unknown }>('stripeCreatePortal', { returnTo: returnTo() });
  } catch (err) {
    if (httpStatus(err) === 404) throw new Error('no_customer', { cause: err });
    throw err;
  }
  navigate(safeHttpsUrl(res?.url));
}
