import { describe, expect, it } from 'vitest';
import { buildLifeStepSpec } from './stepSpec';
import type { LifeEvent, LifeNpc, LifeWorld } from '@/types/firestore';

/**
 * SRV-PROMPT-8..13 batch 8 — what the CLIENT is responsible for now that it
 * holds no prompt text.
 *
 * The bytes the spec renders to are pinned server-side
 * (`functions/src/__tests__/stepGoldenParity.test.ts`, against a capture of
 * this client's own former output). What is asserted here is the NARROWING:
 * which of the four documents' fields cross, which stay, and — the three that
 * matter most — that the values which arrive RESOLVED are resolved by the real
 * functions rather than forwarded raw.
 *
 * ⚠ EVERY ASSERTION BELOW EXISTS BECAUSE A MUTATION SURVIVED WITHOUT IT. The
 * step prompt's tests all moved server-side, so before this file the client's
 * half of the contract was unguarded: sending the STORED canon instead of the
 * resolved one, sending `saga.days` instead of `daysLeft`, and sending the
 * retry verdict on attempt 0 all passed the whole suite.
 */

const world = (over: Partial<LifeWorld> = {}): LifeWorld =>
  ({
    id: 'w1',
    characterName: 'Marc',
    practiceLanguage: 'French',
    nativeLanguage: 'English',
    difficulty: 3,
    worldSeedKey: 'city_life',
    rollingSummary: '',
    ...over,
  }) as unknown as LifeWorld;

const npc = (id: string, name: string, over: Partial<LifeNpc> = {}): LifeNpc =>
  ({ id, name, avatarStatus: 'ready', scope: 'world', ...over }) as unknown as LifeNpc;

const TURN = {
  isOpeningBeat: false,
  requestKind: 'live',
} as const;

const build = (over: {
  world?: LifeWorld;
  events?: LifeEvent[];
  npcs?: LifeNpc[];
  retry?: Parameters<typeof buildLifeStepSpec>[0]['retry'];
} = {}) =>
  buildLifeStepSpec({
    world: over.world ?? world(),
    events: over.events ?? [],
    npcs: over.npcs ?? [],
    scene: null,
    turn: { ...TURN },
    ...(over.retry ? { retry: over.retry } : {}),
  });

describe('SRV-PROMPT-8..13 — the three values that travel RESOLVED', () => {
  it('SRV-PROMPT-12 — `canon` is `resolveCanon(world, npcs)`, not the stored ledger', () => {
    // ⚠ A SURVIVING MUTATION. Sending `world.canon` changed no unit test,
    // because every fixture in the golden happened to carry a canon that
    // already listed its roster. `resolveCanon` APPENDS the live roster and the
    // current location, and it stays client-side because
    // `validateNodeResponse` checks the model's `targetId`s against the same
    // answer — so a spec built from the stored ledger would have the prompt and
    // the validator disagreeing about what exists.
    const spec = build({
      world: world({
        canon: { characters: [], places: [], objects: [], facts: [] },
        currentLocationLabel: 'The wash-house',
      } as Partial<LifeWorld>),
      npcs: [npc('n-sophie', 'Sophie', { relationship: 'the baker' })],
    });
    expect(spec.canon?.characters.map((c) => c.id)).toEqual(['n-sophie']);
    expect(spec.canon?.characters[0]?.note).toBe('the baker');
    // ...and the LOCATION is in the ledger too, under the slug `canonSlug`
    // mints, which is what an option's `targetId` will name.
    expect(spec.canon?.places.map((p) => p.id)).toEqual(['plac-the-wash-house']);
  });

  it('LIFE-GOAL-6 — `saga.daysLeft` is the DIFFERENCE, not the stored day count', () => {
    // ⚠ A SURVIVING MUTATION. `saga.days` is 12 and `dayIndex` is 4, so
    // forwarding the raw count renders `daysLeft="12"` where the player's own
    // chrome says 8 — a model that cannot see what the player sees will
    // contradict it, which is the whole reason the block carries the number.
    const spec = build({
      world: world({
        goalLadder: {
          saga: { text: 'keep the room', when: 'the end of the month', days: 12 },
          objective: null,
          done: [],
          dayIndex: 4,
        },
      } as Partial<LifeWorld>),
    });
    expect(spec.goalLadder?.saga?.daysLeft).toBe(8);
  });

  it('LIFE-NEED-5 — `blocked` is `exposureReason` over the world FACTS, not a flag', () => {
    // The facts themselves do not travel: `worldFactsFor` reduces the whole
    // world and the whole roster to answer one question, and its answer is one
    // string. Driven through the REAL function, so a need that is MET produces
    // nothing and one that is not produces the sentence the block renders.
    const ladder = (name: string) =>
      ({
        saga: { text: 'hang work in the show', when: 'Friday', days: 12 },
        objective: { id: 'o1', text: 'get the good wall', need: { kind: 'who', name } },
        done: [],
        dayIndex: 0,
      }) as unknown as LifeWorld['goalLadder'];

    const blocked = build({
      world: world({ goalLadder: ladder('Hélène') } as Partial<LifeWorld>),
      npcs: [npc('n-h', 'Hélène', { standing: 0 })],
    });
    expect(blocked.goalLadder?.blocked).toBe('Hélène has no reason to do this for you yet');

    const met = build({
      world: world({ goalLadder: ladder('Hélène') } as Partial<LifeWorld>),
      npcs: [npc('n-h', 'Hélène', { standing: 2 })],
    });
    expect(met.goalLadder?.blocked).toBeUndefined();
  });
});

