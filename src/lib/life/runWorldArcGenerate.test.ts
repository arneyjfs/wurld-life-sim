import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({ generateGemini: vi.fn() }));
vi.mock('./debugLog', () => ({ lifeDebug: vi.fn(), lifeFailed: vi.fn() }));
vi.mock('./arcs', async () => {
  const actual = await vi.importActual<typeof import('./arcs')>('./arcs');
  return { ...actual, readCompletedArcs: vi.fn() };
});

import { generateGemini } from '../gemini';
import { readCompletedArcs, COMPLETED_ARCS_CAP } from './arcs';
import { runWorldArcGenerate } from './runWorldArcGenerate';
import { LIFE_TEMPERATURE, LIFE_WORLD_ARC_MODEL } from './modelConfig';
import type { LifeWorld, WorldArc } from '@/types/firestore';

const generateGeminiMock = generateGemini as unknown as ReturnType<typeof vi.fn>;
const readCompletedArcsMock = readCompletedArcs as unknown as ReturnType<typeof vi.fn>;

/**
 * SRV-PROMPT-8..13 batch 3 (second half) — `life_world_arc` sends a SPEC and no
 * prose.
 *
 * ⚠ THIS CALL FAILED SRV-PROMPT-9's SIZE GATE ON FIRST MEASUREMENT and the
 * migration was stopped rather than forced. `readCompletedArcs` returned the
 * entire subcollection, the prompt rendered all of it, and a long-played world's
 * assembled pair went over `MAX_PROMPT_BYTES` — which the built path answers
 * `too-large` and `runWorldArcGenerate` then swallows into `trivialArc`, so the
 * worlds someone cared enough about to keep playing would have quietly stopped
 * getting authored chapters. `LIFE-WORLD-ARC-7` bounded the input first; the
 * `capCompletedArcs` assertion below is that fix seen from the call site.
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

const arc = (chapterNumber: number): WorldArc =>
  ({
    chapterNumber,
    premise: `Premise ${chapterNumber}.`,
    playerTeaser: `Teaser ${chapterNumber}.`,
    themes: ['ambition'],
    status: 'completed',
    recurringNpcIds: [],
    completedSceneMemories: [],
    outcomeLine: `Outcome ${chapterNumber}.`,
  }) as WorldArc;

const OK_JSON = JSON.stringify({
  premise: 'The roster and what it costs.',
  playerTeaser: 'Winter is coming down the valley.',
  themes: ['ambition'],
  recurringNpcIds: ['p1'],
});

/** The single `generateGemini` request the runner made. */
const sentRequest = (): Record<string, unknown> =>
  generateGeminiMock.mock.calls[0]![0] as Record<string, unknown>;

beforeEach(() => {
  generateGeminiMock.mockReset();
  generateGeminiMock.mockResolvedValue(OK_JSON);
  readCompletedArcsMock.mockReset();
  readCompletedArcsMock.mockResolvedValue([]);
});

