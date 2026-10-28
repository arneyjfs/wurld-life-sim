/**
 * LIMIT-2 — the rate-limit window arithmetic, as a pure function.
 *
 * Spec: docs/specs/cost-limits.md.
 *
 * `checkRateLimit` (httpShared.ts) wraps this in one Firestore transaction on
 * `rateLimits/{uid}`; nothing here touches I/O or the wall clock, so the
 * roll-over, the off-by-one at each cap and the clock-skew case are all
 * testable with a clock the test owns (`functions/src/__tests__/rateLimit.test.ts`).
 *
 * Two FIXED windows, not sliding: a minute window and a day window, each
 * anchored at the first call that opened it. Fixed windows are one read and
 * one write per call and hold in a single small document; a sliding log would
 * cost a write per call AND a growing document. The trade — a burst of 2× the
 * cap straddling a boundary — is acceptable for a spend limiter.
 *
 * The day window is 24h from its first call, not a calendar day, so it needs
 * no timezone and no date arithmetic.
 *
 * ⚠ No firebase-admin import, deliberately — see the note on `entitlement.ts`.
 */

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** LIMIT-1 — calls per minute, every account. */
export const RATE_LIMIT_PER_MINUTE = 60;
/** LIMIT-1 — calls per day, free account. */
export const DAILY_CAP_FREE = 600;
/** LIMIT-1 — calls per day, Plus (entitled) account. */
export const DAILY_CAP_PLUS = 3000;

/** The `rateLimits/{uid}` document. All four fields are epoch ms / counts. */
export type RateLimitState = {
  minuteStart: number;
  minuteCount: number;
  dayStart: number;
  dayCount: number;
};

export type RateLimits = { perMinute: number; perDay: number };

export type RateLimitDecision = {
  allowed: boolean;
  /** The state to persist when `allowed`; equal to the (normalised) input
   *  when refused, so a refused call costs no write. */
  next: RateLimitState;
  /** 0 when allowed; otherwise whole seconds until the exhausted window
   *  ends, rounded UP so it is never 0 on a refusal. */
  retryAfterSeconds: number;
  /** Which window refused. `minute` wins when both are exhausted.
   *  `account_gone` is LIMIT-6.1's: the account was deleted (httpShared.ts). */
  reason?: "minute" | "day" | "clock" | "account_gone";
};

/** LIMIT-1 — the caps for an account, keyed on ENTITLEMENT (LANG-TRIAL-1),
 *  never on the raw `plan` field. */
export function limitsFor(entitled: boolean): RateLimits {
  return { perMinute: RATE_LIMIT_PER_MINUTE, perDay: entitled ? DAILY_CAP_PLUS : DAILY_CAP_FREE };
}

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Roll one window: a missing / malformed start, a start whose window has
 * elapsed, or a start in the FUTURE (a state written by an instance whose clock
 * ran ahead — treating it as live would refuse the user until that future
 * arrived) all open a fresh window at `nowMs` with a zero count.
 */
function rollWindow(
  start: unknown,
  count: unknown,
  nowMs: number,
  lengthMs: number,
): { start: number; count: number } {
  const s = finite(start);
  const c = finite(count);
  if (s === null || c === null || c < 0 || s > nowMs || nowMs >= s + lengthMs) {
    return { start: nowMs, count: 0 };
  }
  return { start: s, count: Math.floor(c) };
}

/**
 * LIMIT-2 — decide one call.
 *
 * Both windows are rolled first, then checked (minute before day), then — if
 * allowed — both counters are incremented. A refusal returns the rolled state
 * unchanged so the caller can skip the write.
 */
export function decideRateLimit(
  state: Partial<RateLimitState> | null | undefined,
  nowMs: number,
  limits: RateLimits,
): RateLimitDecision {
  if (!Number.isFinite(nowMs)) {
    // A broken clock cannot bound anything; refuse rather than guess.
    const zero = { minuteStart: 0, minuteCount: 0, dayStart: 0, dayCount: 0 };
    return { allowed: false, next: zero, retryAfterSeconds: 60, reason: "clock" };
  }
  const minute = rollWindow(state?.minuteStart, state?.minuteCount, nowMs, MINUTE_MS);
  const day = rollWindow(state?.dayStart, state?.dayCount, nowMs, DAY_MS);
  const rolled: RateLimitState = {
    minuteStart: minute.start,
    minuteCount: minute.count,
    dayStart: day.start,
    dayCount: day.count,
  };

  const secondsUntil = (end: number) => Math.max(1, Math.ceil((end - nowMs) / 1000));

  if (minute.count >= limits.perMinute) {
    return {
      allowed: false,
      next: rolled,
      retryAfterSeconds: secondsUntil(minute.start + MINUTE_MS),
      reason: "minute",
    };
  }
  if (day.count >= limits.perDay) {
    return {
      allowed: false,
      next: rolled,
      retryAfterSeconds: secondsUntil(day.start + DAY_MS),
      reason: "day",
    };
  }
  return {
    allowed: true,
    next: { ...rolled, minuteCount: minute.count + 1, dayCount: day.count + 1 },
    retryAfterSeconds: 0,
  };
}

/*
 * LIMIT-7 — the READ window: a per-minute cap for endpoints that only read
 * the caller's own state and never reach a model or a payment provider
 * (`billingSummary`). They are kept OUT of the LIMIT-1 windows on purpose: a
 * page load or a "Finishing up…" poll must not spend a free account's daily
 * call budget, and a user who exhausted that budget chatting can still see
 * their plan. It lives in the same `rateLimits/{uid}` doc under its own two
 * fields, so it is one doc per account and goes with the account (LIMIT-6).
 */

/** LIMIT-7 — read calls per minute, every account. No daily cap. */
export const READ_RATE_LIMIT_PER_MINUTE = 30;

/** The read window's fields in `rateLimits/{uid}` (epoch ms / count). */
export type ReadRateLimitState = {
  readMinuteStart: number;
  readMinuteCount: number;
};

export type ReadRateLimitDecision = {
  allowed: boolean;
  /** The two fields to MERGE into the doc when `allowed`. */
  next: ReadRateLimitState;
  retryAfterSeconds: number;
  reason?: "minute" | "clock";
};

/** LIMIT-7 — decide one read call. Same window rules as LIMIT-2 (a missing,
 *  malformed, elapsed or future start opens a fresh window; a broken clock
 *  refuses); never touches the LIMIT-1 fields. */
export function decideReadRateLimit(
  state: Partial<ReadRateLimitState> | null | undefined,
  nowMs: number,
  perMinute: number = READ_RATE_LIMIT_PER_MINUTE,
): ReadRateLimitDecision {
  if (!Number.isFinite(nowMs)) {
    return { allowed: false, next: { readMinuteStart: 0, readMinuteCount: 0 }, retryAfterSeconds: 60, reason: "clock" };
  }
  const minute = rollWindow(state?.readMinuteStart, state?.readMinuteCount, nowMs, MINUTE_MS);
  if (minute.count >= perMinute) {
    return {
      allowed: false,
      next: { readMinuteStart: minute.start, readMinuteCount: minute.count },
      retryAfterSeconds: Math.max(1, Math.ceil((minute.start + MINUTE_MS - nowMs) / 1000)),
      reason: "minute",
    };
  }
  return {
    allowed: true,
    next: { readMinuteStart: minute.start, readMinuteCount: minute.count + 1 },
    retryAfterSeconds: 0,
  };
}
