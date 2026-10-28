/**
 * LIFE-EX-DIR-* — the ENGINE half of the graded question.
 *
 * ⚠ THIS FILE IS HALF OF `prompts/gradedQuestion.test.ts`, SPLIT WITH ITS
 * MODULE (SRV-PROMPT-3 — "tests move rather than die"). The other half — every
 * assertion about the system instruction and the user prompt — moved to
 * `functions/src/__tests__/lifeGradedQuestion.test.ts` alongside the prompt it
 * asserts. Nothing was dropped in the split, and a row that needed both sides
 * (the SI's SPEAKER DIRECTION rules beside the `<direction>` block) went with
 * the prompt.
 *
 * ⚠ `directionViolations` NOW RETURNS CODES (SRV-PROMPT-12), so the assertions
 * below name codes where they used to match substrings of English. The
 * SENTENCES are unchanged and asserted byte-for-byte in
 * `functions/src/__tests__/gradedQuestionGoldenParity.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  applyGradedDirection,
  directionViolations,
  gradedDirection,
  gradedPlanIssues,
} from './gradedQuestionEngine';
import { buildResolvedBubble } from './resolvedBubble';
import type { GradedPlan, PracticePrompt, StepChoice } from './stepSchema';

const generationPlan: GradedPlan = {
  kind: 'generation',
  testTarget: 'veux',
  sentenceContext: 'Je veux un café.',
};
const comprehensionPlan: GradedPlan = {
  kind: 'comprehension',
  npcUtterance: 'Le train part dans dix minutes.',
  speakerName: 'Sophie',
  npcId: 'sophie-station',
};

const generationPrompt = (practiceText: string): PracticePrompt => ({
  kind: 'generation',
  practiceText,
  completedNativeText: 'I want a coffee',
  disambiguation: 'context-anchor',
});
const comprehensionPrompt = (over: Partial<Extract<PracticePrompt, { kind: 'comprehension' }>> = {}):
  PracticePrompt => ({
  kind: 'comprehension',
  npcUtterance: 'Le train part dans dix minutes.',
  question: 'What is Sophie saying?',
  utteranceNativeText: 'The train leaves in ten minutes.',
  ...over,
});

const correctChip: StepChoice = {
  id: 'c1',
  practiceText: 'veux',
  nativeText: '',
  correctness: 'correct',
};

describe('LIFE-EX-DIR-1 — the direction is one typed value derived from the plan', () => {
  it('LIFE-EX-DIR-1 — a fill-blank plan means the PLAYER speaks', () => {
    expect(gradedDirection(generationPlan)).toEqual({ speaker: 'player' });
  });

  it('LIFE-EX-DIR-1 — a comprehension plan means a NAMED NPC speaks, identity on the arm', () => {
    expect(gradedDirection(comprehensionPlan)).toEqual({
      speaker: 'npc',
      speakerName: 'Sophie',
      npcId: 'sophie-station',
    });
  });

  it('LIFE-EX-DIR-1 — an unnamed NPC is an explicit null, never an absent field', () => {
    const dir = gradedDirection({
      kind: 'comprehension',
      npcUtterance: 'Bonjour.',
    });
    expect(dir).toEqual({ speaker: 'npc', speakerName: null, npcId: null });
  });

  it('LIFE-EX-DIR-1 — blank speaker labels normalise to null rather than empty strings', () => {
    expect(
      gradedDirection({
        kind: 'comprehension',
        npcUtterance: 'Bonjour.',
        speakerName: '   ',
        npcId: '',
      }),
    ).toEqual({ speaker: 'npc', speakerName: null, npcId: null });
  });
});

describe('LIFE-EX-DIR-3 — identity is normalised, voice is rejected', () => {
  it('LIFE-EX-DIR-3 — a model-invented speaker name is overwritten by the direction', () => {
    const dir = gradedDirection(comprehensionPlan);
    const normalised = applyGradedDirection(
      dir,
      comprehensionPrompt({ speakerName: 'Élise', npcId: 'elise-baker' }),
    );
    expect(normalised).toMatchObject({
      kind: 'comprehension',
      speakerName: 'Sophie',
      npcId: 'sophie-station',
    });
  });

  it('LIFE-EX-DIR-3 — an unnamed direction clears an invented name rather than keeping it', () => {
    const dir = gradedDirection({ kind: 'comprehension', npcUtterance: 'Bonjour.' });
    expect(
      applyGradedDirection(dir, comprehensionPrompt({ speakerName: 'Ghost', npcId: 'ghost' })),
    ).toMatchObject({ speakerName: null, npcId: null });
  });

  it('LIFE-EX-DIR-3 — a fill-blank prompt passes through untouched', () => {
    const prompt = generationPrompt('Je ___ un café.');
    expect(applyGradedDirection({ speaker: 'player' }, prompt)).toEqual(prompt);
  });

  it('LIFE-EX-DIR-3 — a kind that disagrees with the direction is a violation', () => {
    // SRV-PROMPT-12: ONE code, with no parameter. The plan's kind fixes the
    // direction, the required prompt kind and therefore the wrong one the model
    // emitted, so the server derives all three — asserted here in BOTH
    // directions, because a `promptKind` field creeping back would show up as
    // these two rows differing.
    expect(directionViolations({ speaker: 'player' }, comprehensionPrompt())).toEqual([
      { code: 'direction-kind-mismatch' },
    ]);
    expect(
      directionViolations(gradedDirection(comprehensionPlan), generationPrompt('Je ___ un café.')),
    ).toEqual([{ code: 'direction-kind-mismatch' }]);
  });

  it('LIFE-EX-DIR-3 — an outbound template written as attributed narration is rejected', () => {
    expect(
      directionViolations({ speaker: 'player' }, generationPrompt('« Je ___ un café », dit Sophie.')),
    ).toEqual([
      { code: 'direction-player-line-narrated', quote: '« Je ___ un café », dit Sophie.' },
    ]);
  });

  it('LIFE-EX-DIR-3 — an inbound utterance written as narration is rejected, with its own code', () => {
    // The MIRROR of the row above, and it is a different code rather than the
    // same one with a field: the two sentences name different fields and
    // different bubbles, and one code with a `field` parameter would make
    // "player direction, npc wording" representable.
    expect(
      directionViolations(
        gradedDirection(comprehensionPlan),
        comprehensionPrompt({ npcUtterance: '« Le train part », dit-elle.' }),
      ),
    ).toEqual([{ code: 'direction-npc-line-narrated', quote: '« Le train part », dit-elle.' }]);
  });

  it('LIFE-EX-DIR-3 — the quote is sliced to 60 characters, as it always was', () => {
    // The client still slices, because 60 is what the SENTENCE was written
    // around ("…") — the server's own 240-byte ceiling is a hostile-input
    // bound, not this one. Dropping the slice here would change the bytes the
    // model reads without changing a single template.
    const long = `« ${'a'.repeat(200)} », dit Sophie.`;
    const v = directionViolations({ speaker: 'player' }, generationPrompt(long));
    expect(v).toHaveLength(1);
    expect((v[0] as { quote: string }).quote).toHaveLength(60);
  });

  it('LIFE-EX-DIR-3 — a clean prompt in the requested direction passes', () => {
    expect(directionViolations({ speaker: 'player' }, generationPrompt('Je ___ un café.'))).toEqual([]);
    expect(
      directionViolations(gradedDirection(comprehensionPlan), comprehensionPrompt()),
    ).toEqual([]);
  });
});

describe('LIFE-EX-DIR-1/3 — direction and rendered attribution cannot disagree', () => {
  /** The resolved bubble as the engine builds it, from the SAME direction the
   *  prompt was written from (`nodeEngineActions.feedbackContinue`). */
  const resolve = (direction: ReturnType<typeof gradedDirection>, promptSource: string) =>
    buildResolvedBubble({
      outcomeKind: direction.speaker === 'player' ? 'generation' : 'comprehension',
      promptSource,
      correctAnswer: correctChip,
      speakerName: direction.speaker === 'npc' ? direction.speakerName : null,
      npcId: direction.speaker === 'npc' ? direction.npcId : null,
    });

  it('LIFE-EX-DIR-1 — a player direction resolves to the player, with no NPC attribution', () => {
    const b = resolve(gradedDirection(generationPlan), 'Je ___ un café.');
    expect(b.speaker).toBe('user');
    expect(b.speakerName ?? null).toBeNull();
    expect(b.npcId ?? null).toBeNull();
  });

  it('LIFE-EX-DIR-1 — an npc direction resolves to THAT npc, never the player', () => {
    const b = resolve(gradedDirection(comprehensionPlan), 'Le train part dans dix minutes.');
    expect(b.speaker).toBe('npc');
    expect(b.speakerName).toBe('Sophie');
    expect(b.npcId).toBe('sophie-station');
  });

  it('LIFE-EX-DIR-3 — a line whose TEXT disagrees with the direction never reaches the bubble', () => {
    // The reported defect: the generator authors an outbound template in an
    // NPC's voice. It is rejected at the guard, so nothing is ever built from
    // it — the only way it could reach a bubble is as the player's own words.
    const dir = gradedDirection(generationPlan);
    const wrongVoice = generationPrompt('« Je ___ un café », dit Sophie.');
    expect(directionViolations(dir, wrongVoice)).not.toHaveLength(0);
    // And if the guard were bypassed, the attribution is still the direction's
    // — the wrong-voice text can never be labelled as Sophie's line.
    const b = resolve(dir, wrongVoice.kind === 'generation' ? wrongVoice.practiceText : '');
    expect(b.speaker).toBe('user');
    expect(b.speakerName ?? null).toBeNull();
  });
});

