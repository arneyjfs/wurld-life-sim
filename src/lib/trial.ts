/**
 * LANG-TRIAL-3 — the client's half of the trial policy.
 *
 * Spec: docs/specs/language-tiers.md §5b.
 *
 * ## What is here, and why it is duplicated
 *
 * The server owns the grant: it stamps `users/{uid}.trialEndsAt` and nothing
 * else may. But two facts about that grant have to exist on the client as well,
 * because the client says them out loud before the grant is readable:
 *
 *   - the DURATION, so the sheet can promise "{duration} of everything, free"
 *     in the mode where the stamp has not happened yet;
 *   - the ENROLMENT MODE, so the sheet knows whether its button acknowledges a
 *     trial that is already running or starts one.
 *
 * They cannot be imported from `functions/src/trial.ts` — different runtime,
 * different bundle, firebase-admin at that module's import root — so they are
 * written twice and pinned together by
 * `src/lib/__tests__/trial-policy-parity.static.test.ts`, which reads both
 * files. That guard is what makes the duplication safe rather than merely
 * convenient: drift here means the app promises one length and grants another,
 * which no test on either side alone can see.
 *
 * ## Changing the policy
 *
 * LANG-TRIAL-3's promise is that changing the length is editing a NUMBER and
 * changing the mode is editing a CONSTANT. Nothing derives either from
 * anywhere else, and the UI formats the duration from the same value — so
 * `TRIAL_DURATION_MS = 7 * 24 * …` here and in the server twin is the whole
 * change, copy included.
 */
import { hasPaidPlan, isTrialling, trialEndsAtMs, type EntitlementUser } from './entitlement';
import { WEB_PLUS_PRICE } from '@/lib/billing/webPrice';

/**
 * How long a trial lasts. ⚠ Must equal `TRIAL_POLICY.durationMs` in
 * `functions/src/trial.ts`.
 */
export const TRIAL_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * How a user gets enrolled. ⚠ Must equal `TRIAL_POLICY.enrolment` in
 * `functions/src/trial.ts`.
 *
 * - `'automatic'` — stamped by the `users/{uid}` onCreate trigger. The sheet
 *   tells the user their trial is already running.
 * - `'on_accept'` — stamped by the `startTrial` endpoint when the user taps
 *   Accept. The sheet offers to start it.
 *
 * Both paths exist and are tested while only one is reachable (LANG-TRIAL-3),
 * so switching is this literal rather than a Cloud Function.
 */
export const TRIAL_ENROLMENT: 'automatic' | 'on_accept' = 'automatic';

/**
 * What Plus costs per month ON THE WEB, for this visitor's region: £2.99 or
 * €2.99 with VAT included, or $2.99 plus sales tax (billing.md BILL-MANAGE-7,
 * `src/lib/billing/webPrice.ts`).
 *
 * ⚠ Not the price on a native build. There the store sets it per storefront,
 * in local currency, and `getPlusPrice()` (`src/lib/billing/purchase.ts`) reads
 * it from StoreKit / Play; `PlusSheet`'s purchase button shows that
 * (BILL-MANAGE-5). This constant is the web answer and the prose fallback.
 *
 * ⚠ `TrialSheet` still states it as a FACT, never on a button: that sheet does
 * not sell (a test asserts no button there renders it). The purchase lives on
 * `PlusSheet`.
 */
export const PLUS_PRICE: string = WEB_PLUS_PRICE.display;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * Render a trial length as the product says it out loud.
 *
 * The unit choice is a copy decision, not a formatting one:
 *
 *   - a whole number of days, two or more → days ("7 days"). The length the
 *     owner intends to move to has to read as a week, not as 168 hours.
 *   - anything from an hour up to and including one day → hours ("24 hours").
 *     "1 day" and "24 hours" are the same offer and the hours phrasing is the
 *     one that reads as generous, so the day form deliberately does not start
 *     until two of them.
 *   - below an hour → minutes. Not a length we plan to ship, but "0 hours of
 *     everything, free" is the kind of copy that reaches a screenshot.
 *
 * A non-positive or malformed length floors at "0 minutes" rather than
 * rendering a negative offer.
 */
