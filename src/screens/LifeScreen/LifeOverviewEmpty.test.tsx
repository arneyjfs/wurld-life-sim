/**
 * LIFE-WORLD-12 — the empty-state sample cards are THEME-AWARE.
 *
 * The regression these pin: the four cards used to be opaque Tailwind
 * pastel fills (`from-rose-200 to-amber-200`, …) with hard-coded dark
 * text (`text-slate-900`) and a `border-white/40`. All fixed-light
 * values — in dark mode that's four bright slabs with near-black text
 * glowing off a dark page. The fix is a low-opacity tint of one hue
 * mixed OVER the themed card surface, with --color-fg/-muted text.
 *
 * jsdom can't tell us it looks good, but it CAN tell us no
 * fixed-palette class survived and that the theme tokens are the ones
 * carrying the surface + text.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@/i18n', () => ({ useT: () => (key: string) => key }));

import { LifeOverviewEmpty } from './LifeOverviewEmpty';
import { SAMPLE_WORLDS } from './overviewSamples';

/**
 * Any Tailwind class that pins a colour to a FIXED palette step —
 * `text-slate-900`, `from-rose-200`, `to-stone-200`, `bg-emerald-200`…
 * Those are the ones that ignore the theme. Utility classes keyed on a
 * CSS var (`text-(--color-fg)`) never match.
 */
const FIXED_PALETTE =
  /\b(?:bg|text|from|via|to|border|ring|shadow|fill|stroke|decoration|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

/** `border-white/40`, `bg-black/50`, … — fixed too, in the other direction. */
const FIXED_BW = /\b(?:bg|text|border|ring|from|via|to)-(?:white|black)(?:\/\d+)?\b/;

function classesUnder(el: Element): string[] {
  return [el, ...Array.from(el.querySelectorAll('*'))].flatMap((n) =>
    Array.from(n.classList),
  );
}

describe('LIFE-WORLD-12 — theme-aware sample cards', () => {
  it('LIFE-WORLD-12 — no sample card carries a fixed-palette colour class', () => {
    render(<LifeOverviewEmpty />);
    const cards = screen.getAllByTestId('LifeOverview-Sample');
    expect(cards).toHaveLength(SAMPLE_WORLDS.length);
    for (const card of cards) {
      for (const cls of classesUnder(card)) {
        expect(cls, `fixed-palette class on a sample card: ${cls}`).not.toMatch(
          FIXED_PALETTE,
        );
        expect(cls, `fixed light/dark class on a sample card: ${cls}`).not.toMatch(
          FIXED_BW,
        );
      }
    }
  });

  it('LIFE-WORLD-12 — the card surface + text come from theme tokens', () => {
    render(<LifeOverviewEmpty />);
    for (const card of screen.getAllByTestId('LifeOverview-Sample')) {
      const classes = classesUnder(card);
      // Same surface a real WorldCard wears.
      expect(classes).toContain('bg-(--color-bg-elevated)');
      // Title in the themed foreground, premise + language muted.
      expect(classes).toContain('text-(--color-fg)');
      expect(classes).toContain('text-(--color-fg-muted)');
    }
  });

  it('LIFE-WORLD-12 — the hue is a tint MIXED over the surface, not an opaque fill', () => {
    render(<LifeOverviewEmpty />);
    for (const card of screen.getAllByTestId('LifeOverview-Sample')) {
      // The hue enters as one custom property on the card…
      expect(card.getAttribute('style')).toContain('--sample-tint');
      // …and every layer that uses it goes through color-mix, so the
      // themed surface underneath is always still showing through.
      const styled = Array.from(card.querySelectorAll('[style]'));
      expect(styled.length).toBeGreaterThan(0);
      for (const node of styled) {
        const style = node.getAttribute('style') ?? '';
        expect(style).toContain('color-mix(');
        expect(style).toContain('var(--sample-tint)');
      }
    }
  });

  it('LIFE-WORLD-12 — the four samples stay visually distinguishable', () => {
    // The variety IS the point of the screen — one tint each, no repeats.
    const tints = SAMPLE_WORLDS.map((w) => w.tint);
    expect(new Set(tints).size).toBe(SAMPLE_WORLDS.length);
    for (const tint of tints) {
      // A CSS colour, NOT a Tailwind palette class — the card mixes it,
      // so it has to be a real colour value.
      expect(tint).toMatch(/^#[0-9a-f]{6}$/i);
    }
    render(<LifeOverviewEmpty />);
    // Read the value back off the inline custom property rather than a
    // mirrored data-attribute: the style IS the production contract, so
    // a test-only attribute would be scaffolding shipped to users.
    const rendered = screen
      .getAllByTestId('LifeOverview-Sample')
      .map((c) => (c as HTMLElement).style.getPropertyValue('--sample-tint'));
    expect(rendered).toEqual(tints);
  });

  it('LIFE-WORLD-12 — content + tap target are unchanged (emoji, title, premise, language → /wurlds/start)', () => {
    render(<LifeOverviewEmpty />);
    const cards = screen.getAllByTestId('LifeOverview-Sample');
    SAMPLE_WORLDS.forEach((w, i) => {
      const text = cards[i]!.textContent ?? '';
      expect(text).toContain(w.emoji);
      expect(text).toContain(w.title);
      expect(text).toContain(w.premise);
      expect(text).toContain(w.language);
    });
    navigate.mockClear();
    cards[0]!.click();
    expect(navigate).toHaveBeenCalledWith('/wurlds/start');
  });
});
