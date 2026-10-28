import type { Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { entitlementFields, hasProEntitlement } from "./entitlement";
import {
  decideRateLimit,
  decideReadRateLimit,
  limitsFor,
  type RateLimitDecision,
  type RateLimitState,
  type ReadRateLimitState,
} from "./rateLimit";
import { PREFLIGHT_MAX_AGE_S } from "./preflightCors";

/**
 * Shared HTTP helpers, moved out of index.ts (2026-09-27) so Cloud Function
 * handler modules outside index.ts (functions/src/billing/*Handlers.ts) use
 * the SAME origin list and rate limiter instead of copies that drift.
 *
 * The rate limiter is Firestore-backed since LIMIT-1 (2026-09-29), so this
 * module imports the admin SDK; the pure pieces — the origin check and the
 * window arithmetic (`rateLimit.ts`) — are what the unit tests import.
 */

// ---------------------------------------------------------------------------
// CORS — restrict to known origins
// ---------------------------------------------------------------------------

export const ALLOWED_ORIGINS: Array<string | RegExp> = [
  "https://wurld.chat",
  "https://www.wurld.chat",
  "https://app.wurld.chat",
  "https://beta.wurld.chat",
  "https://wurld-e27d8.web.app",
  "https://wurld-e27d8.firebaseapp.com",
  "https://wurld-beta.web.app",
  "https://wurld-beta.firebaseapp.com",
  /^http:\/\/localhost(?::\d+)?$/,
  // Capacitor + emulator origins for the iOS/Android wrapper builds.
  /^https:\/\/localhost(?::\d+)?$/,           // Capacitor iOS (iosScheme: 'https')
  "capacitor://localhost",                      // Capacitor iOS default scheme
  /^http:\/\/10\.0\.2\.2(?::\d+)?$/,           // Android emulator → host dev server
  // Wurlds standalone: this app's own hosting origins, comma-separated, from
  // `functions/.env.<projectId>` (docs/setup.md), e.g.
  // ALLOWED_ORIGINS_EXTRA=https://my-project.web.app,https://wurlds.example
  ...(process.env.ALLOWED_ORIGINS_EXTRA ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
];

export function isAllowedOrigin(origin: string): boolean {
  return ALLOWED_ORIGINS.some((allowed) =>
    typeof allowed === "string" ? allowed === origin : allowed.test(origin),
  );
}

export function setCors(req: Request, res: Response): void {
  const origin = req.headers.origin ?? "";
  if (isAllowedOrigin(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  // APPCHECK-10 — `X-Firebase-AppCheck` must be advertised here or the
  // browser's preflight blocks any request carrying an attestation token
  // before this server ever sees it. (Handlers using the v2 `cors:
  // ALLOWED_ORIGINS` option reflect requested headers automatically; this
  // hand-rolled path hard-codes the list.) docs/specs/app-check.md.
  res.set(
    "Access-Control-Allow-Headers",
    // OBS-VERSION-9 — X-Wurld-Version rides every client call (the floor).
    "Content-Type, Authorization, X-Firebase-AppCheck, X-Wurld-Version",
  );
  res.set("Vary", "Origin");
  // API-GW-11 — cache the preflight answer; without it nearly every call
  // paid an extra round trip.
  res.set("Access-Control-Max-Age", String(PREFLIGHT_MAX_AGE_S));
}

// ---------------------------------------------------------------------------
// Rate limiting — LIMIT-1: durable, cross-instance, per-user.
// Spec: docs/specs/cost-limits.md.
//
// The previous limiter was a module-scope Map: one per Cloud Functions
// instance, wiped on cold start, so the effective limit was N × 30/min with N
// unknown — no limit at all (audit finding SEC-FN-6). State now lives in
// `rateLimits/{uid}` (server-only by rules, LIMIT-5) and every call is one
// transaction: one read, one write. The window arithmetic is `rateLimit.ts`.
//
// The daily cap depends on entitlement (600 free / 3000 Plus). The user doc
// is read INSIDE the transaction, and only when the free cap has been reached
// — so the common call stays at one read + one write, and a free account
// never pays for a read it cannot benefit from.
//
// A transaction failure (Firestore unavailable, contention exhausted) fails
// OPEN with a logged error: the limiter bounds spend, and a Firestore blip
// taking every endpoint down is the worse outcome. A client cannot provoke
// that failure.
// ---------------------------------------------------------------------------

/** The subset of an express `Response` the limiter needs to answer a refusal.
 *  Structural so both the v1 and the v2 handler `res` satisfy it. */
export type RateLimitResponder = {
  set: (field: string, value: string) => unknown;
  status: (code: number) => { json: (body: unknown) => unknown };
};

/**
 * LIMIT-6.1 — has this account been deleted? Asked only when `rateLimits/{uid}`
 * is ABSENT (the first call an account ever makes, or a call landing after
 * deleteAccount removed the counters), so the common call pays nothing.
 *
 * An ID token outlives its Auth record by up to an hour, so a request already
 * in flight when the account is deleted (a client's own background call, the
 * delete-account E2E caught a profile heal) would otherwise re-create the
 * usage log LIMIT-6 promises is gone. Any error other than "not found" answers
 * false: the limiter fails open (LIMIT-1).
 */
export async function accountGone(uid: string): Promise<boolean> {
  try {
    await getAuth().getUser(uid);
    return false;
  } catch (err) {
    return (err as { code?: string })?.code === "auth/user-not-found";
  }
}

/** LIMIT-6.1 — the refusal for a deleted account: no write, answered 401. */
const ACCOUNT_GONE = {
  allowed: false,
  next: { minuteStart: 0, minuteCount: 0, dayStart: 0, dayCount: 0 },
  retryAfterSeconds: 0,
  reason: "account_gone",
} as const satisfies RateLimitDecision;

/** One transaction on `rateLimits/{uid}`. Handlers call `checkRateLimit`;
 *  this is the I/O half, kept separate so the decision stays pure. */
export async function consumeRateLimit(uid: string, nowMs: number): Promise<RateLimitDecision> {
  const db = getFirestore();
  const ref = db.doc(`rateLimits/${uid}`);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists && (await accountGone(uid))) return ACCOUNT_GONE;
      const state = snap.exists ? (snap.data() as Partial<RateLimitState>) : null;
      let decision = decideRateLimit(state, nowMs, limitsFor(false));
      if (!decision.allowed && decision.reason === "day") {
        // Only now does entitlement matter. Read fresh, never memoised — a
        // trial expiring is a clock event with no write behind it.
        const userSnap = await tx.get(db.doc(`users/${uid}`));
        const entitled = hasProEntitlement(entitlementFields(userSnap.data()), nowMs);
        if (entitled) decision = decideRateLimit(state, nowMs, limitsFor(true));
      }
      if (decision.allowed) {
        // merge: the doc also holds the LIMIT-7 read window, which this must not wipe.
        tx.set(ref, { ...decision.next, updatedAt: nowMs }, { merge: true });
      }
      return decision;
    });
  } catch (err) {
    console.error(`[rateLimit] transaction failed for ${uid}; failing open`, err);
    return {
      allowed: true,
      next: { minuteStart: nowMs, minuteCount: 1, dayStart: nowMs, dayCount: 1 },
      retryAfterSeconds: 0,
    };
  }
}

