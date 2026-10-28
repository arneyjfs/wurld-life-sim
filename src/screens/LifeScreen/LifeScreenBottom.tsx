/**
 * LifeScreen's bottom render area — one branch per TurnPhase
 * (LIFE-NODE-*): feedback overlay, thinking bar (live-loading),
 * question-authoring shimmer, skeleton chips (options-loading),
 * options-failed Continue ladder, question chips, option chips +
 * client ✏️ chip (LIFE-NODE-4).
 */
import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import type { WaitKind } from './nodeEngineTypes';
import {
  OPTION_BAR_CLASS,
  OPTION_CHIP_SKELETON_H,
  OPTION_FRAME_CLASS,
  OPTION_FRAME_COLUMN_CLASS,
  OPTION_FRAME_SLOT_CLASS,
  OPTION_GRID_CLASS,
  OPTION_GRID_MIN_H,
  SKELETON_CHIP_COUNT,
} from './optionRowMetrics';
import { cn } from '@/lib/cn';
import { ActionBar, type Choice, type FlashcardMatch } from './ActionBar';
import { PracticePromptCard } from './PracticePromptCard';
import { PracticeFeedback } from './PracticeFeedback';
import { TypeToFillInput } from './TypeToFillInput';
import { WordOrderInput } from './WordOrderInput';
import { ListenComprehensionCard } from './ListenComprehensionCard';
import { ListenFillCard } from './ListenFillCard';
import { CardMatchExercise } from './CardMatchExercise';
import {
  chooseGenerationVariant,
  completedFillBlank,
  shouldListenComprehension,
} from '@/lib/life/exerciseVariant';
import type { CardMatchPair } from '@/lib/life/cardMatch';
// nodeEngineTypes, NOT useNodeEngine: this component must stay free
// of the engine's runtime import chain (jsdom component tests).
import {
  CONTINUE_AFTER_FAILURE_ID,
  VIEW_SCENE_SUMMARY_ID,
  CLEAR_BLOCK_ID,
  type FeedbackState,
  type TurnPhase,
} from './nodeEngineTypes';
import {
  WRITE_YOUR_OWN_ID,
  type PracticePrompt,
  type StepChoice,
  type StepOption,
} from '@/lib/life/stepSchema';

/** First letter up, rest untouched — `toLocaleUpperCase` so a non-ASCII
 *  initial (a place name, an accented noun) cases correctly rather than being
 *  left alone. Never lowercases the tail: "go to La Biblioteca" must keep its
 *  proper noun. */
const sentenceCase = (s: string): string =>
  s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;