describe('SRV-PROMPT-12 — the retry verdict is attempt-scoped', () => {
  it('SRV-PROMPT-12 — an EMPTY verdict does not put a `retry` key on the wire', () => {
    // ⚠ A SURVIVING MUTATION: sending `retry: []` on attempt 0 rendered nothing
    // (the server drops an empty list), so no assertion moved — but it puts a
    // field on the wire that means "the model already failed" on the call where
    // it has not. A field that travels is a field someone later renders.
    expect('retry' in build()).toBe(false);
    expect('retry' in build({ retry: [] })).toBe(false);
  });

  it('SRV-PROMPT-12 — a real verdict travels in ORDER, as codes', () => {
    const spec = build({
      retry: [{ code: 'question-omits-lead-in' }, { code: 'lead-in-leaks-tested-line' }],
    });
    expect(spec.retry).toEqual([
      { code: 'question-omits-lead-in' },
      { code: 'lead-in-leaks-tested-line' },
    ]);
  });
});

describe('SRV-PROMPT-8..13 — what does NOT cross', () => {
  it('LIFE-FRONT-1.1 — a front’s CLOCK never reaches the wire', () => {
    // The prompt has never seen a clock, on measured evidence. A top-level
    // spread of the stored `Front` would have carried `clock.consequence` —
    // the batch-6 finding, one document over.
    const spec = build({
      world: world({
        fronts: [
          {
            id: 'f1',
            name: 'F',
            driverId: 'p1',
            agenda: 'Buying the lease.',
            kind: 'obligation',
            scope: 'saga',
            resolved: null,
            clock: { filled: 3, size: 8, consequence: 'THE_CLOCK_MARKER', peak: 3, unattended: 0 },
          },
        ],
      } as Partial<LifeWorld>),
    });
    expect(JSON.stringify(spec)).not.toContain('THE_CLOCK_MARKER');
    expect(spec.story?.fronts?.[0]).toEqual({
      driverId: 'p1',
      agenda: 'Buying the lease.',
      resolved: null,
    });
  });

  it('LIFE-CAST-3 — a cast member crosses as the eight fields the block renders', () => {
    const spec = build({
      world: world({
        cast: [
          {
            id: 'p1',
            name: 'Bebert',
            tier: 'principal',
            voice: 'dry',
            standing: 1,
            known: 'Runs the lock.',
            wants: 'The roster changed.',
            nextMove: 'Corner the clerk.',
            limit: 'Nothing in writing.',
            ties: [{ id: 'r1', how: 'owes them coal' }],
            wrongAbout: { aboutId: 'r1', believes: 'WRONG_ABOUT_MARKER' },
          },
        ],
      } as Partial<LifeWorld>),
    });
    expect(JSON.stringify(spec)).not.toContain('WRONG_ABOUT_MARKER');
    expect(Object.keys(spec.story?.cast?.[0] ?? {}).sort()).toEqual(
      ['id', 'known', 'limit', 'name', 'nextMove', 'standing', 'tier', 'ties', 'voice', 'wants'].sort(),
    );
  });

  it('LIFE-VOCAB-RECAP-7 — the outcome’s native gloss is NOT sent to the model', () => {
    // `correctAnswerNative` feeds the day summary's save button and has never
    // been part of this prompt. The narrower `PracticeOutcomeForPrompt` type is
    // what made that true; `generateStepOptions` now narrows it explicitly.
    const spec = buildLifeStepSpec({
      world: world(),
      events: [],
      npcs: [],
      scene: null,
      turn: {
        ...TURN,
        practiceOutcome: {
          kind: 'generation',
          correct: true,
          picked: 'veux',
          correctAnswer: 'veux',
          promptSource: 'Je ___ un café.',
        },
      },
    });
    expect(spec.practiceOutcome && 'correctAnswerNative' in spec.practiceOutcome).toBe(false);
  });
});

describe('SRV-PROMPT-8..13 — the one SHAPE change in the payload', () => {
  it('LIFE-EX-PLAN-3 — each event carries `createdAtMs`, not a Firestore Timestamp', () => {
    const spec = build({
      events: [
        {
          id: 'e1',
          kind: 'correction',
          payload: { kind: 'generation', correctAnswer: 'veux' },
          createdAt: { toMillis: () => 1_700 },
        } as unknown as LifeEvent,
        { id: 'e2', kind: 'beat', payload: { practiceText: 'x' } } as unknown as LifeEvent,
      ],
    });
    expect(spec.events?.[0]?.createdAtMs).toBe(1_700);
    // Absent is MEANINGFUL and means "undated" — such a row is never filtered
    // out by the chapter-start comparison, exactly as the client's own
    // `ts === null` branch had it.
    expect(spec.events?.[1]?.createdAtMs).toBeNull();
    expect(JSON.stringify(spec)).not.toContain('toMillis');
  });

  it('LIFE-CTX-2 — the events cross in order and are not sliced client-side', () => {
    // The render window is the SERVER's (`STEP_EVENT_WINDOW`), and the
    // derivations read more than it renders — `takenShapeCounts` is deliberately
    // UNWINDOWED. Slicing here would silently narrow both.
    const events = Array.from({ length: 30 }, (_, i) =>
      ({ id: `e${i}`, kind: 'beat', payload: { practiceText: `b${i}` } }) as unknown as LifeEvent,
    );
    expect(build({ events }).events).toHaveLength(30);
    expect(build({ events }).events?.[0]?.payload?.practiceText).toBe('b0');
  });
});
