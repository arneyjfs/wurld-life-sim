/**
 * LANG-TIER — the two named entitlement questions the UI asks.
 *
 * Spec: docs/specs/language-tiers.md §4.
 *
 * ## What used to be here, and why it is gone
 *
 * This file was mostly about the kill switch: that `VITE_LANG_TIER_ENABLED`
 * defaulted off, that only the exact `"1"` armed it, and — the important one —
 * that with it off a free user kept the whole language list, which was the
 * regression guard for a bug that nearly shipped.
 *
 * The switch was removed on 2026-09-16 (LANG-TIER-5, retired). Those tests went
 * with it rather than being adapted, because a guard against a flag that no
 * longer exists asserts nothing. What replaced the flag as the safety mechanism
 * is the GRANDFATHERING BACKFILL, and no unit test can observe whether that has
 * been run — which is precisely why the spec makes it a loud prerequisite
 * rather than a step.
 *
 * What is left worth testing is that the predicates read ENTITLEMENT and fail
 * closed, since a trialist passing and a lapsed user failing is the whole
 * behaviour now.
 *
 * ## `canCreateGroup` is gone too (2026-09-21)
 *
 * LANG-TIER-2 is RETIRED — a group with nobody on Plus is not broken, it is
 * PASSTHROUGH (LANG-FREE-1), so there is no longer a question "may this user
 * create a group". What replaced it is not the same question about one user
 * with a new name: `isRoomUnfunded` asks about the WHOLE ROOM, and the answer
 * decides whether the flow forks (LANG-FREE-13), never whether it is allowed.
 * Renaming a single-user predicate would have kept the old shape and lied about
 * it — one entitled member anywhere funds the room, including one who is not
 * the creator.
 */
import { describe, expect, it } from 'vitest';
import { canChooseAnyLanguage, isRoomUnfunded } from './languageTier';

const NOW = 1_700_000_000_000;
const ts = (ms: number) => ({ toMillis: () => ms });

const SINGLE = [['canChooseAnyLanguage', canChooseAnyLanguage]] as const;

describe.each(SINGLE)('%s — entitlement, not plan', (_name, predicate) => {
  it('allows a subscriber', () => {
    expect(predicate({ plan: 'pro' }, NOW)).toBe(true);
  });

  it('allows a live trialist — LANG-TRIAL-1', () => {
    // The case that matters most in practice: for the first 24 hours of their
    // life every user is here, and gating on `plan` alone would lock them out
    // of the product they were just given.
    expect(predicate({ plan: 'free', trialEndsAt: ts(NOW + 1) }, NOW)).toBe(true);
  });

  it('refuses once the trial lapses, with no write in between', () => {
    expect(predicate({ plan: 'free', trialEndsAt: ts(NOW) }, NOW)).toBe(false);
  });

  it.each([
    ['a free user', { plan: 'free' }],
    ['an unwritten plan — every account before the backfill', {}],
    ['a null profile', null],
    ['undefined', undefined],
    ['a near-miss plan value', { plan: 'Pro' }],
  ])('refuses %s — fails closed (LANG-SEC-2)', (_label, user) => {
    expect(predicate(user as never, NOW)).toBe(false);
  });
});

/**
 * LANG-FREE-12/13 — will this room be UNFUNDED?
 *
 * ⚠ It is a question about the ROOM, and that is the whole reason it is not
 * `canCreateGroup` with a new name. The creator being free decides nothing: one
 * entitled member anywhere in the room funds it, and the room then carries a
 * language SET that every member picks from independently (LANG-SET-1). So
 * every case below that has an entitled member ANYWHERE must read funded,
 * including the ones where the creator is not that member.
 */
describe('isRoomUnfunded — LANG-FREE-12/13', () => {
  const PRO = { plan: 'pro' };
  const FREE = { plan: 'free' };
  const TRIALIST = { plan: 'free', trialEndsAt: ts(NOW + 1) };
  const LAPSED = { plan: 'free', trialEndsAt: ts(NOW) };

  it('isRoomUnfunded — nobody entitled: the room is unfunded', () => {
    expect(isRoomUnfunded([FREE, FREE, FREE], NOW)).toBe(true);
  });

  it('isRoomUnfunded — the CREATOR on Plus funds the room', () => {
    expect(isRoomUnfunded([PRO, FREE, FREE], NOW)).toBe(false);
  });

  it('isRoomUnfunded — a MEMBER on Plus funds it just as well', () => {
    // The branch a per-creator predicate gets wrong. A free member inviting a
    // subscriber is a room that translates, and forking it would ask for a
    // common language the room does not need.
    expect(isRoomUnfunded([FREE, FREE, PRO], NOW)).toBe(false);
  });

  it('isRoomUnfunded — a LIVE trialist funds it — LANG-TRIAL-1', () => {
    expect(isRoomUnfunded([FREE, TRIALIST], NOW)).toBe(false);
  });

  it('isRoomUnfunded — a LAPSED trialist does not', () => {
    expect(isRoomUnfunded([FREE, LAPSED], NOW)).toBe(true);
  });

  it.each([
    ['a missing profile', [FREE, undefined]],
    ['a null profile', [FREE, null]],
    ['an unwritten plan', [FREE, {}]],
    ['a near-miss plan value', [FREE, { plan: 'Pro' }]],
    ['no members at all', []],
  ])('isRoomUnfunded — reads %s as unfunded, failing closed (LANG-SEC-2)', (_label, members) => {
    expect(isRoomUnfunded(members as never, NOW)).toBe(true);
  });

  it('isRoomUnfunded — a missing profile beside an ENTITLED one is still funded', () => {
    // Failing closed must not overrule a member we can actually see. One
    // entitled member is enough, whatever is unknown about the rest.
    expect(isRoomUnfunded([undefined, PRO], NOW)).toBe(false);
  });
});
