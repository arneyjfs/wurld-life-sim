import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({
  generateGemini: vi.fn(),
}));

vi.mock('./debugLog', () => ({
  lifeDebug: vi.fn(),
  // LIFE-NODE-15: this module reaches `lifeWarn` through `generateWithRetry`.
  // Omitting it resolves to `undefined` and the transport-retry path throws —
  // harmless only while no test here rejects the generate, which is exactly
  // the kind of landmine that costs an hour when someone finally adds one.
  lifeWarn: vi.fn(),
  lifeFailed: vi.fn(),
}));

import { generateGemini } from '../gemini';
import { lifeFailed } from './debugLog';
import { runGradedQuestionGenerate , vocabViolations} from './runGradedQuestionGenerate';
import type { GradedPlan } from './stepSchema';

const generateGeminiMock = generateGemini as unknown as ReturnType<typeof vi.fn>;

const generationPlan: GradedPlan = {
  kind: 'generation',
  testTarget: 'voudrais',
  sentenceContext: 'Je voudrais un café',
};

const comprehensionPlan: GradedPlan = {
  kind: 'comprehension',
  npcUtterance: 'Est-ce que tu connais un bon café près du bureau ?',
  speakerName: 'Sophie',
};

const cleanFillBlank = {
  practicePrompt: {
    kind: 'generation',
    practiceText: 'Je ___ un café',
    nativeText: 'I ___ a coffee',
    // LIFE-LANG-6: full native translation with the blank FILLED.
    completedNativeText: 'I would like a coffee',
    // LIFE-EX-GEN-9: how exactly one chip is right. [voudrais/veux/voulais]
    // are all real, all fit the slot — without a declared strategy this is
    // precisely the unanswerable chip set the contract exists to stop.
    disambiguation: 'translation-anchor',
  },
  choices: [
    { id: 'c1', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
    { id: 'c2', practiceText: 'veux', nativeText: '', correctness: 'wrong', whyWrong: 'blunt "want", not the polite form' },
    { id: 'c3', practiceText: 'voulais', nativeText: '', correctness: 'wrong', whyWrong: 'past tense; the order is happening now' },
  ],
};

const cleanComprehension = {
  practicePrompt: {
    kind: 'comprehension',
    npcUtterance: 'Est-ce que tu connais un bon café près du bureau ?',
    question: 'What is Sophie asking?',
    // LIFE-LANG-12: faithful translation of the whole utterance.
    utteranceNativeText: 'Do you know a good café near the office?',
    // LIFE-EX-VOCAB-4: a CLEAN comprehension question carries lineVocab — the
    // resolved NPC bubble has no other source of tappable words. A fixture
    // without it is no longer clean, which is the point of the new guard.
    lineVocab: {
      'Est-ce que tu connais': 'Do you know',
      'un bon café': 'a good café',
      'près du bureau': 'near the office',
    },
    speakerName: 'Sophie',
    npcId: null,
  },
  choices: [
    { id: 'c1', practiceText: 'Elle cherche un endroit sympa', nativeText: "She's asking about a nice café nearby", correctness: 'correct' },
    // LIFE-EX-GEN-10: each wrong reading names what in the line rules it out.
    { id: 'c2', practiceText: 'Elle cherche le chemin', nativeText: "She's asking for directions to the office", correctness: 'wrong', whyWrong: 'she asks if you KNOW one, not how to get there' },
    { id: 'c3', practiceText: 'Elle propose une pause', nativeText: "She's offering to grab a coffee for you", correctness: 'wrong', whyWrong: 'she is asking, not offering' },
  ],
};

/**
 * SRV-PROMPT-8..13 batch 7 — the client sends no prompt and a spec, so every
 * assertion that used to read the RETRY PROMPT now reads the structured verdict
 * the server renders it from. The SENTENCES are asserted byte-for-byte in
 * `functions/src/__tests__/gradedQuestionGoldenParity.test.ts`; what belongs
 * here is WHICH guard fired.
 */
const specAt = (n: number) =>
  (generateGeminiMock.mock.calls[n]![0] as { promptSpec: Record<string, unknown> }).promptSpec;
const violationsAt = (n: number) =>
  (specAt(n).violations ?? []) as Array<{ code: string }>;
const codesAt = (n: number) => violationsAt(n).map((v) => v.code);

function baseInput(plan: GradedPlan) {
  return {
    plan,
    practiceLanguage: 'French',
    nativeLanguage: 'English',
    recentTargets: [] as string[],
  };
}

beforeEach(() => {
  generateGeminiMock.mockReset();
});

describe('leakViolations hard language checks (LIFE-LANG-1/2)', () => {
  it('LIFE-LANG-1 — clean fill-blank passes on the first attempt', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(cleanFillBlank));
    const r = await runGradedQuestionGenerate(baseInput(generationPlan));
    expect(r.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
  });

  it('LIFE-LANG-6 — fill-blank missing completedNativeText is rejected and retried with the hint', async () => {
    const missing = {
      practicePrompt: {
        kind: 'generation',
        practiceText: 'Je ___ un café',
        nativeText: 'I ___ a coffee',
        // completedNativeText omitted — the post-answer overlay would
        // have no sentence meaning to show.
      },
      choices: cleanFillBlank.choices,
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(missing))
      .mockResolvedValueOnce(JSON.stringify(cleanFillBlank));
    const r = await runGradedQuestionGenerate(baseInput(generationPlan));
    expect(r.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(codesAt(1)).toContain('fill-blank-completed-native-missing');
  });

  it('LIFE-LANG-6 — completedNativeText that still contains "___" is rejected', async () => {
    const dirty = {
      ...cleanFillBlank,
      practicePrompt: {
        ...cleanFillBlank.practicePrompt,
        completedNativeText: 'I ___ a coffee',
      },
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dirty))
      .mockResolvedValueOnce(JSON.stringify(cleanFillBlank));
    const r = await runGradedQuestionGenerate(baseInput(generationPlan));
    expect(r.kind).toBe('ok');
    expect(codesAt(1)).toContain('fill-blank-completed-native-has-blank');
  });

  it('LIFE-EX-GEN-12 — fill-blank with two IDENTICAL chips is rejected and retried', async () => {
    // The beta bug: a multiple-choice question shipped with two options the
    // same (the correct word appearing twice). Must be caught + retried.
    const dup = {
      ...cleanFillBlank,
      choices: [
        { id: 'c1', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
        { id: 'c2', practiceText: 'voudrais', nativeText: '', correctness: 'wrong', whyWrong: 'duplicate of the answer' },
        { id: 'c3', practiceText: 'voulais', nativeText: '', correctness: 'wrong', whyWrong: 'past tense; the order is now' },
      ],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dup))
      .mockResolvedValueOnce(JSON.stringify(cleanFillBlank));
    const r = await runGradedQuestionGenerate(baseInput(generationPlan));
    expect(r.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    // ⚠ THE INDICES ARE ASSERTED, and a mutation run is why. Swapping `prev`
    // and `i` here renders "Chips 2 and 1 share…" instead of "Chips 1 and 2",
    // and every `toContain(code)` check in this file passed through it: the code
    // was right and the sentence was not. The FIRST index is the chip already
    // seen, which is what makes the message read in reading order.
    expect(violationsAt(1)).toContainEqual({
      code: 'fill-blank-chips-share-practice',
      chipIndex: 0,
      otherChipIndex: 1,
      quote: 'voudrais',
    });
  });

  it('LIFE-LANG-12 — comprehension missing utteranceNativeText is rejected and retried with the hint', async () => {
    const missing = {
      practicePrompt: {
        kind: 'comprehension',
        npcUtterance: cleanComprehension.practicePrompt.npcUtterance,
        question: cleanComprehension.practicePrompt.question,
        // utteranceNativeText omitted — the post-answer "full sentence" row
        // would have no faithful translation of what was actually said.
        speakerName: 'Sophie',
        npcId: null,
      },
      choices: cleanComprehension.choices,
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(missing))
      .mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    const r = await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    expect(r.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(codesAt(1)).toContain('comprehension-utterance-native-missing');
  });

  it('LIFE-LANG-1 — fill-blank chip with a native gloss is rejected and retried with the hint', async () => {
    const dirty = {
      ...cleanFillBlank,
      choices: [
        { id: 'c1', practiceText: 'voudrais', nativeText: 'would like', correctness: 'correct' },
        { id: 'c2', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
        { id: 'c3', practiceText: 'voulais', nativeText: '', correctness: 'wrong' },
      ],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dirty))
      .mockResolvedValueOnce(JSON.stringify(cleanFillBlank));
    const r = await runGradedQuestionGenerate(baseInput(generationPlan));
    expect(r.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(violationsAt(1)).toContainEqual({
      code: 'fill-blank-chip-has-native-gloss',
      chipIndex: 0,
      quote: 'would like',
    });
  });

  it('LIFE-LANG-1 — comprehension chip with empty nativeText fails after two attempts', async () => {
    const dirty = {
      ...cleanComprehension,
      choices: [
        { id: 'c1', practiceText: 'Elle cherche un endroit sympa', nativeText: '', correctness: 'correct' },
        { id: 'c2', practiceText: 'Elle cherche le chemin', nativeText: "She's asking for directions to the office", correctness: 'wrong' },
        { id: 'c3', practiceText: 'Elle propose une pause', nativeText: "She's offering to grab a coffee for you", correctness: 'wrong' },
      ],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dirty))
      .mockResolvedValueOnce(JSON.stringify(dirty));
    const r = await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    expect(r.kind).toBe('failed');
    // v2.1: the reason now carries the LAST violation so the demote log says WHY.
    expect((r as { reason: string }).reason).toMatch(/^exhausted-retries/);
    expect(codesAt(1)).toContain('comprehension-chip-native-empty');
  });

  it('LIFE-LANG-1 — duplicate comprehension nativeText is a violation', async () => {
    const dirty = {
      ...cleanComprehension,
      choices: [
        { id: 'c1', practiceText: 'Elle cherche un endroit sympa', nativeText: "She's asking about a café", correctness: 'correct' },
        { id: 'c2', practiceText: 'Elle cherche le chemin', nativeText: "she's asking about a café", correctness: 'wrong' },
        { id: 'c3', practiceText: 'Elle propose une pause', nativeText: "She's offering coffee", correctness: 'wrong' },
      ],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dirty))
      .mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    const r = await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    expect(r.kind).toBe('ok');
    // Same shape as the fill-blank row: indices in reading order, and the quote
    // is the LATER chip's text (the one being reported as a duplicate).
    expect(violationsAt(1)).toContainEqual({
      code: 'comprehension-chips-share-native',
      chipIndex: 0,
      otherChipIndex: 1,
      quote: "she's asking about a café",
    });
  });

  it('LIFE-EX-GEN-8 — the returned chip set is shuffled so the correct answer is not pinned first', async () => {
    // cleanFillBlank authors the correct chip first (c1). With Math.random
    // stubbed to 0 the Fisher-Yates shuffle moves it to the tail — proving
    // the shuffle is wired into the generator's return path.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(cleanFillBlank));
    const r = await runGradedQuestionGenerate(baseInput(generationPlan));
    spy.mockRestore();
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.choices[0]!.correctness).not.toBe('correct');
    expect(r.choices.filter((c) => c.correctness === 'correct')).toHaveLength(1);
    expect(new Set(r.choices.map((c) => c.id))).toEqual(new Set(['c1', 'c2', 'c3']));
  });

  it('LIFE-LANG-2 — comprehension with an empty question is a violation', async () => {
    const dirty = {
      ...cleanComprehension,
      practicePrompt: { ...cleanComprehension.practicePrompt, question: '' },
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dirty))
      .mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    const r = await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    expect(r.kind).toBe('ok');
    expect(codesAt(1)).toContain('comprehension-question-empty');
  });
});

