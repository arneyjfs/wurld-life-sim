// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearBackdropCache,
  fullCacheKey,
  readBackdropCache,
  writeBackdropCache,
} from './backdropCache';
import type { BackdropDescriptor } from './backdropDescriptor';

const SVG_A = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="10" fill="red"/></svg>';
const SVG_B = '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="blue"/></svg>';

const persistent: BackdropDescriptor = {
  locationType: 'cafe',
  vibe: 'modern_city',
  persistent: true,
};
const transient: BackdropDescriptor = { ...persistent, persistent: false };

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe('backdropCache — LIFE-BACKDROP-2', () => {
  it('fullCacheKey includes the worldId prefix when supplied', () => {
    expect(fullCacheKey(persistent, 'world-abc')).toBe('world-abc::cafe::modern_city');
  });

  it('fullCacheKey uses a sentinel when no worldId is provided', () => {
    expect(fullCacheKey(persistent, null)).toBe('__no_world__::cafe::modern_city');
  });

  it('writes + reads a persistent backdrop by key', () => {
    writeBackdropCache(persistent, 'w1', SVG_A);
    expect(readBackdropCache(persistent, 'w1')).toBe(SVG_A);
  });

  it('returns null for a cache miss', () => {
    expect(readBackdropCache(persistent, 'w1')).toBeNull();
  });

  it('LIFE-BACKDROP-3 — caches transient descriptors too (resume must hit cache)', () => {
    writeBackdropCache(transient, 'w1', SVG_A);
    expect(readBackdropCache(transient, 'w1')).toBe(SVG_A);
  });

  it('isolates by worldId — same descriptor in different worlds caches separately', () => {
    writeBackdropCache(persistent, 'world-a', SVG_A);
    writeBackdropCache(persistent, 'world-b', SVG_B);
    expect(readBackdropCache(persistent, 'world-a')).toBe(SVG_A);
    expect(readBackdropCache(persistent, 'world-b')).toBe(SVG_B);
  });

  it('isolates by descriptor — same world, different descriptors caches separately', () => {
    const office: BackdropDescriptor = { ...persistent, locationType: 'office' };
    writeBackdropCache(persistent, 'w1', SVG_A);
    writeBackdropCache(office, 'w1', SVG_B);
    expect(readBackdropCache(persistent, 'w1')).toBe(SVG_A);
    expect(readBackdropCache(office, 'w1')).toBe(SVG_B);
  });

  it('clearBackdropCache wipes ALL entries for a given world', () => {
    const office: BackdropDescriptor = { ...persistent, locationType: 'office' };
    writeBackdropCache(persistent, 'w1', SVG_A);
    writeBackdropCache(office, 'w1', SVG_B);
    writeBackdropCache(persistent, 'w2', SVG_A); // different world

    clearBackdropCache('w1');

    expect(readBackdropCache(persistent, 'w1')).toBeNull();
    expect(readBackdropCache(office, 'w1')).toBeNull();
    expect(readBackdropCache(persistent, 'w2')).toBe(SVG_A);
  });
});
