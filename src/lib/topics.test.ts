import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks must be declared before the SUT import. We stand up just enough
// of Firebase to let lib/topics + lib/flashcards load without touching
// the real SDK. `runTransaction`'s update callback is the only write a
// classification may make (the card's `topic` + `topicSubject`); `addDoc`
// / `setDoc` are spied so TOPIC-SET-2 (clients never write /topics) can be
// asserted on every path.

vi.mock('./config', () => ({
  config: {
    env: 'dev',
    firebase: { apiKey: 'k', authDomain: 'a', projectId: 'p', storageBucket: 's', messagingSenderId: 'm', appId: 'app' },
    functionsUrl: 'https://us-central1-test.cloudfunctions.net',
  },
}));
vi.mock('./firebase', () => ({
  firebaseApp: {},
  auth: { currentUser: null },
  db: {},
}));
const mocks = vi.hoisted(() => ({
  txUpdate: vi.fn(),
  addDoc: vi.fn(() => Promise.resolve({ id: 'topic_new' })),
  setDoc: vi.fn(() => Promise.resolve()),
  generateGemini: vi.fn(async (_opts: unknown) => ''),
  warn: vi.fn(),
}));
const txUpdate = mocks.txUpdate;
let txExistsValue = true;
type TopicData = { name: string; description?: string; translations?: Record<string, string> };
type TopicDoc = { id: string; data: () => TopicData };
let topicDocs: TopicDoc[] = [];
type TxLike = {
  get: (ref: unknown) => Promise<{ exists: () => boolean }>;
  update: (ref: unknown, data: unknown) => void;
};
vi.mock('firebase/firestore', () => ({
  addDoc: mocks.addDoc,
  setDoc: mocks.setDoc,
  collection: () => ({}),
  deleteDoc: vi.fn(() => Promise.resolve()),
  doc: () => ({ __ref: true }),
  getDocs: () =>
    Promise.resolve({
      docs: topicDocs,
      empty: topicDocs.length === 0,
    }),
  increment: () => null,
  orderBy: () => null,
  query: () => ({}),
  runTransaction: vi.fn(async (_db: unknown, fn: (tx: TxLike) => Promise<void>) => {
    await fn({
      get: async () => ({ exists: () => txExistsValue }),
      update: mocks.txUpdate,
    });
  }),
  serverTimestamp: () => null,
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
  updateDoc: vi.fn(),
  where: () => null,
  limit: () => null,
}));
vi.mock('./gemini', () => ({
  generateGemini: mocks.generateGemini,
}));
vi.mock('./log', () => ({ warn: mocks.warn, info: vi.fn(), error: vi.fn() }));

const THEMES: TopicDoc[] = [
  { id: 't_food', data: () => ({ name: 'food', description: 'eating, drinking, cooking' }) },
  { id: 't_work', data: () => ({ name: 'work', description: 'jobs, offices, money' }) },
  { id: 't_other', data: () => ({ name: 'other', description: 'nothing else fits' }) },
  // Legacy topic: no description → not a theme.
  { id: 't_verbs', data: () => ({ name: 'verbs' }) },
  { id: 't_blank', data: () => ({ name: 'greetings', description: '   ' }) },
];

const reply = (obj: unknown) => mocks.generateGemini.mockImplementation(async () => JSON.stringify(obj));

async function classifyCard(cardId = 'card_1') {
  const { computeAndAssignTopic } = await import('./topics');
  await computeAndAssignTopic({ uid: 'u1', cardId, phrase: 'la baguette', translation: 'the baguette' });
}

beforeEach(async () => {
  txUpdate.mockClear();
  mocks.addDoc.mockClear();
  mocks.setDoc.mockClear();
  mocks.generateGemini.mockReset();
  mocks.warn.mockClear();
  txExistsValue = true;
  topicDocs = THEMES;
  reply({ subject: 'bread', topic: 'food' });
  const { _resetTopicCacheForTest } = await import('./topics');
  _resetTopicCacheForTest();
});
afterEach(async () => {
  const { _resetCancelledCards } = await import('./flashcards');
  _resetCancelledCards();
  // TOPIC-SET-2 — no path in this file may ever write /topics.
  expect(mocks.addDoc).not.toHaveBeenCalled();
  expect(mocks.setDoc).not.toHaveBeenCalled();
});

