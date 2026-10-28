import { auth } from './firebase';
import { appCheckHeaders } from './appCheck';
import { config } from './config';
import { AppError, toNetworkError } from './errors';
import type { ErrorCode } from './errors';
import { warn as logWarn } from './log';
import { isNdjsonResponse, readNdjsonResult } from './ndjsonResult';
import { floorFrom426Body, reportUpgradeRequired, wurldVersionHeaders } from './versionHeader';

/**
 * Registry of every Cloud Function the client calls. The backend has ONE
 * flavour: `onRequest` HTTP functions (there are no `onCall` callables in
 * this deployment). Every call passes the Firebase ID token as a bearer
 * and sends/receives plain JSON via `callHttp`.
 *
 * URLs are constructed from `config.functionsUrl`, which varies by build
 * flavour (beta vs prod). NO call site should string-concat function URLs;
 * everything goes through `callHttp`.
 *
 * History: `synthesizeSpeech` / `listStandardVoices` were briefly wired
 * through `httpsCallable` (the onCall SDK protocol), which wraps the
 * payload as `{ data: ... }` and uses the callable auth envelope. The
 * backend functions are `onRequest` and read `req.body.text` at the top
 * level, so the server saw `req.body.data.text === undefined` and returned
 * 400 "Missing text or languageCode". They're plain RequestNames now.
 */

export type RequestName =
  | 'synthesizeSpeech'
  | 'listStandardVoices'
  | 'geminiGenerate'
  | 'geminiStreamV2'
  | 'processMessagePipeline'
  | 'messagePipelineRetry'
  | 'chatTranslationsBackfill'
  | 'clearChatNotifications'
  | 'getUploadUrl'
  // VID-LIMIT-2 — re-checks a video upload's real size/type server-side.
  | 'finalizeVideoUpload'
  | 'processUploadedImage'
  | 'submitTranslationFeedback'
  | 'tutorRespond'
  | 'resolveMessageReview'
  | 'clarifyMessageReview'
  | 'deleteChat'
  // LANG-LEARNWITH-22 — ask the room to add the caller's language; once per
  // member and language (`{ created:false }` on a repeat).
  | 'requestChatLanguage'
  | 'deleteAccount'
  // BILL-DEL-3 — asked before the delete confirm: is Apple still billing?
  | 'billingDeletionCheck'
  // BILL-STRIPE-1/5 — web Checkout (Managed Payments) and the Customer Portal.
  // `{ returnTo }` must be one of our origins; 409 already_entitled / 404
  // no_customer are mapped by `lib/billing/webCheckout.ts`.
  | 'stripeCreateCheckout'
  | 'stripeCreatePortal'
  | 'getAdminDashboard'
  // ADMIN-PLAN-4/5 — an admin moves any user between regular and lifetime
  // Plus. `plan` stays in `serverOnlyUserFields()`; the endpoint re-checks
  // `isAdmin` server-side and writes grants, never `plan`.
  | 'adminSetPlan'
  // OTA-9 (docs/specs/live-updates.md D5) — admin sets users/{uid}.channelOverride.
  | 'adminSetChannel'
  // ADMIN-PROVIDER-1/2 — admin read/write of config/runtime.openai.<env>.<category>.
  | 'adminProviderSwitch'
  // OTA-16 — the authenticated, floor-exempt policy + channel resolver.
  | 'liveUpdatePolicy'
  // BILL-ADMIN-1 — admin grants / revokes a MANUAL Plus grant (audited).
  | 'adminGrantPlus'
  | 'adminRevokePlus'
  // SEC-FN-5 — there is deliberately no `manageAdmin`: the admin set is
  // `users/{uid}.isAdmin`, set from the Firebase console only.
  | 'getAdminPipelineTraces'
  | 'getAdminTraceDetail'
  | 'getAdminPipelineStats'
  | 'getAdminUsageStats'
  | 'getAdminUsageStatsV2'
  | 'getPracticeEventStats'
  | 'adminBroadcast'
  | 'adminBroadcastDelete'
  // LANG-TRIAL-3 — the `on_accept` enrolment path. Registered now, reachable
  // only when `TRIAL_ENROLMENT` flips: both paths exist and are tested while
  // only one is live, so changing the mode is editing a constant rather than
  // writing a Cloud Function. ⚠ The server half may not be deployed yet, so
  // the caller treats a failure as non-fatal (see `TrialSheet.tsx`).
  | 'startTrial'
  // LANG-PROP-5 — the HTTP twin of the language-propagation triggers. Called
  // after every language write, in EVERY environment: in beta the Firestore
  // triggers bind to `wurld-beta`'s own empty database and never fire, so this
  // is the only transport there; in prod the trigger fires too and this is a
  // second, short-circuiting pass. One code path so beta verifies what prod
  // runs. Always non-fatal — the write already succeeded.
  | 'resyncLanguageTargets'
  // NOTIF-6.2 — a captionless photo/video is a client `addDoc`, so the
  // sender asks the server to run the side-effect dispatch (unread bump,
  // lastMessage, push). Idempotent server-side; always non-fatal client-side.
  | 'dispatchMessageSideEffects'
  | 'getVersion'
  // PROF-4 — the only phone lookup. `POST { phones: string[] }` (E.164, ≤ 500)
  // → `{ matches: { [phone]: { uid, displayName } } }` for phones on Wurld
  // and only those. Called through `lib/resolveContacts.ts`, never directly.
  | 'resolveContacts'
  // PROF-2.1 — the HTTP twin of the profile-mirror trigger. No body; the uid
  // is the token's. Called by `lib/profileMirror.ts` when the caller's own
  // `profiles/{uid}` lags their user doc (always, in beta: the trigger there
  // watches `wurld-beta`'s empty database). Non-fatal.
  | 'syncProfileMirror'
  // BILL-APPLE-2 — post StoreKit 2 signed transactions (purchase + restore).
  // The client finishes the transaction only after a 2xx.
  | 'appleSyncTransaction'
  // BILL-GOOGLE-2 — post a Play purchase token; the SERVER acknowledges.
  | 'googleSyncPurchase'
  // XP-API-1 — XP awards + the quiz / level usage counters. Called through
  // `lib/activity.ts`, never directly.
  | 'recordActivity'
  // ADMIN-ENG-1 — the admin Engagement tab (`GET ?days=7|14|30`).
  | 'getAdminEngagementStats'
  // SAFETY-BLOCK-1/11 — block / unblock (the block also unlinks contacts).
  | 'setBlock'
  // SAFETY-REPORT-3 — report a message, a person, an explanation or AI output.
  | 'reportContent'
  // SAFETY-MOD-1/2 — the admin Reports tab.
  | 'adminListReports'
  | 'adminResolveReport'
  | 'adminListSuspended' // SAFETY-MOD-5
  | 'adminReinstateUser';

