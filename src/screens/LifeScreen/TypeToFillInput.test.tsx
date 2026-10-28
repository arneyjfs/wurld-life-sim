import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TypeToFillInput } from './TypeToFillInput';

describe('TypeToFillInput — LIFE-EX-8 / COMP-KB-14', () => {
  it('submits the trimmed typed value', () => {
    const onSubmit = vi.fn();
    render(<TypeToFillInput onSubmit={onSubmit} practiceLanguage="French" />);
    fireEvent.change(screen.getByTestId('LifeScreen-TypeToFill-Input'), {
      target: { value: '  voudrais  ' },
    });
    fireEvent.click(screen.getByTestId('LifeScreen-TypeToFill-Submit'));
    expect(onSubmit).toHaveBeenCalledWith('voudrais');
  });

  it('submits on Enter', () => {
    const onSubmit = vi.fn();
    render(<TypeToFillInput onSubmit={onSubmit} />);
    const input = screen.getByTestId('LifeScreen-TypeToFill-Input');
    fireEvent.change(input, { target: { value: 'café' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('café');
  });

  it('does not submit an empty / whitespace-only answer', () => {
    const onSubmit = vi.fn();
    render(<TypeToFillInput onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('LifeScreen-TypeToFill-Input'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByTestId('LifeScreen-TypeToFill-Submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sets the input `lang` to the practice language + disables autocorrect', () => {
    render(<TypeToFillInput onSubmit={vi.fn()} practiceLanguage="Spanish" />);
    const input = screen.getByTestId('LifeScreen-TypeToFill-Input');
    expect(input).toHaveAttribute('lang', 'Spanish');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('spellcheck', 'false');
  });

  it('COMP-KB-14 — the input row rides the keyboard via `.pb-keyboard`', () => {
    render(<TypeToFillInput onSubmit={vi.fn()} />);
    expect(screen.getByTestId('LifeScreen-TypeToFill')).toHaveClass('pb-keyboard');
  });
});
