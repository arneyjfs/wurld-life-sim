/**
 * LANG-TIER — the upgrade surface.
 *
 * Spec: docs/specs/language-tiers.md §4.
 *
 * ## Framed around the room, not around a feature list
 *
 * The constraint a user actually meets is "the language I want isn't in this
 * chat" (the picker's empty state) or "this chat is paused" (the composer
 * panel). Both are facts about a ROOM, so the sheet opens on what a room can
 * carry and only then lists what else comes with the tier. A feature grid
 * answers a question nobody asked at the moment this sheet opens.
 *
 * ## Free is constrained in WHICH languages, never in what it can do
 *
 * LANG-TIER-1 is explicit: the free tier keeps the whole language-learning
 * experience, in the languages a subscriber already brought. So the free
 * section here says "unlimited", and the word "basic" does not appear. This is
 * the invariant most likely to be eroded by a later copy edit, which is why a
 * test asserts the absence of those words rather than just the presence of
 * these.
 *
 * ## It sells now (BILL-MANAGE-5, 2026-09-27)
 *
 * Until billing.md this sheet could not take a payment and said so ("Plus isn't
 * on sale yet"). That line is gone, replaced deliberately by a real purchase
 * button — StoreKit on iOS, Play Billing on Android, Stripe Checkout on the web
 * (BILL-MANAGE-1) — which is hidden from anyone who already has paid or given
 * Plus (BILL-MANAGE-2). The purchase half lives in `PlusSheetPurchase`.
 */
import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Check,
  CircleHelp,
  Globe,
  Heart,
  Languages,
  Layers,
  MessageCircle,
  Share2,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PlusSheetPurchase } from '@/components/PlusSheetPurchase';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';
import { useT } from '@/i18n';

type Props = {
  open: boolean;
  onClose: () => void;
};

type Tier = 'free' | 'plus';

type Row = {
  /**
   * The FEATURE's icon, not a tier mark. See the `Section` block below for why
   * the two are now different jobs.
   */
  icon: LucideIcon;
  /** The feature's name. Bold, and the only line a skimmer reads. */
  label: string;
  /**
   * One line under it, muted.
   *
   * ⚠ It must add a fact the heading does not carry. Owner, 2026-09-23: five
   * rows that each restated their own heading read as *"trying to sell the
   * same thing 5 times"*, which is how the list this replaces lost people
   * before it reached the price.
   */
  body: string;
};

