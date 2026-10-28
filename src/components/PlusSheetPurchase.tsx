/**
 * BILL-MANAGE-1/2/5 — the bottom of `PlusSheet`: the purchase button, its
 * price, its outcome, and the dismiss.
 *
 * Spec: docs/specs/billing.md §BILL-MANAGE, language-tiers.md LANG-SET-6.3.
 * Render-only; `usePlusPurchase` owns the state.
 *
 * ## The button is `PlusCta`'s pill, drawn here — and why not `PlusCta` itself
 *
 * LANG-SET-6.3's contract holds: first line "Unlock…", second line
 * `plus.ctaPeriod` ("Wurld Plus · {price} /month"), so the control names the
 * product, the price and the period, and never says Buy/Subscribe/Checkout.
 * But `PlusCta` renders the fixed `PLUS_PRICE`, and on a native build the price
 * next to a store purchase must be the STORE's localised one (BILL-MANAGE-5;
 * App Store 3.1.2). So this draws the same pill with the price from
 * `getPlusPrice()`. Folding a price source into `PlusCta` is a follow-up
 * recorded in billing.md — every other CTA has the same native problem.
 *
 * ## Who sees what (BILL-MANAGE-2)
 *
 *   - already Plus (paid, manual, grandfathered) → "You have Wurld Plus" and a
 *     close; no price anywhere.
 *   - can buy (signed in, loaded, not Plus — trialists included) → the button.
 *   - otherwise (signed out, loading) → just the close.
 */
import { useT } from '@/i18n';
import { useLegalConfig } from '@/hooks/useLegalConfig';
import { usePlusPurchase, type PurchaseStatus } from '@/hooks/usePlusPurchase';
import type { MessageKey } from '@/i18n/locales/en';
import { WEB_PLUS_PRICE } from '@/lib/billing/webPrice';
import { canUseAppleIap, canUsePlayBilling } from '@/lib/capabilities';
import { onExternalLinkClick } from '@/lib/openExternal';

const STATUS_COPY: Partial<Record<PurchaseStatus, MessageKey>> = {
  purchased: 'plus.statusPurchased',
  redirected: 'plus.statusRedirecting',
  pending: 'plus.statusPending',
  already_entitled: 'plus.statusAlreadyEntitled',
  wrong_account: 'plus.statusWrongAccount',
  unconfirmed: 'plus.statusUnconfirmed',
  failed: 'plus.statusFailed',
  unavailable: 'plus.statusUnavailable',
};

const FILLED =
  'rounded-full bg-gradient-accent px-4 py-3 text-sm font-semibold text-(--color-accent-fg)';

export function PlusSheetPurchase({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const legal = useLegalConfig();
  const { hasPlus, canBuy, price, status, buy } = usePlusPurchase(open);

  if (hasPlus) {
    return (
      <>
        <p className="text-center text-sm font-medium text-(--color-fg)" data-testid="plus-sheet-has-plus">
          {status === 'purchased' ? t('plus.statusPurchased') : t('plus.hasPlus')}
        </p>
        <button type="button" onClick={onClose} className={FILLED} data-testid="plus-sheet-close">
          {t('plus.close')}
        </button>
      </>
    );
  }

  if (!canBuy) {
    return (
      <button type="button" onClick={onClose} className={FILLED} data-testid="plus-sheet-close">
        {t('plus.close')}
      </button>
    );
  }

  const working = status === 'working';
  const statusKey = price === null && status === 'idle' ? 'plus.statusUnavailable' : STATUS_COPY[status];
  const terms = legal.status === 'ready' ? legal.termsUrl : 'https://wurld.chat/terms';
  const privacy = legal.status === 'ready' ? legal.privacyUrl : 'https://wurld.chat/privacy';

  return (
    <>
      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={buy}
          disabled={working || status === 'redirected' || price == null}
          aria-busy={working}
          className="w-full rounded-full bg-gradient-accent px-5 py-2.5 text-center text-(--color-accent-fg) disabled:opacity-60"
          data-testid="plus-sheet-purchase"
        >
          <span className="block text-sm font-semibold">
            {working ? t('plus.purchaseWorking') : t('plus.ctaUnlock')}
          </span>
          {price !== null && (
            <span className="block text-xs opacity-90">
              {price === undefined ? t('plus.priceLoading') : t('plus.ctaPeriod', { price })}
            </span>
          )}
        </button>
        <p className="text-center text-xs text-(--color-fg-muted)" data-testid="plus-sheet-terms">
          {t('plus.renewalTerms')}{' '}
          {/* BILL-MANAGE-7.2 — web, US dollars only: that price excludes tax. */}
          {!canUseAppleIap() && !canUsePlayBilling() && !WEB_PLUS_PRICE.taxIncluded && (
            <>{t('plus.salesTaxNote')} </>
          )}
          <a href={terms} target="_blank" rel="noreferrer noopener" onClick={(e) => onExternalLinkClick(e, terms)} className="underline">
            {t('plus.termsLink')}
          </a>
          {' · '}
          <a href={privacy} target="_blank" rel="noreferrer noopener" onClick={(e) => onExternalLinkClick(e, privacy)} className="underline">
            {t('plus.privacyLink')}
          </a>
        </p>
      </div>

      {statusKey && (
        <p
          role="status"
          className="text-center text-sm text-(--color-fg)"
          data-testid="plus-sheet-status"
        >
          {t(statusKey)}
        </p>
      )}

      {/* The neutral secondary `TrialExpiredSheet` already uses under a filled
          accent CTA: two filled pills stacked read as one control's states. */}
      <button
        type="button"
        onClick={onClose}
        className="rounded-full border border-(--color-border-strong) px-4 py-3 text-sm font-semibold text-(--color-fg)"
        data-testid="plus-sheet-close"
      >
        {t('plus.notNow')}
      </button>
    </>
  );
}
