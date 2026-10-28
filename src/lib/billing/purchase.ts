/**
 * BILL-MANAGE-1 / BILL-APPLE-1/2/4 / BILL-GOOGLE-1/2 — buying and restoring Plus.
 *
 * Spec: docs/specs/billing.md.
 *
 * ## One entry point, three surfaces
 *
 * `purchasePlus(uid)` picks the surface from the RUNTIME (BILL-MANAGE-1), via
 * the capability predicates, never `Platform.OS`:
 *
 *   - iOS → StoreKit 2 through `@capgo/native-purchases`, with
 *     `appAccountToken = accountTokenForUid(uid)` and auto-finish OFF. The
 *     signed transaction (`jwsRepresentation`) goes to `appleSyncTransaction`,
 *     and the transaction is finished (`acknowledgePurchase({purchaseToken:
 *     transactionId})`, which on iOS is StoreKit's `transaction.finish()`) ONLY
 *     after a 2xx (BILL-APPLE-2).
 *   - Android → Play Billing through the same plugin. The plugin maps
 *     `appAccountToken` to `BillingFlowParams.setObfuscatedAccountId` (verified
 *     in its Java source), so the one UUID serves both stores (BILL-GOOGLE-1).
 *     `autoAcknowledgePurchases: false` because the SERVER acknowledges, after
 *     granting (BILL-GOOGLE-2) — the client never calls acknowledge on Android.
 *   - Web / PWA → `startWebCheckout()` (Stripe Checkout; the Stripe module's).
 *
 * ## Results are typed, never thrown
 *
 * The UI needs to tell "the user changed their mind" from "the store said
 * later" from "it broke", and a thrown error collapses those. Every path
 * resolves a `PurchaseOutcome`; a cancelled purchase resolves `cancelled`,
 * which the UI shows as nothing at all.
 *
 * ## The plugin is imported lazily
 *
 * Only the native branches load it, so the web bundle never carries the store
 * code and a web build cannot reach a store call by accident.
 */
import { callHttp } from '@/lib/endpoints';
import { accountTokenForUid } from '@/lib/accountToken';
import { canUseAppleIap, canUsePlayBilling } from '@/lib/capabilities';
import { PLUS_PRICE } from '@/lib/trial';
import * as log from '@/lib/log';
import { PLUS_PRODUCTS } from './products';
import { startWebCheckout } from './webCheckout';

export type PurchaseOutcome =
  /** Native: the server verified the purchase and granted Plus. */
  | { kind: 'purchased' }
  /** Web: the window is on its way to Stripe Checkout. */
  | { kind: 'redirected' }
  /** The user dismissed the store sheet. Say nothing. */
  | { kind: 'cancelled' }
  /** Ask to Buy / a Play pending payment: Plus arrives when it clears. */
  | { kind: 'pending' }
  /** 409 — a live grant from another source already exists (BILL-MANAGE-2). */
  | { kind: 'already_entitled' }
  /** 403 — the store purchase belongs to a different Wurld account (BILL-SEC-2). */
  | { kind: 'wrong_account' }
  /** 2xx, but the server did not find it live (e.g. BILL-SEC-4's sandbox rule). */
  | { kind: 'unconfirmed' }
  /** This device's store cannot sell it (no billing, product not found). */
  | { kind: 'unavailable' }
  | { kind: 'failed' };

export type RestoreOutcome =
  | { kind: 'restored' }
  | { kind: 'nothing' }
  | { kind: 'wrong_account' }
  | { kind: 'already_entitled' }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

type SyncResponse = { entitled?: unknown; projection?: unknown };
type SyncResult = 'entitled' | 'not_entitled' | 'wrong_account' | 'already_entitled' | 'failed';

const plugin = () => import('@capgo/native-purchases');

type BillingProvider = 'apple' | 'google' | 'stripe';

