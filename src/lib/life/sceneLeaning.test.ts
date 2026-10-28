import { describe, it, expect } from 'vitest';

/**
 * ⚠ THE `renderSceneQuestion` ASSERTIONS MOVED with SRV-PROMPT-8..13 batch 8,
 * to `functions/src/__tests__/life/sceneQuestion.test.ts`. The block is prompt
 * text; the FOLD below — which turns the model's declared move into stored
 * state — is engine work and stayed.
 */
import { isRestatedQuestion, nextLeaningState } from './sceneLeaning';

const state = (leaning: string, stall = 0) => ({ leaning, stall });

describe('LIFE-INTENT-2 — the leaning is a state a pick can move', () => {
  it('LIFE-INTENT-2c — a declared move takes the new leaning and clears the stall', () => {
    const next = nextLeaningState(state('nobody has asked him yet', 2), {
      leaning: 'he is hardening — you pushed on the debt',
      leaningMoved: true,
    });
    expect(next.leaning).toBe('he is hardening — you pushed on the debt');
    expect(next.stall).toBe(0);
  });

  it('LIFE-INTENT-2d — a declined move counts, and does NOT rewrite the leaning', () => {
    // Declining is legitimate (an NPC walks in, the player observes) but it is
    // a CLAIM that the pick changed nothing, so it must not also get to edit
    // the state it just said was unchanged.
    const next = nextLeaningState(state('nobody has asked him yet', 0), {
      leaning: 'something subtly different',
      leaningMoved: false,
    });
    expect(next.leaning).toBe('nobody has asked him yet');
    expect(next.stall).toBe(1);
  });

  it('LIFE-INTENT-2d — consecutive declines accumulate', () => {
    let s = state('nobody has asked him yet', 0);
    s = nextLeaningState(s, { leaningMoved: false });
    s = nextLeaningState(s, { leaningMoved: false });
    s = nextLeaningState(s, { leaningMoved: false });
    expect(s.stall).toBe(3);
  });

  it('LIFE-INTENT-2 — a move to EMPTY text is not a move', () => {
    // Otherwise "moved" is satisfiable by erasing the state, which is the
    // do-nothing escape hatch in its purest form.
    for (const empty of ['', '   ', null, undefined]) {
      const next = nextLeaningState(state('he is hardening', 1), {
        leaning: empty,
        leaningMoved: true,
      });
      expect(next.leaning).toBe('he is hardening');
      expect(next.stall).toBe(2);
    }
  });

  it('LIFE-INTENT-2 — a move to the SAME text is not a move either', () => {
    const next = nextLeaningState(state('he is hardening', 0), {
      leaning: '  he is hardening  ',
      leaningMoved: true,
    });
    expect(next.stall).toBe(1);
  });

  it('LIFE-INTENT-2 — an absent signal is a decline, not a reset', () => {
    // A response that omits the field entirely has told us nothing changed.
    // Treating silence as a reset would make the counter unreachable.
    expect(nextLeaningState(state('x', 1), {}).stall).toBe(2);
    expect(nextLeaningState(state('x', 1), undefined).stall).toBe(2);
  });
});

describe('LIFE-INTENT-3 — a restated question is not a position', () => {
  // ⚠ THE SAME TWO VERBATIM LISTS the `<sceneQuestion>` half uses, duplicated
  // by the batch-8 split. They are FIXTURES from one measured run rather than a
  // contract, and both halves have to read the same leanings for the pair of
  // assertions to be about the same thing.
  /** Verbatim from the 2026-08-04 four-world run — 48 of 134 leanings looked
   *  like these, and they carried 37% of all credited "moves". */
  const RESTATED_QUESTIONS = [
    'whether Jacinto successfully uses the distraction to exit',
    'whether the Maestra believes Luz',
    'whether Inés can prove her precision under Elena\'s scrutiny',
    'whether Alice intervenes in the fountain dispute',
    'If Bruno hands over the machinery',
    'Does she believe you?',
  ];

  /** Also verbatim, and all of these must keep counting — several open with
   *  words a lazier detector would flag ("will", "has"), and every one of them
   *  is a genuine position on a question. */
  const REAL_POSITIONS = [
    'Julien prioritises the vines over his bank appointment',
    'will refuse unless you pay him first',
    'has agreed in principle, but not in front of his wife',
    'he is hardening — you pushed on the debt',
    'nobody has asked him yet',
    'can be persuaded, but not today',
  ];


  it('LIFE-INTENT-3 — a question-shaped leaning does not count as a move', () => {
    for (const q of RESTATED_QUESTIONS) {
      const next = nextLeaningState({ leaning: 'he has not been asked', stall: 0 }, {
        leaning: q,
        leaningMoved: true,
      });
      expect(next.stall, `should not count: ${q}`).toBe(1);
      // And it must not overwrite: a scene whose stored position is replaced by
      // a question has lost the only thing the counter measures against.
      expect(next.leaning).toBe('he has not been asked');
    }
  });

  it('LIFE-INTENT-3 — a real position still counts, including "will" and "has"', () => {
    for (const p of REAL_POSITIONS) {
      const next = nextLeaningState({ leaning: 'something else entirely', stall: 3 }, {
        leaning: p,
        leaningMoved: true,
      });
      expect(next.stall, `should count: ${p}`).toBe(0);
      expect(next.leaning).toBe(p);
    }
  });

  it('LIFE-INTENT-3 — the detector is exported and tests FORM, not meaning', () => {
    expect(isRestatedQuestion('whether he agrees')).toBe(true);
    expect(isRestatedQuestion('  If he agrees')).toBe(true);
    expect(isRestatedQuestion('Is he going to agree?')).toBe(true);
    // "whether"/"if" INSIDE a position is not the position being a question.
    expect(isRestatedQuestion('he cannot decide whether to agree')).toBe(false);
    expect(isRestatedQuestion('will agree if you pay first')).toBe(false);
    expect(isRestatedQuestion('')).toBe(false);
  });
});
