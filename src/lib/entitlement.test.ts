/**
 * LANG-TRIAL-1 — entitlement, not plan, is what every gate reads.
 *
 * Spec: docs/specs/language-tiers.md §5b.
 *
 * Two things are being pinned here and they pull in opposite directions, which
 * is why they are tested together rather than in two files:
 *
 *   1. A TRIALLING user is entitled. Every gate that used to ask
 *      `plan === 'pro'` now asks this, so a bug here locks a brand-new user out
 *      of the product on the day they sign up — and does it silently, because
 *      "free user sees the free experience" looks exactly like working software.
 *   2. It still FAILS CLOSED (LANG-SEC-2). `plan` has no write path
 *      (LANG-SEC-3) and `trialEndsAt` is server-only, so absent, malformed and
 *      hostile values all have to resolve to "not entitled". A predicate that
 *      fails open here hands the entire user base a subscription.
 */
import { describe, expect, it } from 'vitest';
import { hasPaidPlan, hasProEntitlement, isTrialling } from './entitlement';

/** A stand-in for a Firestore `Timestamp`, which is what the SDK really hands
 *  us. Feature-detected via `.toMillis()` rather than `instanceof`, so this
 *  duck type is a faithful fixture and the module needs no firebase import. */
const ts = (ms: number) => ({ toMillis: () => ms });

const NOW = 1_700_000_000_000;

describe('LANG-TRIAL-1 — plan === "pro" is entitled', () => {
  it('a subscriber with no trial is entitled', () => {
    expect(hasProEntitlement({ plan: 'pro' }, NOW)).toBe(true);
  });

  it('a subscriber whose trial expired long ago is still entitled', () => {
    // `plan` and `trialEndsAt` are independent facts (LANG-TRIAL-2). A lapsed
    // trial must never subtract from a paid plan.
    expect(hasProEntitlement({ plan: 'pro', trialEndsAt: ts(NOW - 1) }, NOW)).toBe(true);
  });

  it.each([
    ['Pro', 'Pro'],
    ['PRO', 'PRO'],
    ['pro ', 'pro '],
    ['premium', 'premium'],
    ['plus', 'plus'],
  ])('only the exact literal counts — %s does not', (_label, plan) => {
    expect(hasProEntitlement({ plan }, NOW)).toBe(false);
  });
});

describe('LANG-TRIAL-1 — now < trialEndsAt is entitled', () => {
  it('a free user mid-trial is entitled', () => {
    expect(hasProEntitlement({ plan: 'free', trialEndsAt: ts(NOW + 1) }, NOW)).toBe(true);
  });

  it('a user with no plan field at all, mid-trial, is entitled', () => {
    // This is the shape a brand-new signup actually has: the onCreate trigger
    // stamps `trialEndsAt` and nothing writes `plan` (LANG-SEC-3).
    expect(hasProEntitlement({ trialEndsAt: ts(NOW + 60_000) }, NOW)).toBe(true);
  });

  it('an expired trial is not entitled', () => {
    expect(hasProEntitlement({ plan: 'free', trialEndsAt: ts(NOW - 1) }, NOW)).toBe(false);
  });

  it('a trial ending EXACTLY now is not entitled', () => {
    // Strictly `<`. The boundary is arbitrary in isolation and load-bearing in
    // pairs: the server twin must choose the same side or a user sits entitled
    // on one machine and not the other for the width of a clock tick.
    expect(hasProEntitlement({ trialEndsAt: ts(NOW) }, NOW)).toBe(false);
  });
});

describe('the three shapes `trialEndsAt` can arrive in', () => {
  it('a Firestore Timestamp (has .toMillis())', () => {
    expect(hasProEntitlement({ trialEndsAt: ts(NOW + 1) }, NOW)).toBe(true);
  });

  it('a Date — what a local optimistic write or a test fixture produces', () => {
    expect(hasProEntitlement({ trialEndsAt: new Date(NOW + 1) }, NOW)).toBe(true);
  });

  it('a plain epoch-ms number', () => {
    expect(hasProEntitlement({ trialEndsAt: NOW + 1 }, NOW)).toBe(true);
  });
});