/**
 * LIFE-EX-GEN-9 — the disambiguation contract, lifted from practice mode's
 * PRACTICE-GEN-10. The reported defect: chip sets like [peux / veux / doit]
 * where every option is a real word that fits the slot, so the question has no
 * discoverable answer. A good distractor is INDISTINGUISHABLE from a second
 * correct answer unless the question says how it rules the others out.
 */
describe('LIFE-EX-GEN-9 — fill-blank must declare how exactly one chip is right', () => {
  const withPrompt = (over: Record<string, unknown>, choices?: unknown) => ({
    practicePrompt: { ...cleanFillBlank.practicePrompt, ...over },
    choices: choices ?? cleanFillBlank.choices,
  });

  it('rejects a question with no disambiguation strategy', async () => {
    const { disambiguation: _drop, ...noStrategy } = cleanFillBlank.practicePrompt as Record<string, unknown>;
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify({ practicePrompt: noStrategy, choices: cleanFillBlank.choices }))
      .mockResolvedValueOnce(JSON.stringify(cleanFillBlank));

    const r = await runGradedQuestionGenerate(baseInput(generationPlan));

    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(codesAt(1)).toContain('fill-blank-disambiguation-missing');
    expect(r.kind).toBe('ok');
  });

  it('rejects a distractor whose wrongness the generator cannot state', async () => {
    const unjustified = withPrompt({}, [
      { id: 'c1', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
      { id: 'c2', practiceText: 'veux', nativeText: '', correctness: 'wrong', whyWrong: 'too blunt here' },
      { id: 'c3', practiceText: 'peux', nativeText: '', correctness: 'wrong' },
    ]);
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(unjustified))
      .mockResolvedValueOnce(JSON.stringify(cleanFillBlank));

    await runGradedQuestionGenerate(baseInput(generationPlan));

    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(codesAt(1)).toContain('fill-blank-missing-why-wrong');
  });

  it('ACCEPTS two distractors that are wrong for the same reason', () => {
    // Regression on a check that shipped briefly and was wrong. Distractors
    // failing for one shared reason is the normal shape of a vocabulary
    // question — café → thé / eau / lait are all just "the wrong drink" — and
    // rejecting it burned a retry on a perfectly good question, risking a
    // demotion to CYOA. Uniqueness of the ANSWER is what `disambiguation`
    // guarantees; it was never a property of how the distractors fail.
    const sameReason = withPrompt({}, [
      { id: 'c1', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
      { id: 'c2', practiceText: 'veux', nativeText: '', correctness: 'wrong', whyWrong: 'wrong register' },
      { id: 'c3', practiceText: 'voulais', nativeText: '', correctness: 'wrong', whyWrong: 'wrong register' },
    ]);
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(sameReason));
    return runGradedQuestionGenerate(baseInput(generationPlan)).then((r) => {
      expect(generateGeminiMock).toHaveBeenCalledTimes(1);
      expect(r.kind).toBe('ok');
    });
  });

  it('rejects a shown translation anchor that contains the answer verbatim', async () => {
    // The anchor is RENDERED pre-answer under translation-anchor, so leaving
    // the target word untranslated inside it makes the question answer itself.
    const leaky = withPrompt({
      disambiguation: 'translation-anchor',
      completedNativeText: 'I voudrais a coffee',
    });
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(leaky))
      .mockResolvedValueOnce(JSON.stringify(cleanFillBlank));

    await runGradedQuestionGenerate(baseInput(generationPlan));

    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(codesAt(1)).toContain('fill-blank-anchor-leaks-answer');
  });

  it('accepts context-anchor without a shown translation', async () => {
    generateGeminiMock.mockResolvedValueOnce(
      JSON.stringify(withPrompt({ disambiguation: 'context-anchor' })),
    );
    const r = await runGradedQuestionGenerate(baseInput(generationPlan));
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(r.kind).toBe('ok');
  });
});

