/**
 * LIFE-GOAL-6 — the count chip and the sheet behind it.
 *
 * Spec: docs/specs/life-sim.md, `LIFE-GOAL-5..8`.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GoalChip } from './GoalChip';
import type { GoalLadderDoc } from '@/types/lifeGoal';

const ladder = (over: Partial<GoalLadderDoc> = {}): GoalLadderDoc => ({
  saga: { text: 'hang three canvases in the Friday show', when: 'Friday', days: 12 },
  objective: { id: 'o1', text: 'get Hélène to look at your work', need: null },
  done: [],
  dayIndex: 0,
  ...over,
});

describe('LIFE-GOAL-6 — the chip', () => {
  it('shows the count and nothing else — the goal text is behind the tap', () => {
    render(<GoalChip ladder={ladder({ dayIndex: 4 })} />);
    expect(screen.getByTestId('LifeScreen-GoalChip')).toHaveTextContent('8 days');
    // The owner's call: an icon, not a banner. If the goal text ever leaks into
    // the always-on chrome this is the test that says so.
    expect(screen.queryByText(/hang three canvases/)).not.toBeInTheDocument();
  });

  it('renders NOTHING for a world with no saga goal', () => {
    // Every world made before this shipped. A "0 days" badge on a story with no
    // deadline is worse than no badge.
    const { container } = render(<GoalChip ladder={ladder({ saga: null })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an absent ladder', () => {
    const { container } = render(<GoalChip ladder={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('never counts below zero — a passed deadline reads 0, not -3', () => {
    render(<GoalChip ladder={ladder({ dayIndex: 15 })} />);
    expect(screen.getByTestId('LifeScreen-GoalChip')).toHaveTextContent('0 days');
  });
});

describe('LIFE-GOAL-6 — the sheet the tap opens', () => {
  const open = (l: GoalLadderDoc) => {
    render(<GoalChip ladder={l} />);
    fireEvent.click(screen.getByTestId('LifeScreen-GoalChip'));
  };

  it('lists the saga goal and the live objective', () => {
    open(ladder());
    expect(screen.getByTestId('LifeScreen-GoalSheet')).toBeInTheDocument();
    expect(screen.getByText(/hang three canvases in the Friday show/)).toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-GoalSheet-Objective'))
      .toHaveTextContent('get Hélène to look at your work');
  });

  it('shows what settled, and a CLOSE carries its reason', () => {
    // LIFE-GOAL-3: the player is shown WHY the world took something off the
    // table. That reason is the whole difference between a close and the silent
    // drop this feature exists to prevent.
    open(ladder({
      done: [{ text: 'find the key', how: 'closed', because: 'Bébert changed the lock' }],
    }));
    expect(screen.getByTestId('LifeScreen-GoalSheet-Done'))
      .toHaveTextContent('find the key — Bébert changed the lock');
  });

  it('an objective-less ladder still opens, without an empty label', () => {
    open(ladder({ objective: null }));
    expect(screen.getByTestId('LifeScreen-GoalSheet')).toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-GoalSheet-Objective')).not.toBeInTheDocument();
  });

  it('closes on the backdrop', () => {
    open(ladder());
    fireEvent.click(screen.getByTestId('LifeScreen-GoalSheet-Backdrop'));
    expect(screen.queryByTestId('LifeScreen-GoalSheet')).not.toBeInTheDocument();
  });

  it('a click INSIDE the sheet does not close it', () => {
    open(ladder());
    fireEvent.click(screen.getByTestId('LifeScreen-GoalSheet'));
    expect(screen.getByTestId('LifeScreen-GoalSheet')).toBeInTheDocument();
  });
});
