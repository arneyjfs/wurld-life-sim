/**
 * LIFE-NODE-*: shared types + constants for the client-side
 * node/lookahead turn engine. The engine is split across three
 * files to respect the 600-LOC ESLint cap:
 *
 *   nodeEngineTypes.ts   — types + constants (this file)
 *   nodeEngineActions.ts — createEngineActions (all machine logic)
 *   useNodeEngine.ts     — the React hook + public re-exports
 *
 * Everything outside the engine imports from './useNodeEngine',
 * which re-exports the public names below.
 *
 * Spec: docs/specs/life-sim.md §10.46.
 */
import type { GenerateStepOptionsResult } from '@/lib/life/generateStepOptions';
import type { SceneCompletionSnapshot } from '@/lib/life/sceneLifecycle';
import type {
  GradedPlan,
  PracticePrompt,
  BackdropIntent,
  StepChoice,
  StepOption,
  QuestionResolution,
} from '@/lib/life/stepSchema';
import type { CardMatchPair } from '@/lib/life/cardMatch';
import type {LifeScene, LifeEvent, LifeNpc, LifeWorld, } from '@/types/firestore';
import type { Bubble } from './DialogueArea';

/** LIFE-NODE-*: the client turn phases. */
/** OBS-COVER-7 — how Life surfaces a failure: the error itself and an
 *  `action` label, never pre-rendered copy (the sink reports, then toasts). */
export type LifeErrorSink = (err: unknown, action: string) => void;

export type TurnPhase =
  | 'live-loading'
  | 'options-loading'
  | 'options-ready'
  | 'question-authoring'
  | 'question-ready'
  | 'card-match'
  | 'feedback'
  | 'options-failed';

/** Chip id of the client-synthesized Continue chip in the
 *  options-failed ladder (LIFE-NODE-8). */
export const CONTINUE_AFTER_FAILURE_ID = '__continue__';

/** LIFE-SCENE-30: the chip that opens the scene summary. A client-synthesised
 *  id like `CONTINUE_AFTER_FAILURE_ID` — the model never authors it, and it is
 *  never routed through `pick()`; `LifeScreenBottom` calls
 *  `onViewSceneSummary` directly. It exists so the chip has a stable key and a
 *  stable test selector. */
export const VIEW_SCENE_SUMMARY_ID = '__view-scene-summary__';

/** LIFE-NEED-5: the chip that CLEARS a blocked objective. Client-synthesised
 *  like `WRITE_YOUR_OWN_ID` — the model never authors it, and it is never
 *  routed through `pick()`: `LifeScreenBottom` submits the clearing move as
 *  free text, because there is no option with this id in the model's grid.
 *
 *  Synthesised rather than requested from the model on purpose. `LIFE-NEED-5`
 *  says the door is ALWAYS on the same grid as the block, and a door the model
 *  is merely ASKED for is a door that is sometimes missing — which is the wall
 *  the invariant exists to forbid. Code putting it there makes it structural. */
export const CLEAR_BLOCK_ID = '__clear-block__';

/** Feedback shown after a graded chip pick (moved from LifeScreen). */
export type FeedbackState = {
  correct: boolean;
  picked: StepChoice;
  correctAnswer: StepChoice;
  outcomeKind: 'generation' | 'comprehension';
  promptSource: string;
  /** LIFE-LANG-6: the FULL practice-language sentence shown in the
   *  feedback overlay — fill-blank = the completed sentence (blank
   *  filled with the correct chip), comprehension = the NPC utterance. */
  sentencePractice: string;
  /** LIFE-LANG-6: the native translation of `sentencePractice` —
   *  fill-blank = practicePrompt.completedNativeText, comprehension =
   *  the correct chip's interpretation. Always rendered post-answer so
   *  the learner sees the sentence's meaning. */
  sentenceNative: string;
  /** LIFE-EX-DIR-1: the resolved bubble's attribution. These are the
   *  `GradedDirection`'s values (`gradedDirection(activePlanRef.current)`,
   *  `src/lib/life/gradedQuestionEngine.ts`) and MUST NOT be re-read from
   *  `practicePrompt.speakerName` / `.npcId` — the generator no longer authors
   *  those, and a model echo of a fact the client already holds is the
   *  attribution-drift vector LIFE-CANON-4 describes. Meaningful only when
   *  `outcomeKind === 'comprehension'` (a `speaker: 'npc'` direction); null on
   *  fill-blank, where the direction is `{ speaker: 'player' }`. */
  speakerName?: string | null;
  npcId?: string | null;
  /** LIFE-EX-VOCAB-3: annotations for the line that becomes a bubble when this
   *  question resolves. Comprehension carried none; fill-blank had only the
   *  answer chip's, covering one token of a full sentence. */
  lineVocab?: Record<string, string> | null;
};

