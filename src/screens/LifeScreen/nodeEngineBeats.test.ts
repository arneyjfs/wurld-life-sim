import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bubble } from './DialogueArea';
import {
  EVENT_PACING_MS,
  beatToPayload,
  beatsToBubbles,
  cancelPendingTurnArrivals,
  payloadsToBubbles,
  scheduleTurnArrival,
} from './nodeEngineBeats';
import type { StepBeat } from '@/lib/life/stepSchema';
import type { LifeBeatPayload } from '@/types/firestore';
import { BEAT_PAUSE_MS, BEAT_STAGGER_MS } from './nodeEngineGlide';

/**
 * LIFE-NODE-11 — a turn arrives as ONE paced sequence: every event, then the
 * options, each `EVENT_PACING_MS` apart.
 *
 * Reported 2026-07-31, in two parts. (1) "When two events are generated in one
 * turn, at least one second pause between, so they arrive visually
 * separately." (2) "Make sure options land after all events above them, with
 * the same 1s delay, even if they arrive first."
 *
 * Part (2) is why this is a sequence with an owner rather than two timers: the
 * options and the events resolve independently, so any fixed delay measured
 * from turn-start breaks the moment one event is slow.
 */
const bubble = (id: string): Bubble =>
  ({ id, speaker: 'narrator', practiceText: '', nativeText: id }) as Bubble;

const seq = (
  bubbles: ReadonlyArray<Bubble>,
  append: (b: Bubble) => void,
  isStale: () => boolean = () => false,
) =>
  scheduleTurnArrival({
    bubbles,
    append,
    isStale,
    leadMs: BEAT_PAUSE_MS,
    gapMs: EVENT_PACING_MS,
  });

