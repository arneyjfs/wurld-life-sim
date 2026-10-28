import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Breadcrumb, ErrorEvent } from '@sentry/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Pin config to a stable shape — `dev` env means `log.*` also routes to
// console, which we silence per-test.
vi.mock('./config', () => ({
  config: {
    env: 'dev',
    firebase: {
      apiKey: 'k',
      authDomain: 'a',
      projectId: 'p',
      storageBucket: 's',
      messagingSenderId: 'm',
      appId: 'app',
      measurementId: undefined,
    },
    functionsUrl: 'https://us-central1-test.cloudfunctions.net',
    fcmVapidKey: undefined,
    sentryDsn: undefined,
    e2eTest: false,
  },
}));

// Mock analytics so log.event doesn't try to reach Firebase.
vi.mock('./analytics', () => ({
  trackEvent: vi.fn(),
}));

// Mock the entire @sentry/react surface we touch. Tests inspect what was
// passed to these mocks rather than asserting on a live SDK.
const captureExceptionMock = vi.fn();
const addBreadcrumbMock = vi.fn();
const setUserMock = vi.fn();
vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbMock(...args),
  captureMessage: vi.fn(),
  setUser: (...args: unknown[]) => setUserMock(...args),
  setTag: vi.fn(),
}));
vi.mock('@sentry/capacitor', () => ({ init: vi.fn() }));

import {
  applyEventHygiene,
  scrubBreadcrumb,
  scrubEvent,
  scrubRecord,
  scrubValue,
} from './sentry';
import * as log from './log';

beforeEach(() => {
  captureExceptionMock.mockReset();
  addBreadcrumbMock.mockReset();
  setUserMock.mockReset();
  // Silence dev-mode console.error/warn/log spew from log.* calls.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scrubValue', () => {
  it('passes primitives through (strings stripped of query)', () => {
    expect(scrubValue('hello')).toBe('hello');
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(true)).toBe(true);
    expect(scrubValue(null)).toBe(null);
    expect(scrubValue(undefined)).toBe(undefined);
  });

  it('strips query strings from URL-shaped values', () => {
    expect(
      scrubValue('https://example.com/path?token=abc&uid=xyz'),
    ).toBe('https://example.com/path');
  });

  it('leaves non-URL strings untouched even if they contain ?', () => {
    expect(scrubValue('what time is it?')).toBe('what time is it?');
  });

  it('truncates at MAX_DEPTH so a deep tree terminates', () => {
    // Build a deep nest: 10 levels deep, deeper than MAX_DEPTH (6).
    let leaf: unknown = { v: 'leaf' };
    for (let i = 0; i < 10; i++) leaf = { nest: leaf };
    const out = scrubValue(leaf);
    // Walk down counting levels until we hit the `[truncated]` sentinel.
    let cur: unknown = out;
    let levels = 0;
    while (cur && typeof cur === 'object' && levels < 20) {
      cur = (cur as { nest?: unknown }).nest;
      levels++;
    }
    expect(cur).toBe('[truncated]');
    // And we should have stopped before walking all 10 original levels.
    expect(levels).toBeLessThanOrEqual(10);
  });

  it('does not mutate the input object', () => {
    const input = { chatId: 'c123', nested: { messageId: 'm456' } };
    const frozen = JSON.parse(JSON.stringify(input));
    scrubValue(input);
    expect(input).toEqual(frozen);
  });
});

