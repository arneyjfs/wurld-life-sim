/**
 * Account-deletion cascade for life sim data.
 *
 * In the Wurld app this lived inside `cascadeDeleteUserData` (SEC-FN-3), run
 * by the app's `deleteAccount` endpoint. Standalone, the simplest equivalent
 * is an Auth `onDelete` trigger: whatever deletes the Auth record (this app,
 * the Wurld app, the console), the life data goes with it.
 *
 * ⚠ Auth triggers only fire in the project that OWNS the Auth users. In the
 * shared-auth topology (docs/setup.md, functions deployed to a different
 * project than Auth) this trigger never fires; the owning app must delete
 * `users/{uid}/lifeWorlds`, `users/{uid}/lifeProfile` and the
 * `lifeAssets/{uid}/` storage prefix itself (Wurld's `cascadeDeleteUserData`
 * still does, as of 2026-10-28).
 */
import * as admin from "firebase-admin";
import * as functionsV1 from "firebase-functions/v1";
import { getFirestore } from "../firebaseConfig";

export async function deleteLifeData(uid: string): Promise<void> {
  const fs = getFirestore();
  // LIFE-DATA-*: worlds carry events / npcs / backdrops / scenes /
  // completedArcs / assets subcollections; recursiveDelete takes them all.
  await fs.recursiveDelete(fs.collection(`users/${uid}/lifeWorlds`));
  await fs.recursiveDelete(fs.collection(`users/${uid}/lifeProfile`));
  try {
    // Backdrop SVGs and avatars (src/lib/life/world.ts) live in the default
    // bucket under lifeAssets/{uid}/.
    await admin.storage().bucket().deleteFiles({ prefix: `lifeAssets/${uid}/` });
  } catch (err: unknown) {
    console.warn(`[deleteLifeData] lifeAssets cleanup failed for ${uid}:`, err);
  }
}

export const deleteLifeAccountData = functionsV1
  .region("us-central1")
  .auth.user()
  .onDelete(async (user) => {
    await deleteLifeData(user.uid);
  });
