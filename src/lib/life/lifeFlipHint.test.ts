// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_FLIPS,
  MAX_SHOWS,
  useLifeFlipHintStore,
  __resetFlipHintForTest,
} from './lifeFlipHint';

function dismissed(): boolean {
  const s = useLifeFlipHintStore.getState();
  return s.flips >= MAX_FLIPS || s.shows >= MAX_SHOWS;
}

describe('lifeFlipHint budget — LIFE-LANG-16', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetFlipHintForTest();
  });

  it('offers the hint initially', () => {
    expect(dismissed()).toBe(false);
  });

  it('retires the hint once the player has flipped MAX_FLIPS times', () => {
    const { recordFlip } = useLifeFlipHintStore.getState();
    for (let i = 0; i < MAX_FLIPS; i++) recordFlip();
    expect(dismissed()).toBe(true);
    // A single flip (< MAX_FLIPS) is not yet enough.
    __resetFlipHintForTest();
    useLifeFlipHintStore.getState().recordFlip();
    expect(dismissed()).toBe(false);
  });

  it('retires the hint after MAX_SHOWS unengaged sessions', () => {
    const { recordShow } = useLifeFlipHintStore.getState();
    for (let i = 0; i < MAX_SHOWS; i++) recordShow();
    expect(dismissed()).toBe(true);
  });

  it('persists the budget across store re-reads (localStorage-backed)', () => {
    const { recordFlip } = useLifeFlipHintStore.getState();
    for (let i = 0; i < MAX_FLIPS; i++) recordFlip();
    // Simulate a fresh mount: the persisted value must still read as dismissed.
    const raw = JSON.parse(localStorage.getItem('wurld:life-flip-hint-v1')!);
    expect(raw.flips).toBe(MAX_FLIPS);
  });

  it('never increments past the caps (idempotent once retired)', () => {
    const { recordFlip, recordShow } = useLifeFlipHintStore.getState();
    for (let i = 0; i < 10; i++) {
      recordFlip();
      recordShow();
    }
    const s = useLifeFlipHintStore.getState();
    expect(s.flips).toBeLessThanOrEqual(MAX_FLIPS);
    expect(s.shows).toBeLessThanOrEqual(MAX_SHOWS);
  });
});