/**
 * Invoke a v2 HTTP Cloud Function. Caller passes typed payload + decoder.
 * Bearer token attached from current auth user.
 *
 * For GET, the payload (if not null/undefined) is serialized as URL
 * query parameters — admin endpoints like `getAdminPipelineStats` and
 * `getAdminUsageStatsV2` take `days` via the query string.
 */
/**
 * LANG-GATE-6 — which `ErrorCode` a non-OK response becomes.
 *
 * Only 402 reads the body, and only for the `reason` field, which is a fixed
 * enum this repo's own Cloud Functions emit (`SendGateReason`). Everything else
 * in that body is left alone: `callHttp` deliberately keeps server text out of
 * the error, because the message travels verbatim to Sentry and may carry chat
 * content or uids.
 *
 * An unrecognised 402 reason still resolves to `chat/paused` rather than to the
 * generic failure. A newer server reason this build has not heard of is still a
 * 402 — the send did not happen and a retry will not change that — so the
 * paused copy is true of it, where "the translation didn't go through, try
 * again" is false twice over.
 */
/**
 * OBS-LABEL-7 — the message pipeline's own endpoints. Only these keep
 * `pipeline/failed` (whose copy is "the translation didn't go through") for a
 * 5xx or an unmapped 4xx; every other function gets the status's own code.
 */
const PIPELINE_ENDPOINTS: ReadonlySet<RequestName> = new Set<RequestName>([
  'processMessagePipeline',
  'messagePipelineRetry',
  'dispatchMessageSideEffects',
]);

