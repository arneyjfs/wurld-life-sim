import { useEffect, useState } from 'react';
import { getPlusPrice } from '@/lib/billing/purchase';
import { canUseAppleIap, canUsePlayBilling } from '@/lib/capabilities';
import { PLUS_PRICE } from '@/lib/trial';

/**
 * BILL-MANAGE-4 / BILL-MANAGE-5 — the Plus price to SHOW.
 *
 * Web: `PLUS_PRICE` for the visitor's region (BILL-MANAGE-7), synchronously. Store builds: the
 * store's localised price once it answers, `null` until then (and if it never
 * can) — a price next to a store purchase must be the store's, never a guess,
 * and a native app must not name the web price at all.
 */
export function usePlusPrice(): string | null {
  const store = canUseAppleIap() || canUsePlayBilling();
  const [price, setPrice] = useState<string | null>(store ? null : PLUS_PRICE);
  useEffect(() => {
    if (!store) return;
    let live = true;
    void getPlusPrice().then((p) => {
      if (live) setPrice(p);
    });
    return () => {
      live = false;
    };
  }, [store]);
  return price;
}
