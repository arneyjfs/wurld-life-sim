/**
 * LIFE-INTENT-2/4 — the `<sceneQuestion>` block.
 *
 * ⚠ MOVED from `src/lib/life/sceneLeaning.test.ts` by SRV-PROMPT-8..13 batch 8:
 * the block is text the model reads, so it crossed with the step prompt. The
 * leaning FOLD stayed client-side. The assertions are unchanged.
 */
import { describe, it, expect } from 'vitest';
import {
  LEANING_STALL_LIMIT,
  renderSceneQuestion,
} from '../../prompts/lifeStepBlocks';

describe('LIFE-INTENT-2 — the rendered block', () => {
  it('LIFE-INTENT-2a — renders NOTHING when the scene has no open question', () => {
    // Scenes opened before this shipped carry no question; the block must not
    // invent one, and must not cost tokens on a scene that cannot use it.
    expect(renderSceneQuestion({ outline: { openQuestion: null }, leaning: 'x', leaningStall: 0  })).toBeNull();
    expect(renderSceneQuestion({ outline: { openQuestion: '   ' }, leaning: 'x', leaningStall: 0 })).toBeNull(); });

  it('LIFE-INTENT-2b — carries the question and the CURRENT leaning', () => {
    const out = renderSceneQuestion({ outline: { openQuestion: 'will Bruno give up the machinery?' }, leaning: 'nobody has asked him yet', leaningStall: 0 });
    expect(out).toContain('will Bruno give up the machinery?');
    expect(out).toContain('nobody has asked him yet');
    expect(out).toContain('stall="0"');
  });

  it('LIFE-INTENT-2e — at the stall limit it DEMANDS an option that can move it', () => {
    const calm = renderSceneQuestion({ outline: { openQuestion: 'will Bruno give up the machinery?' }, leaning: 'nobody has asked him yet', leaningStall: LEANING_STALL_LIMIT - 1 })!;
    const escalated = renderSceneQuestion({ outline: { openQuestion: 'will Bruno give up the machinery?' }, leaning: 'nobody has asked him yet', leaningStall: LEANING_STALL_LIMIT })!;
    expect(calm).not.toMatch(/on rails/i);
    expect(escalated).toMatch(/on rails/i);
    // The escalation's whole point: the NEXT option set must contain a mover.
    expect(escalated).toMatch(/at least one option/i);
  });

  it('LIFE-INTENT-2 — escapes model-authored text', () => {
    const out = renderSceneQuestion({ outline: { openQuestion: 'will <Bruno> & "co" yield?' }, leaning: 'a & b', leaningStall: 0 })!;
    expect(out).not.toContain('<Bruno>');
    expect(out).toContain('&amp;');
  });

  it('LIFE-INTENT-2 — survives a question with no leaning yet', () => {
    const out = renderSceneQuestion({ outline: { openQuestion: 'will Bruno give up the machinery?' }, leaning: null, leaningStall: 0 });
    expect(out).toContain('will Bruno give up the machinery?');
  });
});

describe('LIFE-INTENT-3 — a restated question is not a position', () => {
  /** Verbatim from the 2026-08-04 four-world run — 48 of 134 leanings looked
   *  like these, and they carried 37% of all credited "moves". */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- fixture no test asserts yet; kept pending an owner call (index.ts split report)
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- fixture no test asserts yet; kept pending an owner call (index.ts split report)
  const REAL_POSITIONS = [
    'Julien prioritises the vines over his bank appointment',
    'will refuse unless you pay him first',
    'has agreed in principle, but not in front of his wife',
    'he is hardening — you pushed on the debt',
    'nobody has asked him yet',
    'can be persuaded, but not today',
  ];

  it('LIFE-INTENT-3 — the block tells the model what a position IS', () => {
    const out = renderSceneQuestion({
      outline: { openQuestion: 'will Bruno give up the machinery?' },
      leaning: 'he has not been asked',
      leaningStall: 0,
    })!;
    // The question is FIXED — the block must say so, because the observed
    // failure was the model replacing it every turn.
    expect(out).toMatch(/do not (re-?write|replace|change) (it|the question)/i);
    // And it must show the shape, since telling without showing is what the
    // first version did.
    expect(out).toMatch(/NOT a question/i);
  });
});
