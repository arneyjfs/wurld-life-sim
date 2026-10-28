// @vitest-environment jsdom
/**
 * LANG-TRIAL-3 — the duration and the enrolment mode are policy, in one place.
 *
 * Spec: docs/specs/language-tiers.md §5b.
 *
 * The spec's promise is that changing the trial length is editing a NUMBER and
 * changing the enrolment mode is editing a CONSTANT — nothing derives either
 * from anywhere else, and the UI formats the duration from the same value it
 * is granted from. These tests are what makes that promise checkable: the
 * formatter is exercised at the length we ship today AND at the length the
 * owner has already said they intend to move to.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PLUS_PRICE,
  TRIAL_DURATION_MS,
  TRIAL_ENROLMENT,
  formatTrialDuration,
  formatTrialRemaining,
  setTrialExpiredNoticeSeen,
  setTrialNoticeSeen,
  shouldShowTrialExpiredNotice,
  shouldShowTrialNotice,
  trialExpiredNoticeSeen,
  trialNoticeSeen,
  trialStanding,
  needsTrialEnrolment,
} from './trial';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('the policy constants', () => {
  // ⚠ These assert PROPERTIES, not the current values, and that is deliberate.
  // LANG-TRIAL-3's whole promise is that changing the duration or the mode is
  // editing one constant. A test reading `toBe(24 * 60 * 60 * 1000)` quietly
  // breaks that promise — it makes a one-constant change a three-file change,
  // and it restates the source rather than checking anything. Agreement between
  // client and server is owned by `trial-policy-parity.static.test.ts`; what is
  // left worth guarding here is that the value is SANE.
  it('LANG-TRIAL-3 — the duration is a plausible trial length', () => {
    // Catches a fat-fingered 0, a negative, or milliseconds-vs-seconds confusion
    // (24 * 60 * 60 without the 1000 is 86 seconds) — without pinning the number.
    expect(TRIAL_DURATION_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(TRIAL_DURATION_MS).toBeLessThanOrEqual(90 * 24 * 60 * 60 * 1000);
    expect(Number.isInteger(TRIAL_DURATION_MS)).toBe(true);
  });

  it('LANG-TRIAL-3 — enrolment is one of the two modes the code implements', () => {
    // Both paths are built and tested (LANG-TRIAL-3), so either value is a
    // valid shipping state. What must never happen is a third string, which
    // would make `decideTrialEnrolment` refuse every caller as `wrong_mode`
    // and silently grant nobody a trial at all.
    expect(['automatic', 'on_accept']).toContain(TRIAL_ENROLMENT);
  });

  it('the price is stated, and stated as a price rather than as a promise', () => {
    // The sheet NAMES this (LANG-TRIAL-5) so a user learns what happens after
    // the trial. It must not read like something they are being asked to do:
    // nothing in this build can take a payment.
    expect(PLUS_PRICE).toMatch(/^\$\d/);
  });
});

describe('formatTrialDuration — reads well at both lengths the product plans on', () => {
  it.each([
    ['1 hour', HOUR, '1 hour'],
    ['24 hours — today’s value', DAY, '24 hours'],
    ['48 hours — the whole-day case that must not say "2 days"… or must', 2 * DAY, '2 days'],
    ['7 days — the length the owner intends to move to', 7 * DAY, '7 days'],
  ])('%s', (_label, ms, expected) => {
    expect(formatTrialDuration(ms)).toBe(expected);
  });

  it('formats the shipped constant without the caller doing arithmetic', () => {
    // The UI passes TRIAL_DURATION_MS straight through. If this ever needed a
    // conversion at the call site, the "one place" promise would be broken.
    //
    // Asserts the SHAPE, not the string: the exact words follow whatever the
    // constant currently is, and pinning them here would make changing the
    // duration edit a test that is only restating the constant. What must hold
    // is that the output is human — never raw milliseconds leaking into copy.
    expect(formatTrialDuration(TRIAL_DURATION_MS)).toMatch(/^\d+ (minute|hour|day)s?$/);
    expect(formatTrialDuration(TRIAL_DURATION_MS)).not.toMatch(/\d{5}/);
  });

  it('singular and plural are both correct', () => {
    expect(formatTrialDuration(HOUR)).toBe('1 hour');
    expect(formatTrialDuration(2 * HOUR)).toBe('2 hours');
    expect(formatTrialDuration(DAY)).toBe('24 hours');
    expect(formatTrialDuration(DAY * 1)).not.toContain('days');
    expect(formatTrialDuration(3 * DAY)).toBe('3 days');
  });

  it('a sub-hour duration degrades to minutes rather than to "0 hours"', () => {
    // Not a length we plan to ship, but "0 hours of everything, free" is the
    // kind of copy that reaches a screenshot, so it is pinned rather than left
    // to whatever Math.round happened to do.
    expect(formatTrialDuration(30 * 60 * 1000)).toBe('30 minutes');
    expect(formatTrialDuration(60 * 1000)).toBe('1 minute');
  });

  it('a non-positive or malformed duration never renders a negative offer', () => {
    expect(formatTrialDuration(0)).toBe('0 minutes');
    expect(formatTrialDuration(-1)).toBe('0 minutes');
    expect(formatTrialDuration(Number.NaN)).toBe('0 minutes');
  });
});

describe('the sub-day / multi-day boundary', () => {
  it('stays in hours right up to a full day and switches at 48h', () => {
    // The switch is at >= 2 days on purpose: "1 day" and "24 hours" are the
    // same offer, and the hours phrasing is the one that reads as generous.
    expect(formatTrialDuration(23 * HOUR)).toBe('23 hours');
    expect(formatTrialDuration(DAY)).toBe('24 hours');
    expect(formatTrialDuration(DAY + HOUR)).toBe('25 hours');
    expect(formatTrialDuration(2 * DAY)).toBe('2 days');
  });
});

describe('LANG-TRIAL-5 — the notice is seen once, per ACCOUNT', () => {
  beforeEach(() => localStorage.clear());

  it('starts unseen and flips', () => {
    expect(trialNoticeSeen('u1')).toBe(false);
    setTrialNoticeSeen('u1');
    expect(trialNoticeSeen('u1')).toBe(true);
  });

  it('one account’s dismissal does not silence another’s', () => {
    // Two people on one device each need telling. This is why the flag is
    // keyed by uid rather than being device-wide like the onboarding flags.
    setTrialNoticeSeen('u1');
    expect(trialNoticeSeen('u2')).toBe(false);
  });

  it('an empty uid is never "seen" and never written', () => {
    setTrialNoticeSeen('');
    expect(trialNoticeSeen('')).toBe(false);
    expect(localStorage.length).toBe(0);
  });
});

describe('shouldShowTrialNotice — who is due the notice', () => {
  const NOW = 1_700_000_000_000;
  const base = {
    uid: 'u1',
    loading: false,
    nowMs: NOW,
    seen: false,
  } as const;

  beforeEach(() => localStorage.clear());

  describe('automatic mode — the trial is already running', () => {
    const auto = (user: Record<string, unknown> | null) =>
      shouldShowTrialNotice({ ...base, user, enrolment: 'automatic' });

    it('shows to a user with a live stamp', () => {
      expect(auto({ trialEndsAt: NOW + 1 })).toBe(true);
    });

    it('LANG-TRIAL-4 — never to a subscriber', () => {
      expect(auto({ plan: 'pro', trialEndsAt: NOW + 1 })).toBe(false);
    });

    it('does not announce a trial that was never granted', () => {
      // A grandfathered account (LANG-TRIAL-7) or one whose onCreate trigger
      // has not fired. "You've got 24 hours of everything, free" is false.
      expect(auto({})).toBe(false);
      expect(auto({ plan: 'free' })).toBe(false);
    });

    it('does not announce a trial that has already expired', () => {
      expect(auto({ trialEndsAt: NOW - 1 })).toBe(false);
      expect(auto({ trialEndsAt: NOW })).toBe(false);
    });
  });

  describe('on_accept mode — the notice IS the offer', () => {
    const onAccept = (user: Record<string, unknown> | null) =>
      shouldShowTrialNotice({ ...base, user, enrolment: 'on_accept' });

    it('shows to a user who has no stamp yet', () => {
      expect(onAccept({ plan: 'free' })).toBe(true);
    });

    it('LANG-TRIAL-4 — not to someone already enrolled, live or expired', () => {
      // Enrolment is idempotent and one-way: there is no second trial to offer.
      expect(onAccept({ trialEndsAt: NOW + 1 })).toBe(false);
      expect(onAccept({ trialEndsAt: NOW - 1 })).toBe(false);
    });

    it('LANG-TRIAL-4 — never to a subscriber', () => {
      expect(onAccept({ plan: 'pro' })).toBe(false);
    });
  });

  describe('the cases both modes share', () => {
    it('stays away while the profile is loading or absent', () => {
      expect(shouldShowTrialNotice({ ...base, user: null, loading: true })).toBe(false);
      expect(shouldShowTrialNotice({ ...base, user: null, loading: false })).toBe(false);
    });

    it('stays away when signed out', () => {
      expect(shouldShowTrialNotice({ ...base, uid: null, user: { trialEndsAt: NOW + 1 } }))
        .toBe(false);
    });

    it('stays away once seen', () => {
      expect(
        shouldShowTrialNotice({ ...base, user: { trialEndsAt: NOW + 1 }, seen: true }),
      ).toBe(false);
    });

    it('reads the persisted flag when `seen` is not supplied', () => {
      const user = { trialEndsAt: NOW + 1 };
      const call = () => shouldShowTrialNotice({ uid: 'u1', user, loading: false, nowMs: NOW });
      expect(call()).toBe(true);
      setTrialNoticeSeen('u1');
      expect(call()).toBe(false);
    });

    it('defaults to the shipped enrolment mode when none is given', () => {
      // The call sites pass no mode. If the default ever stopped tracking
      // TRIAL_ENROLMENT, the sheet would offer a trial to somebody who already
      // has one (or acknowledge one nobody was given).
      const stamped = { trialEndsAt: NOW + 1 };
      const unstamped = { plan: 'free' };
      const due = TRIAL_ENROLMENT === 'automatic' ? stamped : unstamped;
      expect(shouldShowTrialNotice({ uid: 'u1', user: due, loading: false, nowMs: NOW }))
        .toBe(true);
    });
  });
});

/**
 * LANG-TRIAL-8 — should this client ASK the server to enrol them?
 *
 * In `automatic` mode the trigger normally does this and the client does
 * nothing. But a Firestore trigger deployed to `wurld-beta` watches beta's own
 * empty database and never fires, so in beta the loop is closed: no trigger ->
 * no trial -> `shouldShowTrialNotice` stays false -> the sheet never renders ->
 * nothing calls `startTrial` -> still no trial. The feature is untestable in
 * the environment it is meant to be tested in.
 *
 * So the client asks. The server decides (LANG-TRIAL-4 makes a repeat call a
 * no-op), which keeps the client's job to "prompt", never "grant".
 */
