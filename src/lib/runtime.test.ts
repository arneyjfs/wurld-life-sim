// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  getRuntime,
  isNative,
  isBrowser,
  isInstalledPwa,
  isPwaOrNative,
} from './runtime';

describe('runtime', () => {
  it('reports browser runtime under the test setup', () => {
    // Vitest setup stubs Capacitor.isNativePlatform => false; matchMedia is
    // present (jsdom) but returns matches: false. No iOS navigator.standalone.
    expect(getRuntime()).toBe('browser');
    expect(isBrowser()).toBe(true);
    expect(isNative()).toBe(false);
    expect(isInstalledPwa()).toBe(false);
    expect(isPwaOrNative()).toBe(false);
  });

  it('isPwaOrNative aggregates both', () => {
    // We can't toggle runtime detection mid-test without re-mocking;
    // just ensure the boolean math holds for the current value.
    expect(isPwaOrNative()).toBe(isNative() || isInstalledPwa());
  });
});
