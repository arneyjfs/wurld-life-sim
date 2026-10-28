/**
 * Typed error codes + AppError base class. Callers throw `new AppError(code, ...)`
 * and UI catches and renders via `toUserMessage()`.
 */

export type ErrorCode =
  | 'auth/invalid-phone'
  | 'auth/invalid-code'
  | 'auth/recaptcha-failed'
  | 'auth/session-expired'
  | 'auth/unknown'
  // AUTH-ACCOUNT — Google / Apple / email sign-in and account linking.
  | 'auth/email-in-use'
  | 'auth/wrong-credentials'
  | 'auth/weak-password'
  | 'auth/invalid-email'
  | 'auth/credential-in-use'
  | 'auth/account-exists'
  | 'auth/phone-in-use'
  | 'auth/merge-refused'
  | 'auth/method-unavailable'
  | 'auth/too-many-requests'
  // AUTH-ACCOUNT-10.3 — neither Android Google sheet worked on this phone.
  | 'auth/google-unavailable'
  // SAFETY-MOD-4 — the account was suspended by a moderator (Auth disabled).
  | 'auth/account-suspended'
  // The user closed the Google / Apple sheet. Screens show nothing for it.
  | 'auth/cancelled'
  | 'network/offline'
  | 'network/timeout'
  | 'network/unauthorized'
  | 'firestore/permission-denied'
  | 'firestore/not-found'
  | 'firestore/write-failed'
  | 'pipeline/rate-limited'
  | 'pipeline/failed'
  // LANG-GATE-6 — the send gate's 402. Distinct codes because the copy differs
  // and because both are TERMINAL: nothing was attempted and retrying the same
  // request cannot change the answer.
  | 'chat/paused'
  | 'chat/tutor-requires-plan'
  // ⚠ `chat/group-create-denied` WAS here, and was deleted on 2026-09-21 with
  // LANG-TIER-2. Its copy read "Starting a group needs Plus" — the exact
  // sentence the owner objected to as "not strictly true". The rules no longer
  // refuse a group create to anybody, so the code could only ever be raised by
  // something that had misunderstood the tier. Leaving it would leave a ready
  // made false statement one throw away.
  // LANG-TIER-1.1 — a 402 from a paid Gemini endpoint (explain, practice).
  // Terminal for the same reason LANG-GATE-6 gives: it will answer identically
  // until somebody's billing changes.
  | 'feature/requires-plan'
  | 'push/permission-denied'
  | 'push/unsupported'
  | 'storage/upload-failed'
  // IMG-AVATAR-3 — a canvas that should hold the picked photo drew nothing.
  // Encoding it would upload a black JPEG that nothing downstream can tell
  // from a real photo, so the render is refused and the user re-picks.
  | 'image/blank-render'
  // OBS-VERSION-11 — a Cloud Function answered 426: this build is below the
  // version floor. The blocking screen is already up (BOOT-GATE-3).
  | 'app/update-required'
  // OBS-LABEL-7 — `callHttp` maps the HTTP status to the code, so an issue
  // says what the server answered rather than "the translation failed".
  | 'server/forbidden'
  | 'server/not-found'
  | 'server/conflict'
  | 'server/rate-limited'
  | 'server/bad-request'
  | 'server/unavailable'
  | 'unknown';

/**
 * OBS-LABEL-4 / OBS-LABEL-7 — what an AppError remembers about where it came
 * from. Every field is an identifier or a number, never free text: the error
 * travels to Sentry verbatim.
 */
export interface AppErrorDetails {
  /** The Cloud Function (`RequestName`) or upload step that failed. */
  functionName?: string;
  /** The HTTP status the server answered with. */
  httpStatus?: number;
  /** The server's JSON `error` enum, when it is an identifier. */
  serverError?: string;
  /** MSG-OUTBOX-9.2 — the error response had no body at all. */
  emptyBody?: boolean;
  /** The wrapped error's own `.code` (`unavailable`, `auth/network-request-failed`, …). */
  originalCode?: string;
  /** The wrapped error's `name` (`TypeError`, `FirebaseError`, …). */
  name?: string;
}