describe('LIFE-EX-VOCAB-4 — an inbound line the player cannot tap is a violation', () => {
  const q = (pp: Record<string, unknown>) =>
    ({ practicePrompt: pp, choices: [] }) as unknown as Parameters<typeof vocabViolations>[0];

  it('flags a comprehension question with no lineVocab', () => {
    // MEASURED across two four-world runs: 16 of 64 comprehension questions
    // (25%) arrived without it, and the resolved bubble has NO fallback on
    // that branch — a full practice-language NPC line with nothing tappable.
    expect(vocabViolations(q({ kind: 'comprehension', npcUtterance: 'Combien ça coûte ?' })))
      .toHaveLength(1);
    expect(vocabViolations(q({ kind: 'comprehension', lineVocab: {} }))).toHaveLength(1);
  });

  it('passes a comprehension question that carries one', () => {
    expect(vocabViolations(q({
      kind: 'comprehension',
      npcUtterance: 'Combien ça coûte ?',
      lineVocab: { 'Combien': 'How much', 'ça coûte': 'does it cost' },
    }))).toHaveLength(0);
  });

  it('does NOT flag fill-blank — that branch falls back to the chip annotations', () => {
    // Measured 77/77 supplied, and `buildResolvedBubble` degrades gracefully
    // there anyway. Flagging it would spend retries on a path that works.
    expect(vocabViolations(q({ kind: 'generation', practiceText: 'Je ___ un café.' })))
      .toHaveLength(0);
  });
});

