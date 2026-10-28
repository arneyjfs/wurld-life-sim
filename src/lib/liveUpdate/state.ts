/**
 * §3c "State in Capacitor Preferences" (docs/specs/live-updates.md) — typed
 * get/set for every `wurld.ota.*` key.
 *
 * Preferences live in UserDefaults / SharedPreferences, so they survive bundle
 * swaps AND store updates — which is why `failedVersions` (OTA-8) and
 * `selfHealAttempted` (OTA-12) carry the native build: the plugin's own state
 * is wiped by `resetWhenUpdate`, ours is not, and a version that only failed
 * on an older shell must be retried on the newer one.
 *
 * Reads are tolerant: malformed content reads as absent, never throws. Writes
 * propagate the plugin's rejection; the runner / boot catch at one place.
 * Native-only by construction (the web stub of Preferences is localStorage,
 * and nothing calls this off-native except `swRegister`'s guarded read).
 */
import { Preferences } from '@capacitor/preferences';
import type { LiveChannel } from './store';
import type { FailedVersion, PendingBundle, SelfHealAttempt } from './types';

export const OTA_KEYS = {
  channel: 'wurld.ota.channel',
  builtinChannel: 'wurld.ota.builtinChannel',
  failedVersions: 'wurld.ota.failedVersions',
  lastCheckAt: 'wurld.ota.lastCheckAt',
  pendingBundleId: 'wurld.ota.pendingBundleId',
  selfHealAttempted: 'wurld.ota.selfHealAttempted',
  swUnregistered: 'wurld.ota.swUnregistered',
} as const;

/** OTA-8 — enough to remember every rollback a device could plausibly see. */
const MAX_FAILED_VERSIONS = 20;

async function read(key: string): Promise<string | null> {
  const { value } = await Preferences.get({ key });
  return value;
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isChannel(v: unknown): v is LiveChannel {
  return v === 'beta' || v === 'prod';
}

function isBuildEntry(v: unknown): v is { version: string; nativeBuild: number } {
  return (
    isRecord(v) &&
    typeof v.version === 'string' &&
    typeof v.nativeBuild === 'number' &&
    Number.isFinite(v.nativeBuild)
  );
}

async function readMs(key: string): Promise<number | null> {
  const raw = await read(key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ── OTA-9 — channel ─────────────────────────────────────────────────────

export async function getCachedChannel(): Promise<LiveChannel | null> {
  const raw = await read(OTA_KEYS.channel);
  return isChannel(raw) ? raw : null;
}

export async function setCachedChannel(channel: LiveChannel): Promise<void> {
  await Preferences.set({ key: OTA_KEYS.channel, value: channel });
}

/**
 * D5 — the channel of the STORE build: the one baked into the built-in
 * bundle, recorded whenever the built-in bundle is the one running (first
 * launch, and after every store update since `resetWhenUpdate` returns to
 * it). It is what the policy call names as `deviceChannel`, so clearing an
 * admin pin brings the device back to its store channel rather than leaving
 * it on the pinned channel's bundle (whose own baked channel IS the pin).
 */
export async function getBuiltinChannel(): Promise<LiveChannel | null> {
  const raw = await read(OTA_KEYS.builtinChannel);
  return isChannel(raw) ? raw : null;
}

export async function setBuiltinChannel(channel: LiveChannel): Promise<void> {
  await Preferences.set({ key: OTA_KEYS.builtinChannel, value: channel });
}

// ── OTA-8 — failedVersions ──────────────────────────────────────────────

export async function getFailedVersions(): Promise<FailedVersion[]> {
  const parsed = parseJson(await read(OTA_KEYS.failedVersions));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isBuildEntry).map((e) => ({ version: e.version, nativeBuild: e.nativeBuild }));
}

/** Append (deduped on version + native build), bounded, and return the new list. */
export async function addFailedVersion(entry: FailedVersion): Promise<FailedVersion[]> {
  const current = await getFailedVersions();
  const without = current.filter(
    (e) => !(e.version === entry.version && e.nativeBuild === entry.nativeBuild),
  );
  const next = [...without, entry].slice(-MAX_FAILED_VERSIONS);
  await Preferences.set({ key: OTA_KEYS.failedVersions, value: JSON.stringify(next) });
  return next;
}

// ── BOOT-GATE-2 cadence / D4 timing ─────────────────────────────────────

export function getLastCheckAt(): Promise<number | null> {
  return readMs(OTA_KEYS.lastCheckAt);
}

export async function setLastCheckAt(ms: number): Promise<void> {
  await Preferences.set({ key: OTA_KEYS.lastCheckAt, value: String(ms) });
}


// ── D4 — pendingBundleId ────────────────────────────────────────────────

export async function getPendingBundle(): Promise<PendingBundle | null> {
  const parsed = parseJson(await read(OTA_KEYS.pendingBundleId));
  if (!isRecord(parsed) || typeof parsed.id !== 'string' || parsed.id.length === 0) return null;
  const pending: PendingBundle = { id: parsed.id };
  if (typeof parsed.version === 'string') pending.version = parsed.version;
  if (isChannel(parsed.channel)) pending.channel = parsed.channel;
  if (typeof parsed.builtAt === 'string') pending.builtAt = parsed.builtAt;
  return pending;
}

export async function setPendingBundle(pending: PendingBundle): Promise<void> {
  await Preferences.set({ key: OTA_KEYS.pendingBundleId, value: JSON.stringify(pending) });
}

export async function clearPendingBundle(): Promise<void> {
  await Preferences.remove({ key: OTA_KEYS.pendingBundleId });
}

// ── OTA-12 — selfHealAttempted ──────────────────────────────────────────

export async function getSelfHealAttempted(): Promise<SelfHealAttempt | null> {
  const parsed = parseJson(await read(OTA_KEYS.selfHealAttempted));
  return isBuildEntry(parsed) ? { version: parsed.version, nativeBuild: parsed.nativeBuild } : null;
}

export async function setSelfHealAttempted(attempt: SelfHealAttempt): Promise<void> {
  await Preferences.set({ key: OTA_KEYS.selfHealAttempted, value: JSON.stringify(attempt) });
}

// ── OTA-13 — swUnregistered ─────────────────────────────────────────────

export async function getSwUnregistered(): Promise<boolean> {
  return (await read(OTA_KEYS.swUnregistered)) === '1';
}

export async function setSwUnregistered(): Promise<void> {
  await Preferences.set({ key: OTA_KEYS.swUnregistered, value: '1' });
}
