/**
 * LIFE-DATA-1 / LIFE-WORLD-*: world-doc + event-log writes.
 *
 * Multi-world model (Phase B): each user owns up to 5 worlds at
 *
 *   users/{uid}/lifeWorlds/{worldId}
 *
 * with subcollections under that for events / npcs / backdrops /
 * scenes / completedArcs / assets. The single-world legacy path
 * (`lifeWorld/main`) is no longer written or read by this module — the
 * new code skips straight to the new schema, and any leftover legacy
 * docs are harmless garbage the user can wipe via Firebase console.
 */
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { stripUndefined } from './stripUndefined';
import {
  deleteObject,
  listAll,
  ref as storageRef,
  type StorageReference,
} from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import * as log from '@/lib/log';
import { clearAllBackdropCaches } from './backdropCache';
import type {
  Difficulty,
  LifeBeatPayload,
  LifeEventKind,
  LifeWorld,
  WorldMode,
  WorldSeedKey,
} from '@/types/firestore';

export const PROFILE_DOC_ID = 'main';

/** Generates a stable, sortable worldId. Doesn't need cryptographic
 *  uniqueness — the user has at most 5 worlds at a time and Firestore
 *  rejects collisions on `setDoc` anyway. */
export function newWorldId(): string {
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Path helpers. Keep the path-construction in one place so renames
 *  or schema migrations only touch this module. */
function worldRef(uid: string, worldId: string) {
  return doc(db, 'users', uid, 'lifeWorlds', worldId);
}
function worldsCollection(uid: string) {
  return collection(db, 'users', uid, 'lifeWorlds');
}
function eventsCollection(uid: string, worldId: string) {
  return collection(db, 'users', uid, 'lifeWorlds', worldId, 'events');
}
function profileRef(uid: string) {
  return doc(db, 'users', uid, 'lifeProfile', PROFILE_DOC_ID);
}

// ---------------------------------------------------------------------------
// World CRUD
// ---------------------------------------------------------------------------

export type CreateLifeWorldInput = {
  uid: string;
  worldId: string;
  characterName: string;
  practiceLanguage: string;
  nativeLanguage: string;
  /** LIFE-LANG-7: the language NARRATION is written in, captured from
   *  the active UI locale at creation (resolveSystemLanguage). Omit ⇒
   *  the reader falls back to nativeLanguage. */
  systemLanguage?: string;
  difficulty: Difficulty;
  worldSeedKey: WorldSeedKey;
  /** Required when `worldSeedKey === 'manual'`; ignored otherwise. */
  worldSeedText?: string;
  /** LIFE-ONBOARD-3: the onboarding toggle's position. Persisted for
   *  EVERY seed, not just 'manual' — 'surprise' needs it too, and a
   *  chip key that already implies its register costs nothing to
   *  restate but makes the prompt's read uniform. */
  worldMode: WorldMode;
};

export async function createLifeWorld(input: CreateLifeWorldInput): Promise<void> {
  await setDoc(worldRef(input.uid, input.worldId), {
    id: input.worldId,
    characterName: input.characterName.trim() || 'You',
    practiceLanguage: input.practiceLanguage,
    nativeLanguage: input.nativeLanguage,
    // LIFE-LANG-7: only write when captured — legacy readers use
    // `systemLanguage ?? nativeLanguage`, so absence is safe.
    ...(input.systemLanguage ? { systemLanguage: input.systemLanguage } : {}),
    difficulty: input.difficulty,
    worldSeedKey: input.worldSeedKey,
    ...(input.worldSeedKey === 'manual' && input.worldSeedText
      ? { worldSeedText: input.worldSeedText.trim() }
      : {}),
    worldMode: input.worldMode,
    // LIFE-WORLD-ARC-1: completed chapters live in the completedArcs
    // subcollection (arcs.ts); the world doc carries only the scalar
    // `completedArcCount`, which defaults to 0 by absence.
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateLifeWorld(
  uid: string,
  worldId: string,
  patch: Partial<Omit<LifeWorld, 'id' | 'createdAt'>>,
): Promise<void> {
  // LIFE-CAST-6 — DEEP strip, not the top-level loop this used to run. The
  // world patch is nested by construction (`cast`, `fronts`, `canon`, `saga`,
  // `currentArc`, `storyLog` are all maps or arrays assembled from model
  // output), and Firestore refuses an `undefined` at ANY depth — so a
  // top-level loop looked like a guard while letting the whole world write
  // fail on one missing optional field. `serverTimestamp()` is added AFTER the
  // strip; the helper passes sentinels through by identity either way.
  const clean: Record<string, unknown> = {
    ...stripUndefined(patch),
    updatedAt: serverTimestamp(),
  };
  await updateDoc(worldRef(uid, worldId), clean);
}

/** LIFE-SETTINGS-6 / LIFE-WORLD-*: wipe one world and ALL its
 *  subcollections + the world's Storage prefix. Each list-and-delete is
 *  independent — a single missing rule won't atomically block the rest of the
 *  wipe. Flashcards are NOT touched.
 *
 *  THE LIST IS THE PROMISE. The delete-confirm copy says "every event, NPC,
 *  backdrop, and any active or archived scene", and this array is the only
 *  thing that makes that true — a collection missing here is data the user was
 *  told was gone and isn't.
 *
 *  `campaigns` is on it for exactly that reason and no other. The 2026-08
 *  rename left pre-rename docs orphaned (`LIFE-BACKDROP-22`, `LIFE-SCENE-23`)
 *  and nothing reads them any more — but "nothing reads it" is not "the user
 *  agreed to keep it", and a delete that leaves rows behind breaks a promise
 *  the copy makes in as many words. Listing a collection that no longer exists
 *  is free: an empty result and no writes. (Pre-rename BACKDROPS lived in
 *  `scenes`, which is listed anyway as the live scene collection.)
 *
 *  After this returns, the world doc is gone. The lifeProfile doc is
 *  NOT touched (lastSeenWorldId might still point at the deleted id,
 *  but the overview handles missing ids gracefully). */
export const WORLD_SUBCOLLECTIONS = [
  'events',
  'npcs',
  'backdrops',
  'scenes',
  'completedArcs',
  'assets',
  // Orphaned by the 2026-08 rename. Swept so a wipe is total, never read.
  'campaigns',
] as const;

export async function deleteLifeWorld(uid: string, worldId: string): Promise<void> {
  const subs: Array<[(typeof WORLD_SUBCOLLECTIONS)[number]]> =
    WORLD_SUBCOLLECTIONS.map((name) => [name]);
  const snapshots = await Promise.allSettled(
    subs.map(([name]) =>
      getDocs(collection(db, 'users', uid, 'lifeWorlds', worldId, name)),
    ),
  );
  const batch = writeBatch(db);
  snapshots.forEach((s, i) => {
    const [name] = subs[i]!;
    if (s.status === 'fulfilled') {
      s.value.forEach((d) => batch.delete(d.ref));
    } else {
      log.warn('life.delete.list-failed', {
        worldId,
        sub: name,
        err: String(s.reason),
      });
    }
  });
  batch.delete(worldRef(uid, worldId));
  await batch.commit();

  // Nuke the localStorage backdrop cache so an old SVG doesn't bleed
  // into the next world's "Building world…" placeholder. Cache keys
  // are scoped by worldId so we could clear just the deleted one,
  // but the full wipe is cheap and avoids stale data corner cases.
  clearAllBackdropCaches();

  try {
    await deleteWorldStoragePrefix(uid, worldId);
  } catch (err) {
    log.warn('life.delete.storage-prefix-failed', { err: String(err), worldId });
  }
}

async function deleteWorldStoragePrefix(uid: string, worldId: string): Promise<void> {
  const root = storageRef(storage, `lifeAssets/${uid}/${worldId}`);
  await deleteStorageTree(root);
}

async function deleteStorageTree(folderRef: StorageReference): Promise<void> {
  const listing = await listAll(folderRef);
  await Promise.all([
    ...listing.items.map((item) => deleteObject(item).catch(() => undefined)),
    ...listing.prefixes.map((prefix) => deleteStorageTree(prefix)),
  ]);
}

// ---------------------------------------------------------------------------
// Profile (lastSeenWorldId)
// ---------------------------------------------------------------------------

export async function setLastSeenWorld(
  uid: string,
  worldId: string | null,
): Promise<void> {
  await setDoc(
    profileRef(uid),
    {
      lastSeenWorldId: worldId,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// ---------------------------------------------------------------------------
// Event log writes
// ---------------------------------------------------------------------------

export type AppendEventInput = {
  uid: string;
  worldId: string;
  kind: LifeEventKind;
  payload?: Record<string, unknown>;
};

export async function appendLifeEvent(input: AppendEventInput): Promise<string> {
  const ref = doc(eventsCollection(input.uid, input.worldId));
  await setDoc(ref, {
    kind: input.kind,
    payload: input.payload ? stripUndefined(input.payload) : {},
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function appendBeatEvent(
  uid: string,
  worldId: string,
  beat: LifeBeatPayload,
): Promise<string> {
  return appendLifeEvent({
    uid,
    worldId,
    kind: 'beat',
    payload: { ...beat },
  });
}

export async function appendDecisionEvent(
  uid: string,
  worldId: string,
  decision: { choiceId: string; text: string; actionType?: string; targetId?: string | null },
): Promise<string> {
  return appendLifeEvent({
    uid,
    worldId,
    kind: 'decision',
    payload: decision,
  });
}

// Re-export so the overview screen can read all worlds.
export { worldsCollection };
