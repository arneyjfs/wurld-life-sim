/**
 * LIFE-NODE-9: the cached-pick beat glide. On a cached-pick advance the
 * next node's beats do NOT appear all at once — a short pause lets the
 * chip grid clear, then each beat mounts one at a time so it plays the
 * `life-beat-enter` glide-up as it appears.
 *
 * Extracted from nodeEngineActions.ts (600-LOC cap). Pure +
 * callback-driven: the engine passes an append callback + a staleness
 * check so a NEWER node arrival cancels a still-pending glide.
 *
 * Spec: docs/specs/life-sim.md §10.46 (LIFE-NODE-9).
 */
import type { Bubble } from './DialogueArea';
import {
  EVENT_PACING_MS,
  scheduleTurnArrival,
  type TurnArrival,
} from './nodeEngineBeats';

/**
 * Lead-in before the FIRST beat mounts. **Zero — the first event renders as
 * soon as the turn lands** (owner, 2026-07-31: "as soon as the next life sim
 * turn lands something should render, not everything delayed").
 *
 * It was 300ms, to "let the chip grid clear". That reason no longer exists:
 * LIFE-UI-12's skeleton block now holds the options area at the loaded size
 * for the whole generation, so there is no collapse to wait out — the grid
 * never clears, it is replaced in place. The pause was buying calm against a
 * reflow that had already been designed away, and all it bought after that was
 * a turn that looked stalled for a third of a second.
 *
 * Kept as a named constant rather than deleted because the pacing tests do
 * their arithmetic in terms of it (`lead + n * gap`), so the sequence stays
 * legible and a future lead-in has one place to come back.
 *
 * Only the LEAD is zero. `BEAT_STAGGER_MS` still separates events, and the
 * options still settle a full gap after the last one (LIFE-NODE-11).
 */
export const BEAT_PAUSE_MS = 0;
/**
 * Gap between successive beat mounts. It MUST exceed the `.life-beat-enter`
 * glide duration (`GLIDE_ENTER_MS`, 380ms in globals.css) — at the original
 * 250ms beat 2 began rising while beat 1 was still mid-glide, so a 2-beat turn
 * read as "bunched".
 *
 * It is NOT its own number any more: it IS the same-turn event pacing floor
 * (`EVENT_PACING_MS`, LIFE-NODE-11). The interim 500ms cleared the glide but
 * left only ~120ms of calm, and two beats still read as one block arriving in
 * pieces rather than as two moments.
 */
export const BEAT_STAGGER_MS = EVENT_PACING_MS;
/** The CSS `.life-beat-enter` / `lifeBeatEnter` animation duration
 *  (globals.css). Mirrored here so the stagger invariant (stagger ≥ glide,
 *  no overlap) is testable. Keep in sync if the CSS changes.
 *
 *  LIFE-NODE-12 added a horizontal component INSIDE this window rather than
 *  extending it — `BEAT_STAGGER_MS ≥ GLIDE_ENTER_MS` is the constraint the
 *  event pacing rests on (LIFE-NODE-11), so a longer entrance would quietly
 *  eat the calm between two beats. */
export const GLIDE_ENTER_MS = 380;

/**
 * LIFE-NODE-12 — how far a beat travels on entry, on BOTH axes.
 *
 * ONE number, deliberately: the entrance is a 45° diagonal (up + in from the
 * speaker's own side), not two independently tuned distances. Mirrored from
 * the `lifeBeatEnter` keyframe's Y travel in globals.css the same way
 * `GLIDE_ENTER_MS` mirrors its duration — the X half reaches the DOM from
 * here, via the `--life-beat-enter-x` custom property.
 *
 * **Not imported from `@/components/Message/bubbleMotion`, and that is not an
 * oversight.** Chat's bubble has no horizontal component to share — the
 * recipient's `slide-in-from-left-1` was deleted with `THEIRS_ENTER_MS` when
 * TYPING-5 unified the two senders' entrances (MSG-BUBBLE-8.1), leaving a
 * stale comment in `MessageBubble.tsx` that still describes it. Its vertical
 * travel is `100%` of a bubble height into an opening grid track
 * (MSG-BUBBLE-8.2), which is a different mechanism from this flat 20px glide,
 * so a shared "travel" constant would be one name over two unrelated
 * distances. If chat ever re-adopts a horizontal entrance, the magnitude and
 * the mine/theirs sign belong in `bubbleMotion.ts` and this module should
 * import them. See docs/specs/life-sim.md §10.46 design decisions.
 */
export const GLIDE_ENTER_TRAVEL_PX = 20;

