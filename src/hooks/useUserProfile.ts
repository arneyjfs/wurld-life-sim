import { useContext } from 'react';
import { useDocSnapshot } from './firestore/useDocSnapshot';
import { ZUser } from '@/types/firestore';
import { ViewerProfileContext } from '@/contexts/ViewerProfileContext';

/**
 * Subscribe to `users/{uid}`, mirrored to localStorage (`user:{uid}`,
 * BOOT-HYDRATION-5).
 *
 * BOOT-SHARE-3 — under a `ViewerProfileProvider` for the same uid this reads
 * the provider's single subscription and passes a null path to its own (which
 * then opens nothing). Hooks are unconditional either way, so the order of
 * hook calls never changes with the provider's presence.
 */
export function useUserProfile(uid: string | null) {
  const shared = useContext(ViewerProfileContext);
  const readsShared = !!uid && shared?.uid === uid;
  const own = useDocSnapshot(
    ZUser,
    uid && !readsShared ? `users/${uid}` : null,
    uid && !readsShared ? `user:${uid}` : undefined,
  );
  return readsShared && shared ? shared.result : own;
}