export function formatTrialDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return plural(0, 'minute');
  if (ms >= 2 * DAY_MS && ms % DAY_MS === 0) return plural(ms / DAY_MS, 'day');
  if (ms >= HOUR_MS) return plural(Math.round(ms / HOUR_MS), 'hour');
  return plural(Math.max(1, Math.round(ms / MINUTE_MS)), 'minute');
}

/**
 * LANG-TRIAL-9 — how much of a trial is LEFT, as the Settings row says it.
 *
 * Returns `null` when there is nothing left to render, so a caller cannot
 * accidentally print "0 minutes" for an account whose trial is over.
 *
 * ## Two decisions that look like formatting and are not
 *
 * **It floors at "less than a minute" rather than rounding to zero.** The final
 * 59 seconds of a trial are seconds in which the user can still send, and a row
 * reading "0 minutes left" next to a working composer is the app contradicting
 * itself. LANG-TRIAL-9 makes this an invariant rather than a nicety because
 * naive rounding produces it every single time.
 *
 * **It rounds DOWN everywhere else**, unlike `formatTrialDuration` above, which
 * rounds to nearest. That one describes an OFFER ("24 hours of everything,
 * free") and generosity is the right bias; this one describes a DEADLINE, where
 * promising time that has gone is the failure. 1h59m is "1 hour".
 */
export function formatTrialRemaining(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < MINUTE_MS) return 'less than a minute';
  if (ms >= DAY_MS) return plural(Math.floor(ms / DAY_MS), 'day');
  if (ms >= HOUR_MS) return plural(Math.floor(ms / HOUR_MS), 'hour');
  return plural(Math.floor(ms / MINUTE_MS), 'minute');
}

/**
 * LANG-TRIAL-9 — which of the three states an account is in, right now.
 *
 * ⚠ **Present tense, always.** There is no `'expired'` arm and there must not
 * be one: a lapsed trial is `free`, because the row states what the account IS.
 * "Was" is LANG-TRIAL-10's one-time notice, and a Settings row carrying it
 * becomes a permanent reproach on a screen people open for unrelated reasons.
 *
 * ⚠ Computed through `isTrialling` / `trialEndsAtMs` rather than by reading
 * `plan` directly, because this row is where a reader goes to find out what the
 * gates are doing (LANG-TRIAL-1). Derived any other way it becomes a confident
 * second opinion, and the bug it produces is invisible until someone is told
 * they are Pro by a screen while being refused by a send.
 */
export type TrialStanding =
  | { kind: 'pro' }
  | { kind: 'trial'; remainingMs: number }
  | { kind: 'free' };

export function trialStanding(user: EntitlementUser, nowMs: number): TrialStanding {
  if (!user || typeof user !== 'object') return { kind: 'free' };
  // BILL-ENT-2 — the BOUNDED plan: a subscription that lapsed by the clock reads
  // free at the same instant every gate stops honouring it.
  if (hasPaidPlan(user, nowMs)) return { kind: 'pro' };
  if (isTrialling(user, nowMs)) {
    const endsAt = trialEndsAtMs(user);
    // `isTrialling` already proved this readable and in the future; the
    // non-null assertion is avoided rather than asserted.
    if (endsAt !== null) return { kind: 'trial', remainingMs: endsAt - nowMs };
  }
  return { kind: 'free' };
}

// ---- "seen once" ----------------------------------------------------------
//
// LANG-TRIAL-5 says the user is TOLD; it does not say they are told every time
// they open the app. The flag lives in localStorage and is keyed by uid.
//
// Why not the user doc: `users/{uid}` is moving to a server-only field
// allowlist (LANG-SEC-1), and "I have read a sheet" is not a fact worth a
// Firestore write, a rules exemption, or a round trip on every cold boot. Why
// keyed by uid rather than device-wide (which is what `onboardingFlags.ts`
// does for the welcome and permissions walk-throughs): those are genuinely
// DEVICE facts — an OS permission grant does not follow you to another
// account. A trial belongs to an ACCOUNT, so two people sharing a phone each
// need telling, and a device-wide flag would swallow the second one's notice.
//
// Cost of the storage being unavailable (private mode, quota, a cleared
// browser): the sheet is shown again. That is the right direction to fail —
// the alternative is a user who is never told at all.

