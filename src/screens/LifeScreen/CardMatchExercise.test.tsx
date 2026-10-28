import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CardMatchExercise } from './CardMatchExercise';

const pairs = [
  { id: 'a', practice: 'apple', native: 'pomme' },
  { id: 'b', practice: 'bread', native: 'pain' },
  { id: 'c', practice: 'water', native: 'eau' },
];

const tile = (key: string) =>
  screen.getByTestId(`LifeScreen-CardMatch-Tile-${key}`);

describe('CardMatchExercise — LIFE-EX-10', () => {
  it('renders two columns (practice · native), one tile per side', () => {
    render(<CardMatchExercise pairs={pairs} seed={1} onComplete={vi.fn()} />);
    expect(screen.getByTestId('LifeScreen-CardMatch-Practice').children).toHaveLength(3);
    expect(screen.getByTestId('LifeScreen-CardMatch-Native').children).toHaveLength(3);
  });

  it('a correct match locks BOTH tiles in the practice-mode SUCCESS green; no early complete', () => {
    const onComplete = vi.fn();
    render(<CardMatchExercise pairs={pairs} seed={1} onComplete={onComplete} />);
    fireEvent.click(tile('a:practice'));
    fireEvent.click(tile('a:native'));
    expect(tile('a:practice')).toHaveAttribute('data-matched', 'true');
    expect(tile('a:native')).toHaveAttribute('data-matched', 'true');
    // LIFE-EX-10 parity with practice mode's MatchingQuestion 'matched' cell.
    expect(tile('a:practice').className).toContain('bg-(--color-success)/10');
    expect(tile('a:practice').className).toContain('border-(--color-success)');
    expect(tile('a:practice').className).not.toContain('bg-gradient-accent');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a matched pair sorts to the TOP of both columns', () => {
    render(<CardMatchExercise pairs={pairs} seed={1} onComplete={vi.fn()} />);
    fireEvent.click(tile('c:practice'));
    fireEvent.click(tile('c:native'));
    expect(
      screen.getByTestId('LifeScreen-CardMatch-Practice').firstElementChild,
    ).toHaveAttribute('data-testid', 'LifeScreen-CardMatch-Tile-c:practice');
    expect(
      screen.getByTestId('LifeScreen-CardMatch-Native').firstElementChild,
    ).toHaveAttribute('data-testid', 'LifeScreen-CardMatch-Tile-c:native');
  });

  it('matching EVERY pair fires onComplete exactly once', () => {
    const onComplete = vi.fn();
    render(<CardMatchExercise pairs={pairs} seed={1} onComplete={onComplete} />);
    for (const id of ['a', 'b', 'c']) {
      fireEvent.click(tile(`${id}:practice`));
      fireEvent.click(tile(`${id}:native`));
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('a wrong pairing does NOT match', () => {
    const onComplete = vi.fn();
    render(<CardMatchExercise pairs={pairs} seed={1} onComplete={onComplete} />);
    fireEvent.click(tile('a:practice'));
    fireEvent.click(tile('b:native')); // wrong partner
    expect(tile('a:practice')).not.toHaveAttribute('data-matched');
    expect(tile('b:native')).not.toHaveAttribute('data-matched');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('re-picking within the SAME column switches selection (no accidental match)', () => {
    render(<CardMatchExercise pairs={pairs} seed={1} onComplete={vi.fn()} />);
    fireEvent.click(tile('a:practice'));
    fireEvent.click(tile('b:practice')); // same column → selection moves to b
    fireEvent.click(tile('b:native')); // opposite → matches b, not a
    expect(tile('b:practice')).toHaveAttribute('data-matched', 'true');
    expect(tile('a:practice')).not.toHaveAttribute('data-matched');
  });
});
