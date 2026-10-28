import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WordPopover } from './WordPopover';

// The real TTSButton reads auth/profile stores and the playback singleton;
// these tests only care WHAT the card hands it (MSG-VOCAB-9).
vi.mock('@/components/TTSButton', () => ({
  TTSButton: (p: {
    text: string;
    language?: string;
    playbackKey: string;
    warmOnMount?: boolean;
    size?: number;
    variant?: string;
    className?: string;
  }) => (
    <button
      type="button"
      data-testid="tts-button"
      data-text={p.text}
      data-language={p.language}
      data-key={p.playbackKey}
      data-warm={String(p.warmOnMount)}
      data-size={String(p.size)}
      data-variant={p.variant}
      className={p.className}
    />
  ),
}));

/**
 * MSG-VOCAB-4 / MSG-VOCAB-4.1 — the vocab card's sizing contract
 * (docs/specs/message-pipeline.md).
 *
 * jsdom does no layout, so geometry isn't assertable here; what IS assertable
 * is the declaration set the card ships with, which is where both invariants
 * actually live.
 */

function card() {
  return document.querySelector('[data-popover-card]') as HTMLElement;
}

const base = {
  word: 'appuyer',
  translation: 'to press',
  mine: false,
  saved: false,
  saving: false,
  onSave: () => {},
};

describe('WordPopover — sizing (MSG-VOCAB-4.1)', () => {
  it('MSG-VOCAB-4.1 — an UNPINNED card carries the full intrinsic chain', () => {
    render(<WordPopover {...base} />);
    const el = card();
    expect(el).toHaveClass('min-w-full');
    expect(el).toHaveClass('w-max');
    expect(el).toHaveClass('max-w-[260px]');
    expect(el.style.width).toBe('');
  });

  it('MSG-VOCAB-4.1 — a PINNED card keeps min-w-full, so the pin is a preference not a ceiling', () => {
    render(<WordPopover {...base} pinnedWidth={180} />);
    const el = card();
    // The whole point: a bubble that grew out from under the measured pin
    // still gets a full-width card rather than an inset chip.
    expect(el).toHaveClass('min-w-full');
    expect(el.style.width).toBe('180px');
  });

  it('MSG-VOCAB-4 — pinning still REPLACES the intrinsic preferred/max widths', () => {
    // Those are what re-wrap mid-animation; only the floor survives.
    const el = (render(<WordPopover {...base} pinnedWidth={180} />), card());
    expect(el).not.toHaveClass('w-max');
    expect(el).not.toHaveClass('max-w-[260px]');
  });

  it('MSG-VOCAB-4 — a zero/absent measurement falls back to the intrinsic chain', () => {
    render(<WordPopover {...base} pinnedWidth={null} />);
    expect(card()).toHaveClass('w-max');
    expect(card().style.width).toBe('');
  });

  it('renders the word, its translation and the save affordance', () => {
    render(<WordPopover {...base} />);
    expect(card().querySelector('[dir]')?.textContent).toBe('appuyer: to press');
    expect(screen.getByText('to press')).toBeInTheDocument();
    expect(screen.getByLabelText('Save to flashcards')).toBeInTheDocument();
  });
});