describe('scrubRecord', () => {
  it('redacts known PII keys', () => {
    const out = scrubRecord({
      chatId: 'c-123',
      messageId: 'm-456',
      originalText: 'Hello, Alice!',
      text: 'Bonjour',
      caption: 'a photo',
      phoneNumber: '+15551234',
      email: 'a@b.com',
      displayName: 'Alice',
      action: 'sendMessage', // not PII — survives
    });
    expect(out).toEqual({
      chatId: '[redacted]',
      messageId: '[redacted]',
      originalText: '[redacted]',
      text: '[redacted]',
      caption: '[redacted]',
      phoneNumber: '[redacted]',
      email: '[redacted]',
      displayName: '[redacted]',
      action: 'sendMessage',
    });
  });

  it('hashes uid-like keys instead of redacting them', () => {
    // 28-char Firebase-uid-looking string
    const uid = 'abc123DEF456ghi789JKL012mno3';
    const out = scrubRecord({ uid, userId: uid, ownerUid: uid });
    expect(out?.uid).toMatch(/^hashed:[a-z0-9]+$/);
    expect(out?.userId).toBe(out?.uid);
    expect(out?.ownerUid).toBe(out?.uid);
  });

  it('does not hash uid-shaped keys when value is too short', () => {
    const out = scrubRecord({ uid: 'short' });
    // Falls through to scrubValue; non-URL string passes through.
    expect(out?.uid).toBe('short');
  });

  it('recurses into nested objects + arrays', () => {
    const out = scrubRecord({
      action: 'foo',
      payload: {
        chatId: 'c-123',
        contents: [{ text: 'hi' }, { other: 'kept' }],
      },
    });
    expect(out).toEqual({
      action: 'foo',
      payload: {
        chatId: '[redacted]',
        contents: [{ text: '[redacted]' }, { other: 'kept' }],
      },
    });
  });

  it('returns undefined for undefined input', () => {
    expect(scrubRecord(undefined)).toBeUndefined();
  });
});

describe('scrubEvent', () => {
  it('strips PII keys from extra, tags, contexts, and breadcrumbs', () => {
    const event: ErrorEvent = {
      type: undefined,
      extra: {
        chatId: 'c-1',
        originalText: 'secret message',
        action: 'sendMessage',
      },
      tags: {
        code: 'pipeline/failed',
        messageId: 'm-1',
      },
      contexts: {
        custom: {
          phoneNumber: '+15551234',
          screen: 'Chat',
        },
      },
      breadcrumbs: [
        {
          category: 'app',
          message: 'sending',
          data: { chatId: 'c-1', action: 'send' },
        },
      ],
      exception: {
        values: [{ type: 'AppError', value: 'pipeline/failed' }],
      },
    };

    const out = scrubEvent(event);

    expect(out.extra).toEqual({
      chatId: '[redacted]',
      originalText: '[redacted]',
      action: 'sendMessage',
    });
    expect(out.tags).toEqual({
      code: 'pipeline/failed',
      messageId: '[redacted]',
    });
    expect(out.contexts?.custom).toEqual({
      phoneNumber: '[redacted]',
      screen: 'Chat',
    });
    expect(out.breadcrumbs?.[0]?.data).toEqual({
      chatId: '[redacted]',
      action: 'send',
    });
    // Exception payload is preserved verbatim — Sentry needs it for grouping.
    expect(out.exception).toEqual(event.exception);
  });

  it('strips query strings from URL-shaped tag values', () => {
    const event: ErrorEvent = {
      type: undefined,
      tags: { url: 'https://api.example.com/v1/messages?token=abc123' },
    };
    const out = scrubEvent(event);
    expect(out.tags?.url).toBe('https://api.example.com/v1/messages');
  });
});

describe('scrubBreadcrumb', () => {
  it('redacts PII keys in breadcrumb data', () => {
    const crumb: Breadcrumb = {
      category: 'app',
      message: 'sent',
      data: { chatId: 'c-1', originalText: 'hi', action: 'send' },
    };
    const out = scrubBreadcrumb(crumb);
    expect(out.data).toEqual({
      chatId: '[redacted]',
      originalText: '[redacted]',
      action: 'send',
    });
    // Original is untouched.
    expect(crumb.data?.chatId).toBe('c-1');
  });

  it('returns the breadcrumb unchanged when there is no data', () => {
    const crumb: Breadcrumb = { category: 'app', message: 'noop' };
    const out = scrubBreadcrumb(crumb);
    expect(out).toBe(crumb);
  });

  it('strips query strings from URL-shaped data values', () => {
    const crumb: Breadcrumb = {
      category: 'fetch',
      data: { url: 'https://api.example.com/x?token=abc' },
    };
    const out = scrubBreadcrumb(crumb);
    expect(out.data?.url).toBe('https://api.example.com/x');
  });
});

