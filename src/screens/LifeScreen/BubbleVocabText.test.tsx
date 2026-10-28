import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// LIFE-BUBBLE-7: force reduced-motion so the popover height-reveal resolves
// INSTANTLY (no lingering DOM through the close animation) — the reveal is
// visual (screenshot-reviewed); these tests assert the open/close LOGIC.
vi.mock('./nodeEngineGlide', async (importActual) => ({
  ...(await importActual<typeof import('./nodeEngineGlide')>()),
  prefersReducedMotion: () => true,
}));

import { BubbleVocabText, type VocabBubble } from './BubbleVocabText';
import { useVocabStore } from '@/store/vocabStore';
import type { LifeWordSave } from './useLifeWordSave';

const bubble: VocabBubble = {
  id: 'b1',
  speaker: 'npc',
  speakerName: 'Sophie',
  practiceText: 'On déjeune ensemble à midi ?',
  complexWords: ['déjeune'],
  wordTranslations: { 'déjeune': 'have lunch' },
};

function makeWordSave(overrides?: Partial<LifeWordSave>): LifeWordSave {
  return {
    isSaved: () => false,
    isSaving: () => false,
    toggleSave: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  useVocabStore.getState().close();
});

describe('BubbleVocabText — LIFE-BUBBLE-7', () => {
  it('LIFE-BUBBLE-7 — complex word renders as a tappable button; tap opens the popover with the native gloss', () => {
    render(
      <BubbleVocabText
        bubble={bubble}
        text={bubble.practiceText}
        mine={false}
        wordSave={makeWordSave()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    expect(screen.getByText('have lunch')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save to flashcards' }),
    ).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — save button routes to toggleSave(bubble, word)', () => {
    const ws = makeWordSave();
    render(
      <BubbleVocabText
        bubble={bubble}
        text={bubble.practiceText}
        mine={false}
        wordSave={ws}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save to flashcards' }));
    expect(ws.toggleSave).toHaveBeenCalledWith(bubble, 'déjeune');
  });

  it('LIFE-BUBBLE-7 — saved word shows the remove affordance', () => {
    render(
      <BubbleVocabText
        bubble={bubble}
        text={bubble.practiceText}
        mine={false}
        wordSave={makeWordSave({ isSaved: () => true })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    expect(
      screen.getByRole('button', { name: 'Remove from flashcards' }),
    ).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — case-tolerant gloss lookup (model-cased key, lowercased tap)', () => {
    const cased: VocabBubble = {
      ...bubble,
      id: 'b-cased',
      practiceText: 'Salut ! On mange ?',
      complexWords: ['Salut'],
      wordTranslations: { 'Salut': 'Hi' },
    };
    render(
      <BubbleVocabText
        bubble={cased}
        text={cased.practiceText}
        mine={false}
        wordSave={makeWordSave()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salut' }));
    expect(screen.getByText('Hi')).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — second tap on the same word closes the popover (vocabStore toggle)', () => {
    render(
      <BubbleVocabText
        bubble={bubble}
        text={bubble.practiceText}
        mine={false}
        wordSave={makeWordSave()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    expect(screen.getByText('have lunch')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    expect(screen.queryByText('have lunch')).not.toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — only ONE popover open across bubbles (vocabStore singleton)', () => {
    const other: VocabBubble = {
      ...bubble,
      id: 'b2',
      wordTranslations: { 'déjeune': 'second gloss' },
    };
    render(
      <>
        <BubbleVocabText
          bubble={bubble}
          text={bubble.practiceText}
          mine={false}
          wordSave={makeWordSave()}
        />
        <BubbleVocabText
          bubble={other}
          text={other.practiceText}
          mine
          wordSave={makeWordSave()}
        />
      </>,
    );
    const buttons = screen.getAllByRole('button', { name: 'déjeune' });
    fireEvent.click(buttons[0]!);
    expect(screen.getByText('have lunch')).toBeInTheDocument();
    fireEvent.click(buttons[1]!);
    expect(screen.queryByText('have lunch')).not.toBeInTheDocument();
    expect(screen.getByText('second gloss')).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — no wordSave → plain text, no buttons, no underlines', () => {
    render(<BubbleVocabText bubble={bubble} text={bubble.practiceText} mine={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/On déjeune ensemble/)).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — a non-practice primary line (LIFE-LANG-3 native-only) renders plain', () => {
    render(
      <BubbleVocabText
        bubble={bubble}
        text="Lunch together at noon?"
        mine={false}
        wordSave={makeWordSave()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Lunch together at noon?')).toBeInTheDocument();
  });
});
