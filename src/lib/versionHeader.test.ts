/**
 * OBS-VERSION-11 / OTA-12 — the 426 hook in the near-leaf `versionHeader`
 * module. A 426 blocks now; whatever the live-update boot registered through
 * `onUpgradeRequired` (the bounded self-heal, docs/specs/live-updates.md D9)
 * runs exactly once per page load, and on the web — where nothing registers
 * — a 426 is just the block. The header itself is asserted alongside the
 * floor fetch in `versionFloor.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same seams `versionFloor.test.ts` cuts: `log` reaches `analytics` → `firebase`.
vi.mock('./firebase', () => ({ auth: { currentUser: null } }));
vi.mock('./appCheck', () => ({ appCheckHeaders: async () => ({}) }));
vi.mock('./config', () => ({ config: { functionsUrl: 'https://fn.test' } }));

import {
  _resetUpgradeRequiredSelfHealForTests,
  onUpgradeRequired,
  reportUpgradeRequired,
} from './versionHeader';
import { useVersionGateStore } from '@/store/versionGateStore';

beforeEach(() => {
  _resetUpgradeRequiredSelfHealForTests();
  useVersionGateStore.setState({ status: 'unknown', floor: null, checkedAtMs: null });
});

describe('reportUpgradeRequired — OTA-12 self-heal', () => {
  it('OTA-12 — a 426 runs the registered handler exactly once per page load', () => {
    const handler = vi.fn();
    onUpgradeRequired(handler);
    reportUpgradeRequired('9.0.0');
    // The block is synchronous and does not depend on the handler.
    expect(useVersionGateStore.getState()).toMatchObject({ status: 'blocked', floor: '9.0.0' });
    expect(handler).toHaveBeenCalledTimes(1);

    // Further 426s this page load (every call on the old bundle fails) do not
    // start a second download.
    reportUpgradeRequired('9.0.0');
    reportUpgradeRequired(null);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(useVersionGateStore.getState().status).toBe('blocked');
  });

  it('OTA-12 — with nothing registered (the web), a 426 is just the block', () => {
    reportUpgradeRequired('9.0.0');
    expect(useVersionGateStore.getState()).toMatchObject({ status: 'blocked', floor: '9.0.0' });
  });

  it('OTA-12 — a handler registered AFTER the first 426 still gets one run', () => {
    // The boot registers before any fetch, but the order must not matter for
    // correctness: an unhandled 426 is not "spent".
    reportUpgradeRequired('9.0.0');
    const handler = vi.fn();
    onUpgradeRequired(handler);
    reportUpgradeRequired('9.0.0');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('OTA-12 — a throwing handler neither lifts the block nor escapes', () => {
    onUpgradeRequired(() => {
      throw new Error('download failed');
    });
    expect(() => reportUpgradeRequired('9.0.0')).not.toThrow();
    expect(useVersionGateStore.getState().status).toBe('blocked');
  });

  it('OTA-12 — `null` unregisters', () => {
    const handler = vi.fn();
    onUpgradeRequired(handler);
    onUpgradeRequired(null);
    reportUpgradeRequired('9.0.0');
    expect(handler).not.toHaveBeenCalled();
  });
});
