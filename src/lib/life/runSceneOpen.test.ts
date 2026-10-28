/**
 * LIFE-ARCH — `sceneOpen` as it reaches the LIVE path.
 *
 * The point of these is the WIRING, not the prompt builder (which now lives at
 * `functions/src/prompts/lifeSceneOpen.ts`): the engine has to actually hand the
 * planner its focus rotation, its dormancy digest, its sign request and its
 * irony — and has to stop writing the stored futures. Each of those was a field
 * that existed and went unread at some point in this migration, which is the
 * failure this file exists to catch.
 *
 * ── SRV-PROMPT-8..13 batch 4 ────────────────────────────────────────────────
 *
 * These assertions used to read the rendered PROMPT. The prompt is built server
 * side now, so they read the SPEC instead — which is the same wiring question
 * one layer out, and a sharper one: `<focus castId="marc">` appearing in a
 * string could come from anywhere, whereas `spec.focus.castId` is the field the
 * server validates and renders. The rows that were about the prompt TEXT moved
 * to `functions/src/__tests__/lifeSceneOpen.test.ts` rather than dying with the
 * client module (SRV-PROMPT-3).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const generateGemini = vi.fn();
vi.mock('../gemini', () => ({ generateGemini: (...a: unknown[]) => generateGemini(...a) }));

const { runSceneOpen } = await import('./runSceneOpen');
import { LIFE_SCENE_GEN_MODEL, LIFE_TEMPERATURE } from './modelConfig';
import type { CastMember, Front } from '@/types/lifeState';
import type { LifeWorld } from '@/types/firestore';
import type { LifeSceneOpenPromptSpec } from '@/lib/practicePromptSpec';

const principal = (id: string, name: string, extra: Partial<CastMember> = {}): CastMember => ({
  id, name, known: `${name} is known`, tier: 'principal', voice: 'clipped',
  standing: 0, ties: [], wants: 'something', nextMove: 'does a thing', ...extra,
});

const front = (id: string, filled: number, size: number): Front => ({
  id, name: id, driverId: 'someone', agenda: `${id} agenda`, kind: 'threat',
  scope: 'saga', resolved: null,
  clock: { filled, size, consequence: 'a consequence', peak: filled, unattended: 0, sinceAdvance: 0 },
});

const world = {
  id: 'w1', characterName: 'Alice', practiceLanguage: 'French',
  nativeLanguage: 'English', systemLanguage: 'English', difficulty: 3,
  worldMode: 'realistic',
} as unknown as LifeWorld;

const OK = JSON.stringify({
  title: 'The delivery', where: 'the bakery', who: ['marc'],
  subject: 'the missing crate', atStake: 'Marc loses the contract',
  drawsOn: ['bakery'], signOf: null,
});

/** The single request the runner made. */
function sentRequest(): Record<string, unknown> {
  return generateGemini.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

/** The spec it carried. Typed, so a renamed field is a compile error here too. */
function sentSpec(): LifeSceneOpenPromptSpec {
  return sentRequest().promptSpec as LifeSceneOpenPromptSpec;
}

beforeEach(() => {
  generateGemini.mockReset();
  generateGemini.mockResolvedValue(OK);
});

const base = {
  world,
  cast: [principal('marc', 'Marc')],
  fronts: [] as Front[],
  canon: { characters: [], places: [], objects: [], facts: [] },
  history: [] as string[],
  recentSubjects: [] as string[],
  sceneIndex: 0,
};

describe('runSceneOpen', () => {
  it('LIFE-ARCH-3 — writes NO stored futures', () => {
    // The whole migration in one assertion. Every one of these was a future
    // the model authored before the player had acted once.
    return runSceneOpen(base).then((r) => {
      expect(r.kind).toBe('ok');
      if (r.kind !== 'ok') return;
      expect(r.outline.candidateEndings).toEqual([]);
      expect(r.outline.completionTriggers).toEqual([]);
      expect(r.outline.openBranches).toEqual([]);
      expect(r.outline.estimatedPhaseCount).toBeUndefined();
    });
  });

  it('LIFE-ARCH-3 — the FALLBACK writes no stored futures either', async () => {
    // The fallback is retained (LIFE-SCENE-24: no scene means the engine
    // retries every turn forever) but it must not smuggle back the fields the
    // real path just stopped writing.
    generateGemini.mockRejectedValue(new Error('boom'));
    const r = await runSceneOpen(base);
    expect(r.kind).toBe('fallback');
    expect(r.outline.candidateEndings).toEqual([]);
    expect(r.outline.completionTriggers).toEqual([]);
    expect(r.outline.openBranches).toEqual([]);
  });

  // ── SRV-PROMPT-8..13 batch 4 — the wire shape ────────────────────────────

  it('SRV-PROMPT-8..13 — sends NO prompt and no systemInstruction', async () => {
    await runSceneOpen(base);
    const req = sentRequest();
    // Sending NO `prompt` is load-bearing: the endpoint's "Missing prompt" guard is
    // skipped only when the resolver returns `built`, so a resolver that
    // stopped recognising this kind would 400 every scene open in production
    // with the unit suite still green.
    expect(req).not.toHaveProperty('prompt');
    expect(req.systemInstruction).toBeUndefined();
  });

  it('SRV-PROMPT-1 — the RESPONSE SCHEMA left the bundle with the prompt', async () => {
    // The half that decides what the model may SAY. Leaving it at the call site
    // would keep it frozen in the app bundle while the prompt became one
    // `deploy:prod:functions` away.
    await runSceneOpen(base);
    expect(sentRequest().responseSchema).toBeUndefined();
  });

  it('SRV-PROMPT-5 — the generation parameters STAY at the call site', async () => {
    // `MSG-PIPE-23` requires every call to name its temperature out loud, so
    // moving these to the server would make an unreviewed default invisible.
    await runSceneOpen(base);
    const req = sentRequest();
    expect(req.model).toBe(LIFE_SCENE_GEN_MODEL);
    expect(req.temperature).toBe(LIFE_TEMPERATURE);
    expect(req.thinkingLevel).toBe('minimal');
    expect(req.responseMimeType).toBe('application/json');
    // PRACTICE-OWN-4 — kind and category are the same string, and the server
    // rejects them when they are not.
    expect(req.category).toBe('life_scene_gen');
    expect(sentSpec().kind).toBe('life_scene_gen');
  });

  it('SRV-PROMPT-8..13 — the spec carries the payload fields and NOT a LifeWorld', async () => {
    await runSceneOpen(base);
    const spec = sentSpec();
    expect(spec.characterName).toBe('Alice');
    expect(spec.practiceLanguage).toBe('French');
    expect(spec.sceneIndex).toBe(0);
    // Fields the world doc has and this prompt has never read must not travel:
    // one that reaches nothing is one someone later wires INTO something.
    for (const absent of ['world', 'nativeLanguage', 'systemLanguage', 'difficulty', 'worldMode']) {
      expect(absent in spec, absent).toBe(false);
    }
  });

  it('LIFE-SCENE-2 — the focus rotation reaches the SPEC, already decided', async () => {
    await runSceneOpen({ ...base, cast: [principal('marc', 'Marc')], sceneIndex: 0 });
    expect(sentSpec().focus).toEqual({ castId: 'marc', name: 'Marc' });
  });

  it('LIFE-SCENE-2 — every (n+1)th scene is an ordinary day, and null says so', async () => {
    // One principal ⇒ 2 slots ⇒ odd scene indexes belong to nobody. `null` is a
    // VALUE here, not a miss — the server rejects an ABSENT focus, because that
    // would mean the rotation stopped running.
    await runSceneOpen({ ...base, cast: [principal('marc', 'Marc')], sceneIndex: 1 });
    expect(sentSpec().focus).toBeNull();
    expect('focus' in sentSpec()).toBe(true);
  });

  it('LIFE-SCENE-2 — recent subjects reach the spec', async () => {
    await runSceneOpen({ ...base, recentSubjects: ['the bread delivery'] });
    expect(sentSpec().recentSubjects).toEqual(['the bread delivery']);
  });

  it('LIFE-FRONT-8 — a front past half is REQUESTED as perceivable', async () => {
    await runSceneOpen({ ...base, fronts: [front('f1', 5, 8)] });
    expect(sentSpec().needSign).toEqual(['f1']);
  });

  it('LIFE-FRONT-8 — a front below half is not', async () => {
    await runSceneOpen({ ...base, fronts: [front('f1', 1, 8)] });
    expect(sentSpec().needSign).toEqual([]);
  });

  it('LIFE-FRONT-1.1 — the clock never crosses the wire at all', async () => {
    // A model handed "5/8 → the bakery is sold" writes a countdown whatever the
    // prose rules say. Sharper than the old prompt-text check: the numbers are
    // not merely unrendered, they are not in the payload, so no later prompt
    // edit can start rendering them by accident.
    await runSceneOpen({ ...base, fronts: [front('f1', 5, 8)] });
    const spec = sentSpec();
    expect(spec.fronts).toEqual([{ id: 'f1', driverId: 'someone', agenda: 'f1 agenda' }]);
    expect(JSON.stringify(spec)).not.toContain('a consequence');
    expect(JSON.stringify(spec)).not.toContain('"clock"');
  });

  it('LIFE-FRONT-1.1 — a RESOLVED front does not travel either', async () => {
    // The live filter runs at the call site, because that is the only place
    // that still holds `resolved`.
    await runSceneOpen({
      ...base,
      fronts: [front('f1', 5, 8), { ...front('f2', 5, 8), resolved: 'filled' }],
    });
    expect(sentSpec().fronts.map((f) => f.id)).toEqual(['f1']);
  });

  it('LIFE-CAST-2 — irony is offered only when the player can SEE through it', async () => {
    const cast = [
      principal('marc', 'Marc', { wrongAbout: { aboutId: 'the-crate', believes: 'the crate is safe' } }),
    ];
    const canon = { characters: [], places: [], objects: [{ id: 'the-crate', name: 'the crate', kind: 'object', note: 'empty' }], facts: [] };
    await runSceneOpen({ ...base, cast, canon });
    expect(sentSpec().ironyAvailable).toEqual([
      { castId: 'marc', believes: 'the crate is safe' },
    ]);
  });

  it('LIFE-CAST-2 — a belief about something NOT in canon is not irony yet', async () => {
    // The player cannot see through a belief about a thing they have never
    // met; offering it would ask the planner to explain the gap.
    const cast = [
      principal('marc', 'Marc', { wrongAbout: { aboutId: 'unknown-thing', believes: 'it is safe' } }),
    ];
    await runSceneOpen({ ...base, cast });
    expect(sentSpec().ironyAvailable).toEqual([]);
    // …and the undecided belief does not ride along on the cast row either.
    expect(JSON.stringify(sentSpec())).not.toContain('it is safe');
  });

  it('LIFE-CANON-6 — the dormancy digest reaches the spec, longest-dormant first', async () => {
    const canon = {
      characters: [
        { id: 'fresh-one', name: 'Amandine', kind: 'person', note: 'the neighbour' },
        { id: 'stale-one', name: 'Bertrand', kind: 'person', note: 'the cousin' },
      ],
      places: [], objects: [], facts: [],
    };
    await runSceneOpen({
      ...base, canon,
      history: ['Bertrand argued about the rent.', 'Amandine closed up.'],
    });
    const rows = sentSpec().canon;
    expect(rows.map((c) => c.id)).toEqual(['stale-one', 'fresh-one']);
    expect(rows[0]!.scenesSince).toBeGreaterThan(rows[1]!.scenesSince);
  });

  it('LIFE-STORY-STAGE-3 — the chapter counters travel RAW, not the decided stage', async () => {
    // The threshold is a rule about what the model may be TOLD, so it stays
    // server-side where a functions deploy can move it. Sending a computed
    // `stage` would let a client pick which prose block it gets.
    await runSceneOpen({
      ...base,
      world: { ...world, currentArc: { chapterNumber: 2 }, storyLog: { turns: 14 } } as never,
    });
    const spec = sentSpec();
    expect(spec.chapterNumber).toBe(2);
    expect(spec.chapterTurns).toBe(14);
    expect('stage' in spec).toBe(false);
  });

  it('LIFE-FRONT-8 — signOf survives onto the outline, so the close can honour it', async () => {
    // The close accepts `signOf` only when it was REQUESTED; if the open drops
    // it here, every front reads as unattended and drift fires forever.
    generateGemini.mockResolvedValue(
      JSON.stringify({ ...JSON.parse(OK), signOf: 'f1' }),
    );
    const r = await runSceneOpen({ ...base, fronts: [front('f1', 5, 8)] });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.outline.signOf).toBe('f1');
  });

  it('maps the planner output onto the scene doc', async () => {
    const r = await runSceneOpen(base);
    if (r.kind !== 'ok') return;
    expect(r.outline.title).toBe('The delivery');
    expect(r.outline.subject).toBe('the missing crate');
    expect(r.outline.premise).toBe('Marc loses the contract');
    expect(r.outline.where).toBe('the bakery');
    expect(r.outline.keyNpcs.map((n) => n.npcId)).toEqual(['marc']);
    expect(r.outline.keyNpcs[0]?.name).toBe('Marc');
  });

  it('drops a `who` that names nobody in the cast', async () => {
    // A hallucinated cast id would pre-promote an NPC with no name and no
    // voice, and the roster would carry a ghost for the rest of the world.
    generateGemini.mockResolvedValue(
      JSON.stringify({ ...JSON.parse(OK), who: ['marc', 'nobody-at-all'] }),
    );
    const r = await runSceneOpen(base);
    if (r.kind !== 'ok') return;
    expect(r.outline.keyNpcs.map((n) => n.npcId)).toEqual(['marc']);
  });

  it('falls back rather than throwing when the response is unparseable', async () => {
    generateGemini.mockResolvedValue('not json at all');
    const r = await runSceneOpen(base);
    expect(r.kind).toBe('fallback');
    expect(r.outline.title).toBeTruthy();
  });
});

