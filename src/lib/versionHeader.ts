/**
 * OBS-VERSION-9 / OBS-VERSION-11 — the parts of the version floor the Cloud
 * Functions fetch seams need: the `X-Wurld-Version` header and the "a 426
 * blocks now" hook. A near-leaf module (build constants, log, the gate store)
 * so `endpoints.ts`, `gemini.ts` and `imageUpload.ts` can import it without
 * an import cycle back through `versionFloor.ts` → `endpoints.ts`.
 */
import { frontendBuild } from './buildInfo';
import * as log from './log';
import { useVersionGateStore } from '@/store/versionGateStore';

export const VERSION_HEADER = 'X-Wurld-Version';

/** OBS-VERSION-9 — spread into the headers of every functions fetch. */
export function wurldVersionHeaders(): Record<string, string> {
  return { [VERSION_HEADER]: frontendBuild.version };
}

/** OBS-VERSION-11 — a function answered 426. Block now. */
export function reportUpgradeRequired(floor: string | null): void {
  const prev = useVersionGateStore.getState();
  if (prev.status !== 'blocked') log.warn('version gate: server answered 426', { floor });
  useVersionGateStore.setState({ status: 'blocked', floor: floor ?? prev.floor });
  startSelfHeal();
}

/**
 * OTA-12 / D9 (docs/specs/live-updates.md) — what a 426 starts besides the
 * block: in a live-update runtime, ONE attempt per page load to download and
 * apply the channel's current bundle before the user is sent to the store.
 * Every later 426 of the same page load (each call the old bundle still
 * makes) is ignored. The outcome is the runner's to show (its own store
 * drives the "Updating…" state; retries are bounded across launches in
 * Preferences), not this module's.
 *
 * A REGISTRATION SEAM rather than an import. This module is a near-leaf that
 * every fetch seam imports (see the header), and the live-update runner
 * imports those seams through `liveUpdateApi` — a static import would be a
 * cycle, and a dynamic one is ineffective (BOOT-SPLIT-4): `main.tsx` imports
 * the runner statically for its boot step, so the module is in the entry
 * chunk regardless and Rollup rejects the build. The runner registers itself
 * at boot (`src/lib/liveUpdate/boot.ts`); on the web nothing registers and a
 * 426 is just the block.
 */
let upgradeRequiredHandler: (() => void) | null = null;
/** OTA-12 — the handler ran this page load (at most once). */
let selfHealStarted = false;

/** Register (or, with `null`, remove) the 426 handler. One at a time. */
export function onUpgradeRequired(handler: (() => void) | null): void {
  upgradeRequiredHandler = handler;
}

function startSelfHeal(): void {
  if (selfHealStarted || !upgradeRequiredHandler) return;
  selfHealStarted = true;
  try {
    upgradeRequiredHandler();
  } catch (err: unknown) {
    // Never throws by contract; belt and braces — the block already stands.
    log.warn('version gate: self-heal after 426 failed', { err });
  }
}

/** Test seam: forget the handler and that it ran (one page load per test). */
export function _resetUpgradeRequiredSelfHealForTests(): void {
  selfHealStarted = false;
  upgradeRequiredHandler = null;
}

/** Pull the floor out of a 426 body (`{ error, minSupportedVersion }`). */
export function floorFrom426Body(body: string): string | null {
  try {
    const raw = (JSON.parse(body) as { minSupportedVersion?: unknown }).minSupportedVersion;
    return typeof raw === 'string' ? raw : null;
  } catch {
    return null;
  }
}

