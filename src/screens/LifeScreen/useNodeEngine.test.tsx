import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/life/generateStepOptions', () => ({
  // Full module mock — the real module pulls lib/gemini → firebase.
  generateStepOptions: vi.fn(),
  recentGenerationTargets: vi.fn(() => []),
  buildGradedSceneContext: vi.fn(() => ({ recentBeats: [] })),
}));
vi.mock('@/lib/life/commitNode', () => ({
  commitNode: vi.fn(async () => undefined),
  applyTurnSignals: vi.fn(async () => undefined),
}));
vi.mock('@/lib/life/runGradedQuestionGenerate', () => ({
  runGradedQuestionGenerate: vi.fn(),
}));
vi.mock('@/lib/life/world', () => ({
  appendLifeEvent: vi.fn(async () => 'e1'),
  updateLifeWorld: vi.fn(async () => undefined),
}));
vi.mock('@/lib/life/runSceneClose', () => ({ runSceneClose: vi.fn() }));
vi.mock('@/lib/life/sceneLog', () => ({ buildSceneLog: vi.fn(() => []) }));
vi.mock('@/lib/life/fronts', () => ({ frontsNeedingSign: vi.fn(() => []) }));
vi.mock('@/lib/life/scene', () => ({ updateActiveScene: vi.fn() }));
vi.mock('@/lib/life/runSceneReplan', () => ({ runSceneReplan: vi.fn() }));
vi.mock('@/lib/life/sceneLifecycle', () => ({
  startScene: vi.fn(async () => ({ sceneId: 's-1', usedFallback: false })),
  computeReplanPlan: vi.fn(),
  fireBackgroundScenePatch: vi.fn(),
  snapshotSceneCompletion: vi.fn(() => ({ title: 'done' })),
  sceneResolveTooEarly: vi.fn(() => false),
}));
vi.mock('@/lib/errors', () => ({ toUserMessage: (e: unknown) => String(e) }));
vi.mock('@/lib/log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import {
  generateStepOptions,
  type GenerateStepOptionsResult,
} from '@/lib/life/generateStepOptions';
import { applyTurnSignals, commitNode } from '@/lib/life/commitNode';
import { runGradedQuestionGenerate } from '@/lib/life/runGradedQuestionGenerate';
import { computeReplanPlan, startScene } from '@/lib/life/sceneLifecycle';
import { runSceneClose } from '@/lib/life/runSceneClose';
import {
  CONTINUE_AFTER_FAILURE_ID,
  useNodeEngine,
  type UseNodeEngineProps,
} from './useNodeEngine';
import { WRITE_YOUR_OWN_ID, type StepOption } from '@/lib/life/stepSchema';
import {
  BEAT_PAUSE_MS,
  BEAT_STAGGER_MS,
  GLIDE_ENTER_MS,
  MIN_AUTHORING_MS,
} from './nodeEngineGlide';
import type { LifeWorld } from '@/types/firestore';

/**
 * LIFE-NODE-11: on a player-action turn the options are the LAST beat — they
 * are released one pacing gap after the final event, so a real-timer
 * `waitFor` on `options-ready` now needs longer than testing-library's 1s
 * default. Sized off the shared constants so it tracks the pacing.
 */
const PACED_ARRIVAL_MS = BEAT_PAUSE_MS + BEAT_STAGGER_MS * 4;

const generateStepOptionsMock = vi.mocked(generateStepOptions);
const commitNodeMock = vi.mocked(commitNode);
const applyTurnSignalsMock = vi.mocked(applyTurnSignals);
const runGradedQuestionGenerateMock = vi.mocked(runGradedQuestionGenerate);
const computeReplanPlanMock = vi.mocked(computeReplanPlan);
const startSceneMock = vi.mocked(startScene);

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  worldMode: 'realistic',
  characterAvatarStatus: 'ready',
};

const narratorBeat = {
  speaker: 'narrator' as const,
  practiceText: 'Tu entres au café.',
  nativeText: 'You enter the café.',
};

const previewBeat = {
  speaker: 'narrator' as const,
  practiceText: 'Sophie te fait signe.',
  nativeText: 'Sophie waves at you.',
};

// LIFE-NODE-2: options are plain chips — no lookahead. What a pick leads to
// is authored by the NEXT live call, so the tests drive it via the mock's
// per-call return rather than by embedding a preview on the chip.
const goOption: StepOption = {
  id: 'go',
  practiceText: 'Rejoindre Sophie',
  nativeText: 'Join Sophie',
};

const askOption: StepOption = {
  id: 'ask',
  practiceText: 'Proposer un déjeuner',
  nativeText: 'Suggest lunch',
};

const waitOption: StepOption = {
  id: 'wait',
  practiceText: 'Attendre',
  nativeText: 'Wait',
};

const generationPlan = {
  kind: 'generation' as const,
  testTarget: 'voudrais',
  sentenceContext: 'Je voudrais déjeuner avec toi.',
};

function okLive(
  options: StepOption[],
  nonce: number,
): Extract<GenerateStepOptionsResult, { kind: 'ok' }> {
  return {
    kind: 'ok',
    node: { kind: 'branch', beats: [narratorBeat] },
    options,
    nonce,
  };
}

/** A live result whose NODE is a question — the shape a graded turn takes now
 *  that the plan arrives on the node itself rather than on an option preview. */
function okLiveQuestion(
  nonce: number,
  plan: typeof generationPlan | Record<string, unknown> = generationPlan,
): Extract<GenerateStepOptionsResult, { kind: 'ok' }> {
  return {
    kind: 'ok',
    // LIFE-CONTRACT-EX-6: a question node now carries lead-in beats. These
    // fixtures exercise the graded path with none, which is still legal.
    node: { kind: 'question', beats: [], gradedPlan: plan },
    options: [],
    nonce,
  } as Extract<GenerateStepOptionsResult, { kind: 'ok' }>;
}

/** LIFE-EX-PLAN-5: a question node that pre-authored its continuation. */
function okLiveQuestionWithResolution(
  nonce: number,
): Extract<GenerateStepOptionsResult, { kind: 'ok' }> {
  return {
    kind: 'ok',
    node: {
      kind: 'question',
      beats: [],
      gradedPlan: generationPlan,
      resolution: {
        beats: [
          {
            speaker: 'npc',
            speakerName: 'Sophie',
            npcId: 'sophie',
            practiceText: 'Avec plaisir !',
            nativeText: 'With pleasure!',
            complexWords: [],
          },
        ],
        options: [
          { id: 'sit', practiceText: 'Sit down', nativeText: 'Sit down' },
          { id: 'go', practiceText: 'Head out', nativeText: 'Head out' },
        ],
        logLine: 'Sophie agreed to lunch.',
      },
    },
    options: [],
    nonce,
  } as Extract<GenerateStepOptionsResult, { kind: 'ok' }>;
}

