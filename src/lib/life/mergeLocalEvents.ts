/**
 * LIFE-NODE-3: in-memory event overlay. commitNode's writes are
 * fire-and-forget, so the Firestore listener may not have delivered
 * the just-committed decision/beat events when the NEXT prompt is
 * assembled. The engine mirrors each commit as a local LifeEvent and
 * merges it after the listener's list; a local entry is dropped as
 * soon as a listener event with the same fingerprint (kind + primary
 * text) shows up.
 *
 * The fingerprint is deliberately coarse — a duplicated text would
 * at worst drop an overlay entry one turn early, costing the model
 * one duplicate-looking event. Cheap and deterministic.
 */
import type { LifeBeatPayload, LifeEvent } from '@/types/firestore';
import type { PracticeOutcome } from './generateStepOptions';

/** Overlay never grows past this — the listener catches up within a
 *  turn or two, and a runaway overlay would double-feed the prompt. */
const MAX_LOCAL = 12;

function localEventId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function localBeatEvent(beat: LifeBeatPayload): LifeEvent {
  return { id: localEventId(), kind: 'beat', payload: { ...beat } };
}

export function localDecisionEvent(d: {
  choiceId: string;
  text: string;
  /** LIFE-GRID-4: carried so `actionShapesFromEvents` can rebuild the grid's
   *  cross-turn memory from the log. Optional — worlds predating LIFE-GRID-1.1
   *  have decision rows without it. */
  actionType?: string;
  targetId?: string | null;
}): LifeEvent {
  return { id: localEventId(), kind: 'decision', payload: { ...d } };
}

export function localCorrectionEvent(o: PracticeOutcome): LifeEvent {
  return {
    id: localEventId(),
    kind: 'correction',
    payload: {
      kind: o.kind,
      correct: o.correct,
      picked: o.picked,
      correctAnswer: o.correctAnswer,
      // LIFE-VOCAB-RECAP-7: same spread-when-present shape as commitNode.
      // Without it the optimistic row would render a save button that
      // disappeared the moment the listener's copy replaced it.
      ...(o.correctAnswerNative?.trim()
        ? { correctAnswerNative: o.correctAnswerNative.trim() }
        : {}),
      promptSource: o.promptSource,
      // LIFE-EX-SRS-2: mirror what commitNode writes so the overlay
      // fingerprint-matches the listener's delivered event.
    },
  };
}

/** LIFE-EX-CADENCE-1: a graded slot that was planned and then rejected. Written
 *  on the `LIFE-NODE-8` graceful-demote path so `cyoaStreak` sees the slot as
 *  SPENT — without it the `<practiceCadence>` directive re-fires on the very
 *  next node and the demote repeats. Never rendered into the prompt. */
export function localQuestionDemotedEvent(reason: string): LifeEvent {
  return {
    id: localEventId(),
    kind: 'question_demoted',
    payload: { reason },
  };
}

function fingerprint(e: LifeEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  // practiceText first, but NARRATOR beats leave it EMPTY (two-channel model,
  // LIFE-LANG-8 — narration rides nativeText). Falling back to nativeText is
  // load-bearing: without it every narrator beat collides to "beat:", so
  // pruneDelivered drops a just-committed narration the moment the listener
  // tail holds any other narrator beat — defeating LIFE-NODE-3's overlay for
  // narration specifically. The `||` chain (not the old ternary) makes an
  // empty practiceText fall through.
  const text =
    str(p.practiceText) ||
    str(p.nativeText) ||
    str(p.text) ||
    str(p.correctAnswer) ||
    '';
  return `${e.kind}:${text}`;
}

/** Local entries not yet visible in the listener's tail. */
export function pruneDelivered(
  listener: ReadonlyArray<LifeEvent>,
  local: ReadonlyArray<LifeEvent>,
): LifeEvent[] {
  if (local.length === 0) return [];
  const tail = listener.slice(-(local.length + 8));
  const seen = new Set(tail.map(fingerprint));
  return local.filter((e) => !seen.has(fingerprint(e))).slice(-MAX_LOCAL);
}

/** The event list a prompt should see: listener + undelivered local
 *  tail, chronological. */
export function mergeLocalEvents(
  listener: ReadonlyArray<LifeEvent>,
  local: ReadonlyArray<LifeEvent>,
): LifeEvent[] {
  const pending = pruneDelivered(listener, local);
  return pending.length === 0 ? [...listener] : [...listener, ...pending];
}
