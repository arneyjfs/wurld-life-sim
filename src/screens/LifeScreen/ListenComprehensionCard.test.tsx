/**
 * LIFE-EX-12 — listen-and-answer.
 *
 * The load-bearing assertion is the NEGATIVE one: the utterance must not be on
 * screen. Print it and the player reads it, as everyone does when text is
 * available, and the "listening exercise" is a reading exercise with a speaker
 * button — which is exactly the variant it is supposed to differ from.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PracticePrompt } from '@/lib/life/stepSchema';

vi.mock('@/i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));
// The TTS button reaches for a Cloud Function + audio; the card's contract is
// that it PASSES the utterance to it, which a stub records faithfully.
vi.mock('@/components/TTSButton', () => ({
  TTSButton: ({ text, autoPlay }: { text: string; autoPlay?: boolean }) => (
    <span data-testid="tts" data-text={text} data-autoplay={String(!!autoPlay)} />
  ),
}));

import { ListenComprehensionCard } from './ListenComprehensionCard';

const UTTERANCE = 'Quelqu’un d’autre nous observe depuis les arcades.';
const prompt = (over: Partial<Extract<PracticePrompt, { kind: 'comprehension' }>> = {}) =>
  ({
    kind: 'comprehension',
    npcUtterance: UTTERANCE,
    question: 'What is Rémy telling you?',
    speakerName: 'Rémy',
    ...over,
  }) as Extract<PracticePrompt, { kind: 'comprehension' }>;

const renderCard = (p = prompt()) =>
  render(<ListenComprehensionCard prompt={p} practiceLanguage="French" playbackKey="k1" />);

describe('LIFE-EX-12 — the utterance is HEARD, not read', () => {
  it('does NOT print the NPC utterance anywhere', () => {
    renderCard();
    expect(screen.queryByText(new RegExp(UTTERANCE.slice(0, 20)))).toBeNull();
  });

  it('hands the utterance to TTS, and autoplays it', () => {
    renderCard();
    const tts = screen.getByTestId('tts');
    expect(tts).toHaveAttribute('data-text', UTTERANCE);
    expect(tts).toHaveAttribute('data-autoplay', 'true');
  });

  it('holds the utterance\'s place so the chips below do not jump between variants', () => {
    renderCard();
    expect(screen.getByTestId('LifeScreen-ListenComprehension-Hidden')).toBeInTheDocument();
  });
});

describe('LIFE-EX-12 — context stays, content goes', () => {
  it('SHOWS the speaker — who is talking to you is context, not the thing tested', () => {
    renderCard();
    expect(
      screen.getByTestId('LifeScreen-ListenComprehension-Speaker'),
    ).toHaveTextContent('Rémy');
  });

  it('omits the speaker row entirely when the plan carries no name', () => {
    renderCard(prompt({ speakerName: null }));
    expect(screen.queryByTestId('LifeScreen-ListenComprehension-Speaker')).toBeNull();
  });

  it('SHOWS the native-language question — it is the task, not the answer', () => {
    renderCard();
    expect(screen.getByText('What is Rémy telling you?')).toBeInTheDocument();
  });

  it('renders without a question line rather than an empty row', () => {
    renderCard(prompt({ question: '   ' }));
    expect(screen.getByTestId('LifeScreen-ListenComprehension')).toBeInTheDocument();
  });
});
