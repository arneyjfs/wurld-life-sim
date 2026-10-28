/**
 * LIFE-ARCH-4 — `sceneClose` as it reaches the LIVE path.
 *
 * ── WHY THIS FILE IS NEW ────────────────────────────────────────────────────
 *
 * `runSceneClose` had NO call-site coverage of its own before SRV-PROMPT-8..13
 * batch 4. Its prompt builder was asserted by `sceneCloseObjective.test.ts` and
 * its RESULT by `nodeEngineSceneClose.test.ts` (through a mock of this very
 * module), so the seam between them — what this runner actually puts on the
 * wire — was tested by nothing. That gap is exactly where a migration does its
 * damage, so the batch that moved the prompt is the batch that closes it.
 *
 * The prompt TEXT assertions live at
 * `functions/src/__tests__/lifeSceneClose.test.ts` now (SRV-PROMPT-3: tests
 * move, they do not die). What is here is the WIRING: the spec carries what the
 * close reads, the generation parameters stay at the call site, and the
 * code-owned parts of the close — the delta clamp, the drift, the sign
 * acceptance — still run on the response.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const generateGemini = vi.fn();
vi.mock('../gemini', () => ({ generateGemini: (...a: unknown[]) => generateGemini(...a) }));

const { runSceneClose } = await import('./runSceneClose');
import { LIFE_SCENE_GEN_MODEL, LIFE_TEMPERATURE } from './modelConfig';
import type { CastMember, Front } from '@/types/lifeState';
import type { LifeSceneClosePromptSpec } from '@/lib/practicePromptSpec';

const principal = (id: string, name: string, extra: Partial<CastMember> = {}): CastMember => ({
  id, name, known: `${name} is known`, tier: 'principal', voice: 'clipped',
  standing: 0, ties: [], wants: 'something', nextMove: 'does a thing', ...extra,
});

const regular = (id: string, name: string, extra: Partial<CastMember> = {}): CastMember => ({
  id, name, known: `${name} is known`, tier: 'regular', voice: 'warm',
  standing: 0, ties: [], routine: 'opens at five', ...extra,
});

const front = (id: string, filled: number, size: number): Front => ({
  id, name: `${id} name`, driverId: 'someone', agenda: `${id} agenda`, kind: 'threat',
  scope: 'saga', resolved: null,
  clock: { filled, size, consequence: 'a consequence', peak: filled, unattended: 0, sinceAdvance: 9 },
});

const OK = JSON.stringify({
  history: 'You fixed the gate and were seen doing it.',
  clockDeltas: [],
  castChanges: [],
  newCanon: [],
  objectiveVerdict: 'stands',
  situation: null,
});

function sentRequest(): Record<string, unknown> {
  return generateGemini.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}
function sentSpec(): LifeSceneClosePromptSpec {
  return sentRequest().promptSpec as LifeSceneClosePromptSpec;
}

const base = {
  sceneLog: ['You: hello', 'Sophie: bonjour'],
  subject: 'the missing crate',
  atStake: 'Marc loses the contract',
  cast: [principal('marc', 'Marc'), regular('sophie', 'Sophie')],
  fronts: [front('f1', 3, 8)],
  realistic: true,
  requestedSignIds: [] as string[],
  signOf: null,
};

beforeEach(() => {
  generateGemini.mockReset();
  generateGemini.mockResolvedValue(OK);
});

describe('runSceneClose — SRV-PROMPT-8..13: a spec, not prose', () => {
  it('SRV-PROMPT-8..13 — sends NO prompt and no systemInstruction', async () => {
    await runSceneClose(base);
    const req = sentRequest();
    expect(req).not.toHaveProperty('prompt');
    expect(req.systemInstruction).toBeUndefined();
  });

  it('SRV-PROMPT-1 — the RESPONSE SCHEMA left the bundle with the prompt', async () => {
    await runSceneClose(base);
    expect(sentRequest().responseSchema).toBeUndefined();
  });

  it('SRV-PROMPT-5 — the generation parameters STAY at the call site', async () => {
    await runSceneClose(base);
    const req = sentRequest();
    expect(req.model).toBe(LIFE_SCENE_GEN_MODEL);
    expect(req.temperature).toBe(LIFE_TEMPERATURE);
    expect(req.thinkingLevel).toBe('minimal');
    expect(req.responseMimeType).toBe('application/json');
    // ⚠ `life_scene` is the CLOSE. Inverted-looking, not a typo — the wire
    // value this call site has always sent (SRV-PROMPT-4).
    expect(req.category).toBe('life_scene');
    expect(sentSpec().kind).toBe('life_scene');
  });

  it('SRV-PROMPT-8..13 — the spec carries the scene, the cast and the register', async () => {
    await runSceneClose(base);
    const spec = sentSpec();
    expect(spec.subject).toBe('the missing crate');
    expect(spec.atStake).toBe('Marc loses the contract');
    expect(spec.sceneLog).toEqual(['You: hello', 'Sophie: bonjour']);
    expect(spec.realistic).toBe(true);
    expect(spec.cast).toEqual([
      { id: 'marc', name: 'Marc', tier: 'principal', standing: 0, wants: 'something', nextMove: 'does a thing' },
      { id: 'sophie', name: 'Sophie', tier: 'regular', standing: 0, routine: 'opens at five' },
    ]);
  });

  it('LIFE-ARCH-2.1 — `known` does not travel: witnessed truth is not the close’s business', async () => {
    // It is absent from the RESPONSE schema so a revision cannot contradict it.
    // There is no reason for it to enter through the prompt either, and a field
    // on the wire that reaches nothing is one someone later wires INTO
    // something.
    await runSceneClose(base);
    expect(JSON.stringify(sentSpec())).not.toContain('is known');
  });

  it('LIFE-ARCH-4 — the CLOCKS do travel, and only the three fields rendered', async () => {
    // The inverse of LIFE-FRONT-1.1's rule for every other prompt, and the
    // whole job: this is the only caller that decides deltas. The engine's own
    // bookkeeping (`peak`, `unattended`, `sinceAdvance`, `scope`, `name`,
    // `resolved`) still stays behind.
    await runSceneClose(base);
    expect(sentSpec().fronts).toEqual([
      {
        id: 'f1',
        kind: 'threat',
        driverId: 'someone',
        agenda: 'f1 agenda',
        clock: { filled: 3, size: 8, consequence: 'a consequence' },
      },
    ]);
    const wire = JSON.stringify(sentSpec());
    for (const engineOnly of ['peak', 'unattended', 'sinceAdvance', 'scope', 'resolved', 'f1 name']) {
      expect(wire, engineOnly).not.toContain(engineOnly);
    }
  });

  it('LIFE-GOAL-11 — the objective travels when live, and is ABSENT when not', async () => {
    await runSceneClose({ ...base, objective: { id: 'o1', text: 'get the roster changed' } });
    expect(sentSpec().objective).toEqual({ id: 'o1', text: 'get the roster changed' });
    await runSceneClose({ ...base, objective: null });
    // Absent rather than `null`: `LIFE-CAST-6` is about exactly this — an
    // explicit key holding undefined is what Firestore rejects, and a spec that
    // carries a dead key invites a later reader to render it.
    expect('objective' in sentSpec()).toBe(false);
    await runSceneClose(base);
    expect('objective' in sentSpec()).toBe(false);
  });

  it('SRV-PROMPT-12 — nothing about the RETRY carries prose back up the wire', async () => {
    // `life_step` and `life_graded_question` append a rendered critic hint
    // between attempts, which is the hole SRV-PROMPT-12 names. This call's
    // retry ladder is `generateOnceWithRetry`, which re-issues the SAME
    // request — asserted, because a hint added here later would re-open the
    // proxy through the retry path while the first attempt looked migrated.
    generateGemini.mockRejectedValueOnce(new Error('transport')).mockResolvedValue(OK);
    await runSceneClose(base);
    expect(generateGemini.mock.calls).toHaveLength(2);
    const [first, second] = generateGemini.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(second!).not.toHaveProperty('prompt');
    expect(second!.promptSpec).toEqual(first!.promptSpec);
  });
});

describe('runSceneClose — the code-owned half still runs on the response', () => {
  it('LIFE-FRONT-2 — a model delta over the budget is CLAMPED, not honoured', async () => {
    // A CHAPTER-scope front, so this measures `DELTA_PER_FRONT` alone rather
    // than LIFE-FRONT-10's saga ratchet (which is the row below). The prose
    // states the budget server-side; the clamp enforces it here, and the parity
    // guard asserts the two numbers agree.
    generateGemini.mockResolvedValue(
      JSON.stringify({ ...JSON.parse(OK), clockDeltas: [{ frontId: 'f1', delta: 7, reason: 'r' }] }),
    );
    const r = await runSceneClose({
      ...base,
      fronts: [{ ...front('f1', 3, 8), scope: 'chapter' }],
    });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.fronts[0]!.clock.filled).toBe(5);
  });

  it('LIFE-FRONT-10 — a SAGA front still moves one notch, whatever the model asked', async () => {
    generateGemini.mockResolvedValue(
      JSON.stringify({ ...JSON.parse(OK), clockDeltas: [{ frontId: 'f1', delta: 7, reason: 'r' }] }),
    );
    const r = await runSceneClose(base);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.fronts[0]!.clock.filled).toBe(4);
  });

  it('LIFE-FRONT-8.1 — an UNREQUESTED signOf does not count as attention', async () => {
    // `driftUnattended` needs `UNATTENDED_DRIFT_SCENES` consecutive misses
    // before it moves a clock, so the observable in ONE close is the counter.
    // Honouring an unrequested sign is what held that counter at zero and
    // suppressed LIFE-FRONT-9's drift for eighteen straight scenes.
    const unrequested = await runSceneClose({ ...base, requestedSignIds: [], signOf: 'f1' });
    expect(unrequested.kind).toBe('ok');
    if (unrequested.kind !== 'ok') return;
    expect(unrequested.fronts[0]!.clock.unattended).toBe(1);

    const requested = await runSceneClose({ ...base, requestedSignIds: ['f1'], signOf: 'f1' });
    expect(requested.kind).toBe('ok');
    if (requested.kind !== 'ok') return;
    expect(requested.fronts[0]!.clock.unattended).toBe(0);
  });

  it('LIFE-GOAL-11 — a missing verdict defaults to `stands`, the safe direction', async () => {
    generateGemini.mockResolvedValue(
      JSON.stringify({ history: 'x', clockDeltas: [], castChanges: [], newCanon: [] }),
    );
    const r = await runSceneClose(base);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.objectiveVerdict).toBe('stands');
    expect(r.objectiveBecause).toBeNull();
  });

  it('fails rather than throwing when the response is unparseable', async () => {
    generateGemini.mockResolvedValue('not json at all');
    const r = await runSceneClose(base);
    expect(r.kind).toBe('failed');
  });

  it('fails rather than throwing when the transport gives up', async () => {
    generateGemini.mockRejectedValue(new Error('boom'));
    const r = await runSceneClose(base);
    expect(r.kind).toBe('failed');
  });
});
