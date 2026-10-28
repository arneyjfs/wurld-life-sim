/**
 * MSG-BUBBLE-8 — entrance timings for the message bubble.
 *
 * Spec: docs/specs/message-pipeline.md — MSG-BUBBLE-8.
 *
 * Shared by the bubble (which runs the animation) and `useSettleSweep` (which
 * has to know whether the entrance is still on screen before it fires the
 * arrival sweep over the top of it). Keeping the number in one place is the
 * whole point: the two are only correct relative to each other.
 */

/**
 * The sender's own bubble. The measured gap between the optimistic bubble
 * painting and the translated text replacing it is ~800ms (emulator, real
 * Gemini, 771ms / 809ms steady-state), so the entrance does not have to cover
 * the whole of it — the arrival now has its own reveal animation
 * (MSG-BUBBLE-9), and the two together carry the window.
 *
 * ⚠ **600 → 400 → 320.** The previous note said *"if the pipeline gets
 * materially faster this should come down further; an entrance covering a gap
 * that no longer exists is just latency"*, and the owner called it in on
 * 2026-09-23 — *"a few animations a TINY bit too slow: new message appearing —
 * animates upwards from composer"*. The arrival animations already mark the end
 * of the window (MSG-BUBBLE-9/10/11); the entrance only has to make the send
 * feel like one continuous event, and past ~320ms it starts reading as a thing
 * the app is doing rather than a thing the user did.
 *
 * `ENTER_GAP_MS` is scaled with it, deliberately — see its own comment. The two
 * are only correct relative to each other, so this number never moves alone.
 */
export const MINE_ENTER_MS = 320;

/**
 * TYPING-5 — an INCOMING bubble now enters with `MINE_ENTER_MS` too.
 *
 * There used to be a separate, shorter (250ms) recipient entrance, on the
 * reading that "a recipient's bubble has no gap of this shape to cover — it
 * surfaces already translated, or shimmer-only, and the shimmer already holds
 * that row". The typing indicator removed that premise: there is no shimmer
 * holding the row any more, and the incoming bubble now mounts at exactly the
 * moment the indicator leaves. That IS the same event the sender's entrance
 * marks, so it gets the same motion rather than a quicker one that read as an
 * afterthought next to it.
 */

/**
 * Travel for the mine entrance. Small now that the bubble GROWS from zero
 * height (MSG-BUBBLE-8.2): the growth supplies the vertical motion and opens
 * the space above, so a large translate on top of it reads as two animations
 * fighting rather than one bubble arriving.
 */
export const MINE_ENTER_TRAVEL = '100%';

/**
 * How long the GAP takes to open, against `MINE_ENTER_MS` for the bubble's own
 * travel. Deliberately shorter: the two must not finish together, or the
 * bubble's top sits exactly on the gap's bottom edge for the whole animation
 * and never becomes visible until the end — which reads as growing from zero
 * inside the space rather than sliding into it.
 *
 * ⚠ It is the RATIO that is tuned, not the number: 240/400 and 190/320 are the
 * same 0.6. Speeding the entrance up without scaling this would move the frame
 * at which the bubble's top clears the gap's bottom edge — i.e. the frame it
 * becomes visible at all — which is the one thing the split exists to place.
 * Moved with `MINE_ENTER_MS` on 2026-09-23.
 */
export const ENTER_GAP_MS = 190;

/**
 * MSG-BUBBLE-10 — one half of the programmatic bubble flip, matching the
 * gesture's own `transition: transform 180ms` in `computeBubbleWrapperStyle`.
 * The card squashes to nothing over this, swaps its content at zero width, and
 * comes back over the same again.
 */
export const FLIP_HALF_MS = 180;

/**
 * MSG-BUBBLE-10.5 — the AUTOMATIC turn's two curves. The gesture keeps the
 * wrapper's default; these apply only when `useArrivalFlip` is driving.
 *
 * Owner, 2026-09-21: *"it's fine when I swipe with my finger, but
 * automatically it's too jarring. The transition needs to start slow and end
 * slow."*
 *
 * Both halves used to run on the wrapper's `cubic-bezier(.2,.7,.2,1)`, which is
 * an ease-OUT — fast off the mark, slow into the stop. Two halves of that is
 * two hard starts in 360ms. The swipe escaped it because a finger down sets
 * `transition: none` and the transform tracks the finger 1:1; nothing about the
 * curve was ever involved.
 *
 * ⚠ **Easing each half `ease-in-out` is the obvious fix and it is wrong.** The
 * turn is two transitions with a content swap between them, so the same curve
 * on both gives slow-fast-slow TWICE and stalls at the midpoint — the frame
 * where the card is a one-pixel sliver and most needs to be moving. The halves
 * are eased AS halves: accelerate into the swap, decelerate out of it.
 *
 * ⚠ **REVISED 2026-09-22, by ear, and the pair is now ASYMMETRIC.** They were
 * exact time-reversed mirrors composing into a symmetric ease-in-out; the owner
 * listened to that and asked for *"constant medium speed from start and then
 * gradually slow down towards the end"*. So the squash is `linear` and the
 * return starts at that same rate and decelerates into the stop.
 *
 * ⚠ **The handoff is what makes this ONE motion rather than two.**
 * `FLIP_AUTO_OUT_EASE`'s first control point sits ON the diagonal (`.33,.33`),
 * so its initial slope is 1 — it leaves the midpoint at exactly the rate the
 * linear half arrived at it. Move that point off the diagonal and the turn
 * visibly hitches at the swap, which is the frame the card is a one-pixel
 * sliver and least able to hide it. A test pins the property rather than the
 * numbers, so the feel can be tuned without losing the join.
 *
 * ⚠ The mirror requirement is RETIRED, not forgotten — also pinned, so it is
 * not "restored" later as a tidy-up.
 */
export const FLIP_AUTO_IN_EASE = 'linear';
export const FLIP_AUTO_OUT_EASE = 'cubic-bezier(.33,.33,.3,1)';

/**
 * MSG-BUBBLE-12.15 — how long the arrival's SPACE takes to travel, against
 * `FLIP_HALF_MS` for the half it lives in. Deliberately shorter, and the gap is
 * the whole point.
 *
 * The two clocks are independent and cannot be made one. The swap is a
 * `setTimeout(FLIP_HALF_MS)` started when `run()` is called; the CSS animation
 * starts at the first style resolution after the commit that attaches it, and
 * that commit is the expensive one — a layout effect, a measurement twin, a
 * forced reflow for its wrap cap. Whatever that frame costs is pure lag between
 * the two. Measured on the emulator harness (Chromium, 2026-09-22) it cost
 * ~30ms of a 180ms half: the spacer reached 30px of a 36px delta and the bubble
 * took the remaining 6px in one frame at the swap, which is a smaller version
 * of exactly the jolt this work exists to remove.
 *
 * Ending EARLY is not a compromise, it is what MSG-BUBBLE-12.1 asks for — *all*
 * the room *by* zero width. The room is simply fully open for the last stretch
 * of the squash, with the card below 30% width and nothing left to notice.
 * Landing exactly on the boundary is the race; landing before it is the rule.
 */
export const FLIP_SPACE_MS = 130;