export type LifeScreenBottomProps = {
  phase: TurnPhase;
  feedback: FeedbackState | null;
  question: {
    practicePrompt: PracticePrompt;
    choices: StepChoice[];
    /** TTS-VOICE-7: the line the engine PRE-WARMED, taken from the plan. The
     *  listen variants speak this so playback asks for the key that was
     *  filled; absent on a question authored before it shipped. */
    spokenLine?: string;
  } | null;
  options: StepOption[];
  nodeKind: 'branch' | 'continuation' | 'question' | null;
  composerOpen: boolean;
  /** LIFE-EX-10: the active card-matching review (phase 'card-match'). */
  cardMatch?: { pairs: CardMatchPair[]; seed: number } | null;
  /** LIFE-EX-13.3: a scene review is owed but not yet built. Holds the "View
   *  scene summary" chip back and shows the question-loading shimmer, so the
   *  chip does not flash for the length of the beat glide. */
  cardMatchPending?: boolean;
  /** LIFE-EX-10: fired when the review's last pair is matched → advance. */
  onCardMatchComplete?: () => void;
  /** Phase D viewMode-derived display for narrative option chips.
   *  Graded chips override it per question kind (LIFE-LANG-*):
   *  comprehension → 'native', fill-blank → 'practice'. */
  optionChipDisplay: 'both' | 'practice' | 'native';
  flashcardLookup: ReadonlyMap<string, FlashcardMatch>;
  /** LIFE-EX-8: effective difficulty — gates type-to-fill (fill-blank as a
   *  typed input at intermediate+ levels). */
  difficulty?: number | null;
  /** LIFE-EX-9: per-question rotation seed (count of graded questions already
   *  resolved this wurld) — picks the fill-blank render variant so the
   *  following-event questions vary (chips / type / listen). */
  exerciseSeed?: number;
  /** TTS-VOICE-2: the Gemini voice cast for the NPC whose line the current
   *  comprehension question is built on, resolved by the caller (the only
   *  place with the world's cast). Empty/undefined ⇒ the button keeps the
   *  player's own voice preference, which is the legacy-world behaviour. */
  speakerVoiceName?: string;
  /** The world's practice language — sets the type-to-fill input's `lang` +
   *  the listen-and-fill TTS language. */
  practiceLanguage?: string;
  /** LIFE-SCENE-30: the scene resolved and its summary is WAITING. The
   *  resolution beat has just glided in, so the options are replaced by a
   *  single chip and the player opens the modal when they have read it. */
  sceneSummaryPending?: boolean;
  /** LIFE-NEED-3/5: the live objective is blocked — the reason to show above
   *  the grid and the clearing move to offer on it. Null on the common
   *  unblocked turn, and the grid renders exactly as it always has. */
  objectiveBlock?: { reason: string; clearing: string; investIn?: string | null } | null;
  onViewSceneSummary?: () => void;
  onPick: (choiceId: string) => void;
  /** LIFE-EX-8: submit a typed fill-blank answer. */
  onTypeSubmit: (typed: string) => void;
  /** LIFE-EX-11: submit an assembled word-order sentence. */
  onOrderSubmit: (built: string) => void;
  onComposerCancel: () => void;
  /** LIFE-REP-5: the second argument names the person a clearing turn is
   *  spent on, so `commitNode` can guarantee the step. */
  onFreeText: (text: string, investIn?: string | null) => void;
  onFeedbackContinue: () => void;
  /** Phase D: opens the ExplainModal from the feedback overlay. */
  onExplain?: () => void;
  /** LIFE-UI-11: what the live-loading wait is for, so the bar can say it. */
  waitKind?: WaitKind | null;
};