// Helper: pull the Nth call's args off a vitest mock with the right typing
// without tripping `noUncheckedIndexedAccess`.
function nthCall<T extends unknown[]>(
  mock: { mock: { calls: unknown[][] } },
  n: number,
): T {
  const call = mock.mock.calls[n];
  if (!call) throw new Error(`mock call #${n} not made`);
  return call as T;
}

describe('log.error PII handling', () => {
  it('redacts chatId/originalText in extra but keeps the error intact', () => {
    const err = new Error('boom');
    log.error(err, { chatId: 'c-123', originalText: 'hello there', action: 'send' });

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [appErr, options] = nthCall<
      [Error, { extra?: Record<string, unknown>; tags?: Record<string, unknown> }]
    >(captureExceptionMock, 0);

    // The AppError itself is preserved (cause chain wraps the original).
    expect(appErr).toBeInstanceOf(Error);
    expect((appErr as { message: string }).message).toBe('boom');

    // PII is scrubbed before reaching Sentry.
    expect(options.extra).toEqual({
      chatId: '[redacted]',
      originalText: '[redacted]',
      action: 'send',
    });
    // Code tag survives — it's needed for triage; `action` is promoted to a
    // tag as well (OBS-LABEL-5).
    expect(options.tags).toEqual({ code: 'unknown', action: 'send' });
  });

  it('handles log.error(err) with no context (does not crash)', () => {
    log.error(new Error('x'));
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, options] = nthCall<[Error, { extra?: Record<string, unknown> }]>(
      captureExceptionMock,
      0,
    );
    expect(options.extra).toBeUndefined();
  });

  it('scrubs breadcrumb data on log.info / log.warn', () => {
    log.info('sending message', { chatId: 'c-1', action: 'send' });
    log.warn('slow path', { messageId: 'm-1', durationMs: 1234 });

    expect(addBreadcrumbMock).toHaveBeenCalledTimes(2);
    const [infoCrumb] = nthCall<[Breadcrumb]>(addBreadcrumbMock, 0);
    const [warnCrumb] = nthCall<[Breadcrumb]>(addBreadcrumbMock, 1);

    expect(infoCrumb.data).toEqual({ chatId: '[redacted]', action: 'send' });
    expect(warnCrumb.data).toEqual({ messageId: '[redacted]', durationMs: 1234 });
  });
});

// OBS-FIRESTORE-2 — beforeSend hygiene: collapse the Firestore async-queue-fatal
// variants under one fingerprint + tag, and drop transient `Load failed` noise.
describe('applyEventHygiene', () => {
  const evt = (value: string): ErrorEvent =>
    ({ exception: { values: [{ type: 'Error', value }] } }) as unknown as ErrorEvent;

  it('drops transient "Load failed" fetch errors (returns null)', () => {
    expect(applyEventHygiene(evt('AppError: Load failed'))).toBeNull();
  });

  it('fingerprints + tags the Firestore async-queue-fatal so the variants collapse to one issue', () => {
    const e = applyEventHygiene(
      evt(
        'FIRESTORE (12.13.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) CONTEXT: {"Rc":"Failed to delete record from object store"}',
      ),
    );
    expect(e).not.toBeNull();
    expect(e?.fingerprint).toEqual(['firestore-async-queue-fatal']);
    expect(e?.tags?.firestore_self_heal).toBe('true');
  });

  it('passes ordinary errors through unchanged (no fingerprint)', () => {
    const e = applyEventHygiene(evt('TypeError: cannot read property x'));
    expect(e).not.toBeNull();
    expect(e?.fingerprint).toBeUndefined();
  });
});

