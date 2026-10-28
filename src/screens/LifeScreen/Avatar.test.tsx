import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('Avatar — LIFE-NPC-2 loading state', () => {
  it('LIFE-NPC-2 — loading shows the person-icon shimmer, not the initials', () => {
    const { container } = render(<Avatar name="Sophie" loading />);
    expect(screen.getByTestId('LifeScreen-Avatar-Loading')).toBeInTheDocument();
    // Shimmer sweep present; initials absent.
    expect(container.querySelector('.skeleton-block')).not.toBeNull();
    expect(screen.queryByText('S')).not.toBeInTheDocument();
  });

  it('LIFE-NPC-2 — a ready svgUrl wins over loading (shows the SVG)', () => {
    const { container } = render(
      <Avatar name="Sophie" svgUrl="data:image/svg+xml,x" loading />,
    );
    expect(screen.queryByTestId('LifeScreen-Avatar-Loading')).not.toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('renders the initials circle when not loading and no svgUrl', () => {
    render(<Avatar name="Sophie" />);
    expect(screen.getByText('S')).toBeInTheDocument();
    expect(
      screen.queryByTestId('LifeScreen-Avatar-Loading'),
    ).not.toBeInTheDocument();
  });
});