export function PlusSheet({ open, onClose }: Props) {
  const t = useT();
  // Read from the array the picker draws from, so this cannot drift from what
  // the app actually offers the next time a language is added.
  const count = String(SUPPORTED_LANGUAGES.length);

  /**
   * TWO SECTIONS, and the tier is the BLOCK. Owner, 2026-09-22: *"Two sections
   * instead of one list"*, the second reading *"all of free, plus…"*, with the
   * goal *"to make the page prettier"*.
   *
   * ⚠ **The icons went back to being about the FEATURE.** The previous pass
   * spent them on the tier — `Check` for free, `Sparkles` for Plus — because
   * the tier was the only thing a flat list could carry. Two blocks carry the
   * tier for free (accent border, accent tint, accent row icons, and the mark
   * beside each heading), which hands every row's icon back to the thing it
   * is actually good at: saying what the row is about before it is read.
   *
   * ⚠ **The icons are the ones the app already uses for these surfaces**, not
   * a fresh set chosen here: `Layers` is the deck mark (the Cards tab,
   * `navTabs`; save buttons use `FlashcardIcon`, CARDS-ICON-1), `Sparkles` is Explain
   * (`MessageActionsMenu`), `BookOpen` is the tutor (`TutorActionCard`),
   * `Target` is a practice session (`PracticeStartScreen`), `Languages` is
   * translation (`PausedComposer`). A sheet that
   * advertises a feature with a glyph the feature does not use teaches the
   * wrong mark.
   *
   * ⚠ **FREE FIRST, and every free line before every Plus line.** The reader
   * of this sheet has not paid; a list that leads with what they cannot have
   * reads as a wall, which is the rule `LANG-SET-6` and `LANG-FREE-8` both
   * make about this exact moment. The Plus heading says *"All of Free,
   * plus…"* so the second block reads as an addition rather than a rival
   * column.
   *
   * ⚠ **LANG-TIER-1.1 says these two lists ARE the table's two columns.**
   * Selling a free feature and hiding a gated one are the same failure from
   * opposite sides, so both halves are asserted against the table.
   */
  const free: Row[] = [
    // ⚠ FIRST, and it used to be last. Owner, 2026-09-23: the unlimited-
    // messaging row and the free↔free row are one row now, at the top.
    //
    // The rule they were split by — never lead with what the reader cannot
    // have (LANG-SET-6, LANG-FREE-8) — is satisfied differently rather than
    // broken: the heading calls these chats NORMAL, and the body gives the
    // unlimited part before the condition. The limit arrives inside a sentence
    // that is mostly about what works, instead of as a row of its own.
    {
      icon: MessageCircle,
      label: t('plus.itemFreeToFree'),
      body: t('plus.itemFreeToFreeBody'),
    },
    {
      icon: Languages,
      label: t('plus.itemTranslations'),
      body: t('plus.itemTranslationsBody'),
    },
    { icon: Layers, label: t('plus.itemCards'), body: t('plus.itemCardsBody') },
    { icon: ShieldCheck, label: t('plus.itemNoAds'), body: t('plus.itemNoAdsBody') },
  ];

  /**
   * ⚠ **The group row is a CORRECTION, not an addition**, and it is now ONE
   * row rather than the two it took in 2026-09-22. It used to claim a single
   * Plus let everyone in a group "read along in their own language".
   * LANG-SET-4 binds a free member's pair to the chat's language set and
   * LANG-SET-1 builds that set out of the entitled members' own pairs, so what
   * the group reads along in is the SUBSCRIBER'S SET — never a language of its
   * own choosing, which is the thing Plus is being sold for in the first place.
   *
   * The two halves became a heading and its explainer, which is what they
   * always were: `plus.itemGroupsReadAlong` reads as the second line of
   * `plus.itemGroups` rather than as a rival claim beside it.
   */
  const plus: Row[] = [
    {
      icon: Globe,
      label: t('plus.itemAllLanguages', { count }),
      body: t('plus.itemAllLanguagesBody', { count }),
    },
    {
      icon: Share2,
      label: t('plus.itemCoversFree'),
      body: t('plus.itemCoversFreeBody'),
    },
    // LANG-LEARNWITH-15 — no group row: groups are free (LANG-FREE-13), and
    // the Free section says so.
    {
      icon: Sparkles,
      label: t('plus.itemExplain'),
      body: t('plus.itemExplainBody'),
    },
    // QUIZ-GATE-1 — the chat quiz is Plus-only (LANG-TIER-1.1, 2026-10-24).
    // The same glyph the quiz card uses.
    { icon: CircleHelp, label: t('plus.itemChatQuiz'), body: t('plus.itemChatQuizBody') },
    { icon: BookOpen, label: t('plus.itemTutor'), body: t('plus.itemTutorBody') },
    { icon: Target, label: t('plus.itemPractice'), body: t('plus.itemPracticeBody') },
  ];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={t('plus.title')}
      ariaDescription={t('plus.tagline')}
      // No input anywhere in this sheet, so there is nothing for the keyboard
      // to collide with.
      keyboardInset="none"
    >
      {/* ⚠ SCROLLS, and it has to. `keyboardInset="none"` gives the sheet a
          DEFINITE `height: 85dvh` (`.kb-none`) and `BottomSheet` does not clip,
          so a body taller than the cap paints straight past the bottom edge of
          the screen. Measured at 390×667: a 670px body in a 567px sheet, with
          the closing CTA ~100px below the viewport and no way to reach it —
          owner report, 2026-09-21. `flex-1 min-h-0` is what lets this child
          take the cap instead of its own content height (a flex item's default
          `min-height: auto` refuses to shrink below its content), and vaul
          hands the vertical gesture back to the sheet once this reaches
          scroll-top.

          ⚠ **The two sections made this body TALLER** — roughly a heading, a
          box's padding twice over, and one more row than the flat list it
          replaced. That is fine here and is the state
          `scroll-overflow-surfaces.spec.ts` already asserts as its
          PRECONDITION ("it should be below the fold at 390×667"). It is NOT
          fine for `chat-passthrough.spec.ts`, which waits on
          `plus-sheet-close` being `toBeInViewport()` as a proxy for the vaul
          slide having finished, with no scroll first — flagged to the owner
          2026-09-22 rather than fixed, because that spec is outside this
          change's scope. */}
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6 pt-2"
        data-testid="plus-sheet"
      >
        <div className="flex flex-col items-center gap-1 text-center">
          <Sparkles size={22} className="text-(--color-accent)" aria-hidden />
          <h2 className="text-lg font-semibold text-(--color-fg)">{t('plus.title')}</h2>
          <p className="text-sm text-(--color-fg-muted)">{t('plus.tagline')}</p>
        </div>

        <Section tier="free" mark={Check} heading={t('plus.sectionFree')} rows={free} />
        <Section tier="plus" mark={Sparkles} heading={t('plus.sectionPlus')} rows={plus} />

        {/* LANG-LEARNWITH-15 — why Plus exists, in one note. */}
        <div className="flex gap-3 rounded-xl px-1" data-testid="plus-sheet-support">
          <Heart size={18} className="mt-0.5 shrink-0 text-(--color-accent)" aria-hidden />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-(--color-fg)">{t('plus.supportWurld')}</span>
            <span className="text-xs leading-relaxed text-(--color-fg-muted)">{t('plus.supportWurldBody')}</span>
          </span>
        </div>

        {/* BILL-MANAGE-1/2/5 — the purchase button, or "you have Plus", and the
            dismiss (still `plus-sheet-close`: three E2E specs wait on it). */}
        <PlusSheetPurchase open={open} onClose={onClose} />
      </div>
    </BottomSheet>
  );
}

