import { describe, it, expect } from 'vitest';
import { validateNodeResponse } from './validateStep';

/**
 * ⚠ `renderRetryHint` IS DELETED (SRV-PROMPT-3, batch 8). It rendered the
 * cross-turn retry hint — prompt text — and the server writes those sentences
 * now from the CODES this module returns. The assertions that drove it moved to
 * `functions/src/__tests__/stepGoldenParity.test.ts`, where they are checked
 * BYTE-for-byte against a capture of this function's own output rather than by
 * substring, which is strictly more than they proved here.
 */
import type { NodePreview, StepOption } from './stepSchema';

const beat = (text: string, speaker: 'narrator' | 'npc' = 'narrator') => ({
  speaker,
  speakerName: speaker === 'npc' ? 'Sophie' : null,
  practiceText: text,
  nativeText: 'gloss',
});

const branchNode = (texts: string[]): NodePreview => ({
  kind: 'branch',
  beats: texts.map((t) => beat(t)),
});

const option = (
  id: string,
  practiceText: string,
  nativeText: string,
): Pick<StepOption, 'id' | 'practiceText' | 'nativeText'> => ({
  id,
  practiceText,
  nativeText,
});

describe('validateNodeResponse', () => {
  it('passes a clean node + options', () => {
    const issues = validateNodeResponse({
      node: branchNode(["Sophie t'attend."]),
      options: [
        option('a', 'Aller au café', 'Go to the café'),
        option('b', 'Rester', 'Stay'),
      ],
    });
    expect(issues).toEqual([]);
  });

  it('flags duplicate practiceText across options', () => {
    const issues = validateNodeResponse({
      node: null,
      options: [
        option('a', 'Aller au café', 'Go to the café'),
        option('b', 'Aller au café', 'Head to the café'),
      ],
    });
    expect(issues.some((i) => i.code === 'duplicate-practice')).toBe(true);
  });

  it('flags duplicate nativeText across options', () => {
    const issues = validateNodeResponse({
      node: null,
      options: [
        option('a', 'Aller au café', 'Go'),
        option('b', 'Rester', 'Go'),
      ],
    });
    expect(issues.some((i) => i.code === 'duplicate-native')).toBe(true);
  });

  describe('node-repeats-practiced-line (LIFE-CONTRACT-EX-4)', () => {
    const practicedLine = "Je voudrais un café, s'il vous plaît.";

    it('does NOT flag when no practicedLine context is supplied', () => {
      const issues = validateNodeResponse({
        node: branchNode(['Tu dis: «Je voudrais un café, s\'il vous plaît.»']),
        options: [],
      });
      expect(issues).toEqual([]);
    });

    it('flags a node beat that verbatim quotes the just-practised line', () => {
      const issues = validateNodeResponse(
        {
          node: branchNode(['Tu dis: «Je voudrais un café, s\'il vous plaît.»']),
          options: [],
        },
        { practicedLine },
      );
      expect(issues.some((i) => i.code === 'node-repeats-practiced-line')).toBe(true);
    });

    it('does NOT reach into options for beats — they carry none (LIFE-NODE-2)', () => {
      // This used to also scan each option's preview beats. With the lookahead
      // gone an option is a bare chip, so the node is the only place a
      // re-quote can hide; a clean node with options present must pass.
      const issues = validateNodeResponse(
        {
          node: branchNode(['Sophie hoche la tête.']),
          options: [option('a', 'Répéter', 'Repeat'), option('b', 'Continuer', 'Continue')],
        },
        { practicedLine },
      );
      expect(issues.some((i) => i.code === 'node-repeats-practiced-line')).toBe(false);
    });

    it('flags a substantially-overlapping rephrase', () => {
      const issues = validateNodeResponse(
        { node: branchNode(["Je voudrais un café s'il vous plaît !"]), options: [] },
        { practicedLine },
      );
      expect(issues.some((i) => i.code === 'node-repeats-practiced-line')).toBe(true);
    });

    it("does NOT flag the NPC's natural response to the practised line", () => {
      const issues = validateNodeResponse(
        {
          node: { kind: 'branch', beats: [beat('Très bien ! Et avec ça ?', 'npc')] },
          options: [],
        },
        { practicedLine },
      );
      expect(issues.some((i) => i.code === 'node-repeats-practiced-line')).toBe(false);
    });

    it('does NOT flag short practised lines (false-positive guard)', () => {
      const issues = validateNodeResponse(
        { node: branchNode(['Tu vas où ?']), options: [] },
        { practicedLine: 'Salut !' },
      );
      expect(issues.some((i) => i.code === 'node-repeats-practiced-line')).toBe(false);
    });

    it('LIFE-CONTRACT-EX-6 — a question node with NO lead-in beats has nothing to repeat', () => {
      const issues = validateNodeResponse(
        {
          node: {
            kind: 'question',
            beats: [],
            gradedPlan: {
              kind: 'generation',
              testTarget: 'voudrais',
              sentenceContext: practicedLine,
            },
          },
          options: [],
        },
        { practicedLine },
      );
      expect(issues).toEqual([]);
    });

    it('LIFE-CONTRACT-EX-6 — a question node\'s LEAD-IN is scanned like any other beats', () => {
      // The hole this closes: `scan` skipped `kind === 'question'` outright,
      // which was correct only while that node could not carry beats. Adding
      // the field without touching this would have exempted the node kind
      // that sits CLOSEST to a just-practised line.
      const issues = validateNodeResponse(
        {
          node: {
            kind: 'question',
            beats: [
              { speaker: 'narrator', practiceText: practicedLine, nativeText: 'x' },
            ],
            gradedPlan: { kind: 'comprehension', npcUtterance: 'Autre chose ?' },
          },
          options: [],
        },
        { practicedLine },
      );
      expect(issues.some((i) => i.code === 'node-repeats-practiced-line')).toBe(true);
    });
  });

  it('the WARN-ONLY codes still carry a message, because the buffer renders it', () => {
    // ⚠ REPLACES `renderRetryHint is empty for no issues and lists codes
    // otherwise`, deleted with the renderer in SRV-PROMPT-8..13 batch 8. That
    // test checked a string this module no longer writes: the retry sentences
    // are `lifeStepViolations.ts`'s, proved byte-identical by
    // `functions/src/__tests__/stepGoldenParity.test.ts`.
    //
    // What survives it is the property the WARN-ONLY codes still need, and it
    // is one the server side cannot assert: these three never reach a retry —
    // they SHIP (LIFE-NODE-8 never strands the player behind a validator) — so
    // their `message` is read only by the debug overlay, and it must not be
    // allowed to become an empty string now that nothing else renders it.
    const issues = validateNodeResponse({
      node: null,
      options: [
        { id: 'a', practiceText: 'Bonjour', nativeText: 'Hello' },
        { id: 'b', practiceText: 'bonjour', nativeText: 'hello' },
      ],
    });
    expect(issues.map((i) => i.code).sort()).toEqual([
      'duplicate-native',
      'duplicate-practice',
    ]);
    for (const i of issues) {
      expect(i.message.length, i.code).toBeGreaterThan(20);
      // ...and it names the offending pair, so the overlay is actionable.
      expect(i.message, i.code).toMatch(/Option 1 duplicates option 0/);
    }
  });
});

