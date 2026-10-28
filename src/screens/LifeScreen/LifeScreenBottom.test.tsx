import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { chooseGenerationVariant } from '@/lib/life/exerciseVariant';

// ListenFillCard renders a TTSButton (Firebase-backed tts lib). Stub it and
// capture the spoken text so the listen-and-fill test stays hermetic (LIFE-EX-9).
vi.mock('@/components/TTSButton', () => ({
  TTSButton: (p: { text: string }) => (
    <span data-testid="tts-stub" data-text={p.text} />
  ),
}));

import { LifeScreenBottom } from './LifeScreenBottom';
import {
  OPTION_CHIP_SKELETON_H,
  OPTION_GRID_MIN_H,
  SKELETON_CHIP_COUNT,
} from './optionRowMetrics';
import { CONTINUE_AFTER_FAILURE_ID, VIEW_SCENE_SUMMARY_ID } from './nodeEngineTypes';
import type { FlashcardMatch } from './ActionBar';
import type { PracticePrompt, StepChoice, StepOption } from '@/lib/life/stepSchema';

const comprehensionPrompt: PracticePrompt = {
  kind: 'comprehension',
  npcUtterance: 'Est-ce que tu connais un bon café ?',
  question: 'What is Sophie asking?',
  speakerName: 'Sophie',
  npcId: 'sophie',
};

const generationPrompt: PracticePrompt = {
  kind: 'generation',
  practiceText: 'Je ___ un café',
  nativeText: 'I ___ a coffee',
};

const comprehensionChoices: StepChoice[] = [
  { id: 'a', practiceText: 'Elle cherche un café', nativeText: "She's asking about a café", correctness: 'correct' },
  { id: 'b', practiceText: 'Elle cherche le bureau', nativeText: "She's asking about the office", correctness: 'wrong' },
  { id: 'c', practiceText: 'Elle propose une pause', nativeText: "She's offering a break", correctness: 'wrong' },
];

