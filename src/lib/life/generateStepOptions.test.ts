import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({ generateGemini: vi.fn() }));
vi.mock('../log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('./debugLog', () => ({
  lifeDebug: vi.fn(),
  lifeWarn: vi.fn(),
  lifeFailed: vi.fn(),
}));

import { generateGemini } from '../gemini';
import { lifeFailed, lifeWarn } from './debugLog';
import { AppError } from '@/lib/errors';
import {
  buildGradedSceneContext,
  generateStepOptions,
  recentGenerationTargets,
} from './generateStepOptions';
import { gradeOptionSet } from './optionGrid';
import type { NodePreview } from './stepSchema';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

const generateGeminiMock = vi.mocked(generateGemini);
const lifeFailedMock = vi.mocked(lifeFailed);
const lifeWarnMock = vi.mocked(lifeWarn);

/** Every `lifeFailed` summary pushed during the call, joined — the overlay is
 *  read as a list, so the assertions ask "did the buffer say X" rather than
 *  pinning an index that a later log would shift. */
const failedSummaries = () => lifeFailedMock.mock.calls.map((c) => c[1]);
const warnSummaries = () => lifeWarnMock.mock.calls.map((c) => c[1]);
/** The payload of the first `lifeFailed` whose summary matches. */
const failedPayload = (re: RegExp) =>
  lifeFailedMock.mock.calls.find((c) => re.test(c[1]))?.[2];
/** The payload of the first `lifeWarn` whose summary matches. */
const warnPayload = (re: RegExp) =>
  lifeWarnMock.mock.calls.find((c) => re.test(c[1]))?.[2];

/** `node` is a discriminated union and the `question` arm carries no beats
 *  (LIFE-CONTRACT-BUBBLE: "a question node carries 0 beats and 0 options"), so
 *  reading `.beats` off the union does not typecheck. Narrow once here. */
const beatsOf = (node: NodePreview | null | undefined) =>
  node && node.kind !== 'question' ? node.beats : undefined;

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  worldMode: 'realistic',
};

const event = (kind: LifeEvent['kind'], payload: Record<string, unknown>): LifeEvent => ({
  id: 'e' + Math.random().toString(36).slice(2, 8),
  kind,
  payload,
});

const narratorBeat = {
  speaker: 'narrator',
  practiceText: 'Tu entres au café.',
  nativeText: 'You enter the café.',
};
const validLive = {
  node: { kind: 'branch', beats: [narratorBeat] },
  options: [
    { id: 'a', practiceText: 'Avancer', nativeText: 'Move forward' },
    { id: 'b', practiceText: 'Attendre', nativeText: 'Wait' },
  ],
};
const validOptionsOnly = {
  options: [
    { id: 'a', practiceText: 'Avancer', nativeText: 'Move forward' },
    { id: 'b', practiceText: 'Attendre', nativeText: 'Wait' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

const twoBeats = {
  node: {
    kind: 'branch',
    beats: [
      { speaker: 'npc', speakerName: 'Sophie', npcId: 'sophie', practiceText: 'Ah bon ?', nativeText: 'Oh really?' },
      { speaker: 'narrator', practiceText: 'La porte s’ouvre.', nativeText: 'The door opens.' },
    ],
  },
  options: [
    { id: 'a', practiceText: 'Avancer', nativeText: 'Move forward' },
    { id: 'b', practiceText: 'Attendre', nativeText: 'Wait' },
  ],
};

/**
 * SRV-PROMPT-8..13 batch 8 — what a call SENDS, now that no prompt text leaves
 * this client.
 *
 * ⚠ THESE ASSERTIONS CHANGED SHAPE, AND THAT IS THE POINT. They used to read
 * `call[0].prompt` and grep the assembled XML. The client sends no prompt,
 * only a `promptSpec`, so grepping the prompt would now assert about the empty
 * string — which is exactly the way batch 1 found the backdrop harness had been
 * scoring nothing. What this client is responsible for is the SPEC, so that is
 * what is asserted; the bytes the spec renders to are pinned server-side by
 * `functions/src/__tests__/stepGoldenParity.test.ts` against a capture of the
 * old client's own output.
 */
const specOf = (i: number) =>
  (generateGeminiMock.mock.calls[i]![0] as { promptSpec: Record<string, unknown> }).promptSpec;
const retryOf = (i: number) =>
  (specOf(i).retry ?? []) as Array<Record<string, unknown>>;
const codesOf = (i: number) => retryOf(i).map((v) => v.code);

describe('LIFE-LANG-13.1 — the player’s own bubble costs a visible slot', () => {
  // THE REPORTED BUG. `LIFE-LANG-13(c)` charges the revealed practised line
  // against the turn's ~2 visible slots, but that rule was written for the
  // GRADED path only. A `say` option and a free-text turn ALSO put a
  // client-built bubble on screen before this call (LIFE-CONTRACT-BUBBLE-2),
  // and nothing charged them — so two fresh beats made THREE bubbles for two
  // slots and the overflow scrolled into the next turn's window.

  it('clamps to ONE beat when the player’s option spoke a line', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(twoBeats));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: {
        kind: 'live',
        choice: { id: 'a', practiceText: 'Dire bonjour', saysLine: 'Bonjour !' },
      },
      nonce: 1,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    // The FIRST beat survives: beats are in narrative order, so it is the
    // reply that follows the player's line. The tail is what would have
    // scrolled their own words away.
    expect(beatsOf(result.node)).toHaveLength(1);
    expect(beatsOf(result.node)?.[0]?.speakerName).toBe('Sophie');
  });

  it('clamps to ONE beat on a free-text turn too', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(twoBeats));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live', freeText: 'Je voudrais un café, s’il vous plaît.' },
      nonce: 2,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(beatsOf(result.node)).toHaveLength(1);
  });

  it('leaves BOTH beats when the player did not speak', async () => {
    // An `act` option builds no bubble, so both slots are free and the clamp
    // must not fire — otherwise it silently halves every narrative turn.
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(twoBeats));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: {
        kind: 'live',
        choice: { id: 'a', practiceText: 'Ouvrir la porte', speechAct: 'act' },
      },
      nonce: 3,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(beatsOf(result.node)).toHaveLength(2);
  });

  it('an empty saysLine is not speech', async () => {
    // `saysLine: ''` / whitespace must not be read as a bubble — the clamp is
    // keyed on the player having actually said something.
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(twoBeats));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live', choice: { id: 'a', practiceText: 'X', saysLine: '   ' } },
      nonce: 4,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(beatsOf(result.node)).toHaveLength(2);
  });
});

