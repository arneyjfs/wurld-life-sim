import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AvatarModal } from './AvatarModal';

vi.mock('@/i18n', () => ({ useT: () => (k: string) => k }));

describe('AvatarModal — LIFE-NPC-7 profile description', () => {
  it('LIFE-NPC-7 — renders the description paragraph alongside role and memory', () => {
    render(
      <AvatarModal
        subject={{
          name: 'Marie',
          avatarUrl: null,
          role: 'rival baker',
          description:
            'Your rival across the square, a baker who guards her sourdough starter like a state secret.',
          oneLineMemory: 'You first clashed over the flour delivery.',
        }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/guards her sourdough starter/)).toBeInTheDocument();
    expect(screen.getByText('rival baker')).toBeInTheDocument();
    expect(screen.getByText(/first clashed over the flour/)).toBeInTheDocument();
  });

  it('LIFE-NPC-7 — omits the description row when description is absent', () => {
    render(
      <AvatarModal
        subject={{ name: 'Léo', avatarUrl: null, role: null, oneLineMemory: null }}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText(/sourdough/)).not.toBeInTheDocument();
    expect(screen.getByText('Léo')).toBeInTheDocument();
  });
});
