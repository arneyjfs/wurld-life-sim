/**
 * OTA-* (docs/specs/live-updates.md) — the live-update state the UI reads.
 *
 * Written by the runner (`./runner`), read by `VersionGate` (native floor,
 * OTA-6; self-heal progress, OTA-12) and the About card (OTA-11). A zustand
 * store so the two can subscribe without importing the runner (and the native
 * plugin) into their modules.
 */
import { create } from 'zustand';

export type LiveChannel = 'beta' | 'prod';

/** OTA-6 — where this shell stands against the channel's native floor. */
export type NativeFloorStatus = 'ok' | 'prompt' | 'block';

export interface NativeFloorState {
  status: NativeFloorStatus;
  /** The floor this shell was measured against (this platform), or null. */
  minNative: number | null;
  /** ISO time after which `prompt` becomes `block`, or null = block at once. */
  enforceAt: string | null;
}

export interface LiveUpdateState {
  /** The channel this device follows (OTA-9), null until known. */
  channel: LiveChannel | null;
  /** This shell's native build number (`App.getInfo().build`), null off-native. */
  nativeBuild: number | null;
  nativeFloor: NativeFloorState;
  /** A downloaded bundle waiting for the next cold launch / long resume (D4). */
  pendingVersion: string | null;
  /** OTA-12 — the 426 self-heal, for the blocking screen's "Updating…" state. */
  selfHeal: 'idle' | 'running' | 'failed';
}

export const useLiveUpdateStore = create<LiveUpdateState>(() => ({
  channel: null,
  nativeBuild: null,
  nativeFloor: { status: 'ok', minNative: null, enforceAt: null },
  pendingVersion: null,
  selfHeal: 'idle',
}));
