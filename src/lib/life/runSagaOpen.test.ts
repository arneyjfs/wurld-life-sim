import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({ generateGemini: vi.fn() }));
vi.mock('./debugLog', () => ({ lifeDebug: vi.fn(), lifeFailed: vi.fn() }));

import { generateGemini } from '../gemini';
import { runSagaOpen } from './runSagaOpen';
import type { LifeWorld } from '@/types/firestore';
import type { CastMember } from '@/types/lifeState';

const generateGeminiMock = generateGemini as unknown as ReturnType<typeof vi.fn>;

/**
 * SRV-PROMPT-8..13 batch 5 — `life_saga` sends a SPEC and no prose.
 *
 * The world OPEN is batch 5 because it fires once per world and there is NO
 * FALLBACK SAGA (`runSagaOpen`'s own header says why: a world with an invented
 * front and no cast plays badly for its whole life, silently). So a rejected
 * spec is a dead world-open, which is worse than everything batches 1-4 moved —
 * hence the shape of the assertions below, which are mostly about what does NOT
 * travel.
 *
 * ⚠ THE SCHEMA IS THE POINT (SRV-PROMPT-1). `sagaOpenResponseSchema` forked on a
 * flag this call site computed, so the half that constrains the ANSWER lived in
 * the bundle beside the half that constrains the question. Both moved, and the
 * flag moved with them: the spec carries no `succession` and no `realistic`,
 * because each is derivable from a field that has to travel anyway (`universe`,
 * `worldMode`) and two copies of one fact can be made to disagree.
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
  }) as LifeWorld;

const OK_JSON = JSON.stringify({
  universe: { setting: 'A canal town', era: 'now', laws: [], places: [], figures: [] },
  title: 'Le 14 rue Cendrillon',
  titleNative: '14 Cendrillon Street',
  playerFacingTeaser: 'The room came cheap.',
  tone: 'wry',
  situation: 'You have a room over the lock.',
  goal: { text: 'get the roster changed', when: 'Friday', days: 12 },
  firstObjective: 'get Bébert to look at the book',
  principals: [
    {
      id: 'p1',
      name: 'Bébert',
      known: 'Runs the roster office.',
      voice: 'clipped',
      gender: 'male',
      standing: 0,
      wants: 'The roster changed.',
      nextMove: 'Corners the clerk on Thursday.',
      limit: 'Nothing in writing.',
      wrongAbout: { aboutId: 'r1', believes: 'she never read the letter' },
    },
  ],
  regulars: [
    { id: 'r1', name: 'Sophie', known: 'Opens at six.', voice: 'warm', gender: 'female', standing: 0, routine: 'Opens at six.' },
  ],
  front: {
    id: 'the-lease',
    name: 'The lease',
    driverId: 'p1',
    agenda: 'The lease is being bought out from under the yard.',
    kind: 'obligation',
    clock: { size: 8, consequence: 'the yard changes hands' },
  },
});

/** The single `generateGemini` request the runner made. */
const sentRequest = (): Record<string, unknown> =>
  generateGeminiMock.mock.calls[0]![0] as Record<string, unknown>;

beforeEach(() => {
  generateGeminiMock.mockReset();
  generateGeminiMock.mockResolvedValue(OK_JSON);
});