/**
 * LIFE-EX-PLAN-6/7 — two plan-level defects that used to be charged to the
 * GENERATOR, which cannot fix either of them.
 *
 * `input.plan` is re-sent byte-identical on every attempt, so any violation
 * that describes the PLAN is an unwinnable retry: both attempts burn and the
 * question is dropped. Found by reading the retry column of two full
 * playthrough runs.
 */
describe('LIFE-EX-PLAN-6 — a testTarget absent from the sentence: the SENTENCE wins', () => {
  // THE MEASURED CASE (7× across 47 stored transcripts): the model planned the
  // German LEMMA and wrote the INFLECTED form.
  const lemmaPlan: GradedPlan = {
    kind: 'generation',
    testTarget: 'können',
    sentenceContext: 'Ich kann das Logbuch einfach nicht finden.',
  };
  const authored = (correct: string) => ({
    practicePrompt: {
      kind: 'generation',
      practiceText: 'Ich ___ das Logbuch einfach nicht finden.',
      nativeText: 'I ___ not find the logbook at all.',
      completedNativeText: 'I simply cannot find the logbook.',
      disambiguation: 'translation-anchor',
      lineVocab: { Ich: 'I', kann: 'can', 'das Logbuch': 'the logbook' },
    },
    choices: [
      { id: 'a', practiceText: correct, nativeText: '', correctness: 'correct' },
      { id: 'b', practiceText: 'werde', nativeText: '', correctness: 'wrong', whyWrong: 'future auxiliary' },
      { id: 'c', practiceText: 'muss', nativeText: '', correctness: 'wrong', whyWrong: 'obligation, not ability' },
    ],
  });

  it('LIFE-EX-PLAN-6 — ships on the FIRST attempt when the chip is in the sentence', async () => {
    // Before: two attempts, both rejected on "testTarget does NOT appear in
    // sentenceContext", question dropped. The player lost a graded moment and
    // never saw an error.
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(authored('kann')));
    const r = await runGradedQuestionGenerate(baseInput(lemmaPlan));
    expect(r.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
  });

  it('LIFE-EX-PLAN-6 — still rejects a chip that is in NEITHER the target nor the sentence', async () => {
    // The relaxed rule is not "anything goes": the blank has to be a word that
    // is actually in the line the player is about to say.
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(authored('schwimmen')));
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(authored('kann')));
    const r = await runGradedQuestionGenerate(baseInput(lemmaPlan));
    expect(r.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(violationsAt(1)).toContainEqual({
      code: 'fill-blank-correct-chip-not-in-sentence',
      quote: 'schwimmen',
    });
  });

  it('LIFE-EX-PLAN-6 — the ordinary in-sentence target still checks against the TARGET', async () => {
    // The old contract is untouched when the plan is coherent: a chip that
    // drifts from a target that IS in the sentence is still flagged.
    generateGeminiMock.mockResolvedValueOnce(
      JSON.stringify({
        ...cleanFillBlank,
        choices: [
          { id: 'a', practiceText: 'mange', nativeText: '', correctness: 'correct' },
          { id: 'b', practiceText: 'bois', nativeText: '', correctness: 'wrong', whyWrong: 'drink' },
          { id: 'c', practiceText: 'vois', nativeText: '', correctness: 'wrong', whyWrong: 'see' },
        ],
      }),
    );
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(cleanFillBlank));
    const r = await runGradedQuestionGenerate(baseInput(generationPlan));
    expect(r.kind).toBe('ok');
    expect(violationsAt(1)).toContainEqual({
      code: 'fill-blank-correct-chip-diverges',
      quote: 'mange',
    });
  });
});