describe('generateStepOptions — LIFE-NODE-2', () => {
  it('LIFE-NODE-2 — live turn: parses node + options, echoes the nonce', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(validLive));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live' },
      nonce: 7,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.node?.kind).toBe('branch');
    expect(result.options).toHaveLength(2);
    expect(result.nonce).toBe(7);
    // Opening derivation: empty events + live → the OPENING arm. The client's
    // job is to say so in the spec; the `<turn kind="opening">` bytes it
    // renders to are pinned by the golden.
    expect(specOf(0).isOpeningBeat).toBe(true);
    expect(specOf(0).requestKind).toBe('live');
    expect(generateGeminiMock.mock.calls[0]![0]).not.toHaveProperty('prompt');
    // SRV-PROMPT-12 — attempt 0 carries NO verdict at all. ⚠ FOUND BY A
    // SURVIVING MUTATION: passing the (empty) array on the first attempt
    // rendered nothing, because the server drops an empty list — but it puts a
    // field on the wire that means "the model already failed" on the call where
    // it has not.
    expect('retry' in specOf(0)).toBe(false);
  });

  it('LIFE-NODE-2 — options turn: prompt carries <turn kind="options">, node omitted in result', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(validOptionsOnly));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [event('beat', { speaker: 'narrator', practiceText: 'X' })],
      turn: { kind: 'options', currentNodeKind: 'branch' },
      nonce: 0,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.node).toBeNull();
    expect(specOf(0).requestKind).toBe('options');
    expect(specOf(0).currentNodeKind).toBe('branch');
  });

  it('LIFE-NODE-2 — a stray node on an options turn is DROPPED, not retried', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(validLive));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [event('beat', { speaker: 'narrator', practiceText: 'X' })],
      turn: { kind: 'options', currentNodeKind: 'branch' },
      nonce: 0,
    });
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.node).toBeNull();
  });

  it('LIFE-NODE-8 — live turn without a node retries once with a hint, then ok', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(validOptionsOnly)) // no node → bad for live
      .mockResolvedValueOnce(JSON.stringify(validLive));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [event('decision', { choiceId: 'a', text: 'X' })],
      turn: { kind: 'live', choice: { id: 'a', practiceText: 'X' } },
      nonce: 0,
    });
    expect(result.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    // SRV-PROMPT-12 — the verdict travels as a CODE, not as prose.
    expect(codesOf(1)).toEqual(['live-turn-missing-node']);
  });

  it('LIFE-NODE-8 — two schema failures → schema-failed with both raw attempts', async () => {
    generateGeminiMock
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce(JSON.stringify({ options: [{ id: 'a' }] }));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live' },
      nonce: 3,
    });
    expect(result.kind).toBe('schema-failed');
    if (result.kind === 'schema-failed') {
      expect(result.rawAttempts).toHaveLength(2);
      expect(result.nonce).toBe(3);
    }
  });

  // LIFE-NODE-14 supersedes the original "a thrown Gemini call returns kind
  // error IMMEDIATELY". It did — straight past the retry ladder and into
  // `options-failed`, so one dropped socket became "the story hit a snag" plus
  // a Continue chip whose only job was to make the same call again. A THROWN
  // call now consumes a transport retry instead of abandoning the turn.
  it('LIFE-NODE-14 — a TRANSIENT throw is retried, and the retry’s response is used', async () => {
    generateGeminiMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(JSON.stringify(validLive));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live' },
      nonce: 0,
    });
    expect(result.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
  });

  it('LIFE-NODE-14 — a DETERMINISTIC throw still returns kind error on the first call', async () => {
    // Retrying an expired session spends the player's wait to land in exactly
    // the same place, so the ladder must not arm for it.
    generateGeminiMock.mockRejectedValue(new AppError('auth/session-expired'));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live' },
      nonce: 0,
    });
    expect(result.kind).toBe('error');
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
  });

  it('LIFE-NODE-2 — a broken node fails schema and spends the retry', async () => {
    // The sanitize pass is gone with the lookahead: there are no per-option
    // previews left to individually demote, so a malformed response has
    // nothing salvageable and goes straight to the retry.
    const broken = {
      node: { kind: 'bogus' },
      options: [{ id: 'a', practiceText: 'Avancer', nativeText: 'Move' }],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(broken))
      .mockResolvedValueOnce(JSON.stringify(validLive));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live' },
      nonce: 0,
    });
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe('ok');
  });

  /**
   * LIFE-EX-18 — the PICK no longer decides the graded kind. The three tests
   * below used to assert a repair that read `choice.speechAct` and rewrote the
   * plan to match it (`say` → fill-blank, `hear` → comprehension). That repair
   * is DELETED; the kind is derived from which line the plan actually holds
   * (`deriveGradedKind`, asserted directly in `stepSchema.test.ts`).
   *
   * They are kept, inverted, rather than dropped: "a hear pick flips the plan"
   * was live behaviour for months and the corruption it caused
   * (`sentenceContext` — the PLAYER's line — re-homed into `npcUtterance`,
   * an NPC's mouth, on 2 of 4 `hear` picks) is exactly the kind of thing a
   * later "obvious" fix re-introduces. These are the tests that say no.
   */
  it('LIFE-EX-18 — an ACT pick does NOT flip a player-line plan into an NPC line', async () => {
    // Was a `hear` pick until LIFE-SPEECH-8 retired the value; `act` is where
    // those picks land now, and it is the same test — the question is whether
    // the PICK can override the plan's own fields, and the answer is no for
    // every pick there is.
    generateGeminiMock.mockResolvedValueOnce(
      JSON.stringify({
        node: {
          kind: 'question',
          // LIFE-CONTRACT-EX-7: an act pick MUST narrate. This fixture ran
          // beatless while the pick was `hear`, which exempted it — the
          // exemption LIFE-SPEECH-8 deleted. Adding the beat is not a
          // workaround; it is the fixture becoming a legal turn.
          beats: [
            { speaker: 'narrator', practiceText: 'Tu tends l’oreille.', nativeText: 'You listen closely.' },
          ],
          gradedPlan: {
            kind: 'generation',
            testTarget: 'ça va',
            sentenceContext: 'Ça va bien merci',
          },
        },
        options: [],
      }),
    );
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: {
        kind: 'live',
        choice: { id: 'listen', practiceText: 'Listen to her', speechAct: 'act' },
      },
      nonce: 0,
    });
    expect(generateGeminiMock).toHaveBeenCalledTimes(1); // NO retry, as before
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const plan = (result.node as { gradedPlan?: Record<string, unknown> })
      .gradedPlan;
    // The fields hold a line the PLAYER was going to say. That is a fill-blank
    // whatever the pick claimed — `hear` is the label the model puts on ambient
    // sound (LIFE-SPEECH-7), so it is the weaker signal of the two.
    expect(plan?.kind).toBe('generation');
    expect(plan?.sentenceContext).toBe('Ça va bien merci');
    expect(plan?.testTarget).toBe('ça va');
    expect(plan?.npcUtterance).toBeUndefined();
  });

  it('LIFE-EX-18 — a say-pick does NOT flip an NPC-line plan into a targetless fill-blank', async () => {
    // The old repair produced `{kind:'generation', npcUtterance}` with NO
    // `testTarget` behind an `as` cast. That is not a GradedPlan;
    // `buildGradedQuestionPrompt` threw on `undefined.replace()`, and because
    // `authorQuestion` fires as an uncaught `void` promise the node wedged in
    // `question-authoring` forever. It was later softened to "leave it alone
    // and demote downstream" — and LIFE-SPEECH-4 says there was never anything
    // to demote: a comprehension of the REPLY to what you just said is the
    // natural next move, not a fault.
    generateGeminiMock.mockResolvedValueOnce(
      JSON.stringify({
        node: {
          kind: 'question',
          beats: [
            // LIFE-CONTRACT-EX-7: an act/say pick must narrate. Added when the
            // check landed — these fixtures are about the graded DIRECTION and
            // simply never declared beats, so they were accidentally modelling
            // a turn the contract now forbids.
            { speaker: 'narrator', practiceText: 'Elle se tourne vers toi.', nativeText: 'She turns to you.' },
          ],
          gradedPlan: { kind: 'comprehension', npcUtterance: 'Ça va ?' },
        },
        options: [],
      }),
    );
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: {
        kind: 'live',
        choice: { id: 'greet', practiceText: 'Greet her', speechAct: 'say' },
      },
      nonce: 0,
    });
    expect(generateGeminiMock).toHaveBeenCalledTimes(1); // still no retry
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const plan = (result.node as { gradedPlan?: Record<string, unknown> })
      .gradedPlan;
    expect(plan?.kind).toBe('comprehension');
    expect(plan?.npcUtterance).toBe('Ça va ?');
    expect(plan?.testTarget).toBeUndefined();
  });

  it('LIFE-EX-18 — an "act" pick leaves the graded direction alone', async () => {
    generateGeminiMock.mockResolvedValueOnce(
      JSON.stringify({
        node: {
          kind: 'question',
          beats: [
            // LIFE-CONTRACT-EX-7: an act/say pick must narrate. Added when the
            // check landed — these fixtures are about the graded DIRECTION and
            // simply never declared beats, so they were accidentally modelling
            // a turn the contract now forbids.
            { speaker: 'narrator', practiceText: 'Elle se tourne vers toi.', nativeText: 'She turns to you.' },
          ],
          gradedPlan: { kind: 'comprehension', npcUtterance: 'Ça va ?' },
        },
        options: [],
      }),
    );
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: {
        kind: 'live',
        choice: { id: 'look', practiceText: 'Look around', speechAct: 'act' },
      },
      nonce: 0,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(
      (result.node as { gradedPlan?: { kind?: string } }).gradedPlan?.kind,
    ).toBe('comprehension');
  });

  it('LIFE-NODE-1 — options turn for a continuation enforces the single continue option', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(validOptionsOnly)) // 2 options → wrong for continuation
      .mockResolvedValueOnce(
        JSON.stringify({
          options: [
            { id: 'continue', practiceText: 'Continuer', nativeText: 'Continue' },
          ],
        }),
      );
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [event('beat', { speaker: 'narrator', practiceText: 'X' })],
      turn: { kind: 'options', currentNodeKind: 'continuation' },
      nonce: 0,
    });
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.options[0]!.id).toBe('continue');
  });
});

