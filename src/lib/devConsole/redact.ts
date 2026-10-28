/**
 * DEVCON-REDACT-1..4 — credential scrubbing.
 *
 * The app sends `Authorization: Bearer <firebase id token>` on every
 * Cloud-Function / Gemini / Storage call (lib/endpoints.ts, lib/gemini.ts,
 * lib/imageUpload.ts). An unredacted network tab would put a live token on
 * screen, and a screenshot of it into a bug report.
 *
 * This runs at CAPTURE time, BEFORE the string enters a buffer and BEFORE
 * truncation (DEVCON-REDACT-4 — truncating first could cut a token in half and
 * leave a prefix the pattern no longer matches).
 *
 * Spec: docs/specs/dev-console.md §5.
 */

/** DEVCON-REDACT-3 — headers whose VALUE is never recorded, matched on name. */
export const REDACTED_HEADERS: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-goog-api-key',
  'x-firebase-appcheck',
  'x-firebase-auth',
];

/** `"…token…": "value"` — the key names that mark a secret in a JSON body. */
const SECRET_JSON_RE =
  /("[\w.-]*(?:authorization|token|secret|password|passwd|api[-_]?key|apikey|credential|auth)[\w.-]*"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;

/** `?token=…` / `&access_token=…` in a URL. */
const SECRET_QUERY_RE =
  /([?&](?:access_token|id_token|api_key|apikey|password|token|key|auth)=)[^&\s"'#]*/gi;

/** `Bearer <anything token-shaped>`. */
const BEARER_RE = /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi;

/** A JWT — three dot-separated base64url segments starting `eyJ`. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;

/** A Google API key. */
const GOOGLE_KEY_RE = /AIza[0-9A-Za-z\-_]{35}/g;

/**
 * DEVCON-REDACT-2 — scrub every credential shape we know about.
 *
 * Idempotent: `[redacted]` placeholders contain characters none of the
 * patterns accept, so re-running is a no-op.
 */
export function redact(text: string): string {
  if (!text) return text;
  try {
    return text
      .replace(SECRET_JSON_RE, '$1"[redacted]"')
      .replace(BEARER_RE, 'Bearer [redacted]')
      .replace(JWT_RE, '[redacted-jwt]')
      .replace(GOOGLE_KEY_RE, '[redacted-key]')
      .replace(SECRET_QUERY_RE, '$1[redacted]');
  } catch {
    // A pathological input must never break capture — better to drop the
    // text than to risk emitting it unredacted.
    return '[redaction failed]';
  }
}

/**
 * DEVCON-REDACT-3 — a header's recordable value. Denied names lose their value
 * entirely; everything else is still passed through {@link redact} in case a
 * token is hiding in a custom header.
 */
export function redactHeaderValue(name: string, value: string): string {
  if (REDACTED_HEADERS.includes(name.toLowerCase())) return '[redacted]';
  return redact(value);
}
