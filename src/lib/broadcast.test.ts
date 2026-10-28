import { describe, it, expect } from 'vitest';
import { BROADCAST_SENDER_UID, isBroadcastMessage, isBroadcastChat } from './broadcast';

describe('broadcast', () => {
  it('BROADCAST_SENDER_UID matches the backend value (functions/src/index.ts)', () => {
    // If this changes, update BROADCAST_SENDER_UID in functions/src/index.ts
    // too — the client + server must agree or broadcasts won't be detected.
    expect(BROADCAST_SENDER_UID).toBe('wurld-dev-team');
  });

  it('isBroadcastMessage is true only for the broadcast sender', () => {
    expect(isBroadcastMessage({ senderId: 'wurld-dev-team' })).toBe(true);
    expect(isBroadcastMessage({ senderId: 'some-user' })).toBe(false);
    expect(isBroadcastMessage({})).toBe(false);
  });

  it('isBroadcastChat is true via the isBroadcast flag OR a broadcast-sender member', () => {
    expect(isBroadcastChat({ isBroadcast: true })).toBe(true);
    expect(isBroadcastChat({ members: ['wurld-dev-team', 'u1'] })).toBe(true);
    expect(isBroadcastChat({ isBroadcast: false, members: ['u1', 'u2'] })).toBe(false);
    expect(isBroadcastChat({ members: ['u1', 'u2'] })).toBe(false);
    expect(isBroadcastChat(null)).toBe(false);
    expect(isBroadcastChat(undefined)).toBe(false);
  });
});