/**
 * LIFE-NODE-15 — a failed turn is VISIBLE in the debug overlay.
 *
 * Owner report, 2026-08-03: *"Make sure events logged to the debug window in
 * life sim log even if they fail, and log the reason they failed even if they
 * retry."* Every rejection in here used to go to `log.warn` and nowhere else
 * (two of them — invalid JSON and a wrong-shaped response — went NOWHERE), so
 * a snagged turn showed the player a Continue chip and showed the overlay an
 * empty page. The ring buffer is the only trace that survives a route change,
 * which is why "check the console" is not a substitute.
 *
 * These assert the BUFFER, not the console: `log.warn` is mocked separately and
 * stays exactly as it was (the change is additive).
 */
const plainLiveTurn = (nonce = 0) =>
  generateStepOptions({
    uid: 'u1',
    world: baseWorld,
    events: [],
    turn: { kind: 'live' },
    nonce,
  });

describe('LIFE-NODE-15 — every step rejection reaches the debug buffer', () => {
  it('LIFE-NODE-15 — a thrown generate pushes a FAILED entry, not just a console warn', async () => {
    generateGeminiMock.mockRejectedValue(new AppError('auth/session-expired'));

    const result = await plainLiveTurn();

    expect(result.kind).toBe('error');
    expect(failedSummaries().join(' | ')).toMatch(/threw/i);
    const payload = failedPayload(/threw/i);
    expect(payload).toMatchObject({ attempt: 0 });
    expect(String(payload?.err)).toContain('session-expired');
  });

  it('LIFE-NODE-15 — an invalid-JSON attempt is logged with the raw sample', async () => {
    // This path logged NOTHING at all before — not even a console warn. It is
    // also the most common real rejection (a truncated response), so it is the
    // one the overlay most needs to name.
    generateGeminiMock
      .mockResolvedValueOnce('sorry, here is some prose instead')
      .mockResolvedValueOnce(JSON.stringify(validLive));

    const result = await plainLiveTurn();

    expect(result.kind).toBe('ok');
    expect(failedSummaries().join(' | ')).toMatch(/invalid JSON/i);
    const payload = failedPayload(/invalid JSON/i);
    expect(payload).toMatchObject({ attempt: 0 });
    expect(String(payload?.responseSample)).toContain('some prose instead');
    // The verdict that was ACTUALLY sent, so a reader can see what the model
    // was asked to fix without reconstructing it from the source. ⚠ CODES now,
    // not the rendered sentence — the sentences live server-side since
    // SRV-PROMPT-8..13 batch 8, and re-rendering them here to keep the old log
    // text would be the duplication SRV-PROMPT-3 forbids. Nothing parses this
    // payload: the overlay renders it as JSON and the cadence counter reads
    // only `question_demoted`.
    expect(JSON.stringify(payload?.retry)).toContain('invalid-json');
  });

  it('LIFE-NODE-15 — a schema rejection carries the attempt, the issues and a bounded raw sample', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify({ node: { kind: 'bogus' }, options: [] }))
      .mockResolvedValueOnce(JSON.stringify(validLive));

    const result = await plainLiveTurn();

    expect(result.kind).toBe('ok');
    const payload = failedPayload(/schema/i);
    expect(payload).toBeDefined();
    expect(payload).toMatchObject({ attempt: 0 });
    // Structured issues, not a stringified ZodError — the overlay renders the
    // payload as JSON and a reader needs the path + message per issue.
    const issues = payload?.issues as Array<{ path: string; message: string }>;
    expect(Array.isArray(issues)).toBe(true);
    expect(issues.length).toBeGreaterThan(0);
    expect(typeof issues[0]!.path).toBe('string');
    expect(typeof issues[0]!.message).toBe('string');
    expect(String(payload?.responseSample).length).toBeLessThanOrEqual(600);
  });

  it('LIFE-NODE-15 — a wrong-shaped response for the turn is logged', async () => {
    // A live turn that came back with no node. Another path that logged
    // nothing: it set a retry hint and silently went round again.
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(validOptionsOnly))
      .mockResolvedValueOnce(JSON.stringify(validLive));

    const result = await plainLiveTurn();

    expect(result.kind).toBe('ok');
    const payload = failedPayload(/shape/i);
    expect(payload).toBeDefined();
    expect(payload).toMatchObject({ attempt: 0, requestKind: 'live' });
    expect(JSON.stringify(payload?.issues)).toContain('node');
  });

  it('LIFE-NODE-15 — exhaustion emits ONE terminal entry naming the LAST reason', async () => {
    // The final line of the buffer must answer "why did this turn snag"
    // without expanding every attempt above it.
    generateGeminiMock
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce(JSON.stringify({ options: [{ id: 'a' }] }));

    const result = await plainLiveTurn(3);

    expect(result.kind).toBe('schema-failed');
    const terminal = lifeFailedMock.mock.calls.filter((c) => /exhaust/i.test(c[1]));
    expect(terminal).toHaveLength(1);
    const payload = terminal[0]![2];
    expect(payload).toMatchObject({ attempts: 2 });
    // The LAST reason, not the first: attempt 0 was invalid JSON, attempt 1
    // failed schema, and the snag the player saw was caused by attempt 1.
    expect(String(payload?.lastReason)).toMatch(/schema/i);
  });

  it('LIFE-NODE-15 — a canon rejection that spends a retry is logged as a failure', async () => {
    const spirit: LifeWorld = {
      ...baseWorld,
      canon: {
        characters: [
          { id: 'n-mireille', name: 'Mireille', kind: 'spirit', note: '', canSpeak: false },
        ],
        places: [], objects: [], facts: [],
      },
    };
    const bad = {
      options: [
        { id: 'a', practiceText: 'Show Sophie the key', nativeText: 'Show Sophie the key',
          targetId: 'n-sophie' },
        { id: 'b', practiceText: 'Wait', nativeText: 'Wait' },
      ],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(bad))
      .mockResolvedValueOnce(JSON.stringify(validOptionsOnly));

    const result = await generateStepOptions({
      uid: 'u1', world: spirit, events: [], nonce: 1,
      turn: { kind: 'options', currentNodeKind: 'branch' },
    });

    expect(result.kind).toBe('ok');
    const payload = failedPayload(/canon|entity/i);
    expect(payload).toBeDefined();
    expect(payload).toMatchObject({ attempt: 0 });
    expect(JSON.stringify(payload?.issues)).toContain('unknown-entity-ref');
    // The offending id is still in the buffer — on the structured VERDICT
    // rather than inside a rendered hint. LIFE-NODE-15.1's point was that the
    // entry must name the rule that actually fired and what to go and look at;
    // moving the sentence server-side (SRV-PROMPT-12) must not take the facts
    // with it.
    expect(JSON.stringify(payload?.verdict)).toContain('n-sophie');
    expect(JSON.stringify(payload?.verdict)).toContain('unknown-entity-ref');
  });

  // LIFE-EX-18 — "an UNREPAIRABLE graded direction is a failure entry" was
  // here. A say-pick answered with a comprehension plan is no longer a fault of
  // any level (LIFE-SPEECH-4 calls it the natural move), so there is no entry
  // to assert. The replacement — that neither direction reports ANYTHING now —
  // is in the repair block below, where its counterpart warn test lived.
});

