/**
 * The `life_step` parity fixtures — ONE definition, read by both sides.
 *
 * Each prompt fixture carries TWO shapes of the same turn:
 *
 *   · `client` — a `LifeStepInput` as `src/lib/life/prompts/step.ts` took it
 *     (whole `LifeWorld` / `LifeEvent[]` / `LifeScene` / `LifeNpc[]`);
 *   · `spec`   — the `life_step` promptSpec the migrated call site sends.
 *
 * `captureStepGolden.probe.ts` runs the CLIENT half once and records the bytes;
 * `functions/src/__tests__/stepGoldenParity.test.ts` replays the SPEC half
 * through `resolveServerPrompt` and asserts the same bytes come back. Keeping
 * both in one file is what makes them provably the same turn — a fixture pair
 * defined in two places is a pair that will describe two different turns the
 * first time either is edited.
 *
 * ⚠ THE FIXTURES ARE CHOSEN TO TELL PLAUSIBLE MIS-PORTS APART, not to be
 * realistic. Every `?? ''`, every `if (x)` branch and every slice bound in the
 * builder needs an input on both sides of it, because a parity test that only
 * exercises the happy path agrees about the happy path (batch 3's note).
 */
/* eslint-disable */
// @ts-nocheck
import { resolveCanon } from '@/lib/life/canon';
import { daysLeft, exposureReason, worldFactsFor } from '@/lib/life/goalLadder';

const ts = (ms: number) => ({ toMillis: () => ms });

/** A whole-`LifeWorld`-shaped object, and the flat spec fields it maps to. */
function world(over: Record<string, unknown> = {}) {
  return {
    characterName: 'Marc',
    practiceLanguage: 'French',
    nativeLanguage: 'English',
    systemLanguage: 'English',
    difficulty: 3,
    worldSeedKey: 'city_life',
    ...over,
  };
}

const CAST = [
  {
    id: 'p1',
    name: 'Bébert "the clerk"',
    tier: 'principal',
    voice: 'dry & <quiet>',
    standing: 1,
    known: 'Runs the <lock> & the gate',
    wants: 'The roster changed.',
    nextMove: 'Corner the clerk.',
    limit: 'Nothing in writing.',
    ties: [{ id: 'r1', how: 'owes them & more' }],
  },
  {
    id: 'r1',
    name: 'Sophie',
    tier: 'regular',
    voice: 'clipped',
    standing: 0,
    known: 'Opens the bakery.',
    routine: 'Opens at five.',
    ties: [],
  },
];

const FRONTS = [
  { driverId: 'p1', agenda: 'Buying the lease.', resolved: null },
  { driverId: 'circumstance', agenda: 'A & B <together>', resolved: 'cleared' },
];

const UNIVERSE = {
  setting: 'A town of <locks> & gates',
  era: '"now"',
  laws: ['a < b & c'],
  places: ['The <wash-house>'],
  figures: [{ name: 'Bébert "the clerk"', what: 'Keeps the <book> & the keys' }],
};

const CANON = {
  characters: [
    { id: 'char-bebert', name: 'Bébert', kind: 'person', note: 'Runs the lock.' },
    { id: 'char-mute', name: 'The statue', kind: 'statue', note: 'Does not speak.', canSpeak: false },
  ],
  places: [{ id: 'plac-wash-house', name: 'The wash-house', kind: 'place', note: '' }],
  objects: [{ id: 'obje-ledger', name: 'The ledger', kind: 'object', note: 'A list of names & dates.' }],
  facts: [],
};

const NPCS = [
  { id: 'npc-sophie', name: 'Sophie', scope: 'world', relationship: 'the baker', oneLineMemory: 'You paid her back.' },
  { id: 'npc-marc2', name: 'Yannick', scope: 'scene', sceneId: 'sc-1', oneLineMemory: '' },
  { id: 'npc-old', name: 'Retired', scope: 'transient' },
];

