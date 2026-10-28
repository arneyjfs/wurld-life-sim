/**
 * Pure beat/action mappers extracted from nodeEngineActions.ts (600-LOC
 * cap). No React, no refs — just shape translation between the step
 * schema, the rendered Bubble, the persisted LifeBeatPayload, and the
 * in-memory local-event overlay.
 */
import * as log from '@/lib/log';
import type { Bubble } from './DialogueArea';
import {
  localCorrectionEvent,
  localDecisionEvent,
} from '@/lib/life/mergeLocalEvents';
import type { CommitAction } from '@/lib/life/commitNode';
import { WRITE_YOUR_OWN_ID, type StepBeat } from '@/lib/life/stepSchema';
import type { LifeBeatPayload, LifeEvent } from '@/types/firestore';

/** Step beats → rendered bubbles (adds a stable per-turn id + carries
 *  the Phase E vocab annotations through to the UI). */
export function beatsToBubbles(beats: ReadonlyArray<StepBeat>): Bubble[] {
  const now = Date.now();
  return beats.map((b, i) => ({
    id: `beat-${now}-${i}`,
    speaker: b.speaker,
    speakerName: b.speakerName ?? null,
    npcId: b.npcId ?? null,
    practiceText: b.practiceText,
    nativeText: b.nativeText,
    // Phase E: vocab annotations flow into the rendered bubble.
    complexWords: b.complexWords,
    wordTranslations: b.wordTranslations,
  }));
}

/** Normalised payloads → rendered bubbles. Used at the arrival boundary so
 *  the on-screen bubble is derived from the SAME repaired beats that get
 *  persisted + overlaid (LIFE-BEAT-REPAIR) — not the raw model output. */
export function payloadsToBubbles(beats: ReadonlyArray<LifeBeatPayload>): Bubble[] {
  const now = Date.now();
  return beats.map((b, i) => ({
    id: `beat-${now}-${i}`,
    speaker: b.speaker,
    speakerName: b.speakerName ?? null,
    npcId: b.npcId ?? null,
    practiceText: b.practiceText,
    nativeText: b.nativeText ?? null,
    complexWords: b.complexWords,
    wordTranslations: b.wordTranslations,
  }));
}

/** Step beat → persisted event payload (LIFE-NODE-3 commit path). */
export function beatToPayload(b: StepBeat): LifeBeatPayload {
  return {
    speaker: b.speaker,
    speakerName: b.speakerName ?? null,
    npcId: b.npcId ?? null,
    practiceText: b.practiceText,
    nativeText: b.nativeText,
    complexWords: b.complexWords,
    wordTranslations: b.wordTranslations,
  };
}

/**
 * LIFE-NODE-11 — the gap between two things a turn puts on screen.
 *
 * Reported 2026-07-31, in two parts. (1) "When two events are generated in one
 * turn, at least one second pause between, so they arrive visually
 * separately." A turn's node routinely carries 2-3 beats, each its own event in
 * the log, but at the previous 500ms the second bubble began rising ~120ms
 * after the first had finished its 380ms glide — enough to avoid overlap, not
 * enough for the first to register as its own moment. (2) "Make sure options
 * land after all events above them, with the same 1s delay, even if they
 * arrive first."
 *
 * This is the ONE pacing number, and it governs BOTH gaps —
 * `nodeEngineGlide.BEAT_STAGGER_MS` is defined as this constant rather than as
 * its own literal, because a second literal is exactly how the two drifted
 * before.
 */
export const EVENT_PACING_MS = 1000;

/**
 * LIFE-NODE-11 — a turn's arrival, owned end to end by ONE sequence.
 *
 * The options and the events resolve from independent calls, so two timers
 * "tuned to agree" would come apart the first time a generation ran slow, and
 * the options would land mid-sequence again. Instead the sequence owns the
 * whole turn: it drains the events, then settles, and the options are a step
 * it RELEASES on the tail of that queue — whichever side finishes last is the
 * one that triggers the reveal.
 */
export type TurnArrival = {
  /**
   * Hand the sequence the turn's terminal step — reveal the options, or the
   * Continue ladder. Runs one pacing gap after the last event; runs
   * IMMEDIATELY if the queue has already settled (a slow options call must not
   * be charged a second gap on top of the one it already missed).
   */
  release(step: () => void): void;
  /** Drop everything still pending, including a held terminal step. */
  cancel(): void;
};

/** Every sequence currently in flight, so an unmount can drain all of them
 *  (`cancelPendingTurnArrivals`) without the caller holding a handle. */
const pendingArrivals = new Set<TurnArrival>();

/**
 * LIFE-NODE-11 — schedule a turn's arrival: each event `gapMs` apart after
 * `leadMs`, then the released terminal step one further `gapMs` on.
 *
 * Returns synchronously. Nothing is DEFERRED except the render — the commit
 * and the in-memory overlay have already run by the time this is called
 * (LIFE-NODE-3) — so a cancelled sequence can never lose a write.
 *
 * `isStale` is the caller's own supersession check (a newer node arrived). It
 * is polled before every append, and a stale sequence deliberately does NOT
 * settle: the newer arrival owns the turn and brings its own options, so
 * releasing here would paint the previous turn's chips over it.
 *
 * The sequence settles on EVERY other termination — an empty queue, a hole in
 * the queue, an append that throws. A dropped event must never strand the
 * player with no options at all, which is the worst failure available here.
 */
/** `Date.now` via a named helper so the pacing tests can reason about it and a
 *  fake-timer harness stays honest about elapsed time. */
function nowMs(): number {
  return Date.now();
}