/**
 * LIFE-NODE-15(c) — a RECOVERED fault is warn-level, but NOT `-FAILED`.
 *
 * `lifeFailed` tags `LIFE/STEP-FAILED`. The beat clamp fires on the ORDINARY
 * `say` turn, so routing it through `lifeFailed` would stamp a FAILED badge on
 * every healthy speech turn and bury the real failures the overlay exists to
 * surface. `lifeWarn` keeps the amber level (it IS a problem) under the honest
 * `LIFE/STEP` tag.
 */
describe('LIFE-NODE-15 — an in-place repair is warn-level, not a failure', () => {
  it('LIFE-NODE-15 — the LIFE-LANG-13.1 beat clamp logs a warn, never a FAILED', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(twoBeats));

    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live', choice: { id: 'a', practiceText: 'Dire bonjour', saysLine: 'Bonjour !' } },
      nonce: 1,
    });

    expect(result.kind).toBe('ok');
    expect(warnSummaries().join(' | ')).toMatch(/clamp/i);
    expect(lifeFailedMock).not.toHaveBeenCalled();
    const payload = warnPayload(/clamp/i);
    expect(payload).toMatchObject({ was: 2, reason: 'says-line' });
  });

  /**
   * LIFE-EX-18 — the direction repair reported a warn on one branch and a
   * FAILED on the other. Both are gone, so both branches must now be SILENT.
   *
   * Asserting silence is the weaker kind of test, and it is here for a specific
   * reason: the two payload shapes it replaces (`{was, now}` and
   * `{was, wanted}`) are what a reader of the debug overlay would look for to
   * conclude "the model got the direction wrong again". Leaving no assertion at
   * all would let a future repair reappear and go unnoticed until it corrupted
   * a turn — which is how the first one survived as long as it did.
   */
  it('LIFE-EX-18 — neither graded direction reports a warn or a failure', async () => {
    const plans = [
      // act pick + a PLAYER line — the branch that used to warn and flip (it
      // was a `hear` pick then; LIFE-SPEECH-8 folded those into `act`, which
      // is also why this one now carries the lead-in beat the validator asks
      // of every action).
      {
        choice: { id: 'listen', practiceText: 'Listen to her', speechAct: 'act' as const },
        gradedPlan: { kind: 'generation', testTarget: 'ça va', sentenceContext: 'Ça va bien merci' },
        beats: [
          { speaker: 'narrator', practiceText: 'Tu tends l’oreille.', nativeText: 'You listen closely.' },
        ],
      },
      // say pick + an NPC line — the branch that used to log `-FAILED`.
      {
        choice: { id: 'greet', practiceText: 'Greet her', speechAct: 'say' as const },
        gradedPlan: { kind: 'comprehension', npcUtterance: 'Ça va ?' },
        beats: [
          { speaker: 'narrator', practiceText: 'Elle se tourne vers toi.', nativeText: 'She turns to you.' },
        ],
      },
    ];

    for (const { choice, gradedPlan, beats } of plans) {
      lifeFailedMock.mockClear();
      lifeWarnMock.mockClear();
      generateGeminiMock.mockResolvedValueOnce(
        JSON.stringify({ node: { kind: 'question', beats, gradedPlan }, options: [] }),
      );

      const result = await generateStepOptions({
        uid: 'u1',
        world: baseWorld,
        events: [],
        turn: { kind: 'live', choice },
        nonce: 0,
      });

      expect(result.kind, choice.speechAct).toBe('ok');
      expect(lifeFailedMock, choice.speechAct).not.toHaveBeenCalled();
      expect(warnSummaries().join(' | '), choice.speechAct).not.toMatch(/direction|repair/i);
    }
  });

  it('LIFE-NODE-15 — a clean turn logs no warn and no failure at all', async () => {
    // The guard against the other failure mode: an overlay that cries wolf on
    // every turn is as useless as one that says nothing.
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(validLive));

    const result = await plainLiveTurn();

    expect(result.kind).toBe('ok');
    expect(lifeFailedMock).not.toHaveBeenCalled();
    expect(lifeWarnMock).not.toHaveBeenCalled();
  });
});

