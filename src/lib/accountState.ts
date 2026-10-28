/**
 * AUTH-ACCOUNT-1/3/5 — what a signed-in Firebase user is allowed to be, as a
 * pure function of its Auth record. No Firebase imports: the shapes are
 * structural so this stays unit-testable and importable from anywhere.
 *
 * - `pending`     — no phone number yet. Invisible to the app (AUTH-ACCOUNT-3):
 *                   nothing keyed by its uid may be written.
 * - `needs-email` — has a phone but no email method (every pre-2026-10
 *                   account). Gated on `add-email` (AUTH-ACCOUNT-5).
 * - `complete`    — phone AND an email method (AUTH-ACCOUNT-1).
 */

/** Providers that carry an email address we can reach the user on. */
export const EMAIL_PROVIDER_IDS = ['password', 'google.com', 'apple.com'] as const;

export type AccountShape = {
  uid: string;
  phoneNumber: string | null;
  providerData: ReadonlyArray<{ providerId: string }>;
};

export type AccountStatus = 'pending' | 'needs-email' | 'complete';

export function hasEmailMethod(u: Pick<AccountShape, 'providerData'>): boolean {
  return u.providerData.some((p) =>
    (EMAIL_PROVIDER_IDS as readonly string[]).includes(p.providerId),
  );
}

export function classifyAccount(u: AccountShape): AccountStatus {
  if (!u.phoneNumber) return 'pending';
  return hasEmailMethod(u) ? 'complete' : 'needs-email';
}

/**
 * Split a Firebase user into what the app sees. `user` is the account the app
 * runs as (null while pending); `pendingUser` is a signed-in account that must
 * link a phone first; `needsEmail` gates `add-email`.
 */
export function deriveAuthState<U extends AccountShape>(
  firebaseUser: U | null,
): { user: U | null; pendingUser: U | null; needsEmail: boolean } {
  if (!firebaseUser) return { user: null, pendingUser: null, needsEmail: false };
  const status = classifyAccount(firebaseUser);
  if (status === 'pending') return { user: null, pendingUser: firebaseUser, needsEmail: false };
  return { user: firebaseUser, pendingUser: null, needsEmail: status === 'needs-email' };
}

/**
 * AUTH-ACCOUNT-3 — the uid the app may write under, or null. Use this instead
 * of `auth.currentUser?.uid` in code that writes Firestore lazily (push token
 * persistence), so a pending account can never create a `users/{uid}` doc.
 */
export function appUidOf(u: AccountShape | null | undefined): string | null {
  return u && u.phoneNumber ? u.uid : null;
}
