import { describe, expect, it, vi } from 'vitest';

const callHttp = vi.fn();
vi.mock('@/lib/endpoints', () => ({ callHttp: (...a: unknown[]) => callHttp(...a) }));

import { blockedPersonPhone, blockedUidsOf, isBlocked, isSoleAdmin, isUnblockable, setBlock, sharedGroups } from './blocking';

describe('SAFETY-BLOCK — client helpers', () => {
  it('SAFETY-BLOCK-1 — reads the viewer\'s own block list', () => {
    expect(blockedUidsOf(undefined)).toEqual([]);
    expect(blockedUidsOf({ blockedUids: ['bob', 4] })).toEqual(['bob']);
    expect(isBlocked({ blockedUids: ['bob'] }, 'bob')).toBe(true);
    expect(isBlocked({ blockedUids: ['bob'] }, 'carol')).toBe(false);
    expect(isBlocked({ blockedUids: ['bob'] }, null)).toBe(false);
  });

  it('SAFETY-BLOCK-2 — the tutor and the Wurld team cannot be blocked', () => {
    expect(isUnblockable('wurld-tutor-agent')).toBe(true);
    expect(isUnblockable('wurld-dev-team')).toBe(true);
    expect(isUnblockable(null)).toBe(true);
    expect(isUnblockable('bob')).toBe(false);
  });

  it('SAFETY-BLOCK-1 — block and unblock go through setBlock', async () => {
    callHttp.mockResolvedValue({ ok: true });
    await setBlock('bob', true);
    await setBlock('bob', false);
    expect(callHttp).toHaveBeenNthCalledWith(1, 'setBlock', { uid: 'bob', blocked: true });
    expect(callHttp).toHaveBeenNthCalledWith(2, 'setBlock', { uid: 'bob', blocked: false });
  });

  it('SAFETY-BLOCK-13 — shared groups are groups holding both people', () => {
    const chats = [
      { id: 'g1', isGroup: true, members: ['me', 'bob', 'carol'] },
      { id: 'g2', isGroup: true, members: ['me', 'carol'] },
      { id: 'd1', isGroup: false, members: ['me', 'bob'] },
    ];
    expect(sharedGroups(chats, 'me', 'bob').map((c) => c.id)).toEqual(['g1']);
  });

  it('SAFETY-BLOCK-13 — the only admin cannot leave', () => {
    expect(isSoleAdmin({ adminUids: ['me'] }, 'me')).toBe(true);
    expect(isSoleAdmin({ adminUids: ['me', 'carol'] }, 'me')).toBe(false);
    expect(isSoleAdmin({ adminUids: ['carol'] }, 'me')).toBe(false);
    expect(isSoleAdmin(null, 'me')).toBe(false);
  });
});

describe('SAFETY-BLOCK-2 — Blocked people shows a phone number', () => {
  const chats = [
    { isGroup: true, members: ['me', 'bob', 'c'], otherPhone: undefined },
    { isGroup: false, members: ['me', 'bob'], otherPhone: '+44 7700 900002' },
  ];
  it('SAFETY-BLOCK-2 — a saved contact\'s number wins', () => {
    expect(blockedPersonPhone('bob', [{ uid: 'bob', phoneNumber: '+44 7700 900001' }], chats)).toBe('+44 7700 900001');
  });
  it('SAFETY-BLOCK-2 — else the 1:1 chat\'s member phone', () => {
    expect(blockedPersonPhone('bob', [], chats)).toBe('+44 7700 900002');
  });
  it('SAFETY-BLOCK-2 — else none', () => {
    expect(blockedPersonPhone('carol', [], chats)).toBeUndefined();
  });
});