describe('moved helpers', () => {
  it('recentGenerationTargets dedups + lowercases correction targets', () => {
    const events = [
      event('correction', { kind: 'generation', correctAnswer: 'Voudrais' }),
      event('correction', { kind: 'generation', correctAnswer: 'voudrais' }),
      event('correction', { kind: 'comprehension', correctAnswer: 'ignored' }),
    ];
    expect(recentGenerationTargets(events)).toEqual(['voudrais']);
  });

  it('LIFE-CTX-3 / LIFE-LANG-7 — buildGradedSceneContext carries saga title, location, speaker, last beats, difficulty + systemLanguage', () => {
    const ctx = buildGradedSceneContext(
      {
        ...baseWorld,
        currentLocationLabel: 'Le café · matin',
        saga: undefined,
      },
      [
        event('beat', { practiceText: 'Un.' }),
        event('beat', { practiceText: 'Deux.' }),
        event('beat', { practiceText: 'Trois.' }),
        event('beat', { practiceText: 'Quatre.' }),
      ],
      { kind: 'comprehension', npcUtterance: 'Salut ?', speakerName: 'Sophie' },
    );
    expect(ctx.locationLabel).toBe('Le café · matin');
    expect(ctx.speakerName).toBe('Sophie');
    expect(ctx.recentBeats).toEqual(['Deux.', 'Trois.', 'Quatre.']);
    // LIFE-CTX-3: the player's level rides in the graded scene context so
    // the question generator can calibrate target + distractor complexity.
    expect(ctx.difficulty).toBe(3);
    // LIFE-LANG-7: legacy world (no systemLanguage) falls back to native.
    expect(ctx.systemLanguage).toBe('English');
  });

  it('LIFE-LANG-7 — buildGradedSceneContext uses world.systemLanguage when set', () => {
    const ctx = buildGradedSceneContext(
      { ...baseWorld, systemLanguage: 'German', saga: undefined },
      [],
      { kind: 'generation', testTarget: 'x', sentenceContext: 'x y' },
    );
    expect(ctx.systemLanguage).toBe('German');
  });
});

/**
 * LIFE-CANON-2/3 — the validator has TEETH. Before this, `validateNodeResponse`
 * computed issues and `log.warn`'d them; the offending response shipped to the
 * player anyway, which is why these two failures survived every prompt revision.
 */
