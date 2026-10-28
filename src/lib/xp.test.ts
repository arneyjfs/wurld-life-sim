import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIFFICULTY,
  XP_LEVEL_THRESHOLD,
  levelAccuracy,
  levelProgress,
  promotionKey,
  resolveDifficulty,
  shouldOfferPromotion,
  xpDailySeries,
} from './xp';
import type { XpState } from '@/types/firestore';

const xp = (over: Partial<XpState> = {}): XpState => ({ total: 0, ...over });

describe('xp client helpers — docs/specs/xp.md', () => {
  it('XP-LEVEL-7 — the unset-difficulty default is 2', () => {
    expect(DEFAULT_DIFFICULTY).toBe(2);
    expect(resolveDifficulty(undefined)).toBe(2);
    expect(resolveDifficulty(null)).toBe(2);
    expect(resolveDifficulty(5)).toBe(5);
  });

  it('XP-LEVEL-1 — the default threshold is 500', () => {
    expect(XP_LEVEL_THRESHOLD).toBe(500);
  });

  it('XP-UI-3 — progress reads byLevel[L] of nextOfferAt[L], defaulting to 500', () => {
    const p = levelProgress(xp({ total: 900, byLevel: { '2': 120, '3': 780 } }), 2);
    expect(p).toMatchObject({ level: 2, earned: 120, target: 500, top: false, accuracyHint: false });
    expect(p.pct).toBeCloseTo(24);
    const q = levelProgress(xp({ byLevel: { '3': 600 }, nextOfferAt: { '3': 1100 } }), 3);
    expect(q).toMatchObject({ earned: 600, target: 1100 });
  });

  it('XP-UI-3 — no xp yet reads 0 / 500', () => {
    expect(levelProgress(undefined, 2)).toMatchObject({ earned: 0, target: 500, pct: 0 });
  });

  it('XP-UI-3 — level 7 is the top level', () => {
    expect(levelProgress(xp({ byLevel: { '7': 40 } }), 7).top).toBe(true);
  });

  it('XP-UI-3 — the accuracy hint shows when XP reaches the threshold but ready is not set', () => {
    expect(levelProgress(xp({ byLevel: { '2': 520 } }), 2).accuracyHint).toBe(true);
    expect(levelProgress(xp({ byLevel: { '2': 520 }, ready: { '2': true } }), 2).accuracyHint).toBe(false);
    expect(levelProgress(xp({ byLevel: { '2': 499 } }), 2).accuracyHint).toBe(false);
    // The bar never overflows.
    expect(levelProgress(xp({ byLevel: { '2': 900 } }), 2).pct).toBe(100);
  });

  it('XP-UI-3.2 — Level up now is offered once the XP is there, ready or not, never at 7', () => {
    expect(levelProgress(xp({ byLevel: { '2': 520 } }), 2).levelUpNow).toBe(true);
    expect(levelProgress(xp({ byLevel: { '2': 520 }, ready: { '2': true } }), 2).levelUpNow).toBe(true);
    expect(levelProgress(xp({ byLevel: { '2': 499 } }), 2).levelUpNow).toBe(false);
    expect(levelProgress(xp({ byLevel: { '7': 900 } }), 7).levelUpNow).toBe(false);
  });

  it('XP-UI-3.1 — accuracy at the level reads recent[L]; empty at a new level', () => {
    expect(levelAccuracy(xp({ recent: { '3': '1101' } }), 3)).toMatchObject({ count: 4, right: 3, rate: 75, needed: 20, targetRate: 70 });
    expect(levelAccuracy(xp({ recent: { '3': '1101' } }), 4)).toMatchObject({ count: 0, right: 0, rate: null, blocker: 'answers' });
  });

  it('XP-UI-3.2 — the blocker: too few answers, then a rate under 70%, then none', () => {
    expect(levelAccuracy(xp({ recent: { '2': '1'.repeat(19) } }), 2).blocker).toBe('answers');
    expect(levelAccuracy(xp({ recent: { '2': '1'.repeat(13) + '0'.repeat(7) } }), 2)).toMatchObject({ rate: 65, blocker: 'rate' });
    expect(levelAccuracy(xp({ recent: { '2': '1'.repeat(14) + '0'.repeat(6) } }), 2)).toMatchObject({ rate: 70, blocker: null });
  });

  it('XP-UI-4 — 14 UTC days oldest first, zero days included', () => {
    const now = Date.UTC(2026, 9, 20, 15, 0, 0);
    const series = xpDailySeries(
      xp({ daily: { '2026-10-20': { total: 12, write: 3 }, '2026-10-07': { total: 5, write: 0 }, '2026-10-06': { total: 99, write: 0 } } }),
      now,
    );
    expect(series).toHaveLength(14);
    expect(series[0]).toEqual({ date: '2026-10-07', total: 5 });
    expect(series[13]).toEqual({ date: '2026-10-20', total: 12 });
    expect(series.filter((d) => d.total === 0)).toHaveLength(12);
  });

  it('XP-LEVEL-5 — offers a promotion only when ready, entitled, unsuppressed and below 7', () => {
    const ready = xp({ byLevel: { '3': 510 }, ready: { '3': true } });
    const base = { xp: ready, difficulty: 3, entitled: true, suppressed: false, handled: false };
    expect(shouldOfferPromotion(base)).toBe(true);
    expect(shouldOfferPromotion({ ...base, entitled: false })).toBe(false);
    expect(shouldOfferPromotion({ ...base, suppressed: true })).toBe(false);
    expect(shouldOfferPromotion({ ...base, handled: true })).toBe(false);
    expect(shouldOfferPromotion({ ...base, difficulty: 2 })).toBe(false);
    expect(shouldOfferPromotion({ ...base, xp: xp({ byLevel: { '7': 900 }, ready: { '7': true } }), difficulty: 7 })).toBe(false);
  });

  it('XP-LEVEL-4/5 — a stale ready after the server advanced nextOfferAt does not re-offer', () => {
    const stale = xp({ byLevel: { '3': 510 }, ready: { '3': true }, nextOfferAt: { '3': 1010 } });
    expect(
      shouldOfferPromotion({ xp: stale, difficulty: 3, entitled: true, suppressed: false, handled: false }),
    ).toBe(false);
  });

  it('XP-LEVEL-5 — the promotion key changes only when nextOfferAt moves', () => {
    const a = promotionKey('uid', 'French', 3, xp({ byLevel: { '3': 510 } }));
    const b = promotionKey('uid', 'French', 3, xp({ byLevel: { '3': 530 } }));
    const c = promotionKey('uid', 'French', 3, xp({ nextOfferAt: { '3': 1010 } }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