describe('LIFE-EX-PLAN-7 — a recycled target is DEMOTED, and costs no call', () => {
  it('LIFE-EX-PLAN-7 — a target already in recentTargets never reaches the generator', async () => {
    // MEASURED: "escaleras" planned three times with the word VISIBLY in
    // <recentlyPracticed> on the 2nd and 3rd. The rule is stated as HARD in the
    // prompt and was checked nowhere.
    const r = await runGradedQuestionGenerate({
      ...baseInput(generationPlan),
      recentTargets: ['bonjour', 'voudrais', 'escalier'],
    });
    expect(r.kind).toBe('failed');
    expect(r.kind === 'failed' ? r.reason : '').toMatch(/stale-target/);
    // The whole point: zero calls. A retry would be unwinnable (the plan is
    // fixed), so the cheap demote is the only honest consequence.
    expect(generateGeminiMock).not.toHaveBeenCalled();
  });

  it('LIFE-EX-PLAN-7 — matching is case/whitespace-insensitive', async () => {
    const r = await runGradedQuestionGenerate({
      ...baseInput(generationPlan),
      recentTargets: ['  VOUDRAIS '],
    });
    expect(r.kind).toBe('failed');
  });

  it('LIFE-EX-PLAN-7 — a FRESH target is unaffected', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(cleanFillBlank));
    const r = await runGradedQuestionGenerate({
      ...baseInput(generationPlan),
      recentTargets: ['bonjour', 'escalier'],
    });
    expect(r.kind).toBe('ok');
  });

  it('LIFE-EX-PLAN-7 — comprehension plans are untouched (no target to recycle)', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    const r = await runGradedQuestionGenerate({
      ...baseInput(comprehensionPlan),
      recentTargets: ['voudrais'],
    });
    expect(r.kind).toBe('ok');
  });
});