/** LIFE-UI-11: WHAT the `live-loading` wait is waiting for. The bar used to
 *  say "Thinking…" on every turn — the app describing its own machinery in the
 *  middle of a story. Keyed to the player's last action, so the wait reads as
 *  the story continuing rather than as latency. */
/** LIFE-SPEECH-8: `'hear'` was here and is gone with the speechAct it mirrored.
 *  `waitKindForTurn` derives this from `choice.speechAct`, so once that enum
 *  lost `hear` this member became unreachable — the same shape of dead branch
 *  `LIFE-EX-15` was about, and worth deleting for the same reason. */
export type WaitKind =
  | 'opening'
  | 'say'
  | 'act'
  | 'write'
  | 'resume'
  | 'outcome';

export type NodeEngineState = {
  phase: TurnPhase;
  /** LIFE-UI-11: what the current `live-loading` wait is about. Null outside
   *  that phase. */
  waitKind: WaitKind | null;
  /** Kind of the node currently on screen; drives ✏️ injection
   *  (branch only) + composer availability. */
  nodeKind: 'branch' | 'continuation' | 'question' | null;
  /** Options for the current node (options-ready). */
  options: StepOption[];
  /** Authored question (question-ready / feedback — kept populated
   *  through 'feedback' so the Why? ExplainModal can read it). */
  question: {
    practicePrompt: PracticePrompt;
    choices: StepChoice[];
    /** TTS-VOICE-7: the exact line the listening variants SPEAK, taken from the
     *  PLAN (`plannedSpokenLine`) rather than rebuilt from the template + chip.
     *  It is what the engine pre-warmed a round-trip earlier, so speaking
     *  anything else would ask for a cache key nothing filled. */
    spokenLine?: string;
  } | null;
  feedback: FeedbackState | null;
  /** ✏️ composer open (options-ready on a branch node only). */
  composerOpen: boolean;
  /** LIFE-EX-10: the active card-matching review (phase 'card-match') — the
   *  deck pairs + shuffle seed. Null outside the review. */
  cardMatch: { pairs: CardMatchPair[]; seed: number } | null;
  /**
   * LIFE-EX-13.3: a scene review is OWED but not yet on screen.
   *
   * `LIFE-EX-13.2` split arming from opening — the review is armed when the
   * scene resolves and opens when the turn settles — and the gap between them
   * is the beat glide, which is long enough to see. `onSceneResolved` has
   * already set `sceneSummaryPending`, so for that window `LifeScreenBottom`
   * rendered the "View scene summary" chip and then yanked it away when the
   * grid arrived. Reported as the chip briefly flashing.
   *
   * The flag closes the window: it counts as mid-activity (the chip waits) and
   * renders the ordinary question-loading shimmer instead, which is what the
   * moment actually is — an exercise is being prepared. Cleared when the grid
   * opens OR when the review declines, so it can never strand the chip.
   */
  cardMatchPending: boolean;
};

export type NodeEngineActions = {
  /** LIFE-BACKDROP-21: start the opening turn WITHOUT arriving at it, so its
   *  `backdropIntent` reaches the scene renderer while the player is still
   *  reading the saga. Safe to call repeatedly; only the first fires. */
  prefetchOpening: () => void;
  /** Fresh world: fire the opening live turn. Consumes the `prefetchOpening`
   *  promise when there is one, so Begin arrives from cache. */
  startOpening: () => void;
  /** Resumed world: show the single resume chip (screen provides
   *  the i18n'd option; its pick routes to continueTurn). */
  startResume: (option: StepOption) => void;
  /** Bare live turn (<turn kind="continue">) — resume pick, post-
   *  scene-close, options-failed Continue. */
  continueTurn: () => void;
  pick: (choiceId: string) => void;
  /** LIFE-EX-8: type-to-fill submit (question-ready fill-blank as text input). */
  submitTyped: (typed: string) => void;
  /** LIFE-EX-11: word-order submit (fill-blank rebuilt from a shuffled bank). */
  submitOrder: (built: string) => void;
  closeComposer: () => void;
  /** LIFE-REP-5: `investIn` names the person the turn is spent on — set only
   *  by the clearing chip on a `who` block, and the reason the door is
   *  guaranteed to move standing rather than hoping the model reports it. */
  submitFreeText: (text: string, investIn?: string | null) => void;
  feedbackContinue: () => void;
  /** LIFE-EX-10: the card-matching review is solved → advance the story. */
  completeCardMatch: () => void;
};

