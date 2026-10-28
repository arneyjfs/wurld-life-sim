import { describe, it, expect } from 'vitest';
import {
  deriveGradedKind,
  WRITE_YOUR_OWN_ID,
  ZGradedPlan,
  ZNodePreview,
  ZStepBeat,
  ZPracticePrompt,
  ZRawNodeResponse,
  ZStepChoice,
  ZStepOption,
  optionCountIssues,
  repairStepResponse,
} from './stepSchema';
import { ZLifeBeatPayload } from '@/types/lifeBeat';

const narratorBeat = {
  speaker: 'narrator',
  practiceText: 'Tu te réveilles.',
  nativeText: 'You wake up.',
};

const opt = (id: string, extra: Record<string, unknown>) => ({
  id,
  practiceText: `option ${id}`,
  nativeText: `option ${id} gloss`,
  ...extra,
});

const liveBranchResponse = {
  node: { kind: 'branch', beats: [narratorBeat] },
  options: [opt('a', {}), opt('b', {})],
};

describe('ZNodePreview — LIFE-NODE-1', () => {
  it('LIFE-NODE-1 — accepts a branch node with 0 beats (post-comprehension case)', () => {
    expect(ZNodePreview.safeParse({ kind: 'branch', beats: [] }).success).toBe(true);
    expect(ZNodePreview.safeParse({ kind: 'branch' }).success).toBe(true);
  });

  it('LIFE-NODE-1 — rejects a branch node with 3 beats', () => {
    const r = ZNodePreview.safeParse({
      kind: 'branch',
      beats: [narratorBeat, narratorBeat, narratorBeat],
    });
    expect(r.success).toBe(false);
  });

  it('LIFE-NODE-1 — continuation requires 1-2 beats', () => {
    expect(ZNodePreview.safeParse({ kind: 'continuation', beats: [] }).success).toBe(false);
    expect(
      ZNodePreview.safeParse({ kind: 'continuation', beats: [narratorBeat] }).success,
    ).toBe(true);
  });

  /**
   * LIFE-CONTRACT-EX-6 REVERSED the old half of this test. `question` used to
   * strip beats outright, which meant a pick that triggered a question had
   * nowhere to be narrated and vanished from the story. The node now carries
   * 0-2 LEAD-IN beats — the player's action landing before the intercept.
   */
  it('LIFE-NODE-1 / LIFE-CONTRACT-EX-6 — question carries a gradedPlan and may carry a lead-in', () => {
    const r = ZNodePreview.safeParse({
      kind: 'question',
      gradedPlan: {
        kind: 'generation',
        testTarget: 'voudrais',
        sentenceContext: 'Je voudrais un café.',
      },
      beats: [narratorBeat],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind === 'question' && r.data.beats).toHaveLength(1);
    expect(ZNodePreview.safeParse({ kind: 'question' }).success).toBe(false);
  });

  it('LIFE-CONTRACT-EX-6 — the lead-in defaults to EMPTY, so a beatless question still parses', () => {
    // Every question node the model has ever emitted omits the field, and the
    // client-intercepted `say` path builds one deliberately without it.
    const r = ZNodePreview.safeParse({
      kind: 'question',
      gradedPlan: { kind: 'comprehension', npcUtterance: 'Ça va ?' },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind === 'question' && r.data.beats).toEqual([]);
  });

  it('LIFE-CONTRACT-EX-6 — the lead-in is capped at 2, same as a branch', () => {
    const r = ZNodePreview.safeParse({
      kind: 'question',
      gradedPlan: { kind: 'comprehension', npcUtterance: 'Ça va ?' },
      beats: [narratorBeat, narratorBeat, narratorBeat],
    });
    expect(r.success).toBe(false);
  });

  it('LIFE-NODE-2 — preview may carry a backdropIntent', () => {
    const r = ZNodePreview.safeParse({
      kind: 'branch',
      beats: [narratorBeat],
      backdropIntent: {
        locationType: 'cafe',
        vibe: 'modern_city',
        persistent: true,
        locationLabel: 'Le café · matin',
      },
    });
    expect(r.success).toBe(true);
  });
});

describe('ZRawNodeResponse — LIFE-NODE-2 superRefine matrix', () => {
  it('LIFE-NODE-2 — accepts a live branch response (options are plain chips)', () => {
    expect(ZRawNodeResponse.safeParse(liveBranchResponse).success).toBe(true);
  });

  it('LIFE-NODE-2 — a stray `next`/`noPreview` is STRIPPED, not honoured', () => {
    // The lookahead is gone. A model still emitting the retired fields (or an
    // old cached response replayed) must not smuggle a preview through — the
    // parsed option carries neither key, so nothing downstream can read one.
    const r = ZRawNodeResponse.safeParse({
      ...liveBranchResponse,
      options: [
        opt('a', { next: { kind: 'branch', beats: [narratorBeat] } }),
        opt('b', { noPreview: true }),
      ],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.options[0]).not.toHaveProperty('next');
      expect(r.data.options[1]).not.toHaveProperty('noPreview');
    }
  });

  it('LIFE-NODE-2 — rejects more than 3 options', () => {
    const bad = {
      ...liveBranchResponse,
      options: [opt('a', {}), opt('b', {}), opt('c', {}), opt('d', {})],
    };
    expect(ZRawNodeResponse.safeParse(bad).success).toBe(false);
  });

  it('LIFE-NODE-1 — live branch node requires 2-3 options', () => {
    const one = { ...liveBranchResponse, options: [opt('a', {})] };
    expect(ZRawNodeResponse.safeParse(one).success).toBe(false);
  });

  it('LIFE-NODE-1 — live continuation node requires exactly one option with id "continue"', () => {
    const good = {
      node: { kind: 'continuation', beats: [narratorBeat] },
      options: [opt('continue', {})],
    };
    expect(ZRawNodeResponse.safeParse(good).success).toBe(true);
    const wrongId = {
      node: { kind: 'continuation', beats: [narratorBeat] },
      options: [opt('go', {})],
    };
    expect(ZRawNodeResponse.safeParse(wrongId).success).toBe(false);
  });

  it('LIFE-NODE-1 — live question node requires EMPTY options (generator authors chips)', () => {
    const questionNode = {
      kind: 'question',
      gradedPlan: {
        kind: 'comprehension',
        npcUtterance: 'Combien ça coûte ?',
      },
    };
    expect(
      ZRawNodeResponse.safeParse({ node: questionNode, options: [] }).success,
    ).toBe(true);
    expect(
      ZRawNodeResponse.safeParse({
        node: questionNode,
        options: [opt('a', {}), opt('b', {})],
      }).success,
    ).toBe(false);
  });

  it('LIFE-NODE-5 (retired) — the hook-accept chip needs no special casing', () => {
    // It used to be REQUIRED to carry noPreview so accepting routed live
    // (sceneGenerate authors what follows). Every pick routes live now, so
    // the accept chip is just an option — and must parse as one.
    const r = ZRawNodeResponse.safeParse({
      node: { kind: 'branch', beats: [narratorBeat] },
      scene: {
        hook: { hookId: 'h1', pitch: 'A stranger beckons', acceptChipId: 'accept' },
      },
      options: [opt('accept', {}), opt('decline', {})],
    });
    expect(r.success).toBe(true);
  });

  it('LIFE-NODE-2 — options-mode responses (no node) skip the count rule at schema level', () => {
    // The client supplies currentNodeKind — generateStepOptions
    // enforces counts via optionCountIssues there.
    const r = ZRawNodeResponse.safeParse({
      options: [opt('continue', {})],
    });
    expect(r.success).toBe(true);
  });
});

describe('optionCountIssues — LIFE-NODE-1 (options-mode counts)', () => {
  const o = (id: string) => ({ id });
  it('LIFE-NODE-1 — branch wants 2-3', () => {
    expect(optionCountIssues([o('a')], 'branch')).toHaveLength(1);
    expect(optionCountIssues([o('a'), o('b')], 'branch')).toHaveLength(0);
  });
  it('LIFE-NODE-1 — continuation wants exactly one "continue"', () => {
    expect(optionCountIssues([o('continue')], 'continuation')).toHaveLength(0);
    expect(optionCountIssues([o('go')], 'continuation')).toHaveLength(1);
    expect(optionCountIssues([o('continue'), o('x')], 'continuation')).toHaveLength(1);
  });
  it('LIFE-NODE-1 — question wants zero', () => {
    expect(optionCountIssues([], 'question')).toHaveLength(0);
    expect(optionCountIssues([o('a')], 'question')).toHaveLength(1);
  });
});

describe('WRITE_YOUR_OWN_ID — LIFE-NODE-4', () => {
  it('LIFE-NODE-4 — is the pinned "__write__" id', () => {
    expect(WRITE_YOUR_OWN_ID).toBe('__write__');
  });
});

/**
 * LIFE-EX-19 — the WIRE says `fill-blank`, the CODE says `generation`.
 *
 * These are the only tests in the suite that feed the wire value, and they
 * exist because of a hole the rename itself opened: every other fixture was
 * rewritten to `'generation'` in the same pass, so the suite went green while
 * testing nothing about the translation the model's output actually depends on.
 * A rename that updates its own fixtures cannot verify itself.
 *
 * If these two seams ever stop translating, EVERY graded turn fails to parse.
 */
describe('LIFE-EX-19 — the wire name translates at both parse seams', () => {
  it('ZGradedPlan: a plan declaring the WIRE kind parses as `generation`', () => {
    const r = ZGradedPlan.safeParse({
      kind: 'fill-blank',
      testTarget: 'voudrais',
      sentenceContext: 'Je voudrais un café.',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe('generation');
  });

  it('ZPracticePrompt: the generator’s WIRE kind parses as `generation`', () => {
    const r = ZPracticePrompt.safeParse({
      kind: 'fill-blank',
      practiceText: 'Je ___ un café',
      completedNativeText: 'I would like a coffee',
      disambiguation: 'context-anchor',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe('generation');
  });

  it('the fields still win over a WIRE declaration that contradicts them', () => {
    // LIFE-EX-18 is unchanged by the rename: a plan holding an NPC's line is a
    // comprehension however it is labelled, in either vocabulary.
    const r = ZGradedPlan.safeParse({
      kind: 'fill-blank',
      npcUtterance: 'Le café est fermé.',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe('comprehension');
  });

  it('`comprehension` is spelled the same on both sides and passes through', () => {
    const r = ZGradedPlan.safeParse({ kind: 'comprehension', npcUtterance: 'Ça va ?' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe('comprehension');
  });
});

describe('ZGradedPlan — LIFE-EX-PLAN-2 (unchanged shapes)', () => {
  it('accepts a fill-blank plan with testTarget + sentenceContext', () => {
    const plan = {
      kind: 'generation' as const,
      testTarget: 'quand même',
      sentenceContext: 'Ils vont tous abattre les humains quand même.',
      rationale: 'fixed expression worth testing in context',
    };
    expect(ZGradedPlan.safeParse(plan).success).toBe(true);
  });

  it('accepts a comprehension plan', () => {
    const plan = {
      kind: 'comprehension' as const,
      npcUtterance: 'Comment ça va ?',
      speakerName: 'Sophie',
      npcId: 'sophie-cafe',
    };
    expect(ZGradedPlan.safeParse(plan).success).toBe(true);
  });

  it('rejects a fill-blank plan missing sentenceContext', () => {
    expect(
      ZGradedPlan.safeParse({ kind: 'generation' as const, testTarget: 'voudrais' }).success,
    ).toBe(false);
  });
});

// Re-add note: Phase E (phase-e.md Test section F) unit-covered the
// ZStepChoice annotation fields against the CYOA-era ZStepResponse, which
// F7-e deletes — this describe re-expresses that coverage against F's
// surviving exports so E's LIFE-BUBBLE-7 schema assurance is not dropped
// by this file's full rewrite. ZStepChoice keeps the fields for graded
// inline chips; ZStepOption (the node-engine successor to the chip)
// inherits them via ZStepChoice.omit({ correctness }).extend(...).
describe('ZStepChoice / ZStepOption annotations — LIFE-BUBBLE-7 (Phase E carry-forward)', () => {
  it('LIFE-BUBBLE-7 — ZStepChoice accepts + round-trips complexWords/wordTranslations', () => {
    const parsed = ZStepChoice.safeParse({
      id: 'c1',
      practiceText: 'voudrais',
      nativeText: 'would like',
      correctness: 'correct',
      complexWords: ['voudrais'],
      wordTranslations: { voudrais: 'would like' },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.complexWords).toEqual(['voudrais']);
    expect(parsed.data.wordTranslations).toEqual({ voudrais: 'would like' });
  });

  it('LIFE-BUBBLE-7 — ZStepOption inherits + round-trips the annotation fields', () => {
    const parsed = ZStepOption.safeParse({
      id: 'greet',
      practiceText: 'Saluer Sophie',
      nativeText: 'Greet Sophie',
      complexWords: ['Saluer'],
      wordTranslations: { Saluer: 'to greet' },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.complexWords).toEqual(['Saluer']);
    expect(parsed.data.wordTranslations).toEqual({ Saluer: 'to greet' });
  });

  it('LIFE-LANG-15 (v2.1) — an option may OMIT practiceText; it is filled from the native label', () => {
    // Options are native-only, so the generator emits ONE label (nativeText)
    // and the schema fills practiceText from it (no duplicate output token).
    const parsed = ZStepOption.safeParse({
      id: 'order-coffee',
      nativeText: 'Order a coffee',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.practiceText).toBe('Order a coffee');
    expect(parsed.data.nativeText).toBe('Order a coffee');
  });

  it('LIFE-EX (v2.1) — a fill-blank practicePrompt parses WITHOUT the dead with-blank nativeText', () => {
    const parsed = ZPracticePrompt.safeParse({
      kind: 'generation',
      practiceText: 'Je ___ un café',
      completedNativeText: 'I would like a coffee',
      disambiguation: 'translation-anchor',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('ZRawNodeResponse — LIFE-SPEECH-1 (saysLine belongs to a "say")', () => {
  const saysLine = { practiceText: 'Salut Sophie !', nativeText: 'Hi Sophie!' };
  const resp = (option: Record<string, unknown>) => ({ options: [opt('s', option)] });

  it('accepts a "say" option carrying saysLine', () => {
    const r = ZRawNodeResponse.safeParse(resp({ speechAct: 'say', saysLine }));
    expect(r.success).toBe(true);
  });

  it('REJECTS a "say" with NO saysLine (the vanished-player-line bug)', () => {
    const r = ZRawNodeResponse.safeParse(resp({ speechAct: 'say' }));
    expect(r.success).toBe(false);
  });

  it('REJECTS saysLine on a non-say ("act") option', () => {
    const r = ZRawNodeResponse.safeParse(resp({ saysLine }));
    expect(r.success).toBe(false);
  });

  it('REJECTS saysLine on a "hear" option — the player did not speak', () => {
    const r = ZRawNodeResponse.safeParse(resp({ speechAct: 'hear', saysLine }));
    expect(r.success).toBe(false);
  });
});

/**
 * LIFE-SPEECH-8 — `hear` is COERCED to `act`, not rejected.
 *
 * The enum is `'say' | 'act'` everywhere inside the app, but the WIRE still
 * tolerates `hear` and folds it into `act` at the parse seam. Rejecting it
 * would be the obvious implementation and the wrong one: the model emits it
 * about 1 time in 500, and a hard rejection spends a whole retry — a real cost
 * to the player, in latency and tokens — over a label that carries no
 * information we act on.
 *
 * `act` is the RIGHT landing place, not merely a convenient one. Every `hear`
 * ever authored was ambient sound ("Listen at the door"), which is a physical
 * action, and `act` is the bucket that ARMS the `LIFE-CONTRACT-EX-7` lead-in
 * requirement. The coercion therefore fixes the disarm rather than papering
 * over it.
 */
describe('LIFE-SPEECH-8 — `hear` folds into `act` at the seam', () => {
  const parseOne = (option: Record<string, unknown>) => {
    const r = ZRawNodeResponse.safeParse({ options: [opt('s', option)] });
    expect(r.success).toBe(true);
    return r.success ? r.data.options[0] : null;
  };

  it('a "hear" option parses — it does NOT spend a retry', () => {
    expect(parseOne({ speechAct: 'hear' })).not.toBeNull();
  });

  it('and arrives as "act", so the lead-in requirement arms', () => {
    expect(parseOne({ speechAct: 'hear' })?.speechAct).toBe('act');
  });

  it('"say" and "act" are untouched, and absent stays absent', () => {
    expect(parseOne({ speechAct: 'say', saysLine: { practiceText: 'Salut !', nativeText: 'Hi!' } })?.speechAct)
      .toBe('say');
    expect(parseOne({ speechAct: 'act' })?.speechAct).toBe('act');
    expect(parseOne({})?.speechAct).toBeUndefined();
  });

  it('an unknown speechAct is still a REJECTION — the fold is for `hear` alone', () => {
    // The coercion is a named retirement, not a general "accept anything"
    // valve. A garbage value still means the response is malformed.
    expect(ZRawNodeResponse.safeParse({ options: [opt('s', { speechAct: 'shout' })] }).success)
      .toBe(false);
  });
});

describe('LIFE-COST-5 — derived vocab annotations (D1) + dropped rationale (D2)', () => {
  const line = (extra: Record<string, unknown>) => ({
    speaker: 'narrator',
    practiceText: 'Tu ouvres la porte.',
    nativeText: 'You open the door.',
    ...extra,
  });

  it('derives complexWords from wordTranslations keys, in order', () => {
    // The model no longer emits the array — it was always exactly these keys,
    // serialised a second time.
    const r = ZStepBeat.safeParse(
      line({ wordTranslations: { ouvres: 'open', porte: 'door' } }),
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.complexWords).toEqual(['ouvres', 'porte']);
  });

  it('keeps an explicit complexWords array when one IS sent (back-compat)', () => {
    const r = ZStepBeat.safeParse(
      line({ complexWords: ['porte'], wordTranslations: { ouvres: 'open', porte: 'door' } }),
    );
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.complexWords).toEqual(['porte']);
  });

  it('leaves an unannotated beat alone rather than inventing an empty array', () => {
    const r = ZStepBeat.safeParse(line({}));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.complexWords).toBeUndefined();
  });

  it('derives on chips and saysLine too, not just beats', () => {
    const chip = ZStepChoice.safeParse({
      id: 'a', practiceText: 'voudrais', nativeText: '',
      wordTranslations: { voudrais: 'would like' },
    });
    expect(chip.success).toBe(true);
    if (chip.success) expect(chip.data.complexWords).toEqual(['voudrais']);
    const opt = ZStepOption.safeParse({
      id: 'greet', nativeText: 'Greet her', speechAct: 'say',
      saysLine: {
        practiceText: 'Salut !', nativeText: 'Hi!',
        wordTranslations: { Salut: 'hi' },
      },
    });
    expect(opt.success).toBe(true);
    if (opt.success) expect(opt.data.saysLine?.complexWords).toEqual(['Salut']);
  });

  it('strips a gradedPlan rationale if the model still writes one', () => {
    const r = ZGradedPlan.safeParse({
      kind: 'generation',
      testTarget: 'voudrais',
      sentenceContext: 'Je voudrais un café.',
      rationale: 'debug-only field, no longer read',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty('rationale');
  });
});


describe('LIFE-EX-PLAN-5 — the question node pre-authors its resolution', () => {
  const plan = { kind: 'comprehension' as const, npcUtterance: 'Combien ça coûte ?' };
  const opts = () => [
    { id: 'pay', nativeText: 'Pay for the coffee' },
    { id: 'ask', nativeText: 'Ask for the bill instead' },
  ];
  const question = (resolution?: unknown) => ({
    node: { kind: 'question' as const, gradedPlan: plan, ...(resolution ? { resolution } : {}) },
    options: [],
    logLine: 'Paul asked about the price.',
  });

  it('parses a question node carrying a resolution', () => {
    const r = ZRawNodeResponse.safeParse(
      question({
        beats: [{ speaker: 'npc', speakerName: 'Paul', practiceText: 'Deux euros.', nativeText: 'Two euros.' }],
        options: opts(),
        logLine: 'You paid Paul two euros.',
      }),
    );
    expect(r.success).toBe(true);
    if (r.success && r.data.node?.kind === 'question') {
      expect(r.data.node.resolution?.options).toHaveLength(2);
      expect(r.data.node.resolution?.beats).toHaveLength(1);
    }
  });

  it('is OPTIONAL — a question node without one still parses (graceful degradation)', () => {
    const r = ZRawNodeResponse.safeParse(question());
    expect(r.success).toBe(true);
    if (r.success && r.data.node?.kind === 'question') {
      expect(r.data.node.resolution).toBeUndefined();
    }
  });

  it('LIFE-EX-3 — resolution beats may be EMPTY (after inbound, the NPC line is still current)', () => {
    const r = ZRawNodeResponse.safeParse(question({ beats: [], options: opts() }));
    expect(r.success).toBe(true);
    if (r.success && r.data.node?.kind === 'question') {
      expect(r.data.node.resolution?.beats).toEqual([]);
    }
  });

  it('defaults beats to [] when omitted entirely', () => {
    const r = ZRawNodeResponse.safeParse(question({ options: opts() }));
    expect(r.success).toBe(true);
    if (r.success && r.data.node?.kind === 'question') {
      expect(r.data.node.resolution?.beats).toEqual([]);
    }
  });

  it('resolution options obey the BRANCH count rule (2-3), not the question rule', () => {
    // The resolution IS a decision point, so 1 option is wrong and 4 is wrong —
    // even though the node's own top-level options must be empty. LIFE-NODE-16d:
    // the CONSEQUENCE of getting it wrong is that the resolution is dropped and
    // the turn survives, not that the whole response dies. The rule is unchanged;
    // only what it costs is.
    const resolutionOf = (r: unknown) => {
      const p = ZRawNodeResponse.safeParse(repairStepResponse(r));
      expect(p.success).toBe(true);
      return p.success && p.data.node?.kind === 'question' ? p.data.node.resolution : undefined;
    };
    expect(resolutionOf(question({ options: [opts()[0]] }))).toBeUndefined();
    expect(resolutionOf(question({ options: opts() }))).toBeDefined();
    expect(
      resolutionOf(question({ options: [...opts(), { id: 'c', nativeText: 'Leave' }] })),
    ).toBeDefined();
    expect(
      resolutionOf(
        question({
          options: [...opts(), { id: 'c', nativeText: 'Leave' }, { id: 'd', nativeText: 'Wait' }],
        }),
      ),
    ).toBeUndefined();
  });

  it('the node’s own top-level options must STILL be empty (LIFE-EX-PLAN-4 unchanged)', () => {
    const bad = { ...question({ options: opts() }), options: opts() };
    expect(ZRawNodeResponse.safeParse(bad).success).toBe(false);
  });

  it('LIFE-SPEECH-1 applies inside the resolution — a "say" option needs saysLine', () => {
    const bad = question({
      options: [{ id: 'greet', nativeText: 'Greet him', speechAct: 'say' }, opts()[1]],
    });
    // Still a violation, and still caught. LIFE-NODE-16d makes it cost the
    // resolution rather than the turn: a say-option with no saysLine surfaces no
    // player bubble, so shipping it would be worse than a fallback live turn.
    const r = ZRawNodeResponse.safeParse(repairStepResponse(bad));
    expect(r.success).toBe(true);
    if (r.success && r.data.node?.kind === 'question') {
      expect(r.data.node.resolution).toBeUndefined();
    }
  });

  it('D1/D3 derivations apply to resolution content just like anywhere else', () => {
    const r = ZRawNodeResponse.safeParse(
      question({
        beats: [
          {
            speaker: 'npc',
            practiceText: 'Deux euros, merci.',
            nativeText: 'Two euros, thanks.',
            wordTranslations: { euros: 'euros', merci: 'thanks' },
          },
        ],
        options: opts(),
      }),
    );
    expect(r.success).toBe(true);
    if (r.success && r.data.node?.kind === 'question') {
      // D1: complexWords derived from wordTranslations keys.
      expect(r.data.node.resolution?.beats[0]?.complexWords).toEqual(['euros', 'merci']);
      // D3: practiceText filled from nativeText on the option.
      expect(r.data.node.resolution?.options[0]?.practiceText).toBe('Pay for the coffee');
    }
  });

  it('a resolution on a NON-question node is stripped, not honoured', () => {
    const r = ZRawNodeResponse.safeParse({
      node: { kind: 'branch', beats: [], resolution: { options: opts() } },
      options: opts(),
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.node).not.toHaveProperty('resolution');
  });
});

describe('LIFE-NODE-16 — a response with one obvious reading is repaired, not rejected', () => {
  const beat = {
    speaker: 'narrator',
    practiceText: 'Tu ouvres la porte.',
    nativeText: 'You open the door.',
  };
  const typed = (id: string, actionType: string) => opt(id, { actionType });
  /** Parse the way `generateStepOptions` does: repair, then strict-parse. */
  const parseRepaired = (raw: unknown) => ZRawNodeResponse.safeParse(repairStepResponse(raw));

  it('LIFE-NODE-16a — scene.phaseTransition: null means ABSENT, not invalid', () => {
    const r = parseRepaired({
      ...liveBranchResponse,
      scene: { sceneProgress: 85, replanRequested: false, hardPivot: false, phaseTransition: null },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.scene?.phaseTransition ?? null).toBeNull();
  });

  it('LIFE-NODE-16b — a continuation carrying 3 distinct-type options IS a branch', () => {
    const r = parseRepaired({
      node: { kind: 'continuation', beats: [beat] },
      options: [typed('greet', 'offer'), typed('watch', 'observe'), typed('go', 'move')],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.node?.kind).toBe('branch');
      // The three authored options survive — that is the point of repairing.
      expect(r.data.options).toHaveLength(3);
      expect(r.data.options.map((o) => o.id)).toEqual(['greet', 'watch', 'go']);
    }
  });

  it('LIFE-NODE-16c — a lone continuation option gets its id forced to "continue"', () => {
    const r = parseRepaired({
      node: { kind: 'continuation', beats: [beat] },
      options: [typed('approach-madame-vidal', 'offer')],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.node?.kind).toBe('continuation');
      expect(r.data.options[0]?.id).toBe('continue');
      // Only the protocol token changes; the text the player reads does not.
      expect(r.data.options[0]?.practiceText).toBe('option approach-madame-vidal');
    }
  });

  it('LIFE-NODE-16d — a malformed resolution is DROPPED, the question survives', () => {
    const r = parseRepaired({
      node: {
        kind: 'question',
        gradedPlan: { kind: 'comprehension', npcUtterance: 'Combien ?' },
        resolution: {
          beats: [beat],
          // Nothing acts on the world — an interrogation, per LIFE-GRID-1.1.
          options: [typed('ask-more', 'ask'), typed('watch-him', 'observe')],
        },
      },
      options: [],
    });
    expect(r.success).toBe(true);
    if (r.success && r.data.node?.kind === 'question') {
      expect(r.data.node.resolution).toBeUndefined();
      expect(r.data.node.gradedPlan).toBeTruthy();
    }
  });

  it('LIFE-NODE-16 — a duplicate actionType is NOT repaired; there is no correct reading', () => {
    const r = parseRepaired({
      node: { kind: 'branch', beats: [beat] },
      options: [typed('a', 'observe'), typed('b', 'observe'), typed('c', 'do')],
    });
    expect(r.success).toBe(false);
  });

  it('LIFE-NODE-16 — leaves a healthy response byte-identical', () => {
    const healthy = {
      node: { kind: 'continuation', beats: [beat] },
      options: [opt('continue', { actionType: 'move' })],
    };
    expect(repairStepResponse(healthy)).toEqual(healthy);
    expect(repairStepResponse(liveBranchResponse)).toEqual(liveBranchResponse);
  });

  it('LIFE-NODE-16 — never throws on a shape it does not recognise', () => {
    for (const junk of [null, undefined, 42, 'text', [], { node: 7 }, { options: 'no' }]) {
      expect(() => repairStepResponse(junk)).not.toThrow();
    }
  });
});

/**
 * LIFE-EX-18 — the graded kind is derived from whose line it is.
 *
 * Owner, 2026-08-10: *"No need for the model to even output if it's
 * comprehension or generation. If the npc id is me then it's a generation… if
 * it's another npc then any comprehension exercise."* Right — the discriminant
 * is redundant with the fields beside it, and a redundant field is one the model
 * has to keep consistent with data it already wrote.
 */
describe('LIFE-EX-18 — deriveGradedKind', () => {
  it('a plan carrying the PLAYER\'s upcoming line is generation', () => {
    expect(deriveGradedKind({ kind: 'comprehension', sentenceContext: 'Je voudrais un café.' }))
      .toBe('generation');
  });

  it('a plan carrying an NPC\'s line is comprehension', () => {
    expect(deriveGradedKind({ kind: 'generation', npcUtterance: 'Le café est fermé.' }))
      .toBe('comprehension');
  });

  it('THE CORRUPTION CASE: a `hear` pick on ambient sound no longer rewrites the player', () => {
    // LIFE-SPEECH-7, measured: "Listen for footsteps" carries speechAct `hear`,
    // which armed the old repair's hear→comprehension projection. The model
    // authors a fill-blank; the repair converts it to comprehension; and that
    // moves `sentenceContext` — the line the PLAYER was about to say — into
    // `npcUtterance`, an NPC's mouth. 2 of 4 `hear` picks did this.
    //
    // The fields cannot be wrong that way. This plan is the player's line
    // whatever the pick declared.
    const planAfterHearPick = { kind: 'generation', testTarget: 'attention', sentenceContext: 'Fais attention aux gardes.' };
    expect(deriveGradedKind(planAfterHearPick)).toBe('generation');
  });

  it('agrees with a correctly-declared plan, so it is a no-op on the happy path', () => {
    expect(deriveGradedKind({ kind: 'generation', sentenceContext: 'Salut !' })).toBe('generation');
    expect(deriveGradedKind({ kind: 'comprehension', npcUtterance: 'Salut !' })).toBe('comprehension');
  });

  it('declines to decide when BOTH fields are present — that is malformed, not ambiguous', () => {
    // Inventing an answer here would paper over a plan `gradedPlanIssues` should
    // be rejecting, and would pick one of the two lines arbitrarily.
    expect(deriveGradedKind({ kind: 'generation', sentenceContext: 'a', npcUtterance: 'b' })).toBeNull();
  });

  it('declines to decide when NEITHER is present, leaving the declaration alone', () => {
    expect(deriveGradedKind({ kind: 'comprehension' })).toBeNull();
    expect(deriveGradedKind({})).toBeNull();
    expect(deriveGradedKind(null)).toBeNull();
    expect(deriveGradedKind(undefined)).toBeNull();
  });

  it('treats whitespace as absent — a blank line is not a line', () => {
    expect(deriveGradedKind({ sentenceContext: '   ', npcUtterance: 'Bonjour.' })).toBe('comprehension');
    expect(deriveGradedKind({ sentenceContext: '   ' })).toBeNull();
  });

  it('ignores non-string fields rather than throwing on a malformed response', () => {
    expect(deriveGradedKind({ sentenceContext: 42, npcUtterance: 'Bonjour.' })).toBe('comprehension');
    expect(deriveGradedKind({ sentenceContext: null, npcUtterance: null })).toBeNull();
  });
});

/**
 * LIFE-LANG-18 — RETIRED. The swap-words (Easy mode / mixed row) feature was
 * cut. A cached response from before the cut, or a model that still emits the
 * key, must not fail the parse — and nothing downstream may see the list.
 */
describe('LIFE-LANG-18 — retired swapWords', () => {
  it('LIFE-LANG-18 — retired: a step response carrying a stray swapWords key still parses and yields no swap data', () => {
    const parsed = ZStepBeat.safeParse({
      speaker: 'npc',
      speakerName: 'Sophie',
      practiceText: 'Bonjour, mon ami.',
      nativeText: 'Hello, my friend.',
      complexWords: ['bonjour', 'ami'],
      wordTranslations: { bonjour: 'hello', ami: 'friend' },
      swapWords: ['bonjour'],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('swapWords');
    expect(parsed.data?.complexWords).toEqual(['bonjour', 'ami']);
  });

  it('LIFE-LANG-18 — retired: a stored beat payload that still carries swapWords reads cleanly and drops it', () => {
    const parsed = ZLifeBeatPayload.safeParse({
      speaker: 'narrator',
      practiceText: 'Tu te réveilles.',
      nativeText: 'You wake up.',
      swapWords: ['réveilles'],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('swapWords');
  });
});