/**
 * LIFE-EX-GEN-LOG — the rejection summary names the guard that actually fired.
 *
 * Three independent guards share one branch (leak · direction · line-vocab) and
 * every one of them was reported as `answer-leak`. Seen 2026-08-06 in the
 * owner's production log: a `lineVocab` omission — the model simply left out
 * the annotations — read in the overlay as the model having spoiled the
 * answer. That is the one mislabel that sends the reader to the wrong prompt.
 */
describe('LIFE-EX-GEN-LOG — the rejection reason is not always "answer-leak"', () => {
  const summaries = () =>
    vi.mocked(lifeFailed).mock.calls.map((c) => c[1] as string);

  // The file's own `beforeEach` resets only the Gemini mock, so `lifeFailed`
  // otherwise accumulates every rejection from every earlier test in the file.
  beforeEach(() => vi.mocked(lifeFailed).mockClear());

  it('a missing lineVocab is reported as line-vocab, NOT answer-leak', async () => {
    const noVocab = {
      ...cleanComprehension,
      practicePrompt: { ...cleanComprehension.practicePrompt, lineVocab: {} },
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(noVocab))
      .mockResolvedValueOnce(JSON.stringify(cleanComprehension));

    await runGradedQuestionGenerate(baseInput(comprehensionPlan));

    const rejections = summaries().filter((s) => s.startsWith('graded-question rejected'));
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toContain('line-vocab');
    expect(rejections[0]).not.toContain('answer-leak');
  });

  it('a real leak is still reported as answer-leak', async () => {
    // The chip's own native gloss hands over the answer (LIFE-LANG-1): a
    // fill-blank's correct chip must carry an EMPTY nativeText.
    const leaky = {
      ...cleanFillBlank,
      choices: cleanFillBlank.choices.map((c) =>
        c.correctness === 'correct' ? { ...c, nativeText: 'would like' } : c,
      ),
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(leaky))
      .mockResolvedValueOnce(JSON.stringify(cleanFillBlank));

    await runGradedQuestionGenerate(baseInput(generationPlan));

    const rejections = summaries().filter((s) => s.startsWith('graded-question rejected'));
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toContain('answer-leak');
  });
});

/**
 * SRV-PROMPT-8..13 batch 7 — the WIRE, and SRV-PROMPT-12's answer.
 *
 * The unit tests above assert WHICH guard fired; these assert that nothing the
 * client computes leaves the device as prose, that the spec is narrowed at
 * every depth, and that the retry ladder carries codes rather than sentences.
 */
