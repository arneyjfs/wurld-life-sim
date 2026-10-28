import { callHttp } from './endpoints';
import { frontendBuild, type FrontendBuildInfo } from './buildInfo';

// OBS-VERSION-1 — the constants live in the leaf module `./buildInfo` (no
// imports) so the functions fetch seam can read the version for
// X-Wurld-Version (OBS-VERSION-9) without an import cycle through this file.
export { frontendBuild, type FrontendBuildInfo };

/**
 * OBS-VERSION-*: single source of build/version truth for the UI + debug copy.
 *
 * Frontend provenance is injected at build time by Vite `define`
 * (vite.config.ts → resolveBuildInfo); backend provenance comes from the
 * `getVersion` Cloud Function. The settings footer shows both so a tester can
 * confirm exactly what's running, and the copy-debug button bundles it with the
 * UID for sharing.
 */

export interface BackendVersion {
  version: string;
  gitSha?: string;
  /** ISO timestamp the functions deploy landed (`functions/buildInfo.json`). */
  builtAt?: string | null;
  /**
   * `'beta' | 'prod'` — the channel that deploy was prepared for.
   *
   * ⚠ OPTIONAL because `getVersion` does NOT return it today.
   * `scripts/prepare-version.mjs` writes `channel` into
   * `functions/buildInfo.json`, but `readBackendBuildInfo()` in
   * `functions/src/index.ts` reads back only `version`/`gitSha`/`builtAt`.
   * Verified live 2026-09-22 against both projects:
   *   wurld-beta  → {"version":"0.2.2","gitSha":"b5011fa","builtAt":"…"}
   *   wurld-e27d8 → {"version":"0.2.1","gitSha":"10704ed","builtAt":"…"}
   * SETTINGS-ABOUT-3 forbids inferring it from `VITE_FUNCTIONS_URL` or from
   * the frontend's own channel, so until that function returns the field the
   * server row carries no channel tag.
   */
  channel?: string;
}

/** Compact version line, e.g. `v0.1.0 · beta · a1b2c3d` (prod omits the channel). */
export function formatFrontendVersion(b: FrontendBuildInfo = frontendBuild): string {
  return formatVersionLine(b.version, b.channel, b.gitSha);
}

/** The one shape both rows use. OBS-VERSION-5: a pre-release version already
 *  ends in `.<sha>`, so the separate sha segment is dropped rather than
 *  printed twice — but a DIFFERENT sha is kept, since that is two builds. */
function formatVersionLine(version: string, channel?: string | null, gitSha?: string): string {
  const parts = [`v${version}`];
  if (channel && channel !== 'prod') parts.push(channel);
  if (gitSha && gitSha !== 'unknown' && !version.endsWith(`.${gitSha}`)) parts.push(gitSha);
  return parts.join(' · ');
}

/**
 * SETTINGS-ABOUT-1 — the backend's version line, in the SAME shape
 * `formatFrontendVersion` produces: `v0.2.2 · beta · b5011fa`.
 *
 * Symmetry is the invariant, not a nicety. The card exists so a reader can
 * compare two builds at a glance, and two differently-formatted lines make
 * that a reading exercise. Each segment is omitted on exactly the same rule as
 * the frontend's: `prod` is the default channel and prints nothing, and an
 * `unknown` sha prints nothing rather than the word "unknown".
 *
 * ⚠ A missing `channel` is NOT filled in from anywhere (SETTINGS-ABOUT-3).
 */
export function formatBackendVersion(b: BackendVersion): string {
  return formatVersionLine(b.version, b.channel, b.gitSha);
}

/** Fetch the deployed backend version (`getVersion`). */
export function getBackendVersion(signal?: AbortSignal): Promise<BackendVersion> {
  return callHttp<null, BackendVersion>('getVersion', null, { method: 'GET', signal });
}

/**
 * OTA-11 (docs/specs/live-updates.md §3d) — the native shell's facts: in a
 * live-update runtime the bundle, the shell and the channel are three
 * different things, and a report from a device has to say which is which.
 * `bundleId` is the updater plugin's `current()` id (`builtin` when the baked
 * bundle runs).
 */
export interface NativeDebugInfo {
  nativeBuild: number | null;
  channel: string | null;
  bundleId: string | null;
  bundleVersion?: string | null;
}

/** A shareable plain-text debug blob: both versions, build, runtime, UID,
 *  and on native the shell build / channel / bundle id (OTA-11). */
export function buildDebugInfo(opts: {
  uid?: string | null;
  backend?: BackendVersion | null;
  runtime?: string;
  build?: FrontendBuildInfo;
  native?: NativeDebugInfo | null;
}): string {
  const b = opts.build ?? frontendBuild;
  const backend = opts.backend
    ? `v${opts.backend.version}${opts.backend.gitSha && opts.backend.gitSha !== 'unknown' ? ` (${opts.backend.gitSha})` : ''}`
    : '(unavailable)';
  const lines = [
    'Wurld debug info',
    `frontend: v${b.version} (${b.channel}, ${b.gitSha})`,
    `  built: ${b.buildTime || 'n/a'}`,
    `backend:  ${backend}`,
    `uid: ${opts.uid ?? '(signed out)'}`,
    `runtime: ${opts.runtime ?? 'unknown'}`,
  ];
  if (opts.native) {
    const { nativeBuild, channel, bundleId, bundleVersion } = opts.native;
    lines.push(
      `native build: ${nativeBuild ?? 'unknown'}`,
      `ota channel: ${channel ?? 'unknown'}`,
      `ota bundle: ${bundleId ? `${bundleId}${bundleVersion ? ` (v${bundleVersion})` : ''}` : 'unknown'}`,
    );
  }
  lines.push(`ua: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}`);
  return lines.join('\n');
}
