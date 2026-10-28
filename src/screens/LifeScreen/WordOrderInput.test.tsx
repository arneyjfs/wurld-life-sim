import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WordOrderInput } from './WordOrderInput';

describe('WordOrderInput — LIFE-EX-11', () => {
  it('assembles the sentence in tap order + submits the built string', () => {
    const onSubmit = vi.fn();
    render(
      <WordOrderInput
        sentence="Je voudrais un café"
        nativePrompt="I would like a coffee"
        seed={2}
        onSubmit={onSubmit}
      />,
    );
    // Submit is disabled until every word is placed.
    expect(screen.getByTestId('LifeScreen-WordOrder-Submit')).toBeDisabled();
    // Tap the words in the CORRECT order (tiles keyed by their original index).
    for (const i of [0, 1, 2, 3]) {
      fireEvent.click(screen.getByTestId(`LifeScreen-WordOrder-Bank-${i}`));
    }
    const submit = screen.getByTestId('LifeScreen-WordOrder-Submit');
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('Je voudrais un café');
  });

  it('tapping a placed word sends it back to the bank', () => {
    render(<WordOrderInput sentence="un deux trois" seed={1} onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByTestId('LifeScreen-WordOrder-Bank-0'));
    expect(screen.getByTestId('LifeScreen-WordOrder-Placed-0')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('LifeScreen-WordOrder-Placed-0'));
    expect(screen.queryByTestId('LifeScreen-WordOrder-Placed-0')).not.toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-WordOrder-Bank-0')).toBeInTheDocument();
  });

  it('submits whatever order was assembled (grading is the engine\'s job)', () => {
    const onSubmit = vi.fn();
    render(<WordOrderInput sentence="un deux trois" seed={1} onSubmit={onSubmit} />);
    for (const i of [2, 1, 0]) {
      fireEvent.click(screen.getByTestId(`LifeScreen-WordOrder-Bank-${i}`));
    }
    fireEvent.click(screen.getByTestId('LifeScreen-WordOrder-Submit'));
    expect(onSubmit).toHaveBeenCalledWith('trois deux un');
  });

  it('shows the native meaning as the cue', () => {
    render(
      <WordOrderInput
        sentence="Je voudrais un café"
        nativePrompt="I would like a coffee"
        seed={1}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByTestId('LifeScreen-WordOrder-Cue')).toHaveTextContent(
      'I would like a coffee',
    );
  });
});
