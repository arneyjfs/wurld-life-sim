import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({
  generateGemini: vi.fn(),
}));

vi.mock('../log', () => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('./world', () => ({
  updateLifeWorld: vi.fn(),
}));

import { generateGemini } from '../gemini';
import { updateLifeWorld } from './world';
import {
  countEventsSinceRecap,
  runResumeRecapGenerate,
  RESUME_RECAP_MIN_NEW_EVENTS,
  ZResumeRecapResponse,
} from './runResumeRecapGenerate';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

const generateGeminiMock = generateGemini as unknown as ReturnType<typeof vi.fn>;
const updateLifeWorldMock = updateLifeWorld as unknown as ReturnType<typeof vi.fn>;

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  worldMode: 'realistic',
};

const beat = (id: string, practiceText = `line-${id}`): LifeEvent => ({
  id,
  kind: 'beat',
  payload: { speaker: 'npc', speakerName: 'Sophie', practiceText },
});

const events = (n: number): LifeEvent[] =>
  Array.from({ length: n }, (_, i) => beat(`e${i + 1}`));

// LIFE-LANG-8: single system-language recap (baseWorld has no
// systemLanguage → effective system language falls back to
// nativeLanguage = 'English').
const OK_JSON = JSON.stringify({
  text: 'Sophie suggested lunch — you said yes.',
});

beforeEach(() => {
  generateGeminiMock.mockReset();
  updateLifeWorldMock.mockReset();
  updateLifeWorldMock.mockResolvedValue(undefined);
});

describe('countEventsSinceRecap — LIFE-FLOW-5', () => {
  it('LIFE-FLOW-5 — counts every event when no recap was ever generated', () => {
    expect(countEventsSinceRecap(baseWorld, events(7))).toBe(7);
  });

  it('LIFE-FLOW-5 — counts only events newer than the anchor id', () => {
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'e6' },
    };
    expect(countEventsSinceRecap(world, events(10))).toBe(4);
  });

  it('LIFE-FLOW-5 — returns 0 when the anchor is the newest event', () => {
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'e10' },
    };
    expect(countEventsSinceRecap(world, events(10))).toBe(0);
  });

  it('LIFE-FLOW-5 — treats an out-of-window anchor id as all-new', () => {
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'scrolled-out' },
    };
    expect(countEventsSinceRecap(world, events(10))).toBe(10);
  });
});

describe('ZResumeRecapResponse — LIFE-FLOW-5 / LIFE-LANG-8', () => {
  it('LIFE-LANG-8 — accepts a single { text } payload (system-language only)', () => {
    expect(ZResumeRecapResponse.safeParse({ text: 'a' }).success).toBe(true);
  });

  it('LIFE-LANG-8 — rejects an empty text', () => {
    expect(ZResumeRecapResponse.safeParse({ text: '  ' }).success).toBe(false);
  });

  it('LIFE-LANG-8 — rejects a missing text field', () => {
    expect(ZResumeRecapResponse.safeParse({}).success).toBe(false);
  });

  it('LIFE-LANG-8 — no longer accepts the legacy bilingual pair alone', () => {
    // The retired { practiceText, nativeText } shape has no `text` field.
    expect(
      ZResumeRecapResponse.safeParse({ practiceText: 'a', nativeText: 'b' })
        .success,
    ).toBe(false);
  });
});