/**
 * LIFE-NODE-12 — the horizontal start offset for a beat, keyed on WHO speaks.
 *
 * A bubble slides in from the side it is aligned to, which is the same reading
 * chat's deleted `slide-in-from-left-1` had for a left-aligned incoming
 * message:
 *
 *   - `user`     → right-aligned (LIFE-BUBBLE-3) → enters from the RIGHT (+)
 *   - `npc`      → left-aligned                  → enters from the LEFT  (−)
 *   - `narrator` → centered, has no side         → rises only (0)
 *
 * Getting this backwards is worse than shipping no horizontal motion at all —
 * a beat arriving from the wrong side reads as the wrong speaker — so the
 * mapping is asserted per speaker in `DialogueArea.test.tsx` rather than left
 * to the CSS.
 */
export function beatEnterOffsetX(speaker: Bubble['speaker']): string {
  if (speaker === 'user') return `${GLIDE_ENTER_TRAVEL_PX}px`;
  if (speaker === 'npc') return `-${GLIDE_ENTER_TRAVEL_PX}px`;
  return '0px';
}

/**
 * LIFE-NODE-10: minimum time the `question-authoring` shimmer stays up. The
 * shimmer is shown for exactly as long as the graded-question generator
 * takes; the real generator's ~1.5s latency reads as an intentional "writing
 * the question" beat, but a fast resolve (a future cache hit, or the mocked
 * generator in E2E) would flash it for a few ms. This cosmetic floor — the
 * same pattern as the transit minimum (LIFE-TRANS-6) — guarantees the beat
 * always registers. It only bites when the generator is faster than the
 * floor, so it never adds latency in production.
 */
export const MIN_AUTHORING_MS = 700;

/** A promise that resolves once {@link MIN_AUTHORING_MS} has elapsed from the
 *  call. Start it when the shimmer mounts and await it before revealing the
 *  authored question — the shimmer is then guaranteed visible for the floor. */
export function authoringFloor(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, MIN_AUTHORING_MS));
}

/** True when prefers-reduced-motion is set — the engine then appends the
 *  beats instantly (no pause, no stagger; the CSS class also drops the
 *  transform under the same media query). */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Mount `bubbles` one at a time — a pause before the first, a stagger between
 * each. `append` adds a single bubble; `isStale` returns true once a newer
 * arrival has superseded this glide, cancelling the remaining appends.
 *
 * This module binds the two animation numbers; the SEQUENCING (including the
 * held-back options step) belongs to `scheduleTurnArrival` — one owner for the
 * whole turn, so the options cannot drift out of order with the events
 * (LIFE-NODE-11). Returns that sequence's handle: `release` for the terminal
 * step, `cancel` for unmount.
 */
export function scheduleBeatGlide(
  bubbles: ReadonlyArray<Bubble>,
  append: (bubble: Bubble) => void,
  isStale: () => boolean,
  settleFloorMs?: number,
): TurnArrival {
  return scheduleTurnArrival({
    bubbles,
    append,
    isStale,
    leadMs: BEAT_PAUSE_MS,
    gapMs: BEAT_STAGGER_MS,
    settleFloorMs,
  });
}

/**
 * LIFE-NODE-16 — how long the bottom slot takes to finish resizing.
 *
 * Mirrors `AnimateHeight`'s `HEIGHT_MS`. Duplicated as a named constant for the
 * reason `GLIDE_ENTER_MS` is: the number lives in a component's style and the
 * sequencing lives here, and a silent drift between them shows up as churn
 * nobody can attribute. +40ms so the options land after the transition ENDS
 * rather than on its last frame.
 */
export const SLOT_SETTLE_MS = 260;

/**
 * LIFE-NODE-16 — an arrival with NOTHING to pace, held only by the slot settle.
 *
 * `scheduleBeatGlide` would add a `BEAT_STAGGER_MS` gap on top of the floor,
 * which is pacing for events this turn does not have. `gapMs: 0` makes the wait
 * exactly the resize and no more.
 */
/**
 * LIFE-NODE-11/16 — pick the arrival sequence for a turn. ONE place decides,
 * so the three cases cannot drift into disagreeing about turn ordering:
 *
 *   staggered      → events paced apart, options on their tail
 *   settle-only    → nothing to pace, but the slot is still collapsing out of
 *                    the feedback panel, so the options wait for it
 *   none           → nothing to pace and nothing to wait for; release runs the
 *                    terminal step immediately
 */
export function scheduleArrival(opts: {
  bubbles: ReadonlyArray<Bubble>;
  staggered: boolean;
  settleFloorMs: number;
  append: (bubble: Bubble) => void;
  isStale: () => boolean;
}): TurnArrival | null {
  if (opts.staggered) {
    return scheduleBeatGlide(opts.bubbles, opts.append, opts.isStale, opts.settleFloorMs);
  }
  if (opts.settleFloorMs > 0) return scheduleSettleOnly(opts.isStale, opts.settleFloorMs);
  return null;
}

export function scheduleSettleOnly(
  isStale: () => boolean,
  settleFloorMs: number,
): TurnArrival {
  return scheduleTurnArrival({
    bubbles: [],
    append: () => {},
    isStale,
    leadMs: 0,
    gapMs: 0,
    settleFloorMs,
  });
}