describe('LIFE-EX-DIR-1 — a structurally malformed plan is reported, not crashed on', () => {
  // The direction repair used to spread the OLD variant's body under the NEW
  // kind, so a repaired plan could arrive with the wrong fields entirely. That
  // repair is gone (LIFE-EX-18) and the parse seam now derives the kind FROM
  // the fields, so this shape can no longer reach here from the model.
  //
  // The test stays, because the guard is not about that one producer: it is
  // about the spec builder not being the thing that discovers a malformed
  // plan, whatever wrote it. Constructed directly, past the schema.
  const malformed = {
    kind: 'generation',
    npcUtterance: 'Bonjour !',
    speakerName: 'Sophie',
  } as unknown as GradedPlan;

  it('LIFE-EX-DIR-1 — gradedPlanIssues names the missing fields', () => {
    expect(gradedPlanIssues(malformed).join('\n')).toContain('testTarget');
    expect(gradedPlanIssues(generationPlan)).toEqual([]);
    expect(gradedPlanIssues(comprehensionPlan)).toEqual([]);
  });

  it('LIFE-EX-DIR-1 — a comprehension plan with no utterance is reported', () => {
    expect(
      gradedPlanIssues({ kind: 'comprehension', npcUtterance: '  ' } as GradedPlan).join('\n'),
    ).toContain('npcUtterance');
  });

  it('SRV-PROMPT-12 — gradedPlanIssues stays PROSE, because none of it reaches a model', () => {
    // The contrast that makes the rest of this batch legible. These strings run
    // BEFORE the first call and end up only in a demote reason and the debug
    // buffer; `directionViolations`' strings were interpolated into the RETRY
    // PROMPT, which is why one changed shape and the other did not.
    expect(typeof gradedPlanIssues(malformed)[0]).toBe('string');
  });
});
