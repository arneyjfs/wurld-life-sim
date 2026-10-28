import { describe, it, expect, vi } from 'vitest';
import { createTextGraders } from './nodeEngineExercises';
import type { NodeEngineState } from './nodeEngineTypes';

/** A minimal question-ready machine state for the graders. */
function machine(): { current: NodeEngineState } {
  return {
    current: {
      phase: 'question-ready',
      waitKind: null,
      nodeKind: 'question',
      options: [],
      feedback: null,
      composerOpen: false,
      cardMatchPending: false,
      cardMatch: null,
      question: {
        practicePrompt: {
          kind: 'generation',
          practiceText: 'Je ___ un café',
          nativeText: 'I ___ a coffee',
        },
        choices: [
          { id: 'a', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
          { id: 'b', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
        ],
      },
    } as NodeEngineState,
  };
}

describe('createTextGraders — LIFE-EX-8/11', () => {
  it('gradeTyped: correct iff the typed word matches the correct chip', () => {
    const resolveGraded = vi.fn();
    const { gradeTyped } = createTextGraders({ machineRef: machine(), resolveGraded });
    gradeTyped('  Voudrais ');
    expect(resolveGraded).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: '__typed__', correctness: 'correct' }),
      true,
    );
    gradeTyped('veux');
    expect(resolveGraded).toHaveBeenLastCalledWith(
      expect.objectContaining({ correctness: 'wrong' }),
      false,
    );
  });

  it('gradeOrder: correct iff the assembled sentence matches the completed target', () => {
    const resolveGraded = vi.fn();
    const { gradeOrder } = createTextGraders({ machineRef: machine(), resolveGraded });
    // Completed target = template with the correct chip = "Je voudrais un café".
    gradeOrder('Je voudrais un café');
    expect(resolveGraded).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: '__ordered__', correctness: 'correct' }),
      true,
    );
    gradeOrder('voudrais Je un café');
    expect(resolveGraded).toHaveBeenLastCalledWith(
      expect.objectContaining({ correctness: 'wrong' }),
      false,
    );
  });

  it('both no-op when there is no fill-blank question', () => {
    const resolveGraded = vi.fn();
    const ref = machine();
    ref.current.question = null;
    const { gradeTyped, gradeOrder } = createTextGraders({ machineRef: ref, resolveGraded });
    gradeTyped('x');
    gradeOrder('x');
    expect(resolveGraded).not.toHaveBeenCalled();
  });

  it('LIFE-EX-DIR-1 — a produced answer is impossible on an NPC-direction question', () => {
    // Typing / ordering an answer PRODUCES the player's own line, so both
    // graders are outbound-only. The `kind !== 'generation'` guard is the
    // direction gate (fill-blank ⇔ speaker: 'player'); loosening it would let
    // the player's typed words resolve into an NPC's bubble.
    const resolveGraded = vi.fn();
    const ref = machine();
    ref.current.question = {
      practicePrompt: {
        kind: 'comprehension',
        npcUtterance: 'Le train part dans dix minutes.',
        question: 'What is Sophie saying?',
      },
      choices: [
        { id: 'a', practiceText: 'Elle parle du train', nativeText: 'She is talking about the train', correctness: 'correct' },
        { id: 'b', practiceText: 'Elle parle du café', nativeText: 'She is talking about coffee', correctness: 'wrong' },
      ],
    };
    const { gradeTyped, gradeOrder } = createTextGraders({ machineRef: ref, resolveGraded });
    gradeTyped('Le train part dans dix minutes.');
    gradeOrder('Le train part dans dix minutes.');
    expect(resolveGraded).not.toHaveBeenCalled();
  });
});
