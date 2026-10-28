/**
 * NAV-BACK-1 / NAV-BACK-CIRCULAR-1 / NAV-BACK-EMPTY-1 (docs/specs/navigation.md).
 * Integration test: useAppBack inside a real router navigates to the resolved
 * PARENT, not history.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useAppBack } from './useAppBack';
import {
  _resetAppInitiatedPopForTests,
  peekAppInitiatedPop,
  stateForPath,
  withEntry,
} from '@/lib/navStack';

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}
function BackBtn() {
  const back = useAppBack();
  return <button onClick={back}>back</button>;
}

function renderAt(initialEntries: string[]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Loc />
      <Routes>
        <Route path="*" element={<BackBtn />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useAppBack', () => {
  it('NAV-BACK-1 — backs to the hierarchy parent (chat info → chat)', () => {
    renderAt(['/chat/abc/info']);
    fireEvent.click(screen.getByText('back'));
    expect(screen.getByTestId('loc').textContent).toBe('/chat/abc');
  });

  it('NAV-BACK-CIRCULAR-1 — from /chat/:id back goes to the LIST even with media→viewer in history', () => {
    // Simulate the circular path: list → chat → info(media) → back-to chat.
    renderAt(['/', '/chat/abc', '/chat/abc/info', '/chat/abc']);
    fireEvent.click(screen.getByText('back'));
    // History's previous entry is /chat/abc/info, but hierarchy back → '/'.
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });

  it('NAV-BACK-EMPTY-1 — cold deep-link (single history entry) still backs to a real parent', () => {
    renderAt(['/chat/abc']); // history length 1, as if opened from a notification
    fireEvent.click(screen.getByText('back'));
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });

  it('is a no-op at the root (parent === null)', () => {
    renderAt(['/']);
    fireEvent.click(screen.getByText('back'));
    expect(screen.getByTestId('loc').textContent).toBe('/');
  });
});

/**
 * NAV-STACK-2/3 — the POP path, which the suite above cannot reach.
 *
 * ⚠ THIS IS THE GAP THAT LET THE BUG SHIP. Every test above runs in a
 * `MemoryRouter`, which keeps its own in-memory stack and never touches
 * `window.history`. So they assert the resulting PATHNAME and nothing else —
 * and a push, a replace and a pop all produce the same pathname. That is
 * precisely the distinction the reported yo-yo turned on: 16 back arrows
 * landed on exactly the right screen while appending a duplicate entry to the
 * browser's stack, and a pathname assertion called that correct for months.
 *
 * `BrowserRouter` + the real `window.history` is what makes the difference
 * observable, and `peekAppInitiatedPop()` is the discriminator: it is
 * raised ONLY on the pop path, so reading it afterwards says which branch ran
 * without having to inspect a stack the DOM will not expose.
 */
describe('NAV-STACK-2/3 — pops when the stack can be confirmed', () => {
  beforeEach(() => {
    _resetAppInitiatedPopForTests();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    _resetAppInitiatedPopForTests();
    window.history.replaceState(null, '', '/');
  });

  const renderBrowser = () =>
    render(
      <BrowserRouter>
        <Loc />
        <Routes>
          <Route path="*" element={<BackBtn />} />
        </Routes>
      </BrowserRouter>,
    );

  it('NAV-STACK-2 — a stamped stack pops, so the stack SHRINKS instead of growing', async () => {
    // Build the stack the way NAV-STACK-1 says it must look.
    window.history.pushState(stateForPath('/chat/abc'), '', '/chat/abc');
    window.history.pushState(stateForPath('/chat/abc/info'), '', '/chat/abc/info');
    const depth = window.history.length;

    renderBrowser();
    fireEvent.click(screen.getByText('back'));

    await waitFor(() => {
      expect(screen.getByTestId('loc').textContent).toBe('/chat/abc');
    });
    // The assertion the old suite could not make: we moved DOWN the stack
    // rather than writing another entry on top of it.
    expect(window.history.length).toBeLessThanOrEqual(depth);
    // ...and it was a pop, not a replace that happened to land right.
    expect(peekAppInitiatedPop()).toEqual({ from: '/chat/abc/info', to: '/chat/abc' });
  });

  it('NAV-STACK-3 — an UNSTAMPED entry falls back to replace, and does not claim a pop', async () => {
    // Session restore, a foreign entry, anything that bypassed the stamp.
    window.history.pushState(null, '', '/chat/abc/info');

    renderBrowser();
    fireEvent.click(screen.getByText('back'));

    await waitFor(() => {
      expect(screen.getByTestId('loc').textContent).toBe('/chat/abc');
    });
    // Same destination — the fallback is always correct in WHERE it lands.
    // But no pop was attempted, so NAV-ANIM-9 must not be told one was.
    expect(peekAppInitiatedPop()).toBeNull();
  });

  it('NAV-STACK-3 — a stamp that disagrees with the path is not trusted', async () => {
    // The depth is RIGHT and the entry beneath is WRONG — which is the whole
    // reason the stamp records `below` as well as depth. This is what a link
    // up the tree produces: `/cards` pushed onto `/cards/practice` carries a
    // perfectly correct depth of 1, and popping it goes back DOWN into the
    // page it left. Depth alone cannot tell this from a legitimate descent.
    window.history.pushState(
      withEntry(null, 2, '/somewhere/else'),
      '',
      '/chat/abc/info',
    );

    renderBrowser();
    fireEvent.click(screen.getByText('back'));

    await waitFor(() => {
      expect(screen.getByTestId('loc').textContent).toBe('/chat/abc');
    });
    expect(peekAppInitiatedPop()).toBeNull();
  });
});

function LocFull() {
  const l = useLocation();
  return <div data-testid="locfull">{l.pathname + l.search}</div>;
}

describe('NAV-PARENT-4 — useAppBack honours the tips marker', () => {
  it('TIPS-TRY-2 — back from a Try-it destination lands on the tips page', () => {
    render(
      <MemoryRouter initialEntries={['/cards/practice/hub?from=tips']}>
        <LocFull />
        <Routes>
          <Route path="*" element={<BackBtn />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('back'));
    expect(screen.getByTestId('locfull').textContent).toBe('/tips');
  });

  it('TIPS-TRY-2 — opened from Settings, back lands on /settings/tips', () => {
    render(
      <MemoryRouter initialEntries={['/chat/abc?from=settings-tips']}>
        <LocFull />
        <Routes>
          <Route path="*" element={<BackBtn />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('back'));
    expect(screen.getByTestId('locfull').textContent).toBe('/settings/tips');
  });
});
