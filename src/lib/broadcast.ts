/**
 * Admin broadcast helpers (client side).
 *
 * Broadcast messages are sent from a synthetic "Wurld Dev Team" sender by
 * `adminBroadcast` (functions/src/index.ts). They are one-way announcements:
 * the recipient can read but not reply, and they may use markdown headers
 * (`## …`) which regular chat bubbles deliberately don't render.
 */

/** Synthetic sender uid for admin broadcast messages.
 *  MUST match `BROADCAST_SENDER_UID` in functions/src/index.ts. */
export const BROADCAST_SENDER_UID = 'wurld-dev-team';

/** True when a message was sent by the broadcast sender. Drives the
 *  read-only treatment (no reply) + markdown-header rendering. */
export function isBroadcastMessage(msg: { senderId?: string }): boolean {
  return msg.senderId === BROADCAST_SENDER_UID;
}

/** True when a chat is a one-way broadcast channel. Such chats render NO
 *  composer at all — the recipient can read but never send. Detected via
 *  the `isBroadcast` flag (set by adminBroadcast) with a members fallback
 *  (the broadcast sender is always a member). */
export function isBroadcastChat(
  chat: { isBroadcast?: boolean; members?: string[] } | null | undefined,
): boolean {
  if (!chat) return false;
  return !!chat.isBroadcast || !!chat.members?.includes(BROADCAST_SENDER_UID);
}