function parseJsonBody(body: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * OBS-LABEL-7 — the server's JSON `error` field, only when it is an enum-like
 * identifier (`not_member`, `account_deleted`). Free text ("Not a member of
 * this chat") can carry anything and stays out of the error.
 */
export function serverErrorFrom(body: string): string | undefined {
  const raw = parseJsonBody(body)?.error;
  return typeof raw === 'string' && /^[A-Za-z][A-Za-z0-9_.:/-]{0,63}$/.test(raw) ? raw : undefined;
}

export function errorCodeForStatus(name: RequestName, status: number, body: string): ErrorCode {
  // OBS-VERSION-11 — the version floor. Not retryable, not "try again".
  if (status === 426) return 'app/update-required';
  if (status === 402) {
    // A 402 with an unparseable body is still a 402.
    const reason = parseJsonBody(body)?.reason;
    return reason === 'tutor_requires_plan' ? 'chat/tutor-requires-plan' : 'chat/paused';
  }
  // 401 keeps its historical code: the admin and chat-info screens (and
  // videoUpload) branch on it to show "not authorised" (OBS-LABEL-7).
  if (status === 401) return 'network/unauthorized';
  if (status === 403) return 'server/forbidden';
  if (status === 404) return 'server/not-found';
  if (status === 409) return 'server/conflict';
  if (status === 429) return 'server/rate-limited';
  if (PIPELINE_ENDPOINTS.has(name)) return 'pipeline/failed';
  return status >= 500 ? 'server/unavailable' : 'server/bad-request';
}

export async function callHttp<Req, Res>(
  name: RequestName,
  payload: Req,
  options?: {
    method?: 'POST' | 'GET';
    signal?: AbortSignal;
    /** MSG-PIPE-32.4 — each non-result line of a streamed response. */
    onStreamLine?: (line: Record<string, unknown>) => void;
  },
): Promise<Res> {
  const method = options?.method ?? 'POST';
  const url =
    method === 'GET' ? endpointUrl(name, payload as unknown) : endpointUrl(name);
  const token = await auth.currentUser?.getIdToken();
  // APPCHECK-5 — the ONE place an App Check token is attached, for the same
  // reason the auth header is attached here and nowhere else.
  //
  // ⚠ This must never be able to break a request. `appCheckHeaders()` resolves
  // `{}` on every failure path — inert (no site key, which is today), no token,
  // or a rejected fetch — so the spread is a no-op and the call goes unattested
  // rather than not at all. That is the client end of the fail-open posture
  // described in `functions/src/appCheck.ts`.
  const appCheck = await appCheckHeaders();
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...appCheck,
        // OBS-VERSION-9 — the server's version floor keys on this.
        ...wurldVersionHeaders(),
      },
      body: method === 'GET' ? undefined : JSON.stringify(payload),
      signal: options?.signal,
    });
  } catch (err) {
    // OBS-LABEL-8 — no answer at all: network/offline or network/timeout,
    // naming the function. The original name is kept (MSG-OUTBOX-9.1).
    throw toNetworkError(err, name);
  }
  if (!res.ok) {
    // Read the response body for diagnostics, but do NOT put it into the
    // AppError message — that string travels verbatim to Sentry and may
    // contain server-rendered chat content, user uids, or stack frames.
    // We forward the body through `log.warn` (which scrubs known PII keys
    // via `scrubRecord`) so it shows up on the breadcrumb trail but never
    // in the exception title.
    const text = await res.text().catch(() => '');
    throw httpError(name, res.status, text);
  }
  // MSG-PIPE-32.4 — a streamed response: its result line stands for the status
  // and body, so a failure in it throws exactly what the plain response would.
  if (isNdjsonResponse(res)) {
    let result: { status: number; body: unknown };
    try {
      result = await readNdjsonResult(res, options?.onStreamLine ?? (() => {}));
    } catch (err) {
      throw toNetworkError(err, name);
    }
    if (result.status >= 400) throw httpError(name, result.status, JSON.stringify(result.body ?? ''));
    return result.body as Res;
  }
  return (await res.json()) as Res;
}

/** A non-OK answer as the AppError every caller handles (OBS-LABEL-7). */
function httpError(name: RequestName, status: number, text: string): AppError {
  // OBS-VERSION-11 — raise the blocking screen now, not at the next boot.
  if (status === 426) reportUpgradeRequired(floorFrom426Body(text));
  if (text.length > 0) {
    logWarn('callHttp non-OK response', {
      functionName: name,
      httpStatus: status,
      // `responseBody` is in PII_KEYS, so this gets redacted by the
      // scrubber before reaching Sentry. Kept here so the field shows
      // up as `[redacted]` rather than being silently dropped — that
      // way operators know a body existed.
      responseBody: text.slice(0, 500),
    });
  }
  return new AppError(
    errorCodeForStatus(name, status, text),
    // ⚠ Keep this shape. `isTerminalSendError` (src/lib/chatService.ts) parses
    // the HTTP status back out of this string to decide whether the outbox
    // may retry, so a friendlier message here silently makes every gate
    // rejection retryable again.
    `callHttp ${name} ${status}`,
    undefined,
    // OBS-LABEL-7 — which function, which status, which server enum.
    { functionName: name, httpStatus: status, serverError: serverErrorFrom(text), emptyBody: text.trim() === '' },
  );
}

/**
 * API-GW-7 — the hot-path endpoints served by the one warm `api` function
 * (docs/specs/api-gateway.md). Must match the server's route table
 * (`functions/src/apiRouter.ts` API_ROUTE_NAMES); a static test holds them
 * equal. Their standalone functions stay deployed for older builds (API-GW-8).
 */
export const API_ROUTES = [
  'geminiGenerate',
  'geminiStreamV2',
  'synthesizeSpeech',
] as const satisfies readonly RequestName[];

const API_ROUTE_SET: ReadonlySet<RequestName> = new Set(API_ROUTES);

/**
 * Returns the full URL for a v2 onRequest function. If `query` is a
 * plain object, its scalar fields are encoded as URL query parameters.
 * `null`, `undefined`, and non-objects are ignored.
 */
export function endpointUrl(name: RequestName, query?: unknown): string {
  // API-GW-7 — a route of `api` is reached through it, not its own function.
  const base = API_ROUTE_SET.has(name)
    ? `${config.functionsUrl}/api/${name}`
    : `${config.functionsUrl}/${name}`;
  if (!query || typeof query !== 'object') return base;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value == null) continue;
    if (typeof value === 'object') continue; // skip nested; callers shouldn't nest in GET
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Returns a typed fetch-stream URL for SSE clients (Phase 7 ExplainModal). */
export function streamUrl(name: 'geminiStreamV2'): string {
  return endpointUrl(name);
}