const SEEN_KEY_PREFIX = 'wurld.trial.noticeSeen.v1';

/**
 * LANG-TRIAL-10 — a SECOND, distinct key.
 *
 * ⚠ Sharing `SEEN_KEY_PREFIX` would mean every user who read the welcome sheet
 * is never told their trial ended. They are different facts about different
 * moments, and only the second one has a consequence the user has to act on.
 */
const EXPIRED_SEEN_KEY_PREFIX = 'wurld.trial.expiredSeen.v1';

const seenKey = (uid: string) => `${SEEN_KEY_PREFIX}.${uid}`;
const expiredSeenKey = (uid: string) => `${EXPIRED_SEEN_KEY_PREFIX}.${uid}`;

function readFlag(key: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* quota / private mode — the notice will simply show again next boot */
  }
}

export function trialNoticeSeen(uid: string): boolean {
  if (!uid) return false;
  return readFlag(seenKey(uid));
}

export function setTrialNoticeSeen(uid: string, value = true): void {
  if (!uid) return;
  writeFlag(seenKey(uid), value);
}

export function trialExpiredNoticeSeen(uid: string): boolean {
  if (!uid) return false;
  return readFlag(expiredSeenKey(uid));
}

export function setTrialExpiredNoticeSeen(uid: string, value = true): void {
  if (!uid) return;
  writeFlag(expiredSeenKey(uid), value);
}

// ---- when the notice is due ------------------------------------------------

type NoticeInput = {
  uid: string | null;
  /** The `users/{uid}` doc, or null while it is still loading / absent. */
  user: { plan?: unknown; trialEndsAt?: unknown; planUntil?: unknown } | null;
  loading: boolean;
  nowMs: number;
  /** Defaults to the shipped policy; injectable so both modes are testable. */
  enrolment?: 'automatic' | 'on_accept';
  seen?: boolean;
};

/**
 * Should the trial notice be shown right now? Pure, so the decision is
 * testable without mounting React or faking a clock.
 *
 * The two modes ask different questions of the same doc, and the difference is
 * the whole reason this is not just "have they seen it":
 *
 *   - `automatic` — the trial is already running, so the notice is only
 *     truthful if there IS one: a stamp must exist and still be in the future.
 *     Without that guard a grandfathered account (LANG-TRIAL-7) or a user whose
 *     onCreate trigger has not fired gets told they have a trial they do not
 *     have.
 *   - `on_accept` — the notice is the OFFER, so it is due precisely when no
 *     stamp exists. Someone already enrolled has nothing to accept
 *     (LANG-TRIAL-4: enrolment is idempotent and one-way).
 *
 * A subscriber is excluded in both modes (LANG-TRIAL-4): they were never
 * enrolled, and a sheet about a trial would misinform a paying user about why
 * they have access.
 */
export function shouldShowTrialNotice(input: NoticeInput): boolean {
  const { uid, user, loading, nowMs } = input;
  if (!uid || loading || !user) return false;
  if (input.seen ?? trialNoticeSeen(uid)) return false;
  if (hasPaidPlan(user, nowMs)) return false; // BILL-ENT-2

  // One coercion, in `entitlement.ts`. A second copy here would be a second
  // place for "what counts as a readable timestamp" to drift, and the two would
  // disagree exactly on the malformed values that matter.
  const endsAt = trialEndsAtMs(user);
  if ((input.enrolment ?? TRIAL_ENROLMENT) === 'on_accept') return endsAt === null;
  return endsAt !== null && nowMs < endsAt;
}

