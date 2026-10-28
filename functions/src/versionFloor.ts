/**
 * OBS-VERSION-7 / OBS-VERSION-8 / OBS-VERSION-10 — the version floor, server side.
 * Spec: docs/specs/observability.md §4.
 *
 * `config/version` is one Firestore document, `{ minSupportedVersion: "X.Y.Z" }`,
 * set by the owner from the console. Clients send `X-Wurld-Version` on every
 * call (OBS-VERSION-9); a call below the floor is refused with
 * `426 { error: "upgrade_required", minSupportedVersion }` before auth and
 * before any spend.
 *
 * Read through a 60-second per-instance cache, exactly like the Gemini kill
 * switch (runtimeConfig.ts, LIMIT-3): one read per instance per minute. A read
 * failure keeps the last known floor, or NO floor when nothing is cached — a
 * Firestore blip must not lock every client out; the floor is a release-safety
 * lever, not a security boundary (a client can lie in the header).
 *
 * `getVersion` reads the doc UNCACHED (`readVersionFloorFresh`) — it is what
 * the client gate asks, once per cold boot, and a stale answer there is the
 * lag the gate exists to remove.
 */
import { getFirestore } from "firebase-admin/firestore";

export const VERSION_CONFIG_PATH = "config/version";
export const VERSION_FLOOR_TTL_MS = 60_000;
/** Express lower-cases header names. */
export const VERSION_HEADER = "x-wurld-version";
export const UPGRADE_REQUIRED_STATUS = 426;
export const UPGRADE_REQUIRED_CODE = "upgrade_required";

/**
 * ⚠ AFTER-CHECKPOINTS.md — "Reject a missing X-Wurld-Version". Builds before
 * 0.3.1 never sent the header, so a missing (or unparseable) header is allowed
 * until the floor is at or past the first release that sends it. Flipping this
 * early locks out every such client with no screen to tell them why.
 */
export const ALLOW_MISSING_VERSION_HEADER = true;

// ---------------------------------------------------------------------------
// OBS-VERSION-8 — comparison. ⚠ TWIN of src/lib/semverFloor.ts, parity-tested
// by __tests__/versionFloorParity.test.ts.
// ---------------------------------------------------------------------------

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(raw: unknown): Semver | null {
  if (typeof raw !== "string") return null;
  const m = SEMVER_RE.exec(raw.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ?? null };
}

export function isBelowFloor(version: unknown, floor: unknown): boolean {
  const v = parseSemver(version);
  const f = parseSemver(floor);
  if (!v || !f) return false;
  if (v.major !== f.major) return v.major < f.major;
  if (v.minor !== f.minor) return v.minor < f.minor;
  if (v.patch !== f.patch) return v.patch < f.patch;
  return v.pre !== null && f.pre === null;
}

// ---------------------------------------------------------------------------
// OBS-VERSION-7 — reading the floor.
// ---------------------------------------------------------------------------

/** The floor a document states, or null (absent / empty / unparseable). */
export function floorFromDoc(data: Record<string, unknown> | null | undefined): string | null {
  const raw = data?.minSupportedVersion;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return parseSemver(trimmed) ? trimmed : null;
}

export type VersionConfigReader = () => Promise<Record<string, unknown> | null | undefined>;

/** Build a cached floor reader over an injected document reader. */
export function createVersionFloorReader(
  read: VersionConfigReader,
  opts: { ttlMs?: number; now?: () => number } = {},
): () => Promise<string | null> {
  const ttlMs = opts.ttlMs ?? VERSION_FLOOR_TTL_MS;
  const now = opts.now ?? Date.now;
  let cached: { value: string | null; fetchedAt: number } | null = null;
  let inFlight: Promise<string | null> | null = null;

  return async () => {
    if (cached && now() - cached.fetchedAt < ttlMs) return cached.value;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const value = floorFromDoc(await read());
        cached = { value, fetchedAt: now() };
        return value;
      } catch (err) {
        console.error(`[versionFloor] failed to read ${VERSION_CONFIG_PATH}; using ${cached ? "last known floor" : "no floor"}`, err);
        return cached ? cached.value : null;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };
}

async function readVersionDoc(): Promise<Record<string, unknown> | null> {
  const snap = await getFirestore().doc(VERSION_CONFIG_PATH).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

/** OBS-VERSION-10 — the production (cached) reader used by enforcement. */
export const readVersionFloor: () => Promise<string | null> = createVersionFloorReader(readVersionDoc);

/** OBS-VERSION-7 — uncached, fail-open read for `getVersion`. */
export async function readVersionFloorFresh(): Promise<string | null> {
  try {
    return floorFromDoc(await readVersionDoc());
  } catch (err) {
    console.error(`[versionFloor] getVersion could not read ${VERSION_CONFIG_PATH}; reporting no floor`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// OBS-VERSION-10 — enforcement.
// ---------------------------------------------------------------------------

export function versionFloorDecision(
  header: unknown,
  floor: string | null,
  allowMissing: boolean = ALLOW_MISSING_VERSION_HEADER,
): "allow" | "reject" {
  if (!floor) return "allow";
  const version = typeof header === "string" && parseSemver(header) ? header : null;
  if (version === null) return allowMissing ? "allow" : "reject";
  return isBelowFloor(version, floor) ? "reject" : "allow";
}

type HeaderBag = Record<string, string | string[] | undefined>;
type VersionedRequest = { method?: string; headers: HeaderBag };
type Responder = { status: (code: number) => { json: (body: unknown) => unknown } };

/**
 * Refuse a below-floor call with 426. Returns `true` when the handler may
 * proceed; on `false` the response has been sent and the caller MUST return.
 * A preflight is never refused, and a call with no usable header does not
 * cost a floor read while missing headers are allowed.
 */
export async function enforceVersionFloor(
  req: VersionedRequest,
  res: Responder,
  readFloor: () => Promise<string | null> = readVersionFloor,
): Promise<boolean> {
  if (req.method === "OPTIONS") return true;
  const header = req.headers[VERSION_HEADER];
  if (ALLOW_MISSING_VERSION_HEADER && !(typeof header === "string" && parseSemver(header))) return true;
  const floor = await readFloor();
  if (versionFloorDecision(header, floor) === "allow") return true;
  res.status(UPGRADE_REQUIRED_STATUS).json({ error: UPGRADE_REQUIRED_CODE, minSupportedVersion: floor });
  return false;
}

/** Wrap an HTTP handler so it only runs for calls at or above the floor. */
export function withVersionFloor<Req extends VersionedRequest, Res extends Responder>(
  handler: (req: Req, res: Res) => unknown,
  readFloor: () => Promise<string | null> = readVersionFloor,
): (req: Req, res: Res) => Promise<void> {
  return async (req, res) => {
    if (!(await enforceVersionFloor(req, res, readFloor))) return;
    await handler(req, res);
  };
}
