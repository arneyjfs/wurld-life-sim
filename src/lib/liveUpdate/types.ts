/**
 * OTA-* (docs/specs/live-updates.md) — the shapes the live-update modules
 * share. A leaf: no imports beyond the store's channel type, so `decide.ts`
 * stays free of Capacitor.
 */
import type { LiveChannel } from './store';

export type { LiveChannel };

/** The two shells. `App.getInfo().build` numbers are comparable per platform only (OBS-VERSION-6). */
export type NativePlatform = 'ios' | 'android';

/**
 * §3a — the channel's hosting manifest (`/live/manifest.json`), as published
 * by `scripts/release/live-bundle.mjs` and validated by `manifest.ts`.
 * `nativeBuiltAgainst` is informational and dropped on parse.
 */
export interface LiveManifest {
  schema: 1;
  channel: LiveChannel;
  version: string;
  gitSha: string;
  /** ISO time the bundle was built — the publisher's clock, used to tell a downgrade (OTA-14). */
  builtAt: string;
  /** D3 — the hosting-side brake, independent of the policy's (OTA-16). */
  enabled: boolean;
  /** D8 — the native floor from `native-floor.json`; the policy may only raise it. */
  minNative: { ios: number; android: number };
  bundle: {
    url: string;
    /** Lowercase hex SHA-256 of the zip — what the plugin compares (D10). */
    sha256: string;
    bytes: number;
  };
}

/** §3b — the levers from Firestore `config/liveUpdate.<channel>`, via `liveUpdatePolicy`. */
export interface LiveUpdatePolicy {
  enabled: boolean;
  resetToBuiltin: boolean;
  /** Optional override; the client takes `max(manifest.minNative, policy.minNative)` (OTA-16). */
  minNative: { ios: number; android: number } | null;
  /** ISO time after which a shell below the floor is blocked instead of prompted; null = block at once. */
  enforceAt: string | null;
}

/** OTA-8 — a version the plugin rolled back from, keyed by the shell it failed on. */
export interface FailedVersion {
  version: string;
  nativeBuild: number;
}

/** OTA-12 — the one self-heal attempt per (manifest version, native build). */
export interface SelfHealAttempt {
  version: string;
  nativeBuild: number;
}

/** The plugin's id for the bundle baked into the binary. */
export const BUILTIN_BUNDLE_ID = 'builtin';

/**
 * D4 — what `wurld.ota.pendingBundleId` holds: a downloaded bundle waiting
 * for the next cold launch / long resume, or `{ id: 'builtin' }` for a reset
 * (OTA-7). `channel` and `builtAt` are the provenance OTA-14 needs to tell a
 * channel change or a downgrade from a plain forward update at apply time.
 */
export interface PendingBundle {
  id: string;
  version?: string;
  channel?: LiveChannel;
  builtAt?: string;
}

export function isPendingReset(pending: PendingBundle): boolean {
  return pending.id === BUILTIN_BUNDLE_ID;
}