/** A live result carrying a specific set of beats on a branch node. */
function okLiveBeats(
  beats: Array<{ speaker: 'narrator' | 'npc'; practiceText: string; nativeText: string }>,
  options: StepOption[],
  nonce: number,
): Extract<GenerateStepOptionsResult, { kind: 'ok' }> {
  return {
    kind: 'ok',
    node: { kind: 'branch', beats },
    options,
    nonce,
  } as Extract<GenerateStepOptionsResult, { kind: 'ok' }>;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// LIFE-EX-10 fixtures: a beat carrying annotated vocab, and a resolved-question
// marker — the card-match review harvests recent vocab + counts corrections.
function vocabBeatEvent(
  id: string,
  wordTranslations: Record<string, string>,
): UseNodeEngineProps['events'][number] {
  return {
    id,
    kind: 'beat',
    payload: {
      speaker: 'npc',
      practiceText: Object.keys(wordTranslations).join(' '),
      complexWords: Object.keys(wordTranslations),
      wordTranslations,
    },
  } as UseNodeEngineProps['events'][number];
}
function correctionEvent(id: string): UseNodeEngineProps['events'][number] {
  return {
    id,
    kind: 'correction',
    payload: { kind: 'generation', correct: true, correctAnswer: 'x', promptSource: 'y' },
  } as UseNodeEngineProps['events'][number];
}

function makeProps() {
  return {
    uid: 'u1',
    world: baseWorld,
    events: [] as UseNodeEngineProps['events'],
    scene: null,
    npcs: [],
    appendBubbles: vi.fn(),
    onBackdropIntent: vi.fn(),
    onSceneResolved: vi.fn(),
    onSceneSummary: vi.fn(),
    onError: vi.fn(),
  } satisfies UseNodeEngineProps;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: echo the passed nonce (matches the real contract).
  generateStepOptionsMock.mockImplementation(async (input) => okLive([goOption, waitOption], input.nonce));
});