describe('generateStepOptions — canon enforcement (LIFE-CANON-2/3)', () => {
  const spirit: LifeWorld = {
    ...baseWorld,
    canon: {
      characters: [
        { id: 'n-mireille', name: 'Mireille', kind: 'spirit', note: '', canSpeak: false },
      ],
      places: [], objects: [], facts: [],
    },
  };
  const call = (world: LifeWorld) =>
    generateStepOptions({
      uid: 'u1', world, events: [], nonce: 1,
      turn: { kind: 'options', currentNodeKind: 'branch' },
    });

  it('regenerates when an option targets an entity that does not exist', async () => {
    const bad = {
      options: [
        { id: 'a', practiceText: 'Show Sophie the key', nativeText: 'Show Sophie the key',
          targetId: 'n-sophie' },
        { id: 'b', practiceText: 'Wait', nativeText: 'Wait' },
      ],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(bad))
      .mockResolvedValueOnce(JSON.stringify(validOptionsOnly));

    const res = await call(spirit);

    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    // The retry names the offending option AND the unknown id, so the model
    // has something specific to fix rather than a generic scolding.
    // Asserted as the WHOLE violation, not `toContain(code)`: batch 7 found a
    // swapped-parameter mutation surviving a code-only check, with the code
    // right and the sentence wrong.
    expect(retryOf(1)).toEqual([
      { code: 'unknown-entity-ref', optionId: 'a', targetId: 'n-sophie' },
    ]);
    expect(res.kind).toBe('ok');
    expect(res.kind === 'ok' && res.options[0]?.id).toBe('a');
  });

  it('does NOT regenerate when an option addresses a mute entity — it is a valid action', async () => {
    // The affordance REJECTION was removed: measuring it against real Gemini
    // showed the model keeps such an entity mute, so rejecting only suppressed
    // a legitimate option and burned a retry. The mute-response rendering is
    // fixed deterministically at commit time (commitNode → narrator beat).
    const ok = {
      options: [
        { id: 'ask', practiceText: 'Ask Mireille', nativeText: 'Ask Mireille what she wants',
          targetId: 'n-mireille' },
        { id: 'b', practiceText: 'Wait', nativeText: 'Wait' },
      ],
    };
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(ok));

    const res = await call(spirit);

    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe('ok');
  });

  it('ships the second attempt even if it still violates — the player is never stuck', async () => {
    const bad = {
      options: [
        { id: 'a', practiceText: 'Show Sophie the key', nativeText: 'Show Sophie the key',
          targetId: 'n-sophie' },
        { id: 'b', practiceText: 'Wait', nativeText: 'Wait' },
      ],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(bad))
      .mockResolvedValueOnce(JSON.stringify(bad));

    const res = await call(spirit);

    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(res.kind).toBe('ok');
  });

  it('a legacy world with no canon never fails a check it cannot satisfy', async () => {
    const bad = {
      options: [
        { id: 'a', practiceText: 'Show Sophie the key', nativeText: 'Show Sophie the key',
          targetId: 'n-sophie' },
        { id: 'b', practiceText: 'Wait', nativeText: 'Wait' },
      ],
    };
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(bad));

    const res = await call(baseWorld);

    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe('ok');
  });
});

/**
 * LIFE-GRID-6 — the dangled goal, and the wiring that makes it a rule.
 *
 * `gradeOptionSet` was written as the REJECT half of LIFE-GRID-1.1/1.2, given
 * its own unit tests, and never called from anywhere in `src`. Its rules were
 * therefore advice: the prompt asked the model not to repeat a shape, nothing
 * checked that it hadn't. These tests assert the CALL, not the grader — the
 * grader's own behaviour is covered in `optionGrid.test.ts`, and the defect
 * being fixed is precisely that a covered function had no caller.
 */
describe('generateStepOptions — the option-grid backstop is wired (LIFE-GRID-6)', () => {
  const took = (targetId: string) =>
    event('decision', { actionType: 'do', targetId, label: 'Take the letter' });

  const dangling = {
    options: [
      { id: 'a', nativeText: 'Take the letter', actionType: 'do', targetId: 'letter' },
      { id: 'b', nativeText: 'Wait', actionType: 'observe' },
    ],
  };
  const clean = {
    options: [
      { id: 'a', nativeText: 'Head for the door', actionType: 'move', targetId: 'door' },
      { id: 'b', nativeText: 'Wait', actionType: 'observe' },
    ],
  };
  const call = (events: LifeEvent[]) =>
    generateStepOptions({
      uid: 'u1', world: baseWorld, events, nonce: 1,
      turn: { kind: 'options', currentNodeKind: 'branch' },
    });

  it('LIFE-GRID-6 — regenerates a grid that re-offers a goal taken twice', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dangling))
      .mockResolvedValueOnce(JSON.stringify(clean));

    const res = await call([took('letter'), took('letter')]);

    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    // The retry names the SHAPE, so the model is told which goal to resolve
    // rather than being asked generically for "something different".
    expect(retryOf(1)).toEqual([{ code: 'dangled-goal', goal: 'do:letter', takes: 2 }]);
    expect(res.kind).toBe('ok');
    expect(res.kind === 'ok' && res.options[0]?.id).toBe('a');
    expect(failedSummaries().join(' ')).toMatch(/option grid rejected/);
  });

  it('LIFE-GRID-6 — a goal taken ONCE is not a dangle; one repeat is ordinary', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(dangling));

    const res = await call([took('letter')]);

    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe('ok');
  });

  it('LIFE-GRID-6 — a different target the player never took is untouched', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(dangling));

    const res = await call([took('ledger'), took('ledger')]);

    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe('ok');
  });

  it('LIFE-GRID-6 — the last attempt SHIPS the dangle and warns; never a wall', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dangling))
      .mockResolvedValueOnce(JSON.stringify(dangling));

    const res = await call([took('letter'), took('letter')]);

    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(res.kind).toBe('ok');
    expect(warnSummaries().join(' ')).toMatch(/no retry left/);
    expect(warnPayload(/no retry left/)).toMatchObject({
      violation: 'dangled-goal',
      goal: 'do:letter',
    });
  });

  it('LIFE-GRID-6 — options with no actionType are skipped, never coerced', async () => {
    // The field is REQUIRED in the output contract and 0 of 1,980 archived
    // grids omitted it — but a response that does must not be turned into an
    // "all options are ask" violation by a default. The whole grid is
    // type-less here, so the grader has fewer than two shapes and stands down.
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(validOptionsOnly));

    const res = await call([took('letter'), took('letter')]);

    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe('ok');
  });

  it('LIFE-GRID-6 — the SPREAD rules are not this check\'s job any more', () => {
    // An all-one-type grid is rejected, but by `optionSpreadIssues` at the
    // request-shape stage — ~150 lines earlier, and stricter (it demands EVERY
    // option differ). The duplicate rules were removed from `gradeOptionSet`
    // rather than left to shadow it. Pinned here so a future re-add of the
    // duplicate has somewhere to fail.
    expect(gradeOptionSet([{ type: 'ask', targetId: 'x' }, { type: 'ask', targetId: 'y' }], null).ok)
      .toBe(true);
  });

});

