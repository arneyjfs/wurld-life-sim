import type { Difficulty, XpState } from '@/types/firestore';
import type { MessageKey } from '@/i18n';

/**
 * Client-side XP constants and pure helpers (docs/specs/xp.md). The server
 * computes every amount and `ready[L]` / `nextOfferAt[L]`; these only READ
 * them for the dashboard (XP-UI-3/4) and the level-up host (XP-LEVEL-5).
 */

/** XP-LEVEL-1 — `byLevel[L]` needed to leave level L when `nextOfferAt[L]`
 *  is unset. Mirrored in functions; tune both together. */
export const XP_LEVEL_THRESHOLD = 500;

/** XP-LEVEL-7 — the unset-difficulty default, everywhere. */
export const DEFAULT_DIFFICULTY: Difficulty = 2;

/** Highest difficulty level; never ready (XP-LEVEL-3). */
export const TOP_LEVEL: Difficulty = 7;

/** XP-LEVEL-2 — the accuracy gate, mirrored from functions/src/xp.ts. */
export const XP_ACCURACY_MIN_OUTCOMES = 20;
export const XP_ACCURACY_MIN_RATE = 0.7;

/** XP-LEVEL-9 — practice-language messages to send at a level before it is
 *  ready; levels not listed need none. Mirrored from functions/src/xp.ts. */
export const XP_WRITTEN_REQUIRED: Readonly<Record<number, number>> = { 5: 150, 6: 300 };

/** XP-LEVEL-2.1 — written messages are graded from this level up. Mirrored from functions/src/xp.ts. */
export const XP_WRITING_GRADED_FROM_LEVEL = 6;

/** XP-LEVEL-2.3 — quiz answers are graded only up to this level. Mirrored from functions/src/xp.ts. */
export const XP_QUIZ_GRADED_UP_TO_LEVEL = 5;

/** XP-UI-4 — the chart's window. */
export const XP_CHART_DAYS = 14;

/** XP-LEVEL-7 — read `users.difficulty`, unset → 2. */
export function resolveDifficulty(d: number | null | undefined): Difficulty {
  return (typeof d === 'number' && d >= 1 && d <= 7 ? Math.round(d) : DEFAULT_DIFFICULTY) as Difficulty;
}

export type LevelProgress = {
  level: number;
  /** `byLevel[L]` — XP earned while at this level (XP-DATA-2). */
  earned: number;
  /** `nextOfferAt[L] ?? 500` (XP-LEVEL-1/4). */
  target: number;
  /** 0..100, clamped. */
  pct: number;
  /** Level 7 — "Top level". */
  top: boolean;
  /** XP-UI-3 — the XP is there but the accuracy gate is not. */
  accuracyHint: boolean;
  /** XP-UI-3.2 — the XP is there (whatever the gate): offer "Level up now". */
  levelUpNow: boolean;
};

export type LevelAccuracy = {
  /** Graded outcomes in `recent[L]` (XP-DATA-3). */
  count: number;
  right: number;
  /** 0..100, whole percent; null with no outcomes yet. */
  rate: number | null;
  /** XP_ACCURACY_MIN_OUTCOMES. */
  needed: number;
  /** XP_ACCURACY_MIN_RATE as a whole percent. */
  targetRate: number;
  /** Why the gate fails, or null when it holds (XP-UI-3.2). */
  blocker: 'answers' | 'rate' | null;
};

/** XP-UI-3.1 — accuracy at level L, from `recent[L]` (XP-LEVEL-2). */
export function levelAccuracy(xp: XpState | null | undefined, level: number): LevelAccuracy {
  const recent = xp?.recent?.[String(level)] ?? '';
  const count = recent.length;
  let right = 0;
  for (const c of recent) if (c === '1') right += 1;
  const rate = count > 0 ? Math.round((right / count) * 100) : null;
  const blocker =
    count < XP_ACCURACY_MIN_OUTCOMES ? 'answers' : right / count < XP_ACCURACY_MIN_RATE ? 'rate' : null;
  return {
    count,
    right,
    rate,
    needed: XP_ACCURACY_MIN_OUTCOMES,
    targetRate: Math.round(XP_ACCURACY_MIN_RATE * 100),
    blocker,
  };
}

export type LevelWriting = {
  /** `written[L]` — practice-language messages sent at this level (XP-DATA-3.1). */
  count: number;
  /** XP_WRITTEN_REQUIRED[L]. */
  needed: number;
  remaining: number;
  met: boolean;
};