describe('needsTrialEnrolment — LANG-TRIAL-8', () => {
  const NOW = 1_700_000_000_000;
  const base = { uid: 'u1', loading: false, nowMs: NOW, enrolment: 'automatic' as const };

  it('a brand-new user with no plan and no trial should ask', () => {
    expect(needsTrialEnrolment({ ...base, user: {} })).toBe(true);
  });

  it('a user who already HAS a trial does not ask again', () => {
    // Even an expired one: enrolment is one-way (LANG-TRIAL-4), so asking
    // could only ever be refused.
    expect(needsTrialEnrolment({ ...base, user: { trialEndsAt: NOW + 1000 } })).toBe(false);
    expect(needsTrialEnrolment({ ...base, user: { trialEndsAt: NOW - 1000 } })).toBe(false);
  });

  it('LANG-TRIAL-4.1 — an account that has ever been projected (a lapsed subscriber) does not ask', () => {
    // The server refuses it with `had_plan`; asking would be a refused request
    // on every launch for the rest of the account's life.
    expect(needsTrialEnrolment({ ...base, user: { plan: 'free', planProjectedAt: { toMillis: () => NOW } } })).toBe(false);
    expect(needsTrialEnrolment({ ...base, user: { planProjectedAt: null } })).toBe(true);
  });

  it('a subscriber does not ask', () => {
    expect(needsTrialEnrolment({ ...base, user: { plan: 'pro' } })).toBe(false);
  });

  it('does not ask before the profile has loaded', () => {
    // Asking on a half-loaded profile would fire on every cold start for a
    // user who already has a trial, which is a request per app open forever.
    expect(needsTrialEnrolment({ ...base, user: undefined, loading: true })).toBe(false);
    expect(needsTrialEnrolment({ ...base, user: undefined, loading: false })).toBe(false);
  });

  it('does not ask without a uid', () => {
    expect(needsTrialEnrolment({ ...base, uid: null, user: {} })).toBe(false);
  });

  it('in on_accept mode the USER asks, never the app', () => {
    // The whole point of that mode. An automatic call there would grant a trial
    // nobody opted into.
    expect(needsTrialEnrolment({ ...base, enrolment: 'on_accept', user: {} })).toBe(false);
  });
});

