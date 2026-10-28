import { describe, it, expect } from 'vitest';
import { appUidOf, classifyAccount, deriveAuthState, hasEmailMethod } from './accountState';

const phone = { providerId: 'phone' };
const google = { providerId: 'google.com' };
const apple = { providerId: 'apple.com' };
const password = { providerId: 'password' };

function u(phoneNumber: string | null, providers: Array<{ providerId: string }>) {
  return { uid: 'u1', phoneNumber, providerData: providers };
}

describe('AUTH-ACCOUNT-1 — account classification', () => {
  it('AUTH-ACCOUNT-1 — phone + an email method is complete (password, google, apple)', () => {
    expect(classifyAccount(u('+447700900001', [phone, password]))).toBe('complete');
    expect(classifyAccount(u('+447700900001', [phone, google]))).toBe('complete');
    expect(classifyAccount(u('+447700900001', [phone, apple]))).toBe('complete');
  });

  it('AUTH-ACCOUNT-3 — no phone number is pending, whatever else is linked', () => {
    expect(classifyAccount(u(null, [google]))).toBe('pending');
    expect(classifyAccount(u(null, [password]))).toBe('pending');
    expect(classifyAccount(u(null, []))).toBe('pending');
  });

  it('AUTH-ACCOUNT-5 — phone with no email method needs an email', () => {
    expect(classifyAccount(u('+447700900001', [phone]))).toBe('needs-email');
    expect(hasEmailMethod({ providerData: [phone, { providerId: 'github.com' }] })).toBe(false);
  });
});

describe('AUTH-ACCOUNT-3 — what the app sees', () => {
  it('AUTH-ACCOUNT-3 — a pending account is not the app user', () => {
    const p = u(null, [google]);
    expect(deriveAuthState(p)).toEqual({ user: null, pendingUser: p, needsEmail: false });
    expect(appUidOf(p)).toBeNull();
  });

  it('AUTH-ACCOUNT-5 — a phone-only account is the app user and needs an email', () => {
    const b = u('+447700900001', [phone]);
    expect(deriveAuthState(b)).toEqual({ user: b, pendingUser: null, needsEmail: true });
    expect(appUidOf(b)).toBe('u1');
  });

  it('AUTH-ACCOUNT-1 — a complete account needs nothing', () => {
    const c = u('+447700900001', [phone, google]);
    expect(deriveAuthState(c)).toEqual({ user: c, pendingUser: null, needsEmail: false });
  });

  it('signed out', () => {
    expect(deriveAuthState(null)).toEqual({ user: null, pendingUser: null, needsEmail: false });
    expect(appUidOf(null)).toBeNull();
  });
});
