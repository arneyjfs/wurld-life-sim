import { describe, expect, it } from 'vitest';
import { AppError, toAppError, toNetworkError, toUserMessage } from './errors';

describe('errors', () => {
  it('AppError carries code + message + cause', () => {
    const cause = new Error('underlying');
    const err = new AppError('network/timeout', 'gemini slow', cause);
    expect(err.code).toBe('network/timeout');
    expect(err.message).toBe('gemini slow');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('AppError');
  });

  it('toAppError preserves existing AppError', () => {
    const original = new AppError('auth/invalid-code');
    expect(toAppError(original)).toBe(original);
  });

  it('toAppError wraps native Error', () => {
    const e = new Error('boom');
    const wrapped = toAppError(e, 'firestore/write-failed');
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.code).toBe('firestore/write-failed');
    expect(wrapped.cause).toBe(e);
  });

  it('toAppError wraps non-Error values', () => {
    const wrapped = toAppError('plain string');
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.code).toBe('unknown');
    expect(wrapped.message).toBe('plain string');
  });

  it('toUserMessage returns a human-readable string for known codes', () => {
    expect(toUserMessage(new AppError('auth/invalid-phone'))).toMatch(/phone/i);
    expect(toUserMessage(new AppError('network/offline'))).toMatch(/offline/i);
    expect(toUserMessage('random')).toMatch(/wrong/i);
  });
});

/**
 * LANG-TIER-1.1 — a refusal has to say what was refused.
 *
 * `firestore/permission-denied` has carried user-facing copy since this module
 * was written and NOTHING could ever reach it: `toAppError` looked only at
 * `instanceof Error` and the `fallback` argument, never at the `code` the
 * Firebase SDK puts on the error it throws. So every rules rejection in the app
 * — including LANG-TIER-2's `chats` create rule, the one gate that is real
 * enforcement rather than a rendering decision — surfaced as "Something went
 * wrong."
 *
 * That is the worst possible copy for this case, because it is the one message
 * that tells the user to try again. A rules rejection will fail identically
 * forever.
 */
const firebaseErr = (code: string, message = 'FIREBASE: denied') =>
  Object.assign(new Error(message), { code });

describe('LANG-TIER-1.1 — Firestore error codes reach their copy', () => {
  it('LANG-TIER-1.1 — a permission-denied maps to firestore/permission-denied', () => {
    const err = firebaseErr('permission-denied', 'Missing or insufficient permissions.');
    expect(toAppError(err).code).toBe('firestore/permission-denied');
  });

  it('LANG-TIER-1.1 — its copy is reachable, and is not the generic one', () => {
    const err = firebaseErr('permission-denied');
    expect(toUserMessage(err)).not.toMatch(/something went wrong/i);
    expect(toUserMessage(err)).toMatch(/access/i);
  });

  it('LANG-TIER-1.1 — the code wins over the caller’s fallback', () => {
    // The caller's fallback is a guess about an error it has not inspected.
    // A code the SDK actually set is not a guess.
    expect(toAppError(firebaseErr('permission-denied'), 'pipeline/failed').code)
      .toBe('firestore/permission-denied');
  });

  it('LANG-TIER-1.1 — the cause is preserved so logs keep the original', () => {
    const err = firebaseErr('permission-denied');
    expect(toAppError(err).cause).toBe(err);
  });

  it('LANG-TIER-1.1 — an AppError still short-circuits, unchanged', () => {
    // AppError has a `code` too. Re-mapping one would silently rewrite every
    // deliberate code this module already throws.
    const original = new AppError('chat/paused');
    expect(toAppError(original)).toBe(original);
  });

  it.each([
    ['a Firebase Auth code', 'auth/invalid-verification-code'],
    ['an unmapped Firestore code', 'aborted'],
    ['a non-string code', 42],
    ['no code at all', undefined],
  ])('LANG-TIER-1.1 — %s leaves the fallback alone', (_label, code) => {
    // The map is deliberately narrow. Widening it re-routes copy on paths that
    // were never inspected — the auth screens pass their own fallbacks and
    // mean them.
    const err = code === undefined ? new Error('boom') : firebaseErr(code as string);
    expect(toAppError(err, 'auth/unknown').code).toBe('auth/unknown');
  });

  // ⚠ `chat/group-create-denied` was asserted here until 2026-09-21. The test
  // was right about its own subject — the copy did name the rule and the way
  // out — but the RULE is retired (LANG-TIER-2): nothing refuses a group
  // create any more, so the sentence it pinned ("Starting a group needs
  // Plus") is exactly the one the owner called not strictly true. The code and
  // its copy are deleted with it; a test kept alive for a retired error code is
  // what stops the next author removing dead copy.

  it('LANG-TIER-1.1 — a 402 from a paid endpoint has copy that names the tier', () => {
    const msg = toUserMessage(new AppError('feature/requires-plan'));
    expect(msg).toMatch(/plus/i);
    // Deliberately NOT "try again": a 402 fails identically until somebody's
    // billing changes (LANG-GATE-6's reasoning, applied to the Gemini proxy).
    expect(msg).not.toMatch(/try again/i);
  });
});

