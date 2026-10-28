import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionBar, type ChipDisplay } from './ActionBar';

const choices = [
  { id: 'c1', practiceText: 'Elle cherche un café', nativeText: "She's asking about a café" },
  { id: 'c2', practiceText: 'voudrais', nativeText: '' },
];

function renderBar(chipDisplay?: ChipDisplay) {
  return render(
    <ActionBar choices={choices} onPick={vi.fn()} chipDisplay={chipDisplay} />,
  );
}

describe('ActionBar chipDisplay (LIFE-LANG-1/3)', () => {
  it('LIFE-LANG-3 — default/both shows practice main + native sub', () => {
    renderBar();
    const chip = screen.getByTestId('LifeScreen-Choice-c1');
    expect(chip).toHaveTextContent('Elle cherche un café');
    expect(chip).toHaveTextContent("She's asking about a café");
  });

  it("LIFE-LANG-1 — 'native' renders ONLY the native label", () => {
    renderBar('native');
    const chip = screen.getByTestId('LifeScreen-Choice-c1');
    expect(chip).toHaveTextContent("She's asking about a café");
    expect(chip).not.toHaveTextContent('Elle cherche un café');
  });

  it("LIFE-LANG-3 — 'native' falls back to practiceText when nativeText is empty", () => {
    renderBar('native');
    expect(screen.getByTestId('LifeScreen-Choice-c2')).toHaveTextContent('voudrais');
  });

  it("LIFE-LANG-1 — 'practice' renders ONLY the practice label (no gloss even when present)", () => {
    renderBar('practice');
    const chip = screen.getByTestId('LifeScreen-Choice-c1');
    expect(chip).toHaveTextContent('Elle cherche un café');
    expect(chip).not.toHaveTextContent("She's asking about a café");
  });

  it('COMP-KB-14 — the bar (host of the ✏️ composer) rides the keyboard via `.pb-keyboard`', () => {
    renderBar();
    expect(screen.getByTestId('LifeScreen-ActionBar')).toHaveClass('pb-keyboard');
  });
});
