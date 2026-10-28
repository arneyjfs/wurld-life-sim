import { useAuthStore } from '@/store/authStore';

/**
 * The UID to use for Firestore subscriptions.
 *
 * Returns `user.uid` once Firebase Auth has restored, falling back to
 * `cachedUid` (from localStorage boot snapshot) during the brief
 * cold-boot window before that. The fallback is safe — the snapshot
 * hooks (useCollectionSnapshot / useDocSnapshot) gate the actual
 * listener attach on `authStore.user`, so even with a cachedUid
 * threaded through, no Firestore request leaves the device without a
 * fresh auth token. The fallback is purely so screens render in their
 * "loading" state (rather than "no data") during the gap between
 * mount and auth restore.
 */
export function useCurrentUid(): string | null {
  return useAuthStore((s) => s.user?.uid ?? s.cachedUid);
}