describe('useNodeEngine', () => {
  it('LIFE-NODE-2 — startOpening lands node + options and reaches options-ready', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    expect(result.current.nodeKind).toBe('branch');
    expect(result.current.options.map((o) => o.id)).toEqual(['go', 'wait']);
    expect(props.appendBubbles).toHaveBeenCalledWith(
      [expect.objectContaining({ practiceText: 'Tu entres au café.' })],
      { resetTurn: false },
    );
    expect(commitNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: { kind: 'none' } }),
    );
  });

  it('LIFE-ARC-PACE-2 — a generated turn advances the pace counter even when the model emits NO worldDelta and NO logLine', async () => {
    // `applyTurnSignals` used to be called only when the response carried a
    // worldDelta or a ledger payload (introduces / logLine / npcMemoryUpdates).
    // `logLine` is `.optional()` in ZStepResponse, so a turn that emitted
    // neither simply never reached the counter — and `storyLog.turns` is the
    // number <chapterPace> renders and the SI's 25/32/40 tiers read.
    //
    // The error direction is the ORIGINAL bug (chapters run past their
    // ceiling), which is exactly what LIFE-ARC-PACE-1 exists to stop. A turn is
    // a turn because it was GENERATED, not because the model happened to
    // narrate it — so the generation is what must decide, not the payload.
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    // `okLive` (the default mock result) carries no worldDelta and no logLine —
    // the exact shape that used to be dropped.
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    expect(applyTurnSignalsMock).toHaveBeenCalledWith(
      expect.objectContaining({ countsAsTurn: true }),
    );
  });

  it('LIFE-NODE-3/9 — a pick commits + overlays ONCE on the live landing, then glides the beat in', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    (props.appendBubbles as ReturnType<typeof vi.fn>).mockClear();
    commitNodeMock.mockClear();

    vi.useFakeTimers();
    try {
      const d = deferred<GenerateStepOptionsResult>();
      generateStepOptionsMock.mockReturnValueOnce(d.promise);
      await act(async () => {
        result.current.actions.pick('go');
      });
      // LIFE-NODE-2: with no lookahead the pick has nothing to render yet — it
      // waits on the live call. Nothing is committed until the node lands.
      expect(result.current.phase).toBe('live-loading');
      expect(commitNodeMock).not.toHaveBeenCalled();
      const call = generateStepOptionsMock.mock.calls.at(-1)![0];
      expect(call.turn).toEqual(
        expect.objectContaining({
          kind: 'live',
          choice: expect.objectContaining({ id: 'go' }),
        }),
      );

      // The node lands: turn boundary resets, commit fires ONCE, and the beat
      // is held back for the glide rather than appended immediately.
      await act(async () => {
        d.resolve(okLiveBeats([previewBeat], [goOption, waitOption], 0));
        await Promise.resolve();
      });
      expect(props.appendBubbles).toHaveBeenCalledWith([], { resetTurn: true });
      expect(props.appendBubbles).not.toHaveBeenCalledWith(
        [expect.objectContaining({ practiceText: 'Sophie te fait signe.' })],
        expect.anything(),
      );
      expect(commitNodeMock).toHaveBeenCalledTimes(1);
      expect(commitNodeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: { kind: 'choice', choiceId: 'go', text: 'Rejoindre Sophie' },
        }),
      );

      // Advance past the pause → the beat glides in, and commit is STILL the
      // single fire from the landing (LIFE-NODE-9: the glide is visual only).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BEAT_PAUSE_MS + 20);
      });
      expect(props.appendBubbles).toHaveBeenCalledWith(
        [expect.objectContaining({ practiceText: 'Sophie te fait signe.' })],
        { resetTurn: false },
      );
      expect(commitNodeMock).toHaveBeenCalledTimes(1);
      // LIFE-NODE-11: the options are the LAST beat — they are still held at
      // this point, so the loading placeholder is what the player is looking
      // at, not an empty options area.
      expect(result.current.phase).toBe('live-loading');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BEAT_STAGGER_MS + 20);
      });
      // Options arrived bundled with the node — no second call.
      expect(result.current.phase).toBe('options-ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('LIFE-NODE-11 — options that arrive FIRST are held until every event has landed', async () => {
    // The reported ordering bug: the node's options resolve in the same
    // payload as its beats, so they used to paint instantly while the beats
    // were still gliding in underneath them. The options must be the tail of
    // the sequence, one pacing gap after the LAST event.
    const twoBeats = [
      { speaker: 'narrator' as const, practiceText: 'Beat un.', nativeText: 'Beat one.' },
      { speaker: 'narrator' as const, practiceText: 'Beat deux.', nativeText: 'Beat two.' },
    ];
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    (props.appendBubbles as ReturnType<typeof vi.fn>).mockClear();

    const beatCount = () =>
      (props.appendBubbles as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => Array.isArray(c[0]) && c[0].length > 0,
      ).length;

    vi.useFakeTimers();
    try {
      const d = deferred<GenerateStepOptionsResult>();
      generateStepOptionsMock.mockReturnValueOnce(d.promise);
      await act(async () => {
        result.current.actions.pick('go');
      });
      await act(async () => {
        d.resolve(okLiveBeats(twoBeats, [goOption, waitOption], 0));
        await Promise.resolve();
      });
      // The options are IN HAND (they came with the node) and must not show.
      expect(result.current.phase).toBe('live-loading');
      expect(result.current.options).toEqual([]);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(BEAT_PAUSE_MS + 20);
      });
      expect(beatCount()).toBe(1);
      expect(result.current.phase).toBe('live-loading'); // still held

      await act(async () => {
        await vi.advanceTimersByTimeAsync(BEAT_STAGGER_MS);
      });
      expect(beatCount()).toBe(2);
      // Last event has landed — the options are still one gap away.
      expect(result.current.phase).toBe('live-loading');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(BEAT_STAGGER_MS);
      });
      expect(result.current.phase).toBe('options-ready');
      expect(result.current.options).toHaveLength(2);
      // The options never re-ordered the events: both landed before them.
      expect(beatCount()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('LIFE-NODE-9 — the beat stagger exceeds the glide duration (no overlap between consecutive beats)', () => {
    // The reported "2 beats bunch together" bug: at the old 250ms stagger,
    // beat 2 began rising while beat 1 was still mid-glide (380ms). The
    // stagger MUST be >= the glide so each beat fully settles before the next.
    expect(BEAT_STAGGER_MS).toBeGreaterThanOrEqual(GLIDE_ENTER_MS);
  });

  it('LIFE-NODE-9 — a 2-beat live landing glides the beats in one at a time (staggered)', async () => {
    const twoBeats = [
      { speaker: 'narrator' as const, practiceText: 'Beat un.', nativeText: 'Beat one.' },
      { speaker: 'narrator' as const, practiceText: 'Beat deux.', nativeText: 'Beat two.' },
    ];
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    (props.appendBubbles as ReturnType<typeof vi.fn>).mockClear();
    commitNodeMock.mockClear();

    // Non-empty (beat) appends only — filters out the [] reset call.
    const beatTexts = () =>
      (props.appendBubbles as ReturnType<typeof vi.fn>).mock.calls
        .filter((c) => Array.isArray(c[0]) && c[0].length > 0)
        .map((c) => (c[0] as Array<{ practiceText: string }>)[0]!.practiceText);

    vi.useFakeTimers();
    try {
      const d = deferred<GenerateStepOptionsResult>();
      generateStepOptionsMock.mockReturnValueOnce(d.promise);
      await act(async () => {
        result.current.actions.pick('go');
      });
      await act(async () => {
        d.resolve(okLiveBeats(twoBeats, [goOption, waitOption], 0));
        await Promise.resolve();
      });
      // Commit + overlay fired ONCE; nothing has glided in yet.
      expect(commitNodeMock).toHaveBeenCalledTimes(1);
      expect(beatTexts()).toEqual([]);

      // After the pause: only the FIRST beat has mounted.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BEAT_PAUSE_MS + 20);
      });
      expect(beatTexts()).toEqual(['Beat un.']);

      // After one more stagger gap: the SECOND beat mounts.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BEAT_STAGGER_MS + 20);
      });
      expect(beatTexts()).toEqual(['Beat un.', 'Beat deux.']);
      // The staggered render NEVER re-commits.
      expect(commitNodeMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        d.resolve({ kind: 'ok', node: null, options: [waitOption], nonce: 0 });
        await vi.runAllTimersAsync();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('LIFE-SPEECH-1 — a "say" pick prepends the player saysLine as a user bubble', async () => {
    const sayOption: StepOption = {
      id: 'greet',
      practiceText: 'Greet Sophie',
      nativeText: 'Greet Sophie',
      speechAct: 'say',
      saysLine: { practiceText: 'Salut Sophie !', nativeText: 'Hi Sophie!' },
    };
    const reply = {
      speaker: 'npc' as const,
      speakerName: 'Sophie',
      npcId: 'sophie',
      practiceText: 'Ah, te voilà !',
      nativeText: 'Ah, there you are!',
    };
    generateStepOptionsMock
      .mockImplementationOnce(async (input) => okLive([sayOption, waitOption], input.nonce))
      // LIFE-NODE-2: the reaction is authored by the live call the pick fires,
      // not carried on the chip.
      .mockImplementationOnce(async (input) =>
        okLiveBeats([reply], [goOption, waitOption], input.nonce),
      );
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    commitNodeMock.mockClear();

    await act(async () => {
      result.current.actions.pick('greet');
    });
    await waitFor(() => expect(commitNodeMock).toHaveBeenCalled());

    // The prepended user beat is the FIRST committed beat — the same payloads
    // that render (appendBubbles) AND persist. This is the fix for the player's
    // spoken line vanishing on a non-graded speech pick.
    const commitArg = commitNodeMock.mock.calls.at(-1)![0];
    expect(commitArg.beats[0]).toMatchObject({
      speaker: 'user', practiceText: 'Salut Sophie !', nativeText: 'Hi Sophie!',
    });
    // The world's reaction follows the player's own line, not replaces it.
    expect(commitArg.beats[1]).toMatchObject({ speaker: 'npc', practiceText: 'Ah, te voilà !' });
  });

  // LIFE-SPEECH-3 — the outbound fill-blank is gated on the OPTION.
  //
  // THE REPORTED BUG: "Questions seem to not be triggering for things I say, ie
  // they are all comprehension questions so far." They were unreachable — the
  // test directly above is the proof. A `say` pick puts the line on screen
  // immediately, so the node authored one call later has nothing left to
  // intercept, and a fill-blank is BY DEFINITION an interception.
  const gradedSayOption: StepOption = {
    id: 'ask-key',
    practiceText: 'Ask for the key',
    nativeText: 'Ask for the key',
    speechAct: 'say',
    saysLine: {
      practiceText: 'Tu peux me donner la clé ?',
      nativeText: 'Can you give me the key?',
    },
    gradeTarget: 'clé',
  };

  it('LIFE-SPEECH-3 — a gradeTarget turns the say pick INTO the question, with no life_step call', async () => {
    generateStepOptionsMock.mockImplementationOnce(async (input) =>
      okLive([gradedSayOption, waitOption], input.nonce),
    );
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    generateStepOptionsMock.mockClear();

    const gen = deferred<Awaited<ReturnType<typeof runGradedQuestionGenerate>>>();
    runGradedQuestionGenerateMock.mockReturnValueOnce(gen.promise);
    await act(async () => {
      result.current.actions.pick('ask-key');
    });

    // Straight to authoring — no `life_step` round trip in between. This is
    // also where the call the node route would have spent is saved.
    expect(result.current.phase).toBe('question-authoring');
    expect(generateStepOptionsMock).not.toHaveBeenCalled();

    // The plan was built in CODE from the option's own fields: the line the
    // player chose to say, with the word they now have to produce blanked out.
    const planArg = runGradedQuestionGenerateMock.mock.calls.at(-1)![0];
    expect(planArg.plan).toEqual({
      kind: 'generation',
      testTarget: 'clé',
      sentenceContext: 'Tu peux me donner la clé ?',
    });
  });

  it('LIFE-SPEECH-3 — the graded say pick does NOT prepend the line as a bubble', async () => {
    // The whole point: the player has not said it yet. Landing the bubble here
    // would hand them the answer to the question they are about to be asked.
    generateStepOptionsMock.mockImplementationOnce(async (input) =>
      okLive([gradedSayOption, waitOption], input.nonce),
    );
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    commitNodeMock.mockClear();

    runGradedQuestionGenerateMock.mockReturnValueOnce(
      deferred<Awaited<ReturnType<typeof runGradedQuestionGenerate>>>().promise,
    );
    await act(async () => {
      result.current.actions.pick('ask-key');
    });
    await waitFor(() => expect(commitNodeMock).toHaveBeenCalled());

    const commitArg = commitNodeMock.mock.calls.at(-1)![0];
    // The pick IS committed (the story records the choice) — with no beats.
    expect(commitArg.action).toMatchObject({ kind: 'choice', choiceId: 'ask-key' });
    expect(commitArg.beats).toEqual([]);
  });

  it('LIFE-SPEECH-3 — an unusable gradeTarget degrades to the ordinary say path', async () => {
    // "fromage" is not in the line, so the plan the generator would reject is
    // never built. A dropped grade costs one practice moment; shipping it would
    // cost a retry and a visible wait for the same outcome.
    const broken: StepOption = { ...gradedSayOption, gradeTarget: 'fromage' };
    const reply = {
      speaker: 'npc' as const,
      speakerName: 'Sophie',
      npcId: 'sophie',
      practiceText: 'Bien sûr, la voilà.',
      nativeText: 'Of course, here it is.',
    };
    generateStepOptionsMock
      .mockImplementationOnce(async (input) => okLive([broken, waitOption], input.nonce))
      .mockImplementationOnce(async (input) =>
        okLiveBeats([reply], [goOption, waitOption], input.nonce),
      );
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    commitNodeMock.mockClear();
    runGradedQuestionGenerateMock.mockClear();

    await act(async () => {
      result.current.actions.pick('ask-key');
    });
    await waitFor(() => expect(commitNodeMock).toHaveBeenCalled());

    // No question was authored; the line landed as the player's bubble exactly
    // as an ungraded `say` does.
    expect(runGradedQuestionGenerateMock).not.toHaveBeenCalled();
    const commitArg = commitNodeMock.mock.calls.at(-1)![0];
    expect(commitArg.beats[0]).toMatchObject({
      speaker: 'user',
      practiceText: 'Tu peux me donner la clé ?',
    });
  });

  it('LIFE-SPEECH-5 — a graded say whose GENERATOR fails still lands the player’s line', async () => {
    // The gap LIFE-SPEECH-3 opened. `gradedSayPlan` declining degrades to the
    // ordinary say (the test above) — but the generator failing AFTER the plan
    // was accepted fell into the shared LIFE-NODE-8 demote, which authors fresh
    // branch options. On this path that is wrong twice over: the board was
    // cleared for a question that never appeared, and the line the player chose
    // to SAY was never spoken. They pick "Ask for the key", the dialogue area
    // empties, and a new set of chips arrives as though they had said nothing —
    // while the committed decision tells the model they did.
    const reply = {
      speaker: 'npc' as const,
      speakerName: 'Sophie',
      npcId: 'sophie',
      practiceText: 'Bien sûr, la voilà.',
      nativeText: 'Of course, here it is.',
    };
    generateStepOptionsMock
      .mockImplementationOnce(async (input) =>
        okLive([gradedSayOption, waitOption], input.nonce),
      )
      .mockImplementationOnce(async (input) =>
        okLiveBeats([reply], [goOption, waitOption], input.nonce),
      );
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    commitNodeMock.mockClear();
    generateStepOptionsMock.mockClear();

    runGradedQuestionGenerateMock.mockResolvedValueOnce({
      kind: 'failed',
      reason: 'exhausted-retries: answer-leak',
    });
    await act(async () => {
      result.current.actions.pick('ask-key');
    });
    await waitFor(
      () => expect(result.current.phase).toBe('options-ready'),
      { timeout: MIN_AUTHORING_MS + PACED_ARRIVAL_MS + 2000 },
    );

    // The recovery is a LIVE turn carrying the pick — not `{kind:'options'}`,
    // which would author chips for a moment that never rendered.
    const turn = generateStepOptionsMock.mock.calls.at(-1)![0].turn;
    expect(turn.kind).toBe('live');
    expect(turn).toMatchObject({
      choice: { id: 'ask-key', saysLine: 'Tu peux me donner la clé ?' },
    });

    // And the line reaches the screen + the record as the player's own bubble,
    // exactly as an ungraded `say` does.
    const commitArg = commitNodeMock.mock.calls.at(-1)![0];
    expect(commitArg.beats[0]).toMatchObject({
      speaker: 'user',
      practiceText: 'Tu peux me donner la clé ?',
    });
    // The decision was already committed by the arrival that showed the
    // question; this turn must not write a second one.
    expect(commitArg.action).toMatchObject({ kind: 'none' });
  });

  it('LIFE-NODE-2 — every pick routes to live generation', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    await act(async () => {
      result.current.actions.pick('wait');
    });
    const call = generateStepOptionsMock.mock.calls.at(-1)![0];
    expect(call.turn).toEqual(
      expect.objectContaining({
        kind: 'live',
        // LIFE-SPEECH-2 widened this payload: the pick now also carries the
        // line the client has already put on screen. `wait` is an "act", so it
        // has none — asserted explicitly, because a non-null value here would
        // mean a silent action was being reported to the model as speech.
        choice: expect.objectContaining({ id: 'wait', practiceText: 'Attendre', saysLine: null }),
      }),
    );
  });

  it('LIFE-NODE-10 — the authoring shimmer holds for MIN_AUTHORING_MS even when the generator resolves instantly', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    generateStepOptionsMock
      .mockImplementationOnce(async (input) =>
        okLive([askOption, waitOption], input.nonce),
      )
      // LIFE-NODE-2: picking 'ask' fires a live call; the question node is
      // what that call returns.
      .mockImplementationOnce(async (input) => okLiveQuestion(input.nonce));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));

    // The graded generator resolves IMMEDIATELY (no deferral) — without the
    // floor the shimmer would flash for a microtask.
    runGradedQuestionGenerateMock.mockResolvedValueOnce({
      kind: 'ok',
      practicePrompt: {
        kind: 'generation',
        practiceText: 'Je ___ déjeuner avec toi.',
        nativeText: 'I ___ to have lunch with you.',
        completedNativeText: 'I would like to have lunch with you.',
      },
      choices: [
        { id: 'voudrais', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
      ],
    });

    vi.useFakeTimers();
    try {
      await act(async () => {
        result.current.actions.pick('ask');
      });
      // Generator already resolved, but the floor timer is still pending:
      // the shimmer is held, NOT flipped to question-ready.
      expect(result.current.phase).toBe('question-authoring');
      // Just short of the floor — still holding.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIN_AUTHORING_MS - 50);
      });
      expect(result.current.phase).toBe('question-authoring');
      // Cross the floor — NOW the authored question reveals.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(result.current.phase).toBe('question-ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('LIFE-NODE-1 — question node: authoring → ready → feedback prefetch → continue applies the prefetched live node', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    generateStepOptionsMock
      .mockImplementationOnce(async (input) =>
        okLive([askOption, waitOption], input.nonce),
      )
      // LIFE-NODE-2: picking 'ask' fires a live call; the question node is
      // what that call returns.
      .mockImplementationOnce(async (input) => okLiveQuestion(input.nonce));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));

    const gen = deferred<Awaited<ReturnType<typeof runGradedQuestionGenerate>>>();
    runGradedQuestionGenerateMock.mockReturnValueOnce(gen.promise);
    act(() => {
      result.current.actions.pick('ask');
    });
    // LIFE-NODE-2: the pick now goes through a live call, so the authoring
    // phase arrives asynchronously rather than on the same tick.
    await waitFor(() => expect(result.current.phase).toBe('question-authoring'));
    // Question nodes commit the decision with NO beats.
    expect(commitNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ choiceId: 'ask' }),
        beats: [],
      }),
    );
    await act(async () => {
      gen.resolve({
        kind: 'ok',
        practicePrompt: {
          kind: 'generation',
          practiceText: 'Je ___ déjeuner avec toi.',
          nativeText: 'I ___ to have lunch with you.',
          // LIFE-LANG-6: full native translation with the blank filled.
          completedNativeText: 'I would like to have lunch with you.',
        },
        choices: [
          // LIFE-LANG-1: fill-blank chips carry nativeText: '' (D contract).
          { id: 'voudrais', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
          { id: 'veux', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
          { id: 'ai', practiceText: 'ai', nativeText: '', correctness: 'wrong' },
        ],
      });
      await gen.promise;
    });
    // LIFE-NODE-10: the authoring floor holds the shimmer ~700ms before
    // question-ready — give waitFor comfortable headroom over the floor.
    await waitFor(() => expect(result.current.phase).toBe('question-ready'), {
      timeout: 2_000,
    });

    // Chip pick → feedback + the PREFETCH fires immediately.
    const prefetch = deferred<GenerateStepOptionsResult>();
    generateStepOptionsMock.mockReturnValueOnce(prefetch.promise);
    act(() => {
      result.current.actions.pick('voudrais');
    });
    expect(result.current.phase).toBe('feedback');
    expect(result.current.feedback?.correct).toBe(true);
    // LIFE-LANG-6: gradePick derives the full sentence (blank filled with
    // the correct chip) + its native translation for the feedback overlay.
    expect(result.current.feedback?.sentencePractice).toBe(
      'Je voudrais déjeuner avec toi.',
    );
    expect(result.current.feedback?.sentenceNative).toBe(
      'I would like to have lunch with you.',
    );
    const prefetchCall = generateStepOptionsMock.mock.calls.at(-1)![0];
    expect(prefetchCall.turn).toEqual(
      expect.objectContaining({
        kind: 'live',
        practiceOutcome: expect.objectContaining({
          kind: 'generation',
          correct: true,
          correctAnswer: 'voudrais',
        }),
      }),
    );

    // Continue: resolved bubble (template + correct chip) + correction
    // commit, then the prefetched result applies WITHOUT a new call.
    const callsBefore = generateStepOptionsMock.mock.calls.length;
    act(() => {
      result.current.actions.feedbackContinue();
    });
    expect(props.appendBubbles).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          speaker: 'user',
          practiceText: 'Je voudrais déjeuner avec toi.',
        }),
      ],
      { resetTurn: true },
    );
    expect(commitNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ kind: 'practice-outcome' }),
      }),
    );
    await act(async () => {
      prefetch.resolve(okLive([goOption, waitOption], 0));
      await prefetch.promise;
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    expect(generateStepOptionsMock.mock.calls.length).toBe(callsBefore);
  });

  it('LIFE-EX-PLAN-5 — a pre-authored resolution makes the post-feedback turn cost ZERO calls', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    generateStepOptionsMock
      .mockImplementationOnce(async (input) =>
        okLive([askOption, waitOption], input.nonce),
      )
      // The pick's live call returns a question node that ALSO carries the
      // continuation for after the answer.
      .mockImplementationOnce(async (input) => okLiveQuestionWithResolution(input.nonce));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));

    runGradedQuestionGenerateMock.mockResolvedValueOnce({
      kind: 'ok',
      practicePrompt: {
        kind: 'generation',
        practiceText: 'Je ___ déjeuner avec toi.',
        nativeText: 'I ___ to have lunch with you.',
        completedNativeText: 'I would like to have lunch with you.',
      },
      choices: [
        { id: 'voudrais', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
        { id: 'veux', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
        { id: 'ai', practiceText: 'ai', nativeText: '', correctness: 'wrong' },
      ],
    });
    act(() => {
      result.current.actions.pick('ask');
    });
    await waitFor(() => expect(result.current.phase).toBe('question-ready'), {
      timeout: 2_000,
    });

    // Picking a chip must NOT fire the post-feedback prefetch — that prefetch is
    // the ~15.9k-input call LIFE-EX-PLAN-5 exists to delete. It hid the latency
    // but still cost full price.
    const callsAfterAuthoring = generateStepOptionsMock.mock.calls.length;
    act(() => {
      result.current.actions.pick('voudrais');
    });
    expect(result.current.phase).toBe('feedback');
    expect(generateStepOptionsMock.mock.calls.length).toBe(callsAfterAuthoring);

    // Continue: the resolution renders from memory. Still zero new calls, and
    // the options land WITHOUT awaiting anything.
    act(() => {
      result.current.actions.feedbackContinue();
    });
    expect(generateStepOptionsMock.mock.calls.length).toBe(callsAfterAuthoring);
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    expect(result.current.options.map((o) => o.id)).toEqual(['sit', 'go']);
    // The pre-authored beat is appended (not resetTurn — the resolved player
    // bubble already opened this turn).
    expect(props.appendBubbles).toHaveBeenCalledWith(
      [expect.objectContaining({ speaker: 'npc', practiceText: 'Avec plaisir !' })],
      { resetTurn: false },
    );
    // LIFE-STORY-LOG-1: the resolution's own log line is committed.
    expect(applyTurnSignalsMock).toHaveBeenCalledWith(
      expect.objectContaining({ logLine: 'Sophie agreed to lunch.' }),
    );
  });

  /**
   * LIFE-EX-13 RETIRED the mid-scene steal these three tests were written for.
   * A review no longer takes an arbitrary graded slot — it fires ONCE, when
   * the scene ends, ahead of the summary card. So the property worth pinning
   * here is the inverse of the old one: a question node is ALWAYS a question.
   *
   * That also removes the LIFE-SPEECH-5 carve-out, which existed solely to
   * stop the steal eating a `say` pick's line. Its assertion survives below
   * because it is still true and still worth knowing; only its reason is gone.
   */
  it('LIFE-EX-13 — a question node is ALWAYS a question; the mid-scene steal is gone', async () => {
    const props = {
      ...makeProps(),
      // Exactly the world state that USED to trigger the steal: 4 resolved
      // questions with annotated vocab between them.
      events: [
        vocabBeatEvent('b1', { 'quand même': 'anyway' }),
        correctionEvent('c1'),
        vocabBeatEvent('b2', { pourtant: 'however' }),
        correctionEvent('c2'),
        vocabBeatEvent('b3', { déjà: 'already' }),
        correctionEvent('c3'),
        correctionEvent('c4'),
      ] as UseNodeEngineProps['events'],
    };
    const { result } = renderHook(() => useNodeEngine(props));
    generateStepOptionsMock
      .mockImplementationOnce(async (input) => okLive([askOption, waitOption], input.nonce))
      .mockImplementationOnce(async (input) => okLiveQuestion(input.nonce));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));

    const gen = deferred<Awaited<ReturnType<typeof runGradedQuestionGenerate>>>();
    runGradedQuestionGenerateMock.mockReturnValueOnce(gen.promise);
    act(() => {
      result.current.actions.pick('ask');
    });

    await waitFor(() => expect(result.current.phase).toBe('question-authoring'));
    expect(result.current.cardMatch).toBeNull();
    expect(runGradedQuestionGenerateMock).toHaveBeenCalled();
  });

  it('LIFE-EX-13 — a graded SAY pick still reaches its question', async () => {
    const props = {
      ...makeProps(),
      events: [
        vocabBeatEvent('b1', { 'quand même': 'anyway' }),
        correctionEvent('c1'),
        vocabBeatEvent('b2', { pourtant: 'however' }),
        correctionEvent('c2'),
        vocabBeatEvent('b3', { déjà: 'already' }),
        correctionEvent('c3'),
        correctionEvent('c4'),
      ] as UseNodeEngineProps['events'],
    };
    generateStepOptionsMock.mockImplementationOnce(async (input) =>
      okLive([gradedSayOption, waitOption], input.nonce),
    );
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));

    runGradedQuestionGenerateMock.mockReturnValueOnce(
      deferred<Awaited<ReturnType<typeof runGradedQuestionGenerate>>>().promise,
    );
    act(() => {
      result.current.actions.pick('ask-key');
    });

    await waitFor(() => expect(result.current.phase).toBe('question-authoring'));
    expect(result.current.cardMatch).toBeNull();
    expect(runGradedQuestionGenerateMock).toHaveBeenCalled();
  });

  it('LIFE-LANG-12 — comprehension feedback shows the utterance translation, NOT the picked chip interpretation', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    const comprehensionOption: StepOption = {
      id: 'ask',
      practiceText: 'Demander',
      nativeText: 'Ask',
      speechAct: 'act',
    };
    generateStepOptionsMock
      .mockImplementationOnce(async (input) =>
        okLive([comprehensionOption, waitOption], input.nonce),
      )
      // LIFE-NODE-2: the pick goes LIVE, and the question arrives as that
      // call's node rather than as a preview cached on the chip.
      .mockImplementationOnce(async (input) =>
        okLiveQuestion(input.nonce, {
          kind: 'comprehension',
          npcUtterance: 'Est-ce que tu connais un bon café ?',
          speakerName: 'Sophie',
        }),
      );
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));

    runGradedQuestionGenerateMock.mockResolvedValueOnce({
      kind: 'ok',
      practicePrompt: {
        kind: 'comprehension',
        npcUtterance: 'Est-ce que tu connais un bon café ?',
        question: 'What is Sophie asking?',
        // LIFE-LANG-12: the faithful translation of the WHOLE line —
        // deliberately DIFFERENT from the correct chip's interpretation.
        utteranceNativeText: 'Do you know a good café?',
        speakerName: 'Sophie',
        npcId: null,
      },
      choices: [
        { id: 'cafe', practiceText: 'Elle demande un café', nativeText: "She's asking about a café", correctness: 'correct' },
        { id: 'office', practiceText: 'Elle demande le bureau', nativeText: "She's asking about the office", correctness: 'wrong' },
      ],
    });
    await act(async () => {
      result.current.actions.pick('ask');
    });
    await waitFor(() => expect(result.current.phase).toBe('question-ready'), {
      timeout: 2_000,
    });

    // Prefetch fires on the chip pick — give it a mock so it doesn't dangle.
    generateStepOptionsMock.mockReturnValueOnce(deferred<GenerateStepOptionsResult>().promise);
    act(() => {
      result.current.actions.pick('cafe');
    });
    expect(result.current.phase).toBe('feedback');
    // The "full sentence" native is the faithful utterance translation…
    expect(result.current.feedback?.sentencePractice).toBe(
      'Est-ce que tu connais un bon café ?',
    );
    expect(result.current.feedback?.sentenceNative).toBe('Do you know a good café?');
    // …NOT the interpretation the player already saw on the answer chip.
    expect(result.current.feedback?.sentenceNative).not.toBe("She's asking about a café");
  });

  it('LIFE-NODE-4 — ✏️ opens the composer; submit bumps the nonce and fires a free-text live turn', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    const callsBefore = generateStepOptionsMock.mock.calls.length;
    act(() => {
      result.current.actions.pick(WRITE_YOUR_OWN_ID);
    });
    expect(result.current.composerOpen).toBe(true);
    expect(generateStepOptionsMock.mock.calls.length).toBe(callsBefore);
    await act(async () => {
      result.current.actions.submitFreeText('On va au parc ?');
    });
    const call = generateStepOptionsMock.mock.calls.at(-1)![0];
    expect(call.turn).toEqual(
      expect.objectContaining({ kind: 'live', freeText: 'On va au parc ?' }),
    );
    expect(call.nonce).toBe(1); // LIFE-NODE-6 bump
    expect(commitNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        // LIFE-REP-5: `investIn` rides on every free-text action and is null
        // for an ordinary ✏️ submission — only the LIFE-NEED-5 clearing chip
        // names a person, and only that turn is guaranteed to move standing.
        action: { kind: 'free-text', text: 'On va au parc ?', investIn: null },
      }),
    );
  });

  it('LIFE-NODE-6 — a result generated under an old nonce is dropped, never rendered', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    const stale = deferred<GenerateStepOptionsResult>();
    generateStepOptionsMock.mockReturnValueOnce(stale.promise);
    act(() => {
      result.current.actions.startOpening(); // in flight under nonce 0
    });
    const fresh = deferred<GenerateStepOptionsResult>();
    generateStepOptionsMock.mockReturnValueOnce(fresh.promise);
    act(() => {
      result.current.actions.submitFreeText('salut'); // bumps nonce → 1
    });
    await act(async () => {
      // Stale result carries nonce 0 ≠ current 1 → dropped.
      stale.resolve({
        kind: 'ok',
        node: { kind: 'branch', beats: [{ ...narratorBeat, practiceText: 'STALE' }] },
        options: [goOption, waitOption],
        nonce: 0,
      });
      await stale.promise;
    });
    expect(
      (props.appendBubbles as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => (c[0] as Array<{ practiceText: string }>).some((b) => b.practiceText === 'STALE'),
      ),
    ).toBe(false);
    await act(async () => {
      fresh.resolve(okLive([goOption, waitOption], 1));
      await fresh.promise;
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'), {
      timeout: PACED_ARRIVAL_MS,
    });
  });

  it('LIFE-NODE-6 — a hardPivot bumps the nonce, so the pivot response\'s OWN cached previews are DROPPED (next pick routes live)', async () => {
    const props = {
      ...makeProps(),
      scene: {} as unknown as UseNodeEngineProps['scene'],
    };
    // The opening response triggers a hardPivot → the nonce bumps during the
    // SAME landing that delivered the previews.
    computeReplanPlanMock.mockReturnValue({
      reason: 'hardPivot',
      shouldReplan: false,
      patch: {},
    } as ReturnType<typeof computeReplanPlan>);
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    // Pick the CACHED preview. Pre-fix, cacheNonceRef re-synced to the bumped
    // nonce → cacheFresh → instant cached advance (bug). Post-fix, the previews
    // are keyed to the pre-bump RESULT nonce → stale → routes to a LIVE turn.
    generateStepOptionsMock.mockImplementationOnce(async (input) =>
      okLive([goOption, waitOption], input.nonce),
    );
    await act(async () => {
      result.current.actions.pick('go');
    });
    const lastCall = generateStepOptionsMock.mock.calls.at(-1)![0];
    expect(lastCall.turn).toEqual(expect.objectContaining({ kind: 'live' }));
  });

  it('LIFE-NODE-8 — options failure lands on options-failed; Continue fires a live turn', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    generateStepOptionsMock.mockImplementationOnce(async (input) => ({
      kind: 'schema-failed',
      rawAttempts: ['x', 'y'],
      nonce: input.nonce,
    }));
    await act(async () => {
      result.current.actions.pick('go');
    });
    await waitFor(() => expect(result.current.phase).toBe('options-failed'));
    await act(async () => {
      result.current.actions.pick(CONTINUE_AFTER_FAILURE_ID);
    });
    const call = generateStepOptionsMock.mock.calls.at(-1)![0];
    expect(call.turn).toEqual(
      expect.objectContaining({ kind: 'live', choice: null, freeText: null, practiceOutcome: null }),
    );
    await waitFor(() => expect(result.current.phase).toBe('options-ready'), {
      timeout: PACED_ARRIVAL_MS,
    });
  });

  it('LIFE-NODE-8 — question authoring failure GRACEFULLY DEMOTES to CYOA options (not a snag)', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    generateStepOptionsMock
      .mockImplementationOnce(async (input) =>
        okLive([askOption, waitOption], input.nonce),
      )
      // LIFE-NODE-2: picking 'ask' fires a live call; the question node is
      // what that call returns.
      .mockImplementationOnce(async (input) => okLiveQuestion(input.nonce));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    // The graded question fails to author...
    runGradedQuestionGenerateMock.mockResolvedValueOnce({
      kind: 'failed',
      reason: 'exhausted-retries',
    });
    // ...so instead of the "story snagged" ladder, the node authors normal CYOA
    // options and the story continues (v2.1 graceful demote).
    generateStepOptionsMock.mockImplementationOnce(async (input) =>
      okLive([waitOption], input.nonce),
    );
    await act(async () => {
      result.current.actions.pick('ask');
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    expect(result.current.question).toBeNull();
    expect(result.current.nodeKind).toBe('branch');
  });
});

