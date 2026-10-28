// OBS-9a — named imports ONLY. Binding the namespace (and re-exporting it, as
// this module used to) defeats tree-shaking and ships Session Replay + Feedback
// (rrweb, ~300 kB of source) to every user although OBS-9 keeps both off.
//
// OBS-EDGE-5 — in a native shell `@sentry/capacitor` owns init: it starts the
// native SDKs (crashes, ANRs, watchdog terminations) with the same DSN,
// environment and release, then calls `@sentry/react`'s `init` as its sibling.
// It is loaded by a dynamic import taken only on native, like the live-update
// runner (BOOT-SPLIT-5: the web entry never carries code the web cannot run;
// statically imported it cost every web user ~5.4 KiB gzip of initial JS). The
// web calls `@sentry/react`'s `init` directly, synchronously, as before. A
// native shell built before the plugin existed (an OTA bundle on an old
// binary) fails the native init and the plugin falls back to the JS-only SDK.
import type { CapacitorOptions } from '@sentry/capacitor';
import { addBreadcrumb, captureException, captureMessage, init as reactInit, setTag, setUser } from '@sentry/react';
import type { BrowserOptions, Breadcrumb, ErrorEvent, EventHint } from '@sentry/react';
import { config } from './config';
import { isFatalFirestoreError } from './firestoreRecovery';
import { getRuntime, isNative } from './runtime';
import {
  applyDeviceModelTag,
  markWrapperFramesNotInApp,
  resolveSentryEnvironment,
} from './sentryLabels';

let initialized = false;

/**
 * Keys whose VALUES are PII or user-generated content and must NEVER reach
 * Sentry. Apply to `event.extra`, `event.tags`, `event.contexts.*`, and
 * `breadcrumb.data`. Extend cautiously — once a key is added, callers should
 * assume it gets `[redacted]` instead of the real value upstream.
 *
 * NOT redacted (intentional): `code`, `name`, `action`, `screen`, `status`,
 * `httpStatus`, `functionName`, `stack`, `level`, `category` — these are
 * structural fields that Sentry stack traces and triage workflows rely on.
 */
const PII_KEYS: ReadonlySet<string> = new Set([
  // User-authored content / message bodies
  'originalText',
  'text',
  'caption',
  'message',
  'body',
  'responseBody',
  'userMessage',
  'inputText',
  'outputText',
  'prompt',
  'response',
  // Identifiers that link an event to a specific conversation / user
  'messageId',
  'chatId',
  'cardId',
  'contactId',
  'phoneNumber',
  'displayName',
  'email',
  'name',
  'firstName',
  'lastName',
  // Auth/credentials — defence-in-depth; nothing should ever pass these
  'token',
  'idToken',
  'accessToken',
  'refreshToken',
  'authorization',
  'password',
  'credentials',
  'apiKey',
  // OBS-LABEL-12 — practice / card content and file names.
  'phrase',
  'fileName',
  'line',
  'word',
  'query',
]);

/** Contexts whose `name` is the platform's, not a person's (`os.name` is
 *  `iOS`; `device.name` is "James's iPhone" and stays redacted). */
const PLATFORM_NAME_CONTEXTS: ReadonlySet<string> = new Set(['os', 'browser', 'runtime', 'app']);

const REDACTED = '[redacted]' as const;
const MAX_DEPTH = 6;

/**
 * djb2 hash, base36. Used for uids so the same user produces the same hash
 * across events (correlatable) without exposing the uid. Not a security
 * primitive — just an obfuscator.
 */
function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  // unsigned, base36, capped to 8 chars
  return (h >>> 0).toString(36).slice(0, 8);
}

/**
 * Strips the query string from a URL-shaped value. Returns the input
 * unchanged if it's not a URL. We tolerate `Url.toString()` failures since
 * any string starting with http(s):// should parse, but defence in depth.
 */
function stripQuery(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const u = new URL(value);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    // Strip everything after `?` as a fallback.
    const qIdx = value.indexOf('?');
    return qIdx === -1 ? value : value.slice(0, qIdx);
  }
}

/**
 * Returns true for the strings Firebase Auth uids match (28-char base64ish).
 * Heuristic: 20+ alphanumeric chars, no spaces, looks id-shaped.
 */
