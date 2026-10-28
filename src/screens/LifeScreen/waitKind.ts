import type { WaitKind } from './nodeEngineTypes';

/**
 * LIFE-UI-11 — what the `live-loading` wait is FOR.
 *
 * The bar said "Thinking…" on every turn: the app narrating its own machinery
 * in the middle of a scene, on the element the player sees more often than any
 * other. This derives a story-voiced label from the action that caused the
 * wait, so the copy varies MEANINGFULLY — it tells you what is being waited on
 * — rather than randomly. Random rotation on a 2-3s element that fires every
 * turn reads as noise, and would need seeding to stay stable across a
 * re-render mid-wait.
 *
 * Extracted from `nodeEngineActions.ts` for the 600-LOC cap, and the split
 * earns itself: the precedence below is the whole behaviour, and it is a pure
 * function of the turn shape.
 */
export function waitKindForTurn(opts: {
  practiceOutcome?: unknown;
  freeText?: string | null;
  choice?: { speechAct?: 'say' | 'act' } | null;
  /** Events already on the world — 0 means this is the very first turn. */
  eventCount: number;
}): WaitKind {
  // Order matters: a graded outcome and a free-text submit both arrive WITH no
  // choice, and the opening turn arrives with none of the three.
  if (opts.practiceOutcome) return 'outcome';
  if (opts.freeText) return 'write';
  // `act` is the documented default when a chip omits `speechAct` (step SI:
  // "This is the DEFAULT; omit speechAct for it"), and "seeing what happens"
  // is true of any action, so it is the safe floor.
  if (opts.choice) return opts.choice.speechAct ?? 'act';
  return opts.eventCount === 0 ? 'opening' : 'resume';
}
