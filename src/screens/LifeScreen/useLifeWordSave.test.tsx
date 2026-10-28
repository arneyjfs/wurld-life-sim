import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addFlashCard: vi.fn(async () => 'new-card-id'),
  deleteFlashcard: vi.fn(async () => {}),
}));
vi.mock('@/lib/flashcards', () => ({
  addFlashCard: mocks.addFlashCard,
  deleteFlashcard: mocks.deleteFlashcard,
}));
vi.mock('@/lib/log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import { useLifeWordSave, type SaveableBubble } from './useLifeWordSave';
import type { FlashcardMatch } from './ActionBar';
import type { LifeWorld } from '@/types/firestore';

const world = {
  id: 'w-1',
  characterName: 'Alex',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
} as LifeWorld;

const npcBubble: SaveableBubble = {
  speaker: 'npc',
  speakerName: 'Sophie',
  practiceText: 'On déjeune ensemble ?',
  wordTranslations: { 'déjeune': 'have lunch' },
};

function mount(lookup: ReadonlyMap<string, FlashcardMatch> = new Map()) {
  return renderHook(() =>
    useLifeWordSave({
      uid: 'u1',
      world,
      locationLabel: 'Le café · matin',
      flashcardLookup: lookup,
    }),
  );
}

beforeEach(() => {
  mocks.addFlashCard.mockClear();
  mocks.deleteFlashcard.mockClear();
});

describe('useLifeWordSave — LIFE-BUBBLE-7', () => {
  it('LIFE-BUBBLE-7 — save calls addFlashCard with the story-context stamp', async () => {
    const { result } = mount();
    await act(async () => {
      result.current.toggleSave(npcBubble, 'déjeune');
    });
    expect(mocks.addFlashCard).toHaveBeenCalledTimes(1);
    expect(mocks.addFlashCard).toHaveBeenCalledWith('u1', {
      phrase: 'déjeune',
      translation: 'have lunch',
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      context: '"On déjeune ensemble ?" — Sophie, Le café · matin',
    });
  });

  it('LIFE-BUBBLE-7 — narrator bubbles stamp the Narrator label; user bubbles stamp the character name', async () => {
    const { result } = mount();
    await act(async () => {
      result.current.toggleSave(
        {
          speaker: 'narrator',
          practiceText: 'Tu entres.',
          wordTranslations: { 'entres': 'enter' },
        },
        'entres',
      );
    });
    expect(mocks.addFlashCard).toHaveBeenLastCalledWith(
      'u1',
      expect.objectContaining({
        context: '"Tu entres." — Narrator, Le café · matin',
      }),
    );
    await act(async () => {
      result.current.toggleSave(
        {
          speaker: 'user',
          practiceText: 'Je voudrais un café.',
          wordTranslations: { 'voudrais': 'would like' },
        },
        'voudrais',
      );
    });
    expect(mocks.addFlashCard).toHaveBeenLastCalledWith(
      'u1',
      expect.objectContaining({
        context: '"Je voudrais un café." — Alex, Le café · matin',
      }),
    );
  });

  it('LIFE-BUBBLE-7 — a word already in the deck unsaves via deleteFlashcard with the matched card id', async () => {
    const lookup = new Map<string, FlashcardMatch>([
      [
        'déjeune',
        { id: 'card-9', phrase: 'déjeune', translation: 'have lunch', context: null },
      ],
    ]);
    const { result } = mount(lookup);
    expect(result.current.isSaved('déjeune')).toBe(true);
    await act(async () => {
      result.current.toggleSave(npcBubble, 'déjeune');
    });
    expect(mocks.deleteFlashcard).toHaveBeenCalledWith({ uid: 'u1', cardId: 'card-9' });
    expect(mocks.addFlashCard).not.toHaveBeenCalled();
  });

  it('LIFE-BUBBLE-7 — no gloss for an unsaved word → no write at all', async () => {
    const { result } = mount();
    await act(async () => {
      result.current.toggleSave({ speaker: 'npc', practiceText: 'Bonjour.' }, 'bonjour');
    });
    expect(mocks.addFlashCard).not.toHaveBeenCalled();
    expect(mocks.deleteFlashcard).not.toHaveBeenCalled();
  });

  it('LIFE-BUBBLE-7 — isSaving is true while the save is in flight, false after', async () => {
    let release: (v: string) => void = () => {};
    mocks.addFlashCard.mockReturnValueOnce(
      new Promise<string>((r) => {
        release = r;
      }),
    );
    const { result } = mount();
    act(() => {
      result.current.toggleSave(npcBubble, 'déjeune');
    });
    expect(result.current.isSaving('déjeune')).toBe(true);
    await act(async () => {
      release('new-card-id');
    });
    expect(result.current.isSaving('déjeune')).toBe(false);
  });

  it('LIFE-BUBBLE-7 — null uid/world → no-op', async () => {
    const { result } = renderHook(() =>
      useLifeWordSave({
        uid: null,
        world: null,
        locationLabel: 'x',
        flashcardLookup: new Map(),
      }),
    );
    await act(async () => {
      result.current.toggleSave(npcBubble, 'déjeune');
    });
    expect(mocks.addFlashCard).not.toHaveBeenCalled();
  });
});