describe('runWorldArcGenerate — SRV-PROMPT-8..13: a spec, not prose', () => {
  it('SRV-PROMPT-8..13 — sends NO prompt and no systemInstruction', async () => {
    await runWorldArcGenerate({ uid: 'u1', world: world(), chapterNumber: 1 });
    const req = sentRequest();
    // Sending NO `prompt` is load-bearing: the endpoint's "Missing prompt" guard is
    // skipped only when the resolver returns `built`, so a resolver that
    // stopped recognising this kind would 400 every chapter in production with
    // the unit suite still green.
    expect(req).not.toHaveProperty('prompt');
    expect(req.systemInstruction).toBeUndefined();
    expect(req.responseSchema).toBeUndefined();
  });

  it('SRV-PROMPT-8..13 — the spec carries the fields the prompt reads, under the right kind', async () => {
    await runWorldArcGenerate({
      uid: 'u1',
      world: world({
        situation: 'You have a room over the bakery.',
        bio: '<life>a radio technician</life>',
        currentLocationLabel: 'La halle aux grains',
        worldSeedText: 'a canal town',
        universe: {
          setting: 'A canal town',
          era: 'now',
          laws: ['No barge moves without a slip.'],
          places: ['The wash-house'],
          figures: [{ name: 'Bebert', what: 'Keeps the roster book.' }],
        },
      }),
      chapterNumber: 2,
    });
    const spec = sentRequest().promptSpec as Record<string, unknown>;
    expect(spec.kind).toBe('life_world_arc');
    expect(spec.characterName).toBe('Marc');
    expect(spec.practiceLanguage).toBe('French');
    expect(spec.nativeLanguage).toBe('English');
    expect(spec.worldSeedKey).toBe('city_life');
    expect(spec.worldSeedText).toBe('a canal town');
    expect(spec.situation).toBe('You have a room over the bakery.');
    expect(spec.bio).toBe('<life>a radio technician</life>');
    expect(spec.currentLocationLabel).toBe('La halle aux grains');
    expect(spec.chapterNumber).toBe(2);
    expect(spec.universe).toEqual({
      setting: 'A canal town',
      era: 'now',
      laws: ['No barge moves without a slip.'],
      places: ['The wash-house'],
      figures: [{ name: 'Bebert', what: 'Keeps the roster book.' }],
    });
  });

  it('SRV-PROMPT-8..13 — the spec is NOT a LifeWorld: fields the prompt never reads do not travel', async () => {
    await runWorldArcGenerate({
      uid: 'u1',
      world: world({
        canon: { characters: [], places: [], objects: [], facts: [] },
        storyLog: { chapterNumber: 2, entries: ['a line'] },
        resumeRecap: { text: 'previously', lastEventId: 'e1' },
        saga: { title: 'The Book' },
        currentArc: { chapterNumber: 2, premise: 'live', playerTeaser: 'teaser' },
        sagaHistory: ['scene one'],
      } as unknown as Partial<LifeWorld>),
      chapterNumber: 2,
    });
    const spec = sentRequest().promptSpec as Record<string, unknown>;
    for (const k of [
      'canon',
      'storyLog',
      'resumeRecap',
      'saga',
      'currentArc',
      'sagaHistory',
      'id',
      'difficulty',
      'rollingSummary',
    ]) {
      expect(spec, `${k} must not travel`).not.toHaveProperty(k);
    }
  });

  it('SRV-PROMPT-8..13 — omits optional fields rather than sending undefined', async () => {
    await runWorldArcGenerate({ uid: 'u1', world: world(), chapterNumber: 1 });
    const spec = sentRequest().promptSpec as Record<string, unknown>;
    for (const k of ['worldSeedText', 'situation', 'bio', 'currentLocationLabel', 'universe']) {
      expect(spec, `${k} must be absent, not undefined`).not.toHaveProperty(k);
    }
    // The two arrays are always present, because the prompt's own rules (the
    // live-front filter, the regulars cap) run over them server-side.
    expect(spec.fronts).toEqual([]);
    expect(spec.cast).toEqual([]);
    expect(spec.previousArcs).toEqual([]);
  });

  it('LIFE-FRONT-1.1 — fronts travel as agenda + driver + resolved, never a clock', async () => {
    await runWorldArcGenerate({
      uid: 'u1',
      world: world({
        fronts: [
          {
            id: 'f1',
            name: 'The lease',
            driverId: 'p1',
            agenda: 'Buying the lease.',
            kind: 'obligation',
            scope: 'saga',
            resolved: null,
            clock: { filled: 3, size: 8, consequence: 'the lease changes hands' },
          },
        ],
      } as unknown as Partial<LifeWorld>),
      chapterNumber: 2,
    });
    const spec = sentRequest().promptSpec as Record<string, unknown>;
    expect(spec.fronts).toEqual([
      { driverId: 'p1', agenda: 'Buying the lease.', resolved: null },
    ]);
    // The LIVE filter is the PROMPT's rule and stays server-side, so `resolved`
    // has to travel — but the clock, the consequence and the front's own name
    // are things this prompt has never read (LIFE-FRONT-1.1).
    expect(JSON.stringify(spec.fronts)).not.toContain('clock');
    expect(JSON.stringify(spec.fronts)).not.toContain('consequence');
  });

  it('LIFE-CAST-1 — the WHOLE cast travels; the regulars cap is the prompt\'s rule', async () => {
    await runWorldArcGenerate({
      uid: 'u1',
      world: world({
        cast: Array.from({ length: 12 }, (_, i) => ({
          id: `r${i}`,
          name: `Regular ${i}`,
          voice: 'warm',
          standing: 0,
          tier: 'regular',
          known: 'Sells bread.',
          routine: 'Opens at five.',
          gender: 'female',
          ties: [{ id: 'p1', how: 'their cousin' }],
        })),
      } as unknown as Partial<LifeWorld>),
      chapterNumber: 2,
    });
    const cast = (sentRequest().promptSpec as Record<string, unknown>).cast as Array<
      Record<string, unknown>
    >;
    // All twelve go up — the eight-row ceiling decides what the MODEL SEES, and
    // that is the prompt's business, exactly as the recap's ten-row event cap is.
    expect(cast).toHaveLength(12);
    // `gender` / `voiceRegister` are TTS fields this prompt has never read.
    expect(cast[0]).not.toHaveProperty('gender');
    expect(cast[0]!.ties).toEqual([{ id: 'p1', how: 'their cousin' }]);
  });

  it('LIFE-WORLD-ARC-7 — previousArcs are CAPPED before they reach the spec', async () => {
    readCompletedArcsMock.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => arc(i + 1)),
    );
    await runWorldArcGenerate({ uid: 'u1', world: world(), chapterNumber: 21 });
    const prev = (sentRequest().promptSpec as Record<string, unknown>)
      .previousArcs as Array<Record<string, unknown>>;
    expect(prev).toHaveLength(COMPLETED_ARCS_CAP);
    // Head-and-tail: the founding chapters plus where the world actually is.
    expect(prev[0]!.chapterNumber).toBe(1);
    expect(prev[1]!.chapterNumber).toBe(2);
    expect(prev.at(-1)!.chapterNumber).toBe(20);
  });

  it('LIFE-WORLD-ARC-REGISTER — a prior chapter sends its PLANNER premise, never the teaser', async () => {
    readCompletedArcsMock.mockResolvedValue([arc(1)]);
    await runWorldArcGenerate({ uid: 'u1', world: world(), chapterNumber: 2 });
    const prev = (sentRequest().promptSpec as Record<string, unknown>)
      .previousArcs as Array<Record<string, unknown>>;
    expect(prev[0]!.premise).toBe('Premise 1.');
    // The inverse of the recap's pick: that one is PLAYER-facing and gets the
    // spoiler-safe teaser; this one is read by the MODEL, so the teaser is not
    // on the spec at all rather than being sent and ignored.
    expect(prev[0]).not.toHaveProperty('playerTeaser');
    expect(JSON.stringify(prev)).not.toContain('Teaser 1.');
  });

  it('SRV-PROMPT-5 — the generation parameters stay at the CALL SITE', async () => {
    await runWorldArcGenerate({ uid: 'u1', world: world(), chapterNumber: 1 });
    const req = sentRequest();
    expect(req.model).toBe(LIFE_WORLD_ARC_MODEL);
    expect(req.temperature).toBe(LIFE_TEMPERATURE);
    expect(req.thinkingLevel).toBe('minimal');
    expect(req.responseMimeType).toBe('application/json');
    // The telemetry bucket must not move for a refactor — the kind IS the
    // category the client already sent.
    expect(req.category).toBe('life_world_arc');
  });

  it('LIFE-WORLD-ARC-* — a good response still becomes an active arc', async () => {
    const result = await runWorldArcGenerate({ uid: 'u1', world: world(), chapterNumber: 4 });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('unreachable');
    expect(result.arc).toMatchObject({
      chapterNumber: 4,
      premise: 'The roster and what it costs.',
      playerTeaser: 'Winter is coming down the valley.',
      themes: ['ambition'],
      status: 'active',
      recurringNpcIds: ['p1'],
    });
  });

  it('LIFE-WORLD-ARC-* — a rejected call still falls back to trivialArc, not a throw', async () => {
    // The fallback is why this was one of the two calls batch 3 picked. It is
    // also what made the size defect invisible, so it is asserted rather than
    // assumed to still work after the migration.
    generateGeminiMock.mockRejectedValue(new Error('built prompt is too large'));
    const result = await runWorldArcGenerate({ uid: 'u1', world: world(), chapterNumber: 9 });
    expect(result.kind).toBe('fallback');
    if (result.kind !== 'fallback') throw new Error('unreachable');
    expect(result.arc.chapterNumber).toBe(9);
    expect(result.usedFallback).toBe(true);
  });
});