describe('SRV-PROMPT-8..13 — the client sends a SPEC, never prompt text', () => {
  const sceneInput = {
    ...baseInput(comprehensionPlan),
    scene: {
      sagaTitle: 'The Whispering Resistance',
      locationLabel: 'Underground bunker',
      speakerName: 'Bébert',
      recentBeats: ['The lamp went out.'],
      difficulty: 5,
      systemLanguage: 'German',
    },
  };

  it('SRV-PROMPT-8 — no `prompt` and no systemInstruction is sent', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    await runGradedQuestionGenerate(sceneInput);
    const req = generateGeminiMock.mock.calls[0]![0] as Record<string, unknown>;
    // Sending NO `prompt` is load-bearing: the endpoint's "Missing prompt" guard is
    // skipped only when the resolver returns `built`, so a resolver regression
    // shows up as a 400 rather than as a silently client-built prompt.
    expect(req).not.toHaveProperty('prompt');
    expect(req.systemInstruction).toBeUndefined();
    expect(req.category).toBe('life_graded_question');
  });

  it('SRV-PROMPT-11 — no responseSchema, before this batch and after it', async () => {
    // `responseMimeType` stays client-side legitimately; a SCHEMA appearing
    // would be a behaviour change dressed as a migration (LIFE-WORLD-SAGA-10).
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    await runGradedQuestionGenerate(sceneInput);
    const req = generateGeminiMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(req.responseSchema).toBeUndefined();
    expect(req.responseMimeType).toBe('application/json');
  });

  it('SRV-PROMPT-8..13 — the two SI inputs travel RESOLVED, and never inside `scene`', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    await runGradedQuestionGenerate(sceneInput);
    const spec = specAt(0) as Record<string, unknown>;
    expect(spec.systemLanguage).toBe('German');
    expect(spec.difficulty).toBe(5);
    // The scene is REBUILT, not forwarded: a second copy of either field on the
    // wire is a second thing for the server to disagree with.
    expect(Object.keys(spec.scene as object).sort()).toEqual([
      'locationLabel',
      'recentBeats',
      'sagaTitle',
      'speakerName',
    ]);
  });

  it('SRV-PROMPT-8..13 — the fallbacks are applied HERE, so the server never re-applies them', async () => {
    // A legacy world has neither field. `?? nativeLanguage` and `?? 2` are the
    // client's, and the seam/server read what arrives — the rule batch 5 had to
    // learn after scoring three kinds against the wrong instruction.
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    const spec = specAt(0) as Record<string, unknown>;
    expect(spec.systemLanguage).toBe('English');
    expect(spec.difficulty).toBe(2);
    expect(spec.scene).toBeUndefined();
  });

  it('SRV-PROMPT-8..13 — the PLAN is the direction, and `npcId` does not travel', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    await runGradedQuestionGenerate({
      ...baseInput({ ...comprehensionPlan, npcId: 'sophie-station' } as GradedPlan),
    });
    const spec = specAt(0) as Record<string, unknown>;
    expect(spec.plan).toEqual({
      kind: 'comprehension',
      npcUtterance: comprehensionPlan.kind === 'comprehension' ? comprehensionPlan.npcUtterance : '',
      speakerName: 'Sophie',
    });
    // No `speaker`, no `direction`: a second spelling of one fact is how the
    // card came to say "Élise said:" beside a bubble that said "?".
    expect(spec).not.toHaveProperty('direction');
    expect(spec).not.toHaveProperty('nativeLanguage');
  });

  it('SRV-PROMPT-12 — attempt 1 carries NO violations, attempt 2 carries the verdict', async () => {
    const noVocab = {
      ...cleanComprehension,
      practicePrompt: { ...cleanComprehension.practicePrompt, lineVocab: {} },
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(noVocab))
      .mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    expect(specAt(0).violations).toBeUndefined();
    expect(specAt(1).violations).toEqual([{ code: 'line-vocab-missing' }]);
  });

  it('SRV-PROMPT-12 — a schema failure travels as issue CODES, capped at four', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify({ practicePrompt: { kind: 'comprehension' }, choices: [] }))
      .mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    const vs = violationsAt(1) as Array<{ code: string; path?: string; message?: string }>;
    expect(vs.length).toBeGreaterThan(0);
    expect(vs.length).toBeLessThanOrEqual(4);
    for (const v of vs) {
      expect(v.code).toBe('schema-issue');
      expect(typeof v.path).toBe('string');
      expect(typeof v.message).toBe('string');
    }
  });

  it('SRV-PROMPT-12 — an unparseable response travels as ONE code with no payload', async () => {
    generateGeminiMock
      .mockResolvedValueOnce('sorry, here is some prose instead')
      .mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    expect(specAt(1).violations).toEqual([{ code: 'invalid-json' }]);
  });

  it('SRV-PROMPT-12 — the ORDER is leak, then direction, then vocab', async () => {
    // A comprehension answer whose question is empty (leak), whose kind is
    // wrong… cannot co-occur, so this uses the two that can: a leak-family
    // violation and the vocab one, with the direction family empty between.
    const broken = {
      ...cleanComprehension,
      practicePrompt: {
        ...cleanComprehension.practicePrompt,
        question: '',
        lineVocab: {},
      },
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(broken))
      .mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    expect(codesAt(1)).toEqual(['comprehension-question-empty', 'line-vocab-missing']);
  });

  it('SRV-PROMPT-12 — the demote reason carries CODES, a disclosed change from sentences', () => {
    // Deliberate and recorded in docs/specs/practice-mode.md §6.8: the
    // templates are the server's now, and re-rendering them here to keep this
    // string identical would be the duplication SRV-PROMPT-3 forbids. Nothing
    // parses it — `question_demoted`'s payload is read by the cadence counter
    // and the debug buffer, and `stepRender.ts` drops the event from the prompt.
    const noVocab = {
      ...cleanComprehension,
      practicePrompt: { ...cleanComprehension.practicePrompt, lineVocab: {} },
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(noVocab))
      .mockResolvedValueOnce(JSON.stringify(noVocab));
    return runGradedQuestionGenerate(baseInput(comprehensionPlan)).then((r) => {
      expect(r.kind).toBe('failed');
      expect(r.kind === 'failed' ? r.reason : '').toBe('exhausted-retries: line-vocab-missing');
    });
  });
});