describe('runResumeRecapGenerate — LIFE-FLOW-5', () => {
  it('LIFE-FLOW-5 — skips on an empty event log without calling the model', async () => {
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: [],
    });
    expect(result).toEqual({ kind: 'skipped', reason: 'no-events' });
    expect(generateGeminiMock).not.toHaveBeenCalled();
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — skips when fewer than 5 events landed since the last recap', async () => {
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'e6' },
    };
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world,
      events: events(10), // e7..e10 = 4 new < 5
    });
    expect(result).toEqual({ kind: 'skipped', reason: 'too-few-new-events' });
    expect(generateGeminiMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — fires when exactly RESUME_RECAP_MIN_NEW_EVENTS new events landed', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'e5' },
    };
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world,
      // e1..e10 with anchor e5 → e6..e10 = 5 new = RESUME_RECAP_MIN_NEW_EVENTS.
      events: events(10),
    });
    expect(result.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(RESUME_RECAP_MIN_NEW_EVENTS).toBe(5);
  });

  it('LIFE-FLOW-5 — treats an out-of-window lastEventId as stale and fires', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'scrolled-out' },
    };
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world,
      events: events(5),
    });
    expect(result.kind).toBe('ok');
  });

  it('LIFE-FLOW-5 — calls flash-lite with json mime + life_resume_recap category', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    await runResumeRecapGenerate({ uid: 'u1', world: baseWorld, events: events(6) });
    const call = generateGeminiMock.mock.calls[0]![0];
    expect(call.model).toBe('gemini-3.1-flash-lite');
    // LIFE-THINK-1: measured 2026-07 — 3/3 quality at both levels, 'low'
    // cost 2x the price and 3.2x the latency of a call the player waits on
    // at resume. See docs/archive/model-migration-2026-07.md §8.
    expect(call.thinkingLevel).toBe('minimal');
    expect(call.responseMimeType).toBe('application/json');
    expect(call.category).toBe('life_resume_recap');
    expect(call.temperature).toBeUndefined();
  });

  /**
   * SRV-PROMPT-8..13 batch 3 — the client sends DATA and no prose.
   *
   * These replace the old assertions that read `call.systemInstruction` for
   * "French" and `call.prompt` for `<character`. Both now live server-side
   * (`functions/src/prompts/lifeResumeRecap.ts`), and the SI assertions moved to
   * `functions/src/__tests__/lifeResumeRecap.test.ts` rather than dying here.
   *
   * The failure that matters is the one PRACTICE-OWN-1's own header records
   * happening: a spec-carrying client sends no `prompt`, so if the resolver
   * ever stopped returning `built` for this kind, EVERY recap call would 400 on
   * the endpoint's "Missing prompt" guard with the unit suite still green.
   */
  it('SRV-PROMPT-8..13 — sends NO prompt and no systemInstruction / responseSchema', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    await runResumeRecapGenerate({ uid: 'u1', world: baseWorld, events: events(6) });
    const call = generateGeminiMock.mock.calls[0]![0];
    expect(call).not.toHaveProperty('prompt');
    expect(call.systemInstruction).toBeUndefined();
    expect(call.responseSchema).toBeUndefined();
  });

  it('SRV-PROMPT-8..13 — sends a life_resume_recap spec whose kind matches the category', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    await runResumeRecapGenerate({
      uid: 'u1',
      world: {
        ...baseWorld,
        storyLog: { chapterNumber: 2, entries: ['You arrived.'] },
        currentArc: {
          chapterNumber: 2,
          premise: 'PLANNER_PREMISE',
          playerTeaser: 'TEASER',
          themes: [],
          status: 'active',
          recurringNpcIds: [],
          completedSceneMemories: [],
        },
      },
      events: events(6),
    });
    const call = generateGeminiMock.mock.calls[0]![0];
    // PRACTICE-OWN-4 — the server rejects a spec whose kind is not the category.
    expect(call.promptSpec.kind).toBe('life_resume_recap');
    expect(call.promptSpec.kind).toBe(call.category);
    expect(call.promptSpec.characterName).toBe('Marc');
    expect(call.promptSpec.practiceLanguage).toBe('French');
    expect(call.promptSpec.storyLines).toEqual(['You arrived.']);
    // The register PICK is the server's (LIFE-WORLD-ARC-REGISTER), so both
    // stored strings travel and the prompt chooses — the spoiler rule is the
    // half worth being able to correct without an App Store review.
    expect(call.promptSpec.chapter).toEqual({
      chapterNumber: 2,
      premise: 'PLANNER_PREMISE',
      playerTeaser: 'TEASER',
    });
  });

  it('LIFE-LANG-8 — the spec carries the RESOLVED system language (native fallback for legacy worlds)', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    await runResumeRecapGenerate({ uid: 'u1', world: baseWorld, events: events(6) });
    // baseWorld has no systemLanguage → effective = nativeLanguage 'English'.
    expect(generateGeminiMock.mock.calls[0]![0].promptSpec.systemLanguage).toBe('English');

    generateGeminiMock.mockClear();
    await runResumeRecapGenerate({
      uid: 'u1',
      world: { ...baseWorld, systemLanguage: 'German' },
      events: events(6),
    });
    expect(generateGeminiMock.mock.calls[0]![0].promptSpec.systemLanguage).toBe('German');
  });

  it('SRV-PROMPT-8..13 — event rows travel as the four fields the prompt reads, not raw payloads', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: [
        ...events(5),
        {
          id: 'e6',
          kind: 'beat',
          payload: {
            speaker: 'npc',
            speakerName: 'Sophie',
            practiceText: 'Salut !',
            // Everything else on a beat payload — word translations, node ids,
            // audio keys — is wire weight the prompt has never read.
            wordTranslations: [{ w: 'salut', t: 'hi' }],
            nodeId: 'n-42',
          },
        },
      ],
      });
    const rows = generateGeminiMock.mock.calls[0]![0].promptSpec.events;
    expect(rows).toHaveLength(6);
    expect(rows[5]).toEqual({
      kind: 'beat',
      speaker: 'npc',
      speakerName: 'Sophie',
      practiceText: 'Salut !',
    });
    // The FILTER and the 10-row cap are the prompt's, not the client's: the
    // whole listener window goes up and the server decides what renders.
    expect(rows.every((r: { kind: string }) => typeof r.kind === 'string')).toBe(true);
  });

  it('SRV-PROMPT-8..13 — the spec carries no legacySummary (rollingSummary retired 2026-09-29)', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    await runResumeRecapGenerate({ uid: 'u1', world: baseWorld, events: events(6) });
    const spec = generateGeminiMock.mock.calls[0]![0].promptSpec;
    expect(spec.storyLines).toEqual([]);
    expect(spec).not.toHaveProperty('legacySummary');
    expect(spec).not.toHaveProperty('rollingSummary');
  });

  it('LIFE-LANG-8 — persists the single system-language recap text and re-anchors lastEventId to the newest event', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(10),
    });
    expect(result).toEqual({
      kind: 'ok',
      text: 'Sophie suggested lunch — you said yes.',
      lastEventId: 'e10',
    });
    expect(updateLifeWorldMock).toHaveBeenCalledTimes(1);
    expect(updateLifeWorldMock).toHaveBeenCalledWith('u1', 'w1', {
      resumeRecap: expect.objectContaining({
        text: 'Sophie suggested lunch — you said yes.',
        lastEventId: 'e10',
      }),
    });
    // No bilingual concatenation — the stored text carries no blank-line join.
    const stored = updateLifeWorldMock.mock.calls[0]![2].resumeRecap.text;
    expect(stored).not.toContain('\n\n');
  });

  it('LIFE-FLOW-5 — strips markdown fences before parsing (defensive)', async () => {
    generateGeminiMock.mockResolvedValue('```json\n' + OK_JSON + '\n```');
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(6),
    });
    expect(result.kind).toBe('ok');
  });

  it('LIFE-FLOW-5 — schema-failed on non-JSON output; nothing written', async () => {
    generateGeminiMock.mockResolvedValue('not json');
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(6),
    });
    expect(result.kind).toBe('schema-failed');
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });

  it('LIFE-LANG-8 — schema-failed when the `text` field is missing (legacy bilingual shape); nothing written', async () => {
    // The retired { practiceText, nativeText } payload lacks `text`.
    generateGeminiMock.mockResolvedValue(
      JSON.stringify({ practiceText: 'un', nativeText: 'one' }),
    );
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(6),
    });
    expect(result.kind).toBe('schema-failed');
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — error result when generateGemini throws; nothing written', async () => {
    generateGeminiMock.mockRejectedValue(new Error('network down'));
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(6),
    });
    expect(result.kind).toBe('error');
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — error result when the world write fails', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    updateLifeWorldMock.mockRejectedValue(new Error('firestore offline'));
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(6),
    });
    expect(result.kind).toBe('error');
  });
});
