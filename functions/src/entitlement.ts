/**
 * LANG-TRIAL-1 — ENTITLEMENT, not plan, is what every gate reads.
 *
 * Spec: docs/specs/language-tiers.md §5b (and §6 LANG-SEC-2).
 *
 * Every tier rule in this codebase used to ask one question — "does this member
 * subscribe?" — and answer it from a single field. A trial makes the answer
 * time-dependent, so this module REPLACES that question rather than adding a
 * case to it:
 *
 *     entitled  ⇔  plan === 'pro'  OR  now < trialEndsAt
 *
 * `plan` keeps its old meaning — *what this user pays for* — and stops being
 * the thing gates consult. The distinction matters at exactly one place and
 * matters a lot there: a trialist must pass every gate and must not be counted
 * as revenue.
 *
 * ## Why a timestamp rather than a status
 *
 * LANG-TRIAL-2. The rejected alternative was stamping `plan: 'pro'` for 24
 * hours and having a scheduled job put it back. A grant that expires only when
 * a job runs is a grant that **never expires when the job fails** — a missed
 * sweep, a failed deploy or a paused scheduler hands out free Pro forever, and
 * nothing in the product would look wrong. A timestamp cannot fail that way:
 * expiry is a property of the clock, so there is no job to fail.
 *
 * That is also why `nowMs` is a REQUIRED parameter and there is no `Date.now()`
 * in this file. The boundary is testable only if the caller owns the clock, and
 * the same argument threads a single consistent instant through a whole pass
 * over a chat's members — otherwise two members of one room could be evaluated
 * against two different "now"s.
 *
 * ## Fail closed, everywhere
 *
 * LANG-SEC-2. `plan` is absent on most user docs and `trialEndsAt` is absent on
 * all of them today, so the absent case IS the common case. Every unknown,
 * malformed, wrong-typed or unreadable value resolves to NO entitlement. One
 * fail-open shape here would quietly hand the paid product to the entire user
 * base while looking exactly like the gate working.
 *
 * ⚠ **No firebase-admin import, deliberately.** This module is imported by the
 * pure helpers the vitest `functions` project runs directly (see the note at
 * the top of `memberKeys.ts`), so a `Timestamp` is recognised by DUCK TYPING —
 * "has a callable `toMillis`" — rather than by `instanceof`. That also makes it
 * robust to the admin-SDK proxying that MSG-TEST-1 documents, where the
 * namespaced statics are not the objects you expect.
 */

/** The user-doc fields entitlement is computed from. All deliberately
 *  `unknown`: they come off `snap.data()`, which promises nothing. */
export type EntitlementUser = {
  /** What this user PAYS for. Not the gate — see `hasProEntitlement`. */
  plan?: unknown;
  /** LANG-TRIAL-2 — written once at enrolment, never cleared. */
  trialEndsAt?: unknown;
  /** BILL-ENT-2 — the clock bound on `plan`, written by the billing projection
   *  (`functions/src/billing/store.ts`). ABSENT or `null` means unbounded —
   *  which is what keeps every grandfathered `plan: 'pro'` doc meaning what it
   *  meant (LANG-TRIAL-7). Present-but-unreadable fails CLOSED. */
  planUntil?: unknown;
};

/**
 * BILL-ENT-2 — the three entitlement fields off a user doc, and nothing else.
 *
 * ⚠ Every server site that used to hand-pick `{ plan, trialEndsAt }` goes
 * through this instead. A pick that forgets `planUntil` does not fail — it
 * silently turns an expired subscription into unbounded Plus, which is the
 * fail-OPEN shape LANG-SEC-2 exists to rule out. A static test
 * (`billing/__tests__/billingWiring.static.test.ts`) refuses the old literal.
 */
export function entitlementFields(
  data: Record<string, unknown> | null | undefined,
): EntitlementUser | null {
  if (!data || typeof data !== "object") return null;
  return { plan: data.plan, trialEndsAt: data.trialEndsAt, planUntil: data.planUntil };
}

/**
 * Does this `plan` value mean a paid subscription?
 *
 * Only the exact string. The pre-existing cosmetic helpers fail OPEN —
 * `planToBadgeLabel` maps `undefined` to 'Pro' — which is defensible for a
 * badge and catastrophic for a decision. This is deliberately its own
 * predicate rather than a reuse of those (LANG-SEC-2). The admin broadcast
 * filter that used to read `(d.plan ?? "pro")` now asks the entitlement
 * (`matchesPlanFilter`, BROADCAST-8).
 *
 * ⚠ This answers about MONEY. A trialist returns false here and true from
 * `hasProEntitlement`, and every GATE wants the latter.
 */
export function isProPlan(plan: unknown): boolean {
  return plan === "pro";
}