export function LifeScreenBottom({
  phase,
  waitKind,
  feedback,
  question,
  options,
  nodeKind,
  composerOpen,
  cardMatch,
  cardMatchPending,
  onCardMatchComplete,
  optionChipDisplay,
  flashcardLookup,
  difficulty,
  exerciseSeed = 0,
  practiceLanguage,
  speakerVoiceName,
  sceneSummaryPending,
  objectiveBlock,
  onViewSceneSummary,
  onPick,
  onTypeSubmit,
  onOrderSubmit,
  onComposerCancel,
  onFreeText,
  onFeedbackContinue,
  onExplain,
}: LifeScreenBottomProps) {
  const t = useT();
  // LIFE-SCENE-30 — the scene has resolved and its summary is waiting.
  //
  // Checked BEFORE every phase branch on purpose. The resolving turn still
  // produced options, and rendering them would invite the player to walk on
  // past an ending they have not been shown; the summary is the only next step
  // that makes sense from here. Deliberately NOT gated on `phase`: resolution
  // can land on a normal options turn or on a graded one, and a phase list
  // here would be a second copy of the engine's state machine that silently
  // stops matching it.
  //
  // TWO surfaces still win, because both are mid-ACTIVITY rather than
  // between turns, and replacing either loses work the player has already
  // done: the feedback overlay (they have answered but not yet seen whether
  // they were right) and a card-match review (a partly-matched grid). Both
  // hand the screen back on their own, and the chip is waiting when they do.
  // LIFE-EX-13.3 adds a THIRD: a scene review that is owed but not yet on
  // screen. `LIFE-EX-13.2` split arming (on resolve) from opening (when the
  // turn settles), and the gap between them is the beat glide — long enough
  // that the chip appeared and was then snatched away when the grid arrived.
  // Reported as the summary chip briefly flashing.
  const midActivity =
    (feedback && phase === 'feedback') ||
    (phase === 'card-match' && !!cardMatch) ||
    cardMatchPending;
  if (sceneSummaryPending && onViewSceneSummary && !midActivity) {
    return (
      <div className="bg-(--color-bg)">
        <ActionBar
          choices={[
            {
              id: VIEW_SCENE_SUMMARY_ID,
              practiceText: t('life.sceneComplete.viewSummary'),
            },
          ]}
          onPick={onViewSceneSummary}
          chipDisplay="both"
        />
      </div>
    );
  }
  if (feedback && phase === 'feedback') {
    return (
      <PracticeFeedback
        correct={feedback.correct}
        picked={feedback.picked}
        correctAnswer={feedback.correctAnswer}
        lineVocab={feedback.lineVocab}
        whyWrong={feedback.picked.whyWrong}
        sentencePractice={feedback.sentencePractice}
        sentenceNative={feedback.sentenceNative}
        onContinue={onFeedbackContinue}
        onExplain={onExplain}
      />
    );
  }
  // LIFE-EX-13.4 — THERE IS NO SHIMMER BRANCH HERE, deliberately.
  //
  // `LIFE-EX-13.3` put one above this line, and it caused a hang reported the
  // next day: placed ahead of the phase list it also outranked `question-ready`,
  // so a scene closing on the same turn as a question — which is ordinary, not
  // an edge case — left `cardMatchPending` true, the shimmer covering an
  // authored question, and the player stuck on "preparing a question" with the
  // trace showing the question had generated fine.
  //
  // Suppressing the chip (`midActivity`, above) was the entire fix. Each phase
  // already renders its own loading surface — `question-authoring` renders the
  // very block that was being duplicated here — so the gap the owner saw is
  // covered without a second claimant to the slot.
  if (phase === 'card-match' && cardMatch && onCardMatchComplete) {
    // LIFE-EX-10: a deck-backed review replaces this graded slot.
    return (
      <CardMatchExercise
        pairs={cardMatch.pairs}
        seed={cardMatch.seed}
        onComplete={onCardMatchComplete}
      />
    );
  }
  if (phase === 'live-loading') {
    // LIFE-UI-12: the wait phrase takes the TITLE's slot and the skeleton
    // takes the grid — the same two boxes the loaded state fills.
    return (
      <OptionsLoadingBlock
        slotTestId="LifeScreen-ThinkingBar"
        // LIFE-UI-11: name what the story is doing, not what the app is
        // doing. Falls back to the generic line if the kind is unknown.
        label={waitKind ? t(`life.wait.${waitKind}`) : t('life.thinking')}
      />
    );
  }
  if (phase === 'question-authoring') {
    return <QuestionAuthoringBlock label={t('life.question.authoring')} />;
  }
  if (phase === 'options-loading') {
    // LIFE-NODE beats are already on screen; only the options are still
    // generating. LIFE-UI-12: ONE loading surface — the same block the
    // `live-loading` phase renders, so the two loading phases cannot disagree
    // with each other either.
    return <OptionsLoadingBlock slotTestId="LifeScreen-ThinkingBar" label={t('life.thinking')} />;
  }
  if (phase === 'options-failed') {
    // LIFE-NODE-8: the Continue ladder.
    return (
      <div className="bg-(--color-bg)">
        <div
          data-testid="LifeScreen-OptionsFailed"
          className="px-4 pt-3 text-center text-xs text-(--color-fg-muted)"
        >
          {t('life.optionsFailed.note')}
        </div>
        <ActionBar
          choices={[
            {
              id: CONTINUE_AFTER_FAILURE_ID,
              practiceText: t('life.optionsFailed.continue'),
            },
          ]}
          onPick={onPick}
          chipDisplay="both"
        />
      </div>
    );
  }
  if (phase === 'question-ready' && question) {
    const prompt = question.practicePrompt;
    // LIFE-EX-20: a generation exercise is a PAIR — how the prompt ARRIVES
    // (read / listen) and how the player RESPONDS (chips / type / order).
    // Comprehension has its own arrival rule and always answers with chips.
    const variant =
      prompt.kind === 'generation'
        ? chooseGenerationVariant(difficulty, exerciseSeed)
        : ({ arrival: 'read', response: 'chips' } as const);
    // LIFE-EX-20: the listening HEADER, shared by every response that can show
    // a blanked template beside the audio. Hoisted above the early returns
    // because `type` needs it too — that pairing (hear the sentence, then
    // produce the missing word from memory) is the hardest generation exercise
    // in the set and it did not exist before the axes were split.
    const listening = variant.arrival === 'listen' && prompt.kind === 'generation';
    const generationHeader = listening ? (
      <ListenFillCard
        prompt={prompt}
        // TTS-VOICE-7: prefer the PLAN's line — the one the engine warmed a
        // round-trip ago. `completedFillBlank` rebuilds the same sentence
        // from the template + chip and agrees 96.4% of the time; the
        // disagreements are punctuation spacing, which is enough to miss the
        // cache. Falls back to the reconstruction for a question authored
        // before this shipped, or any path with no plan line.
        completedSentence={
          question.spokenLine || completedFillBlank(prompt.practiceText, question.choices)
        }
        practiceLanguage={practiceLanguage}
        playbackKey={`life-listen-${exerciseSeed}`}
      />
    ) : null;
    // LIFE-EX-8: type-to-fill — the player TYPES the missing word.
    if (variant.response === 'type') {
      return (
        <>
          <div className="px-3 pt-2 bg-(--color-bg)">
            {generationHeader ?? <PracticePromptCard prompt={prompt} production />}
          </div>
          <TypeToFillInput
            onSubmit={onTypeSubmit}
            practiceLanguage={practiceLanguage}
          />
        </>
      );
    }
    // LIFE-EX-11: word-order — assemble the whole practice sentence from a
    // shuffled word bank, cued by its native meaning.
    // LIFE-EX-20: always `read` — see `arrivalFor`. Its answer IS the sentence,
    // so no template can share the screen with audio without giving it away.
    if (variant.response === 'order' && prompt.kind === 'generation') {
      return (
        <WordOrderInput
          sentence={completedFillBlank(prompt.practiceText, question.choices)}
          nativePrompt={prompt.completedNativeText ?? prompt.nativeText ?? undefined}
          seed={exerciseSeed}
          onSubmit={onOrderSubmit}
        />
      );
    }
    // LIFE-EX-9: listen-and-fill — the completed sentence is spoken; the player
    // picks the word they heard (chips below, practice-language).
    // LIFE-EX-12: the inbound sibling — the NPC's line is spoken and withheld
    // in print. Comprehension is ~half of all questions and had exactly one
    // presentation, which is what "they're always comprehension" actually felt
    // like: not the direction repeating, the SHAPE repeating.
    const header =
      generationHeader ??
      (prompt.kind === 'comprehension' &&
        shouldListenComprehension(prompt.kind, difficulty, exerciseSeed) ? (
        <ListenComprehensionCard
          prompt={prompt}
          practiceLanguage={practiceLanguage}
          voiceName={speakerVoiceName}
          playbackKey={`life-listen-comp-${exerciseSeed}`}
        />
      ) : (
        <PracticePromptCard prompt={prompt} />
      ));
    return (
      <>
        <div className="px-3 pt-2 bg-(--color-bg)">{header}</div>
        <ActionBar
          choices={question.choices}
          onPick={onPick}
          chipDisplay={prompt.kind === 'comprehension' ? 'native' : 'practice'}
          // NO flashcardLookup on graded turns: the chips ARE the answer
          // options (LIFE-LANG-1), so a chip whose text matches a saved card
          // must still tap-to-ANSWER, not open the vocab-card preview popover.
          // Essential for card-backed questions (LIFE-EX-SRS) where the correct
          // answer is a saved word by design; otherwise the question is
          // unanswerable in one tap.
        />
      </>
    );
  }
  // options-ready (also the pre-start idle shell: no options, no ✏️).
  const writeChip: Choice = {
    id: WRITE_YOUR_OWN_ID,
    practiceText: t('life.writeYourOwn.chip'),
    nativeText: null,
    emoji: '✏️',
  };
  // LIFE-NEED-5 — THE DOOR IS ON THE SAME GRID AS THE BLOCK.
  //
  // Appended, never substituted: exposure is information, not a corridor. The
  // player stays free to push at the blocked thing, which `LIFE-NEED-4` says
  // still costs the turn and still moves the story. Replacing the options
  // would make the block a wall with one exit, which is the shape v2 deleted.
  const clearChip: Choice | null = objectiveBlock
    ? {
        id: CLEAR_BLOCK_ID,
        // Sentence-cased for the CHIP only. `clearingMove` returns a bare
        // phrase because it is also submitted verbatim as the player's intent
        // ("spend this turn on Hélène"), where a capital would be noise — but
        // sat in the grid beside "Make breakfast" and "Write your own" the
        // lowercase form reads as a different KIND of thing, which is the one
        // impression this chip must not give. Capitalising at the render site
        // keeps the intent text and the label each right for their own job.
        practiceText: sentenceCase(objectiveBlock.clearing),
        nativeText: null,
        emoji: '🔑',
      }
    : null;
  const chips: Choice[] = [
    ...options,
    ...(nodeKind === 'branch' ? [writeChip] : []),
    ...(clearChip ? [clearChip] : []),
  ];
  // LIFE-OPT-VOICE: a per-turn person-frame above the CYOA chips so the
  // player always knows these are THEIR actions (never an NPC line / a
  // quiz). Hidden on the idle shell (no options) and while the composer
  // is open. Graded turns get their own eyebrow via PracticePromptCard.
  const showOptionsFrame = options.length > 0 && !composerOpen;
  return (
    <>
      {showOptionsFrame && (
        <OptionsFrame testId="LifeScreen-OptionsEyebrow">
          {t('life.options.eyebrow')}
        </OptionsFrame>
      )}
      {/* LIFE-NEED-3 — the block is stated BEFORE the choice, in fiction and
          attributed. Above the grid rather than under one chip because code
          cannot know which option advances the objective (see
          `objectiveBlockFor`), and because it is the OBJECTIVE that is blocked
          — every chip below is being picked in that light. An unsignalled
          failure is randomness; a signalled one is a decision. */}
      {showOptionsFrame && objectiveBlock && (
        <div
          data-testid="LifeScreen-ObjectiveBlock"
          className="mx-auto max-w-md w-full px-4 pb-1 text-xs italic text-(--color-fg-muted)"
        >
          {objectiveBlock.reason}
        </div>
      )}
      <ActionBar
        choices={chips}
        onPick={(id) => {
          // LIFE-NEED-5: the clearing chip is client-synthesised, so there is
          // no option with this id for `pick()` to find — routing it as an
          // ordinary pick would land nowhere. It goes in as the player's own
          // action, which is exactly what taking the door is.
          if (id === CLEAR_BLOCK_ID && objectiveBlock) {
            // LIFE-REP-5: `investIn` is what makes the door RELIABLE — code
            // guarantees the step rather than waiting on the model's `felt`.
            // Null for `what` / `where` blocks, which are not relationships.
            onFreeText(objectiveBlock.clearing, objectiveBlock.investIn);
            return;
          }
          onPick(id);
        }}
        onFreeText={onFreeText}
        composerOpen={composerOpen}
        onComposerCancel={onComposerCancel}
        disabled={chips.length === 0}
        chipDisplay={optionChipDisplay}
        flashcardLookup={flashcardLookup}
        // LIFE-UI-12: this is the grid the skeleton stands in for, so it holds
        // the two reserved rows even when the model returned only two options.
        reserveGrid={showOptionsFrame}
      />
    </>
  );
}

