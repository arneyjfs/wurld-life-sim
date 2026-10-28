/**
 * LIFE-WORLD-9 — WorldCard scene-thumbnail banner render contract.
 *
 * The hook is mocked (its ladder is covered by
 * useWorldThumbnail.test.tsx); these tests pin the DOM contract:
 * banner present ⇔ svg non-null, and the banner carries the SVG bytes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LifeWorld } from '@/types/firestore';

// --- Controllable mock state ---------------------------------------------
let thumbValue: string | null = null;
vi.mock('./useWorldThumbnail', () => ({
  useWorldThumbnail: () => ({ svg: thumbValue }),
}));
vi.mock('@/i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));

import { WorldCard } from './WorldCard';

function world(over: Partial<LifeWorld> = {}): LifeWorld {
  return {
    id: 'w1',
    characterName: 'Marc',
    practiceLanguage: 'French',
    nativeLanguage: 'English (British)',
    difficulty: 3,
    worldSeedKey: 'city_life',
    worldMode: 'realistic',
    ...over,
  };
}

const THUMB_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#123456"/></svg>';

describe('LIFE-WORLD-9 — WorldCard thumbnail banner', () => {
  beforeEach(() => {
    thumbValue = null;
  });

  it('LIFE-WORLD-9 — banner renders the resolved SVG markup inside the tap target', () => {
    thumbValue = THUMB_SVG;
    render(<WorldCard world={world()} onOpen={vi.fn()} onDelete={vi.fn()} />);
    const banner = screen.getByTestId('LifeOverview-WorldCard-Thumb');
    expect(banner.querySelector('svg')).not.toBeNull();
    expect(banner.innerHTML).toContain('fill="#123456"');
    // The banner is decorative — it must be aria-hidden.
    expect(banner.getAttribute('aria-hidden')).toBe('true');
  });

  it('LIFE-WORLD-9 — no banner when the thumbnail is null (fresh world stays compact)', () => {
    thumbValue = null;
    render(<WorldCard world={world()} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByTestId('LifeOverview-WorldCard-Thumb')).toBeNull();
  });

  it('LIFE-WORLD-9 — card body (character row + card container) still renders alongside the banner', () => {
    thumbValue = THUMB_SVG;
    render(<WorldCard world={world()} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('LifeOverview-WorldCard')).toBeInTheDocument();
    expect(screen.getByText('Marc')).toBeInTheDocument();
  });
});

/**
 * LIFE-WORLD-17 — the card names the wurld in both languages and shows a real
 * story line.
 *
 * The teaser half is a REGRESSION test with a known cause: `saga` carried
 * `playerFacingTeaser` in its Zod schema with `.default('')`, three screens read
 * it, and `sagaOpen` never asked for it — so every card since the LIFE-ARCH
 * migration rendered the pending stub and nothing said so. The producer fix is
 * LIFE-ARCH-8; this pins the consumer, which is the half a future prompt edit
 * can silently break again.
 */
describe('LIFE-WORLD-17 — title translation + story line', () => {
  beforeEach(() => {
    thumbValue = null;
  });

  const saga = (over: Record<string, string> = {}) =>
    ({
      title: 'Le Pain Perdu',
      titleNative: 'The Lost Bread',
      tone: 'wry, domestic',
      playerFacingTeaser: 'A rented room over a bakery that opens before dawn.',
      ...over,
    }) as never;

  it('LIFE-WORLD-17 — the native title renders under the practice-language title', () => {
    render(<WorldCard world={world({ saga: saga() })} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Le Pain Perdu')).toBeInTheDocument();
    expect(
      screen.getByTestId('LifeOverview-WorldCard-TitleNative').textContent,
    ).toBe('The Lost Bread');
  });

  it('LIFE-WORLD-17 — no native line on a legacy saga with an empty titleNative', () => {
    render(
      <WorldCard world={world({ saga: saga({ titleNative: '' }) })} onOpen={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.queryByTestId('LifeOverview-WorldCard-TitleNative')).toBeNull();
  });

  it('LIFE-WORLD-17 — no native line when the translation IS the title (printed twice otherwise)', () => {
    render(
      <WorldCard
        world={world({ saga: saga({ title: 'Marseille', titleNative: 'marseille' }) })}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('LifeOverview-WorldCard-TitleNative')).toBeNull();
  });

  it('LIFE-WORLD-17 — the native line never SUBSTITUTES for a missing title', () => {
    // An untranslated title stays one line. Swapping in the gloss would make the
    // card claim the wurld is called something it is not.
    render(
      <WorldCard
        world={world({ saga: saga({ title: '', titleNative: 'The Lost Bread' }) })}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByText('The Lost Bread')).toBeNull();
  });

  it('LIFE-WORLD-17 — the teaser is the story line when the saga carries one', () => {
    render(<WorldCard world={world({ saga: saga() })} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(
      screen.getByText('A rented room over a bakery that opens before dawn.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('life.overview.story.pending')).toBeNull();
  });

  it('LIFE-WORLD-17 — the pending stub survives for a saga that has not landed', () => {
    render(<WorldCard world={world({ saga: undefined })} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('life.overview.story.pending')).toBeInTheDocument();
  });
});

describe('LIFE-WORLD-ARC-1 — chapter badge reads completedArcCount scalar', () => {
  beforeEach(() => {
    thumbValue = null;
  });

  const badge = () =>
    screen.getByTestId('LifeOverview-WorldCard-ChapterToggle').textContent;

  it('LIFE-WORLD-ARC-1 — "ready for next chapter" badge = completedArcCount + 1 when no arc is active', () => {
    render(
      <WorldCard
        world={world({ completedArcCount: 2, currentArc: null })}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // readyBadge is rendered with { number: count + 1 } → 3.
    expect(badge()).toContain('life.overview.chapter.readyBadge:3');
  });

  it('LIFE-WORLD-ARC-1 — start badge when no chapters completed and none active', () => {
    render(
      <WorldCard
        world={world({ completedArcCount: undefined, currentArc: null })}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(badge()).toContain('life.overview.chapter.startBadge');
  });

  it('LIFE-WORLD-ARC-1 — count comes from completedArcCount ONLY, ignoring any legacy inline array', () => {
    render(
      <WorldCard
        world={
          {
            ...world({ completedArcCount: 1, currentArc: null }),
            // A stray legacy array must not influence the badge.
            completedArcs: [{}, {}, {}, {}, {}],
          } as never
        }
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    // 1 (scalar) + 1 = 2, NOT 5 + 1 = 6.
    expect(badge()).toContain('life.overview.chapter.readyBadge:2');
  });
});
