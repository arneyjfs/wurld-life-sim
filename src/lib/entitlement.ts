/**
 * LANG-TRIAL-1 — ENTITLEMENT, not plan, is what every gate reads.
 *
 * Spec: docs/specs/language-tiers.md §5b.
 *
 * ## Why this replaces the question rather than adding a case to it
 *
 * Every tier rule in the spec asks one thing — "does this member subscribe?" —
 * and until the trial existed the answer was a single field. A trial makes the
 * answer TIME-DEPENDENT. A codebase that answers it in two shapes ("`plan ===
 * 'pro'` here, `plan === 'pro' || trialling` there") has a slow leak: every new
 * gate is a coin flip about which shape its author copied, and the ones that
 * get it wrong lock a trialling user out of a feature they were just promised,
 * silently. So `plan` keeps its old meaning — *what this user pays for* — and
 * stops being the thing gates consult.
 *
 * ## Why the trial is a clock read and not a status
 *
 * LANG-TRIAL-2: `trialEndsAt` is written once, server-side, and never cleared.
 * The rejected alternative was stamping `plan: 'pro'` for the duration and
 * having a scheduled job put it back — a grant that expires only when a job
 * runs is a grant that never expires when the job fails, and nothing in the
 * product would look wrong while it handed out free Pro forever. Computing
 * against the clock cannot fail that way, and the cost is that every caller
 * must supply the clock.
 *
 * ## `nowMs` is required on purpose
 *
 * No `Date.now()` in here. Two callers in the same render must agree, the
 * boundary case (a trial ending exactly now) has to be testable without faking
 * timers, and a hidden clock is what turns "is this user entitled" into a
 * question with no reproducible answer.
 *
 * ## It fails CLOSED (LANG-SEC-2)
 *
 * `plan` arrives through a `.passthrough()` Zod schema, so "a string that isn't
 * 'pro'" is not the only shape either field can take, and `trialEndsAt` may be
 * a Firestore `Timestamp`, a `Date` or an epoch number depending on whether it
 * came from the SDK, a local write, or a test. Anything else — absent,
 * malformed, a string, an object with a throwing `toMillis` — resolves to NOT
 * entitled.
 *
 * ## ⚠ There is a server twin, and it is the enforcement
 *
 * `functions/src/entitlement.ts` answers the same question for
 * `evaluateSendGate` / `paidLanguageSet` / `deriveLanguageGate`. The two cannot
 * import from each other (different runtimes), so they are written twice and
 * must agree — including on the `<` boundary below. This copy decides what to
 * RENDER; the server's decides what happens.
 */

/**
 * The fields an entitlement decision reads off a user doc. `planUntil` is the
 * BILL-ENT-2 clock bound on `plan` (docs/specs/billing.md): absent or `null`
 * means unbounded, present-but-unreadable fails closed.
 */
export type EntitlementUser =
  | { plan?: unknown; trialEndsAt?: unknown; planUntil?: unknown }
  | null
  | undefined;

/**
 * Coerce the three shapes `trialEndsAt` legitimately arrives in to epoch ms,
 * and everything else to `null`.
 *
 * Feature-detected on `.toMillis()` rather than `instanceof Timestamp`: the
 * firebase type would drag the SDK into a module that is otherwise pure, and
 * `instanceof` is unreliable across the duplicated-module boundary anyway (a
 * Timestamp from a differently-resolved copy of `firebase/firestore` fails the
 * check while being, in every way that matters here, a Timestamp).
 */
function toMillis(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    const fn = (value as { toMillis: unknown }).toMillis;
    if (typeof fn !== 'function') return null;
    try {
      const ms: unknown = fn.call(value);
      return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
    } catch {
      // A hostile or half-constructed object is not an entitlement. Swallowing
      // it here rather than letting it escape keeps a bad user doc from
      // blanking the screen that asked the question.
      return null;
    }
  }
  return null;
}

/**
 * BILL-ENT-2 — is this user PAYING right now? `plan === 'pro'` AND (no bound OR
 * `nowMs < planUntil`).
 *
 * ⚠ An ABSENT (or `null`) `planUntil` is unbounded — that is what keeps every
 * grandfathered `plan: 'pro'` doc meaning what it always meant. A PRESENT value
 * that is not a readable time is NOT treated as absent: that would turn junk in
 * the field into lifetime Plus. It fails closed, as the server twin does.
 */
export function hasPaidPlan(user: EntitlementUser, nowMs: number): boolean {
  if (!user || typeof user !== 'object' || user.plan !== 'pro') return false;
  if (user.planUntil === undefined || user.planUntil === null) return true;
  const until = toMillis(user.planUntil);
  if (until === null || !Number.isFinite(nowMs)) return false;
  return nowMs < until;
}

/**
 * Does this user have the paid entitlement right now? LANG-TRIAL-1.
 *
 * (`plan === 'pro'` AND `nowMs < planUntil` when bounded — BILL-ENT-2) OR
 * `nowMs < trialEndsAt`.
 *
 * ⚠ The comparison is strictly `<`: a trial ending exactly now is over. The
 * side chosen matters less than that both copies choose the same one — the
 * server twin uses `<` too, and a disagreement leaves a user entitled on one
 * machine and not the other for the width of a clock tick.
 */
export function hasProEntitlement(user: EntitlementUser, nowMs: number): boolean {
  if (!user || typeof user !== 'object') return false;
  if (hasPaidPlan(user, nowMs)) return true;
  const endsAt = toMillis(user.trialEndsAt);
  if (endsAt === null || !Number.isFinite(nowMs)) return false;
  return nowMs < endsAt;
}

/** Is this user inside a trial specifically (rather than entitled by paying)? */
export function isTrialling(user: EntitlementUser, nowMs: number): boolean {
  if (!user || typeof user !== 'object' || hasPaidPlan(user, nowMs)) return false;
  const endsAt = toMillis(user.trialEndsAt);
  return endsAt !== null && Number.isFinite(nowMs) && nowMs < endsAt;
}

/** `trialEndsAt` as epoch ms, or `null` when absent / unreadable. */
export function trialEndsAtMs(user: EntitlementUser): number | null {
  if (!user || typeof user !== 'object') return null;
  return toMillis(user.trialEndsAt);
}
