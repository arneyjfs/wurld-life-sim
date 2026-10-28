/**
 * Seed / clear the global version floor, `config/version` (OBS-VERSION-7).
 *
 * ⚠ EMULATOR ONLY. The doc is global: a floor above the build seeded into a
 * real project locks every client of that project out. `@critical` specs also
 * run under `test:e2e:prod-smoke`, which points the Admin SDK at PROD — so this
 * helper refuses to write unless the Admin SDK is aimed at the Firestore
 * emulator, whatever the calling spec's skip conditions say.
 */
import { getAdminFirestore } from './firebase-admin';

function assertEmulator(): void {
  if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.E2E_EMULATOR !== 'true') {
    throw new Error(
      'versionFloor helper: refusing to touch config/version outside the Firestore emulator ' +
        '(FIRESTORE_EMULATOR_HOST unset or E2E_EMULATOR !== "true").',
    );
  }
}

export function isEmulatorRun(): boolean {
  return !!process.env.FIRESTORE_EMULATOR_HOST && process.env.E2E_EMULATOR === 'true';
}

export async function seedVersionFloor(minSupportedVersion: string): Promise<void> {
  assertEmulator();
  await getAdminFirestore().doc('config/version').set({ minSupportedVersion });
}

export async function clearVersionFloor(): Promise<void> {
  assertEmulator();
  await getAdminFirestore().doc('config/version').delete();
}