const generationChoices: StepChoice[] = [
  { id: 'a', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
  { id: 'b', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
  { id: 'c', practiceText: 'voulais', nativeText: '', correctness: 'wrong' },
];

const branchOptions: StepOption[] = [
  { id: 'go', practiceText: 'Rejoindre Sophie', nativeText: 'Join Sophie' },
  { id: 'wait', practiceText: 'Attendre', nativeText: 'Wait' },
];

function bottomProps(overrides: Partial<Parameters<typeof LifeScreenBottom>[0]>) {
  return {
    phase: 'options-ready' as const,
    feedback: null,
    question: null,
    options: [] as StepOption[],
    nodeKind: 'branch' as const,
    composerOpen: false,
    optionChipDisplay: 'both' as const,
    flashcardLookup: new Map<string, FlashcardMatch>(),
    onPick: vi.fn(),
    onTypeSubmit: vi.fn(),
    onOrderSubmit: vi.fn(),
    onComposerCancel: vi.fn(),
    onFreeText: vi.fn(),
    onFeedbackContinue: vi.fn(),
    onExplain: vi.fn(),
    ...overrides,
  };
}

function renderBottom(overrides: Partial<Parameters<typeof LifeScreenBottom>[0]>) {
  const props = {
    phase: 'options-ready' as const,
    feedback: null,
    question: null,
    options: [] as StepOption[],
    nodeKind: 'branch' as const,
    composerOpen: false,
    optionChipDisplay: 'both' as const,
    flashcardLookup: new Map<string, FlashcardMatch>(),
    onPick: vi.fn(),
    onTypeSubmit: vi.fn(),
    onOrderSubmit: vi.fn(),
    onComposerCancel: vi.fn(),
    onFreeText: vi.fn(),
    onFeedbackContinue: vi.fn(),
    onExplain: vi.fn(),
    ...overrides,
  };
  render(<LifeScreenBottom {...props} />);
  return props;
}

/**
 * LIFE-EX-17 — ask the CHOOSER which slot yields the variant under test.
 *
 * These used to hardcode `(difficulty 3, seed 2)` for listen and `(3, 1)` for
 * word-order, which pinned the rotation's arithmetic into a component test. When
 * the permitted set changed, three UI tests failed for a reason that had nothing
 * to do with the UI. The component's contract is "render the variant the chooser
 * picked" — so the test asks it.
 */
const seedForVariant = (difficulty: number, want: string): number => {
  // LIFE-EX-20: a variant is now a PAIR, so the helper searches the odometer
  // for the first seed producing the wanted arrival-or-response rather than
  // indexing one list. Same contract as before — "ask the chooser, don't pin
  // its arithmetic" — over a two-axis space.
  for (let seed = 0; seed < 24; seed++) {
    const v = chooseGenerationVariant(difficulty, seed);
    if (v.response === want || v.arrival === want) return seed;
  }
  throw new Error(`level ${difficulty} does not permit "${want}"`);
};

describe('LifeScreenBottom — phase branches + language pins', () => {
  it('LIFE-LANG-2 — question-ready comprehension renders the utterance card + native-only chips', () => {
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: comprehensionPrompt, choices: comprehensionChoices },
    });
    expect(screen.getByTestId('LifeScreen-PracticePrompt-Comprehension')).toHaveTextContent(
      'Est-ce que tu connais un bon café ?',
    );
    const chip = screen.getByTestId('LifeScreen-Choice-a');
    expect(chip).toHaveTextContent("She's asking about a café");
    expect(chip).not.toHaveTextContent('Elle cherche un café');
  });

  it('LIFE-LANG-2 — question-ready fill-blank renders the template card + gloss-free practice chips', () => {
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: generationPrompt, choices: generationChoices },
    });
    expect(screen.getByTestId('LifeScreen-PracticePrompt-FillBlank')).toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-Choice-a').textContent).toBe('voudrais');
  });

  it('LIFE-EX-8 — fill-blank on the TYPE slot renders a typed input, not chips; submit fires onTypeSubmit', () => {
    const props = renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: generationPrompt, choices: generationChoices },
      difficulty: 4,
      exerciseSeed: seedForVariant(4, 'type'),
    });
    // The chip grid is replaced by the type-to-fill input.
    expect(screen.getByTestId('LifeScreen-TypeToFill')).toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-Choice-a')).not.toBeInTheDocument();
    // Type + submit → onTypeSubmit fires with the typed string.
    fireEvent.change(screen.getByTestId('LifeScreen-TypeToFill-Input'), {
      target: { value: 'voudrais' },
    });
    fireEvent.click(screen.getByTestId('LifeScreen-TypeToFill-Submit'));
    expect(props.onTypeSubmit).toHaveBeenCalledWith('voudrais');
  });

  it('LIFE-EX-20 — LISTEN + TYPE compose: audio card AND typed input, no chips', () => {
    // The pair the axis split exists to create. Before it, `listen` and `type`
    // were rivals for one slot, so the hardest generation exercise there is —
    // hear the sentence, then produce the missing word with nothing to
    // recognise it from — could not be expressed, let alone reached.
    //
    // Asserted at the component, not just at the chooser: `chooseGenerationVariant`
    // returning the pair proves nothing about whether the render can put both
    // halves on screen together, and the render is where the two used to be
    // mutually exclusive early-returns.
    const seed = (() => {
      for (let s = 0; s < 24; s++) {
        const v = chooseGenerationVariant(4, s);
        if (v.arrival === 'listen' && v.response === 'type') return s;
      }
      throw new Error('level 4 never produces listen+type');
    })();
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: generationPrompt, choices: generationChoices },
      difficulty: 4,
      exerciseSeed: seed,
      practiceLanguage: 'French',
    });
    expect(screen.getByTestId('LifeScreen-ListenFill')).toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-TypeToFill')).toBeInTheDocument();
    // The audio must NOT come with a chip grid — that would hand back the
    // recognition scaffold the typed response is meant to remove.
    expect(screen.queryByTestId('LifeScreen-Choice-a')).not.toBeInTheDocument();
  });

  it('LIFE-EX-9 — fill-blank on the LISTEN slot speaks the COMPLETED sentence + keeps practice chips', () => {
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: generationPrompt, choices: generationChoices },
      difficulty: 3,
      exerciseSeed: seedForVariant(3, 'listen'),
      practiceLanguage: 'French',
    });
    // The listen-and-fill card renders (not the plain fill-blank card / typed input).
    expect(screen.getByTestId('LifeScreen-ListenFill')).toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-TypeToFill')).not.toBeInTheDocument();
    // TTS speaks the sentence with the CORRECT word filled in (not the raw blank).
    expect(screen.getByTestId('tts-stub')).toHaveAttribute(
      'data-text',
      'Je voudrais un café',
    );
    // The player still answers via the practice-language chips (pick what they heard).
    expect(screen.getByTestId('LifeScreen-Choice-a')).toHaveTextContent('voudrais');
  });

  it('LIFE-EX-9 — comprehension is NEVER a listen-and-fill (no blank to fill), even on a listen slot', () => {
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: comprehensionPrompt, choices: comprehensionChoices },
      difficulty: 3,
      exerciseSeed: 2,
    });
    expect(screen.queryByTestId('LifeScreen-ListenFill')).not.toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-PracticePrompt-Comprehension')).toBeInTheDocument();
  });

  it('LIFE-EX-11 — fill-blank on the word-ORDER slot renders the word bank builder', () => {
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: generationPrompt, choices: generationChoices },
      difficulty: 3,
      exerciseSeed: seedForVariant(3, 'order'),
    });
    // The word-order builder replaces the chip grid (+ not the type / listen forms).
    expect(screen.getByTestId('LifeScreen-WordOrder')).toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-TypeToFill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-ListenFill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-Choice-a')).not.toBeInTheDocument();
  });

  it('LIFE-EX-8 — fill-blank at beginner level (difficulty 1) keeps the chip grid', () => {
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: generationPrompt, choices: generationChoices },
      difficulty: 1,
    });
    expect(screen.getByTestId('LifeScreen-Choice-a')).toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-TypeToFill')).not.toBeInTheDocument();
  });

  it('LIFE-EX-8 — comprehension at high difficulty still uses chips (never typed)', () => {
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: comprehensionPrompt, choices: comprehensionChoices },
      difficulty: 6,
    });
    expect(screen.queryByTestId('LifeScreen-TypeToFill')).not.toBeInTheDocument();
  });

  it('LIFE-EX-SRS-2 — a graded chip whose text matches a saved card still taps to ANSWER (no vocab popover)', () => {
    // Regression guard: on a GRADED turn the chips are answer options, so the
    // vocab-card affordance (LIFE-EX-VOCAB-1) is suppressed even when a chip
    // matches a saved flashcard. Card-backed questions (LIFE-EX-SRS) test a
    // saved card by design — the correct answer IS a saved word — so the chip
    // must tap-to-answer, not open the vocab preview popover.
    const props = renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: generationPrompt, choices: generationChoices },
      flashcardLookup: new Map<string, FlashcardMatch>([
        ['voudrais', { id: 'card-1', phrase: 'voudrais', translation: 'would like' }],
      ]),
    });
    const chip = screen.getByTestId('LifeScreen-Choice-a');
    expect(chip).not.toHaveAttribute('data-vocab', 'true');
    fireEvent.click(chip);
    expect(props.onPick).toHaveBeenCalledWith('a');
  });

  it('LIFE-NODE-4 — branch nodes get the client ✏️ chip; continuation nodes do not', () => {
    renderBottom({ options: branchOptions, nodeKind: 'branch' });
    expect(screen.getByTestId('LifeScreen-Choice-__write__')).toBeInTheDocument();
  });

  it('LIFE-NODE-4 — no ✏️ chip on a continuation node', () => {
    renderBottom({
      options: [{ id: 'continue', practiceText: 'Continuer', nativeText: 'Continue' }],
      nodeKind: 'continuation',
    });
    expect(screen.queryByTestId('LifeScreen-Choice-__write__')).toBeNull();
  });

  it('LIFE-NODE-4 — composerOpen swaps the chip grid for the composer; cancel fires onComposerCancel', () => {
    const props = renderBottom({ options: branchOptions, composerOpen: true });
    expect(screen.getByTestId('LifeScreen-FreeText')).toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-Choice-go')).toBeNull();
    fireEvent.click(screen.getByTestId('LifeScreen-FreeText-Cancel'));
    expect(props.onComposerCancel).toHaveBeenCalledTimes(1);
  });

  it('LIFE-NODE-2 — options-loading renders the skeleton chips', () => {
    renderBottom({ phase: 'options-loading' });
    expect(screen.getByTestId('LifeScreen-SkeletonChips')).toBeInTheDocument();
  });

  it('LIFE-NODE-8 — options-failed renders the note + the single Continue chip wired to onPick', () => {
    const props = renderBottom({ phase: 'options-failed' });
    expect(screen.getByTestId('LifeScreen-OptionsFailed')).toHaveTextContent(
      'The story snagged for a moment.',
    );
    fireEvent.click(screen.getByTestId(`LifeScreen-Choice-${CONTINUE_AFTER_FAILURE_ID}`));
    expect(props.onPick).toHaveBeenCalledWith(CONTINUE_AFTER_FAILURE_ID);
  });

  it('LIFE-LANG-5 — the feedback Why? button fires onExplain', () => {
    const props = renderBottom({
      phase: 'feedback',
      feedback: {
        correct: false,
        picked: { id: 'b', practiceText: 'veux', nativeText: '' },
        correctAnswer: { id: 'a', practiceText: 'voudrais', nativeText: '' },
        outcomeKind: 'generation',
        promptSource: 'Je ___ un café',
        sentencePractice: 'Je voudrais un café',
        sentenceNative: 'I would like a coffee',
      },
    });
    fireEvent.click(screen.getByTestId('LifeScreen-PracticeFeedback-Why'));
    expect(props.onExplain).toHaveBeenCalledTimes(1);
  });

  it('LIFE-LANG-6 — fill-blank feedback ALWAYS shows the completed sentence + its native translation', () => {
    // The correct chip (row above) is just the bare token "voudrais" with
    // NO gloss (LIFE-LANG-1), so without this block the learner never sees
    // the sentence's meaning. It must appear on a CORRECT answer too.
    renderBottom({
      phase: 'feedback',
      feedback: {
        correct: true,
        picked: { id: 'a', practiceText: 'voudrais', nativeText: '' },
        correctAnswer: { id: 'a', practiceText: 'voudrais', nativeText: '' },
        outcomeKind: 'generation',
        promptSource: 'Je ___ un café',
        sentencePractice: 'Je voudrais un café',
        sentenceNative: 'I would like a coffee',
      },
    });
    const block = screen.getByTestId('LifeScreen-PracticeFeedback-FullSentence');
    expect(block).toHaveTextContent('Je voudrais un café');
    expect(block).toHaveTextContent('I would like a coffee');
  });

  it('LIFE-LANG-6 — comprehension feedback shows the NPC utterance + its native interpretation', () => {
    renderBottom({
      phase: 'feedback',
      feedback: {
        correct: false,
        picked: {
          id: 'b',
          practiceText: 'Elle cherche le bureau',
          nativeText: "She's asking about the office",
        },
        correctAnswer: {
          id: 'a',
          practiceText: 'Elle cherche un café',
          nativeText: "She's asking about a café",
        },
        outcomeKind: 'comprehension',
        promptSource: 'Est-ce que tu connais un bon café ?',
        sentencePractice: 'Est-ce que tu connais un bon café ?',
        sentenceNative: "She's asking about a café",
      },
    });
    const block = screen.getByTestId('LifeScreen-PracticeFeedback-FullSentence');
    expect(block).toHaveTextContent('Est-ce que tu connais un bon café ?');
    expect(block).toHaveTextContent("She's asking about a café");
  });

  it('LIFE-OPT-VOICE — options-ready renders the per-turn "What do you do?" frame', () => {
    renderBottom({ options: branchOptions, nodeKind: 'branch' });
    expect(screen.getByTestId('LifeScreen-OptionsEyebrow')).toHaveTextContent(
      'What do you do?',
    );
  });

  it('LIFE-OPT-VOICE — the options frame is hidden while the composer is open', () => {
    renderBottom({ options: branchOptions, composerOpen: true });
    expect(screen.queryByTestId('LifeScreen-OptionsEyebrow')).toBeNull();
  });

  it('LIFE-UI-12 — live-loading renders the thinking phrase in the frame slot, not a centred bar', () => {
    renderBottom({ phase: 'live-loading', waitKind: 'act' });
    expect(screen.getByTestId('LifeScreen-ThinkingBar')).toHaveTextContent(
      'Seeing what happens…',
    );
    // …and the options grid below it is a skeleton, not empty space.
    expect(screen.getByTestId('LifeScreen-SkeletonChips').children).toHaveLength(
      SKELETON_CHIP_COUNT,
    );
  });

  it('LIFE-UI-12 — every skeleton box is a full two-line chip', () => {
    renderBottom({ phase: 'live-loading', waitKind: 'act' });
    for (const box of Array.from(
      screen.getByTestId('LifeScreen-SkeletonChips').children,
    )) {
      expect(box).toHaveClass(OPTION_CHIP_SKELETON_H);
    }
  });

  it('LIFE-UI-12 — the loading block and the loaded block are the SAME boxes', () => {
    // The owner-visible defect: the options area grew and shrank on every
    // swap. jsdom does no layout, so height cannot be measured — what CAN be
    // asserted, and what actually makes the reflow impossible, is that the
    // frame row and the grid row are rendered from IDENTICAL class strings in
    // both states. If someone re-styles one, this fails.
    const loading = render(
      <LifeScreenBottom {...bottomProps({ phase: 'live-loading', waitKind: 'act' })} />,
    );
    const pick = (root: HTMLElement, id: string) =>
      root.querySelector(`[data-testid="${id}"]`)!.className;
    const snapshot = {
      frame: pick(loading.container, 'LifeScreen-OptionsFrame'),
      slot: pick(loading.container, 'LifeScreen-ThinkingBar'),
      bar: pick(loading.container, 'LifeScreen-SkeletonBar'),
      grid: pick(loading.container, 'LifeScreen-SkeletonChips'),
    };
    loading.unmount();

    const loaded = render(
      <LifeScreenBottom
        {...bottomProps({ phase: 'options-ready', options: branchOptions, nodeKind: 'branch' })}
      />,
    );
    expect(pick(loaded.container, 'LifeScreen-OptionsFrame')).toBe(snapshot.frame);
    expect(pick(loaded.container, 'LifeScreen-OptionsEyebrow')).toBe(snapshot.slot);
    expect(pick(loaded.container, 'LifeScreen-ActionBar')).toBe(snapshot.bar);
    expect(pick(loaded.container, 'LifeScreen-OptionsGrid')).toBe(snapshot.grid);
    // …and the loaded grid reserves the two skeleton rows even when the model
    // returned fewer options than the skeleton showed.
    expect(screen.getByTestId('LifeScreen-OptionsGrid')).toHaveClass(OPTION_GRID_MIN_H);
    loaded.unmount();
  });

  it('LIFE-UI-12 — options-loading reuses the same block (one loading surface, not two)', () => {
    renderBottom({ phase: 'options-loading' });
    expect(screen.getByTestId('LifeScreen-SkeletonChips').children).toHaveLength(
      SKELETON_CHIP_COUNT,
    );
  });

  it('LIFE-SCENE-30 — a pending scene summary replaces the options with ONE chip', () => {
    // The resolving turn still produced options. Rendering them invites the
    // player to walk on past an ending they have not been shown.
    const props = renderBottom({
      options: branchOptions,
      nodeKind: 'branch',
      sceneSummaryPending: true,
      onViewSceneSummary: vi.fn(),
    });
    expect(screen.queryByTestId('LifeScreen-Choice-go')).toBeNull();
    expect(screen.queryByTestId('LifeScreen-Choice-wait')).toBeNull();
    const chip = screen.getByTestId(`LifeScreen-Choice-${VIEW_SCENE_SUMMARY_ID}`);
    expect(chip).toHaveTextContent('View scene summary');
    fireEvent.click(chip);
    expect(props.onViewSceneSummary).toHaveBeenCalledTimes(1);
    // The chip is NOT an ordinary option — it must not run the turn.
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it('LIFE-SCENE-30 — the chip is NOT gated on phase; a graded turn resolves the same way', () => {
    // Resolution can land on a normal options turn or on a graded one. A phase
    // list here would be a second copy of the engine's state machine that
    // silently stops matching it.
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: generationPrompt, choices: generationChoices },
      sceneSummaryPending: true,
      onViewSceneSummary: vi.fn(),
    });
    expect(
      screen.getByTestId(`LifeScreen-Choice-${VIEW_SCENE_SUMMARY_ID}`),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-PracticePrompt-FillBlank')).toBeNull();
  });

  it('LIFE-SCENE-30 — the feedback overlay still WINS; it owns the screen mid-question', () => {
    // The player answered, the answer resolved the scene. They have not seen
    // whether they got it right yet — taking that away to show a summary chip
    // loses the grading entirely.
    renderBottom({
      phase: 'feedback',
      sceneSummaryPending: true,
      onViewSceneSummary: vi.fn(),
      feedback: {
        correct: true,
        picked: { id: 'a', practiceText: 'voudrais', nativeText: '' },
        correctAnswer: { id: 'a', practiceText: 'voudrais', nativeText: '' },
        outcomeKind: 'generation',
        promptSource: 'Je ___ un café',
        sentencePractice: 'Je voudrais un café',
        sentenceNative: 'I would like a coffee',
      },
    });
    expect(
      screen.getByTestId('LifeScreen-PracticeFeedback-FullSentence'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`LifeScreen-Choice-${VIEW_SCENE_SUMMARY_ID}`),
    ).toBeNull();
  });

  it('LIFE-SCENE-30 — a card-match review also WINS; a half-matched grid is work already done', () => {
    renderBottom({
      phase: 'card-match',
      cardMatch: {
        pairs: [
          { id: 'p1', practice: 'voudrais', native: 'would like' },
          { id: 'p2', practice: 'tablier', native: 'apron' },
        ],
        seed: 0,
      },
      onCardMatchComplete: vi.fn(),
      sceneSummaryPending: true,
      onViewSceneSummary: vi.fn(),
    });
    expect(screen.getByTestId('LifeScreen-CardMatch')).toBeInTheDocument();
    expect(
      screen.queryByTestId(`LifeScreen-Choice-${VIEW_SCENE_SUMMARY_ID}`),
    ).toBeNull();
  });

  it('LIFE-SCENE-30 — no chip, and the options stand, when nothing is pending', () => {
    renderBottom({
      options: branchOptions,
      nodeKind: 'branch',
      onViewSceneSummary: vi.fn(),
    });
    expect(
      screen.queryByTestId(`LifeScreen-Choice-${VIEW_SCENE_SUMMARY_ID}`),
    ).toBeNull();
    expect(screen.getByTestId('LifeScreen-Choice-go')).toBeInTheDocument();
  });

  it('LIFE-OPT-VOICE — the comprehension card names the speaker explicitly', () => {
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: comprehensionPrompt, choices: comprehensionChoices },
    });
    expect(
      screen.getByTestId('LifeScreen-PracticePrompt-Speaker'),
    ).toHaveTextContent('Sophie said:');
  });
});

