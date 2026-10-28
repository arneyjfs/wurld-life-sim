/**
 * appCheck.ts — Firebase App Check verification for the HTTP Cloud Functions.
 *
 * Spec: `docs/specs/app-check.md` (APPCHECK-6..10).
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  THE ENFORCEMENT POSTURE IS THE CONSTANT BELOW. NOTHING ELSE.        ║
 * ║                                                                     ║
 * ║  'monitor'  → FAIL OPEN. Every request proceeds. The verdict is      ║
 * ║               classified and log-sampled so you can measure what     ║
 * ║               enforcement WOULD have rejected. This is what makes    ║
 * ║               shipping this file before any client sends a token a   ║
 * ║               no-op instead of a total outage.                       ║
 * ║                                                                     ║
 * ║  'enforce'   → FAIL CLOSED. A missing or invalid token is a 401,     ║
 * ║               raised inside verifyAuth, before the handler spends    ║
 * ║               anything.                                             ║
 * ║                                                                     ║
 * ║  ⚠ DO NOT FLIP TO 'enforce' UNTIL ALL OF THESE HOLD — the full       ║
 * ║    checklist and the console steps are in docs/specs/app-check.md    ║
 * ║    §5, and flipping without them locks real users out:               ║
 * ║      • a reCAPTCHA site key exists and every serving domain is       ║
 * ║        authorised on it;                                            ║
 * ║      • VITE_FIREBASE_APPCHECK_SITE_KEY is set for the channel;       ║
 * ║      • callHttp (src/lib/endpoints.ts) actually ATTACHES the token;  ║
 * ║      • native (Capacitor) clients can attest — reCAPTCHA cannot      ║
 * ║        attest capacitor://localhost, so today they cannot;           ║
 * ║      • a week of monitor-mode logs shows ~0% unverified.             ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Deliberately free of `firebase-admin` at module scope: the Admin SDK is
 * `require`d lazily on the token path only, so a request with no App Check
 * header costs nothing (APPCHECK-9) and this module stays unit-testable
 * without standing up the SDK.
 */

/** Posture. See the box above. APPCHECK-6. */
export type AppCheckEnforcement = "monitor" | "enforce";

/**
 * ⚠ THE SWITCH. One word. Changing it changes the behaviour of every endpoint
 * that calls `verifyAuth`. Read the box above before touching it.
 */
export const APP_CHECK_ENFORCEMENT: AppCheckEnforcement = "monitor";

/**
 * `valid`   — header present, the App Check backend accepted the token.
 * `missing` — no header. No network call was made.
 * `invalid` — header present, verification failed: expired, forged, wrong
 *             project — OR the App Check backend was unreachable. Folding
 *             "forged" together with "outage" is safe in `monitor` and is
 *             exactly the risk §5 makes you measure before `enforce`.
 */
export type AppCheckVerdict = "valid" | "missing" | "invalid";

/**
 * Lowercase because Node/Express normalises incoming header names. The client
 * sends the canonical `X-Firebase-AppCheck`.
 */
export const APP_CHECK_HEADER = "x-firebase-appcheck";

/** Thrown by `enforceAppCheck` ONLY in `enforce` posture. Callers map it to 401. */
export class AppCheckRejection extends Error {
  constructor() {
    // Intentionally verdict-free: `missing` and `invalid` must be
    // indistinguishable to the caller (APPCHECK-8). The distinction lives in
    // the log line, not in the response.
    super("App Check verification failed");
    this.name = "AppCheckRejection";
  }
}

export type RequestHeaders =
  | Record<string, string | string[] | undefined>
  | undefined;

/** APPCHECK-7/8 — the entire fail-open/fail-closed rule, as one pure function. */
export function shouldRejectAppCheck(
  verdict: AppCheckVerdict,
  posture: AppCheckEnforcement,
): boolean {
  if (posture !== "enforce") return false;
  return verdict !== "valid";
}

/**
 * APPCHECK-9 — pull the token out of the headers. Returns `null` for absent,
 * empty, or whitespace-only, so the caller can skip the network entirely.
 */