describe('LIFE-NODE-11 — same-turn events are paced apart', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cancelPendingTurnArrivals();
    vi.useRealTimers();
  });

  it('LIFE-NODE-11 — the FIRST event renders with NO lead delay', () => {
    // Owner, 2026-07-31: "as soon as the next life sim turn lands something
    // should render, not everything delayed... But no delay on the first."
    //
    // The pacing is between events, never in front of them. A lead-in makes a
    // turn that has already arrived look like one that has not, which is the
    // opposite of what the pacing is for.
    //
    // Asserted against BEAT_PAUSE_MS itself rather than a literal 0, so
    // reintroducing a lead fails HERE — where the reasoning is — instead of
    // silently shifting every other timing test's arithmetic.
    expect(BEAT_PAUSE_MS).toBe(0);

    const got: string[] = [];
    seq([bubble('a'), bubble('b')], (b) => got.push(b.id));
    // Flush only the zero-delay timer. Nothing has consumed a gap yet.
    vi.advanceTimersByTime(0);
    expect(got).toEqual(['a']);

    // …and the SECOND event still waits a full gap, so removing the lead has
    // not collapsed the pacing it exists alongside.
    vi.advanceTimersByTime(EVENT_PACING_MS - 1);
    expect(got).toEqual(['a']);
    vi.advanceTimersByTime(1);
    expect(got).toEqual(['a', 'b']);
  });

  it('LIFE-NODE-11 — the pacing floor is at least one second', () => {
    expect(EVENT_PACING_MS).toBeGreaterThanOrEqual(1000);
  });

  it('LIFE-NODE-11 — the beat glide reads the SAME constant (one source of pacing)', () => {
    // A second literal would let the two drift; the reported bug was a 500 in
    // exactly one of them.
    expect(BEAT_STAGGER_MS).toBe(EVENT_PACING_MS);
  });

  it('LIFE-NODE-11 — the second event lands a full pacing gap after the first', () => {
    const seen: Array<{ id: string; at: number }> = [];
    const t0 = Date.now();
    seq([bubble('a'), bubble('b')], (b) => seen.push({ id: b.id, at: Date.now() - t0 }));
    vi.advanceTimersByTime(BEAT_PAUSE_MS);
    expect(seen.map((s) => s.id)).toEqual(['a']);
    // One tick BEFORE the gap elapses, the second event must still be absent.
    vi.advanceTimersByTime(EVENT_PACING_MS - 1);
    expect(seen.map((s) => s.id)).toEqual(['a']);
    vi.advanceTimersByTime(1);
    expect(seen.map((s) => s.id)).toEqual(['a', 'b']);
    expect(seen[1]!.at - seen[0]!.at).toBeGreaterThanOrEqual(EVENT_PACING_MS);
  });

  it('LIFE-NODE-11 — the engine is not stalled: scheduling returns synchronously', () => {
    // The pacing is VISUAL. It must not be awaited by the caller, or the
    // commit + the options transition would be held behind it.
    const append = vi.fn();
    const arrival = seq([bubble('a'), bubble('b')], append);
    expect(typeof arrival.release).toBe('function');
    expect(typeof arrival.cancel).toBe('function');
    expect(append).not.toHaveBeenCalled();
  });

  it('LIFE-NODE-11 — cancelling stops the pending events (navigate-away mid-stagger)', () => {
    const append = vi.fn();
    const arrival = seq([bubble('a'), bubble('b'), bubble('c')], append);
    vi.advanceTimersByTime(BEAT_PAUSE_MS);
    expect(append).toHaveBeenCalledTimes(1);
    arrival.cancel();
    vi.advanceTimersByTime(EVENT_PACING_MS * 5);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('LIFE-NODE-11 — cancelPendingTurnArrivals() drains every in-flight sequence', () => {
    // The unmount path: the screen goes away, so nothing may append afterwards.
    const a = vi.fn();
    const b = vi.fn();
    seq([bubble('1'), bubble('2')], a);
    seq([bubble('3'), bubble('4')], b);
    cancelPendingTurnArrivals();
    vi.advanceTimersByTime(EVENT_PACING_MS * 10);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('LIFE-NODE-11 — a stale sequence (newer arrival) stops appending', () => {
    const append = vi.fn();
    let stale = false;
    seq([bubble('a'), bubble('b')], append, () => stale);
    vi.advanceTimersByTime(BEAT_PAUSE_MS);
    expect(append).toHaveBeenCalledTimes(1);
    stale = true;
    vi.advanceTimersByTime(EVENT_PACING_MS * 3);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('LIFE-NODE-11 — a single-event turn is not delayed by the pacing gap', () => {
    const append = vi.fn();
    seq([bubble('only')], append);
    vi.advanceTimersByTime(BEAT_PAUSE_MS);
    expect(append).toHaveBeenCalledTimes(1);
  });
});

describe('LIFE-NODE-11 — the options are the LAST beat of the turn', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cancelPendingTurnArrivals();
    vi.useRealTimers();
  });

  it('LIFE-NODE-11 — options released FIRST are held to the tail of the event queue', () => {
    // The crux: the options resolved before the events had even started
    // gliding. They must not appear until the queue has drained.
    const order: string[] = [];
    const arrival = seq([bubble('a'), bubble('b')], (b) => order.push(b.id));
    arrival.release(() => order.push('options'));
    expect(order).toEqual([]);
    vi.advanceTimersByTime(BEAT_PAUSE_MS);
    expect(order).toEqual(['a']);
    vi.advanceTimersByTime(EVENT_PACING_MS);
    expect(order).toEqual(['a', 'b']);
    // …and one MORE gap before the options, so they read as the final beat
    // rather than arriving alongside the last event.
    vi.advanceTimersByTime(EVENT_PACING_MS - 1);
    expect(order).toEqual(['a', 'b']);
    vi.advanceTimersByTime(1);
    expect(order).toEqual(['a', 'b', 'options']);
  });

  it('LIFE-NODE-11 — options released LAST are not delayed a second time', () => {
    // The queue has already settled, so a slow options call must not eat
    // another pacing gap on top of the one it already missed.
    const order: string[] = [];
    const arrival = seq([bubble('a')], (b) => order.push(b.id));
    vi.advanceTimersByTime(BEAT_PAUSE_MS + EVENT_PACING_MS);
    expect(order).toEqual(['a']);
    arrival.release(() => order.push('options'));
    expect(order).toEqual(['a', 'options']); // synchronous, no further wait
  });

  it('LIFE-NODE-11 — a turn with NO events still releases its options', () => {
    // Guard: the held-back options must never be stranded behind an empty
    // queue.
    const order: string[] = [];
    const arrival = seq([], () => order.push('never'));
    arrival.release(() => order.push('options'));
    vi.advanceTimersByTime(BEAT_PAUSE_MS + EVENT_PACING_MS);
    expect(order).toEqual(['options']);
  });

  it('LIFE-NODE-11 — a DROPPED event does not strand the player without options', () => {
    // The failure mode to guard hardest: an event that never renders (a hole
    // in the queue) must not swallow the options with it.
    const order: string[] = [];
    const holed = [bubble('a'), undefined as unknown as Bubble, bubble('c')];
    const arrival = seq(holed, (b) => order.push(b.id));
    arrival.release(() => order.push('options'));
    vi.advanceTimersByTime(BEAT_PAUSE_MS + EVENT_PACING_MS * 4);
    expect(order).toEqual(['a', 'c', 'options']);
  });

  it('LIFE-NODE-11 — an event that THROWS while rendering still releases the options', () => {
    const order: string[] = [];
    const arrival = seq([bubble('a'), bubble('boom'), bubble('c')], (b) => {
      if (b.id === 'boom') throw new Error('render failed');
      order.push(b.id);
    });
    arrival.release(() => order.push('options'));
    vi.advanceTimersByTime(BEAT_PAUSE_MS + EVENT_PACING_MS * 4);
    expect(order).toEqual(['a', 'c', 'options']);
  });

  it('LIFE-NODE-11 — cancelling drops the held options step (no update after unmount)', () => {
    const order: string[] = [];
    const arrival = seq([bubble('a'), bubble('b')], (b) => order.push(b.id));
    arrival.release(() => order.push('options'));
    vi.advanceTimersByTime(BEAT_PAUSE_MS);
    arrival.cancel();
    vi.advanceTimersByTime(EVENT_PACING_MS * 5);
    expect(order).toEqual(['a']);
  });

  it('LIFE-NODE-11 — releasing into a cancelled sequence is a no-op', () => {
    // The options call resolves AFTER the player has left the screen.
    const arrival = seq([bubble('a')], () => undefined);
    arrival.cancel();
    const step = vi.fn();
    arrival.release(step);
    vi.advanceTimersByTime(EVENT_PACING_MS * 5);
    expect(step).not.toHaveBeenCalled();
  });

  it('LIFE-NODE-11 — a superseded sequence never releases its options', () => {
    // A newer arrival owns the turn (and brings its own options); the stale
    // sequence must not paint the previous turn's chips over it.
    const step = vi.fn();
    let stale = false;
    const arrival = seq([bubble('a'), bubble('b')], () => undefined, () => stale);
    arrival.release(step);
    vi.advanceTimersByTime(BEAT_PAUSE_MS);
    stale = true;
    vi.advanceTimersByTime(EVENT_PACING_MS * 5);
    expect(step).not.toHaveBeenCalled();
  });
});

describe('LIFE-LANG-18 — retired', () => {
  const stepBeat = {
    speaker: 'npc',
    speakerName: 'Sophie',
    practiceText: 'Bonjour, mon ami.',
    nativeText: 'Hello, my friend.',
    complexWords: ['bonjour'],
    wordTranslations: { bonjour: 'hello' },
    // A stale in-memory beat (or an unparsed cast) still carrying the key.
    swapWords: ['bonjour'],
  } as unknown as StepBeat;

  it('LIFE-LANG-18 — retired: no swapWords reaches a rendered bubble or a persisted payload', () => {
    const live = beatsToBubbles([stepBeat])[0]!;
    expect(live).not.toHaveProperty('swapWords');
    expect(live.complexWords).toEqual(['bonjour']);
    const payload = beatToPayload(stepBeat);
    expect(payload).not.toHaveProperty('swapWords');
    const [fromPayload] = payloadsToBubbles([
      { ...payload, swapWords: ['bonjour'] } as unknown as LifeBeatPayload,
    ]);
    expect(fromPayload).not.toHaveProperty('swapWords');
  });
});