function looksLikeUid(value: string): boolean {
  return value.length >= 20 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Recursively scrubs an arbitrary value tree.
 *
 * - Object/array branches recurse up to `MAX_DEPTH` (then `[truncated]`).
 * - Keys in `PII_KEYS` get their value replaced with `[redacted]`.
 * - Keys whose name suggests a uid (`uid`, `userId`, `ownerId`, `*Uid`)
 *   get the value hashed.
 * - String leaves are passed through `stripQuery`.
 *
 * Returns a NEW value; never mutates the input.
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[truncated]';

  if (typeof value === 'string') return stripQuery(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();

  if (Array.isArray(value)) {
    return value.map((v) => scrubValue(v, depth + 1));
  }

  if (typeof value === 'object') {
    // Pass Errors through untouched at this level — Sentry has its own
    // exception serialiser that handles stack/message/cause. Scrubbing
    // here would strip useful diagnostics.
    if (value instanceof Error) return value;

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubField(k, v, depth + 1);
    }
    return out;
  }

  // functions, symbols — drop.
  return undefined;
}

/**
 * Scrubs a single (key, value) pair. Applies key-based rules first
 * (redaction, hashing), then recurses into the value otherwise.
 */
function scrubField(key: string, value: unknown, depth: number): unknown {
  if (PII_KEYS.has(key)) return REDACTED;

  // Hash uid-like keys so we can still correlate across events.
  const lk = key.toLowerCase();
  if (lk === 'uid' || lk === 'userid' || lk === 'ownerid' || lk.endsWith('uid')) {
    if (typeof value === 'string' && looksLikeUid(value)) {
      return `hashed:${shortHash(value)}`;
    }
  }

  return scrubValue(value, depth);
}

/**
 * Scrubs an `Extras`-shaped record (or any `Record<string, unknown>`).
 * Returned object is safe to attach to `event.extra` or breadcrumb data.
 */
export function scrubRecord(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!input) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[k] = scrubField(k, v, 1);
  }
  return out;
}

/**
 * Walks an in-flight Sentry event and scrubs every field that could carry
 * user data. Idempotent — safe to apply to an already-scrubbed event.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.extra) {
    event.extra = scrubRecord(event.extra) as ErrorEvent['extra'];
  }
  if (event.tags) {
    const cleanTags: Record<string, ErrorEvent['tags'] extends infer T ? T : never> = {};
    for (const [k, v] of Object.entries(event.tags)) {
      // tags must be primitives in Sentry; redact PII keys, otherwise pass-through.
      if (PII_KEYS.has(k)) {
        cleanTags[k as keyof typeof cleanTags] = REDACTED as never;
      } else if (typeof v === 'string') {
        cleanTags[k as keyof typeof cleanTags] = stripQuery(v) as never;
      } else {
        cleanTags[k as keyof typeof cleanTags] = v as never;
      }
    }
    event.tags = cleanTags as ErrorEvent['tags'];
  }
  if (event.contexts) {
    const cleanCtx: Record<string, Record<string, unknown> | undefined> = {};
    for (const [k, v] of Object.entries(event.contexts)) {
      const clean = v ? (scrubRecord(v) as Record<string, unknown>) : v;
      if (clean && v && PLATFORM_NAME_CONTEXTS.has(k) && typeof v.name === 'string') {
        clean.name = v.name;
      }
      cleanCtx[k] = clean;
    }
    event.contexts = cleanCtx as ErrorEvent['contexts'];
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  }
  // Drop the top-level `message` if it contains a PII key signature — the
  // exception itself carries the stack trace, so the message is redundant.
  // We deliberately leave `event.exception` alone; Sentry uses the exception
  // type/value pair for grouping.
  return event;
}

/**
 * Scrubs a single breadcrumb. Returns a new breadcrumb; doesn't mutate.
 */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (!crumb.data) return crumb;
  return { ...crumb, data: scrubRecord(crumb.data) };
}

/**
 * Post-scrub event hygiene (OBS-FIRESTORE-1 + noise reduction):
 *  - DROP transient `Load failed` fetch errors — benign network blips (the send
 *    path already classes them non-terminal), not actionable — but only when
 *    the event is unlabelled (OBS-LABEL-9): a deliberate `log.error` with an
 *    `action` tag is a failure somebody chose to report, and is kept.
 *  - GROUP the iOS/WebKit Firestore async-queue-fatal crashes (b815 etc.) under
 *    one fingerprint + tag, so the 6+ near-identical variants collapse to a
 *    single trackable issue. We self-heal it (installFirestoreRecovery); the
 *    issue stays visible so its frequency can be monitored.
 */