/**
 * LIFE-UI-11 — the wait says what the STORY is doing, not what the app is.
 *
 * "Thinking…" rendered on every single turn: the app narrating its own
 * machinery in the middle of a scene, on a 2-3s element the player sees more
 * often than any other. `waitKind` names what the wait is FOR, derived from the
 * action that caused it, so the copy is meaningfully varied rather than
 * randomly varied — the line tells you what is being waited on.
 */
describe('LIFE-UI-11 — waitKind tracks the action', () => {
  it('LIFE-UI-11 — the opening turn sets "opening"', async () => {
    const { result } = renderHook(() => useNodeEngine(makeProps()));
    act(() => {
      result.current.actions.startOpening();
    });
    expect(result.current.phase).toBe('live-loading');
    expect(result.current.waitKind).toBe('opening');
  });

  it('LIFE-UI-11 — a say pick sets "say", an act pick sets "act"', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    generateStepOptionsMock.mockImplementationOnce(async (input) =>
      okLive(
        [
          { ...askOption, speechAct: 'say' as const },
          { ...waitOption, speechAct: 'act' as const },
        ],
        input.nonce,
      ),
    );
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    act(() => {
      result.current.actions.pick('ask');
    });
    expect(result.current.waitKind).toBe('say');
  });

  it('LIFE-UI-11 — an option with no declared speechAct falls back to "act"', async () => {
    // `act` is the documented default (step SI: "omit speechAct for it"), and
    // "Seeing what happens…" is true of any action, so it is the safe floor.
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    act(() => {
      result.current.actions.pick('wait');
    });
    expect(result.current.waitKind).toBe('act');
  });

  it('LIFE-UI-11 — free text sets "write"', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    act(() => {
      result.current.actions.submitFreeText('I look for the back door');
    });
    expect(result.current.waitKind).toBe('write');
  });

  // LIFE-SCENE-24 — hooks are gone; a scene starts because the world has none.
  //
  // THE MEASUREMENT THIS REPLACES: across two harness runs (25 turns and 12)
  // the model offered ZERO hooks and `<scene status="idle"/>` rendered on every
  // single turn, so no chapter could ever end — a chapter ends only when a
  // scene resolves. `<hookPressure>` nagged at 6 and 10 turns and did not fix
  // it. A request the model can satisfy by doing nothing is not a mechanism.
  describe('LIFE-SCENE-24 — scenes auto-start', () => {
    it('starts a scene when a turn lands and the world has none', async () => {
      const props = makeProps();
      const { result } = renderHook(() => useNodeEngine(props));
      await act(async () => {
        result.current.actions.startOpening();
      });
      await waitFor(() => expect(startSceneMock).toHaveBeenCalled());
      expect(startSceneMock.mock.calls[0]![0]).toMatchObject({
        uid: 'u1',
        world: expect.objectContaining({ id: 'w1' }),
      });
    });

    it('does NOT start one when a scene is already active', async () => {
      const props = {
        ...makeProps(),
        scene: { id: 's-1', status: 'active' } as UseNodeEngineProps['scene'],
      };
      const { result } = renderHook(() => useNodeEngine(props));
      await act(async () => {
        result.current.actions.startOpening();
      });
      await waitFor(() => expect(result.current.phase).toBe('options-ready'));
      expect(startSceneMock).not.toHaveBeenCalled();
    });

    it('starts at most ONE at a time — a second turn mid-generation does not race', async () => {
      // Each generation WRITES the active scene doc, so two racing would have
      // the loser silently replace a story the player is already several turns
      // into. The guard is why this is a ref and not just an `if (!scene)`.
      const gen = deferred<{ sceneId: string; usedFallback: boolean }>();
      startSceneMock.mockReturnValueOnce(gen.promise);
      const props = makeProps();
      const { result } = renderHook(() => useNodeEngine(props));
      await act(async () => {
        result.current.actions.startOpening();
      });
      await waitFor(() => expect(startSceneMock).toHaveBeenCalledTimes(1));
      generateStepOptionsMock.mockClear();
      await act(async () => {
        result.current.actions.continueTurn();
      });
      // The turn itself proceeds — auto-start never blocks it.
      await waitFor(() => expect(generateStepOptionsMock).toHaveBeenCalled());
      // Still one scene generation: the first has not landed, so the guard holds.
      expect(startSceneMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        gen.resolve({ sceneId: 's-1', usedFallback: false });
      });
    });

    it('a failed generation does not wedge the turn or the guard', async () => {
      // Fire-and-forget on purpose: the turn that discovered the gap continues
      // immediately. A rejection must neither surface as a turn error nor
      // leave the guard stuck so no scene can ever start again.
      startSceneMock.mockRejectedValueOnce(new Error('gen failed'));
      const props = makeProps();
      const { result } = renderHook(() => useNodeEngine(props));
      await act(async () => {
        result.current.actions.startOpening();
      });
      await waitFor(() => expect(result.current.phase).toBe('options-ready'));
      expect(props.onError).not.toHaveBeenCalled();
      // The guard released, so the next turn tries again.
      await act(async () => {
        result.current.actions.continueTurn();
      });
      await waitFor(() => expect(startSceneMock).toHaveBeenCalledTimes(2), {
        timeout: PACED_ARRIVAL_MS,
      });
    });
  });
});

