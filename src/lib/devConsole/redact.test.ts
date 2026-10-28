/**
 * DEVCON-REDACT-1..4 — a screenshot of the dev console must not leak a
 * credential. The app sends `Authorization: Bearer <firebase id token>` on
 * every Cloud-Function / Gemini call (lib/endpoints.ts, lib/gemini.ts,
 * lib/imageUpload.ts), so an unredacted network tab would put a live token
 * on screen.
 *
 * Spec: docs/specs/dev-console.md §5.
 */
import { describe, expect, it } from 'vitest';
import { REDACTED_HEADERS, redact, redactHeaderValue } from './redact';

const JWT =
  'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYyJ9.eyJzdWIiOiJ1aWQxMjMiLCJhdWQiOiJ3dXJsZCJ9.c2lnbmF0dXJlLWhlcmU';

describe('DEVCON-REDACT-2 — the redaction rule', () => {
  it('DEVCON-REDACT-2 — a Bearer token is replaced', () => {
    const out = redact(`Authorization: Bearer ${JWT}`);
    expect(out).toContain('Bearer [redacted]');
    expect(out).not.toContain('c2lnbmF0dXJlLWhlcmU');
  });

  it('DEVCON-REDACT-2 — a bare JWT anywhere in the text is replaced', () => {
    const out = redact(`{"token":"x","raw":"${JWT}"}`);
    expect(out).not.toContain(JWT);
    expect(out).toContain('[redacted');
  });

  it('DEVCON-REDACT-2 — a Google API key is replaced', () => {
    const key = `AIza${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r'}`;
    expect(key.length).toBe(39);
    const out = redact(`https://x/y?key=${key}`);
    expect(out).not.toContain(key);
  });

  it('DEVCON-REDACT-2 — secret-named JSON keys have their value replaced', () => {
    const body = '{"idToken":"abc123","apiKey":"zzz","refresh_token":"rrr","name":"Ada"}';
    const out = redact(body);
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('zzz');
    expect(out).not.toContain('rrr');
    // Non-secret fields survive — redaction must not destroy the payload's
    // usefulness for debugging.
    expect(out).toContain('"name":"Ada"');
    expect(out).toContain('[redacted]');
  });

  it('DEVCON-REDACT-2 — secret-named query params have their value replaced', () => {
    const out = redact('https://fn.example/send?token=abc&access_token=def&chatId=c1');
    expect(out).not.toContain('abc');
    expect(out).not.toContain('def');
    expect(out).toContain('chatId=c1');
  });

  it('DEVCON-REDACT-2 — ordinary text is untouched', () => {
    const text = 'processMessagePipeline finished in 812ms for chat c1';
    expect(redact(text)).toBe(text);
  });

  it('DEVCON-REDACT-2 — redact() is idempotent', () => {
    const once = redact(`Bearer ${JWT}`);
    expect(redact(once)).toBe(once);
  });
});

describe('DEVCON-REDACT-3 — header deny list', () => {
  it('DEVCON-REDACT-3 — the deny list covers every credential header the app sends', () => {
    for (const name of ['authorization', 'x-goog-api-key', 'cookie', 'x-firebase-appcheck']) {
      expect(REDACTED_HEADERS).toContain(name);
    }
  });

  it('DEVCON-REDACT-3 — a denied header is redacted case-insensitively', () => {
    expect(redactHeaderValue('Authorization', `Bearer ${JWT}`)).toBe('[redacted]');
    expect(redactHeaderValue('AUTHORIZATION', 'anything')).toBe('[redacted]');
    expect(redactHeaderValue('X-Api-Key', 'k')).toBe('[redacted]');
  });

  it('DEVCON-REDACT-3 — a non-denied header keeps its value (still text-redacted)', () => {
    expect(redactHeaderValue('Content-Type', 'application/json')).toBe('application/json');
    expect(redactHeaderValue('X-Trace', `Bearer ${JWT}`)).toContain('[redacted]');
  });
});

describe('DEVCON-REDACT-4 — redaction is not defeated by truncation order', () => {
  it('DEVCON-REDACT-4 — a token that would be cut in half by truncation is redacted first', () => {
    // Simulates the capture path: redact() runs on the FULL text, so no
    // half-token prefix can survive into the buffer.
    const body = `{"a":"${'p'.repeat(3990)}","idToken":"${JWT}"}`;
    const out = redact(body);
    expect(out).not.toContain(JWT.slice(0, 20));
  });
});
