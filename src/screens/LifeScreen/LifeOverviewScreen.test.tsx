/**
 * LIFE-WORLD-10 — the overview header is a TAB-ROOT header (docs/specs/life-sim.md).
 *
 * `/wurlds/overview` is where the Wurlds tab lands, so its header has to match
 * the other tab roots' rather than reading like a sub-page's: a large title
 * over a muted subtitle, and no back arrow.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The screen pulls in Firebase-backed world/profile hooks and a router. None of
// that is the subject here — stub down to the header's own inputs.
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useLifeWorlds', () => ({
  useLifeWorlds: () => ({ data: [], loading: false }),
}));
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => ({ data: undefined }),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { uid: 'u1' } }),
}));
vi.mock('@/store/uiStore', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ pushToast: vi.fn() }),
}));
vi.mock('./LifeOverviewEmpty', () => ({ LifeOverviewEmpty: () => null }));
vi.mock('./LifeOverviewExplainer', () => ({ LifeOverviewExplainer: () => null }));
vi.mock('./WorldCard', () => ({ WorldCard: () => null }));

import { LifeOverviewScreen } from './LifeOverviewScreen';

describe('LIFE-WORLD-10 — Wurlds overview header', () => {
  it('LIFE-WORLD-10 — titles the section "Wurlds" with the subtitle beneath', () => {
    render(<LifeOverviewScreen />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Wurlds');
    // Exactly the brand — not the old "Your Other Wurlds" line, which moved down.
    expect(heading.textContent?.trim()).toBe('Wurlds');
    expect(screen.getByText('Your other Wurlds')).toBeInTheDocument();
  });

  it('LIFE-WORLD-10 — the title is a section title, not a sub-page line', () => {
    render(<LifeOverviewScreen />);
    const heading = screen.getByRole('heading', { level: 1 });
    // Same typography the other tab roots use.
    expect(heading).toHaveClass('text-3xl');
    expect(heading).toHaveClass('font-bold');
  });

  it('LIFE-WORLD-10 — the subtitle is muted, under the title', () => {
    render(<LifeOverviewScreen />);
    const subtitle = screen.getByText('Your other Wurlds');
    expect(subtitle).toHaveClass('text-(--color-fg-muted)');
    expect(subtitle.tagName).toBe('P');
  });

  it('LIFE-WORLD-10 — a tab root carries NO back arrow', () => {
    render(<LifeOverviewScreen />);
    // None of the other tab roots have one; back stays available via the
    // hardware button through resolveParent (NAV-PARENT-1).
    expect(screen.queryByLabelText('Back')).toBeNull();
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
  });
});