const SCENE = {
  id: 'sc-1',
  status: 'active',
  currentPhase: 'rising',
  turnsSinceReplan: 2,
  leaning: 'refusing, harder than when you came in',
  leaningStall: 0,
  outline: {
    title: 'The locked gate',
    subject: 'getting through the gate',
    where: 'The <wash-house>',
    premise: 'The gate is locked & nobody will say why',
    tone: 'wry',
    openQuestion: 'Will Bruno hand it over?',
    practiceFocus: ['asking for things', 'polite refusal'],
    keyNpcs: [{ npcId: 'npc-sophie', name: 'Sophie', role: 'the one with the key' }],
  },
};

const ARC = {
  chapterNumber: 2,
  premise: 'The lease changes hands & nobody is ready',
  themes: ['obligation', 'the <river>'],
  recurringNpcIds: ['npc-sophie'],
  completedSceneMemories: [
    { title: 'The first delivery', summary: 'You carried a crate & got paid.' },
    { title: 'A bad morning', summary: 'The bread burned.' },
    { title: 'Older, dropped by the slice', summary: 'Should not render.' },
  ],
};

const EVENTS = [
  { kind: 'beat', payload: { speaker: 'narrator', practiceText: 'Il fait nuit & la rue est vide.' }, createdAt: ts(1000) },
  { kind: 'beat', payload: { speaker: 'npc', speakerName: 'Sophie', npcId: 'npc-sophie', practiceText: 'Tu viens ?' }, createdAt: ts(1100) },
  { kind: 'beat', payload: { speaker: 'narrator', practiceText: '', nativeText: 'Legacy two-channel narration.' }, createdAt: ts(1150) },
  { kind: 'decision', payload: { text: 'Ask about the gate', actionType: 'ask', targetId: 'plac-wash-house' }, createdAt: ts(1200) },
  { kind: 'decision', payload: { text: 'Ask again', actionType: 'ask', targetId: 'plac-wash-house' }, createdAt: ts(1250) },
  { kind: 'correction', payload: { kind: 'generation', correctAnswer: 'Veux' }, createdAt: ts(1300) },
  { kind: 'flashcard_added', payload: { phrase: 'dropped' }, createdAt: ts(1350) },
  { kind: 'npc_introduced', payload: { npcId: 'npc-sophie' }, createdAt: ts(1360) },
  { kind: 'question_demoted', payload: { reason: 'dropped' }, createdAt: ts(1370) },
  { kind: 'backdrop_visited', payload: { locationLabel: 'The <wash-house>' }, createdAt: ts(1400) },
  { kind: 'npc_forgotten', payload: { npcId: 'npc-old' }, createdAt: ts(1420) },
  { kind: 'scene_completed', payload: { sceneId: 'sc-0', title: 'Old scene & done', endingKey: 'crate-returned' }, createdAt: ts(1440) },
  { kind: 'scene_started', payload: { sceneId: 'sc-1', title: 'The locked gate' }, createdAt: ts(1500) },
  { kind: 'beat', payload: { speaker: 'narrator', practiceText: 'La grille est fermée.' }, createdAt: ts(1600) },
  { kind: 'decision', payload: { text: 'Look at the lock', actionType: 'observe' }, createdAt: ts(1650) },
  { kind: 'a_kind_this_build_has_never_heard_of', payload: { x: 1 }, createdAt: ts(1700) },
];

const GOAL_SAGA = { text: 'keep the room over the bakery', when: 'the end of the month', days: 12 };

/** The ladder in its three directive states, plus the `<goal>` rows. */
const LADDERS = {
  none: { saga: GOAL_SAGA, objective: null, done: [], dayIndex: 3, blocked: null },
  live: {
    saga: GOAL_SAGA,
    objective: { id: 'o1', text: 'get Hélène to look at your work', need: { kind: 'who', name: 'Hélène' } },
    done: [
      { how: 'done', text: 'Paid the first week', because: null },
      { how: 'closed', text: 'Borrow the cart', because: 'Bébert changed the lock' },
    ],
    dayIndex: 3,
    blocked: null,
  },
  blocked: {
    saga: GOAL_SAGA,
    objective: { id: 'o1', text: 'get Hélène to look at your work', need: { kind: 'who', name: 'Hélène' } },
    done: [],
    dayIndex: 3,
    blocked: 'you have not met Hélène yet',
  },
};