/**
 * LIFE-CONTRACT-EX-10 — only an ACT pick requires a lead-in.
 *
 * Found 2026-08-10 by attributing rejections by the pick's `speechAct` after a
 * per-turn directive made the model obey the prompt more reliably and the retry
 * rate went UP. All nine new rejections were `say` picks — the model doing
 * exactly what both the SI and the directive told it.
 *
 * The prompt has always said a speech pick needs no lead-in; the validator has
 * always rejected that. 9 of 20 rejections across four runs of the shipped
 * prompt were this contradiction, which is why no amount of rewording moved the
 * number.
 */
describe('LIFE-CONTRACT-EX-10 — the lead-in is required after an ACT, not after speech', () => {
  const question = (beats: unknown[]) => ({
    node: { kind: 'question' as const, beats, gradedPlan: { kind: 'comprehension', npcUtterance: 'Bonjour.' } },
    options: [],
  });
  const codes = (pickedSpeechAct: 'say' | 'act' | null) =>
    validateNodeResponse(question([]) as never, { pickedSpeechAct }).map((i) => i.code);

  it('an ACT pick with no lead-in is still rejected — the action would vanish', () => {
    expect(codes('act')).toContain('question-omits-lead-in');
  });

  it('a SAY pick with no lead-in is LEGAL — the line is already on screen', () => {
    // LIFE-SPEECH-2: the client prepends the player's line the instant they
    // pick, one call before this. Nothing vanished.
    expect(codes('say')).not.toContain('question-omits-lead-in');
  });

  /**
   * LIFE-SPEECH-8 — the `hear` case USED to be here, asserting the disarm.
   *
   * It was the only live behaviour `hear` had, and it ran backwards: all 4
   * `hear` options ever authored were ambient sound ("Listen at the door"),
   * which is a player ACTION whose outcome the next node owes a beat. The
   * disarm suppressed the lead-in on exactly the turns that needed one.
   *
   * With `hear` gone from the enum those picks are `act`, so the coverage they
   * had is now the ACT case above — which REQUIRES the beat. This comment is
   * the record that the change of answer was deliberate, not a dropped test.
   */
  it('a turn with no pick at all stays legal', () => {
    expect(codes(null)).not.toContain('question-omits-lead-in');
  });

  it('an ACT pick WITH a lead-in passes', () => {
    const beat = { speaker: 'narrator', practiceText: 'Tu pousses la porte.', nativeText: 'You push the door.' };
    const issues = validateNodeResponse(question([beat]) as never, { pickedSpeechAct: 'act' });
    expect(issues.map((i) => i.code)).not.toContain('question-omits-lead-in');
  });
});