/**
 * LIFE-CAST-6 — THE OUTLINE MUST BE WRITABLE TO FIRESTORE.
 *
 * Same defect class as the cast one, one module over. `openQuestion` and
 * `where` were built with `cleanText(...) ?? undefined`, which creates an
 * EXPLICIT key holding `undefined` — the Firestore SDK rejects that outright
 * (`ignoreUndefinedProperties` is not set on this app's instance), so the
 * whole `createScene` write fails.
 *
 * It fires on ordinary model output, not on a malformed response: both fields
 * are in the `sceneOpen` schema's `required` list, so the model always emits
 * them — and per LIFE-CAST-4 it satisfies a required STRING it has nothing for
 * by writing `""` / `"none"` / `"n/a"`, all of which `cleanText` maps to
 * `null`. The consequence is the worst one available: `startScene` throws,
 * `startSceneIfNone` swallows it, and the world sits with NO active scene —
 * which per LIFE-SCENE-24 means the chapter can never end, while a billed
 * `sceneOpen` re-fires on every turn.
 *
 * These assert with `in` / `Object.keys`, never `toBeUndefined()`:
 * `=== undefined` is true for an absent key AND for an explicit one, and the
 * explicit one is the only one Firestore refuses.
 */
describe('LIFE-CAST-6 — the outline carries no explicit undefined key', () => {
  const undefinedKeys = (o: object): string[] =>
    Object.entries(o)
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);

  it('LIFE-CAST-6 — a "none" where and an empty openQuestion are OMITTED, not held as undefined', async () => {
    generateGemini.mockResolvedValue(
      JSON.stringify({ ...JSON.parse(OK), where: 'none', openQuestion: '' }),
    );
    const r = await runSceneOpen(base);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect('where' in r.outline).toBe(false);
    expect('openQuestion' in r.outline).toBe(false);
    expect(undefinedKeys(r.outline)).toEqual([]);
  });

  it('LIFE-CAST-6 — a model that omits both fields entirely leaves no undefined behind', async () => {
    const { where: _w, ...noPlace } = JSON.parse(OK) as Record<string, unknown>;
    generateGemini.mockResolvedValue(JSON.stringify(noPlace));
    const r = await runSceneOpen(base);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(undefinedKeys(r.outline)).toEqual([]);
  });

  it('LIFE-CAST-6 — real values still survive: the fix must not drop them', async () => {
    generateGemini.mockResolvedValue(
      JSON.stringify({
        ...JSON.parse(OK),
        where: 'the bakery',
        openQuestion: 'will Marc admit the crate never arrived?',
      }),
    );
    const r = await runSceneOpen(base);
    if (r.kind !== 'ok') return;
    expect(r.outline.where).toBe('the bakery');
    expect(r.outline.openQuestion).toBe('will Marc admit the crate never arrived?');
    expect(undefinedKeys(r.outline)).toEqual([]);
  });

  it('LIFE-CAST-6 — signOf falls to null, never to undefined, when the model omits it', async () => {
    // The third field on the same literal, and the same hole one step further
    // back: `needSign.includes(parsed.signOf ?? '')` is TRUE for an omitted
    // `signOf` the moment a requested front id is empty, and the branch then
    // wrote `parsed.signOf!` — i.e. undefined — onto the outline. `signOf` is
    // nullable in the schema, so null is the value that means "no sign"; only
    // undefined is unwritable.
    generateGemini.mockResolvedValue(JSON.stringify({ ...JSON.parse(OK), signOf: undefined }));
    const r = await runSceneOpen({ ...base, fronts: [front('', 5, 8)] });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.outline.signOf).toBeNull();
    expect(undefinedKeys(r.outline)).toEqual([]);
  });

  it('LIFE-CAST-6 — the fallback outline is writable too', async () => {
    // LIFE-SCENE-24: the fallback is the thing that stops the retry loop. An
    // unwritable fallback would leave the world in exactly the state the
    // fallback exists to prevent.
    generateGemini.mockRejectedValue(new Error('boom'));
    const r = await runSceneOpen(base);
    expect(r.kind).toBe('fallback');
    expect(undefinedKeys(r.outline)).toEqual([]);
  });
});