/** XP-LEVEL-9 / XP-UI-3.4 — the writing gate at level L; null below level 5
 *  and at the top, where there is none. */
export function levelWriting(xp: XpState | null | undefined, level: number): LevelWriting | null {
  const needed = XP_WRITTEN_REQUIRED[level] ?? 0;
  if (needed <= 0) return null;
  const count = xp?.written?.[String(level)] ?? 0;
  return { count, needed, remaining: Math.max(0, needed - count), met: count >= needed };
}

/** XP-UI-3 — the dashboard's progress bar toward the next level. */
export function levelProgress(xp: XpState | null | undefined, level: number): LevelProgress {
  const key = String(level);
  const earned = xp?.byLevel?.[key] ?? 0;
  const target = xp?.nextOfferAt?.[key] ?? XP_LEVEL_THRESHOLD;
  const top = level >= TOP_LEVEL;
  const pct = target > 0 ? Math.max(0, Math.min(100, (earned / target) * 100)) : 0;
  const levelUpNow = !top && earned >= target;
  const accuracyHint = levelUpNow && xp?.ready?.[key] !== true;
  return { level, earned, target, pct, top, accuracyHint, levelUpNow };
}

/** UTC `YYYY-MM-DD`, the `xp.daily` key (XP-DATA-3). */
export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** XP-UI-4 — the last 14 UTC days, oldest first, zero days included. */
export function xpDailySeries(
  xp: XpState | null | undefined,
  nowMs: number,
  days: number = XP_CHART_DAYS,
): Array<{ date: string; total: number }> {
  const out: Array<{ date: string; total: number }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = utcDayKey(nowMs - i * 86_400_000);
    out.push({ date, total: xp?.daily?.[date]?.total ?? 0 });
  }
  return out;
}

/**
 * XP-UI-4 — the running total at the end of each of the last 14 UTC days,
 * oldest first: today's point is `xp.total`, and each earlier point takes off
 * what was earned after it. Never decreases, so the line only goes up.
 */
export function xpCumulativeSeries(
  xp: XpState | null | undefined,
  nowMs: number,
  days: number = XP_CHART_DAYS,
): Array<{ date: string; total: number }> {
  const daily = xpDailySeries(xp, nowMs, days);
  const out: Array<{ date: string; total: number }> = [];
  let running = Math.max(0, xp?.total ?? 0);
  for (let i = daily.length - 1; i >= 0; i -= 1) {
    out.unshift({ date: daily[i]!.date, total: running });
    running = Math.max(0, running - daily[i]!.total);
  }
  return out;
}

/**
 * XP-LEVEL-5 — should the host promote now? `ready[L]` is the server's
 * verdict; the client re-checks `byLevel[L] >= nextOfferAt[L]` so a `ready`
 * left stale after the server advanced `nextOfferAt` (XP-LEVEL-4) cannot
 * re-offer the promotion the user just undid.
 */
export function shouldOfferPromotion(args: {
  xp: XpState | null | undefined;
  difficulty: number;
  entitled: boolean;
  suppressed: boolean;
  handled: boolean;
}): boolean {
  const { xp, difficulty, entitled, suppressed, handled } = args;
  if (!xp || !entitled || suppressed || handled) return false;
  if (difficulty >= TOP_LEVEL) return false;
  const key = String(difficulty);
  if (xp.ready?.[key] !== true) return false;
  return (xp.byLevel?.[key] ?? 0) >= (xp.nextOfferAt?.[key] ?? XP_LEVEL_THRESHOLD);
}

/**
 * XP-LEVEL-5 "at most once per promotion" — identifies one offer. It changes
 * only when the server advances `nextOfferAt[L]`, so the server's `ready`
 * still reading true while the `level_changed` call lands does not re-show.
 */
export function promotionKey(uid: string, language: string, level: number, xp: XpState | null | undefined): string {
  const at = xp?.nextOfferAt?.[String(level)] ?? XP_LEVEL_THRESHOLD;
  return `${uid}|${language}|${level}|${at}`;
}

/** XP-LEVEL-5 — the level names the sheet shows are Settings' own
 *  (`settings.difficulty.levelN.label`). */
export function difficultyLabelKey(level: number): MessageKey {
  return `settings.difficulty.level${resolveDifficulty(level)}.label` as MessageKey;
}