// ─── The end of the trial ────────────────────────────────────────────────────

describe('LANG-TRIAL-9 — formatTrialRemaining never contradicts the app', () => {
  it('LANG-TRIAL-9 — a still-live trial never reads as zero', () => {
    // THE assertion of this helper. "0 minutes left" on an account that can
    // still send is the Settings row calling the composer a liar, and naive
    // rounding produces it for the whole final half-minute.
    expect(formatTrialRemaining(1)).toBe('less than a minute');
    expect(formatTrialRemaining(29 * 1000)).toBe('less than a minute');
    expect(formatTrialRemaining(59 * 1000)).toBe('less than a minute');
  });

  it('LANG-TRIAL-9 — an elapsed trial has no remaining time to render', () => {
    expect(formatTrialRemaining(0)).toBeNull();
    expect(formatTrialRemaining(-1)).toBeNull();
    expect(formatTrialRemaining(Number.NaN)).toBeNull();
  });

  it('LANG-TRIAL-9 — rounds DOWN, so it never promises time that is gone', () => {
    // 1h59m is "1 hour", not "2 hours". Rounding up would have the row still
    // saying "2 hours" a minute after the push said the same thing.
    expect(formatTrialRemaining(2 * HOUR - 60 * 1000)).toBe('1 hour');
    expect(formatTrialRemaining(2 * HOUR)).toBe('2 hours');
    expect(formatTrialRemaining(DAY + 23 * HOUR)).toBe('1 day');
    expect(formatTrialRemaining(3 * DAY)).toBe('3 days');
    expect(formatTrialRemaining(90 * 1000)).toBe('1 minute');
  });
});