/**
 * LIFE-CONTRACT-EX-7 — the lead-in is REQUIRED after an action.
 *
 * MEASURED over 65 archived runs / 712 question turns whose preceding pick was
 * an action: 13.8% narrate nothing. That is the owner's original report still
 * happening, one invariant after LIFE-CONTRACT-EX-6 was supposed to fix it.
 *
 * The tell is inside a single bullet PAIR in `step.ts`: the half about leaking
 * the tested line ends "This is CHECKED; a leak is rejected and you will be
 * asked to redo the turn", and it is checked. The half about narrating the
 * action says MUST and was checked by nothing. The model obeys the checked one.
 */
describe('generateStepOptions — a question must narrate the action (LIFE-CONTRACT-EX-7)', () => {
  const questionNode = (beats: unknown[]) => ({
    node: {
      kind: 'question',
      beats,
      gradedPlan: {
        kind: 'comprehension',
        npcUtterance: 'Rends-moi ça.',
        speakerName: 'Rémy',
      },
    },
    options: [],
  });
  const leadIn = [
    {
      speaker: 'narrator',
      practiceText: 'Tu attrapes la lettre ; Rémy la retire.',
      nativeText: 'You grab the letter; Rémy pulls it back.',
    },
  ];
  const call = (speechAct?: 'say' | 'act') =>
    generateStepOptions({
      uid: 'u1', world: baseWorld, events: [], nonce: 1,
      turn: {
        kind: 'live',
        choice: { id: 'grab', practiceText: 'Grab the letter', ...(speechAct ? { speechAct } : {}) },
      },
    });

  it('LIFE-CONTRACT-EX-7 — an "act" pick with a bare question node is REGENERATED', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(questionNode([])))
      .mockResolvedValueOnce(JSON.stringify(questionNode(leadIn)));

    const res = await call('act');

    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(res.kind).toBe('ok');
    // NOT `beatsOf` — that helper narrows the union to the non-question arms,
    // so on the very node this test is about it can only return undefined.
    expect((res.kind === 'ok' ? res.node : null) as { beats?: unknown[] } | null)
      .toMatchObject({ beats: [expect.objectContaining({ speaker: 'narrator' })] });
    // The retry must say what went missing, not scold generically.
    expect(retryOf(1)).toEqual([{ code: 'question-omits-lead-in' }]);
  });

  /**
   * LIFE-CONTRACT-EX-10 — REVERSED 2026-08-10, on measurement.
   *
   * This asserted that a `say` pick with no lead-in must be retried, on the
   * rationale in its old title: "speech is an act with consequences". That was
   * never measured, and three things contradict it:
   *
   *  · The shipped system instruction has ALWAYS told the model the opposite —
   *    "a question that follows a pure SPEECH pick needs no lead-in, the pick
   *    and the speech are the same act, so emit `beats: []`". The model obeyed
   *    and this rejected it.
   *  · `LIFE-SPEECH-2`: the player's line is already on screen — the client
   *    prepends it the instant they pick, one call before this. EX-7's premise
   *    is "their action never happened on screen", which is simply false here.
   *  · Demanding a lead-in on a `say` -> comprehension turn forces the EX-8
   *    trap: the only thing left to narrate is the NPC's reply, which IS the
   *    line under test, so the leak-repair strips it and EX-7 fires again.
   *
   * MEASURED: 9 of the 20 `question-omits-lead-in` rejections across four runs
   * of the shipped prompt were `say` picks — 45% of the defect was the model
   * being right, which is why four prompt rewrites could not move the number.
   */
  it('LIFE-CONTRACT-EX-10 — a "say" pick needs NO lead-in; the line is already on screen', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(questionNode([])));

    const res = await call('say');

    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe('ok');
  });

  /**
   * LIFE-SPEECH-8 — `a "hear" pick is EXEMPT: the NPC speaking IS the event`
   * was here, and it was the ONLY live behaviour `hear` ever had.
   *
   * The exemption was sound for what `hear` was designed to mean and wrong for
   * what it was used for: all 4 `hear` options ever authored were ambient sound
   * ("Listen at the door for guard activity"), which is a player ACTION whose
   * physical outcome the next node owes a beat. The exemption suppressed the
   * lead-in on exactly those turns.
   *
   * Those picks are now `act`, so their coverage is the REGENERATED case above
   * — the opposite answer, deliberately. This note is the record that the
   * expectation was inverted on purpose rather than the test being dropped.
   */

  it('LIFE-CONTRACT-EX-7 — a turn with NO pick is exempt; nothing can have gone missing', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(questionNode([])));

    const res = await generateStepOptions({
      uid: 'u1', world: baseWorld, events: [], nonce: 1,
      turn: { kind: 'live', choice: null, freeText: null },
    });

    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe('ok');
  });

  it('LIFE-CONTRACT-EX-7 — a question that DOES narrate passes first time', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(questionNode(leadIn)));

    const res = await call('act');

    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(res.kind).toBe('ok');
  });

  /**
   * LIFE-NODE-15.1 — the rejection is named by the rule that ACTUALLY fired.
   *
   * The `lifeFailed` summary was the fixed string "step rejected: canon
   * (unknown entity) → retrying" and `lastReason` a fixed `canon: …`, but the
   * blocking set is THREE codes and only one of them is a canon fault. Over
   * the 2026-08-07 archive the split was `question-omits-lead-in` 15,
   * `unknown-entity-ref` 2 — so **83% of retries were reported to the overlay
   * as a canon fault they had nothing to do with** (LIFE-CONTRACT-EX-9).
   *
   * That is why the owner's "there's also many life steps failed" report was
   * undiagnosable: the overlay named the wrong cause on nearly every one, and
   * the real cause (the SI contradicting itself about question beats) was
   * sitting behind a label pointing at the entity ledger.
   */
  it('LIFE-NODE-15.1 — a lead-in rejection is NOT reported as a canon fault', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(questionNode([])))
      .mockResolvedValueOnce(JSON.stringify(questionNode(leadIn)));

    await call('act');

    const summary = failedSummaries().find((s) => /rejected/i.test(s)) ?? '';
    expect(summary).toContain('question-omits-lead-in');
    // The precise mislabel that shipped: no canon fault occurred here.
    expect(summary).not.toMatch(/canon/i);
    expect(summary).not.toMatch(/unknown entity/i);
  });

  it('LIFE-CONTRACT-EX-7 — the last attempt SHIPS the bare question; never a wall', async () => {
    // LIFE-NODE-8: the player is never stranded behind a validator.
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(questionNode([])))
      .mockResolvedValueOnce(JSON.stringify(questionNode([])));

    const res = await call('act');

    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(res.kind).toBe('ok');
  });
});

