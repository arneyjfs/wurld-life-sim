/**
 * BILL-MANAGE-1/2/5 — the state behind `PlusSheet`'s purchase button.
 *
 * Spec: docs/specs/billing.md. The component stays render-only; this owns who
 * may be sold to, the price, and the in-flight purchase.
 *
 * ## Who is offered Plus (BILL-MANAGE-2)
 *
 * Anyone WITHOUT a paid-or-given plan: `hasPaidPlan` (the bounded
 * `plan === 'pro'`, BILL-ENT-2) is false. A trialist IS offered it — a trial is
 * the moment the offer matters. Paying, manual and grandfathered accounts all
 * carry `plan: 'pro'` and are offered nothing. While the profile loads, nothing
 * is offered: selling to a subscriber for the width of a cold boot is the worse
 * of the two mistakes.
 *
 * ⚠ The clock is captured at mount (`react-hooks/purity`), the LANG-TRIAL-5
 * pattern. A plan lapsing while the sheet host is mounted keeps the offer
 * hidden until remount — the direction that never sells twice.
 */
import { useEffect, useRef, useState } from 'react';
import { useCurrentUid } from '@/hooks/useCurrentUid';
import { useUserProfile } from '@/hooks/useUserProfile';
import { hasPaidPlan } from '@/lib/entitlement';
import { getPlusPrice, purchasePlus, type PurchaseOutcome } from '@/lib/billing/purchase';

export type PurchaseStatus = 'idle' | 'working' | PurchaseOutcome['kind'];

export type PlusPurchaseState = {
  /** Profile loaded and the account already has paid / given Plus. */
  hasPlus: boolean;
  /** Profile loaded, signed in, and NOT already Plus: show the button. */
  canBuy: boolean;
  /** `undefined` while loading; `null` when the store cannot price it. */
  price: string | null | undefined;
  status: PurchaseStatus;
  buy: () => void;
};

export function usePlusPurchase(open: boolean): PlusPurchaseState {
  const uid = useCurrentUid();
  const profile = useUserProfile(uid);
  const [nowAtMount] = useState(() => Date.now());
  const [price, setPrice] = useState<string | null | undefined>(undefined);
  const [status, setStatus] = useState<PurchaseStatus>('idle');
  // A ref, not the state: two taps inside one frame both see `status ===
  // 'idle'` in their closure, and a double charge is the one bug here that
  // costs the user money.
  const inFlight = useRef(false);

  const loaded = !!uid && !profile.loading && !!profile.data;
  const hasPlus = loaded && hasPaidPlan(profile.data, nowAtMount);
  const canBuy = loaded && !hasPlus;

  useEffect(() => {
    if (!open || !canBuy) return;
    let live = true;
    void getPlusPrice().then((p) => {
      if (live) setPrice(p);
    });
    return () => {
      live = false;
    };
  }, [open, canBuy]);

  const buy = () => {
    if (!uid || inFlight.current || status === 'redirected') return;
    inFlight.current = true;
    setStatus('working');
    void purchasePlus(uid).then((outcome) => {
      inFlight.current = false;
      // A cancel says nothing: the user changed their mind, which is not news.
      setStatus(outcome.kind === 'cancelled' ? 'idle' : outcome.kind);
    });
  };

  return { hasPlus, canBuy, price, status, buy };
}
