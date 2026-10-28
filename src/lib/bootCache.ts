/**
 * Synchronous boot-time cache backed by localStorage.
 *
 * Firebase Auth + Firestore both persist to IndexedDB which is async,
 * so on cold-boot the React tree spends an unbounded amount of time
 * (sometimes forever, when offline) gated on `useAuthStore.ready` and
 * `useUserProfile.loading`. That's how an offline app fails to load
 * even though every doc we need is already in IndexedDB.
 *
 * This module shadows the bare minimum needed to render the AppShell
 * synchronously: the last signed-in UID + a flag saying whether that
 * user's profile is complete. Routes consult these immediately and
 * reconcile with the real Firebase state once it arrives.
 *
 * Stored keys are versioned so a schema change can invalidate the
 * cache without leaving a stale boot path live.
 */

// v2: added `onboardingComplete` (BOOT-HYDRATION-8 / AUTH-GATE-2). Bumping
// the version invalidates the v1 cache so a stale boot path never goes live.
const VERSION = 2;
const KEY = `wurld.boot.v${VERSION}`;
/** The live key — `purgeStaleStorageKeys` keeps this one (BOOT-CACHE-4). */
export const BOOT_CACHE_KEY = KEY;

type BootSnapshot = {
  uid: string | null;
  hasProfile: boolean;
  /** All required profile fields + current legal acceptance satisfied last
   *  session. The onboarding gate reads this synchronously before auth
   *  resolves to render the app shell with no onboarding flash. */
  onboardingComplete: boolean;
};

const EMPTY: BootSnapshot = { uid: null, hasProfile: false, onboardingComplete: false };

let cached: BootSnapshot | null = null;

function read(): BootSnapshot {
  if (cached) return cached;
  if (typeof localStorage === 'undefined') {
    cached = { ...EMPTY };
    return cached;
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      cached = { ...EMPTY };
      return cached;
    }
    const parsed = JSON.parse(raw) as Partial<BootSnapshot>;
    cached = {
      uid: typeof parsed.uid === 'string' ? parsed.uid : null,
      hasProfile: parsed.hasProfile === true,
      onboardingComplete: parsed.onboardingComplete === true,
    };
    return cached;
  } catch {
    cached = { ...EMPTY };
    return cached;
  }
}

function write(next: BootSnapshot): void {
  cached = next;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — silently skip */
  }
}

export function getBootSnapshot(): BootSnapshot {
  return read();
}

export function setBootUid(uid: string | null): void {
  const current = read();
  if (current.uid === uid) return;
  // Switching to a different uid invalidates the per-account bits — they
  // belong to the previous account (AUTH-EDGE-4).
  write({ uid, hasProfile: false, onboardingComplete: false });
}

export function setBootHasProfile(hasProfile: boolean): void {
  const current = read();
  if (current.hasProfile === hasProfile) return;
  write({ ...current, hasProfile });
}

export function setBootOnboardingComplete(onboardingComplete: boolean): void {
  const current = read();
  if (current.onboardingComplete === onboardingComplete) return;
  write({ ...current, onboardingComplete });
}

export function clearBootSnapshot(): void {
  cached = { ...EMPTY };
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
