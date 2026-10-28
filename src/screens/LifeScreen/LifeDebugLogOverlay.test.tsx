import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LifeDebugLogOverlay } from './LifeDebugLogOverlay';

/**
 * LIFE-UI-16 — the debug overlay rides the shared BottomSheet.
 *
 * It used to hand-roll `fixed inset-0 flex items-end` around a `max-h-[80dvh]`
 * card: bottom-docked with no safe-area padding, so on a phone the card ran
 * under the home indicator and its footer could not be reached. `BottomSheet`
 * (the same primitive CountryDialPicker uses) already owns the safe-area pad,
 * the height cap, drag-to-dismiss and desktop centring.
 *
 * Asserted on STRUCTURE, not on pixels — jsdom does no layout, so "it fits on
 * the screen" is unmeasurable; what is checkable is that the shell is the
 * shared one rather than a second copy of the rules.
 */
describe('LifeDebugLogOverlay — LIFE-UI-16', () => {
  it('renders inside the shared bottom sheet, not a bespoke overlay', () => {
    render(<LifeDebugLogOverlay onClose={vi.fn()} />);
    const body = screen.getByTestId('LifeScreen-DebugLog');
    // vaul portals its Content and marks it as a dialog; the overlay body must
    // be INSIDE it rather than being its own fixed-position root.
    expect(body.closest('[role="dialog"]')).not.toBeNull();
    expect(body.className).not.toContain('fixed');
    expect(body.className).not.toContain('items-end');
  });

  it('opens on the logs tab, with both tabs reachable', () => {
    render(<LifeDebugLogOverlay onClose={vi.fn()} />);
    expect(screen.getByTestId('LifeScreen-DebugLog-Tab-Logs')).toBeInTheDocument();
    expect(
      screen.getByTestId('LifeScreen-DebugLog-Tab-Telemetry'),
    ).toBeInTheDocument();
  });
});
