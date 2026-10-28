import { WurldPlusMark } from '@/components/WurldPlusMark';
import { useT } from '@/i18n';
import { usePlusPrice } from '@/hooks/usePlusPrice';

/**
 * LANG-SET-6.3 — the upgrade CTA, drawn the same way everywhere it appears.
 *
 * Spec: docs/specs/language-tiers.md §2 (LANG-SET-6.2, LANG-SET-6.3).
 *
 * ## Why a component and not a class string
 *
 * Before this there were five shapes for one offer: a filled pill with the
 * price on two lines, a filled pill with no price on one, an outline pill, a
 * bare accent text link, and a small `rounded-lg` button. Three named the
 * product, two named the price, and no two agreed. The owner's instruction —
 * *"I like the shared key. Use a style like that for all modals"* — is only
 * enforceable if the shape and the second line live in one place; a convention
 * spread across five files is the thing that produced five files.
 *
 * ## The second line is NOT a prop, and the first one is
 *
 * `plus.ctaPeriod` — *"Wurld Plus · {price} /month"* — is the component's own.
 * A caller cannot forget to name the product and cannot invent a second
 * phrasing of the price. That is not fussiness: the first time this CTA shipped
 * with the label as its only line, the label was worded exactly as the owner
 * asked, the word "Plus" left the sheet entirely, and what remained asked for
 * {price} a month without saying what it sold. `LANG-SET-6.1` bans every
 * alternative word ("paid", "paid members") because they are false for a
 * trialist, so the product name is the only accurate one — and it is now
 * structurally impossible to drop.
 *
 * The LABEL is per-surface because `LANG-TIER-1.1` is a TABLE. "Unlock all 85
 * languages" is exactly true where the constraint is the language set and
 * plainly wrong on the practice gate, which is not about languages at all.
 *
 * ## "Unlock", never "Buy"
 *
 * There is no purchase path in this build (`LANG-SEC-3`) and what this opens is
 * `PlusSheet`, which says Plus is not on sale yet. "Unlock" is a verb about
 * access and survives that; a checkout verb would promise a transaction that
 * opens nothing. The PRICE on the control is the owner's decision, recorded at
 * `LANG-SET-6.2` across three revisions — see it before narrowing this again.
 *
 * ## It does not own the sheet
 *
 * Callers pass `onClick`. Three of them already mount their own `PlusSheet`,
 * one closes a picker first, and one is inside a bottom sheet that has to
 * dismiss before a second can open. A `PlusSheet` in here would be a fourth
 * mount racing the three.
 */
export function PlusCta({
  label,
  detail,
  onClick,
  testId,
  variant = 'pill',
  className,
}: {
  /** The first line — what THIS surface unlocks. See the header. */
  label: string;
  /** LANG-SET-6.3 — the label's benefits, spelled out; never replaces the
   *  product line. A row shares its second line with it ("{detail} · Wurld
   *  Plus"); a pill shows the detail inside and the product line under it. */
  detail?: string;
  /** Open `PlusSheet`. The component never navigates on its own. */
  onClick: () => void;
  data?: never;
  testId: string;
  /**
   * `pill` is the sheet/modal shape: a filled accent lozenge sized to its own
   * content. `row` is the chat-info shape — a full-bleed settings row that sits
   * under the two language pickers.
   */
  variant?: 'pill' | 'row';
  className?: string;
}) {
  const t = useT();
  // BILL-MANAGE-5 — the store's price in a store build (none until it
  // answers: the product is named without a price rather than a guessed one).
  const price = usePlusPrice();
  const period = price ? t('plus.ctaPeriod', { price }) : t('plus.ctaName');
  // A row: one second line, not a third (owner, 2026-10-26).
  const sub = detail ? `${detail} · ${period}` : period;

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className={
          'flex w-full items-center justify-center gap-3 px-4 py-3 hover:bg-(--color-bg-hover) '
          + (className ?? '')
        }
      >
        {/* ⚠ CENTRED as a GROUP, not left-aligned behind the icon — owner,
            2026-09-21. The two rows above are left-aligned behind their flags,
            and this is the last thing distinguishing it from them: it is not
            another language. The wrapper exists so the E2E spec can measure
            what is centred — the row is full-bleed, so its own box says
            nothing, and `docs/conventions.md` forbids reading the class. */}
        <span
          className="flex items-center gap-3 text-center"
          data-testid={`${testId}-content`}
        >
          {/* The rows above this one carry a FLAG in this slot. A tinted accent
              disc is the smallest thing that says "not another language"
              without a second heading to explain it. */}
          {/* The Wurld Plus mark (owner, 2026-10-23: "should be the Wurld
              Plus icon"), the same one Settings' plan badge carries. */}
          <WurldPlusMark size={28} className="shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-(--color-accent)">{label}</span>
            <span className="block text-xs text-(--color-fg-muted)" data-testid={`${testId}-sub`}>{sub}</span>
          </span>
        </span>
        {/* ⚠ NO CHEVRON, deliberately. Owner: *"no arrow on far right like the
            pickers."* The two rows above open a picker and come back to this
            screen; this one leaves for a sheet. Same glyph for a different
            outcome is how a control teaches the wrong gesture. */}
      </button>
    );
  }

  const pill = (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={
        'rounded-full bg-gradient-accent px-5 py-2.5 text-center text-(--color-accent-fg) '
        + (detail ? 'w-full ' : '')
        + (className ?? '')
      }
    >
      <span className="block text-sm font-semibold">{label}</span>
      {detail ? (
        <span className="block text-xs opacity-90" data-testid={`${testId}-detail`}>{detail}</span>
      ) : (
        <span className="block text-xs opacity-90" data-testid={`${testId}-sub`}>{period}</span>
      )}
    </button>
  );
  if (!detail) return pill;
  // A pill with a detail: the product line moves under it, so the button
  // stays two short lines (owner, 2026-10-27).
  return (
    <div className="flex flex-col items-center gap-1">
      {pill}
      <span className="text-xs text-(--color-fg-muted)" data-testid={`${testId}-sub`}>{period}</span>
    </div>
  );
}