describe('OBS-9a — Session Replay is not shipped', () => {
  // Read the source as text: the property under test is what the BUNDLER can
  // tree-shake, which no runtime assertion against the mocked SDK can see.
  const src = readFileSync(path.resolve(import.meta.dirname, 'sentry.ts'), 'utf8');

  it('OBS-9a — sentry.ts never binds the @sentry/react namespace', () => {
    expect(src).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s+['"]@sentry\/react['"]/);
  });

  it('OBS-9a — no replay integration is referenced', () => {
    expect(src).not.toMatch(/replayIntegration|replayCanvasIntegration/);
  });

  it('OBS-9a — the facade log.ts uses exposes exactly the calls it needs', async () => {
    const { sentry } = await import('./sentry');
    expect(Object.keys(sentry).sort()).toEqual(['addBreadcrumb', 'captureException', 'captureMessage', 'setUser']);
  });
});

describe('OBS-LABEL-9 — "Load failed" is dropped only when unlabelled', () => {
  const evt = (value: string, tags?: Record<string, string>): ErrorEvent =>
    ({ exception: { values: [{ type: 'TypeError', value }] }, tags }) as unknown as ErrorEvent;

  it('OBS-LABEL-9 — an unlabelled Load failed is dropped', () => {
    expect(applyEventHygiene(evt('Load failed'))).toBeNull();
    expect(applyEventHygiene(evt('Load failed', { code: 'network/offline' }))).toBeNull();
  });

  it('OBS-LABEL-9 — a Load failed with an action tag is kept', () => {
    expect(applyEventHygiene(evt('Load failed', { action: 'sendMessage' }))).not.toBeNull();
  });
});

describe('OBS-LABEL-12 — additional PII keys', () => {
  it.each(['phrase', 'fileName', 'line', 'word', 'query'])('OBS-LABEL-12 — %s is redacted', (key) => {
    expect(scrubRecord({ [key]: 'secret words' })).toEqual({ [key]: '[redacted]' });
  });

  it('OBS-LABEL-12 — extras that name a uid are still hashed', () => {
    const out = scrubRecord({ ownerUid: 'Xy7aB2cD3eF4gH5iJ6kL7mN8oP9q' });
    expect(out?.ownerUid).toMatch(/^hashed:/);
  });
});

describe('OBS-LABEL-4/5/10 — log.error labelling', () => {
  type Opts = { extra?: Record<string, unknown>; tags?: Record<string, unknown> };

  it('OBS-LABEL-4 — tags code and original_code, and the event keeps the original name', () => {
    const err = Object.assign(new Error('offline'), { name: 'FirebaseError', code: 'unavailable' });
    log.error(err, { action: 'loadChats' });
    const [appErr, options] = nthCall<[Error, Opts]>(captureExceptionMock, 0);
    expect(appErr.name).toBe('FirebaseError');
    expect(options.tags).toMatchObject({ code: 'unknown', original_code: 'unavailable', action: 'loadChats' });
  });

  it('OBS-LABEL-5 — triage keys are tags as well as extras', () => {
    log.error(new Error('x'), { action: 'purchase', provider: 'apple', functionName: 'appleSyncTransaction', httpStatus: 500 });
    const [, options] = nthCall<[Error, Opts]>(captureExceptionMock, 0);
    expect(options.tags).toMatchObject({ action: 'purchase', provider: 'apple', function: 'appleSyncTransaction', http_status: '500' });
    expect(options.extra).toMatchObject({ action: 'purchase', provider: 'apple' });
  });

  it('OBS-LABEL-10 — an expected code is a breadcrumb, not an event', async () => {
    const { AppError } = await import('./errors');
    log.error(new AppError('auth/cancelled'), { action: 'signIn', method: 'google' });
    log.error(new AppError('feature/requires-plan'), { action: 'explain' });
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(addBreadcrumbMock).toHaveBeenCalledTimes(2);
    const [crumb] = nthCall<[Breadcrumb]>(addBreadcrumbMock, 0);
    expect(crumb.message).toContain('auth/cancelled');
    expect(crumb.data).toMatchObject({ action: 'signIn', method: 'google' });
  });

  it('OBS-LABEL-10 — an unexpected code is still captured', async () => {
    const { AppError } = await import('./errors');
    log.error(new AppError('auth/too-many-requests'), { action: 'signIn' });
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