/** OBS-COVER-3 — which store this runtime sells through. */
function runtimeProvider(): BillingProvider {
  if (canUseAppleIap()) return 'apple';
  if (canUsePlayBilling()) return 'google';
  return 'stripe';
}

/** OBS-COVER-3 — a non-cancelled billing failure: the original error, labelled. */
function reportBillingFailure(
  err: unknown,
  action: string,
  provider: BillingProvider,
  extra: Record<string, unknown> = {},
): void {
  log.error(err, { action, provider, ...extra });
}

/** `callHttp` keeps the HTTP status at the end of its message
 *  (`callHttp <name> <status>`) — a shape other callers already parse. */
function httpStatusOf(err: unknown): number | null {
  const message = err instanceof Error ? err.message : '';
  const m = /\bcallHttp \S+ (\d{3})$/.exec(message);
  return m ? Number(m[1]) : null;
}

async function sync(
  name: 'appleSyncTransaction' | 'googleSyncPurchase',
  body: unknown,
): Promise<SyncResult> {
  try {
    const res = await callHttp<unknown, SyncResponse>(name, body);
    return res?.entitled === true ? 'entitled' : 'not_entitled';
  } catch (err) {
    const status = httpStatusOf(err);
    if (status === 403) return 'wrong_account';
    if (status === 409) return 'already_entitled';
    reportBillingFailure(err, name, name === 'appleSyncTransaction' ? 'apple' : 'google', {
      ...(status !== null ? { httpStatus: status } : {}),
    });
    return 'failed';
  }
}

type StoreError = 'cancelled' | 'pending' | 'already_owned' | 'unavailable' | 'failed';

/**
 * Map a plugin rejection. The plugin's own strings, from its sources:
 *   iOS  — "User cancelled", "Transaction pending", "Cannot find product for id …"
 *   Android — code USER_CANCELED / ITEM_ALREADY_OWNED / BILLING_UNAVAILABLE /
 *   FEATURE_NOT_SUPPORTED / BILLING_SETUP_FAILED; message "Purchase is pending",
 *   "Product not found".
 */
function classifyStoreError(err: unknown): StoreError {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  if (code === 'USER_CANCELED' || /user cancel/i.test(message)) return 'cancelled';
  if (/pending/i.test(message)) return 'pending';
  if (code === 'ITEM_ALREADY_OWNED') return 'already_owned';
  if (
    /^(BILLING_UNAVAILABLE|FEATURE_NOT_SUPPORTED|ITEM_UNAVAILABLE|BILLING_SETUP_FAILED)$/.test(code) ||
    /cannot find product|product not found/i.test(message)
  ) {
    return 'unavailable';
  }
  return 'failed';
}

function outcomeOfSync(r: SyncResult): PurchaseOutcome {
  switch (r) {
    case 'entitled':
      return { kind: 'purchased' };
    case 'not_entitled':
      return { kind: 'unconfirmed' };
    case 'wrong_account':
      return { kind: 'wrong_account' };
    case 'already_entitled':
      return { kind: 'already_entitled' };
    default:
      return { kind: 'failed' };
  }
}

/** Best-effort StoreKit finish after the server has answered 2xx. A failure
 *  here does not undo the grant; an unfinished transaction is re-delivered to
 *  the plugin's `Transaction.updates` listener and finished there. */
async function finishApple(transactionId: string): Promise<void> {
  try {
    const { NativePurchases } = await plugin();
    await NativePurchases.acknowledgePurchase({ purchaseToken: transactionId });
  } catch (err) {
    reportBillingFailure(err, 'appleFinish', 'apple');
  }
}

