/**
 * NAV-BACK-2 / NAV-STACK-2 / NAV-STACK-3 (docs/specs/navigation.md).
 *
 * `BackButton` is now THE back affordance — 19 arrows render this one
 * component — so this is the only place its behaviour has to be proven. The
 * per-screen tests assert that a screen renders it; what it DOES is asserted
 * once, here.
 *
 * ⚠ WHY THIS USES `BrowserRouter` AND NOT `MemoryRouter`. A `MemoryRouter`
 * keeps its own in-memory stack and never touches `window.history`, so a test
 * mounted in one can only assert the resulting PATHNAME — and a push, a
 * replace and a pop all produce the SAME pathname. That is exactly the
 * distinction the reported yo-yo turned on: 16 hand-rolled `<Link>` arrows
 * landed on precisely the right screen while appending a duplicate of the
 * parent to the browser's stack, and every pathname assertion in the repo
 * called that correct for months. `window.history.length` is what tells a
 * PUSH from a POP, so the stack is what this file watches.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter, Link, Routes, Route, useLocation } from 'react-router-dom';
import { BackButton } from './BackButton';
import {
  _resetAppInitiatedPopForTests,
  peekAppInitiatedPop,
  stateForPath,
} from '@/lib/navStack';

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderAt() {
  return render(
    <BrowserRouter>
      <Loc />
      <Routes>
        <Route path="*" element={<BackButton />} />
      </Routes>
    </BrowserRouter>,
  );
}

beforeEach(() => {
  _resetAppInitiatedPopForTests();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  _resetAppInitiatedPopForTests();
  window.history.replaceState(null, '', '/');
});

describe('BackButton — NAV-BACK-2', () => {
  it('NAV-BACK-2 — renders the shared `nav-back` affordance with the HIERARCHY parent as its href', () => {
    window.history.pushState(stateForPath('/chat/abc'), '', '/chat/abc');
    window.history.pushState(stateForPath('/chat/abc/info'), '', '/chat/abc/info');
    renderAt();

    const back = screen.getByTestId('nav-back');
    // The href is real so right-click / ⌘-click / "where does this go" work
    // and a screen reader announces a destination.
    expect(back).toHaveAttribute('href', '/chat/abc');
    expect(back).toHaveAccessibleName('Back');
  });

  it('NAV-BACK-2 — `label` overrides the default for a screen that needs something more specific', () => {
    window.history.pushState(stateForPath('/admin'), '', '/admin');
    render(
      <BrowserRouter>
        <BackButton label="Back to settings" />
      </BrowserRouter>,
    );
    expect(screen.getByTestId('nav-back')).toHaveAccessibleName('Back to settings');
  });

  it('NAV-STACK-2 — a plain click POPS: it lands on the parent WITHOUT growing the stack', async () => {
    window.history.pushState(stateForPath('/chat/abc'), '', '/chat/abc');
    window.history.pushState(stateForPath('/chat/abc/info'), '', '/chat/abc/info');
    const before = window.history.length;

    renderAt();
    fireEvent.click(screen.getByTestId('nav-back'));

    await waitFor(() => {
      expect(screen.getByTestId('loc').textContent).toBe('/chat/abc');
    });
    // THE assertion the old hand-rolled arrows would have failed. A `<Link
    // to="/chat/abc">` lands here too — and leaves an extra entry behind, so
    // the platform back button retraces the way in.
    expect(window.history.length).toBeLessThanOrEqual(before);
    // ...and it was a real pop, not a replace that happened to land right.
    expect(peekAppInitiatedPop()).toEqual({ from: '/chat/abc/info', to: '/chat/abc' });
  });

  it('NAV-STACK-3 — an unstamped stack falls back to replace, which still does not PUSH', async () => {
    // Session restore, a foreign entry, anything that bypassed the stamp.
    window.history.pushState(null, '', '/chat/abc/info');
    const before = window.history.length;

    renderAt();
    fireEvent.click(screen.getByTestId('nav-back'));

    await waitFor(() => {
      expect(screen.getByTestId('loc').textContent).toBe('/chat/abc');
    });
    expect(window.history.length).toBeLessThanOrEqual(before);
    // The fallback is always right about WHERE it lands; it just cannot claim
    // a pop, or NAV-ANIM-9 would animate a transition that never happened.
    expect(peekAppInitiatedPop()).toBeNull();
  });

  it('NAV-BACK-2 — CONTROL: the hand-rolled `<Link>` this replaced FAILS the stack assertion above', async () => {
    // Without this case the two assertions above could be vacuous — if
    // jsdom's `history.length` did not move on a push, `toBeLessThanOrEqual`
    // would pass for anything and this file would be decoration. So mount the
    // exact defect (a `<Link>` to the parent, which lands on the right
    // pathname) and prove the measurement discriminates.
    window.history.pushState(stateForPath('/chat/abc'), '', '/chat/abc');
    window.history.pushState(stateForPath('/chat/abc/info'), '', '/chat/abc/info');
    const before = window.history.length;

    render(
      <BrowserRouter>
        <Loc />
        <Link to="/chat/abc">back</Link>
      </BrowserRouter>,
    );
    fireEvent.click(screen.getByText('back'));

    await waitFor(() => {
      expect(screen.getByTestId('loc').textContent).toBe('/chat/abc');
    });
    // Right screen, wrong stack: the parent is now on the stack TWICE, so the
    // platform back button walks back into the child. This is the bug.
    expect(window.history.length).toBeGreaterThan(before);
    expect(peekAppInitiatedPop()).toBeNull();
  });

  it('NAV-BACK-2 — a ⌘/ctrl-click is NOT intercepted, so "open the parent in a new tab" still works', () => {
    window.history.pushState(stateForPath('/chat/abc'), '', '/chat/abc');
    window.history.pushState(stateForPath('/chat/abc/info'), '', '/chat/abc/info');
    renderAt();

    // Read defaultPrevented from a document-level listener: it runs AFTER
    // React's root handler, so it sees whether the component prevented the
    // default. Preventing it here as well stops jsdom from trying to perform
    // the navigation it cannot implement (which would only add log noise).
    let preventedByComponent: boolean | null = null;
    const spy = (e: Event) => {
      preventedByComponent = e.defaultPrevented;
      e.preventDefault();
    };
    document.addEventListener('click', spy);
    try {
      fireEvent.click(screen.getByTestId('nav-back'), { metaKey: true });
      expect(preventedByComponent).toBe(false);
      // Nothing moved in-app: the browser owns this click.
      expect(screen.getByTestId('loc').textContent).toBe('/chat/abc/info');
      expect(peekAppInitiatedPop()).toBeNull();
    } finally {
      document.removeEventListener('click', spy);
    }
  });
});