export function scheduleTurnArrival(opts: {
  bubbles: ReadonlyArray<Bubble>;
  append: (bubble: Bubble) => void;
  isStale: () => boolean;
  leadMs?: number;
  gapMs?: number;
  /**
   * LIFE-NODE-16: the terminal step (the options) never runs before this many
   * ms from the start, even when there are no events to pace behind.
   *
   * Reported 2026-08-08: *"the options grid is resizing down from the large
   * 'correct' dialogue while the options come in and the events come in."*
   * After a graded answer the bottom slot collapses from the feedback panel to
   * the options bar — `AnimateHeight`, 220ms — and a turn whose resolution was
   * PRE-AUTHORED (`LIFE-EX-PLAN-5`) has nothing to fetch, so it took the
   * no-sequence path and released instantly. Three things then moved at once:
   * the panel shrinking, the events gliding in, and the options appearing
   * inside the box that was still resizing under them.
   *
   * The floor is a FLOOR, not a delay: a turn with events already settles well
   * past it (`lead + n*gap + gap`), so this only bites the instant path it was
   * written for.
   */
  settleFloorMs?: number;
}): TurnArrival {
  const { bubbles, append, isStale } = opts;
  const leadMs = opts.leadMs ?? 0;
  const gapMs = opts.gapMs ?? EVENT_PACING_MS;
  const settleFloorMs = opts.settleFloorMs ?? 0;
  const startedAt = nowMs();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let i = 0;
  let dead = false;
  let settled = false;
  let held: (() => void) | null = null;

  const stop = (): void => {
    dead = true;
    held = null;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingArrivals.delete(arrival);
  };

  const settle = (): void => {
    timer = null;
    if (dead) return;
    // LIFE-NODE-16: hold the terminal step until the slot has finished
    // resizing. Re-armed rather than looped, so a cancel still lands.
    const waited = nowMs() - startedAt;
    if (waited < settleFloorMs) {
      timer = setTimeout(settle, settleFloorMs - waited);
      return;
    }
    settled = true;
    pendingArrivals.delete(arrival);
    const step = held;
    held = null;
    if (step) step();
  };

  const appendNext = (): void => {
    timer = null;
    if (dead) return;
    if (isStale()) return void stop();
    const b = bubbles[i];
    i += 1;
    if (b) {
      try {
        append(b);
      } catch (err) {
        // One event failing to render must not take the rest of the turn —
        // and above all must not take the options — down with it.
        log.warn('life.node.beat-render-failed', { err: String(err) });
      }
    }
    // The options are the turn's LAST beat: the queue settles a full gap after
    // the final event, so they read as their own moment rather than arriving
    // alongside it.
    timer = setTimeout(i < bubbles.length ? appendNext : settle, gapMs);
  };

  const arrival: TurnArrival = {
    release(step) {
      if (dead) return;
      if (settled) {
        step();
        return;
      }
      held = step;
    },
    cancel: stop,
  };

  pendingArrivals.add(arrival);
  timer = setTimeout(appendNext, leadMs);
  return arrival;
}

/** Cancel every in-flight sequence. Called when the engine's host unmounts, so
 *  a player who navigates away mid-turn gets no late append and no late
 *  options reveal. */
export function cancelPendingTurnArrivals(): void {
  for (const arrival of [...pendingArrivals]) arrival.cancel();
}

/**
 * LIFE-NODE-11 — the engine's handle on whichever sequence owns the turn on
 * screen. Exists so there is exactly ONE place that knows a turn may have no
 * sequence at all (instant append, reduced motion, no events): `release` then
 * runs the terminal step immediately rather than every call site re-deciding.
 * `take` supersedes, so a newer arrival can never leave the previous turn's
 * timers running.
 */
export type ArrivalOwner = {
  take(next: TurnArrival | null): void;
  release(step: () => void): void;
};

export function createArrivalOwner(): ArrivalOwner {
  let active: TurnArrival | null = null;
  return {
    take(next) {
      active?.cancel();
      active = next;
    },
    release(step) {
      if (active) active.release(step);
      else step();
    },
  };
}

/** A commit action → the local events it optimistically appends so the
 *  next prompt sees the decision/correction before Firestore round-trips. */
export function actionToLocalEvents(action: CommitAction): LifeEvent[] {
  if (action.kind === 'choice') {
    return [
      localDecisionEvent({
        choiceId: action.choiceId,
        text: action.text,
        ...(action.actionType ? { actionType: action.actionType } : {}),
        ...(action.targetId ? { targetId: action.targetId } : {}),
      }),
    ];
  }
  if (action.kind === 'free-text') {
    return [localDecisionEvent({ choiceId: WRITE_YOUR_OWN_ID, text: action.text })];
  }
  if (action.kind === 'practice-outcome') {
    return [localCorrectionEvent(action.outcome)];
  }
  return [];
}

/** LIFE-SPEECH-6: practiceText of the most recently committed beat, or null.
 *  Read from the EVENTS LOG rather than a ref, because the log is what the
 *  prompt is built from — a divergence between "what the model was told is on
 *  screen" and "what is on screen" is precisely the bug this guards against.
 *  Callers MUST pass the MERGED log (`currentEvents()`), not the raw snapshot:
 *  the bubble this exists to protect is local-only for one round-trip. */
export function lastBeatPracticeText(
  events: ReadonlyArray<{ kind: string; payload?: unknown }>,
): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!;
    if (e.kind !== 'beat') continue;
    const t = (e.payload as { practiceText?: unknown } | undefined)?.practiceText;
    return typeof t === 'string' && t.trim() ? t : null;
  }
  return null;
}
