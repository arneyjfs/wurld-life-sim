import { describe, it, expect } from 'vitest';
import {
  advanceStreak,
  currentStreak,
  readStreakState,
  streakDayKey,
  type GlobalStreakState,
} from './streak';

/**
 * LIFE-STREAK-1..3 — the GLOBAL engagement streak logic.
 *
 * The pure functions are tested against explicit local day-keys so the
 * assertions are timezone-independent (streakDayKey itself is local-TZ,
 * exercised only in the day-key section below).
 */

describe('LIFE-STREAK-1 — advanceStreak (day rollover + both-sources)', () => {
  it('LIFE-STREAK-1 — first-ever completion starts the streak at 1', () => {
    expect(advanceStreak(null, '2026-06-01')).toEqual({
      count: 1,
      lastDay: '2026-06-01',
    });
  });

  it('LIFE-STREAK-1 — a completion on the next day continues the run (+1)', () => {
    const day1: GlobalStreakState = { count: 3, lastDay: '2026-06-01' };
    expect(advanceStreak(day1, '2026-06-02')).toEqual({
      count: 4,
      lastDay: '2026-06-02',
    });
  });

  it('LIFE-STREAK-1 — a second completion the SAME day does not double-count (idempotent, both-sources)', () => {
    // Practice completes first → count becomes 1 for today.
    const afterPractice = advanceStreak(null, '2026-06-01');
    expect(afterPractice.count).toBe(1);
    // A wurld chapter completes later the SAME day → still 1, not 2.
    const afterChapter = advanceStreak(afterPractice, '2026-06-01');
    expect(afterChapter).toEqual({ count: 1, lastDay: '2026-06-01' });
  });

  it('LIFE-STREAK-1 — two sources on CONSECUTIVE days each advance the run once', () => {
    // Day 1: practice.
    const d1 = advanceStreak(null, '2026-06-01');
    // Day 2: a chapter completion continues it (different source, +1).
    const d2 = advanceStreak(d1, '2026-06-02');
    expect(d2).toEqual({ count: 2, lastDay: '2026-06-02' });
  });

  it('LIFE-STREAK-1 — a skipped day (2+ day gap) breaks the run and restarts at 1', () => {
    const prev: GlobalStreakState = { count: 9, lastDay: '2026-06-01' };
    // Nothing on 06-02; a completion lands on 06-03 → reset.
    expect(advanceStreak(prev, '2026-06-03')).toEqual({
      count: 1,
      lastDay: '2026-06-03',
    });
  });

  it('LIFE-STREAK-1 — rollover across a month boundary counts as consecutive', () => {
    const feb: GlobalStreakState = { count: 5, lastDay: '2026-02-28' };
    expect(advanceStreak(feb, '2026-03-01')).toEqual({
      count: 6,
      lastDay: '2026-03-01',
    });
  });

  it('LIFE-STREAK-1 — a zero/garbage prior state restarts cleanly at 1', () => {
    expect(advanceStreak({ count: 0, lastDay: '2026-06-01' }, '2026-06-02')).toEqual({
      count: 1,
      lastDay: '2026-06-02',
    });
    expect(advanceStreak({ count: 4, lastDay: '' }, '2026-06-02')).toEqual({
      count: 1,
      lastDay: '2026-06-02',
    });
  });
});

describe('LIFE-STREAK-2 — currentStreak (display / alive window)', () => {
  it('LIFE-STREAK-2 — null / empty state shows 0', () => {
    expect(currentStreak(null, '2026-06-05')).toBe(0);
    expect(currentStreak({ count: 0, lastDay: '2026-06-05' }, '2026-06-05')).toBe(0);
  });

  it('LIFE-STREAK-2 — a completion TODAY shows the full count', () => {
    expect(currentStreak({ count: 7, lastDay: '2026-06-05' }, '2026-06-05')).toBe(7);
  });

  it('LIFE-STREAK-2 — a completion YESTERDAY stays alive (grace: today still open)', () => {
    expect(currentStreak({ count: 7, lastDay: '2026-06-04' }, '2026-06-05')).toBe(7);
  });

  it('LIFE-STREAK-2 — a full missed day (last completion 2 days ago) breaks it → 0', () => {
    expect(currentStreak({ count: 7, lastDay: '2026-06-03' }, '2026-06-05')).toBe(0);
  });
});

describe('LIFE-STREAK-3 — readStreakState / streakDayKey', () => {
  it('LIFE-STREAK-3 — extracts a valid state and rejects malformed fields', () => {
    expect(readStreakState({ streak: { count: 3, lastDay: '2026-06-01' } })).toEqual({
      count: 3,
      lastDay: '2026-06-01',
    });
    expect(readStreakState(null)).toBeNull();
    expect(readStreakState({})).toBeNull();
    expect(readStreakState({ streak: { count: 0, lastDay: '2026-06-01' } })).toBeNull();
    expect(readStreakState({ streak: { count: 3 } })).toBeNull();
  });

  it('LIFE-STREAK-3 — streakDayKey is a local YYYY-MM-DD stamp', () => {
    const key = streakDayKey(Date.parse('2026-06-01T12:00:00'));
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Constructed at local noon, so the local calendar date is 2026-06-01
    // regardless of the runner's timezone.
    expect(key).toBe('2026-06-01');
  });
});
