import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above any `import` statement at module
// load time, so any closure they reference must be declared via
// `vi.hoisted` to land in the same hoisted block. The mock observes
// the actual `updateDoc` payload (counters + SM-2 fields) so the SRS
// write contract (PRACTICE-SRS-1..5) can be asserted from the call
// args without a real Firestore.
const mocks = vi.hoisted(() => ({
  updateDoc: vi.fn(async () => {}),
  addDoc: vi.fn(async (..._a: unknown[]) => ({ id: 'card_new' })),
  getDocs: vi.fn(async () => ({ empty: true, docs: [] })),
}));

vi.mock('firebase/firestore', async (orig) => {
  const actual = await orig<typeof import('firebase/firestore')>();
  return {
    ...actual,
    updateDoc: mocks.updateDoc,
    addDoc: mocks.addDoc,
    getDocs: mocks.getDocs,
    collection: (...args: unknown[]) => ({ __col: args }),
    query: (...args: unknown[]) => ({ __query: args }),
    where: (...args: unknown[]) => ({ __where: args }),
    limit: (n: number) => ({ __limit: n }),
    doc: (...args: unknown[]) => ({ __doc: args }),
    serverTimestamp: () => '__server_ts__',
    increment: (n: number) => ({ __inc: n }),
  };
});

vi.mock('./firebase', () => ({ db: { __db: true } }));
vi.mock('./topics', () => ({ computeAndAssignTopic: vi.fn() }));
vi.mock('./log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import {
  addFlashCard,
  computeNext,
  recordAttempt,
  updateFlashcardDetails,
  type ReviewQuality,
} from './flashcards';

const updateDocMock = mocks.updateDoc;

/** Pull the {payload} arg from the Nth call (default first). The mock
 *  factory's narrow inferred signature loses the payload's positional
 *  type, so we extract through `unknown` once and type-assert at the
 *  callsite. */
function payloadOfCall(n = 0): Record<string, unknown> {
  const calls = updateDocMock.mock.calls as unknown as Array<
    [unknown, Record<string, unknown>]
  >;
  const call = calls[n];
  if (!call) throw new Error(`no call at index ${n}`);
  return call[1];
}

