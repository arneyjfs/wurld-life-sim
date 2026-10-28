/**
 * CHROME-HAPTIC-1 (docs/specs/app-chrome.md §3b) — `selection` and `error`
 * exist, gate on canUseHaptics(), and never throw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const caps = vi.hoisted(() => ({ haptics: true }));
vi.mock('./capabilities', () => ({ canUseHaptics: () => caps.haptics }));

const plugin = vi.hoisted(() => ({
  impact: vi.fn(),
  notification: vi.fn(),
  selectionStart: vi.fn(),
  selectionChanged: vi.fn(),
  selectionEnd: vi.fn(),
}));
vi.mock('@capacitor/haptics', () => ({
  Haptics: plugin,
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

import { haptics } from './haptics';

beforeEach(() => {
  caps.haptics = true;
  for (const fn of Object.values(plugin)) fn.mockReset().mockResolvedValue(undefined);
});

describe('haptics', () => {
  it('CHROME-HAPTIC-1 — error() fires the Error notification', async () => {
    await haptics.error();
    expect(plugin.notification).toHaveBeenCalledWith({ type: 'ERROR' });
  });

  it('CHROME-HAPTIC-1 — selection() fires a selection tick', async () => {
    await haptics.selection();
    expect(plugin.selectionChanged).toHaveBeenCalledTimes(1);
  });

  it('CHROME-HAPTIC-1 — both are no-ops where canUseHaptics() is false', async () => {
    caps.haptics = false;
    await haptics.error();
    await haptics.selection();
    expect(plugin.notification).not.toHaveBeenCalled();
    expect(plugin.selectionChanged).not.toHaveBeenCalled();
    expect(plugin.selectionStart).not.toHaveBeenCalled();
  });

  it('CHROME-HAPTIC-1 — a rejecting plugin never throws', async () => {
    plugin.notification.mockRejectedValue(new Error('nope'));
    plugin.selectionChanged.mockRejectedValue(new Error('nope'));
    plugin.selectionStart.mockRejectedValue(new Error('nope'));
    await expect(haptics.error()).resolves.toBeUndefined();
    await expect(haptics.selection()).resolves.toBeUndefined();
  });
});