export function readAppCheckToken(headers: RequestHeaders): string | null {
  if (!headers) return null;
  let raw = headers[APP_CHECK_HEADER];
  if (raw === undefined) {
    // Defensive: a caller that isn't Express (a test double, a future
    // framework) may not have normalised the case.
    const hit = Object.keys(headers).find(
      (k) => k.toLowerCase() === APP_CHECK_HEADER,
    );
    if (hit) raw = headers[hit];
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  const token = typeof value === "string" ? value.trim() : "";
  return token.length > 0 ? token : null;
}

/** Verifies a token against the real App Check backend. */
export type AppCheckVerifier = (token: string) => Promise<unknown>;

async function verifyWithAdmin(token: string): Promise<unknown> {
  // Lazy require — see the module header. `admin.appCheck()` needs the default
  // app, which `firebaseConfig.ts` has initialised long before any request
  // arrives.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const admin = require("firebase-admin") as typeof import("firebase-admin");
  return admin.appCheck().verifyToken(token);
}

/**
 * Classify a request. NEVER throws: a verifier that rejects — or that throws
 * synchronously, e.g. because the Admin SDK isn't initialised — is `invalid`,
 * which the posture then decides what to do with.
 */
export async function classifyAppCheck(
  headers: RequestHeaders,
  verify: AppCheckVerifier = verifyWithAdmin,
): Promise<AppCheckVerdict> {
  const token = readAppCheckToken(headers);
  if (!token) return "missing";
  try {
    await verify(token);
    return "valid";
  } catch {
    return "invalid";
  }
}

// ---------------------------------------------------------------------------
// Log sampling (docs/specs/app-check.md §4)
// ---------------------------------------------------------------------------
// Monitor mode exists to answer "what fraction of real traffic would enforce
// reject?". Logging every request to answer it would add a line per request
// forever. One line per verdict per minute per instance is enough to read the
// mix in Cloud Logging and costs nothing. Same shape as the in-memory rate
// limiter in index.ts: a Map that resets on cold start.
//
// NOTE the Firebase console's App Check metrics do NOT cover these functions —
// that page reports on Firebase-managed backends (Firestore, Storage, RTDB,
// callable functions). For onRequest handlers this log line is the only signal.

const LOG_WINDOW_MS = 60_000;
const lastLoggedAt = new Map<AppCheckVerdict, number>();

function logSampled(verdict: AppCheckVerdict, posture: AppCheckEnforcement): void {
  const now = Date.now();
  const last = lastLoggedAt.get(verdict) ?? 0;
  if (now - last < LOG_WINDOW_MS) return;
  lastLoggedAt.set(verdict, now);
  const wouldReject = shouldRejectAppCheck(verdict, "enforce");
  console.log(
    `[appcheck] verdict=${verdict} posture=${posture}` +
      ` enforceWouldReject=${wouldReject}`,
  );
}

export interface EnforceAppCheckOptions {
  verify?: AppCheckVerifier;
  /** Override the module posture. Production callers omit this. */
  posture?: AppCheckEnforcement;
}

/**
 * The middleware entry point, called from `verifyAuth` in `firebaseConfig.ts`.
 *
 * Returns the verdict when the request may proceed. Throws `AppCheckRejection`
 * ONLY when `posture === 'enforce'` and the token is missing or invalid — so in
 * the shipped `monitor` posture this function cannot fail a request no matter
 * what happens inside it (APPCHECK-7).
 */
export async function enforceAppCheck(
  headers: RequestHeaders,
  options: EnforceAppCheckOptions = {},
): Promise<AppCheckVerdict> {
  const posture = options.posture ?? APP_CHECK_ENFORCEMENT;
  let verdict: AppCheckVerdict;
  try {
    verdict = await classifyAppCheck(headers, options.verify);
  } catch {
    // classifyAppCheck already swallows everything; belt and braces, because
    // an escape from here in monitor mode would be an outage.
    verdict = "invalid";
  }
  logSampled(verdict, posture);
  if (shouldRejectAppCheck(verdict, posture)) throw new AppCheckRejection();
  return verdict;
}