export class AppError extends Error {
  /** `AppError`, unless it wraps an error whose name it keeps (OBS-LABEL-4):
   *  Sentry's exception type then reads `TypeError` / `FirebaseError`, and
   *  MSG-OUTBOX-9.1's name check still sees a network-shaped failure. Use
   *  `instanceof AppError`, never the name, to recognise one. */
  override name: string = 'AppError';
  readonly code: ErrorCode;
  override readonly cause?: unknown;
  readonly functionName?: string;
  readonly httpStatus?: number;
  readonly serverError?: string;
  readonly emptyBody?: boolean;
  readonly originalCode?: string;

  constructor(code: ErrorCode, message?: string, cause?: unknown, details?: AppErrorDetails) {
    super(message ?? code);
    this.code = code;
    this.cause = cause;
    if (details?.name) this.name = details.name;
    if (details?.functionName !== undefined) this.functionName = details.functionName;
    if (details?.httpStatus !== undefined) this.httpStatus = details.httpStatus;
    if (details?.serverError !== undefined) this.serverError = details.serverError;
    if (details?.emptyBody !== undefined) this.emptyBody = details.emptyBody;
    if (details?.originalCode !== undefined) this.originalCode = details.originalCode;
  }
}

/**
 * Firestore SDK error codes we translate into our own.
 *
 * ⚠ Deliberately tiny, and it is meant to STAY tiny. Callers pass a `fallback`
 * because they know what they were doing; this map overrides that only where
 * the SDK has told us something more specific than the caller could guess.
 * Widening it re-routes copy on paths nobody re-read — the auth screens pass
 * `auth/*` fallbacks and mean them, and a `FirebaseError` from Auth carries a
 * `code` too.
 *
 * `permission-denied` is here because it was the one code with copy already
 * written for it (`firestore/permission-denied`) that nothing could ever
 * reach — `toAppError` never looked at `.code` — so LANG-TIER-2's rules
 * rejection, the only REAL enforcement of the group gate, surfaced as
 * "Something went wrong." That is the worst available message for it: it is
 * the one that invites a retry, and a rules rejection fails identically
 * forever.
 *
 * `not-found` has the same unreachable-copy shape and is NOT mapped here: no
 * caller was found relying on it, and adding it would be a behaviour change to
 * paths this work did not review.
 */
const FIRESTORE_CODE_MAP: Readonly<Record<string, ErrorCode>> = {
  'permission-denied': 'firestore/permission-denied',
};

function stringField(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * OBS-LABEL-4 — a non-Error rejection (a plain object from a Capacitor plugin,
 * a Firebase JSON error) described by its own fields, never `[object Object]`.
 */
function describeNonError(value: unknown): string {
  if (value === null || typeof value !== 'object') return String(value);
  const described =
    stringField(value, 'message') ?? stringField(value, 'errorMessage') ?? stringField(value, 'code');
  if (described) return described;
  try {
    const json = JSON.stringify(value);
    return json && json !== '{}' ? json.slice(0, 200) : 'non-Error rejection';
  } catch {
    return 'non-Error rejection';
  }
}

export function toAppError(value: unknown, fallback: ErrorCode = 'unknown'): AppError {
  // Checked first, and it must stay first: AppError carries a `code` of its
  // own, and re-mapping one would silently rewrite every deliberate code this
  // module already throws.
  if (value instanceof AppError) return value;
  const originalCode = stringField(value, 'code');
  if (value instanceof Error) {
    const mapped = originalCode ? FIRESTORE_CODE_MAP[originalCode] : undefined;
    return new AppError(mapped ?? fallback, value.message, value, { name: value.name, originalCode });
  }
  return new AppError(fallback, describeNonError(value), value, { originalCode });
}

/**
 * OBS-LABEL-8 — a `fetch` that never got an answer, as an AppError naming the
 * function. A `TypeError` (WebKit "Load failed", Chrome "Failed to fetch") is
 * `network/offline`; an abort or timeout signal is `network/timeout`. The
 * original name is kept, so `isNetworkShapedSendError` (MSG-OUTBOX-9.1) reads
 * it exactly as it read the raw error, and the message carries no status
 * number for `isTerminalSendError` to misread. Anything else is returned as is.
 */
export function toNetworkError(err: unknown, functionName: string): unknown {
  if (err instanceof AppError || !(err instanceof Error)) return err;
  const name = err.name;
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new AppError('network/timeout', `${functionName}: ${name}`, err, { functionName, name });
  }
  if (err instanceof TypeError || name === 'TypeError') {
    return new AppError('network/offline', `${functionName}: ${err.message}`, err, { functionName, name });
  }
  return err;
}

