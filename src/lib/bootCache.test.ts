import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBootSnapshot,
  setBootUid,
  setBootHasProfile,
  setBootOnboardingComplete,
  clearBootSnapshot,
} from './bootCache';

describe('BOOT-HYDRATION-8 — bootCache.onboardingComplete', () => {
  beforeEach(() => {
    clearBootSnapshot();
  });

  it('BOOT-HYDRATION-8 — defaults to false', () => {
    expect(getBootSnapshot().onboardingComplete).toBe(false);
  });

  it('BOOT-HYDRATION-8 — persists when set', () => {
    setBootUid('u1');
    setBootOnboardingComplete(true);
    expect(getBootSnapshot().onboardingComplete).toBe(true);
    // Survives a re-read (localStorage round-trip via the cached read path).
    expect(getBootSnapshot().onboardingComplete).toBe(true);
  });

  it('AUTH-EDGE-4 — switching uid resets onboardingComplete + hasProfile', () => {
    setBootUid('u1');
    setBootHasProfile(true);
    setBootOnboardingComplete(true);
    expect(getBootSnapshot().onboardingComplete).toBe(true);

    setBootUid('u2');
    const snap = getBootSnapshot();
    expect(snap.uid).toBe('u2');
    expect(snap.onboardingComplete).toBe(false);
    expect(snap.hasProfile).toBe(false);
  });

  it('BOOT-HYDRATION-8 — same-uid set does not reset the bit', () => {
    setBootUid('u1');
    setBootOnboardingComplete(true);
    setBootUid('u1'); // no-op
    expect(getBootSnapshot().onboardingComplete).toBe(true);
  });

  it('BOOT-HYDRATION-8 — clear resets everything', () => {
    setBootUid('u1');
    setBootOnboardingComplete(true);
    clearBootSnapshot();
    const snap = getBootSnapshot();
    expect(snap.uid).toBeNull();
    expect(snap.hasProfile).toBe(false);
    expect(snap.onboardingComplete).toBe(false);
  });
});
