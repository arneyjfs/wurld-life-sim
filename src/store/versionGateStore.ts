import { create } from 'zustand';

/**
 * BOOT-GATE-* / OBS-VERSION-11 — whether this build is below the version floor.
 *
 * `unknown` until the first check completes, and on every check that could not
 * read the floor: the gate fails open (BOOT-GATE-1), so `unknown` renders the
 * app exactly like `ok`. `blocked` is set by a completed check that found this
 * build below the floor, or by any Cloud Function answering 426.
 * `checkedAtMs` is the last check that COMPLETED (read the floor), which is
 * what the resume re-check (BOOT-GATE-2) measures its interval from.
 */
export type VersionGateStatus = 'unknown' | 'ok' | 'blocked';

type VersionGateState = {
  status: VersionGateStatus;
  floor: string | null;
  checkedAtMs: number | null;
  /**
   * OTA-6 — the native-floor prompt ("A newer version of Wurld is available")
   * was dismissed with "Later" this page load. Once per launch by design: in
   * memory only, never persisted, so the next cold launch asks again (and the
   * block after `enforceAt` ignores it).
   */
  nativeFloorPromptDismissed: boolean;
};

export const useVersionGateStore = create<VersionGateState>(() => ({
  status: 'unknown',
  floor: null,
  checkedAtMs: null,
  nativeFloorPromptDismissed: false,
}));