/** LIMIT-7 — one transaction on the read window of `rateLimits/{uid}`.
 *  Merges its two fields only; the LIMIT-1 counters are untouched. Fails open
 *  like LIMIT-1. */
export async function consumeReadRateLimit(
  uid: string,
  nowMs: number,
): Promise<{ allowed: boolean; retryAfterSeconds: number; gone?: boolean }> {
  const db = getFirestore();
  const ref = db.doc(`rateLimits/${uid}`);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists && (await accountGone(uid))) return { allowed: false, retryAfterSeconds: 0, gone: true };
      const state = snap.exists ? (snap.data() as Partial<ReadRateLimitState>) : null;
      const decision = decideReadRateLimit(state, nowMs);
      if (decision.allowed) tx.set(ref, { ...decision.next, updatedAt: nowMs }, { merge: true });
      return decision;
    });
  } catch (err) {
    console.error(`[rateLimit] read-window transaction failed for ${uid}; failing open`, err);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/**
 * LIMIT-7 — may this user make one more READ call right now? For endpoints
 * that only read the caller's own state (`billingSummary`); they do not count
 * against the LIMIT-1 minute or day windows. Refusal is the same
 * `429 { error: "rate_limited", retryAfterSeconds }` + `Retry-After`.
 */
export async function checkReadRateLimit(uid: string, res?: RateLimitResponder): Promise<boolean> {
  const decision = await consumeReadRateLimit(uid, Date.now());
  if (decision.allowed) return true;
  if (decision.gone) {
    if (res) res.status(401).json({ error: "account_deleted" });
    return false;
  }
  console.warn(`[rateLimit] refused read for ${uid}, retry in ${decision.retryAfterSeconds}s`);
  if (res) {
    res.set("Retry-After", String(decision.retryAfterSeconds));
    res.status(429).json({ error: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds });
  }
  return false;
}

/**
 * LIMIT-1 — may this user make one more call right now?
 *
 * Counts the call. When refused and `res` is given, answers
 * `429 { error: "rate_limited", retryAfterSeconds }` with a `Retry-After`
 * header; the caller MUST then return without writing anything else.
 */
export async function checkRateLimit(uid: string, res?: RateLimitResponder): Promise<boolean> {
  return respondToRateLimit(uid, await consumeRateLimit(uid, Date.now()), res);
}

/** LIMIT-1's answer for a decision already in hand — the speculative send
 *  starts `consumeRateLimit` beside its chat read (MSG-PIPE-21.6.5). */
export function respondToRateLimit(uid: string, decision: RateLimitDecision, res?: RateLimitResponder): boolean {
  if (decision.allowed) return true;
  if (decision.reason === "account_gone") {
    if (res) res.status(401).json({ error: "account_deleted" });
    return false;
  }
  console.warn(`[rateLimit] refused ${uid}: ${decision.reason} window, retry in ${decision.retryAfterSeconds}s`);
  if (res) {
    res.set("Retry-After", String(decision.retryAfterSeconds));
    res.status(429).json({ error: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds });
  }
  return false;
}