/**
 * Read a `trialEndsAt` field as milliseconds, or null if it is not a time.
 *
 * Three shapes are accepted because three shapes genuinely occur:
 *   - a Firestore `Timestamp` — what `snap.data()` returns in production;
 *   - a number of milliseconds — what a decision function produces, and what a
 *     fixture or a JSON round-trip through a Cloud Function body looks like;
 *   - a `Date` — what a hand-written admin write or a test tends to reach for.
 *
 * Everything else is null, including the two shapes most likely to be mistaken
 * for a time: an ISO STRING and a plain `{ seconds, nanoseconds }` object. The
 * second is what a Timestamp becomes after `JSON.stringify`, so it is exactly
 * what would arrive if a trial stamp ever travelled through an HTTP body — and
 * silently treating it as a time would mean reading a field whose units nobody
 * checked.
 */
export function trialEndsAtMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const finite = (n: unknown): number | null =>
    typeof n === "number" && Number.isFinite(n) ? n : null;

  if (typeof value === "number") return finite(value);
  if (value instanceof Date) return finite(value.getTime());

  if (typeof value === "object") {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") {
      try {
        return finite((toMillis as () => unknown).call(value));
      } catch {
        // A half-deserialised doc must produce a denied gate, not a 500 on
        // send. There is nothing useful to log here — the caller's own
        // fail-closed answer is the whole response.
        return null;
      }
    }
  }
  return null;
}

/**
 * BILL-ENT-2 — `planUntil` as milliseconds; `null` for ABSENT or `null` (both
 * mean "no bound"), and `NaN` for a value that is present but not a time.
 *
 * The distinction matters and is the whole reason this is not `trialEndsAtMs`:
 * for a trial, unreadable and absent both mean "no trial" (closed). For a plan
 * bound, absent means UNBOUNDED — so an unreadable bound must not collapse into
 * absent, or junk in the field would read as lifetime Plus. `NaN` compares
 * false against every clock, which is exactly the closed answer.
 */
export function planUntilMs(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const ms = trialEndsAtMs(value);
  return ms === null ? Number.NaN : ms;
}

/**
 * BILL-ENT-2 — is this user PAYING right now? `plan === 'pro'` AND (no bound OR
 * `now < planUntil`), strict, fail-closed.
 *
 * This is the "money" half of `hasProEntitlement`, with the clock applied. The
 * places that ask "is this a subscriber rather than a trialist" (trial
 * enrolment, the trial-warning sweep) ask this, so a subscription that lapsed
 * by the clock stops counting as paying at the same instant it stops
 * entitling. `isProPlan` stays the raw FIELD test for labelling and counting.
 */
export function hasPaidPlan(user: EntitlementUser | null | undefined, nowMs: number): boolean {
  if (!user || typeof user !== "object") return false;
  if (!isProPlan(user.plan)) return false;
  const until = planUntilMs(user.planUntil);
  if (until === null) return true;
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return false;
  return nowMs < until;
}

/**
 * LANG-TRIAL-1 — does this member hold the paid entitlement right now?
 *
 *     entitled ⇔ (plan === 'pro' AND (planUntil absent/null OR now < planUntil))
 *                OR now < trialEndsAt                         (BILL-ENT-2)
 *
 * The one question every gate asks: `paidLanguageSet`, `evaluateSendGate`,
 * `deriveLanguageGate`, and their client-side counterparts.
 *
 * The boundary is STRICT: a trial ending exactly at `nowMs` is over. That is
 * not a coin flip — it is what makes a zero-duration policy grant nothing
 * rather than an instant of access, and it keeps "ends at T" meaning the same
 * thing as every other half-open interval in the pipeline.
 *
 * A non-finite `nowMs` (a broken clock) denies, like everything else unknown.
 */
export function hasProEntitlement(
  user: EntitlementUser | null | undefined,
  nowMs: number,
): boolean {
  if (!user || typeof user !== "object") return false;
  // BILL-ENT-2 — `plan` now carries a clock bound. Absent = unbounded, so every
  // pre-billing doc answers exactly as before.
  if (hasPaidPlan(user, nowMs)) return true;

  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return false;
  const endsAt = trialEndsAtMs(user.trialEndsAt);
  return endsAt !== null && nowMs < endsAt;
}

/**
 * BROADCAST-8 — does a user doc match an admin broadcast `filters.plan`?
 * `"pro"` = holds Plus now (subscription or trial, BILL-ENT-2); `"free"` =
 * everyone else; anything else matches nobody. Replaces the fail-open
 * `(d.plan ?? "pro")` read, which put every doc with no `plan` field (most
 * free users, every trialist) in the Plus audience.
 */
export function matchesPlanFilter(
  data: Record<string, unknown> | null | undefined,
  filter: unknown,
  nowMs: number,
): boolean {
  const entitled = hasProEntitlement(entitlementFields(data ?? {}), nowMs);
  if (filter === "pro") return entitled;
  if (filter === "free") return !entitled;
  return false;
}