async function purchaseApple(uid: string): Promise<PurchaseOutcome> {
  const { NativePurchases, PURCHASE_TYPE } = await plugin();
  const appAccountToken = await accountTokenForUid(uid);
  let tx;
  try {
    tx = await NativePurchases.purchaseProduct({
      productIdentifier: PLUS_PRODUCTS.apple.productId,
      productType: PURCHASE_TYPE.SUBS,
      appAccountToken,
      autoAcknowledgePurchases: false,
    });
  } catch (err) {
    const e = classifyStoreError(err);
    // `pending` (Ask to Buy) is an outcome, not a failure (OBS-LABEL-10).
    if (e !== 'cancelled' && e !== 'pending') reportBillingFailure(err, 'applePurchase', 'apple', { storeError: e });
    return { kind: e === 'already_owned' ? 'failed' : e };
  }
  if (!tx.jwsRepresentation) {
    // Without the signed payload there is nothing the server may trust
    // (BILL-SEC-1). Left unfinished: StoreKit re-delivers it.
    reportBillingFailure(new Error('StoreKit transaction without jwsRepresentation'), 'applePurchase', 'apple');
    return { kind: 'failed' };
  }
  const r = await sync('appleSyncTransaction', { signedTransactions: [tx.jwsRepresentation] });
  if (r === 'entitled' || r === 'not_entitled') await finishApple(tx.transactionId);
  return outcomeOfSync(r);
}

async function purchaseGoogle(uid: string): Promise<PurchaseOutcome> {
  const { NativePurchases, PURCHASE_TYPE } = await plugin();
  const appAccountToken = await accountTokenForUid(uid);
  let tx;
  try {
    tx = await NativePurchases.purchaseProduct({
      productIdentifier: PLUS_PRODUCTS.google.productId,
      planIdentifier: PLUS_PRODUCTS.google.basePlanId,
      productType: PURCHASE_TYPE.SUBS,
      appAccountToken,
      autoAcknowledgePurchases: false,
    });
  } catch (err) {
    const e = classifyStoreError(err);
    if (e === 'already_owned') {
      // This Google account already owns Plus (bought on another device, or a
      // purchase whose sync never landed). Re-sync it instead of failing.
      const restored = await restoreGoogle();
      return restored.kind === 'restored'
        ? { kind: 'purchased' }
        : restored.kind === 'wrong_account' || restored.kind === 'already_entitled'
          ? { kind: restored.kind }
          : { kind: 'failed' };
    }
    if (e !== 'cancelled' && e !== 'pending') reportBillingFailure(err, 'googlePurchase', 'google', { storeError: e });
    return { kind: e };
  }
  if (!tx.purchaseToken) {
    reportBillingFailure(new Error('Play purchase without purchaseToken'), 'googlePurchase', 'google');
    return { kind: 'failed' };
  }
  return outcomeOfSync(
    await sync('googleSyncPurchase', {
      purchaseToken: tx.purchaseToken,
      productId: tx.productIdentifier || PLUS_PRODUCTS.google.productId,
    }),
  );
}

/** BILL-MANAGE-1 — buy Plus on whatever surface this runtime sells it on. */
export async function purchasePlus(uid: string): Promise<PurchaseOutcome> {
  try {
    if (canUseAppleIap()) return await purchaseApple(uid);
    if (canUsePlayBilling()) return await purchaseGoogle(uid);
    await startWebCheckout();
    return { kind: 'redirected' };
  } catch (err) {
    if (err instanceof Error && err.message === 'already_entitled') return { kind: 'already_entitled' };
    reportBillingFailure(err, 'purchasePlus', runtimeProvider());
    return { kind: 'failed' };
  }
}

function restoreOutcome(results: SyncResult[]): RestoreOutcome {
  if (results.length === 0) return { kind: 'nothing' };
  if (results.some((r) => r === 'entitled')) return { kind: 'restored' };
  if (results.includes('wrong_account')) return { kind: 'wrong_account' };
  if (results.includes('already_entitled')) return { kind: 'already_entitled' };
  if (results.every((r) => r === 'not_entitled')) return { kind: 'nothing' };
  return { kind: 'failed' };
}

/** Post every CURRENT Plus entitlement on this Apple ID, finishing each after
 *  a 2xx. `Transaction.currentEntitlements` is scoped to the signed-in Apple ID
 *  and to what is live now, so a shared or refurbished device cannot hand one
 *  person's history to another account. */