/**
 * LIFE-EX-13.3 — the summary chip must not FLASH before the review.
 *
 * Reported 2026-08-07, immediately after `LIFE-EX-13.2` shipped: *"the 'view
 * scene summary' briefly shows before the card matching. Instead, the general
 * question loading ui should show."*
 *
 * A direct consequence of the fix before it. `LIFE-EX-13.2` split ARMING the
 * review (when the scene resolves) from OPENING it (when the turn settles),
 * and `onSceneResolved` sets `sceneSummaryPending` at the arming end — so for
 * the length of the beat glide the chip was the only thing claiming the slot,
 * and the grid then snatched it away.
 */
describe('LIFE-EX-13.3 — an owed review holds the summary chip back', () => {
  const pending = (over: Record<string, unknown> = {}) =>
    renderBottom({
      phase: 'options-ready',
      sceneSummaryPending: true,
      onViewSceneSummary: vi.fn(),
      cardMatchPending: true,
      cardMatch: null,
      ...over,
    } as never);

  it('LIFE-EX-13.4 — a READY QUESTION still renders. The owed review never outranks it.', () => {
    // THE HANG, reported 2026-08-08 and live on beta for a day. LIFE-EX-13.3
    // rendered the shimmer from a branch placed ABOVE `question-ready`, so once
    // a scene closed mid-question — which is ordinary: the resolve and the
    // question land on the same turn — `cardMatchPending` stayed true, the
    // shimmer won over the authored question, and the player was stuck on
    // "preparing a question" forever. The owner's trace shows the question
    // generating successfully at 10:20:49 and nothing moving after it.
    //
    // The review is owed at the END of the turn. A question in hand is the
    // turn still running, and it always wins.
    pending({
      phase: 'question-ready',
      question: {
        practicePrompt: { kind: 'comprehension', npcUtterance: 'Bonsoir.', question: 'What?' },
        choices: [{ id: 'a', practiceText: 'A', nativeText: 'A', correctness: 'correct' }],
      },
    });
    expect(screen.queryByTestId('LifeScreen-QuestionAuthoring')).toBeNull();
    expect(screen.queryByTestId('LifeScreen-PracticePrompt-Comprehension')).toBeTruthy();
  });

  it('holds the summary chip back while the review is owed', () => {
    pending({ phase: 'live-loading' });
    expect(screen.queryByText(/scene summary/i)).toBeNull();
  });

  it('the phase renders its OWN loading UI in the gap — no bespoke state', () => {
    // What the owner asked for: "the general question loading ui should show".
    // A question turn is already in `question-authoring` here, which renders
    // exactly that block — so suppressing the chip is the whole fix, and a
    // second shimmer branch above the phase list was both redundant and the
    // cause of the hang above.
    pending({ phase: 'question-authoring' });
    expect(screen.queryByTestId('LifeScreen-QuestionAuthoring')).toBeTruthy();
    expect(screen.queryByText(/scene summary/i)).toBeNull();
  });

  it('the chip returns once the review is no longer owed', () => {
    pending({ cardMatchPending: false });
    expect(screen.queryByText(/scene summary/i)).toBeTruthy();
  });

  it('an OPEN grid still wins', () => {
    pending({
      phase: 'card-match',
      cardMatchPending: false,
      cardMatch: { pairs: [], seed: 0 },
      onCardMatchComplete: vi.fn(),
    });
    expect(screen.queryByText(/scene summary/i)).toBeNull();
  });
});