describe('computeAndAssignTopic cancellation race', () => {
  it('skips the topic write when the card was cancelled before classify resolved', async () => {
    const { _cancelCardForTest } = await import('./flashcards');
    _cancelCardForTest('card_42');
    await classifyCard('card_42');
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('still writes when the card is NOT cancelled', async () => {
    await classifyCard('card_ok');
    expect(txUpdate).toHaveBeenCalledTimes(1);
  });

  it('skips the write when the doc no longer exists (cross-tab race)', async () => {
    txExistsValue = false;
    await classifyCard('card_gone');
    expect(txUpdate).not.toHaveBeenCalled();
  });
});

describe('deleteFlashcard registers cancellation', () => {
  it('marks the card cancelled immediately so an in-flight classify is dropped', async () => {
    const { deleteFlashcard, _isCardCancelled } = await import('./flashcards');
    await deleteFlashcard({ uid: 'u1', cardId: 'card_99' });
    expect(_isCardCancelled('card_99')).toBe(true);
  });
});

describe('topic classification — closed theme set (TOPIC-SET-4..7)', () => {
  it('TOPIC-SET-7 — the promptSpec sends themes with descriptions, excluding "other" and legacy docs', async () => {
    await classifyCard();
    expect(mocks.generateGemini).toHaveBeenCalledTimes(1);
    const opts = mocks.generateGemini.mock.calls[0]![0] as {
      prompt: string;
      promptSpec: Record<string, unknown>;
      responseMimeType: string;
      temperature: number;
      category: string;
    };
    expect(opts).not.toHaveProperty('prompt');
    expect(opts.responseMimeType).toBe('application/json');
    expect(opts.temperature).toBe(0.1);
    expect(opts.category).toBe('topic_classify');
    expect(opts.promptSpec).toEqual({
      kind: 'topic_classify',
      phrase: 'la baguette',
      translation: 'the baguette',
      themes: [
        { name: 'food', description: 'eating, drinking, cooking' },
        { name: 'work', description: 'jobs, offices, money' },
      ],
    });
    expect(opts.promptSpec).not.toHaveProperty('existingTopics');
  });

  it('TOPIC-SET-7 — the promptSpec carries the card practiceLanguage when known', async () => {
    const { computeAndAssignTopic, classifyFlashCardTopic } = await import('./topics');
    await computeAndAssignTopic({
      uid: 'u1',
      cardId: 'card_pain',
      phrase: 'Pain',
      translation: 'bread',
      practiceLanguage: 'French',
    });
    const spec = (mocks.generateGemini.mock.calls[0]![0] as { promptSpec: Record<string, unknown> }).promptSpec;
    expect(spec.practiceLanguage).toBe('French');
    // Unknown language → the field is omitted, never ''.
    await classifyFlashCardTopic('Pain', 'bread', '');
    const spec2 = (mocks.generateGemini.mock.calls[1]![0] as { promptSpec: Record<string, unknown> }).promptSpec;
    expect(spec2).not.toHaveProperty('practiceLanguage');
  });

  it('TOPIC-SET-5 — a valid response stamps topic + topicSubject', async () => {
    await classifyCard();
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(txUpdate.mock.calls[0]![1]).toEqual({ topic: 'food', topicSubject: 'bread' });
  });

  it('TOPIC-SET-5 — "other" is a valid pick and is stamped', async () => {
    reply({ subject: 'parliament', topic: 'other' });
    await classifyCard();
    expect(txUpdate.mock.calls[0]![1]).toEqual({ topic: 'other', topicSubject: 'parliament' });
  });

  it('TOPIC-SET-5 — classifyFlashCardTopic returns { topic, subject }', async () => {
    reply({ subject: 'meeting', topic: 'work' });
    const { classifyFlashCardTopic } = await import('./topics');
    await expect(classifyFlashCardTopic('la réunion', 'the meeting')).resolves.toEqual({
      topic: 'work',
      subject: 'meeting',
    });
  });

  it('TOPIC-SET-6 — a Gemini failure writes nothing and returns null (no "general" fallback)', async () => {
    mocks.generateGemini.mockImplementation(async () => {
      throw new Error('simulated network outage');
    });
    await classifyCard();
    expect(txUpdate).not.toHaveBeenCalled();
    const { classifyFlashCardTopic } = await import('./topics');
    await expect(classifyFlashCardTopic('a', 'b')).resolves.toBeNull();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it('TOPIC-SET-6 — unparseable output writes nothing and returns null', async () => {
    mocks.generateGemini.mockImplementation(async () => 'not json {');
    await classifyCard();
    expect(txUpdate).not.toHaveBeenCalled();
    const { classifyFlashCardTopic } = await import('./topics');
    await expect(classifyFlashCardTopic('a', 'b')).resolves.toBeNull();
  });

  it('TOPIC-SET-6 — a topic outside themes ∪ {"other"} writes nothing and returns null', async () => {
    for (const bad of ['religion', 'verbs', 'general', '__NEW_TOPIC__', '']) {
      reply({ subject: 'x', topic: bad });
      await classifyCard();
      const { classifyFlashCardTopic } = await import('./topics');
      await expect(classifyFlashCardTopic('a', 'b')).resolves.toBeNull();
    }
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it('TOPIC-SET-6 — an empty live theme set skips the call, writes nothing and returns null', async () => {
    topicDocs = [{ id: 't_verbs', data: () => ({ name: 'verbs' }) }];
    await classifyCard();
    expect(mocks.generateGemini).not.toHaveBeenCalled();
    expect(txUpdate).not.toHaveBeenCalled();
    const { classifyFlashCardTopic } = await import('./topics');
    await expect(classifyFlashCardTopic('a', 'b')).resolves.toBeNull();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it('TOPIC-SET-1 — getThemes returns only docs with a non-empty description', async () => {
    const { getThemes } = await import('./topics');
    const themes = await getThemes();
    expect(themes.map((t) => t.name)).toEqual(['food', 'work', 'other']);
  });

  it('TOPIC-SET-2 — the module no longer exports getOrCreateTopic', async () => {
    const mod = (await import('./topics')) as Record<string, unknown>;
    expect(mod.getOrCreateTopic).toBeUndefined();
  });
});