async function syncAppleEntitlements(): Promise<RestoreOutcome> {
  const { NativePurchases, PURCHASE_TYPE } = await plugin();
  const { purchases } = await NativePurchases.getPurchases({
    onlyCurrentEntitlements: true,
    productType: PURCHASE_TYPE.SUBS,
  });
  const plus = purchases.filter(
    (p) => p.productIdentifier === PLUS_PRODUCTS.apple.productId && typeof p.jwsRepresentation === 'string',
  );
  if (plus.length === 0) return { kind: 'nothing' };
  const r = await sync('appleSyncTransaction', { signedTransactions: plus.map((p) => p.jwsRepresentation) });
  if (r === 'entitled' || r === 'not_entitled') {
    for (const p of plus) await finishApple(p.transactionId);
  }
  return restoreOutcome([r]);
}

async function restoreApple(): Promise<RestoreOutcome> {
  const { NativePurchases } = await plugin();
  try {
    // `AppStore.sync()` — may ask the user to sign in to the App Store, which
    // is why only the user-initiated Restore calls it.
    await NativePurchases.restorePurchases();
  } catch (err) {
    if (classifyStoreError(err) === 'cancelled') return { kind: 'cancelled' };
    // A failed sync still leaves the device's own entitlements readable.
    reportBillingFailure(err, 'appleRestore', 'apple', { fallback: 'localEntitlements' });
  }
  return syncAppleEntitlements();
}

async function restoreGoogle(opts: { onlyUnacknowledged?: boolean } = {}): Promise<RestoreOutcome> {
  const { NativePurchases, PURCHASE_TYPE } = await plugin();
  const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.SUBS });
  // purchaseState "1" = PURCHASED; "2" is pending and not yet grantable.
  // Unacknowledged = the server has not granted it yet (it acknowledges only
  // after granting, BILL-GOOGLE-2).
  const plus = purchases.filter(
    (p) =>
      p.productIdentifier === PLUS_PRODUCTS.google.productId &&
      p.purchaseState === '1' &&
      p.purchaseToken &&
      (!opts.onlyUnacknowledged || p.isAcknowledged === false),
  );
  const results: SyncResult[] = [];
  for (const p of plus) {
    results.push(
      await sync('googleSyncPurchase', { purchaseToken: p.purchaseToken, productId: p.productIdentifier }),
    );
  }
  return restoreOutcome(results);
}

/** BILL-APPLE-4 — re-sync every current store entitlement for this user.
 *  The uid is not sent: the server resolves the caller from the ID token and
 *  checks each purchase's account token against it (BILL-SEC-2). */
export async function restorePurchases(uid: string): Promise<RestoreOutcome> {
  void uid;
  try {
    if (canUseAppleIap()) return await restoreApple();
    if (canUsePlayBilling()) return await restoreGoogle();
    return { kind: 'unavailable' };
  } catch (err) {
    reportBillingFailure(err, 'restorePurchases', runtimeProvider());
    return { kind: 'failed' };
  }
}

/**
 * BILL-APPLE-2 / BILL-GOOGLE-2 — recover purchases whose sync never landed
 * (app killed mid-purchase, a 5xx, a Play purchase that was pending and has
 * since cleared). The server ignores a store notification for a subscription
 * it holds no grant for, so without this the user has paid and has nothing —
 * and on Play the purchase is refunded after 3 days unacknowledged.
 *
 *   - iOS: re-post current Plus entitlements, WITHOUT `AppStore.sync()` (no
 *     sign-in prompt at launch), and only when the account has no live Apple
 *     grant already — otherwise every launch would cost a status-API call.
 *   - Android: post only PURCHASED Plus purchases that are still
 *     unacknowledged, i.e. that the server has not granted.
 *
 * Runs at launch, so it never throws.
 */
