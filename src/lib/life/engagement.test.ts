import { describe, it, expect } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { deriveSessionDay, WELCOME_BACK_THRESHOLD_HOURS } from './engagement';
import type { LifeWorld } from '@/types/firestore';

const baseWorld: LifeWorld = {
  id: 'main',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  worldMode: 'realistic',
};

function withLast(world: LifeWorld, ms: number, dayKey?: string): LifeWorld {
  return {
    ...world,
    lastSessionAt: Timestamp.fromMillis(ms),
    lastSessionDay:
      dayKey ?? new Date(ms).toISOString().slice(0, 10).replace(/-/g, '-'),
  };
}

describe('deriveSessionDay', () => {
  it('first-ever open: hoursSinceLastSession=null, newSessionDay=true, welcomeBack=false', () => {
    const r = deriveSessionDay(baseWorld, Date.parse('2026-06-01T10:00:00Z'));
    expect(r.hoursSinceLastSession).toBeNull();
    expect(r.newSessionDay).toBe(true);
    expect(r.welcomeBack).toBe(false);
    expect(r.sessionDayCount).toBe(1);
  });

  it('same-day re-open: newSessionDay=false, sessionDayCount stays', () => {
    const morning = Date.parse('2026-06-01T08:00:00Z');
    const afternoon = Date.parse('2026-06-01T16:00:00Z');
    const dayKey = new Date(morning).toISOString().slice(0, 10);
    const world = {
      ...withLast(baseWorld, morning, dayKey),
      sessionDayCount: 4,
    };
    const r = deriveSessionDay(world, afternoon);
    expect(r.newSessionDay).toBe(false);
    expect(r.sessionDayCount).toBe(4);
  });

  it('welcome-back fires when the gap exceeds the threshold', () => {
    const yesterday = Date.parse('2026-06-01T08:00:00Z');
    const today = Date.parse('2026-06-02T10:00:00Z');
    const world = withLast(baseWorld, yesterday);
    const r = deriveSessionDay(world, today);
    expect(r.hoursSinceLastSession).toBeGreaterThan(WELCOME_BACK_THRESHOLD_HOURS);
    expect(r.welcomeBack).toBe(true);
    expect(r.newSessionDay).toBe(true);
  });

  it('does NOT fire welcome-back when the gap is small', () => {
    const earlier = Date.parse('2026-06-01T08:00:00Z');
    const later = Date.parse('2026-06-01T11:00:00Z');
    const world = withLast(baseWorld, earlier);
    const r = deriveSessionDay(world, later);
    expect(r.welcomeBack).toBe(false);
  });

  it('streak increments only on a fresh day', () => {
    const day1 = Date.parse('2026-06-01T10:00:00Z');
    const day2 = Date.parse('2026-06-02T10:00:00Z');
    const day3SameAsDay2 = Date.parse('2026-06-02T18:00:00Z');
    const after1 = deriveSessionDay(
      { ...baseWorld, sessionDayCount: 0 },
      day1,
    );
    expect(after1.sessionDayCount).toBe(1);
    const worldDay1 = {
      ...baseWorld,
      sessionDayCount: 1,
      lastSessionAt: Timestamp.fromMillis(day1),
      lastSessionDay: new Date(day1).toISOString().slice(0, 10),
    };
    const after2 = deriveSessionDay(worldDay1, day2);
    expect(after2.sessionDayCount).toBe(2);
    const worldDay2 = {
      ...baseWorld,
      sessionDayCount: 2,
      lastSessionAt: Timestamp.fromMillis(day2),
      lastSessionDay: new Date(day2).toISOString().slice(0, 10),
    };
    const after3 = deriveSessionDay(worldDay2, day3SameAsDay2);
    expect(after3.sessionDayCount).toBe(2);
  });
});
