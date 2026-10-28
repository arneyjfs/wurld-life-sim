import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WurldResumeScreen } from './WurldResumeScreen';
import type { LifeEvent, LifeWorld, WorldArc, WorldSaga } from '@/types/firestore';

const saga: WorldSaga = {
  title: 'The Lyon Letters',
  titleNative: 'The Lyon Letters',
  playerFacingTeaser: 'A new life in Lyon, and a mystery in the mail.',
  tone: 'warm, curious',
};

const arc: WorldArc = {
  chapterNumber: 2,
  // LIFE-WORLD-ARC-REGISTER: the planner premise MAY spoil — it must NOT reach
  // the player; the spoiler-safe playerTeaser is what the resume screen shows.
  premise: 'model-only chapter premise: the letter-writer is her estranged brother',
  playerTeaser: 'Find out who sends the letters.',
  themes: [],
  status: 'active',
  recurringNpcIds: [],
  completedSceneMemories: [],
};

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  worldMode: 'realistic',
};

const beat = (
  id: string,
  practiceText: string,
  speaker: 'narrator' | 'npc' | 'user' = 'npc',
  nativeText: string | null = null,
): LifeEvent => ({
  id,
  kind: 'beat',
  payload: {
    speaker,
    speakerName: speaker === 'npc' ? 'Sophie' : null,
    practiceText,
    nativeText,
  },
});

