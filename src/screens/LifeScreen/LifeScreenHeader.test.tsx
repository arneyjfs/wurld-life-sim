/**
 * LIFE-LANG-3 / MSG-VIEW-7.7 — the life header's second-row eye.
 *
 * Replaces the 3-way Eye→EyeOff→Languages cycle these tests used to assert.
 * The cycle is retired: it needed up to three taps to reach a state and never
 * named the states. What survives is the ONE thing the header still owns —
 * the second row — and the requirement that it behaves identically to chat's.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// LifeScreenMenu transitively imports the Firebase-backed world lib.
vi.mock('./LifeScreenMenu', () => ({
  LifeScreenMenu: () => null,
}));

// ⚠ The `@/hooks/useAppBack` mock that used to sit here is GONE, and its
// removal is the point. It replaced the whole module with `{ useAppBack }`,
// which was enough while the header hand-rolled its own `<button onClick=
// {back}>`. Under NAV-BACK-2 the arrow is `<BackButton />`, which also reads
// `useParentPath` — a partial module mock would have thrown, and stubbing the
// hook harder would have stubbed out the very thing worth asserting. A real
// `MemoryRouter` is both simpler and honest about what the header renders.
import { LifeScreenHeader } from './LifeScreenHeader';
import type { ViewSettings } from '@/lib/viewSettings';

function renderHeader(settings: Partial<ViewSettings> = {}, onSetViewSettings = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/wurlds/w1']}>
      <LifeScreenHeader
        uid="u1"
        worldId="w1"
        title="Test wurld"
        viewSettings={{ primary: 'practice', secondRow: false, ...settings }}
        onSetViewSettings={onSetViewSettings}
        practiceLanguage="French"
        nativeLanguage="English"
        difficultyPinned={null}
        globalDifficulty={2}
        onExit={() => undefined}
        onDeleted={() => undefined}
        onError={() => undefined}
      />
    </MemoryRouter>,
  );
  return onSetViewSettings;
}

describe('LIFE-LANG-3 / MSG-VIEW-7.7 — the life header eye', () => {
  it('reflects the current second-row state', () => {
    renderHeader({ secondRow: false });
    expect(screen.getByTestId('LifeScreen-EyeButton')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('turns the second row ON in one tap — no cycle to walk through', () => {
    const spy = renderHeader({ primary: 'practice', secondRow: false });
    fireEvent.click(screen.getByTestId('LifeScreen-EyeButton'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      primary: 'practice',
      secondRow: true,
    });
  });

  it('changes NOTHING but the second row, whatever the primary', () => {
    const spy = renderHeader({ primary: 'native', secondRow: true });
    fireEvent.click(screen.getByTestId('LifeScreen-EyeButton'));
    expect(spy).toHaveBeenCalledWith({
      primary: 'native',
      secondRow: false,
    });
  });

  it('the retired 3-way cycle button is gone', () => {
    renderHeader();
    expect(screen.queryByTestId('LifeScreen-ViewMode')).toBeNull();
  });
});

describe('NAV-BACK-2 — the wurld header uses the shared back affordance', () => {
  it('NAV-BACK-2 — renders `nav-back`, pointing at the hierarchy parent of /wurlds/:worldId', () => {
    renderHeader();
    // `resolveParent('/wurlds/w1')` is `/wurlds`. This header used to call
    // `useAppBack` directly and draw its own arrow — correct behaviour, second
    // implementation.
    expect(screen.getByTestId('nav-back')).toHaveAttribute('href', '/wurlds');
  });
});
