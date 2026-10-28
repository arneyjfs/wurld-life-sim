/**
 * Browser-side auth helpers for E2E tests. Mirror of source tests/e2e/
 * helpers/auth.ts adapted for the Capacitor port:
 *
 *   - VITE_E2E_TEST=true on the dev server exposes window.__testSignIn /
 *     __testSignOut (see src/lib/testHooks.ts).
 *   - Browser uses REAL Firebase Auth so the resulting tokens are
 *     accepted by Firestore + Cloud Functions.
 *   - The Auth Emulator (when used) is purely for the phone-auth UI
 *     flow in auth-flow.spec.ts — the browser itself doesn't connect.
 */

import type { Page } from '@playwright/test';
import {
  createCustomToken,
  createIdToken,
  ensureTestUser,
  ensureUserProfile,
} from './firebase-admin';

export type TestUserConfig = {
  phone: string;
  displayName: string;
  nativeLanguage: string;
  practiceLanguage: string;
  difficulty?: number;
};

export type AuthenticatedUser = {
  uid: string;
  phone: string;
  displayName: string;
  customToken: string;
  realIdToken: string;
};

export async function provisionTestUser(
  config: TestUserConfig,
): Promise<AuthenticatedUser> {
  const uid = await ensureTestUser(config.phone);
  await ensureUserProfile(uid, {
    displayName: config.displayName,
    nativeLanguage: config.nativeLanguage,
    learningLanguage: config.practiceLanguage,
    phoneNumber: config.phone,
    difficulty: config.difficulty ?? 2,
  });
  const customToken = await createCustomToken(uid);
  const realIdToken = await createIdToken(customToken);
  return {
    uid,
    phone: config.phone,
    displayName: config.displayName,
    customToken,
    realIdToken,
  };
}

/**
 * Set (or clear) the per-device onboarding flags before navigation
 * (AUTH-WELCOME-1 / AUTH-PERMISSIONS-4). Uses addInitScript so the
 * localStorage keys are present on first paint, before the gate reads
 * them. Defaults to "fully onboarded" (both dismissed) so the normal
 * sign-in path lands straight in the app; onboarding specs override.
 */
export async function setOnboardingFlags(
  page: Page,
  {
    welcomeDismissed = true,
    permsDone = true,
    trialNoticeSeen = true,
    trialExpiredSeen = true,
    addNudgeSeen = true,
    uid,
  }: {
    welcomeDismissed?: boolean;
    permsDone?: boolean;
    /** LANG-TRIAL-5 — dismiss the trial sheet before first paint. Default true. */
    trialNoticeSeen?: boolean;
    /** LANG-TRIAL-10 — dismiss the EXPIRY sheet before first paint. Default true. */
    trialExpiredSeen?: boolean;
    /** CARDS-FAB-5 — mark this launch's Play-FAB nudge as already shown. Default true. */
    addNudgeSeen?: boolean;
    /** Required to seed the trial flag, which is keyed per ACCOUNT. */
    uid?: string;
  } = {},
): Promise<void> {
  await page.addInitScript(
    (flags: {
      welcomeDismissed: boolean;
      permsDone: boolean;
      trialNoticeSeen: boolean;
      trialExpiredSeen: boolean;
      addNudgeSeen: boolean;
      uid?: string;
    }) => {
      try {
        // welcome is per-page-load now (in-memory, seeded from sessionStorage);
        // perms remains a persisted localStorage device fact.
        const seedSession = (k: string, v: boolean) =>
          v ? sessionStorage.setItem(k, '1') : sessionStorage.removeItem(k);
        const setLocal = (k: string, v: boolean) =>
          v ? localStorage.setItem(k, '1') : localStorage.removeItem(k);
        seedSession('wurld.onboarding.welcomeDismissed.v1', flags.welcomeDismissed);
        setLocal('wurld.onboarding.permsWalkthrough.v1', flags.permsDone);
        // LANG-TRIAL-5 — the trial sheet is a MODAL over the whole app, shown
        // once per account. Every E2E user is a brand-new account whose
        // `onUserCreated` trigger has just granted a live trial, so without
        // this EVERY spec that reaches a chat finds the composer behind an
        // overlay — which is exactly how it was found: `send-hints` failing on
        // "element(s) not found" with the sheet sitting in the screenshot.
        //
        // Suppressed by DEFAULT and opted back IN by `trial.spec.ts`, rather
        // than each spec dismissing it: a modal that every other spec has to
        // work around is a modal that will silently break the next spec
        // somebody writes.
        // CARDS-FAB-5 — the once-per-launch "Add phrases" nudge widens the add FAB over
        // the bottom-right of /cards for ~3.7s. Marked shown by DEFAULT so no
        // spec races it; `cards-add-nudge.spec.ts` opts back in. Only
        // WRITES when suppressing — opting in must not erase a mark the nudge
        // spec relies on across its own navigations.
        if (flags.addNudgeSeen) {
          sessionStorage.setItem('wurld.cards.addNudge.shownThisLaunch.v1', '1');
        }
        if (flags.uid) {
          setLocal(`wurld.trial.noticeSeen.v1.${flags.uid}`, flags.trialNoticeSeen);
          // LANG-TRIAL-10 — the OTHER end of the same trial, and a DISTINCT key
          // by design, so the line above does not cover it. This one matters for
          // a specific and non-obvious reason: several specs manufacture an
          // unentitled user by writing a LAPSED `trialEndsAt` (`chat-passthrough`,
          // `plus-feature-gates`), which is exactly the condition this sheet
          // fires on. Without suppressing it here, adding the expiry notice
          // silently drops a modal over the composer in every one of them.
          setLocal(`wurld.trial.expiredSeen.v1.${flags.uid}`, flags.trialExpiredSeen);
        }
      } catch {
        /* private mode — ignore */
      }
    },
    { welcomeDismissed, permsDone, trialNoticeSeen, trialExpiredSeen, addNudgeSeen, uid },
  );
}