/**
 * SRV-PROMPT-9 / SRV-PROMPT-12 — the violation CAP is above what the critic can
 * reach, MEASURED rather than assumed.
 *
 * `MAX_GRADED_VIOLATIONS` is a REJECT, so a cap below the critic's own ceiling
 * would 400 an honest retry and demote the question — silently, because the
 * demote is non-fatal. It is also a byte decision: each rendered violation
 * costs ~363 B and an uncapped list crosses `MAX_PROMPT_BYTES` at ~107.
 */
describe('SRV-PROMPT-12 — the wire cap is above the critic\'s measured ceiling', () => {
  const maximallyBrokenFillBlank = () => {
    const dupe = 'hier soir je un café bien chaud, merci aussi';
    return {
      practicePrompt: {
        kind: 'generation',
        practiceText: 'Hier soir je ___ un café bien chaud, merci.',
        completedNativeText: '',
      },
      choices: [0, 1, 2, 3].map((i) => ({
        id: `c${i}`,
        practiceText: dupe,
        nativeText: 'gloss',
        correctness: i === 0 ? 'correct' : 'wrong',
        whyWrong: '',
      })),
    };
  };

  const maximallyBrokenComprehension = () => ({
    practicePrompt: {
      kind: 'comprehension',
      npcUtterance: '« Le train part dans dix minutes », dit-elle doucement.',
      question: '',
      utteranceNativeText: '',
    },
    choices: [0, 1, 2, 3].map((i) => ({
      id: `c${i}`,
      practiceText: 'le train part',
      nativeText: 'dit-elle',
      correctness: i === 0 ? 'correct' : 'wrong',
      whyWrong: '',
    })),
  });

  it('SRV-PROMPT-12 — 23 on fill-blank and 17 on comprehension, both under the cap', async () => {
    // The SERVER's cap, read from the server: two constants that must agree
    // and only one of them decides anything.
    const { MAX_GRADED_VIOLATIONS } = await import(
      '../../../functions/src/prompts/lifeGradedViolations'
    );
    const fbPlan: GradedPlan = {
      kind: 'generation',
      testTarget: 'voudrais',
      sentenceContext: 'Je voudrais un café bien chaud, merci.',
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(maximallyBrokenFillBlank()))
      .mockResolvedValueOnce(JSON.stringify(cleanFillBlank));
    await runGradedQuestionGenerate({ ...baseInput(fbPlan), recentTargets: [] });
    const fill = violationsAt(1).length;

    generateGeminiMock.mockReset();
    const cPlan: GradedPlan = {
      kind: 'comprehension',
      npcUtterance: '« Le train part dans dix minutes », dit-elle doucement.',
      speakerName: 'Sophie',
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(maximallyBrokenComprehension()))
      .mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    await runGradedQuestionGenerate(baseInput(cPlan));
    const comp = violationsAt(1).length;

    // Recorded, not just bounded: if a guard is added the numbers move and this
    // is where the cap gets re-checked.
    expect(fill).toBe(23);
    expect(comp).toBe(17);
    expect(Math.max(fill, comp)).toBeLessThan(MAX_GRADED_VIOLATIONS);
  });
});
