import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { PlusCta } from '@/components/PlusCta';
import { PlusSheet } from '@/components/PlusSheet';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';

type Props = {
  /** Localised heading — names the feature, not the tier. */
  title: string;
  /** One or two lines: what it does, and what it costs the reader to get it.
   *  Optional for a compact panel (EXPLAIN-PHRASE-4: title + button only). */
  body?: string;
  /** Root testid. The CTA is `${testId}-see-plus`. */
  testId: string;
  /** Layout passthrough — callers place this in very different boxes. */
  className?: string;
};

/**
 * LANG-TIER-1.1 — the panel a free user meets where a paid surface would be.
 *
 * Spec: docs/specs/language-tiers.md §4 (LANG-TIER-1.1), §5c (LANG-FREE-8),
 * §2 (LANG-SET-6.3 — the shared CTA, and why this surface's label is not the
 * languages one).
 *
 * ## It is an OFFER, not a wall
 *
 * LANG-FREE-8's rules for the passthrough strip apply here for the same
 * reason: this is the moment the product is asking somebody to pay, and copy
 * that reads as breakage spends that moment complaining. So it never says
 * "paused", never reassures the reader about data being kept (nothing has been
 * taken), and its only action opens the sheet where the decision is actually
 * made.
 *
 * ## Why one component for three surfaces
 *
 * Explain, the practice hub and the practice route all need the same three
 * things: name the feature, say one Plus covers it, offer the sheet. Three
 * copies would drift — and LANG-TIER-1.1's own warning is that a surface
 * claiming something the sheet contradicts is worse than a shorter sheet. One
 * component means one route into `PlusSheet` and one place a claim can be
 * made.
 *
 * `CreateGroupScreen` keeps its own panel: it renders a full screen with
 * header chrome and a back link, which is a different shape rather than a
 * different message.
 */
export function NeedsPlus({ title, body, testId, className }: Props) {
  const t = useT();
  const [plusOpen, setPlusOpen] = useState(false);

  return (
    <div
      data-testid={testId}
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-8 text-center',
        className,
      )}
    >
      <Sparkles size={28} className="text-(--color-accent)" aria-hidden />
      <h2 className="text-base font-semibold text-(--color-fg)">{title}</h2>
      {body && <p className="max-w-[38ch] text-sm leading-relaxed text-(--color-fg-muted)">{body}</p>}
      {/* LANG-SET-6.3 — the shared CTA. The label is `plus.ctaUnlock` and NOT
          the languages one, which is the whole reason the first line is a prop:
          LANG-TIER-1.1 is a TABLE of what Plus unlocks surface by surface, and
          "Unlock all 85 languages" — exactly true on the pickers and the
          override sheet — is a true statement about Plus and a false
          description of what the reader of THIS panel just hit. Explain, the
          practice hub and the practice route are not about the language set.

          ⚠ The label never says "Plus", and that is safe only because
          `PlusCta`'s second line does, on every surface. LANG-SET-6.1 bans the
          alternatives ("paid", "paid members") because they are false for a
          trialist, so the product name is the only accurate word — and a gate
          that asked for the price without naming what it sold is the exact
          regression that rule's test caught on the override sheet. */}
      <PlusCta
        label={t('plus.ctaUnlock')}
        onClick={() => setPlusOpen(true)}
        testId={`${testId}-see-plus`}
        className="mt-1"
      />
      <PlusSheet open={plusOpen} onClose={() => setPlusOpen(false)} />
    </div>
  );
}