/** The CLIENT input for one turn. */
function clientInput(over: Record<string, unknown> = {}) {
  const w = over.world as Record<string, unknown> | undefined;
  return {
    world: {
      ...world(),
      universe: UNIVERSE,
      situation: 'You have a room over the bakery.',
      fronts: FRONTS,
      cast: CAST,
      canon: CANON,
      bio: '<bio>A baker from the coast.</bio>',
      worldSeedText: 'a canal town & its locks',
      currentLocationLabel: 'The <wash-house>',
      currentArc: { chapterNumber: 2, recurringNpcIds: ['npc-sophie'], startedAt: ts(1000), ...(ARC as object) },
      storyLog: { entries: ['You arrived & paid a week.', 'The gate was locked.'], turns: 26, sceneTurns: 7 },
      rollingSummary: '',
      goalLadder: LADDERS.live,
      timeOfDay: 'evening',
      ...(w ?? {}),
    },
    events: EVENTS,
    npcs: NPCS,
    scene: SCENE,
    isOpeningBeat: false,
    requestKind: 'live',
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'world')),
  };
}

/** The SPEC the migrated call site derives from the same turn. Mirrors
 *  `lifeStepSpecFrom` in `src/lib/life/stepSpec.ts` — kept here rather than
 *  imported so this file survives the client deletions. */
