import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecondRowReveal, SECOND_ROW_MS } from './SecondRowReveal';

/**
 * MSG-VIEW-7.9 — the eye REVEALS the second row rather than turning the card.
 *
 * Spec: docs/specs/message-pipeline.md — MSG-VIEW-7.
 *
 * Adding a row is a reveal, not a swap. A flip says "this became that", which
 * is true of the swipe peek and false here — the practice row did not become
 * anything, a translation appeared underneath it.
 */
const row = <div data-testid="row">gloss</div>;

describe('MSG-VIEW-7.9 — SecondRowReveal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps the track mounted when CLOSED, so the open has a baseline', () => {
    // The load-bearing detail. A wrapper that first appears when the row opens
    // has `1fr` in its very first paint — nothing to transition from — and the
    // row snaps to full height instead of gliding.
    render(<SecondRowReveal show={false}>{null}</SecondRowReveal>);
    const track = screen.getByTestId('MessageSecondRowReveal');
    expect(track).toBeInTheDocument();
    expect(track).toHaveStyle({ gridTemplateRows: '0fr' });
    expect(screen.queryByTestId('row')).toBeNull();
  });

  it('opens the track to the row natural height', () => {
    const { rerender } = render(<SecondRowReveal show={false}>{null}</SecondRowReveal>);
    act(() => void vi.advanceTimersByTime(1));
    rerender(<SecondRowReveal show>{row}</SecondRowReveal>);
    act(() => void vi.advanceTimersByTime(50));
    const track = screen.getByTestId('MessageSecondRowReveal');
    expect(track).toHaveStyle({ gridTemplateRows: '1fr' });
    expect(track.style.transition).toContain('grid-template-rows');
    expect(screen.getByTestId('row')).toBeInTheDocument();
  });

  it('holds the row through the CLOSE so it has something to shrink', () => {
    // The parent stops passing children the instant the row switches off, so
    // without the cached copy the track would animate an empty box shut.
    const { rerender } = render(<SecondRowReveal show>{row}</SecondRowReveal>);
    rerender(<SecondRowReveal show={false}>{null}</SecondRowReveal>);
    expect(screen.getByTestId('MessageSecondRowReveal')).toHaveStyle({ gridTemplateRows: '0fr' });
    expect(screen.getByTestId('row'), 'the row vanished before the close could run')
      .toBeInTheDocument();
    act(() => void vi.advanceTimersByTime(SECOND_ROW_MS + 10));
    expect(screen.queryByTestId('row')).toBeNull();
  });

  it('does NOT play on first mount — a scrollback must not glide open', () => {
    // Every bubble already showing its second row would otherwise animate on
    // chat entry, which reads as the whole list twitching.
    //
    // What prevents it is that the track's FIRST computed style is already the
    // open one — a CSS transition has no previous value to run from. So the
    // assertion is that `0fr` is never rendered when the row starts open; an
    // implementation that mounted closed and opened a frame later would glide,
    // however the transition property was managed.
    render(<SecondRowReveal show>{row}</SecondRowReveal>);
    const track = screen.getByTestId('MessageSecondRowReveal');
    expect(track, 'the track mounted CLOSED and will glide open on entry')
      .toHaveStyle({ gridTemplateRows: '1fr' });
    act(() => void vi.advanceTimersByTime(50));
    expect(track).toHaveStyle({ gridTemplateRows: '1fr' });
  });

  it('MSG-BUBBLE-12.8 — STEPS while a card turn is in flight', () => {
    // The flip's spacer is already carrying that height change. Gliding here
    // too means two animations for one change, fighting each other.
    const { rerender } = render(<SecondRowReveal show={false} instant>{null}</SecondRowReveal>);
    act(() => void vi.advanceTimersByTime(1));
    rerender(<SecondRowReveal show instant>{row}</SecondRowReveal>);
    const track = screen.getByTestId('MessageSecondRowReveal');
    expect(track.style.transition).toBe('');
    expect(track).toHaveStyle({ gridTemplateRows: '1fr' });
  });

  it('opens in the SAME commit as the swap while flipping — no one-frame gap', () => {
    // The reported jitter. `useExitTransition` defers `visible` to a rAF so a
    // glide has an edge to animate from; during a flip that lag lands on the
    // swap itself. The spacer hands its room to the bubble in the swap commit,
    // and if the row that makes the bubble TALLER arrives a frame later, then
    // for one frame nothing holds the space and the gap snaps shut and open.
    //
    // Asserted WITHOUT advancing time: the row has to be there already.
    const { rerender } = render(<SecondRowReveal show={false} instant>{null}</SecondRowReveal>);
    act(() => void vi.advanceTimersByTime(1));
    rerender(<SecondRowReveal show instant>{row}</SecondRowReveal>);
    expect(screen.queryByTestId('row'),
      'the row lagged the swap by a frame — that is the mid-flip jitter')
      .toBeInTheDocument();
    expect(screen.getByTestId('MessageSecondRowReveal'))
      .toHaveStyle({ gridTemplateRows: '1fr' });
  });

  it('closes in the SAME commit too, so a shrink hands over cleanly', () => {
    const { rerender } = render(<SecondRowReveal show instant>{row}</SecondRowReveal>);
    rerender(<SecondRowReveal show={false} instant>{null}</SecondRowReveal>);
    expect(screen.queryByTestId('row')).toBeNull();
    expect(screen.getByTestId('MessageSecondRowReveal'))
      .toHaveStyle({ gridTemplateRows: '0fr' });
  });
});
