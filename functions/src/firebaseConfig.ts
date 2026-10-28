/**
 * firebaseConfig.ts — Firebase Admin SDK initialisation & project helpers.
 *
 * Two supported topologies (docs/setup.md):
 *
 *  1. ONE project: Functions, Auth, Firestore and Storage all live in the
 *     project the functions are deployed to. `admin.initializeApp()` with no
 *     overrides. This is the default.
 *
 *  2. SHARED AUTH (the Wurld topology): the functions run in their own
 *     project, but Auth + Firestore + Storage live in another one (e.g. Wurld's
 *     `wurld-e27d8`, so existing Wurld accounts sign straight in). Set
 *     `LIFE_DATA_PROJECT=<that project id>` in `functions/.env.<project>` and
 *     the default app targets it, so `admin.firestore()` / `admin.auth()` /
 *     `admin.storage()` all hit the shared project. The functions' runtime
 *     service account then needs `roles/datastore.user` (and Storage object
 *     admin for `lifeAssets/`) on the data project.
 *
 * Wurld ran topology 2 for its beta (`wurld-beta` functions → `wurld-e27d8`
 * data). Do NOT add business logic here.
 */

import * as admin from "firebase-admin";
import { enforceAppCheck } from "./appCheck";
import { setSentryUser } from "./observability/sentry";

// ---------------------------------------------------------------------------
// Project detection
// ---------------------------------------------------------------------------
export const RUNTIME_PROJECT =
  process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "";
/** Where Auth + Firestore + Storage live. Equal to RUNTIME_PROJECT unless the
 *  shared-auth topology is configured (see the header). */
export const DATA_PROJECT = process.env.LIFE_DATA_PROJECT || RUNTIME_PROJECT;

// NOTE: Do NOT pass `credential: admin.credential.applicationDefault()`
// explicitly. In Cloud Functions the SDK uses an optimised credential path
// when no credential is provided; overriding it can cause subtle issues with
// cross-project access.
if (DATA_PROJECT && DATA_PROJECT !== RUNTIME_PROJECT) {
  admin.initializeApp({
    projectId: DATA_PROJECT,
    storageBucket: process.env.LIFE_STORAGE_BUCKET || `${DATA_PROJECT}.firebasestorage.app`,
  });
} else {
  admin.initializeApp();
}

// ---------------------------------------------------------------------------
// Helpers — every Firestore / Auth call in the codebase goes through these.
// ---------------------------------------------------------------------------
export function getFirestore(): admin.firestore.Firestore {
  return admin.firestore();
}

export function getAuth(): admin.auth.Auth {
  return admin.auth();
}

// ---------------------------------------------------------------------------
// Auth — verify a Firebase ID token from an Authorization header.
// ---------------------------------------------------------------------------
export type VerifyAuthOptions = {
  /**
   * SEC-FN-10 — also check the token against the Auth revocation list
   * (`admin.auth().verifyIdToken(token, true)`). Costs one Auth backend
   * round-trip per call, so it is opted into by the destructive and
   * money-moving endpoints (deleteChat, deleteAccount, billing, admin) and
   * left off the per-message hot path. docs/specs/data-boundary.md §3b.
   */
  checkRevoked?: boolean;
};

export async function verifyAuth(
  req: {
    headers: {
      authorization?: string;
      "x-firebase-appcheck"?: string | string[];
    };
  },
  options: VerifyAuthOptions = {},
): Promise<admin.auth.DecodedIdToken> {
  // App Check (docs/specs/app-check.md APPCHECK-6..9). This is the single seam
  // every authenticated HTTP function already goes through, so attestation
  // lands here rather than in 18 handlers — and it lands BEFORE the handler
  // spends anything. In the shipped 'monitor' posture this only classifies and
  // log-samples; it CANNOT reject. Flipping that is one constant in
  // ./appCheck.ts — read the box at the top of that file first.
  await enforceAppCheck(req.headers);

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }
  const idToken = authHeader.split("Bearer ")[1];
  const decoded = await admin.auth().verifyIdToken(idToken, options.checkRevoked === true);
  // OBS-SRV-2 — every authenticated request's Sentry events carry user.id.
  setSentryUser(decoded.uid);
  return decoded;
}

// Startup log: which config path was taken, visible in Cloud Functions logs.
console.log(`[firebaseConfig] project=${RUNTIME_PROJECT} dataProject=${DATA_PROJECT}`);