describe('flashcards SM-2', () => {
  const fresh = { interval: 1, ease: 2.5, reps: 0, lapses: 0 };

  it('again resets interval and increments lapses', () => {
    const next = computeNext(fresh, 'again');
    expect(next.interval).toBe(1);
    expect(next.lapses).toBe(1);
    expect(next.reps).toBe(0);
    expect(next.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('good increments interval by ease', () => {
    const next = computeNext(fresh, 'good');
    expect(next.interval).toBe(Math.round(1 * 2.5));
    expect(next.reps).toBe(1);
    expect(next.ease).toBeCloseTo(2.5);
  });

  it('easy increases ease and interval more aggressively', () => {
    const next = computeNext(fresh, 'easy');
    expect(next.ease).toBeCloseTo(2.65);
    // 1 * 2.5 * 1.3 = 3.25 -> rounds to 3.
    expect(next.interval).toBeGreaterThanOrEqual(3);
    // Compared to 'good', easy should always be >= the good interval.
    const good = computeNext(fresh, 'good');
    expect(next.interval).toBeGreaterThanOrEqual(good.interval);
  });

  it('hard reduces ease but keeps streak', () => {
    const next = computeNext({ ...fresh, reps: 3 }, 'hard');
    expect(next.ease).toBeCloseTo(2.35);
    expect(next.reps).toBe(4);
    expect(next.lapses).toBe(0);
  });

  it('floor on ease is 1.3', () => {
    const next = computeNext({ ...fresh, ease: 1.3 }, 'again');
    expect(next.ease).toBeGreaterThanOrEqual(1.3);
  });

  /**
   * SRS regression fixture. Phase-9 migration plan asked for byte-level
   * parity with the source SM-2 numbers. The expected `interval` values
   * below were computed by hand against the algorithm in `computeNext`
   * (simplified SM-2: again=1, hard=*1.2, good=*ease, easy=*ease*1.3
   * with ease floor 1.3). Each step feeds its result into the next so
   * we catch any cumulative drift.
   */
  it('regression fixture: a full 7-step review sequence stays stable', () => {
    const sequence: Array<{
      quality: ReviewQuality;
      interval: number;
      reps: number;
      lapses: number;
      ease: number;
    }> = [
      // Step 1: fresh good → interval ceil-rounded 1*2.5 = 3, reps 1
      { quality: 'good', interval: 3, reps: 1, lapses: 0, ease: 2.5 },
      // Step 2: another good → 3*2.5 = 7.5 → 8
      { quality: 'good', interval: 8, reps: 2, lapses: 0, ease: 2.5 },
      // Step 3: easy → 8*2.5*1.3 = 26, ease 2.65
      { quality: 'easy', interval: 26, reps: 3, lapses: 0, ease: 2.65 },
      // Step 4: hard → 26*1.2 = 31.2 → 31, ease 2.5
      { quality: 'hard', interval: 31, reps: 4, lapses: 0, ease: 2.5 },
      // Step 5: again → interval back to 1, ease 2.3, lapses 1
      { quality: 'again', interval: 1, reps: 0, lapses: 1, ease: 2.3 },
      // Step 6: good → 1*2.3 = 2 (rounded), reps 1
      { quality: 'good', interval: 2, reps: 1, lapses: 1, ease: 2.3 },
      // Step 7: easy → 2*2.3*1.3 = 5.98 → 6, ease 2.45
      { quality: 'easy', interval: 6, reps: 2, lapses: 1, ease: 2.45 },
    ];

    let state = { interval: 1, ease: 2.5, reps: 0, lapses: 0 };
    for (let i = 0; i < sequence.length; i += 1) {
      const step = sequence[i]!;
      const next = computeNext(state, step.quality);
      expect(next.interval, `step ${i} interval`).toBe(step.interval);
      expect(next.reps, `step ${i} reps`).toBe(step.reps);
      expect(next.lapses, `step ${i} lapses`).toBe(step.lapses);
      expect(next.ease, `step ${i} ease`).toBeCloseTo(step.ease);
      state = {
        interval: next.interval,
        ease: next.ease,
        reps: next.reps,
        lapses: next.lapses,
      };
    }
  });

  it('regression fixture: nextReviewAt is interval days ahead in ms', () => {
    const before = Date.now();
    const next = computeNext({ interval: 1, ease: 2.5, reps: 0, lapses: 0 }, 'good');
    const after = Date.now();
    const lower = before + 3 * 24 * 60 * 60 * 1000;
    const upper = after + 3 * 24 * 60 * 60 * 1000;
    expect(next.nextReviewAt.toMillis()).toBeGreaterThanOrEqual(lower);
    expect(next.nextReviewAt.toMillis()).toBeLessThanOrEqual(upper);
  });
});

describe('recordAttempt — SRS write contract', () => {
  beforeEach(() => updateDocMock.mockReset());

  // PRACTICE-SRS-1: writes both counter + SM-2 fields in ONE updateDoc.
  it('PRACTICE-SRS-1 — single updateDoc carries both counters and SM-2 fields', async () => {
    await recordAttempt({
      uid: 'u1',
      cardId: 'c1',
      correct: true,
      card: { interval: 1, ease: 2.5, reps: 0, lapses: 0 },
    });
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const payload = payloadOfCall();
    // Counter present
    expect(payload.correctCount).toEqual({ __inc: 1 });
    // SM-2 fields present
    expect(payload).toHaveProperty('interval');
    expect(payload).toHaveProperty('ease');
    expect(payload).toHaveProperty('reps');
    expect(payload).toHaveProperty('lapses');
    expect(payload).toHaveProperty('nextReviewAt');
    expect(payload.lastReviewedAt).toBe('__server_ts__');
  });

  // PRACTICE-SRS-2 grade mapping: correct first encounter → 'good'.
  it('PRACTICE-SRS-2 — correct + first encounter maps to good (interval 3 for fresh card)', async () => {
    await recordAttempt({
      uid: 'u1',
      cardId: 'c1',
      correct: true,
      card: { interval: 1, ease: 2.5, reps: 0, lapses: 0 },
    });
    const payload = payloadOfCall();
    // 'good' → interval = 1 * 2.5 = 3 (rounded)
    expect(payload.interval).toBe(3);
    expect(payload.reps).toBe(1);
  });

  // PRACTICE-SRS-2 grade mapping: correct + review-mistakes → 'hard'.
  it('PRACTICE-SRS-2 — correct + reviewMode maps to hard (interval *1.2 from current)', async () => {
    await recordAttempt({
      uid: 'u1',
      cardId: 'c1',
      correct: true,
      reviewMode: true,
      card: { interval: 10, ease: 2.5, reps: 3, lapses: 0 },
    });
    const payload = payloadOfCall();
    // 'hard' → 10 * 1.2 = 12
    expect(payload.interval).toBe(12);
    expect(payload.ease).toBeCloseTo(2.35);
  });

  // PRACTICE-SRS-2 grade mapping: wrong → 'again'.
  it('PRACTICE-SRS-2 — incorrect maps to again (interval resets to 1, lapses +1)', async () => {
    await recordAttempt({
      uid: 'u1',
      cardId: 'c1',
      correct: false,
      card: { interval: 10, ease: 2.5, reps: 3, lapses: 0 },
    });
    const payload = payloadOfCall();
    expect(payload.interval).toBe(1);
    expect(payload.lapses).toBe(1);
    expect(payload.reps).toBe(0);
    expect(payload.incorrectCount).toEqual({ __inc: 1 });
  });

  // PRACTICE-SRS-2 grade mapping: nearMiss → 'hard' (despite correct=true).
  it('PRACTICE-SRS-2 — nearMiss flag maps to hard even when correct=true', async () => {
    await recordAttempt({
      uid: 'u1',
      cardId: 'c1',
      correct: true,
      nearMiss: true,
      card: { interval: 10, ease: 2.5, reps: 3, lapses: 0 },
    });
    const payload = payloadOfCall();
    // hard: 10 * 1.2 = 12
    expect(payload.interval).toBe(12);
    // correctCount still bumps (nearMiss is logically a pass)
    expect(payload.correctCount).toEqual({ __inc: 1 });
  });

  // PRACTICE-SRS-3: nextReviewAt is a Timestamp with toMillis ≈ now + interval days.
  it('PRACTICE-SRS-3 — nextReviewAt = now + intervalDays * 24h', async () => {
    const before = Date.now();
    await recordAttempt({
      uid: 'u1',
      cardId: 'c1',
      correct: true,
      card: { interval: 1, ease: 2.5, reps: 0, lapses: 0 },
    });
    const after = Date.now();
    const payload = payloadOfCall();
    const nextAt = payload.nextReviewAt as { toMillis(): number };
    expect(nextAt.toMillis()).toBeGreaterThanOrEqual(before + 3 * 24 * 60 * 60 * 1000);
    expect(nextAt.toMillis()).toBeLessThanOrEqual(after + 3 * 24 * 60 * 60 * 1000);
  });

  // PRACTICE-SRS-4: card defaults treated as fresh (no card prop OR null fields).
  it('PRACTICE-SRS-4 — missing card prop treated as fresh defaults', async () => {
    await recordAttempt({ uid: 'u1', cardId: 'c1', correct: true });
    const payload = payloadOfCall();
    // Fresh + 'good' → interval 3
    expect(payload.interval).toBe(3);
    expect(payload.reps).toBe(1);
  });
});

// `ReviewQuality` import is kept for documentation symmetry with the
// grade-mapping table in docs/specs/practice-mode.md §12.1.
void ([] as ReviewQuality[]);

describe('card editor save — topic + topicSubject pass-through (CARDS-LIST-8, TOPIC-SET-5)', () => {
  beforeEach(() => {
    mocks.addDoc.mockClear();
    updateDocMock.mockClear();
  });

  const addPayload = () => mocks.addDoc.mock.calls[0]![1] as Record<string, unknown>;

  it('TOPIC-SET-5 — addFlashCard with a pre-classified topic stamps topic + topicSubject', async () => {
    await addFlashCard('u1', {
      phrase: 'le pain',
      translation: 'the bread',
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      topic: 'food',
      topicSubject: 'bread',
    });
    expect(addPayload()).toEqual(expect.objectContaining({ topic: 'food', topicSubject: 'bread' }));
  });

  it('TOPIC-SET-7 — addFlashCard with no topic classifies async with the card practiceLanguage', async () => {
    const { computeAndAssignTopic } = await import('./topics');
    const spy = vi.mocked(computeAndAssignTopic);
    spy.mockClear();
    await addFlashCard('u1', {
      phrase: 'Pain',
      translation: 'bread',
      practiceLanguage: 'French',
      nativeLanguage: 'English',
    });
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ cardId: 'card_new', phrase: 'Pain', practiceLanguage: 'French' }),
    );
  });

  it('TOPIC-SET-6 — addFlashCard with no topic writes no topicSubject', async () => {
    await addFlashCard('u1', {
      phrase: 'le pain',
      translation: 'the bread',
      practiceLanguage: 'French',
      nativeLanguage: 'English',
    });
    expect(addPayload().topic).toBe('');
    expect(addPayload()).not.toHaveProperty('topicSubject');
  });

  it('TOPIC-SET-5 — updateFlashcardDetails writes topicSubject when given', async () => {
    await updateFlashcardDetails({
      uid: 'u1',
      cardId: 'c1',
      phrase: 'le pain',
      translation: 'the bread',
      topic: 'food',
      topicSubject: 'bread',
    });
    expect(payloadOfCall()).toEqual(expect.objectContaining({ topic: 'food', topicSubject: 'bread' }));
  });
});
