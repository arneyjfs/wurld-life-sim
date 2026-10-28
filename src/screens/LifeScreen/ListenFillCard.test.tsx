import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Stub the Firebase-backed TTS button; capture its props so we can assert the
// spoken text + that it auto-plays (LIFE-EX-9).
vi.mock('@/components/TTSButton', () => ({
  TTSButton: (p: { text: string; autoPlay?: boolean; language?: string }) => (
    <span
      data-testid="tts-stub"
      data-text={p.text}
      data-autoplay={p.autoPlay ? 'true' : 'false'}
      data-lang={p.language ?? ''}
    />
  ),
}));

import { ListenFillCard } from './ListenFillCard';

const prompt = {
  kind: 'generation' as const,
  practiceText: 'Je ___ un café',
  nativeText: 'I ___ a coffee',
};

describe('ListenFillCard — LIFE-EX-9', () => {
  it('auto-plays the COMPLETED sentence in the practice language', () => {
    render(
      <ListenFillCard
        prompt={prompt}
        completedSentence="Je voudrais un café"
        practiceLanguage="French"
        playbackKey="k1"
      />,
    );
    const tts = screen.getByTestId('tts-stub');
    expect(tts).toHaveAttribute('data-text', 'Je voudrais un café');
    expect(tts).toHaveAttribute('data-autoplay', 'true');
    expect(tts).toHaveAttribute('data-lang', 'French');
  });

  it('shows the blanked template (no answer leak in the visible text)', () => {
    render(
      <ListenFillCard
        prompt={prompt}
        completedSentence="Je voudrais un café"
        practiceLanguage="French"
        playbackKey="k1"
      />,
    );
    const card = screen.getByTestId('LifeScreen-ListenFill');
    expect(card).toHaveTextContent('Je');
    expect(card).toHaveTextContent('un café');
    // The blank stays blank on screen — the answer is only in the audio.
    expect(card).not.toHaveTextContent('voudrais');
    expect(screen.getByLabelText('blank')).toBeInTheDocument();
  });
});
