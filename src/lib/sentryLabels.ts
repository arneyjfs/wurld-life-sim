/**
 * OBS-LABEL-* (docs/specs/observability.md) — the pure decisions behind how a
 * Sentry event is labelled: which environment it files under, which context
 * keys become tags, which codes are expected outcomes rather than errors, how a
 * route is named, and which stack frames are the wrapper's rather than the
 * culprit's. No SDK import here: `sentry.ts` and `log.ts` apply these, and the
 * unit tests assert them without a client.
 */
import type { ErrorEvent } from '@sentry/react';
import type { AppEnv } from './config';
import type { AppError, ErrorCode } from './errors';

// ── OBS-LABEL-3 — environment ────────────────────────────────────────────────

/** `localhost`, `*.localhost`, `*.local` (mDNS), loopback, and the RFC 1918
 *  private ranges: a page served from any of these is somebody's machine. */
export function isLocalHostname(hostname: string | undefined): boolean {
  if (!hostname) return false;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h === '::1' || h === '0.0.0.0') return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = /^172\.(\d{1,3})\./.exec(h);
  return m !== null && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

/**
 * OBS-LABEL-3 — the Sentry `environment`. A dev-server build, or a web page
 * served from a local / LAN host, is `dev` whatever `VITE_ENV` says.
 *
 * ⚠ A native shell's origin is ALWAYS `localhost` (`capacitor://localhost` on
 * iOS, `https://localhost` on Android), so the hostname rule applies to the web
 * runtimes only; otherwise every store build would file as `dev`.
 */
export function resolveSentryEnvironment(input: {
  configEnv: AppEnv;
  isDevBuild: boolean;
  isNative: boolean;
  hostname: string | undefined;
}): AppEnv {
  if (input.isDevBuild) return 'dev';
  if (!input.isNative && isLocalHostname(input.hostname)) return 'dev';
  return input.configEnv;
}

// ── OBS-LABEL-4 / OBS-LABEL-5 — tags ─────────────────────────────────────────

/** Context key → Sentry tag name. `route` is OBS-LABEL-11's. */
const CONTEXT_TAG_KEYS: Readonly<Record<string, string>> = {
  action: 'action',
  surface: 'surface',
  functionName: 'function',
  httpStatus: 'http_status',
  serverError: 'server_error',
  provider: 'provider',
  method: 'method',
  flow: 'flow',
  route: 'route',
};

function tagValue(v: unknown): string | undefined {
  if (typeof v === 'string') return v.length > 0 ? v.slice(0, 200) : undefined;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/**
 * OBS-LABEL-4 / OBS-LABEL-5 — the tags `log.error` sets: the AppError `code`,
 * the wrapped error's `original_code`, and every triage key of the context
 * (falling back to the HTTP fields the AppError itself carries).
 */
export function labelTags(err: AppError, context: Record<string, unknown> | undefined): Record<string, string> {
  const tags: Record<string, string> = { code: err.code };
  if (err.originalCode) tags.original_code = err.originalCode;
  const fromError: Record<string, unknown> = {
    functionName: err.functionName,
    httpStatus: err.httpStatus,
    serverError: err.serverError,
  };
  for (const [key, tag] of Object.entries(CONTEXT_TAG_KEYS)) {
    const value = tagValue(context?.[key]) ?? tagValue(fromError[key]);
    if (value !== undefined) tags[tag] = value;
  }
  return tags;
}

// ── OBS-LABEL-10 — expected outcomes ─────────────────────────────────────────

/**
 * The ONE list of AppError codes that are outcomes, not failures: a user
 * cancelling, the plan gate, and user-input validation (OBS-COVER-2's list).
 * `auth/too-many-requests` is deliberately absent: it is reported.
 */
export const EXPECTED_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  // Cancels
  'auth/cancelled',
  // The plan gate
  'feature/requires-plan',
  'chat/paused',
  'chat/tutor-requires-plan',
  // User input
  'auth/wrong-credentials',
  'auth/invalid-email',
  'auth/weak-password',
  'auth/invalid-code',
  'auth/email-in-use',
  'auth/invalid-phone',
]);