describe('LANG-TRIAL-9 — trialStanding is what the gates see', () => {
  const now = 1_000_000;

  it('LANG-TRIAL-9 — a subscriber reads as pro even mid-trial', () => {
    expect(trialStanding({ plan: 'pro' }, now)).toEqual({ kind: 'pro' });
    expect(trialStanding({ plan: 'pro', trialEndsAt: now + HOUR }, now)).toEqual({ kind: 'pro' });
  });

  it('LANG-TRIAL-9 — a live trial carries its remaining time', () => {
    expect(trialStanding({ trialEndsAt: now + 3 * HOUR }, now)).toEqual({
      kind: 'trial',
      remainingMs: 3 * HOUR,
    });
  });

  it('LANG-TRIAL-9 — present tense only: a lapsed trial reads FREE', () => {
    // Not "expired". The row says what the account IS; "was" belongs to the
    // one-time notice (LANG-TRIAL-10), and a permanent reproach on the Settings
    // screen is a different product decision nobody made.
    expect(trialStanding({ trialEndsAt: now - 1 }, now)).toEqual({ kind: 'free' });
    expect(trialStanding({}, now)).toEqual({ kind: 'free' });
    expect(trialStanding(null, now)).toEqual({ kind: 'free' });
  });

  it('LANG-TRIAL-9 — fails closed on junk, exactly as the gates do', () => {
    expect(trialStanding({ trialEndsAt: 'tomorrow' }, now)).toEqual({ kind: 'free' });
    expect(trialStanding({ plan: 'PRO' }, now)).toEqual({ kind: 'free' });
  });
});