describe('WordPopover — speak button (MSG-VOCAB-9)', () => {
  const speak = { speakLanguage: 'French', speakScope: 'msg-1' };

  it('MSG-VOCAB-9 — the speak button sits INLINE, straight after the phrase and before the colon', () => {
    render(<WordPopover {...base} {...speak} />);
    const tts = screen.getByTestId('word-popover-tts');
    const text = tts.closest('[dir]') as HTMLElement;
    // Inside the text block, not a sibling slot of the card.
    expect(text.parentElement).toBe(card());
    const phrase = screen.getByText('appuyer');
    // DOCUMENT_POSITION_FOLLOWING: the speaker comes after the phrase…
    expect(phrase.compareDocumentPosition(tts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // …and the colon after the speaker.
    const colon = screen.getByText(':');
    expect(tts.compareDocumentPosition(colon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const kids = Array.from(card().children);
    expect(kids[kids.length - 1]).toHaveAccessibleName('Save to flashcards');
  });

  it('MSG-VOCAB-9.1 — speaks ONLY the tapped word, in the practice language', () => {
    render(<WordPopover {...base} word="Tiens-moi au courant" {...speak} />);
    const tts = screen.getByTestId('tts-button');
    expect(tts).toHaveAttribute('data-text', 'Tiens-moi au courant');
    expect(tts).toHaveAttribute('data-language', 'French');
  });

  it('MSG-VOCAB-9.1 — no language, no speak button (the card is the pre-9 card)', () => {
    render(<WordPopover {...base} />);
    expect(screen.queryByTestId('word-popover-tts')).toBeNull();
    expect(screen.queryByTestId('tts-button')).toBeNull();
  });

  it('MSG-VOCAB-9.2 — its own playback key, vocab:<scope>:<word lowercased>, never msg:<id>', () => {
    render(<WordPopover {...base} word="Appuyer" {...speak} />);
    expect(screen.getByTestId('tts-button')).toHaveAttribute('data-key', 'vocab:msg-1:appuyer');
  });

  it('MSG-VOCAB-9.3 — on demand only: warmOnMount is false', () => {
    render(<WordPopover {...base} {...speak} />);
    expect(screen.getByTestId('tts-button')).toHaveAttribute('data-warm', 'false');
  });

  it('MSG-VOCAB-9.4 — pointerdown AND mousedown are default-prevented (keyboard stays up)', () => {
    render(<WordPopover {...base} {...speak} />);
    const tts = screen.getByTestId('tts-button');
    // fireEvent returns false when a listener called preventDefault.
    expect(fireEvent.pointerDown(tts)).toBe(false);
    expect(fireEvent.mouseDown(tts)).toBe(false);
  });

  it('MSG-VOCAB-9.4 — a tap on the speak button does not reach the bubble', () => {
    const bubbleClick = vi.fn();
    render(
      <div onClick={bubbleClick}>
        <WordPopover {...base} {...speak} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('tts-button'));
    expect(bubbleClick).not.toHaveBeenCalled();
  });

  it('MSG-VOCAB-9.5 — a bare inline icon: the TTSButton bare variant, no circle or fill', () => {
    render(<WordPopover {...base} {...speak} />);
    const tts = screen.getByTestId('tts-button');
    expect(tts).toHaveAttribute('data-variant', 'bare');
    expect(tts.className).not.toMatch(/rounded-full|bg-/);
  });

  it('MSG-VOCAB-9.5 — black/white, never the accent: --color-fg on theirs, white on mine', () => {
    const { unmount } = render(<WordPopover {...base} {...speak} />);
    let tts = screen.getByTestId('tts-button');
    expect(tts.className).toContain('text-(--color-fg)');
    expect(tts.className).not.toMatch(/accent/);
    unmount();
    render(<WordPopover {...base} {...speak} mine />);
    tts = screen.getByTestId('tts-button');
    expect(tts.className).toMatch(/text-white/);
    expect(tts.className).not.toMatch(/accent/);
  });
});

describe('WordPopover — phrase explainer button (MSG-VOCAB-13 / EXPLAIN-PHRASE-1)', () => {
  it('MSG-VOCAB-13 — with an explain handler the LEFT slot is a ? button', () => {
    render(<WordPopover {...base} onExplain={() => {}} />);
    const first = card().children[0] as HTMLElement;
    expect(first).toHaveAccessibleName('Explain this phrase');
    expect(first.tagName).toBe('BUTTON');
  });

  it('EXPLAIN-PHRASE-1 — no handler (review dock, life sim): no ? button', () => {
    render(<WordPopover {...base} />);
    expect(screen.queryByLabelText('Explain this phrase')).toBeNull();
  });

  it('MSG-VOCAB-13 — the ? has the save button\'s footprint and fill on each side', () => {
    const { unmount } = render(<WordPopover {...base} onExplain={() => {}} />);
    let q = screen.getByLabelText('Explain this phrase');
    expect(q).toHaveClass('w-6', 'h-6', 'rounded-full', 'bg-(--color-vocab-circle-theirs)');
    unmount();
    render(<WordPopover {...base} mine onExplain={() => {}} />);
    q = screen.getByLabelText('Explain this phrase');
    expect(q).toHaveClass('bg-white/15', 'text-white');
  });

  it('EXPLAIN-PHRASE-2 — a tap calls the handler with the word and does not reach the bubble', () => {
    const onExplain = vi.fn();
    const bubbleClick = vi.fn();
    render(
      <div onClick={bubbleClick}>
        <WordPopover {...base} onExplain={onExplain} />
      </div>,
    );
    fireEvent.click(screen.getByLabelText('Explain this phrase'));
    expect(onExplain).toHaveBeenCalledTimes(1);
    expect(bubbleClick).not.toHaveBeenCalled();
  });

  it('EXPLAIN-PHRASE-2.4 — pointerdown AND mousedown are default-prevented (keyboard stays up)', () => {
    render(<WordPopover {...base} onExplain={() => {}} />);
    const q = screen.getByLabelText('Explain this phrase');
    expect(fireEvent.pointerDown(q)).toBe(false);
    expect(fireEvent.mouseDown(q)).toBe(false);
  });

  it('EXPLAIN-PHRASE-2 — while explaining, the ? spins and a second tap does nothing', () => {
    const onExplain = vi.fn();
    render(<WordPopover {...base} onExplain={onExplain} explaining />);
    const q = screen.getByLabelText('Explain this phrase');
    expect(q).toHaveAttribute('aria-busy', 'true');
    expect(q.querySelector('.animate-spin')).not.toBeNull();
    fireEvent.click(q);
    expect(onExplain).not.toHaveBeenCalled();
  });
});

describe('WordPopover — button circles (MSG-VOCAB-14)', () => {
  it('MSG-VOCAB-14.1 — on a received bubble both circles are an accent wash, not the near-invisible hover grey', () => {
    render(<WordPopover {...base} onExplain={() => {}} />);
    for (const b of [screen.getByLabelText('Explain this phrase'), screen.getByLabelText('Save to flashcards')]) {
      expect(b).toHaveClass('bg-(--color-vocab-circle-theirs)', 'text-(--color-icon-accent)');
      expect(b.className).not.toMatch(/bg-\(--color-bg-hover\)/);
    }
  });

  it('MSG-VOCAB-14.1 — on my bubble both circles stay white at 15%', () => {
    render(<WordPopover {...base} mine onExplain={() => {}} />);
    for (const b of [screen.getByLabelText('Explain this phrase'), screen.getByLabelText('Save to flashcards')]) {
      expect(b).toHaveClass('bg-white/15', 'text-white');
    }
  });

  it('MSG-VOCAB-14.2 — saved: the icon goes solid green; the circle keeps its usual fill', () => {
    for (const mine of [false, true]) {
      const { unmount } = render(<WordPopover {...base} mine={mine} saved />);
      const b = screen.getByLabelText('Remove from flashcards');
      expect(b).toHaveClass(mine ? 'bg-white/15' : 'bg-(--color-vocab-circle-theirs)');
      expect(b.className).not.toMatch(/color-success/);
      const icon = b.querySelector('[data-testid="flashcard-icon"]')!;
      expect(icon.getAttribute('data-filled')).toBe('true');
      expect(icon.getAttribute('class')).toContain('text-(--color-flashcard-saved)');
      unmount();
    }
  });
});