export function applyEventHygiene(event: ErrorEvent): ErrorEvent | null {
  const msg = event.exception?.values?.[0]?.value ?? event.message ?? '';
  if (msg.includes('Load failed') && !event.tags?.action) return null; // unlabelled fetch blip
  if (isFatalFirestoreError(msg)) {
    event.fingerprint = ['firestore-async-queue-fatal'];
    event.tags = { ...event.tags, firestore_self_heal: 'true' };
  }
  return event;
}

/**
 * Starts Sentry. Synchronous on the web. In a native shell it returns the
 * promise of the `@sentry/capacitor` load + init (one local chunk); events
 * captured before it settles are not sent, and the caller need not await it.
 * Returns undefined when Sentry is not configured or already started.
 */
export function initSentry(): Promise<void> | undefined {
  if (initialized) return undefined;
  if (!config.sentryDsn) {
    // Dev / unconfigured — leave Sentry uninstalled; log.* falls back to console.
    return undefined;
  }
  initialized = true;
  const native = isNative();
  // OBS-LABEL-3 — a dev server or a page on a local / LAN host files as `dev`.
  const environment = resolveSentryEnvironment({
    configEnv: config.env,
    isDevBuild: import.meta.env.DEV === true,
    isNative: native,
    hostname: typeof window !== 'undefined' ? window.location?.hostname : undefined,
  });
  const options: BrowserOptions = {
    dsn: config.sentryDsn,
    environment,
    // Pin the release to the SAME value the @sentry/vite-plugin uploads
    // source maps under (`buildInfo.version`, injected as __APP_VERSION__) —
    // otherwise events carry no/mismatched release and stack traces stay
    // minified even though the maps were uploaded. Also powers release health.
    release: __APP_VERSION__,
    // No `tracesSampleRate` (OBS-8: no APM). The web SDK never had a tracing
    // integration, so the old 0.1 / 1.0 rate did nothing there; passed to the
    // native SDKs it would switch on their automatic performance tracing.
    //
    // No replay sample rates either: `CapacitorOptions` has no such fields and
    // no replay integration is shipped (OBS-9 / OBS-9a), so there is nothing
    // for them to switch off. Replays of error sessions would include rendered
    // chat text; re-enabling them is an OBS-9 change with full DOM masking
    // (`maskAllText: true`, `blockAllMedia: true`) and a privacy review.
    sendDefaultPii: false,
    beforeSend: (event: ErrorEvent, _hint: EventHint) =>
      // OBS-LABEL-6 (culprit), OBS-LABEL-2 (device tag), then scrub + hygiene.
      applyEventHygiene(scrubEvent(applyDeviceModelTag(markWrapperFramesNotInApp(event)))),
    beforeBreadcrumb: (breadcrumb: Breadcrumb) => scrubBreadcrumb(breadcrumb),
  };
  // OBS-LABEL-1 — a WKWebView otherwise reads as "Mobile Safari". Set on the
  // scope now; the SDK client attaches it to every event once it is up.
  setTag('runtime', getRuntime());
  if (!native) {
    reactInit(options);
    return undefined;
  }
  return import('@sentry/capacitor').then(
    // OBS-EDGE-5 / OBS-LABEL-2 — the native SDKs, and (iOS) the native device
    // context on every JS event via the plugin's device-context integration.
    ({ init: capacitorInit }) => {
      try {
        capacitorInit(options as CapacitorOptions, reactInit);
      } catch {
        reactInit(options);
      }
    },
    // The chunk failed to load: keep JS error reporting at least.
    () => {
      reactInit(options);
    },
  );
}

/** The SDK calls `log.ts` makes — a facade, never the SDK namespace
 *  (OBS-9a). `captureMessage` carries `log.diagnostic` (NOTIF-17.6). */
export const sentry = { addBreadcrumb, captureException, captureMessage, setUser };

/**
 * OTA-11 (docs/specs/live-updates.md §3d) — in a native shell three builds
 * can differ: the web bundle (the `release`, OBS-VERSION-1), the shell it
 * runs in, and the channel it follows. The live-update runner sets these as
 * each fact lands; an unknown fact is left unset rather than written as
 * "null". `release` stays the bundle version.
 */
export interface LiveUpdateTags {
  /** `App.getInfo().build` — CFBundleVersion / versionCode. */
  native_build?: number | null;
  /** The plugin's current bundle id (`builtin` when the baked bundle runs). */
  ota_bundle?: string | null;
  /** The channel this device follows (OTA-9). */
  ota_channel?: string | null;
}

export function setLiveUpdateTags(tags: LiveUpdateTags): void {
  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined || value === null) continue;
    setTag(key, String(value));
  }
}
