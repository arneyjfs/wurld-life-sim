import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import * as log from './log';

/**
 * GLOBAL engagement streak — LIFE-STREAK-*.
 *
 * ONE streak per user that advances whenever the user completes a
 * streak-eligible action on a given local-TZ day. Two sources feed the
 * SAME streak:
 *   1. Completing a practice session (SessionSummary persist effect).
 *   2. Completing a wurld chapter / arc (useChapterCompletion close).
 *
 * The streak is the number of CONSECUTIVE local days ending on the most
 * recent completion. Completing two things on the SAME day does NOT
 * double-count (idempotent by local day-key). A full calendar day with
 * no completion breaks the run.
 *
 * Stored on the user doc (`users/{uid}`) as a nested
 * `streak: { count, lastDay }` map — a read-modify-write keyed on the
 * local day, mirroring the CARDS-ARCHIVE auto-archive streak's shape.
 * The stored map is byte-identical to `GlobalStreakState`.
 * `advanceStreak` / `currentStreak`
 * are PURE so the day-rollover + both-sources-count logic is unit-testable
 * without Firestore. The user doc is the source of truth because the
 * streak is GLOBAL (not per-world like the old `sessionDayCount`, nor
 * per-language like the practice-dashboard's derived streak) and is
 * already reactively available app-wide via `useUserProfile`.
 */

export type GlobalStreakState = {
  /** Consecutive-day run length (>= 1 when present). */
  count: number;
  /** Local `YYYY-MM-DD` of the most recent completion. */
  lastDay: string;
};

/** Local-TZ `YYYY-MM-DD` for a wall-clock instant. The grouping key —
 *  same local-day convention as the practice dashboard streak
 *  (PRACTICE-DASH-10). */
export function streakDayKey(nowMs: number = Date.now()): string {
  return ymdLocal(new Date(nowMs));
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** The local day-key exactly one calendar day before `dayKey`. Anchored
 *  at local noon so a DST transition can't shift the calendar date. */
function previousDayKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-');
  const dt = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0, 0);
  dt.setDate(dt.getDate() - 1);
  return ymdLocal(dt);
}

/**
 * PURE. Given the prior streak state and TODAY's local day-key, return
 * the state after recording a completion today.
 *
 *  - no prior state          → { count: 1 } (first-ever completion)
 *  - prior.lastDay = today   → unchanged (idempotent — 2nd source same day)
 *  - prior.lastDay = y'day   → count + 1 (streak continues)
 *  - prior.lastDay older     → { count: 1 } (run broke; restart today)
 */
export function advanceStreak(
  prev: GlobalStreakState | null,
  todayKey: string,
): GlobalStreakState {
  if (!prev || prev.count <= 0 || !prev.lastDay) {
    return { count: 1, lastDay: todayKey };
  }
  if (prev.lastDay === todayKey) return prev;
  if (prev.lastDay === previousDayKey(todayKey)) {
    return { count: prev.count + 1, lastDay: todayKey };
  }
  return { count: 1, lastDay: todayKey };
}

/**
 * PURE. The streak count to DISPLAY as of `todayKey`. A streak is
 * "alive" if the last completion was today OR yesterday (the user still
 * has today to keep it going). Two-or-more full days without a
 * completion breaks it → 0.
 */
export function currentStreak(
  prev: GlobalStreakState | null,
  todayKey: string = streakDayKey(),
): number {
  if (!prev || prev.count <= 0 || !prev.lastDay) return 0;
  if (prev.lastDay === todayKey) return prev.count;
  if (prev.lastDay === previousDayKey(todayKey)) return prev.count;
  return 0;
}

/** Extract the stored streak state from the `streak` map on a parsed
 *  `User` (or raw doc data). Null when absent / malformed. */
export function readStreakState(
  source: { streak?: { count?: number; lastDay?: string } } | null | undefined,
): GlobalStreakState | null {
  const s = source?.streak;
  if (
    !s ||
    typeof s.count !== 'number' ||
    s.count <= 0 ||
    typeof s.lastDay !== 'string' ||
    !s.lastDay
  ) {
    return null;
  }
  return { count: s.count, lastDay: s.lastDay };
}

/**
 * Record a streak-eligible completion for `uid` NOW. Read-modify-write
 * on the user doc, idempotent per local day.
 *
 * Defensive + best-effort:
 *   - A read failure SKIPS the write — a transient outage must never
 *     clobber a real streak back to 1. The next completion repairs it.
 *   - A same-day repeat (or otherwise-unchanged state) writes nothing.
 *   - A write failure logs a warn and is swallowed; the completion path
 *     never blocks on the streak.
 *
 * Returns the resulting state (or the read state on a no-op / skip).
 */
export async function recordStreakCompletion(
  uid: string,
  nowMs: number = Date.now(),
): Promise<GlobalStreakState | null> {
  if (!uid) return null;
  const today = streakDayKey(nowMs);
  const ref = doc(db, 'users', uid);

  let prev: GlobalStreakState | null;
  try {
    const snap = await getDoc(ref);
    prev = readStreakState(
      snap.data() as
        | { streak?: { count?: number; lastDay?: string } }
        | undefined,
    );
  } catch (err) {
    log.warn('streak.record read failed', { err: String(err) });
    return null;
  }

  const next = advanceStreak(prev, today);
  if (prev && prev.count === next.count && prev.lastDay === next.lastDay) {
    // Same-day repeat / unchanged — nothing to persist.
    return next;
  }

  try {
    await setDoc(
      ref,
      { streak: next, updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    log.warn('streak.record write failed', { err: String(err) });
  }
  return next;
}