const USER_MESSAGES: Record<ErrorCode, string> = {
  'auth/invalid-phone': 'That phone number doesn’t look right. Check the country code and try again.',
  'auth/invalid-code': 'That code didn’t match. Check the SMS and try again.',
  'auth/recaptcha-failed': 'Couldn’t verify you’re not a bot. Try again, or restart the app.',
  'auth/session-expired': 'Your session expired. Sign in again.',
  'auth/unknown': 'Something went wrong signing in.',
  'auth/email-in-use': 'An account already uses that email. Sign in instead.',
  'auth/wrong-credentials': 'Email or password is incorrect.',
  // AUTH-ACCOUNT-11 — mirrors the live password policy; update with the console.
  'auth/weak-password': 'Use a stronger password: at least 8 characters, with an uppercase letter and a symbol.',
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/credential-in-use': 'That sign-in already belongs to another Wurld account.',
  'auth/account-exists': 'That email already has a Wurld account with a different sign-in. Use that one.',
  'auth/phone-in-use': 'That number already belongs to another Wurld account.',
  'auth/merge-refused':
    'That number belongs to an account that already has an email sign-in. Sign in with that instead.',
  'auth/method-unavailable': 'That sign-in method isn’t available yet.',
  'auth/too-many-requests': 'Too many attempts. Wait a moment and try again.',
  'auth/google-unavailable':
    'Google sign-in isn’t working on this phone. Add a Google account in your phone’s Settings, or use email and password instead.',
  'auth/account-suspended':
    'This account has been suspended for breaking Wurld’s community standards. Contact support@wurld.chat if you think this is a mistake.',
  'auth/cancelled': '',
  'network/offline': 'You’re offline. Reconnect and try again.',
  'network/timeout': 'The network is slow. Try again.',
  'network/unauthorized': 'You’re not authorised for that.',
  'firestore/permission-denied': 'You don’t have access to this data.',
  'firestore/not-found': 'We couldn’t find that.',
  'firestore/write-failed': 'Couldn’t save. Try again.',
  'pipeline/rate-limited': 'Slow down a bit — too many requests.',
  'pipeline/failed': 'The translation didn’t go through. Try again.',
  // Deliberately NOT "try again": the chat is in a state, and a retry prompt
  // over a state invites the user to hammer a button that cannot work.
  'chat/paused': 'This chat is paused until someone in it has Plus.',
  'chat/tutor-requires-plan': 'The tutor comes with Plus.',
  'feature/requires-plan': 'That one comes with Plus.',
  'push/permission-denied': 'Notifications are off. Enable them in Settings to get message alerts.',
  'push/unsupported': 'Notifications aren’t supported on this device or browser.',
  'storage/upload-failed': 'Image upload failed. Try again.',
  'image/blank-render': 'Couldn’t read that photo. Pick it again.',
  'app/update-required': 'This version of Wurld is no longer supported. Update to keep going.',
  'server/forbidden': 'You don’t have access to that.',
  'server/not-found': 'We couldn’t find that. It may have been deleted.',
  'server/conflict': 'That’s already been done.',
  'server/rate-limited': 'Slow down a bit — too many requests. Try again in a moment.',
  'server/bad-request': 'That didn’t work. Update the app if this keeps happening.',
  'server/unavailable': 'Wurld’s servers are having trouble. Try again in a moment.',
  unknown: 'Something went wrong.',
};

export function toUserMessage(err: unknown): string {
  return toAppError(err).code in USER_MESSAGES
    ? USER_MESSAGES[toAppError(err).code]
    : USER_MESSAGES.unknown;
}