function specFrom(input: Record<string, unknown>) {
  const w = input.world as Record<string, unknown>;
  const arc = w.currentArc as Record<string, unknown> | undefined;
  const log = w.storyLog as Record<string, unknown> | undefined;
  const ladder = w.goalLadder as Record<string, unknown> | null | undefined;
  const scene = input.scene as Record<string, unknown> | null | undefined;
  return {
    kind: 'life_step',
    practiceLanguage: w.practiceLanguage,
    nativeLanguage: w.nativeLanguage,
    systemLanguage: w.systemLanguage ?? w.nativeLanguage,
    difficulty: w.difficulty,
    characterName: w.characterName,
    worldSeedKey: w.worldSeedKey,
    ...(w.worldSeedText !== undefined ? { worldSeedText: w.worldSeedText } : {}),
    ...(w.bio !== undefined ? { bio: w.bio } : {}),
    universe: w.universe ?? null,
    story: { situation: w.situation, fronts: w.fronts, cast: w.cast },
    // RESOLVED, exactly as the migrated call site resolves it: `resolveCanon`
    // appends the live roster and the current location to the stored ledger,
    // and it STAYS client-side because `validateNodeResponse` checks the
    // model's `targetId`s against the same answer.
    canon: resolveCanon(w as never, (input.npcs ?? []) as never),
    npcs: input.npcs,
    recurringNpcIds: arc?.recurringNpcIds ?? [],
    chapterNumber: arc?.chapterNumber ?? 1,
    chapterTurns: (log?.turns as number) ?? (log?.entries as unknown[])?.length ?? 0,
    chapterStartedAtMs:
      arc?.startedAt && typeof (arc.startedAt as { toMillis?: () => number }).toMillis === 'function'
        ? (arc.startedAt as { toMillis: () => number }).toMillis()
        : null,
    sceneTurns: (log?.sceneTurns as number) ?? 0,
    storyLogEntries: (log?.entries as string[]) ?? [],
    ...(w.rollingSummary !== undefined ? { rollingSummary: w.rollingSummary } : {}),
    arc: arc
      ? {
          chapterNumber: arc.chapterNumber,
          premise: arc.premise,
          themes: arc.themes,
          recurringNpcIds: arc.recurringNpcIds,
          completedSceneMemories: arc.completedSceneMemories,
        }
      : null,
    scene: scene
      ? {
          id: scene.id,
          currentPhase: scene.currentPhase,
          turnsSinceReplan: scene.turnsSinceReplan,
          leaning: scene.leaning,
          leaningStall: scene.leaningStall,
          outline: scene.outline,
        }
      : null,
    ...(w.currentLocationLabel !== undefined
      ? { currentLocationLabel: w.currentLocationLabel }
      : {}),
    goalLadder: ladder
      ? {
          // `daysLeft(ladder)` and `exposureReason(objective, worldFactsFor(...))`
          // are applied HERE, exactly as the migrated call site applies them —
          // see `lifeStep.ts`'s header for why the FACTS do not travel.
          ...(ladder.saga
            ? {
                saga: {
                  text: (ladder.saga as Record<string, unknown>).text,
                  when: (ladder.saga as Record<string, unknown>).when,
                  daysLeft: daysLeft(ladder as never) ?? 0,
                },
              }
            : {}),
          ...(ladder.objective
            ? {
                objective: {
                  text: (ladder.objective as Record<string, unknown>).text,
                  ...((ladder.objective as Record<string, unknown>).need
                    ? {
                        need: {
                          name: ((ladder.objective as Record<string, unknown>).need as Record<string, unknown>)
                            .name,
                        },
                      }
                    : {}),
                },
              }
            : {}),
          done: ladder.done ?? [],
          ...(() => {
            const blocked = exposureReason(
              ladder.objective as never,
              worldFactsFor(w as never, (input.npcs ?? []) as never),
            );
            return blocked ? { blocked } : {};
          })(),
        }
      : null,
    timeOfDay: w.timeOfDay,
    ...(input.turnIndex !== undefined ? { turnIndex: input.turnIndex } : {}),
    events: ((input.events as Record<string, unknown>[]) ?? []).map((e) => ({
      kind: e.kind,
      ...(e.payload !== undefined ? { payload: e.payload } : {}),
      createdAtMs:
        e.createdAt && typeof (e.createdAt as { toMillis?: () => number }).toMillis === 'function'
          ? (e.createdAt as { toMillis: () => number }).toMillis()
          : null,
    })),
    ...(input.requestKind !== undefined ? { requestKind: input.requestKind } : {}),
    ...(input.currentNodeKind !== undefined && input.currentNodeKind !== null
      ? { currentNodeKind: input.currentNodeKind }
      : {}),
    isOpeningBeat: input.isOpeningBeat === true,
    ...(input.choice ? { choice: input.choice } : {}),
    ...(input.freeText ? { freeText: input.freeText } : {}),
    ...(input.practiceOutcome ? { practiceOutcome: input.practiceOutcome } : {}),
  };
}