describe('runSagaOpen — SRV-PROMPT-8..13: a spec, not prose', () => {
  it('SRV-PROMPT-8..13 — sends NO prompt and no systemInstruction or schema', async () => {
    await runSagaOpen({ world: world() });
    const req = sentRequest();
    // No `prompt` at all (the `prompt: ''` placeholder was dropped 2026-09-29):
    // the endpoint's "Missing prompt" guard is skipped only when the resolver
    // returns `built`, so a resolver that stopped recognising this kind would
    // 400 in production with the unit suite still green.
    expect(req).not.toHaveProperty('prompt');
    expect(req.systemInstruction).toBeUndefined();
    // SRV-PROMPT-1 — the schema is DERIVED from the spec server-side. Sending
    // one would leave the half that constrains the ANSWER in the bundle, which
    // is the specific hole this batch closes.
    expect(req.responseSchema).toBeUndefined();
  });

  it('SRV-PROMPT-5 — the generation parameters stay at the call site', async () => {
    await runSagaOpen({ world: world() });
    const req = sentRequest();
    expect(req.category).toBe('life_saga');
    expect(req.thinkingLevel).toBe('minimal');
    expect(req.responseMimeType).toBe('application/json');
    // MSG-PIPE-23 — every call names its temperature out loud.
    expect(typeof req.temperature).toBe('number');
    expect(typeof req.model).toBe('string');
  });

  it('SRV-PROMPT-8..13 — the spec carries the fields the prompt reads, under the right kind', async () => {
    await runSagaOpen({
      world: world({
        id: 'w-abc123',
        worldSeedKey: 'manual',
        worldSeedText: 'a canal town',
        worldMode: 'realistic',
        systemLanguage: 'English (British)',
      }),
    });
    const spec = sentRequest().promptSpec as Record<string, unknown>;
    expect(spec.kind).toBe('life_saga');
    expect(spec.worldId).toBe('w-abc123');
    expect(spec.characterName).toBe('Marc');
    expect(spec.practiceLanguage).toBe('French');
    expect(spec.nativeLanguage).toBe('English');
    expect(spec.systemLanguage).toBe('English (British)');
    expect(spec.worldSeedKey).toBe('manual');
    expect(spec.worldSeedText).toBe('a canal town');
    expect(spec.worldMode).toBe('realistic');
  });

  it('LIFE-LANG-8 — systemLanguage is RESOLVED here, not twice', async () => {
    // `systemLanguage ?? nativeLanguage` used to be applied at this call site for
    // the SI while the `<character>` tag read `nativeLanguage` directly. One rule
    // in two places is how they come to disagree, so the fallback runs once and
    // the resolved value travels (the `life_resume_recap` precedent).
    await runSagaOpen({ world: world({ systemLanguage: undefined }) });
    const spec = sentRequest().promptSpec as Record<string, unknown>;
    expect(spec.systemLanguage).toBe('English');
    expect(spec.nativeLanguage).toBe('English');
  });

  it('SRV-PROMPT-8..13 — the spec is NOT a LifeWorld: fields the prompt never reads do not travel', async () => {
    await runSagaOpen({
      world: world({
        situation: 'You have a room over the lock.',
        canon: { characters: [], places: [], objects: [], facts: [] },
        storyLog: { chapterNumber: 2, entries: ['a line'] },
        saga: { title: 'The Book' },
        currentArc: { chapterNumber: 2, premise: 'live', playerTeaser: 'teaser' },
        sagaHistory: ['scene one'],
        universe: { setting: 'leaked', era: 'now', laws: [], places: [], figures: [] },
      } as unknown as Partial<LifeWorld>),
    });
    const spec = sentRequest().promptSpec as Record<string, unknown>;
    for (const k of [
      'situation',
      'canon',
      'storyLog',
      'saga',
      'currentArc',
      'sagaHistory',
      'difficulty',
      'rollingSummary',
      'id',
      'world',
    ]) {
      expect(spec, `${k} must not travel`).not.toHaveProperty(k);
    }
    // ⚠ `world.universe` in particular. SUCCESSION is the CALLER's argument
    // (LIFE-ARCH-6), not a field read off the world doc — the world being opened
    // is the one that has none yet. Reading it off the doc would make every
    // RE-open of an existing world a succession by accident, which is the fork
    // that also picks the response schema.
    expect(spec).not.toHaveProperty('universe');
  });

  it('SRV-PROMPT-1 — the succession fork travels as the PAYLOAD, never as a flag', async () => {
    await runSagaOpen({ world: world() });
    const fresh = sentRequest().promptSpec as Record<string, unknown>;
    // No `succession`, and no `realistic`: each is derived server-side from a
    // field that has to travel anyway. A second copy of one fact is a second
    // thing that can be wrong, and both of these decide what the model is
    // allowed to write.
    expect(fresh).not.toHaveProperty('succession');
    expect(fresh).not.toHaveProperty('realistic');
  });

  it('LIFE-ARCH-6 — a SUCCESSION sends the universe, the cast and the history', async () => {
    const survivor: CastMember = {
      id: 'p1',
      name: 'Bébert',
      tier: 'principal',
      known: 'Runs the roster office.',
      voice: 'clipped',
      standing: 2,
      wants: 'The roster changed.',
      ties: [{ id: 'r1', how: 'owes them coal' }],
    } as unknown as CastMember;
    await runSagaOpen({
      world: world(),
      universe: {
        setting: 'A canal town',
        era: 'now',
        laws: ['No barge moves without a slip.'],
        places: ['The wash-house'],
        figures: [{ name: 'Bebert', what: 'Keeps the book.' }],
      } as never,
      survivingCast: [survivor],
      priorSagaHistory: ['The lease changed hands.'],
    });
    const spec = sentRequest().promptSpec as Record<string, unknown>;
    expect(spec.universe).toEqual({
      setting: 'A canal town',
      era: 'now',
      laws: ['No barge moves without a slip.'],
      places: ['The wash-house'],
    });
    // `figures` is on the world's `Universe` and this prompt has never rendered
    // it. A field on the wire that reaches nothing is a field someone later
    // wires INTO something.
    expect(spec.universe).not.toHaveProperty('figures');
    // The cast is narrowed to the four fields `<person>` renders. `voice`,
    // `standing`, `wants` and `ties` are not among them.
    expect(spec.survivingCast).toEqual([
      { id: 'p1', name: 'Bébert', tier: 'principal', known: 'Runs the roster office.' },
    ]);
    expect(spec.priorSagaHistory).toEqual(['The lease changed hands.']);
  });

  it('SRV-PROMPT-8..13 — omits the succession fields rather than sending null', async () => {
    // The server REJECTS a null universe instead of reading it as absent (the
    // batch-2 `role` precedent): `runSagaOpen` holds `universe ?? null`
    // internally, so this builder is the one place that turns "there is none"
    // into an omission, and a null arriving means that stopped happening.
    await runSagaOpen({ world: world(), universe: null });
    const spec = sentRequest().promptSpec as Record<string, unknown>;
    for (const k of ['universe', 'survivingCast', 'priorSagaHistory', 'worldSeedText', 'worldMode']) {
      expect(spec, `${k} must be absent, not null or undefined`).not.toHaveProperty(k);
    }
  });

  it('SRV-PROMPT-8..13 — an empty surviving cast or history does not travel either', async () => {
    // `buildSagaOpenPrompt` renders neither block for an empty array, so sending
    // one is a field that reaches nothing. Omitting it keeps the wire shape and
    // the rendered shape in agreement.
    await runSagaOpen({ world: world(), survivingCast: [], priorSagaHistory: [] });
    const spec = sentRequest().promptSpec as Record<string, unknown>;
    expect(spec).not.toHaveProperty('survivingCast');
    expect(spec).not.toHaveProperty('priorSagaHistory');
  });

  it('LIFE-ARCH — the parse, the cast ingest and the front are unchanged by the migration', async () => {
    const r = await runSagaOpen({ world: world() });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') throw new Error('unreachable');
    expect(r.state.title).toBe('Le 14 rue Cendrillon');
    expect(r.state.playerFacingTeaser).toBe('The room came cheap.');
    expect(r.state.cast.map((c) => c.id)).toEqual(['p1', 'r1']);
    expect(r.state.fronts[0]!.clock.size).toBe(8);
    expect(r.state.ladder?.saga?.days).toBe(12);
  });

  it('LIFE-ARCH — a transport failure still returns `failed`, with no fallback saga', async () => {
    generateGeminiMock.mockRejectedValue(new Error('boom'));
    const r = await runSagaOpen({ world: world() });
    expect(r.kind).toBe('failed');
  });
});
