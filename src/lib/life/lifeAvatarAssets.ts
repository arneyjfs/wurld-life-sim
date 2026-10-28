/**
 * LIFE-NPC-2 / LIFE-DATA-1: avatar SVGs (player AND NPCs) live in
 * SIDECAR docs, OFF the hot docs that a listener re-streams.
 *
 * An avatar is a multi-KB `data:image/svg+xml` URI. It used to sit
 * inline — the player's on the lifeWorld doc (`characterAvatarUrl`),
 * each NPC's on its npc doc (`avatarUrl`). Both docs get re-streamed to
 * their listeners on every write (the world doc many times per turn; an
 * npc doc on every `lastSeenAt` touch, scope change, memory update…),
 * dragging the avatar bytes along each time. Moving the bytes to
 *
 *   users/{uid}/lifeWorlds/{worldId}/assets/{assetId}   → { dataUri }
 *
 * leaves the listened docs carrying only a cheap status flag; the bytes
 * are read ONCE (getDoc, not a listener) when status flips to 'ready'.
 * The writer stores the sidecar BEFORE flipping status, so a 'ready'
 * reader is guaranteed to find it.
 *
 * assetId: 'character' for the player, `npc-{npcId}` for an NPC.
 *
 * CLEAN BREAK: no migration — pre-existing worlds are disposable.
 *
 * Spec: docs/specs/life-sim.md §1 (LIFE-DATA-1), §6 (LIFE-NPC-2).
 */
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/** Stable single-doc id for the player's own avatar. */
const CHARACTER_ASSET_ID = 'character';

/** Sidecar id for an NPC's avatar — namespaced so it can't collide
 *  with the player's `character` doc. */
function npcAssetId(npcId: string): string {
  return `npc-${npcId}`;
}

function avatarAssetDoc(uid: string, worldId: string, assetId: string) {
  return doc(db, 'users', uid, 'lifeWorlds', worldId, 'assets', assetId);
}

/** Persist an avatar data URI to its sidecar. Callers MUST write the
 *  sidecar BEFORE flipping the owning doc's status flag to 'ready'. */
async function writeAvatarAsset(
  uid: string,
  worldId: string,
  assetId: string,
  dataUri: string,
): Promise<void> {
  await setDoc(avatarAssetDoc(uid, worldId, assetId), { dataUri });
}

/** Read an avatar data URI, or null when the sidecar is missing /
 *  malformed. Read once (getDoc) when the owning status is 'ready'. */
async function readAvatarAsset(
  uid: string,
  worldId: string,
  assetId: string,
): Promise<string | null> {
  const snap = await getDoc(avatarAssetDoc(uid, worldId, assetId));
  if (!snap.exists()) return null;
  const data = snap.data() as { dataUri?: unknown };
  return typeof data.dataUri === 'string' && data.dataUri.length > 0
    ? data.dataUri
    : null;
}

// --- Player ---------------------------------------------------------

export function writeCharacterAvatar(
  uid: string,
  worldId: string,
  dataUri: string,
): Promise<void> {
  return writeAvatarAsset(uid, worldId, CHARACTER_ASSET_ID, dataUri);
}

export function readCharacterAvatar(
  uid: string,
  worldId: string,
): Promise<string | null> {
  return readAvatarAsset(uid, worldId, CHARACTER_ASSET_ID);
}

// --- NPCs -----------------------------------------------------------

export function writeNpcAvatar(
  uid: string,
  worldId: string,
  npcId: string,
  dataUri: string,
): Promise<void> {
  return writeAvatarAsset(uid, worldId, npcAssetId(npcId), dataUri);
}

export function readNpcAvatar(
  uid: string,
  worldId: string,
  npcId: string,
): Promise<string | null> {
  return readAvatarAsset(uid, worldId, npcAssetId(npcId));
}