export async function signInBrowser(
  page: Page,
  user: AuthenticatedUser,
  opts: {
    welcomeDismissed?: boolean;
    permsDone?: boolean;
    /** LANG-TRIAL-5 — pass false to let the trial sheet render (trial.spec.ts). */
    trialNoticeSeen?: boolean;
    /** LANG-TRIAL-10 — pass false to let the EXPIRY sheet render
     *  (trial-expiry.spec.ts). */
    trialExpiredSeen?: boolean;
    /** CARDS-FAB-5 — pass false to let the daily Play-FAB nudge play
     *  (cards-practice-nudge.spec.ts). */
    addNudgeSeen?: boolean;
  } = {},
): Promise<void> {
  // Default: skip welcome + permissions + both trial sheets so existing specs
  // land in the app rather than behind a modal.
  await setOnboardingFlags(page, {
    welcomeDismissed: opts.welcomeDismissed ?? true,
    permsDone: opts.permsDone ?? true,
    trialNoticeSeen: opts.trialNoticeSeen ?? true,
    trialExpiredSeen: opts.trialExpiredSeen ?? true,
    addNudgeSeen: opts.addNudgeSeen ?? true,
    uid: user.uid,
  });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  // Wait for the JS bundle to execute and expose __testSignIn. A fixed sleep
  // raced the bundle under parallel load (a cold Vite transform can take well
  // over 2s), so wait on the hook itself; the evaluate below still reports a
  // clear error if it never appears.
  await page
    .waitForFunction(() => typeof (window as { __testSignIn?: unknown }).__testSignIn === 'function', null, {
      timeout: 30_000,
    })
    .catch(() => undefined);
  const result = await page.evaluate(async (token: string) => {
    const w = window as unknown as {
      __testSignIn?: (t: string) => Promise<void>;
    };
    if (!w.__testSignIn) {
      return {
        error:
          '__testSignIn not found on window. Ensure the dev server was started with VITE_E2E_TEST=true',
      };
    }
    try {
      await w.__testSignIn(token);
      return { error: null };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, user.customToken);
  if (result.error) throw new Error(`signInBrowser failed: ${result.error}`);
  // Wait for the auth state to propagate + the router to advance to the
  // chat list.
  await page.waitForTimeout(2_000);
}

export async function signOutBrowser(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as { __testSignOut?: () => Promise<void> };
    if (w.__testSignOut) await w.__testSignOut();
  });
  await page.waitForTimeout(500);
}
