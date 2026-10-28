import { createContext, useMemo, type ReactNode } from 'react';
import { useDocSnapshot, type SnapshotResult } from '@/hooks/firestore/useDocSnapshot';
import { ZUser, type User } from '@/types/firestore';

export type ViewerProfileValue = {
  uid: string;
  result: SnapshotResult<User>;
};

// Read by `useUserProfile` (src/hooks/useUserProfile.ts): a matching uid is
// served from here instead of opening its own listener. Co-located with the
// provider; the fast-refresh micro-rule is disabled rather than splitting the
// file (same call ContactsContext / ThemeContext make).
// eslint-disable-next-line react-refresh/only-export-components
export const ViewerProfileContext = createContext<ViewerProfileValue | null>(null);

/**
 * BOOT-SHARE-3 — subscribes ONCE to the viewer's own `users/{uid}` doc and
 * shares it with everything rendered under it.
 *
 * `useDocSnapshot` opens a new `onSnapshot` per hook instance, and the chat
 * screen mounted `useUserProfile(me)` in every `MessageItem`, every
 * `TTSButton`, `useMessageActions`, the composer and the header — about two
 * per bubble. `ChatScreen` mounts this provider; `useUserProfile(uid)` with
 * the same uid then reads it and opens nothing. Another uid, or a consumer
 * outside the provider, subscribes for itself exactly as before.
 *
 * Calls `useDocSnapshot` directly (not `useUserProfile`) so it never reads an
 * outer provider's value for itself — nesting is harmless, just redundant.
 */
export function ViewerProfileProvider({
  uid,
  children,
}: {
  uid: string | null;
  children: ReactNode;
}) {
  const result = useDocSnapshot(
    ZUser,
    uid ? `users/${uid}` : null,
    uid ? `user:${uid}` : undefined,
  );
  const value = useMemo(() => (uid ? { uid, result } : null), [uid, result]);
  return <ViewerProfileContext.Provider value={value}>{children}</ViewerProfileContext.Provider>;
}