const PROMPT_CASES: Record<string, Record<string, unknown>> = {
  // ── the seven `<turn>` branches ────────────────────────────────────────
  'T1 opening beat': clientInput({ isOpeningBeat: true, events: [], scene: null, npcs: [] }),
  'T2 choice, act': clientInput({
    choice: { id: 'open-gate', practiceText: 'Open the gate', speechAct: 'act' },
  }),
  'T3 choice, say with a said line': clientInput({
    choice: {
      id: 'greet',
      practiceText: 'Greet Sophie',
      speechAct: 'say',
      saysLine: 'Salut Sophie, ça va & tout ?',
    },
  }),
  'T4 choice, no speechAct at all': clientInput({
    choice: { id: 'wait', practiceText: 'Wait <here>' },
  }),
  'T5 free text': clientInput({ freeText: 'I look for the key & wait' }),
  'T6 practiceOutcome, generation, correct, resolved line': clientInput({
    practiceOutcome: {
      kind: 'generation',
      correct: true,
      picked: 'veux',
      correctAnswer: 'veux',
      promptSource: 'Je ___ un café.',
      resolvedLine: 'Je veux un café & un verre.',
      resolvedSpeaker: 'user',
    },
  }),
  'T7 practiceOutcome, comprehension, wrong, npc speaker': clientInput({
    practiceOutcome: {
      kind: 'comprehension',
      correct: false,
      picked: 'She asks the time',
      correctAnswer: 'She asks for the bill',
      promptSource: 'Combien ça coûte ?',
      resolvedLine: 'Combien ça coûte ?',
      resolvedSpeaker: 'npc',
    },
  }),
  'T8 continue (nothing set)': clientInput({}),
  'T9 options turn, branch': clientInput({ requestKind: 'options', currentNodeKind: 'branch' }),
  'T10 options turn, continuation': clientInput({
    requestKind: 'options',
    currentNodeKind: 'continuation',
  }),
  'T11 options turn, node kind absent (defaults to branch)': clientInput({
    requestKind: 'options',
    currentNodeKind: null,
  }),
  // ── the optional blocks, present and absent ────────────────────────────
  'B1 idle chapter (no scene)': clientInput({ scene: null }),
  'B2 idle with no arc at all': clientInput({
    scene: null,
    world: { currentArc: undefined },
  }),
  'B3 no npcs at all': clientInput({ npcs: [] }),
  'B4 no universe, no bio, no seed text': clientInput({
    world: { universe: null, bio: undefined, worldSeedText: '' },
  }),
  'B5 legacy rollingSummary shim (short log)': clientInput({
    world: {
      rollingSummary: '  A summary from before compaction went.  ',
      storyLog: { entries: ['One line.'], turns: 3, sceneTurns: 1 },
    },
  }),
  'B6 rollingSummary present but log past the shim': clientInput({
    world: {
      rollingSummary: 'Should not render.',
      storyLog: {
        entries: Array.from({ length: 9 }, (_, i) => `Line ${i}.`),
        turns: 30,
        sceneTurns: 10,
      },
    },
  }),
  'B7 empty story log': clientInput({
    world: { storyLog: { entries: [], turns: 0, sceneTurns: 0 } },
  }),
  'B8 goal ladder with no objective': clientInput({ world: { goalLadder: LADDERS.none } }),
  'B9 goal ladder blocked': clientInput({ world: { goalLadder: LADDERS.blocked } }),
  'B10 no goal ladder': clientInput({ world: { goalLadder: null } }),
  'B11 no location label': clientInput({ world: { currentLocationLabel: '' } }),
  'B12 empty canon': clientInput({
    world: { canon: { characters: [], places: [], objects: [], facts: [] } },
  }),
  // ── the pace / stage ladders, on both sides of every threshold ─────────
  'P1 chapter 1, turn 0 (arrival, no pace blocks)': clientInput({
    world: {
      currentArc: { chapterNumber: 1, recurringNpcIds: [], startedAt: ts(1000), ...(ARC as object), chapterNumber: 1 },
      storyLog: { entries: ['One.'], turns: 0, sceneTurns: 0 },
    },
  }),
  'P2 chapter 1, turn 6 (settling)': clientInput({
    world: {
      currentArc: { ...(ARC as object), chapterNumber: 1, startedAt: ts(1000) },
      storyLog: { entries: ['One.'], turns: 6, sceneTurns: 6 },
    },
  }),
  'P3 chapter 1, turn 13 (stirring, scene in-range)': clientInput({
    world: {
      currentArc: { ...(ARC as object), chapterNumber: 1, startedAt: ts(1000) },
      storyLog: { entries: ['One.'], turns: 13, sceneTurns: 9 },
    },
  }),
  'P4 chapter 1, turn 21 (underway, scene overdue)': clientInput({
    world: {
      currentArc: { ...(ARC as object), chapterNumber: 1, startedAt: ts(1000) },
      storyLog: { entries: ['One.'], turns: 21, sceneTurns: 12 },
    },
  }),
  'P5 chapter overdue': clientInput({
    world: { storyLog: { entries: ['One.'], turns: 40, sceneTurns: 6 } },
  }),
  'P6 chapter due': clientInput({
    world: { storyLog: { entries: ['One.'], turns: 32, sceneTurns: 3 } },
  }),
  // ── cadence + grid, which read the event log ───────────────────────────
  'C1 cadence due (two decisions since the last correction)': clientInput({
    events: [
      ...EVENTS,
      { kind: 'decision', payload: { text: 'One', actionType: 'do', targetId: 'obje-ledger' }, createdAt: ts(1800) },
      { kind: 'decision', payload: { text: 'Two', actionType: 'move' }, createdAt: ts(1900) },
    ],
  }),
  'C2 turn index rotation (move)': clientInput({ turnIndex: 1 }),
  'C3 turn index rotation (observe, adds the active rule)': clientInput({ turnIndex: 2 }),
  'C4 no events at all': clientInput({ events: [] }),
  'C5 scene boundary NOT in the window': clientInput({
    events: EVENTS.slice(13),
  }),
  'C6 scene boundary is the LAST row (nothing after it)': clientInput({
    events: EVENTS.slice(0, 13),
  }),
  'C7 scene with no where (no at= attribute)': clientInput({
    scene: { ...SCENE, outline: { ...SCENE.outline, where: '' } },
  }),
  'C8 scene with no open question': clientInput({
    scene: { ...SCENE, outline: { ...SCENE.outline, openQuestion: '' } },
  }),
  'C9 scene question STALLED': clientInput({
    scene: { ...SCENE, leaningStall: 2, leaning: '' },
  }),
  'C10 clock at dawn': clientInput({ world: { timeOfDay: 'dawn' } }),
  'C11 clock unreadable (falls to morning)': clientInput({ world: { timeOfDay: 'teatime' } }),
  'C12 recurring roster over the cap': clientInput({
    npcs: Array.from({ length: 9 }, (_, i) => ({
      id: `npc-${i}`,
      name: `Person ${i}`,
      scope: 'world',
      oneLineMemory: `Memory ${i}.`,
    })),
    world: {
      currentArc: {
        ...(ARC as object),
        recurringNpcIds: Array.from({ length: 9 }, (_, i) => `npc-${i}`),
        startedAt: ts(1000),
      },
    },
  }),
  'C13 recurring roster at the approaching-cap band': clientInput({
    npcs: Array.from({ length: 6 }, (_, i) => ({ id: `npc-${i}`, name: `Person ${i}`, scope: 'world' })),
    world: {
      currentArc: {
        ...(ARC as object),
        recurringNpcIds: Array.from({ length: 6 }, (_, i) => `npc-${i}`),
        startedAt: ts(1000),
      },
    },
  }),
  'C14 chapter started AFTER the corrections (targets filtered out)': clientInput({
    world: {
      currentArc: { ...(ARC as object), startedAt: ts(9_999_999) },
    },
  }),
};