/** The same outcomes as the raw SDK codes, for a Firebase error passed to
 *  `log.error` without first being mapped to an AppError code. */
export const EXPECTED_ORIGINAL_CODES: ReadonlySet<string> = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
  'auth/wrong-password',
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
  'auth/user-not-found',
  'auth/invalid-email',
  'auth/weak-password',
  'auth/email-already-in-use',
  'auth/invalid-verification-code',
  'auth/missing-verification-code',
  'auth/invalid-phone-number',
  'auth/missing-phone-number',
]);

export function isExpectedError(err: AppError): boolean {
  if (EXPECTED_ERROR_CODES.has(err.code)) return true;
  return err.originalCode !== undefined && EXPECTED_ORIGINAL_CODES.has(err.originalCode);
}

// ── OBS-LABEL-11 — route ─────────────────────────────────────────────────────

/** Segments whose NEXT segment is an id in this app's route table (App.tsx). */
const ID_PARENTS: ReadonlySet<string> = new Set(['chat', 'member', 'profile', 'view', 'edit', 'wurlds']);
/** Literal routes under those parents (`/chat/tutor`, `/wurlds/overview`, …). */
const LITERAL_CHILDREN: ReadonlySet<string> = new Set(['tutor', 'overview', 'start']);

/** A segment that is id-shaped on its own: digits, a uuid, or a long token
 *  with a digit in it (Firestore auto-ids, Firebase uids). */
function looksLikeId(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return true;
  return segment.length >= 16 && /^[A-Za-z0-9_-]+$/.test(segment) && /\d/.test(segment);
}

/** OBS-LABEL-11 — the pathname with ids collapsed to `:id`, so a route groups
 *  its issues and never carries a chat id or uid. Query and hash are dropped. */
export function collapseRouteIds(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? '';
  const segments = path.split('/');
  return segments
    .map((seg, i) => {
      if (seg === '') return seg;
      const parent = i > 0 ? segments[i - 1] : undefined;
      const underParent = parent !== undefined && ID_PARENTS.has(parent) && !LITERAL_CHILDREN.has(seg);
      if (underParent || looksLikeId(seg)) return ':id';
      return seg;
    })
    .join('/');
}

// ── OBS-LABEL-6 — wrapper frames ─────────────────────────────────────────────

const WRAPPER_FRAME = /(^|\/)src\/lib\/(log|errors)\.ts($|[?#])/;

/**
 * OBS-LABEL-6 — `src/lib/log.ts` and `src/lib/errors.ts` frames are not the
 * culprit. Matches the source path, which is what a dev build and a
 * source-mapped frame carry; a minified prod frame names the chunk instead, so
 * the same rule belongs in the Sentry project's stack-trace rules as well.
 */
export function markWrapperFramesNotInApp(event: ErrorEvent): ErrorEvent {
  for (const value of event.exception?.values ?? []) {
    for (const frame of value.stacktrace?.frames ?? []) {
      const where = frame.abs_path ?? frame.filename ?? frame.module ?? '';
      if (WRAPPER_FRAME.test(where) || WRAPPER_FRAME.test(frame.filename ?? '')) frame.in_app = false;
    }
  }
  return event;
}

// ── OBS-LABEL-2 — device ─────────────────────────────────────────────────────

/** OBS-LABEL-2 — the native device model (set by `@sentry/capacitor`'s
 *  device-context integration on iOS) as the `device_model` tag. */
export function applyDeviceModelTag(event: ErrorEvent): ErrorEvent {
  const model = (event.contexts?.device as { model?: unknown } | undefined)?.model;
  if (typeof model === 'string' && model.length > 0) {
    event.tags = { ...event.tags, device_model: model };
  }
  return event;
}
