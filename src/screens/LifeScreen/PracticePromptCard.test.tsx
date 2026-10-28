/**
 * LIFE-EX-8.2 — the native line on a graded fill-blank is shown ALWAYS.
 *
 * It used to be generator-chosen: shown on `translation-anchor`, hidden on
 * `context-anchor`. Owner-reported twice, most recently 2026-08-05: *"any word
 * could work and there was no target sentence."*
 *
 * The flag was measured rather than argued about. Across 360 `context-anchor`
 * fill-blanks from 17 stored runs, classified by the reason the generator
 * ITSELF gave for each wrong chip, **91% were separated purely by MEANING with
 * no grammatical cue in the set** — the exact case the design reserves for
 * `translation-anchor`. e.g. "War der ___ heute schon hier?" against teacher /
 * driver / visitor / DIRECTOR, every one of which is grammatical and sensible.
 *
 * So the generator was not judging badly at the margin; it was asserting a
 * discriminator nothing checked. `completedNativeText` is required on every
 * fill-blank and was present on 419 of 419 generated, so showing it always
 * costs nothing and needs no fallback.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PracticePrompt } from '@/lib/life/stepSchema';
import { PracticePromptCard } from './PracticePromptCard';

const fillBlank = (over: Partial<Extract<PracticePrompt, { kind: 'generation' }>> = {}): PracticePrompt => ({
  kind: 'generation',
  practiceText: 'Je ___ un café',
  nativeText: 'I ___ a coffee',
  completedNativeText: 'I would like a coffee',
  ...over,
});

describe('LIFE-EX-8.2 — the native anchor is unconditional', () => {
  it('shows on translation-anchor', () => {
    render(<PracticePromptCard prompt={fillBlank({ disambiguation: 'translation-anchor' })} />);
    expect(screen.getByTestId('LifeScreen-PracticePrompt-Anchor')).toHaveTextContent(
      'I would like a coffee',
    );
  });

  it('shows on CONTEXT-anchor too — the claim was wrong 91% of the time', () => {
    // THE REPORTED BUG. This assertion was previously the exact opposite.
    render(<PracticePromptCard prompt={fillBlank({ disambiguation: 'context-anchor' })} />);
    expect(screen.getByTestId('LifeScreen-PracticePrompt-Anchor')).toHaveTextContent(
      'I would like a coffee',
    );
  });

  it('shows on a legacy prompt with no declared strategy', () => {
    render(<PracticePromptCard prompt={fillBlank()} />);
    expect(screen.getByTestId('LifeScreen-PracticePrompt-Anchor')).toHaveTextContent(
      'I would like a coffee',
    );
  });

  it('the reported shape: chips separated only by meaning are now answerable', () => {
    // "War der ___ heute schon hier?" — teacher / driver / visitor / director.
    // Every chip is grammatical; without the native this cannot be answered.
    render(
      <PracticePromptCard
        prompt={fillBlank({
          practiceText: 'War der ___ heute schon hier?',
          nativeText: 'Was the ___ here today?',
          completedNativeText: 'Was the director here today?',
          disambiguation: 'context-anchor',
        })}
      />,
    );
    expect(screen.getByTestId('LifeScreen-PracticePrompt-Anchor')).toHaveTextContent(
      'Was the director here today?',
    );
  });

  it('degrades quietly when the native is genuinely absent', () => {
    // Nothing generated in 17 runs lacked it, but the render must not show an
    // empty row if an old stored question ever does.
    render(<PracticePromptCard prompt={fillBlank({ completedNativeText: '' })} />);
    expect(screen.queryByTestId('LifeScreen-PracticePrompt-Anchor')).toBeNull();
  });

  it('always renders the practice template with the blank highlighted', () => {
    render(<PracticePromptCard prompt={fillBlank({ disambiguation: 'translation-anchor' })} />);
    expect(screen.getByTestId('LifeScreen-PracticePrompt-FillBlank')).toHaveTextContent('Je');
    expect(screen.getByLabelText('blank')).toBeInTheDocument();
  });

  it('comprehension is untouched — no anchor, speaker named, utterance shown', () => {
    render(
      <PracticePromptCard
        prompt={{
          kind: 'comprehension',
          npcUtterance: 'Tu viens avec moi ?',
          question: 'What is Sophie saying?',
          speakerName: 'Sophie',
        }}
      />,
    );
    expect(screen.queryByTestId('LifeScreen-PracticePrompt-Anchor')).toBeNull();
    expect(screen.getByTestId('LifeScreen-PracticePrompt-Speaker')).toHaveTextContent('Sophie');
    expect(screen.getByTestId('LifeScreen-PracticePrompt-Comprehension')).toHaveTextContent(
      'Tu viens avec moi ?',
    );
  });
});