describe('LANG-TRIAL-10 — the lapse is announced once', () => {
  beforeEach(() => localStorage.clear());

  const base = {
    uid: 'u1',
    loading: false,
    nowMs: 1_000_000,
  };

  it('LANG-TRIAL-10 — due for a user whose stamp is in the past', () => {
    expect(shouldShowTrialExpiredNotice({
      ...base, user: { trialEndsAt: base.nowMs - 1 },
    })).toBe(true);
  });

  it('LANG-TRIAL-10 — never for an account that never had a trial', () => {
    // No stamp means nothing expired. Telling somebody their trial ended when
    // they never had one is worse than saying nothing.
    expect(shouldShowTrialExpiredNotice({ ...base, user: {} })).toBe(false);
  });

  it('LANG-TRIAL-10 — never for a subscriber, grandfathered included', () => {
    // LANG-TRIAL-7 accounts are plan:'pro' outright, so this one check covers
    // them and anyone who actually pays. Both would be told the wrong reason
    // for their access.
    expect(shouldShowTrialExpiredNotice({
      ...base, user: { plan: 'pro', trialEndsAt: base.nowMs - 1 },
    })).toBe(false);
  });

  it('LANG-TRIAL-10 — not while the trial is still running', () => {
    expect(shouldShowTrialExpiredNotice({
      ...base, user: { trialEndsAt: base.nowMs + 1 },
    })).toBe(false);
  });

  it('LANG-TRIAL-10 — decides nothing on a profile that has not loaded', () => {
    expect(shouldShowTrialExpiredNotice({ ...base, user: null, loading: true })).toBe(false);
    expect(shouldShowTrialExpiredNotice({ ...base, uid: null, user: { trialEndsAt: 1 } })).toBe(false);
  });

  it('LANG-TRIAL-10 — dismissal is remembered per ACCOUNT', () => {
    const user = { trialEndsAt: base.nowMs - 1 };
    setTrialExpiredNoticeSeen('u1');
    expect(shouldShowTrialExpiredNotice({ ...base, user })).toBe(false);
    expect(shouldShowTrialExpiredNotice({ ...base, uid: 'u2', user })).toBe(true);
  });

  it('LANG-TRIAL-10 — the two notices use DISTINCT keys', () => {
    // Reusing LANG-TRIAL-5's key would mean every user who read the welcome
    // sheet is never told their trial ended — different facts, different
    // moments, and only the second one has a consequence.
    setTrialNoticeSeen('u1');
    expect(trialExpiredNoticeSeen('u1')).toBe(false);
    setTrialExpiredNoticeSeen('u1');
    expect(trialNoticeSeen('u1')).toBe(true);
    expect(trialExpiredNoticeSeen('u1')).toBe(true);
  });

  it('LANG-TRIAL-10 — the two notices PARTITION across the boundary', () => {
    // A property of the predicates, not of mount order — so it holds whichever
    // component the next author mounts where, and no second modal can ever
    // stack on the first.
    const endsAt = 5_000_000;
    const user = { trialEndsAt: endsAt };
    for (const nowMs of [endsAt - 2, endsAt - 1, endsAt, endsAt + 1, endsAt + 2]) {
      const start = shouldShowTrialNotice({ uid: 'u1', user, loading: false, nowMs });
      const end = shouldShowTrialExpiredNotice({ uid: 'u1', user, loading: false, nowMs });
      expect(start && end, `both notices due at now=${nowMs}`).toBe(false);
    }
  });
});

describe('BILL-ENT-2 — trialStanding / needsTrialEnrolment read the BOUNDED plan', () => {
  const now = 1_800_000_000_000;
  const ts = (ms: number) => ({ toMillis: () => ms });

  it('BILL-ENT-2 — a live bounded subscription reads pro', () => {
    expect(trialStanding({ plan: 'pro', planUntil: ts(now + HOUR) }, now)).toEqual({ kind: 'pro' });
  });

  it('BILL-ENT-2 — a lapsed subscription reads free (present tense), with no job having run', () => {
    expect(trialStanding({ plan: 'pro', planUntil: ts(now - 1) }, now)).toEqual({ kind: 'free' });
  });

  it('BILL-ENT-2 — grandfathered (no planUntil) still reads pro', () => {
    expect(trialStanding({ plan: 'pro' }, now)).toEqual({ kind: 'pro' });
  });

  it('BILL-ENT-2 — a live subscriber does not ask for a trial; a lapsed one with no stamp may', () => {
    const base = { uid: 'u1', loading: false, nowMs: now, enrolment: 'automatic' as const };
    expect(needsTrialEnrolment({ ...base, user: { plan: 'pro', planUntil: ts(now + HOUR) } })).toBe(false);
    expect(needsTrialEnrolment({ ...base, user: { plan: 'pro', planUntil: ts(now - 1) } })).toBe(true);
  });
});
