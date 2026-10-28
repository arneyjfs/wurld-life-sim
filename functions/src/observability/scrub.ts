/**
 * OBS-SRV-4 — server Sentry events are scrubbed with the SAME PII key list as
 * the client (`src/lib/sentry.ts` `PII_KEYS`, plus the OBS-LABEL-12 additions).
 *
 * Duplicated rather than imported: the functions build (`functions/tsconfig`,
 * rootDir `src`) cannot reach `src/lib/`, and the client cannot import from
 * `functions/`. `__tests__/sentryScrub.test.ts` reads the client file and
 * fails when the two lists drift (server = client ∪ OBS-LABEL-12 keys).
 *
 * Pure: no SDK import, so it is unit-testable on its own.
 */

/** Keys whose VALUES are PII or user-generated content and must never leave. */
export const PII_KEYS: ReadonlySet<string> = new Set([
  // User-authored content / message bodies
  "originalText",
  "text",
  "caption",
  "message",
  "body",
  "responseBody",
  "userMessage",
  "inputText",
  "outputText",
  "prompt",
  "response",
  // Identifiers that link an event to a specific conversation / user
  "messageId",
  "chatId",
  "cardId",
  "contactId",
  "phoneNumber",
  "displayName",
  "email",
  "name",
  "firstName",
  "lastName",
  // Auth/credentials — defence-in-depth; nothing should ever pass these
  "token",
  "idToken",
  "accessToken",
  "refreshToken",
  "authorization",
  "password",
  "credentials",
  "apiKey",
  // OBS-LABEL-12 — additional user-content keys
  "phrase",
  "fileName",
  "line",
  "word",
  "query",
]);

const REDACTED = "[redacted]" as const;
const MAX_DEPTH = 6;

/** djb2, base36, 8 chars — the client's uid obfuscator (correlatable, not secret). */
export function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36).slice(0, 8);
}

function stripQuery(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const u = new URL(value);
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    const qIdx = value.indexOf("?");
    return qIdx === -1 ? value : value.slice(0, qIdx);
  }
}

function looksLikeUid(value: string): boolean {
  return value.length >= 20 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function scrubValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return "[truncated]";
  if (typeof value === "string") return stripQuery(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (typeof value === "object") {
    if (value instanceof Error) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrubField(k, v, depth + 1);
    }
    return out;
  }
  return undefined;
}

function scrubField(key: string, value: unknown, depth: number): unknown {
  if (PII_KEYS.has(key)) return REDACTED;
  const lk = key.toLowerCase();
  if (lk === "uid" || lk === "userid" || lk === "ownerid" || lk.endsWith("uid")) {
    if (typeof value === "string" && looksLikeUid(value)) return `hashed:${shortHash(value)}`;
  }
  return scrubValue(value, depth);
}

export function scrubRecord(input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!input) return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) out[k] = scrubField(k, v, 1);
  return out;
}

/** The event fields scrubbed — structurally typed so this file needs no SDK. */
export interface ScrubbableEvent {
  extra?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown> | undefined>;
  breadcrumbs?: ScrubbableBreadcrumb[];
}
export interface ScrubbableBreadcrumb {
  data?: Record<string, unknown>;
}

/**
 * Scrubs extras, tags, contexts and breadcrumb data in place and returns the
 * event. `user.id` (the raw uid) is left alone on purpose (OBS-LABEL-12).
 */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.extra) event.extra = scrubRecord(event.extra);
  if (event.tags) {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(event.tags)) {
      clean[k] = PII_KEYS.has(k) ? REDACTED : typeof v === "string" ? stripQuery(v) : v;
    }
    event.tags = clean;
  }
  if (event.contexts) {
    const clean: Record<string, Record<string, unknown> | undefined> = {};
    for (const [k, v] of Object.entries(event.contexts)) clean[k] = v ? scrubRecord(v) : v;
    event.contexts = clean;
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(crumb: B): B {
  if (!crumb.data) return crumb;
  return { ...crumb, data: scrubRecord(crumb.data) };
}
