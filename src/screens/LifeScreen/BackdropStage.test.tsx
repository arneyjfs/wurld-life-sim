/**
 * LIFE-BACKDROP-12 / LIFE-UI-7 — the stage paints the letterbox with the
 * backdrop's declared bleed colour.
 * LIFE-BACKDROP-15 — the stage holds the outgoing backdrop and cross-fades.
 * LIFE-BACKDROP-16 — the pre-first-backdrop placeholder is a planet.
 *
 * Spec: docs/specs/life-sim.md — LIFE-BACKDROP-12, LIFE-BACKDROP-15,
 * LIFE-BACKDROP-16, LIFE-UI-7.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFallbackBackdrop } from '@/lib/life/fallbackBackdrops';
import { BackdropStage, RIBBON_REVEAL_MS } from './BackdropStage';
import { SCENE_FADE_MS } from './backdropStageState';

const SQUARE_WITH_BLEED =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">' +
  '<rect class="bleed" x="0" y="0" width="1000" height="1000" fill="#e8d5c4"/></svg>';

const LEGACY_WIDE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800">' +
  '<rect width="1200" height="800" fill="#123456"/></svg>';

describe('LIFE-BACKDROP-12 — BackdropStage letterbox fill', () => {
  it('LIFE-BACKDROP-12 — surround uses the backdrop-declared bleed colour', () => {
    render(<BackdropStage svg={SQUARE_WITH_BLEED} />);
    const stage = screen.getByTestId('LifeScreen-BackdropStage');
    expect(stage).toHaveStyle({ backgroundColor: '#e8d5c4' });
  });

  it('LIFE-BACKDROP-12 — legacy backdrop with no bleed keeps the theme background', () => {
    render(<BackdropStage svg={LEGACY_WIDE} />);
    const stage = screen.getByTestId('LifeScreen-BackdropStage');
    // No inline colour is forced — the themed class governs instead, so
    // a pre-LIFE-BACKDROP-12 cached backdrop never renders a transparent bar.
    expect(stage.style.backgroundColor).toBe('');
    expect(stage.className).toContain('bg-(--color-bg)');
  });

  it('LIFE-BACKDROP-12 — the svg box is a true square, so stray geometry is clipped', () => {
    render(<BackdropStage svg={SQUARE_WITH_BLEED} />);
    const stage = screen.getByTestId('LifeScreen-BackdropStage');
    const holder = stage.querySelector('svg')!.parentElement!;
    // Must size BOTH axes off the container's smaller side. The previous
    // `aspect-square h-full w-auto max-w-full` did not work: aspect-ratio
    // is ignored when height is definite, so the box stayed full-height
    // and stray geometry painted below the square.
    expect(holder.className).toContain('[container-type:size]');
    expect(holder.className).toContain('[width:min(100cqw,100cqh)]');
    expect(holder.className).toContain('[height:min(100cqw,100cqh)]');
    expect(holder.className).not.toContain('[&>svg]:h-full');
    expect(holder.className).not.toContain('[&>svg]:aspect-square');
  });

  it('LIFE-BACKDROP-12 — the backdrop markup still renders inside the stage', () => {
    render(<BackdropStage svg={SQUARE_WITH_BLEED} locationLabel="Le Café" />);
    const stage = screen.getByTestId('LifeScreen-BackdropStage');
    expect(stage.querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('LifeScreen-LocationRibbon')).toHaveTextContent(
      'Le Café',
    );
  });
});

const SILHOUETTE = getFallbackBackdrop('apartment_bedroom');

const SCENE_B =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" data-backdrop="b">' +
  '<defs><linearGradient id="sky"/></defs>' +
  '<rect class="bleed" width="1000" height="1000" fill="#101820"/>' +
  '<rect width="10" height="10" fill="url(#sky)"/></svg>';

const SCENE_A_WITH_IDS =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" data-backdrop="a">' +
  '<defs><linearGradient id="sky"/></defs>' +
  '<rect class="bleed" width="1000" height="1000" fill="#e8d5c4"/>' +
  '<rect width="10" height="10" fill="url(#sky)"/></svg>';

describe('LIFE-BACKDROP-16 — planet placeholder before the first backdrop', () => {
  it('LIFE-BACKDROP-16 — a silhouette on first paint renders the planet instead', () => {
    render(<BackdropStage svg={SILHOUETTE} />);
    const stage = screen.getByTestId('LifeScreen-BackdropStage');
    expect(stage.querySelector('[data-wurld-backdrop="planet"]')).not.toBeNull();
    // The seeded apartment silhouette must NOT be what the player sees.
    expect(stage.innerHTML).not.toContain('sunbeam');
  });

  it('LIFE-BACKDROP-16 — the location ribbon is suppressed while the planet is up', () => {
    render(<BackdropStage svg={SILHOUETTE} locationLabel="Your apartment · morning" />);
    expect(screen.queryByTestId('LifeScreen-LocationRibbon')).toBeNull();
  });

  it('LIFE-BACKDROP-16 — the ribbon returns as soon as a real backdrop lands', () => {
    const { rerender } = render(
      <BackdropStage svg={SILHOUETTE} locationLabel="Le Café" />,
    );
    expect(screen.queryByTestId('LifeScreen-LocationRibbon')).toBeNull();
    rerender(<BackdropStage svg={SCENE_B} locationLabel="Le Café" />);
    expect(screen.getByTestId('LifeScreen-LocationRibbon')).toHaveTextContent(
      'Le Café',
    );
  });

  it('LIFE-BACKDROP-16 — a real backdrop on first paint never shows the planet', () => {
    render(<BackdropStage svg={SCENE_B} />);
    const stage = screen.getByTestId('LifeScreen-BackdropStage');
    expect(stage.querySelector('[data-wurld-backdrop="planet"]')).toBeNull();
  });
});

/**
 * LIFE-BACKDROP-26 — tap the ribbon, briefly see where you are in your own
 * language.
 *
 * The ribbon is the only chrome on the stage written in the practice language,
 * so a beginner staring at "Le comptoir du Vieux-Port" has no way to find out
 * where the story has taken them. Showing both permanently was tried on paper
 * and rejected by the owner the same day — it doubles the footprint of a pill
 * sitting over the artwork, for information wanted rarely.
 */