/**
 * LIFE-CONTRACT-EX-8 — the leak is REPAIRED in the shipped ladder.
 *
 * `leadInBeats.test.ts` covers `stripLeakingLeadIns` in isolation. This asserts
 * it is WIRED, because the whole reason the defect reached a screenshot is that
 * the detector for it WAS wired and still could not win: EX-7 rejects a bare
 * question node and hints "the world reacting to it", the model answers with the
 * NPC's line, and `MAX_ATTEMPTS` is 2 — so the second violation ships.
 *
 * The sequence below is the one from the owner's 2026-08-07 trace, verbatim:
 *   09:55:50  step rejected  → question-omits-lead-in   (attempt 0)
 *   09:55:53  shipped anyway → lead-in-leaks-tested-line (attempt 1, blocking:1)
 */
describe('generateStepOptions — a leaked lead-in is repaired (LIFE-CONTRACT-EX-8)', () => {
  const TESTED = 'Attention, James ! Le métal est très vieux et il peut tomber sur tes pieds, eh ?';
  const node = (beats: unknown[]) => ({
    node: {
      kind: 'question',
      beats,
      gradedPlan: { kind: 'comprehension', npcUtterance: TESTED, speakerName: 'Madame Mora' },
    },
    options: [],
  });
  const action = {
    speaker: 'narrator',
    practiceText: 'Tu montes sur un vieux tabouret pour inspecter les grilles de plus près.',
    nativeText: 'You climb onto an old stool to inspect the grilles more closely.',
  };
  const leak = { speaker: 'npc', speakerName: 'Madame Mora', practiceText: TESTED, nativeText: 'Careful, James!' };
  const questionBeats = (res: Awaited<ReturnType<typeof generateStepOptions>>) =>
    ((res.kind === 'ok' ? res.node : null) as { beats?: { practiceText: string }[] } | null)?.beats;

  const call = () =>
    generateStepOptions({
      uid: 'u1', world: baseWorld, events: [], nonce: 1,
      turn: { kind: 'live', choice: { id: 'inspect', practiceText: 'Look closer at the grille', speechAct: 'act' } },
    });

  it('the ping-pong no longer ships the leak — the tested line never reaches the player', async () => {
    // Attempt 0 omits the lead-in (EX-7). Attempt 1 obeys the hint and leaks.
    // Before EX-8 the second one shipped as-is, which is the screenshot.
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(node([])))
      .mockResolvedValueOnce(JSON.stringify(node([action, leak])));

    const beats = questionBeats(await call());

    expect(beats).toHaveLength(1);
    expect(beats!.map((b) => b.practiceText)).not.toContain(TESTED);
  });

  it('keeps the player\'s action — repair removes the leak, not the lead-in', async () => {
    // The failure mode to avoid while fixing this: dropping ALL beats would
    // satisfy "no leak" and re-create the EX-7 defect it was built to fix.
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(node([])))
      .mockResolvedValueOnce(JSON.stringify(node([action, leak])));

    // Asserts the EXACT surviving set, not just `[0]` — reading index 0 alone
    // passes just as happily on the unrepaired `[action, leak]` pair, so it
    // would have discriminated nothing.
    expect(questionBeats(await call())!.map((b) => b.practiceText)).toEqual([
      action.practiceText,
    ]);
  });

  // Not a discriminator — it passes with or without the repair — but it pins
  // the thing most likely to be got wrong by a later "fix": implementing this
  // as a THIRD retry instead of an edit, which would put another Gemini call
  // on the turn the player is waiting for.
  it('costs NO extra Gemini call — it is a repair, not another retry', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(node([])))
      .mockResolvedValueOnce(JSON.stringify(node([action, leak])));

    await call();

    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
  });

  it('logs the strip, so the rate stays measurable instead of silent', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(node([])))
      .mockResolvedValueOnce(JSON.stringify(node([action, leak])));

    await call();

    expect(warnSummaries().join(' | ')).toMatch(/lead-in leaked the tested line/);
  });

  it('a leak on the FIRST attempt is repaired too, and never reaches the validator', async () => {
    // Repair runs BEFORE validation, so this turn ships on one call — the old
    // path spent a retry telling the model something code can simply fix.
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(node([action, leak])));

    const res = await call();

    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(questionBeats(res)).toHaveLength(1);
  });

  it('a node whose ONLY beat leaked is then told it narrated nothing (EX-7, not EX-6)', async () => {
    // The ordering assertion. After repair the node has no beats, which is a
    // true EX-7 violation — so the retry hint must name the MISSING ACTION, not
    // a leak the node no longer contains.
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(node([leak])))
      .mockResolvedValueOnce(JSON.stringify(node([action])));

    await call();

    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    // The ordering assertion, in codes: after the leak repair the node has no
    // beats, so the verdict must be the MISSING ACTION and not the leak.
    expect(codesOf(1)).toEqual(['question-omits-lead-in']);
    expect(codesOf(1)).not.toContain('lead-in-leaks-tested-line');
  });
});