/**
 * LANG-TRIAL-10 — is the user owed the "your trial has ended" notice?
 *
 * LANG-TRIAL-5 tells a user their trial has STARTED and nothing told them it
 * was going to end. On a 24-hour automatic trial that means an app somebody
 * spent a day learning to rely on quietly stops translating, and the only
 * notification is a composer that has turned into an offer. This is the surface
 * that says what happened.
 *
 * ## It PARTITIONS with `shouldShowTrialNotice`, by construction
 *
 * That one requires `nowMs < endsAt`; this one requires `nowMs >= endsAt`. No
 * clock value satisfies both, so the two modals can never stack — and because
 * it is a property of the predicates rather than of mount order, it survives
 * whatever the next author does with the components. Pinned by a test that
 * walks a clock across the boundary.
 *
 * ## Three exclusions, each for a different wrong sentence
 *
 *   - **no stamp** — nothing expired. Telling somebody their trial ended when
 *     they never had one is worse than saying nothing.
 *   - **`plan: 'pro'`** — a subscriber, and a grandfathered account
 *     (LANG-TRIAL-7 backfills those to `'pro'` outright). Both would be told the
 *     wrong reason for the access they have.
 *   - **already dismissed** — per ACCOUNT, under the distinct key above.
 */
export function shouldShowTrialExpiredNotice(input: NoticeInput): boolean {
  const { uid, user, loading, nowMs } = input;
  if (!uid || loading || !user) return false;
  if (input.seen ?? trialExpiredNoticeSeen(uid)) return false;
  // ⚠ Deliberately the raw FIELD, not the bounded `hasPaidPlan`: a subscriber
  // whose plan lapsed by the clock must not be told "your TRIAL has ended" —
  // that is the wrong sentence for what happened to them (billing.md, Design
  // decisions: the lapsed-subscriber notice belongs to the billing UI).
  if (user.plan === 'pro') return false;

  const endsAt = trialEndsAtMs(user);
  if (endsAt === null || !Number.isFinite(nowMs)) return false;
  return nowMs >= endsAt;
}

/**
 * LANG-TRIAL-8 — should this client ASK the server to enrol them?
 *
 * In `automatic` mode the `users/{uid}` onCreate trigger normally grants the
 * trial and the client does nothing. That breaks in beta, and the way it breaks
 * is a closed loop rather than an error:
 *
 *   a Firestore trigger deployed to `wurld-beta` watches beta's OWN (empty)
 *   database and never fires -> no trial -> `shouldShowTrialNotice` is false ->
 *   the sheet never renders -> nothing calls `startTrial` -> still no trial.
 *
 * So the feature is untestable in the environment it exists to be tested in,
 * and nothing anywhere reports a problem. The client asking closes the loop,
 * because HTTP functions in beta DO reach prod's data (`firebaseConfig.ts`
 * re-points the Admin SDK; a trigger's resource cannot be re-pointed).
 *
 * ⚠ The client only ever ASKS. `decideTrialEnrolment` on the server decides,
 * and LANG-TRIAL-4 makes a repeat call a no-op — so this can be wrong about
 * eligibility without granting anybody anything. It is a prompt, not a grant.
 */
export type EnrolmentInput = {
  uid: string | null | undefined;
  user: { plan?: unknown; trialEndsAt?: unknown; planUntil?: unknown; planProjectedAt?: unknown } | null | undefined;
  loading: boolean;
  nowMs: number;
  enrolment?: 'automatic' | 'on_accept';
};

export function needsTrialEnrolment(input: EnrolmentInput): boolean {
  const { uid, user, loading } = input;
  if (!uid || loading || !user) return false;
  // In on_accept mode the USER asks, by tapping. An automatic call there would
  // grant a trial nobody opted into, which is the entire distinction the mode
  // encodes.
  if ((input.enrolment ?? TRIAL_ENROLMENT) !== 'automatic') return false;
  // BILL-ENT-2 — a live subscriber has nothing to be granted; a lapsed one is
  // treated like any unstamped account (the server decides, LANG-TRIAL-4).
  if (hasPaidPlan(user, input.nowMs)) return false;
  // LANG-TRIAL-4.1 — an account any grant was ever projected onto is refused
  // `had_plan` by the server (functions/src/trial.ts); presence only.
  if (user.planProjectedAt !== undefined && user.planProjectedAt !== null) return false;
  // Present at all — expired included. Enrolment is one-way (LANG-TRIAL-4), so
  // asking again could only ever be refused, and asking on every app open for
  // the rest of a user's life is a request per launch forever.
  return trialEndsAtMs(user) === null;
}