describe('LANG-SEC-2 — it fails closed on everything else', () => {
  it.each([
    ['null user', null],
    ['undefined user', undefined],
    ['empty doc', {}],
  ])('%s is not entitled', (_label, user) => {
    expect(hasProEntitlement(user as never, NOW)).toBe(false);
  });

  it.each([
    ['a date string', '2099-01-01'],
    ['an ISO-ish string', '2099-01-01T00:00:00.000Z'],
    ['a numeric string', String(NOW + 1)],
    ['true', true],
    ['an empty object', {}],
    ['an array', [NOW + 1]],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['an Invalid Date', new Date('nope')],
  ])('a malformed trialEndsAt (%s) is not entitled', (_label, trialEndsAt) => {
    expect(hasProEntitlement({ trialEndsAt }, NOW)).toBe(false);
  });

  it('a toMillis() that throws does not take the caller down', () => {
    // `.passthrough()` Zod schemas let anything through, so "an object with a
    // toMillis that isn't Firestore's" is a reachable shape. A gate that
    // throws is a screen that does not render.
    const hostile = {
      trialEndsAt: {
        toMillis: () => {
          throw new Error('boom');
        },
      },
    };
    expect(hasProEntitlement(hostile, NOW)).toBe(false);
  });

  it('a toMillis() returning a non-number is not entitled', () => {
    expect(hasProEntitlement({ trialEndsAt: { toMillis: () => 'soon' } }, NOW)).toBe(false);
  });
});

describe('the clock is always the caller’s', () => {
  it('never reads Date.now() for itself', () => {
    // Pinning this as behaviour rather than as a code-shape guard: the same
    // user doc must resolve the same way for any two callers sharing a clock,
    // and a hidden `Date.now()` is what makes an entitlement untestable.
    const user = { trialEndsAt: ts(NOW) };
    expect(hasProEntitlement(user, NOW - 1)).toBe(true);
    expect(hasProEntitlement(user, NOW)).toBe(false);
    expect(hasProEntitlement(user, NOW + 1)).toBe(false);
  });
});

describe('BILL-ENT-2 — the client twin gains the same clock bound', () => {
  const NOW_B = 1_800_000_000_000;
  const tsB = (ms: number) => ({ toMillis: () => ms });

  it('BILL-ENT-2 — absent planUntil = unbounded (grandfathered unchanged)', () => {
    expect(hasProEntitlement({ plan: 'pro' }, NOW_B)).toBe(true);
  });

  it('BILL-ENT-2 — past planUntil = not entitled; strict <', () => {
    expect(hasProEntitlement({ plan: 'pro', planUntil: tsB(NOW_B - 1) }, NOW_B)).toBe(false);
    expect(hasProEntitlement({ plan: 'pro', planUntil: tsB(NOW_B) }, NOW_B)).toBe(false);
    expect(hasProEntitlement({ plan: 'pro', planUntil: tsB(NOW_B + 1) }, NOW_B)).toBe(true);
  });

  it('BILL-ENT-2 — null planUntil = lifetime; junk = closed', () => {
    expect(hasProEntitlement({ plan: 'pro', planUntil: null }, NOW_B)).toBe(true);
    expect(hasProEntitlement({ plan: 'pro', planUntil: 'soon' }, NOW_B)).toBe(false);
  });

  it('BILL-ENT-2 — a lapsed subscriber inside a live trial is TRIALLING, not paying', () => {
    const u = { plan: 'pro', planUntil: tsB(NOW_B - 1), trialEndsAt: tsB(NOW_B + 1000) };
    expect(hasPaidPlan(u, NOW_B)).toBe(false);
    expect(isTrialling(u, NOW_B)).toBe(true);
  });

  it('BILL-ENT-2 — a live subscriber is never trialling', () => {
    const u = { plan: 'pro', planUntil: tsB(NOW_B + 1000), trialEndsAt: tsB(NOW_B + 1000) };
    expect(isTrialling(u, NOW_B)).toBe(false);
  });
});