export async function syncOutstandingPurchases(opts: { appleGrantLive: boolean }): Promise<void> {
  try {
    if (canUseAppleIap()) {
      if (!opts.appleGrantLive) await syncAppleEntitlements();
    } else if (canUsePlayBilling()) {
      await restoreGoogle({ onlyUnacknowledged: true });
    }
  } catch (err) {
    reportBillingFailure(err, 'syncOutstandingPurchases', runtimeProvider());
  }
}

/**
 * BILL-APPLE-2 — the plugin runs its own `Transaction.updates` loop, FINISHES
 * every verified transaction it sees there (unfinished ones at launch,
 * renewals, purchases made outside the app) and only then emits
 * `transactionUpdated`. So "finish only after a 2xx" cannot hold for those;
 * posting the JWS here is what still gets them to the server. Renewals of a
 * known subscription are also covered server-side (BILL-APPLE-3); this is for
 * the ones it has no grant for. iOS only; resolves a no-op elsewhere.
 *
 * ⚠ Capacitor does not retain these events: one emitted before this listener
 * is attached is lost, which is why `syncOutstandingPurchases` exists too.
 */
export async function listenForStoreTransactions(): Promise<() => void> {
  if (!canUseAppleIap()) return () => undefined;
  try {
    const { NativePurchases } = await plugin();
    const handle = await NativePurchases.addListener('transactionUpdated', (tx) => {
      if (tx.productIdentifier !== PLUS_PRODUCTS.apple.productId || !tx.jwsRepresentation) return;
      void sync('appleSyncTransaction', { signedTransactions: [tx.jwsRepresentation] });
    });
    return () => {
      void handle.remove();
    };
  } catch (err) {
    reportBillingFailure(err, 'listenForStoreTransactions', 'apple');
    return () => undefined;
  }
}

let priceCache: Promise<string | null> | null = null;

async function fetchStorePrice(): Promise<string | null> {
  const { NativePurchases, PURCHASE_TYPE } = await plugin();
  if (canUseAppleIap()) {
    const id = PLUS_PRODUCTS.apple.productId;
    const { products } = await NativePurchases.getProducts({ productIdentifiers: [id], productType: PURCHASE_TYPE.SUBS });
    return products.find((p) => p.identifier === id)?.priceString ?? null;
  }
  // Play: one entry per offer, and `identifier` is the BASE PLAN id while
  // `planIdentifier` is the product id (the plugin's own definitions). The base
  // offer is the one with no `offerId`.
  const { productId, basePlanId } = PLUS_PRODUCTS.google;
  const { products } = await NativePurchases.getProducts({
    productIdentifiers: [productId],
    productType: PURCHASE_TYPE.SUBS,
  });
  const onPlan = products.filter(
    (p) => p.identifier === basePlanId && (p.planIdentifier == null || p.planIdentifier === productId),
  );
  return (onPlan.find((p) => !p.offerId) ?? onPlan[0])?.priceString ?? null;
}

/**
 * BILL-MANAGE-5 — the price the user will actually be charged. The store's
 * localised string on native (Apple and Google set it per storefront, in the
 * local currency); `PLUS_PRICE` on the web, the Stripe price in the currency
 * Checkout will pick for this visitor (BILL-MANAGE-7). `null` when a store cannot price it — never a guess,
 * because a price shown next to a store purchase must be the store's.
 */
export function getPlusPrice(): Promise<string | null> {
  if (!canUseAppleIap() && !canUsePlayBilling()) return Promise.resolve(PLUS_PRICE);
  if (!priceCache) {
    priceCache = fetchStorePrice()
      .catch((err: unknown) => {
        reportBillingFailure(err, 'getPlusPrice', runtimeProvider());
        return null;
      })
      .then((price) => {
        if (price === null) priceCache = null; // only a real price is memoised; retry next open
        return price;
      });
  }
  return priceCache;
}

/** Tests only: forget the memoised store price. */
export function resetPlusPriceCache(): void {
  priceCache = null;
}