describe('LIFE-BACKDROP-26 — the location ribbon reveals its native on tap', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const ribbon = () => screen.getByTestId('LifeScreen-LocationRibbon');

  it('LIFE-BACKDROP-26 — shows the practice label until tapped, then the native', () => {
    render(
      <BackdropStage svg={SCENE_B} locationLabel="Le Café de Flore" locationLabelNative="The Flore Café" />,
    );
    expect(ribbon()).toHaveTextContent('Le Café de Flore');
    act(() => void ribbon().click());
    expect(ribbon()).toHaveTextContent('The Flore Café');
  });

  it('LIFE-BACKDROP-26 — the reveal expires and the practice label comes back', () => {
    render(
      <BackdropStage svg={SCENE_B} locationLabel="Le Café de Flore" locationLabelNative="The Flore Café" />,
    );
    act(() => void ribbon().click());
    act(() => void vi.advanceTimersByTime(RIBBON_REVEAL_MS + 10));
    expect(ribbon()).toHaveTextContent('Le Café de Flore');
  });

  it('LIFE-BACKDROP-26 — tapping again while revealed RESTARTS the timer', () => {
    render(
      <BackdropStage svg={SCENE_B} locationLabel="Le Café de Flore" locationLabelNative="The Flore Café" />,
    );
    act(() => void ribbon().click());
    act(() => void vi.advanceTimersByTime(RIBBON_REVEAL_MS - 200));
    act(() => void ribbon().click());
    // Past the ORIGINAL deadline; a stale timer would have reverted by now.
    act(() => void vi.advanceTimersByTime(400));
    expect(ribbon()).toHaveTextContent('The Flore Café');
  });

  it('LIFE-BACKDROP-26 — arriving somewhere new drops the previous reveal', () => {
    // Otherwise the player walks into the harbour and the ribbon is still
    // showing them the English for the café they just left.
    const { rerender } = render(
      <BackdropStage svg={SCENE_B} locationLabel="Le Café de Flore" locationLabelNative="The Flore Café" />,
    );
    act(() => void ribbon().click());
    rerender(
      <BackdropStage svg={SCENE_B} locationLabel="Le Vieux-Port" locationLabelNative="The Old Port" />,
    );
    expect(ribbon()).toHaveTextContent('Le Vieux-Port');
  });

  it('LIFE-BACKDROP-26 — with a native label the ribbon is a BUTTON carrying it as its aria-label', () => {
    render(
      <BackdropStage svg={SCENE_B} locationLabel="Le Café de Flore" locationLabelNative="The Flore Café" />,
    );
    expect(ribbon().tagName).toBe('BUTTON');
    expect(ribbon()).toHaveAttribute('aria-label', 'The Flore Café');
  });

  it('LIFE-BACKDROP-26 — NO native label ⇒ no affordance at all (not a dead button)', () => {
    // A legacy world, a model that omitted the field, or a world whose practice
    // and system languages coincide. A button that does nothing when pressed is
    // worse than no button.
    render(<BackdropStage svg={SCENE_B} locationLabel="Le Café de Flore" />);
    expect(ribbon().tagName).not.toBe('BUTTON');
    act(() => void ribbon().click());
    expect(ribbon()).toHaveTextContent('Le Café de Flore');
  });

  it('LIFE-BACKDROP-26 — a native identical to the label is not an affordance either', () => {
    render(
      <BackdropStage svg={SCENE_B} locationLabel="Marseille" locationLabelNative="Marseille" />,
    );
    expect(ribbon().tagName).not.toBe('BUTTON');
  });
});