describe('OBS-LABEL-4 — the error keeps its identity', () => {
  it('OBS-LABEL-4 — a wrapped Error keeps its name (TypeError, FirebaseError, …)', () => {
    expect(toAppError(new TypeError('Failed to fetch')).name).toBe('TypeError');
    const fb = Object.assign(new Error('x'), { name: 'FirebaseError', code: 'unavailable' });
    expect(toAppError(fb).name).toBe('FirebaseError');
  });

  it('OBS-LABEL-4 — a plain Error stays named Error, a constructed AppError stays AppError', () => {
    expect(toAppError(new Error('x')).name).toBe('Error');
    expect(new AppError('unknown').name).toBe('AppError');
  });

  it('OBS-LABEL-4 — any string .code is kept as originalCode', () => {
    expect(toAppError(firebaseErr('unavailable')).originalCode).toBe('unavailable');
    expect(toAppError(firebaseErr('auth/network-request-failed')).originalCode).toBe('auth/network-request-failed');
    expect(toAppError(firebaseErr('permission-denied')).originalCode).toBe('permission-denied');
    expect(toAppError(new Error('x')).originalCode).toBeUndefined();
  });

  it('OBS-LABEL-4 — a non-Error object is described by code / message / errorMessage, never [object Object]', () => {
    const a = toAppError({ code: 'UNIMPLEMENTED', message: 'not on web' });
    expect(a.message).toBe('not on web');
    expect(a.originalCode).toBe('UNIMPLEMENTED');
    expect(a.message).not.toContain('[object Object]');
    const b = toAppError({ errorMessage: 'plugin said no' });
    expect(b.message).toBe('plugin said no');
    const c = toAppError({ code: 'E42' });
    expect(c.message).toBe('E42');
    expect(toAppError({}).message).not.toContain('[object Object]');
  });

  it('OBS-LABEL-4 — an AppError keeps HTTP details passed to it', () => {
    const e = new AppError('server/forbidden', 'callHttp deleteChat 403', undefined, {
      functionName: 'deleteChat',
      httpStatus: 403,
      serverError: 'not_member',
    });
    expect(e).toMatchObject({ functionName: 'deleteChat', httpStatus: 403, serverError: 'not_member' });
  });
});

describe('OBS-LABEL-7 — copy per new code', () => {
  it.each([
    'server/forbidden',
    'server/not-found',
    'server/conflict',
    'server/rate-limited',
    'server/bad-request',
    'server/unavailable',
  ] as const)('OBS-LABEL-7 — %s has its own copy, not the generic one', (code) => {
    const msg = toUserMessage(new AppError(code));
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).not.toBe(toUserMessage(new AppError('unknown')));
  });
});

describe('OBS-LABEL-8 — toNetworkError', () => {
  it('OBS-LABEL-8 — a fetch TypeError becomes network/offline with the function name, keeping its name', () => {
    const err = toNetworkError(new TypeError('Failed to fetch'), 'deleteChat');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'network/offline', functionName: 'deleteChat', name: 'TypeError' });
    expect((err as Error).message).not.toMatch(/\b[45]\d\d\b/);
  });

  it('OBS-LABEL-8 — an abort / timeout becomes network/timeout', () => {
    const abort = toNetworkError(new DOMException('aborted', 'AbortError'), 'geminiGenerate');
    expect(abort).toMatchObject({ code: 'network/timeout', functionName: 'geminiGenerate', name: 'AbortError' });
    const timeout = toNetworkError(new DOMException('signal timed out', 'TimeoutError'), 'processMessagePipeline');
    expect(timeout).toMatchObject({ code: 'network/timeout', name: 'TimeoutError' });
  });

  it('OBS-LABEL-8 — anything else (an AppError, an unknown error) is returned unchanged', () => {
    const app = new AppError('pipeline/failed');
    expect(toNetworkError(app, 'x')).toBe(app);
    const other = new RangeError('nope');
    expect(toNetworkError(other, 'x')).toBe(other);
  });
});