/**
 * One tier's block.
 *
 * ⚠ **The two blocks differ in the BOX, never in the row.** A Free row and a
 * Plus row are the same component with the same spacing, so the only thing a
 * reader has to learn is "tinted box = Plus". Two differently-shaped rows
 * would make the comparison the sheet exists for harder, not easier — and the
 * accent treatment (`border-(--color-accent) bg-(--color-accent)/5`) is the
 * one `TrialSheet` already uses for exactly this "the good one" / "the plain
 * one" pairing.
 *
 * ⚠ **The Free block is `--color-bg-hover`, NOT `--color-bg-elevated`.** The
 * obvious "plain surface" token is the wrong one here: `BottomSheet` paints
 * its own content `bg-(--color-bg-elevated)`, so a block filled with it is the
 * sheet's own colour and the box disappears into the page, leaving a hairline
 * border to carry a distinction the owner asked to be visible. `bg-hover` is
 * this app's subtle panel fill — it is what `--color-bubble-theirs` resolves
 * to — and it separates in BOTH themes (#f3f4f6 on white, #232234 on #1a1928).
 *
 * ⚠ **`data-icon` exists for the test, and it is read off the icon itself.**
 * The contract a test has to be able to check is that each row carries a mark
 * of its OWN rather than a tier bullet, and lucide's only other handle is the
 * generated class name, which `docs/conventions.md` forbids selecting on.
 * Taking the value from `Icon.displayName` — which lucide assigns explicitly,
 * so it survives minification — means the attribute cannot drift away from the
 * glyph actually rendered.
 */
function Section({
  tier,
  mark: Mark,
  heading,
  rows,
}: {
  tier: Tier;
  mark: LucideIcon;
  heading: string;
  rows: Row[];
}) {
  const isPlus = tier === 'plus';
  return (
    <section
      data-testid={isPlus ? 'plus-sheet-plus' : 'plus-sheet-free'}
      className={
        isPlus
          ? 'rounded-2xl border border-(--color-accent) bg-(--color-accent)/5 px-4 py-3.5'
          : 'rounded-2xl border border-(--color-border) bg-(--color-bg-hover) px-4 py-3.5'
      }
    >
      <h3
        className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${
          isPlus ? 'text-(--color-accent)' : 'text-(--color-fg-muted)'
        }`}
      >
        <Mark size={14} aria-hidden className="shrink-0" />
        {heading}
      </h3>

      <ul className="mt-3 flex flex-col gap-2.5">
        {rows.map(({ icon: Icon, label, body }) => (
          <li
            key={label}
            className="flex items-start gap-2.5 text-sm text-(--color-fg)"
            data-testid={isPlus ? 'plus-sheet-item-plus' : 'plus-sheet-item-free'}
            data-icon={Icon.displayName}
          >
            {/* `mt-0.5` because the icon aligns to the first LINE of a wrapping
                row, not to the middle of the block. */}
            <Icon
              size={16}
              aria-hidden
              className={`mt-0.5 shrink-0 ${
                isPlus ? 'text-(--color-accent)' : 'text-(--color-fg-muted)'
              }`}
            />
            {/* HEADING + EXPLAINER (owner, 2026-09-23). The heading is the
                feature's name and carries the weight; the line under it is
                muted and one size down, so a reader skimming only the bold
                line still learns what the tier gives them — which is the
                stated point of the rewrite. */}
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{label}</span>
              <span className="text-xs text-(--color-fg-muted)">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
