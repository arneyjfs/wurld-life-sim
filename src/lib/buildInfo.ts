/**
 * OBS-VERSION-1 — the frontend build provenance, as compile-time constants.
 * A LEAF module (no imports) so anything — including the Cloud Functions fetch
 * seam (`endpoints.ts`, `versionHeader.ts`) — can read it without an import
 * cycle. Everything else reads it through `src/lib/version.ts`, which
 * re-exports it.
 */

export interface FrontendBuildInfo {
  /** semver from package.json (bumped on prod deploy, steady on beta) */
  version: string;
  /** short git SHA of the build's HEAD, or 'unknown' */
  gitSha: string;
  /** ISO build timestamp */
  buildTime: string;
  /** 'beta' | 'prod' | 'dev' */
  channel: string;
}

// Compile-time constants from Vite `define`. The `typeof` guards keep this safe
// in contexts without the define (vitest), where they resolve to the fallbacks.
export const frontendBuild: FrontendBuildInfo = {
  version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0',
  gitSha: typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'unknown',
  buildTime: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '',
  channel: typeof __BUILD_CHANNEL__ !== 'undefined' ? __BUILD_CHANNEL__ : 'dev',
};

