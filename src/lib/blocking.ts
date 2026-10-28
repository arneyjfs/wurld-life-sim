/**
 * SAFETY-BLOCK — the client half of blocking.
 *
 * Spec: docs/specs/safety.md §1. The block list is `users/{me}.blockedUids`
 * (SAFETY-BLOCK-1), read from the viewer's own user doc. Writes go through
 * `setBlock`, because a block also unlinks the viewer from the blocked
 * person's contacts (SAFETY-BLOCK-11).
 */
import { callHttp } from '@/lib/endpoints';
import { TUTOR_UID } from '@/lib/tutor';
import { BROADCAST_SENDER_UID } from '@/lib/broadcast';

/** SAFETY-BLOCK-2 — nobody can block the tutor or the Wurld team. */
export function isUnblockable(uid: string | null | undefined): boolean {
  return !uid || uid === TUTOR_UID || uid === BROADCAST_SENDER_UID;
}

/** SAFETY-BLOCK-1 — the uids a user doc blocks; absent or malformed is nobody. */
export function blockedUidsOf(user: { blockedUids?: unknown } | null | undefined): string[] {
  const raw = user?.blockedUids;
  return Array.isArray(raw) ? raw.filter((u): u is string => typeof u === 'string') : [];
}

export function isBlocked(user: { blockedUids?: unknown } | null | undefined, uid: string | null | undefined): boolean {
  return !!uid && blockedUidsOf(user).includes(uid);
}

export async function setBlock(uid: string, blocked: boolean): Promise<void> {
  await callHttp<{ uid: string; blocked: boolean }, { ok: true }>('setBlock', { uid, blocked });
}

/** SAFETY-BLOCK-13 — the groups the viewer shares with `otherUid`. */
export function sharedGroups<T extends { id: string; isGroup: boolean; members: string[] }>(
  chats: readonly T[],
  myUid: string,
  otherUid: string,
): T[] {
  return chats.filter((c) => c.isGroup && c.members.includes(myUid) && c.members.includes(otherUid));
}

/** SAFETY-BLOCK-13 — the leave path refuses the only admin (GROUP-ADMIN). */
export function isSoleAdmin(chat: { adminUids?: unknown } | null | undefined, uid: string): boolean {
  const admins = Array.isArray(chat?.adminUids) ? chat.adminUids : [];
  return admins.length === 1 && admins[0] === uid;
}

/** SAFETY-BLOCK-2 — the phone number Blocked people shows for `uid`: the
 *  viewer's saved contact first, else their 1:1 chat's member phone. The
 *  public profile carries no phone (PROF-3), so with neither there is none. */
export function blockedPersonPhone(
  uid: string,
  contacts: readonly { uid?: string; phoneNumber?: string }[],
  chats: readonly { isGroup: boolean; members: string[]; otherPhone?: string }[],
): string | undefined {
  const saved = contacts.find((c) => c.uid === uid && c.phoneNumber)?.phoneNumber;
  if (saved) return saved;
  return chats.find((c) => !c.isGroup && c.members.includes(uid) && c.otherPhone)?.otherPhone;
}