describe('LIFE-BACKDROP-15 — hold the outgoing backdrop, cross-fade the new one', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('LIFE-BACKDROP-15 — a silhouette does not replace a backdrop already on screen', () => {
    const { rerender } = render(<BackdropStage svg={SCENE_A_WITH_IDS} />);
    rerender(<BackdropStage svg={SILHOUETTE} />);
    const stage = screen.getByTestId('LifeScreen-BackdropStage');
    expect(stage.querySelector('[data-backdrop="a"]')).not.toBeNull();
    expect(stage.querySelector('[data-wurld-backdrop="planet"]')).toBeNull();
  });

  it('LIFE-BACKDROP-15 — the outgoing backdrop stays painted for the duration of the fade', () => {
    const { rerender } = render(<BackdropStage svg={SCENE_A_WITH_IDS} />);
    rerender(<BackdropStage svg={SCENE_B} />);
    const stage = screen.getByTestId('LifeScreen-BackdropStage');
    // Both layers mounted: the new backdrop fades in OVER the old one.
    expect(stage.querySelector('[data-backdrop="a"]')).not.toBeNull();
    expect(stage.querySelector('[data-backdrop="b"]')).not.toBeNull();
    const incoming = screen.getByTestId('LifeScreen-BackdropLayer');
    expect(incoming.className).toContain('life-backdrop-fade-in');

    act(() => {
      vi.advanceTimersByTime(SCENE_FADE_MS + 50);
    });
    // …and is dropped once the fade is over, so duplicate SVG ids never
    // outlive the transition.
    expect(stage.querySelector('[data-backdrop="a"]')).toBeNull();
    expect(stage.querySelector('[data-backdrop="b"]')).not.toBeNull();
  });

  it('LIFE-BACKDROP-15 — the OUTGOING layer has its ids namespaced, the incoming one does not', () => {
    const { rerender } = render(<BackdropStage svg={SCENE_A_WITH_IDS} />);
    rerender(<BackdropStage svg={SCENE_B} />);
    const outgoing = screen.getByTestId('LifeScreen-BackdropLayer-Outgoing');
    const incoming = screen.getByTestId('LifeScreen-BackdropLayer');
    // The incoming backdrop keeps its own ids — it is the copy that persists.
    expect(incoming.innerHTML).toContain('id="sky"');
    expect(incoming.innerHTML).toContain('url(#sky)');
    // The outgoing copy is rewritten so `url(#sky)` cannot bind across layers.
    expect(outgoing.innerHTML).not.toContain('id="sky"');
    expect(outgoing.innerHTML).toMatch(/id="[^"]+-sky"/);
  });

  it('LIFE-BACKDROP-15 — a failed regeneration leaves the last good backdrop up, unfaded', () => {
    const { rerender } = render(<BackdropStage svg={SCENE_A_WITH_IDS} />);
    rerender(<BackdropStage svg={SILHOUETTE} />); // gen starts
    rerender(<BackdropStage svg={SILHOUETTE} />); // gen fails terminally
    const stage = screen.getByTestId('LifeScreen-BackdropStage');
    expect(stage.querySelector('[data-backdrop="a"]')).not.toBeNull();
    expect(screen.queryByTestId('LifeScreen-BackdropLayer-Outgoing')).toBeNull();
    expect(
      screen.getByTestId('LifeScreen-BackdropLayer').className,
    ).not.toContain('life-backdrop-fade-in');
  });

  it('LIFE-BACKDROP-15 — the bleed colour tracks the backdrop actually painted, not the incoming prop', () => {
    const { rerender } = render(<BackdropStage svg={SCENE_A_WITH_IDS} />);
    rerender(<BackdropStage svg={SILHOUETTE} />);
    const stage = screen.getByTestId('LifeScreen-BackdropStage');
    expect(stage).toHaveStyle({ backgroundColor: '#e8d5c4' });
  });
});
