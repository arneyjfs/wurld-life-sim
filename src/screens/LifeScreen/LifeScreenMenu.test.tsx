import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// The menu transitively imports the Firebase-backed world lib; mock it
// so no real Firestore is touched and we can assert the difficulty writes.
const { updateLifeWorld, deleteLifeWorld } = vi.hoisted(() => ({
  updateLifeWorld: vi.fn(() => Promise.resolve()),
  deleteLifeWorld: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/life/world', () => ({ updateLifeWorld, deleteLifeWorld }));
// The debug overlay pulls the telemetry/log tabs — irrelevant here.
vi.mock('./LifeDebugLogOverlay', () => ({ LifeDebugLogOverlay: () => null }));

import { LifeScreenMenu } from './LifeScreenMenu';

function renderMenu(props: Partial<ComponentProps<typeof LifeScreenMenu>> = {}) {
  render(
    <LifeScreenMenu
      uid="u1"
      worldId="w1"
      viewSettings={{ primary: 'practice', secondRow: false }}
      onSetViewSettings={() => undefined}
      practiceLanguage="French"
      nativeLanguage="English"
      difficultyPinned={null}
      globalDifficulty={5}
      onDeleted={() => undefined}
      onError={() => undefined}
      {...props}
    />,
  );
}

function openMenu() {
  fireEvent.click(screen.getByTestId('LifeScreen-MenuButton'));
}

beforeEach(() => {
  updateLifeWorld.mockReset();
  deleteLifeWorld.mockReset();
});

describe('LifeScreenMenu difficulty control — LIFE-SETTINGS-7', () => {
  it('LIFE-SETTINGS-7 — automatic default shows "Following global · Level X: label"', () => {
    renderMenu({ difficultyPinned: null, globalDifficulty: 5 });
    openMenu();
    const state = screen.getByTestId('LifeScreen-Menu-Difficulty-State');
    expect(state).toHaveTextContent('Following global');
    expect(state).toHaveTextContent('Level 5');
    expect(state).toHaveTextContent('Conversational'); // settings.difficulty.level5.label
  });

  it('LIFE-SETTINGS-7 — a pinned wurld shows its fixed level, not the global one', () => {
    renderMenu({ difficultyPinned: 3, globalDifficulty: 5 });
    openMenu();
    const state = screen.getByTestId('LifeScreen-Menu-Difficulty-State');
    expect(state).toHaveTextContent('Level 3');
    expect(state).toHaveTextContent('Improver'); // settings.difficulty.level3.label
    expect(state).not.toHaveTextContent('Following global');
  });

  it('LIFE-SETTINGS-7 — picking a level pins it via updateLifeWorld(difficultyPinned=N)', () => {
    renderMenu({ difficultyPinned: null, globalDifficulty: 5 });
    openMenu();
    fireEvent.click(screen.getByTestId('LifeScreen-Menu-Difficulty')); // expand the picker
    fireEvent.click(screen.getByTestId('LifeScreen-Menu-Difficulty-Level-4'));
    expect(updateLifeWorld).toHaveBeenCalledWith('u1', 'w1', { difficultyPinned: 4 });
  });

  it('LIFE-SETTINGS-7 — "Use global setting" un-pins via updateLifeWorld(difficultyPinned=null)', () => {
    renderMenu({ difficultyPinned: 3, globalDifficulty: 5 });
    openMenu();
    fireEvent.click(screen.getByTestId('LifeScreen-Menu-Difficulty')); // expand the picker
    fireEvent.click(screen.getByTestId('LifeScreen-Menu-Difficulty-UseGlobal'));
    expect(updateLifeWorld).toHaveBeenCalledWith('u1', 'w1', { difficultyPinned: null });
  });

  it('LIFE-SETTINGS-7 — the un-pin affordance is absent while already following global', () => {
    renderMenu({ difficultyPinned: null, globalDifficulty: 5 });
    openMenu();
    fireEvent.click(screen.getByTestId('LifeScreen-Menu-Difficulty')); // expand the picker
    expect(screen.queryByTestId('LifeScreen-Menu-Difficulty-UseGlobal')).toBeNull();
  });
});
