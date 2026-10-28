/**
 * LifeScreen's local screen-state types + initial value. Extracted
 * from LifeScreen.tsx in Wurlds-v2 Phase D (600-LOC cap); slimmed in
 * Phase F — turn-flow state (choices, graded, practicePrompt,
 * feedback, busy, pendingHook) moved into the node engine
 * (useNodeEngine, LIFE-NODE-*). No behaviour lives here.
 */
import type { Bubble } from './DialogueArea';
import type { BackdropIntent } from '@/lib/life/stepSchema';
import type { SceneCompletionSnapshot } from '@/lib/life/sceneLifecycle';
import type { WorldArc } from '@/types/firestore';

export type LocalState = {
  /** What the user sees as bubbles. Capped at 2 by DialogueArea. */
  bubbles: Bubble[];
  /** Most recent backdropIntent — drives the BackdropStage descriptor.
   *  Fed by the engine's onBackdropIntent callback. */
  backdropIntent: BackdropIntent | null;
  /** Bubble ids of the current turn (gradient border). */
  currentTurnIds: ReadonlySet<string>;
  /** LIFE-SCENE-10: scene-complete overlay snapshot. */
  completedScene: SceneCompletionSnapshot | null;
  /** LIFE-SCENE-30: a scene has resolved but the player has not opened its
   *  summary yet. Held here rather than promoted straight to `completedScene`
   *  so the resolution beat plays out on screen first — the modal used to
   *  cover the very line that explained how the scene ended. */
  pendingSceneComplete: SceneCompletionSnapshot | null;
  /** LIFE-SCENE-31: the one line `runSceneClose` wrote for this scene — what
   *  the WORLD recorded, as opposed to `outcomeLine`, which is the resolution
   *  BEAT the player has already read on screen. The completion screen leads
   *  with this.
   *
   *  Null while the close is still in flight. It runs in the background from
   *  the same turn that resolved the scene, and the overlay is parked behind a
   *  chip (LIFE-SCENE-30), so by the time the player opens the summary it has
   *  almost always landed — but "almost always" is not "always", hence a
   *  nullable field and a placeholder rather than a blocked screen. */
  sceneSummary: string | null;
  /** LIFE-SCENE-31.1: the close has REPORTED, whatever it found. Separates
   *  "not back yet" (shimmer) from "back with nothing" (a terminal row) — the
   *  distinction whose absence made a failed close shimmer for ever. */
  sceneSummaryDone: boolean;
  /** LIFE-WORLD-ARC-*: chapter-complete overlay payload. */
  arcComplete: {
    arc: WorldArc;
    snapshot: SceneCompletionSnapshot;
  } | null;
};

export const INITIAL_STATE: LocalState = {
  bubbles: [],
  backdropIntent: null,
  currentTurnIds: new Set(),
  completedScene: null,
  pendingSceneComplete: null,
  sceneSummary: null,
  sceneSummaryDone: false,
  arcComplete: null,
};