export const FIXTURES = {
  si: {
    'French / English / English / 1': {
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'English',
      difficulty: 1,
    },
    'French / English / English / 3': {
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'English',
      difficulty: 3,
    },
    'Spanish (Latin America) / German / French / 7': {
      practiceLanguage: 'Spanish (Latin America)',
      nativeLanguage: 'German',
      systemLanguage: 'French',
      difficulty: 7,
    },
    'practice == system (the vocab rule reads both)': {
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'French',
      difficulty: 4,
    },
  },
  prompts: Object.fromEntries(Object.entries(PROMPT_CASES).map(([k, v]) => [k, v])),
  specs: Object.fromEntries(Object.entries(PROMPT_CASES).map(([k, v]) => [k, specFrom(v)])),

  /** One row per Zod issue shape the ladder can produce, including the
   *  array-length message whose `>=` the escape would mangle. */
  schemaIssues: {
    'one issue': [{ path: 'node.kind', message: 'Invalid input' }],
    'six issues (the slice bound)': [
      { path: 'node.kind', message: 'Invalid input' },
      { path: 'options', message: 'Too small: expected array to have >=2 items' },
      { path: 'node.beats.0.practiceText', message: 'Too small: expected string to have >=1 characters' },
      { path: 'options.0.id', message: 'Invalid input: expected string' },
      { path: 'logLine', message: 'Invalid input' },
      { path: 'introduces', message: 'Too big: expected array to have <=4 items' },
    ],
    'a message carrying markup': [
      { path: 'node', message: 'Unrecognized key: "</retryHint><b>"' },
    ],
  },

  /** Every branch of `applyRequestShape`. */
  shape: {
    'live turn with no node': { liveMissingNode: true, options: [], nodeKind: 'branch' },
    'question node with options': {
      nodeKind: 'question',
      options: [{ id: 'a', actionType: 'ask' }, { id: 'b', actionType: 'do' }],
    },
    'continuation with two options': {
      nodeKind: 'continuation',
      options: [{ id: 'continue', actionType: 'do' }, { id: 'x', actionType: 'ask' }],
    },
    'continuation with the wrong id': {
      nodeKind: 'continuation',
      options: [{ id: 'go-on', actionType: 'do' }],
    },
    'branch with one option': { nodeKind: 'branch', options: [{ id: 'a', actionType: 'ask' }] },
    'branch with repeated action types': {
      nodeKind: 'branch',
      options: [
        { id: 'a', actionType: 'ask' },
        { id: 'b', actionType: 'ask' },
        { id: 'c', actionType: 'do' },
      ],
    },
    'branch with nothing active': {
      nodeKind: 'branch',
      options: [
        { id: 'a', actionType: 'ask' },
        { id: 'b', actionType: 'observe' },
      ],
    },
    'duplicate option ids': {
      nodeKind: 'branch',
      options: [
        { id: 'Ask', actionType: 'ask' },
        { id: 'ask', actionType: 'do' },
      ],
    },
    'two spread issues at once (order matters)': {
      nodeKind: 'branch',
      options: [
        { id: 'a', actionType: 'ask' },
        { id: 'b', actionType: 'ask' },
      ],
    },
  },

  /** `gradeOptionSet`'s only rejecting branch. */
  grid: {
    'a dangled goal': {
      shapes: [
        { type: 'ask', targetId: 'obje-ledger' },
        { type: 'do', targetId: null },
      ],
      taken: [['ask:obje-ledger', 3]],
    },
    'a dangled goal with markup in the id': {
      shapes: [
        { type: 'move', targetId: 'plac-<wash>&house' },
        { type: 'do', targetId: null },
      ],
      taken: [['move:plac-<wash>&house', 2]],
    },
  },

  /** The three BLOCKING cross-turn codes, alone and together. */
  crossTurn: {
    'unknown entity ref': {
      input: {
        node: { kind: 'branch', beats: [], gradedPlan: null },
        options: [
          { id: 'take-it', practiceText: '', nativeText: 'Take the ledger', targetId: 'obje-nope' },
        ],
      },
      context: { canon: CANON, introduces: [], pickedSpeechAct: 'act' },
    },
    'two unknown entity refs, and the ORDER': {
      input: {
        node: { kind: 'branch', beats: [], gradedPlan: null },
        options: [
          { id: 'a', practiceText: '', nativeText: 'A', targetId: 'obje-nope' },
          { id: 'b', practiceText: '', nativeText: 'B', targetId: 'char-<who>&co' },
        ],
      },
      context: { canon: CANON, introduces: [], pickedSpeechAct: 'act' },
    },
    'question omits the lead-in': {
      input: {
        node: {
          kind: 'question',
          beats: [],
          gradedPlan: { kind: 'comprehension', npcUtterance: 'Combien ?', speakerName: 'Sophie' },
        },
        options: [],
      },
      context: { canon: CANON, introduces: [], pickedSpeechAct: 'act' },
    },
    'lead-in leaks the tested line': {
      input: {
        node: {
          kind: 'question',
          beats: [
            {
              speaker: 'npc',
              speakerName: 'Sophie',
              practiceText: 'Combien ça coûte ?',
              nativeText: 'How much?',
            },
          ],
          gradedPlan: { kind: 'comprehension', npcUtterance: 'Combien ça coûte ?', speakerName: 'Sophie' },
        },
        options: [],
      },
      context: { canon: CANON, introduces: [], pickedSpeechAct: 'act' },
    },
  },
} as const;
