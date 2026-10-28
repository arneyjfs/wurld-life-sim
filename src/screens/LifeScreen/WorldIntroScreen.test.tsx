import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorldIntroScreen } from './WorldIntroScreen';
import { vi } from 'vitest';

vi.mock('@/i18n', () => ({ useT: () => (k: string) => k }));

const base = {
  title: 'Une vie à Lyon',
  teaser: 'A new life in Lyon begins.',
  tone: 'tender coming-of-age',
  onBegin: () => {},
};

const TITLE_TRANS = 'LifeScreen-WorldIntro-TitleTranslation';

describe('WorldIntroScreen — LIFE-LANG-14 (bilingual saga title)', () => {
  it('renders the practice-language title AND its display-language translation below it', () => {
    render(<WorldIntroScreen {...base} titleTranslation="A Life in Lyon" />);
    expect(screen.getByText('Une vie à Lyon')).toBeInTheDocument();
    expect(screen.getByTestId(TITLE_TRANS)).toHaveTextContent('A Life in Lyon');
  });

  it('hides the translation line when absent (legacy saga with empty titleNative)', () => {
    render(<WorldIntroScreen {...base} titleTranslation="" />);
    expect(screen.getByText('Une vie à Lyon')).toBeInTheDocument();
    expect(screen.queryByTestId(TITLE_TRANS)).not.toBeInTheDocument();
  });

  it('hides the translation line when identical to the title (system == practice)', () => {
    render(<WorldIntroScreen {...base} titleTranslation="Une vie à Lyon" />);
    expect(screen.queryByTestId(TITLE_TRANS)).not.toBeInTheDocument();
  });

  it('renders fine with no titleTranslation prop at all', () => {
    render(<WorldIntroScreen {...base} />);
    expect(screen.getByText('Une vie à Lyon')).toBeInTheDocument();
    expect(screen.queryByTestId(TITLE_TRANS)).not.toBeInTheDocument();
  });
});

/**
 * LIFE-UI-15 — anchored to the VIEWPORT, not to the scene box.
 *
 * All four life overlays render inside LifeScreen's `relative flex-1` scene
 * container, which spans neither the header above nor the action bar below.
 * `absolute inset-0` therefore centred them in a box the player cannot see
 * the edges of — the card sat high with the blurred backdrop stopping
 * mid-screen. Asserted structurally: jsdom does no layout, so "it looks
 * centred" is unmeasurable, but the containing block is a class.
 */
describe('WorldIntroScreen — LIFE-UI-15', () => {
  it('is fixed to the viewport, with safe-area padding on both edges', () => {
    render(<WorldIntroScreen {...base} />);
    const root = screen.getByTestId('LifeScreen-WorldIntro');
    expect(root.className).toContain('fixed inset-0');
    expect(root.className).not.toContain('absolute');
    expect(root.className).toContain('pt-safe-top');
    expect(root.className).toContain('pb-safe-bottom');
  });
});
