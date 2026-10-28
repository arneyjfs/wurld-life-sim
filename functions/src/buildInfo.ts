/**
 * OBS-VERSION-2 — the backend's build provenance, read from `package.json` and
 * the deploy-time `buildInfo.json`. Shared by `getVersion` and the server
 * Sentry release (OBS-SRV-1), so a server event's release is the same string
 * the About card shows. Lives at `src/` depth on purpose: the paths below
 * resolve relative to the compiled `lib/` file.
 */
import * as fs from "fs";
import * as path from "path";

// OBS-VERSION-2: backend build provenance. `package.json` version is the
// always-present baseline (kept in lockstep with the frontend by
// scripts/prepare-version.mjs); `buildInfo.json` is written at deploy time with
// the git SHA + timestamp and is absent in local/test runs (hence the fallback).
export function readBackendBuildInfo(): {
  version: string;
  gitSha: string;
  builtAt: string | null;
  channel: string | null;
} {
  let version = "0.0.0";
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    version = (require("../package.json").version as string) || version;
  } catch {
    /* package.json unreadable — keep baseline */
  }
  let gitSha = "unknown";
  let builtAt: string | null = null;
  // SETTINGS-ABOUT-1/3 — the channel THIS deploy was built for. Owner,
  // 2026-09-22: *"server there should also show beta, like app."*
  //
  // ⚠ It has to come from here, and there is a tempting wrong answer. The
  // client could infer it from `VITE_FUNCTIONS_URL` — wurld-beta means beta —
  // and that inference is correct for every deploy made by the npm scripts and
  // WRONG for exactly the deploy somebody has the About card open to diagnose:
  // a hand-run `firebase deploy` in the wrong mode. `prepare-version.mjs` has
  // been writing `channel` into `buildInfo.json` all along; this reads it.
  //
  // ⚠ `null`, not a guess, when the file is absent (local / emulator runs) or
  // predates this change. The client prints no tag rather than a wrong one.
  let channel: string | null = null;
  try {
    const raw = fs.readFileSync(path.join(__dirname, "..", "buildInfo.json"), "utf8");
    const info = JSON.parse(raw) as {
      version?: string;
      gitSha?: string;
      builtAt?: string;
      channel?: string;
    };
    if (info.version) version = info.version;
    if (info.gitSha) gitSha = info.gitSha;
    if (info.builtAt) builtAt = info.builtAt;
    if (info.channel) channel = info.channel;
  } catch {
    /* no buildInfo.json (local/test) — fall back to package.json version */
  }
  return { version, gitSha, builtAt, channel };
}
