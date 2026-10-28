/**
 * LIFE-UI-10 — ONE reserved height for the options row, in every phase.
 *
 * Reported 2026-07-31: "Need to keep a consistent height for options row with a
 * shimmer loader between turns. Assume a placeholder of 2 lines each on mobile."
 *
 * The row rendered at three different heights across one turn: the thinking bar
 * (`live-loading`) was a single centred line, the skeleton chips were
 * `h-[3.25rem]` — about 1.5 lines — and the real chips sized to their content,
 * which on mobile is routinely two lines. So the dialogue above it jumped twice
 * per turn, and the jump landed exactly while the player was reading.
 *
 * The fix is a floor, not a fixed height: `min-h` on the real chips so a
 * one-line label still occupies the two-line box, and the SAME number as the
 * skeleton's fixed height so the swap is invisible. A three-line label is still
 * allowed to grow — clamping it would truncate an option the player must read
 * to choose.
 *
 * The arithmetic, so a future change can be checked rather than guessed:
 *   2 lines · text-sm (0.875rem) · leading-snug (1.375) = 2.406rem
 * + py-2.5 top and bottom (0.625rem × 2)                = 1.25rem
 * + 1px border top and bottom                           ≈ 0.125rem
 *                                                       ≈ 3.78rem → 3.75rem
 */
export const OPTION_CHIP_MIN_H = 'min-h-[3.75rem]';

/** The skeleton's FIXED height — the same box the real chip floors at. */
export const OPTION_CHIP_SKELETON_H = 'h-[3.75rem]';

/**
 * What the whole grid reserves: two rows of chips plus the `gap-2` between
 * them (3.75 × 2 + 0.5). The skeleton grid reserves this too, so the row does
 * not collapse to a single line while the model is generating — which was the
 * larger of the two jumps.
 */
export const OPTION_GRID_MIN_H = 'min-h-[8rem]';

/**
 * LIFE-UI-12 — the LOADING options block is the LOADED options block with its
 * content swapped, not a different layout.
 *
 * Reported 2026-07-31, after LIFE-UI-10 landed: "the placeholder thinking
 * shimmer … is still too short, meaning the options area decreases and
 * increases in height every time the UI flexes between generating and showing
 * the options."
 *
 * LIFE-UI-10 gave the GRID one height in both states. What it did not give was
 * the row ABOVE the grid: the loaded state renders a frame row ("What do you
 * do?", LIFE-OPT-VOICE) that the thinking bar simply did not have, and the two
 * states carried different outer paddings on top of that. So the block still
 * changed height by roughly a text row plus a padding delta on every swap.
 *
 * The fix is structural rather than arithmetic: the frame row, the bar
 * padding and the grid are all built from the class strings below, and BOTH
 * states render them. There is no second copy to drift, and no measurement to
 * keep in sync — the swap replaces the CONTENT of two identical boxes.
 *
 * Where the loading phrase goes is the owner's design and is the reason this
 * works: the rotating wait phrase takes the frame row (in place of the title),
 * and the skeleton chips take the grid.
 */

/** Frame row wrapper — the title/phrase slot above the grid. NO bottom
 *  padding of its own (the `-mb-0.5` closes the seam against the bar's
 *  `pt-2`); a bottom padding here would be a second thing to keep in sync. */
/**
 * LIFE-UI-15: `px-3` MATCHES `OPTION_BAR_CLASS`. It was `px-4`, so even once the
 * column below was shared the label still sat a notch inside the chips on any
 * screen narrower than the column.
 */
export const OPTION_FRAME_CLASS = 'bg-(--color-bg) px-3 pt-2 -mb-0.5';

/**
 * LIFE-UI-15 — the eyebrow's content column, matching `OPTION_GRID_CLASS`.
 *
 * Found 2026-08-09 via the v2 branch's handover and confirmed here. The chip
 * grid is `max-w-md mx-auto`; the frame had no width constraint at all, so
 * "WHAT DO YOU DO?" spanned the viewport while the chips it labels sat centred
 * in a 28rem column — on a 1280px desktop, a label at x≈12 over chips at x≈416.
 *
 * Invisible below 448px, where `max-w-md` never binds and the two agree by
 * accident. That is exactly why it survived: every screenshot review was a
 * phone. The constraint is shared through a constant so the pair cannot drift
 * apart again, and `optionRowMetrics.test.ts` asserts they hold the same one.
 */
export const OPTION_FRAME_COLUMN_CLASS = 'max-w-md mx-auto';

/**
 * The frame row's inner slot. `h-4` is a FIXED height on purpose: the two
 * occupants are different (an uppercase title vs. a phrase preceded by three
 * pulsing dots), and a content-sized slot would let them differ. 1rem
 * comfortably clears the 10px uppercase text and the 0.25rem dots, so neither
 * can push it.
 */
export const OPTION_FRAME_SLOT_CLASS =
  'flex items-center gap-1.5 h-4 text-[10px] font-bold uppercase tracking-wider text-(--color-fg-muted)';

/** The bar that hosts the grid (and the ✏️ composer). `.pb-keyboard` rides the
 *  composer above the soft keyboard — COMP-KB-14. */
export const OPTION_BAR_CLASS = 'px-3 pt-2 pb-keyboard bg-(--color-bg)';

/** The grid itself. `OPTION_GRID_MIN_H` is applied ON TOP of this by the CYOA
 *  call sites, so a 1-2 option turn still reserves the two skeleton rows.
 *  Graded chips and the Continue ladder deliberately do NOT reserve it — they
 *  are not what the skeleton was standing in for. */
/**
 * `content-start` (align-content: start) is load-bearing, not cosmetic.
 *
 * `OPTION_GRID_MIN_H` reserves two rows so the block does not collapse while
 * the model generates (LIFE-UI-10/12). With the default `align-content:
 * stretch`, a turn offering a SINGLE option had its one row absorb that whole
 * reservation — a lone chip drawn nearly twice its natural height with its
 * label floating in the middle (owner screenshot, 2026-08-01). The chip was
 * obeying the grid, not its own `min-h`.
 *
 * Starting the rows keeps BOTH properties: the block still reserves its two
 * rows, so nothing jumps between generating and showing, and each row is only
 * as tall as it needs to be. The spare height stays as empty background below
 * the chips, which is what the reservation was always for.
 *
 * `align-ITEMS` stays at its `stretch` default on purpose — two chips sharing
 * a row must still match each other's height, and that is a different axis
 * from how the rows sit in the container.
 */
export const OPTION_GRID_CLASS = 'grid grid-cols-2 gap-2 max-w-md mx-auto content-start';

/**
 * How many skeleton boxes the loading grid shows: a 2×2 block.
 *
 * The real chip count varies — `LIFE-OPT-VARIETY` asks the model for 2-3
 * options, and branch turns add the client ✏️ chip — so the common counts are
 * 3 and 4, BOTH of which occupy exactly two rows in a 2-column grid. 4 is
 * therefore the count that matches the typical turn exactly, and the residual
 * mismatch (a 2-option continuation, one row) is absorbed by
 * `OPTION_GRID_MIN_H` on the real grid rather than by shrinking the skeleton.
 * Matching the typical case beats matching every case: a 4→3 skeleton-to-chip
 * difference costs nothing (same two rows), whereas showing 1 box and landing
 * 3 would reproduce the jump this invariant exists to remove.
 */
export const SKELETON_CHIP_COUNT = 4;