describe('LIFE-SCENE-32 — a resolving scene always closes, and closes FIRST', () => {
  const resolvedResult = (nonce: number): Extract<GenerateStepOptionsResult, { kind: 'ok' }> => ({
    kind: 'ok',
    node: { kind: 'branch', beats: [narratorBeat] },
    options: [goOption, waitOption],
    scene: {
      resolved: {
        endingKey: 'crate-returned',
        outcomeLine: 'Tu as rendu la caisse.',
        outcomeLineNative: 'You returned the crate.',
      },
    },
    nonce,
  } as unknown as Extract<GenerateStepOptionsResult, { kind: 'ok' }>);

  async function resolveAScene(props: UseNodeEngineProps) {
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => { result.current.actions.startOpening(); });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    generateStepOptionsMock.mockImplementationOnce(async (input) => resolvedResult(input.nonce));
    await act(async () => { result.current.actions.pick('go'); });
    return result;
  }

  it('closes the scene even when the replan TICK has not come round', async () => {
    // THE BUG. `runSceneClose` is what writes the history line, and
    // LIFE-SCENE-31 renders that line as the completion screen's summary. It
    // used to be gated on `shouldReplan` alone — a 5-turn tick — so a scene
    // resolving on any other turn produced no summary at all and the screen
    // pulsed its placeholder forever.
    computeReplanPlanMock.mockReturnValue({
      reason: 'none', shouldReplan: false, patch: {},
      outlineForReplan: { subject: 'the crate', premise: 'p', signOf: null },
    } as unknown as ReturnType<typeof computeReplanPlan>);
    vi.mocked(runSceneClose).mockResolvedValue({ kind: 'error' } as never);
    const props = { ...makeProps(), scene: {} as unknown as UseNodeEngineProps['scene'] };
    await resolveAScene(props);
    await waitFor(() => expect(vi.mocked(runSceneClose)).toHaveBeenCalled());
  });

  it('LIFE-SCENE-36 — does NOT close on the 5-turn TICK, only on the resolve', async () => {
    // PRODUCTION, 2026-08-06: FOUR scene closes inside six minutes, with
    // summaries that contradicted each other. `runSceneClose` was gated on
    // `shouldReplan || resolvingNow`, and `shouldReplan` is a 5-turn tick — so
    // a 12-turn scene closed at turn 5, turn 10, AND on resolve, each writing
    // a "what happened in this scene" line from a partial view.
    //
    // LIFE-ARCH-5 states the contract this broke: sagaHistory is "an array of
    // one-line entries appended at each sceneClose", and `canonDormancy` reads
    // it assuming ONE LINE PER CLOSED SCENE. Extra lines make every entity
    // read as more recent than it is, which is the exact symptom the design's
    // own watch-list calls "dormancy not working".
    computeReplanPlanMock.mockReturnValue({
      reason: 'tick', shouldReplan: true, patch: { turnsSinceReplan: 0 },
      outlineForReplan: { subject: 'the crate', premise: 'p', signOf: null },
    } as unknown as ReturnType<typeof computeReplanPlan>);
    vi.mocked(runSceneClose).mockResolvedValue({ kind: 'error' } as never);
    const props = { ...makeProps(), scene: {} as unknown as UseNodeEngineProps['scene'] };

    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => { result.current.actions.startOpening(); });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    // A turn that does NOT resolve the scene, on a tick.
    await act(async () => { result.current.actions.pick('go'); });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));

    expect(vi.mocked(runSceneClose)).not.toHaveBeenCalled();
    // ...and the tick's own bookkeeping still happens, so the counter resets.
    expect(computeReplanPlanMock).toHaveBeenCalled();
  });

  it('LIFE-EX-13 — the card-match is ATTEMPTED on every resolve, and the close is already running', async () => {
    // Two properties in one, because they are one behaviour: the review
    // intercepts the scene end, and the scene's details load behind it.
    const order: string[] = [];
    computeReplanPlanMock.mockReturnValue({
      reason: 'none', shouldReplan: false, patch: {},
      outlineForReplan: { subject: 'the crate', premise: 'p', signOf: null },
    } as unknown as ReturnType<typeof computeReplanPlan>);
    vi.mocked(runSceneClose).mockImplementation(async () => {
      order.push('close');
      return { kind: 'error' } as never;
    });
    // Enough glossed vocab for a real grid (CARD_MATCH_MIN_PAIRS = 3).
    const props = {
      ...makeProps(),
      scene: { id: 'sc-1' } as unknown as UseNodeEngineProps['scene'],
      events: [
        vocabBeatEvent('b1', { 'la caisse': 'the crate' }),
        vocabBeatEvent('b2', { 'le quai': 'the quay' }),
        vocabBeatEvent('b3', { 'la corde': 'the rope' }),
      ],
    };
    props.onSceneResolved = vi.fn(() => { order.push('screen'); });

    const result = await resolveAScene(props);

    await waitFor(() => expect(result.current.phase).toBe('card-match'));
    // ...and it STAYS. The options release on the beat tail right after, and
    // used to set `options-ready` over the top — the grid was built, lived one
    // tick, and the player never saw it.
    await new Promise((r) => setTimeout(r, 400));
    expect(result.current.phase).toBe('card-match');
    // The close starts FIRST, so the scene's record is loading in the
    // background while the player does the review — the summary chip is not
    // waiting on a round-trip that only begins when they finish.
    expect(order[0]).toBe('close');
    expect(order).toContain('screen');
    expect(result.current.cardMatch?.pairs.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('LIFE-EX-13.2 — a scene ending on a QUESTION keeps the question AND the grid', async () => {
    // THE GAP LIFE-EX-13.1 LEFT. That fix guarded the two `options-ready`
    // release sites, which covers a scene resolving on a BRANCH — the case the
    // test above uses. `arriveAtNode` has two more phase writes: a `question`
    // node goes straight to `question-authoring` SYNCHRONOUSLY, right after
    // `handleSignals`, and the demote path to `options-loading`. Both discarded
    // the grid, which is the 2026-08-07 report — *"still not getting card
    // matching"* — arriving after the first fix shipped.
    //
    // The fix is NOT a third guard. A scene that ends on a graded question
    // should keep BOTH: the player answers the question that ended the scene,
    // and the review opens when the turn comes to rest. So the assertion runs
    // in two halves, and the first half is what a guard would have broken.
    computeReplanPlanMock.mockReturnValue({
      reason: 'none', shouldReplan: false, patch: {},
      outlineForReplan: { subject: 'the crate', premise: 'p', signOf: null },
    } as unknown as ReturnType<typeof computeReplanPlan>);
    vi.mocked(runSceneClose).mockResolvedValue({ kind: 'error' } as never);
    const props = {
      ...makeProps(),
      scene: { id: 'sc-q' } as unknown as UseNodeEngineProps['scene'],
      events: [
        vocabBeatEvent('b1', { 'la caisse': 'the crate' }),
        vocabBeatEvent('b2', { 'le quai': 'the quay' }),
        vocabBeatEvent('b3', { 'la corde': 'the rope' }),
      ],
    };
    props.onSceneResolved = vi.fn();

    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => { result.current.actions.startOpening(); });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    generateStepOptionsMock.mockImplementationOnce(async (input) => ({
      kind: 'ok',
      node: {
        kind: 'question',
        beats: [],
        gradedPlan: { kind: 'comprehension', npcUtterance: 'Ça y est.', speakerName: 'Rémy' },
      },
      options: [],
      scene: {
        resolved: {
          endingKey: 'crate-returned',
          outcomeLine: 'Tu as rendu la caisse.',
          outcomeLineNative: 'You returned the crate.',
        },
      },
      nonce: input.nonce,
    }) as never);
    await act(async () => { result.current.actions.pick('go'); });

    // HALF ONE: the question survives. The scene resolved on it, and eating it
    // to show a review would delete the exercise the turn was for.
    await waitFor(() => expect(result.current.phase).toBe('question-authoring'));
    expect(props.onSceneResolved).toHaveBeenCalledTimes(1);

    // HALF TWO: the review is still owed, and takes the next settle point
    // rather than being lost with the phase that overwrote it.
    await act(async () => { result.current.actions.continueTurn(); });
    await waitFor(() => expect(result.current.phase).toBe('card-match'), {
      timeout: PACED_ARRIVAL_MS,
    });
    expect(result.current.cardMatch?.pairs.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('LIFE-EX-13 — a scene with too little vocab still reaches its summary', async () => {
    // The ONLY way the review declines: below CARD_MATCH_MIN_PAIRS a grid is
    // not a game (two tiles match themselves). The scene end must still
    // proceed — declining the review must never strand the summary.
    computeReplanPlanMock.mockReturnValue({
      reason: 'none', shouldReplan: false, patch: {},
      outlineForReplan: { subject: 'the crate', premise: 'p', signOf: null },
    } as unknown as ReturnType<typeof computeReplanPlan>);
    vi.mocked(runSceneClose).mockResolvedValue({ kind: 'error' } as never);
    const props = {
      ...makeProps(),
      scene: { id: 'sc-1' } as unknown as UseNodeEngineProps['scene'],
    };
    props.onSceneResolved = vi.fn();

    const result = await resolveAScene(props);

    expect(props.onSceneResolved).toHaveBeenCalledTimes(1);
    expect(result.current.phase).not.toBe('card-match');
  });

  it('starts the close BEFORE opening the completion screen', async () => {
    // The player waits on the summary, so the round-trip must begin while the
    // celebration is animating in — not after it has rendered a placeholder.
    const order: string[] = [];
    computeReplanPlanMock.mockReturnValue({
      reason: 'none', shouldReplan: false, patch: {},
      outlineForReplan: { subject: 'the crate', premise: 'p', signOf: null },
    } as unknown as ReturnType<typeof computeReplanPlan>);
    vi.mocked(runSceneClose).mockImplementation(async () => {
      order.push('close');
      return { kind: 'error' } as never;
    });
    const props = { ...makeProps(), scene: {} as unknown as UseNodeEngineProps['scene'] };
    props.onSceneResolved = vi.fn(() => { order.push('screen'); });
    await resolveAScene(props);
    await waitFor(() => expect(order).toContain('screen'));
    expect(order[0]).toBe('close');
  });
});

describe('OBS-COVER-7 — the engine surfaces the error, not a string', () => {
  it('OBS-COVER-7 — a failed live step passes the original error object to onError', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    const boom = new Error('gemini 500');
    generateStepOptionsMock.mockImplementationOnce(async (input) => ({ kind: 'error', error: boom, nonce: input.nonce }));
    await act(async () => {
      result.current.actions.pick('go');
    });
    await waitFor(() => expect(result.current.phase).toBe('options-failed'));
    expect(props.onError).toHaveBeenCalledWith(boom, 'lifeStep');
  });
});