export type UseNodeEngineProps = {
  uid: string | null;
  world: LifeWorld | null;
  events: LifeEvent[];
  scene: LifeScene | null;
  /** Pre-scoped by LifeScreen (world ∪ active scene, transients
   *  dropped — LIFE-SCENE-8 / LIFE-NPC-RECUR-4). */
  npcs: ReadonlyArray<LifeNpc>;
  appendBubbles: (bubbles: Bubble[], opts: { resetTurn: boolean }) => void;
  onBackdropIntent: (intent: BackdropIntent) => void;
  onSceneResolved: (snapshot: SceneCompletionSnapshot) => void;
  /** LIFE-SCENE-31: the one line `runSceneClose` recorded for the scene that
   *  just ended — what the WORLD kept, not the resolution beat the player has
   *  already read. Fires LATER than `onSceneResolved`: the close is a separate
   *  generation kicked off by the same turn, so the screen has to be able to
   *  open its summary without it and fill the line in when it lands. */
  /** LIFE-SCENE-31.1: fires EXACTLY ONCE per resolve, on every path including
   *  failure. `null` means "we tried and there is no record" — a TERMINAL
   *  state, distinct from "not back yet", which is the absence of this call.
   *  Without that distinction the card cannot tell waiting from failed, which
   *  is what made a failed close shimmer for ever. */
  onSceneSummary: (historyLine: string | null) => void;
  /** OBS-COVER-7 — the error itself (not copy) plus an `action` label; the
   *  screen reports it to Sentry and renders the toast. */
  onError: LifeErrorSink;
  /** TTS-VOICE-7: the player's saved speech pace (TTS-SPEED-1). The engine
   *  needs it ONLY so the audio it pre-warms lands on the same cache key
   *  playback will ask for — a prefetch at the wrong speed is not a slower
   *  prefetch, it is a paid clip nobody ever hears. */
  speechSpeed?: number;
};

export const INITIAL_ENGINE_STATE: NodeEngineState = {
  phase: 'options-ready',
  waitKind: null,
  nodeKind: null,
  options: [],
  question: null,
  feedback: null,
  composerOpen: false,
  cardMatch: null,
  cardMatchPending: false,
};

/** The stable refs createEngineActions closes over. The hook builds
 *  this once; nothing here changes identity across renders. */
export type EngineDeps = {
  propsRef: { current: UseNodeEngineProps };
  machineRef: { current: NodeEngineState };
  localEventsRef: { current: LifeEvent[] };
  nonceRef: { current: number };
  prefetchRef: { current: Promise<GenerateStepOptionsResult> | null };
  /** LIFE-BACKDROP-21: the OPENING turn, started while the intro card is up so
   *  its `backdropIntent` can drive the first scene gen. Distinct from
   *  `prefetchRef` (the post-feedback turn) — the two are in flight at
   *  different moments and sharing one slot would let Begin consume the
   *  wrong promise. */
  openingPrefetchRef: { current: Promise<GenerateStepOptionsResult> | null };
  replanRef: { current: Promise<void> | null };
  /** LIFE-SCENE-24: a scene generation is in flight. One at a time — each one
   *  WRITES the active scene doc, so two racing would have the loser silently
   *  replace a story the player is already several turns into. */
  sceneStartRef: { current: boolean };
  activePlanRef: { current: GradedPlan | null };
  /** LIFE-EX-PLAN-5: the continuation the question node pre-authored, held from
   *  the node's arrival until the player taps Continue. Null when the model
   *  omitted one (or the slot became a card-match review), which is the signal
   *  to fall back to a live post-feedback turn. */
  activeResolutionRef: { current: QuestionResolution | null };
  transition: (patch: Partial<NodeEngineState>) => void;
};
