import { signInWithCustomToken, signOut } from 'firebase/auth';
import { auth } from './firebase';
import { config } from './config';

/**
 * E2E-only window hooks, installed only when the dev server runs with
 * `VITE_E2E_TEST=true` (tests/e2e/playwright.emulator.config.ts). The
 * Playwright helpers mint a custom token with the Admin SDK and sign the
 * browser in through `__testSignIn` (tests/e2e/helpers/auth.ts).
 *
 * Slimmed from the Wurld app's testHooks.ts (which also had chat jump, flip
 * and push-tap hooks).
 */
declare global {
  interface Window {
    __testSignIn?: (customToken: string) => Promise<void>;
    __testSignOut?: () => Promise<void>;
  }
}

export function installTestHooks(): void {
  if (!config.e2eTest) return;
  window.__testSignIn = async (customToken: string) => {
    await signInWithCustomToken(auth, customToken);
  };
  window.__testSignOut = async () => {
    await signOut(auth);
  };
}
