/**
 * LIFE-EX-GEN-11 — the generator already authors WHY each wrong chip is wrong
 * (`whyWrong`). It used to be discarded (a guard-only field) while the learner
 * had to tap "Why?" for a second LLM call. It is now shown inline on an
 * incorrect answer: immediate, error-specific feedback at zero model cost.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PracticeFeedback } from './PracticeFeedback';

const base = {
  picked: { practiceText: 'pourtant', nativeText: '' },
  correctAnswer: { practiceText: 'quand même', nativeText: 'anyway' },
  sentencePractice: 'Je viens quand même au marché.',
  sentenceNative: 'I am coming to the market anyway.',
  onContinue: () => {},
};

describe('PracticeFeedback — whyWrong (LIFE-EX-GEN-11)', () => {
  it('shows the picked chip’s reason on a wrong answer', () => {
    render(
      <PracticeFeedback
        {...base}
        correct={false}
        whyWrong="means “however” — it contrasts two clauses, and there is only one here"
      />,
    );
    expect(screen.getByTestId('LifeScreen-PracticeFeedback-WhyWrong')).toHaveTextContent(
      'means “however”',
    );
  });

  it('shows nothing when the answer was correct', () => {
    render(<PracticeFeedback {...base} correct whyWrong="irrelevant" />);
    expect(screen.queryByTestId('LifeScreen-PracticeFeedback-WhyWrong')).toBeNull();
  });

  it('omits the row when the generator supplied no reason (legacy / absent)', () => {
    render(<PracticeFeedback {...base} correct={false} />);
    expect(screen.queryByTestId('LifeScreen-PracticeFeedback-WhyWrong')).toBeNull();
  });
});

/**
 * LIFE-LANG-17 — "It means:" is a promise of a GLOSS, so it only appears when
 * there is one.
 *
 * Reported 2026-07-31: "The 'it means' shows the practice word without native
 * on some question types." A fill-blank chip is a single token inside a
 * sentence and legitimately carries `nativeText: ''` — the meaning lives on the
 * full-sentence row below (LIFE-LANG-6). The label was unconditional while the
 * gloss was conditional, so a correct fill-blank rendered
 *
 *     It means: voudrais
 *
 * which asserts that the word means itself. The label has to follow the data.
 */
describe('LIFE-LANG-17 — the meaning label follows the gloss', () => {
  it('LIFE-LANG-17 — no native gloss ⇒ does NOT claim to give a meaning', () => {
    render(
      <PracticeFeedback
        correct
        picked={{ practiceText: 'voudrais', nativeText: '' }}
        correctAnswer={{ practiceText: 'voudrais', nativeText: '' }}
        sentencePractice="Je voudrais déjeuner avec toi."
        sentenceNative="I would like to have lunch with you."
        onContinue={() => {}}
      />,
    );
    expect(screen.queryByText(/It means:/)).not.toBeInTheDocument();
    // The answer is still shown — this suppresses the CLAIM, not the content.
    expect(screen.getByText('voudrais')).toBeInTheDocument();
  });

  it('LIFE-LANG-17 — a real gloss still says "It means:"', () => {
    render(
      <PracticeFeedback
        correct
        picked={{ practiceText: 'quand même', nativeText: 'anyway' }}
        correctAnswer={{ practiceText: 'quand même', nativeText: 'anyway' }}
        sentencePractice="Il pleut, quand même on y va."
        sentenceNative="It is raining, we are going anyway."
        onContinue={() => {}}
      />,
    );
    expect(screen.getByText(/It means:/)).toBeInTheDocument();
    // "anyway" also appears in the full-sentence translation below, so scope
    // the assertion to the gloss run rather than the whole document.
    expect(screen.getAllByText(/· anyway/).length).toBeGreaterThan(0);
  });

  it('LIFE-LANG-17 — a WRONG answer still names the correct one either way', () => {
    // The wrong-answer label makes no claim about meaning, so it is unaffected
    // by a missing gloss and must keep showing.
    render(
      <PracticeFeedback
        correct={false}
        picked={{ practiceText: 'veux', nativeText: '' }}
        correctAnswer={{ practiceText: 'voudrais', nativeText: '' }}
        sentencePractice="Je voudrais déjeuner avec toi."
        sentenceNative="I would like to have lunch with you."
        onContinue={() => {}}
      />,
    );
    expect(screen.getByText(/The correct answer was:/)).toBeInTheDocument();
  });
});
