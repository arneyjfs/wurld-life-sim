/**
 * LIFE-SCENE-1: Firestore reads + writes for the user's scenes.
 *
 *   - `scenes/active`  ─ the singleton ACTIVE scene (or absent).
 *   - `scenes/{id}`    ─ archived scenes (completed / abandoned).
 *
 * Active-doc writes go through this module so call sites don't repeat
 * the `stripUndefined` dance + serverTimestamp bookkeeping. Read
 * subscription lives in `useLifeScene`.
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
import { db } from '@/lib/firebase';
import { stripUndefined } from './stripUndefined';
import type {
  SceneOutline,
  ScenePhase,
  SceneStatus,
  LifeScene,
} from '@/types/firestore';

export const ACTIVE_SCENE_DOC_ID = 'active';

const COLLECTION = 'scenes';

function scenesCollection(uid: string, worldId: string) {
  return collection(db, 'users', uid, 'lifeWorlds', worldId, COLLECTION);
}
function sceneDoc(uid: string, worldId: string, id: string) {
  return doc(db, 'users', uid, 'lifeWorlds', worldId, COLLECTION, id);
}

export type CreateSceneInput = {
  uid: string;
  worldId: string;
  id: string;
  outline: SceneOutline;
};

/** Write the active scene doc on hook acceptance. Overwrites any
 *  previously-active scene — callers should archive the old one
 *  first via `archiveScene`. */
export async function createScene(
  input: CreateSceneInput,
): Promise<void> {
  await setDoc(
    sceneDoc(input.uid, input.worldId, ACTIVE_SCENE_DOC_ID),
    // LIFE-CAST-6 — the outline is model-authored, so its optional fields
    // (`where`, `openQuestion`) may be absent. Stripped here as well as at the
    // source, because this is the seam every scene write passes through.
    stripUndefined({
      id: input.id,
      status: 'active' satisfies SceneStatus,
      outline: input.outline,
      currentPhase: 'opening' satisfies ScenePhase,
      turnsSinceReplan: 0,
      chosenEndingKey: null,
      acceptedAt: serverTimestamp(),
    }),
  );
}

/** Patch the active scene doc — used by lifeStep to bump
 *  `turnsSinceReplan` + by replan to drop in a fresh outline. */
export async function updateActiveScene(
  uid: string,
  worldId: string,
  patch: Partial<Omit<LifeScene, 'id' | 'acceptedAt'>>,
): Promise<void> {
  // LIFE-CAST-6. Was a top-level-only loop, which walked straight past
  // `outline.where` on the fresh outline replan patches in here.
  const clean = stripUndefined(patch as Record<string, unknown>);
  await updateDoc(sceneDoc(uid, worldId, ACTIVE_SCENE_DOC_ID), clean);
}

/** Move the active scene to history + delete the active doc.
 *  Active doc lives at the reserved id `active`; archived go under
 *  generated ids. Called on resolve / abandon, AFTER the world bio
 *  has absorbed the arc. */
export async function archiveScene(
  uid: string,
  worldId: string,
  status: 'completed' | 'abandoned',
): Promise<void> {
  const activeRef = sceneDoc(uid, worldId, ACTIVE_SCENE_DOC_ID);
  const activeSnap = await getDocs(scenesCollection(uid, worldId));
  const activeDocSnap = activeSnap.docs.find((d) => d.id === ACTIVE_SCENE_DOC_ID);
  if (!activeDocSnap) return;
  const data = activeDocSnap.data();
  const archivedId =
    typeof data.id === 'string' && data.id !== ACTIVE_SCENE_DOC_ID
      ? data.id
      : `archived-${Date.now()}`;
  const historyRef = sceneDoc(uid, worldId, archivedId);

  const batch = writeBatch(db);
  batch.set(historyRef, {
    ...data,
    id: archivedId,
    status,
    resolvedAt: serverTimestamp(),
  });
  batch.delete(activeRef);
  await batch.commit();
}