describe('WurldResumeScreen — LIFE-FLOW-5', () => {
  it('LIFE-FLOW-5 — renders header, teaser, chapter, stored recap and moments from stored data', () => {
    const world: LifeWorld = {
      ...baseWorld,
      saga,
      currentArc: arc,
      resumeRecap: {
        text: 'Tu as rencontré Sophie.\n\nYou met Sophie.',
        lastEventId: 'e2',
      },
    };
    render(
      <WurldResumeScreen
        world={world}
        events={[beat('e1', 'Salut !'), beat('e2', 'On déjeune ?')]}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByText('Previously, in this wurld')).toBeInTheDocument();
    expect(screen.getByText('The Lyon Letters')).toBeInTheDocument();
    expect(screen.getByText('warm, curious')).toBeInTheDocument();
    expect(
      screen.getByText('A new life in Lyon, and a mystery in the mail.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Chapter 2')).toBeInTheDocument();
    // LIFE-WORLD-ARC-REGISTER: the spoiler-safe playerTeaser shows; the planner
    // premise (with the brother spoiler) never reaches the player.
    expect(
      screen.getByText('Find out who sends the letters.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/estranged brother/)).not.toBeInTheDocument();
    const recap = screen.getByTestId('LifeScreen-WurldResume-Recap');
    expect(recap.textContent).toContain('Tu as rencontré Sophie.');
    expect(recap.textContent).toContain('You met Sophie.');
    expect(recap.textContent).not.toContain('ROLLING');
    const moments = screen.getByTestId('LifeScreen-WurldResume-Moments');
    expect(moments.textContent).toContain('Salut !');
    expect(moments.textContent).toContain('On déjeune ?');
    expect(moments.textContent).toContain('Sophie');
  });

  it('LIFE-LANG-8 — npc + user moments render BOTH practiceText and the system-language gloss', () => {
    const world: LifeWorld = { ...baseWorld, saga };
    render(
      <WurldResumeScreen
        world={world}
        events={[
          beat('e1', 'On déjeune ?', 'npc', 'Shall we have lunch?'),
          beat('e2', 'Oui, avec plaisir.', 'user', 'Yes, gladly.'),
        ]}
        onContinue={vi.fn()}
      />,
    );
    const moments = screen.getByTestId('LifeScreen-WurldResume-Moments');
    // npc: practice primary + system-language gloss.
    expect(moments.textContent).toContain('On déjeune ?');
    expect(moments.textContent).toContain('Shall we have lunch?');
    // user: practice primary + system-language gloss.
    expect(moments.textContent).toContain('Oui, avec plaisir.');
    expect(moments.textContent).toContain('Yes, gladly.');
    // Exactly one gloss line per non-narrator moment (npc + user = 2).
    expect(
      screen.getAllByTestId('LifeScreen-WurldResume-MomentGloss'),
    ).toHaveLength(2);
  });

  it('LIFE-LANG-8 — a moment with no nativeText renders its practice line but no gloss', () => {
    render(
      <WurldResumeScreen
        world={{ ...baseWorld, saga }}
        events={[beat('e1', 'Bonjour', 'npc')]}
        onContinue={vi.fn()}
      />,
    );
    const moments = screen.getByTestId('LifeScreen-WurldResume-Moments');
    expect(moments.textContent).toContain('Bonjour');
    expect(
      screen.queryByTestId('LifeScreen-WurldResume-MomentGloss'),
    ).toBeNull();
  });

  it('LIFE-FLOW-5 — falls back to the storyLog spine when no resumeRecap is stored (rollingSummary retired)', () => {
    const world: LifeWorld = {
      ...baseWorld,
      saga,
      storyLog: { chapterNumber: 1, entries: ['Marc has settled into Lyon.'], turns: 1, sceneTurns: 1 },
    };
    render(
      <WurldResumeScreen world={world} events={[beat('e1', 'Salut !')]} onContinue={vi.fn()} />,
    );
    expect(
      screen.getByTestId('LifeScreen-WurldResume-Recap').textContent,
    ).toContain('Marc has settled into Lyon.');
  });

  it('LIFE-FLOW-5 — hides chapter, previously and moments sections when their datum is absent', () => {
    render(
      <WurldResumeScreen world={baseWorld} events={[]} onContinue={vi.fn()} />,
    );
    expect(screen.queryByTestId('LifeScreen-WurldResume-Chapter')).toBeNull();
    expect(screen.queryByTestId('LifeScreen-WurldResume-Recap')).toBeNull();
    expect(screen.queryByTestId('LifeScreen-WurldResume-Moments')).toBeNull();
    // Saga missing → title falls back to the character name.
    expect(screen.getByText('Marc')).toBeInTheDocument();
    expect(
      screen.getByTestId('LifeScreen-WurldResume-Continue'),
    ).toBeInTheDocument();
  });

  it('LIFE-FLOW-5 — shows at most the last 3 beats as moments', () => {
    const world: LifeWorld = { ...baseWorld, saga };
    render(
      <WurldResumeScreen
        world={world}
        events={[
          beat('e1', 'one'),
          beat('e2', 'two'),
          beat('e3', 'three'),
          beat('e4', 'four'),
          beat('e5', 'five'),
        ]}
        onContinue={vi.fn()}
      />,
    );
    const moments = screen.getByTestId('LifeScreen-WurldResume-Moments');
    expect(moments.textContent).not.toContain('one');
    expect(moments.textContent).not.toContain('two');
    expect(moments.textContent).toContain('three');
    expect(moments.textContent).toContain('four');
    expect(moments.textContent).toContain('five');
  });

  it('LIFE-FLOW-5 — Continue fires onContinue', () => {
    const onContinue = vi.fn();
    render(
      <WurldResumeScreen world={{ ...baseWorld, saga }} events={[]} onContinue={onContinue} />,
    );
    fireEvent.click(screen.getByTestId('LifeScreen-WurldResume-Continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

/** LIFE-UI-15 — viewport-anchored, not scene-anchored. See WorldIntroScreen. */
describe('WurldResumeScreen — LIFE-UI-15', () => {
  it('is fixed to the viewport, with safe-area padding on both edges', () => {
    render(
      <WurldResumeScreen
        world={{ ...baseWorld, saga }}
        events={[]}
        onContinue={vi.fn()}
      />,
    );
    const root = screen.getByTestId('LifeScreen-WurldResume');
    expect(root.className).toContain('fixed inset-0');
    expect(root.className).not.toContain('absolute');
    expect(root.className).toContain('pt-safe-top');
    expect(root.className).toContain('pb-safe-bottom');
  });
});