/**
 * LIFE-NEED-3 / LIFE-NEED-5 — the block the player can SEE, and the door.
 *
 * The mechanic was computed (`exposureReason`, `clearingMove`) and rendered
 * nowhere, so an objective could be blocked and the grid said nothing — which
 * is the same "I couldn't tell what I was supposed to do" this whole feature
 * exists to answer. `goalPrompt` was already telling the model the player was
 * being shown the block "word for word", which made it a promise the UI broke.
 */
describe('LIFE-NEED-3/5 — the objective block on the option grid', () => {
  const BLOCK = {
    reason: 'Hélène has no reason to do this for you yet',
    clearing: 'spend this turn on Hélène',
    investIn: 'Hélène',
  };

  it('LIFE-NEED-3 — states the block BEFORE the choice, in fiction', () => {
    renderBottom({ options: branchOptions, objectiveBlock: BLOCK });
    expect(screen.getByTestId('LifeScreen-ObjectiveBlock'))
      .toHaveTextContent('Hélène has no reason to do this for you yet');
  });

  it('LIFE-NEED-3 — never a number, never the word "risky"', () => {
    renderBottom({ options: branchOptions, objectiveBlock: BLOCK });
    const row = screen.getByTestId('LifeScreen-ObjectiveBlock');
    expect(row.textContent ?? '').not.toMatch(/risky|\d+\s*%/i);
  });

  it('the door chip is sentence-cased like every other chip', () => {
    // It sits beside "Make breakfast" and "Write your own". A lowercase chip
    // in that row reads as a different KIND of thing, which is the one
    // impression the door must not give.
    renderBottom({ options: branchOptions, objectiveBlock: BLOCK });
    expect(screen.getByTestId('LifeScreen-Choice-__clear-block__'))
      .toHaveTextContent('Spend this turn on Hélène');
  });

  it('the SUBMITTED intent keeps the bare phrase, not the chip label', () => {
    // The two are for different jobs: the label is chrome, the intent is what
    // the player is telling the world they are doing.
    const props = renderBottom({ options: branchOptions, objectiveBlock: BLOCK });
    fireEvent.click(screen.getByTestId('LifeScreen-Choice-__clear-block__'));
    expect(props.onFreeText).toHaveBeenCalledWith('spend this turn on Hélène', 'Hélène');
  });

  it('LIFE-NEED-5 — the DOOR is a chip on the same grid as the block', () => {
    // The load-bearing one. A player who can be blocked with no move that
    // clears it has met a wall, and the wall is what v2 deleted its own
    // blocker mechanic for.
    renderBottom({ options: branchOptions, objectiveBlock: BLOCK });
    expect(screen.getByTestId('LifeScreen-Choice-__clear-block__'))
      .toHaveTextContent('Hélène');
  });

  it('LIFE-NEED-5 — the door does NOT replace the ordinary options', () => {
    // Exposure is information, not a corridor: the player stays free to push
    // at the blocked thing anyway, which LIFE-NEED-4 says still costs the turn
    // and still moves the story.
    renderBottom({ options: branchOptions, objectiveBlock: BLOCK });
    expect(screen.getByTestId('LifeScreen-Choice-go')).toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-Choice-wait')).toBeInTheDocument();
  });

  it('taking the door submits the clearing move as the turn', () => {
    const props = renderBottom({ options: branchOptions, objectiveBlock: BLOCK });
    fireEvent.click(screen.getByTestId('LifeScreen-Choice-__clear-block__'));
    // Two args now: the intent text, and LIFE-REP-5's `investIn` naming the
    // person the turn is spent on — which is what makes the door reliable
    // rather than dependent on the model reporting a reaction.
    expect(props.onFreeText).toHaveBeenCalledWith('spend this turn on Hélène', 'Hélène');
    // It is NOT an ordinary option pick — there is no such option id in the
    // model's grid and routing it as one would land nowhere.
    expect(props.onPick).not.toHaveBeenCalled();
  });

  it('renders NOTHING when the objective is not blocked', () => {
    renderBottom({ options: branchOptions, objectiveBlock: null });
    expect(screen.queryByTestId('LifeScreen-ObjectiveBlock')).not.toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-Choice-__clear-block__')).not.toBeInTheDocument();
  });

  it('stays out of the way on a GRADED turn', () => {
    // The block belongs to the story grid. A graded question owns the whole
    // bottom slot and an objective note beside the answer chips would read as
    // a hint about the answer.
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: comprehensionPrompt, choices: comprehensionChoices },
      objectiveBlock: BLOCK,
    });
    expect(screen.queryByTestId('LifeScreen-ObjectiveBlock')).not.toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-Choice-__clear-block__')).not.toBeInTheDocument();
  });
});