/**
 * LIFE-UI-12 / LIFE-OPT-VOICE — the frame row above the options grid. ONE
 * component for both occupants: the person-frame title when the options are
 * ready, the wait phrase while they generate. Sharing the component (not just
 * the numbers) is what makes the swap reflow-free — there is no second copy of
 * the wrapper or the slot to drift.
 */
function OptionsFrame({
  testId,
  children,
}: {
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className={OPTION_FRAME_CLASS} data-testid="LifeScreen-OptionsFrame">
      {/* LIFE-UI-15: the same column the chip grid uses, so the label sits over
          what it labels on a wide screen. */}
      <div className={OPTION_FRAME_COLUMN_CLASS}>
        <span data-testid={testId} className={OPTION_FRAME_SLOT_CLASS}>
          {children}
        </span>
      </div>
    </div>
  );
}

/**
 * LIFE-UI-12 — the loading state of the options block: the wait phrase in the
 * frame row, a 2×2 grid of two-line skeleton boxes below it. Structurally
 * identical to the loaded state (same frame, same bar, same grid classes,
 * same reserved height), so nothing above it moves when the real options
 * arrive. See `optionRowMetrics.ts` for why the count is 4.
 */
function OptionsLoadingBlock({
  slotTestId,
  label,
}: {
  slotTestId: string;
  label: string;
}) {
  return (
    <>
      <OptionsFrame testId={slotTestId}>
        <span className="flex items-center gap-1" aria-label="thinking">
          <span className="w-1 h-1 rounded-full bg-current animate-pulse [animation-delay:0ms]" />
          <span className="w-1 h-1 rounded-full bg-current animate-pulse [animation-delay:150ms]" />
          <span className="w-1 h-1 rounded-full bg-current animate-pulse [animation-delay:300ms]" />
        </span>
        <span>{label}</span>
      </OptionsFrame>
      <div className={OPTION_BAR_CLASS} data-testid="LifeScreen-SkeletonBar">
        <div
          data-testid="LifeScreen-SkeletonChips"
          className={cn(OPTION_GRID_CLASS, OPTION_GRID_MIN_H)}
        >
          {Array.from({ length: SKELETON_CHIP_COUNT }, (_, i) => (
            <div
              key={i}
              // `.skeleton-chip` (globals.css): the moving-gradient shimmer,
              // NOT `animate-pulse` on an elevated background — that recipe is
              // near-invisible in dark mode. Height comes from the shared
              // constant; the utility must never set one.
              className={cn(OPTION_CHIP_SKELETON_H, 'skeleton-chip')}
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * LIFE-UI-12 — the "an exercise is being prepared" surface, as ONE component.
 *
 * Extracted when `LIFE-EX-13.3` gained a second caller: the gap between a scene
 * review being armed and opening. Copying the markup would have been the same
 * mistake `LIFE-UI-12` records against the two loading phases — two surfaces
 * that mean the same thing and drift into looking different.
 */
function QuestionAuthoringBlock({ label }: { label: string }) {
  return (
    <div
      data-testid="LifeScreen-QuestionAuthoring"
      className="px-3 pt-2 pb-[max(var(--spacing-safe-bottom),1rem)] bg-(--color-bg)"
    >
      <div className="mx-auto max-w-md w-full px-4 py-3 rounded-2xl bg-(--color-bg-elevated) border border-(--color-accent)/30 animate-pulse">
        <div className="text-[10px] font-bold uppercase tracking-wider text-(--color-accent)">
          {label}
        </div>
        <div className="mt-2 h-4 rounded bg-(--color-bg-hover)" />
        <div className="mt-1.5 h-4 w-2/3 rounded bg-(--color-bg-hover)" />
      </div>
    </div>
  );
}
