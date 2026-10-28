import { create } from 'zustand';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { getBootSnapshot, setBootUid } from '../lib/bootCache';
import { notifyViewerChange } from '../lib/snapshotCache';
import { deriveAuthState } from '../lib/accountState';

type AuthState = {
  /** The account the app runs as. Null until Firebase restores from
   *  IndexedDB, after sign-out, AND while the signed-in Firebase user has no
   *  phone number yet (AUTH-ACCOUNT-3 — see `pendingUser`). */
  user: User | null;
  /** AUTH-ACCOUNT-3 — signed in with Google / Apple / email but no phone
   *  linked yet. Invisible to the rest of the app; the gate shows
   *  `verify-phone`. */
  pendingUser: User | null;
  /** AUTH-ACCOUNT-5 — `user` has a phone but no email method. */
  needsEmail: boolean;
  /** True after the first auth event — i.e. Firebase has finished its
   *  IndexedDB restore and we know whether the user is signed in or not. */
  ready: boolean;
  /** Last UID we ever saw signed in. Hydrated synchronously from
   *  localStorage so routes can render the AppShell immediately on
   *  cold-boot rather than waiting on Firebase's async restore.
   *  Reconciled with `user.uid` once `ready` flips true. */
  cachedUid: string | null;
};

export const useAuthStore = create<AuthState>(() => ({
  user: null,
  pendingUser: null,
  needsEmail: false,
  ready: false,
  cachedUid: getBootSnapshot().uid,
}));

// `onIdTokenChanged`, not `onAuthStateChanged`: linking a phone or an email
// method keeps the uid, so only the token event fires for it (AUTH-ACCOUNT-4/5).
// It also fires on the hourly refresh, so the viewer-change side effects run
// only when the APP uid actually changes.
let lastAppUid: string | null | undefined;
onIdTokenChanged(auth, (firebaseUser) => {
  // Standalone change: Wurld's AUTH-ACCOUNT-3 kept an account without a phone
  // number invisible (`pendingUser`). Wurlds has no phone step, so any
  // signed-in Firebase user is the app user. `deriveAuthState` is still used
  // for `needsEmail`; restore the Wurld behaviour by dropping the override.
  const derived = deriveAuthState(firebaseUser);
  const user = firebaseUser;
  const pendingUser = null;
  const needsEmail = derived.needsEmail;
  const appUid = user?.uid ?? null;
  useAuthStore.setState({ user, pendingUser, needsEmail, ready: true, cachedUid: appUid });
  if (appUid === lastAppUid) return;
  lastAppUid = appUid;
  setBootUid(appUid);
  // BOOT-CACHE-3 — the ONE auth-transition signal the in-memory caches reset
  // from (docs/specs/cold-boot.md §1b).
  notifyViewerChange(appUid);
});
