/**
 * LIFE-NODE-14 — a THROWN generate is retried; it does not abandon the turn.
 *
 * Spec: docs/specs/life-sim.md — LIFE-NODE-14 (and LIFE-NODE-8, the snag
 * ladder these retries keep the player out of).
 *
 * THE BUG THESE EXIST FOR. Reported 2026-08-03: "I hit 'the story hit a snag'
 * a lot." Both life-sim generators retried CONTENT faults (bad JSON, schema
 * miss, leaked answer) but `return`ed out of the ladder the moment
 * `generateGemini` THREW, so one dropped socket became the snag screen — whose
 * Continue chip does nothing but make the same call again.
 *
 * The assertions are about the LADDER, not about a mock being called: a
 * transient failure must be followed by a real second attempt whose result is
 * returned, and a deterministic failure must NOT be, because retrying it
 * spends the player's wait to land in the same place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

const generateGemini = vi.fn<(r: unknown) => Promise<string>>();

vi.mock('@/lib/gemini', () => ({ generateGemini: (r: unknown) => generateGemini(r) }));
vi.mock('@/lib/log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('./debugLog', () => ({
  lifeDebug: vi.fn(),
  lifeWarn: vi.fn(),
  lifeFailed: vi.fn(),
}));

import { lifeFailed, lifeWarn } from './debugLog';
import {
  TRANSPORT_BACKOFF_MS,
  generateWithTransportRetry,
  isTransientGenError,
} from './generateWithRetry';

const lifeWarnMock = vi.mocked(lifeWarn);
const lifeFailedMock = vi.mocked(lifeFailed);

const REQ = { prompt: 'p', category: 'life_step' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

// ⚠ Restore the real clock. This file was the only one in the suite that
// installed fake timers and never put them back. Vitest's per-file isolation
// means it does not leak today — but the protection is a CONFIG default, not
// anything this file does, and `isolate: false` is the first thing anyone
// reaches for when the suite gets slow. A time-frozen global is the worst
// possible thing to leak into a suite containing trial-expiry and
// entitlement-clock tests, because it does not fail loudly: it makes
// `Date.now()` stop, and every "is this still in the future" assertion quietly
// becomes a different question.
afterEach(() => {
  vi.useRealTimers();
});

/** Drives the backoff sleeps to completion without waiting real time.
 *
 *  The rejection handler is attached SYNCHRONOUSLY, before the timers are
 *  advanced — otherwise the ladder rejects while the test is still pumping the
 *  clock and vitest reports an unhandled rejection for a failure the test is
 *  about to assert on. */
async function run(): Promise<string> {
  const settled = generateWithTransportRetry(REQ).then(
    (text) => ({ text, err: undefined }),
    (err: unknown) => ({ text: undefined, err }),
  );
  // Each `await` boundary needs the timers advanced past its backoff; run the
  // whole ladder's worth so the promise settles regardless of where it stopped.
  for (let i = 0; i <= TRANSPORT_BACKOFF_MS.length + 1; i++) {
    await vi.advanceTimersByTimeAsync(2_000);
  }
  const r = await settled;
  if (r.err !== undefined) throw r.err;
  return r.text!;
}

describe('LIFE-NODE-14 — isTransientGenError', () => {
  it('retries the transport failures — socket, offline, timeout, rate limit', () => {
    // A bare fetch rejection has no AppError code at all: the browser gave up
    // before a response existed. This is the case the 2026-08-03 harness hit
    // twice in eight runs, and the one that produced the reported snag.
    expect(isTransientGenError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientGenError(new AppError('network/offline'))).toBe(true);
    expect(isTransientGenError(new AppError('network/timeout'))).toBe(true);
    expect(isTransientGenError(new AppError('pipeline/rate-limited'))).toBe(true);
  });

  it('retries a 5xx / 429 / 408 from the proxy, and the 45s abort', () => {
    expect(
      isTransientGenError(new AppError('pipeline/failed', 'geminiGenerate 503: busy')),
    ).toBe(true);
    expect(
      isTransientGenError(new AppError('pipeline/failed', 'geminiGenerate 429: quota')),
    ).toBe(true);
    expect(
      isTransientGenError(new AppError('pipeline/failed', 'geminiGenerate 408: slow')),
    ).toBe(true);
    expect(
      isTransientGenError(
        new AppError('pipeline/failed', 'generateGemini timed out after 45000ms'),
      ),
    ).toBe(true);
  });

  it('does NOT retry a deterministic failure — auth, authorisation, a 400', () => {
    // These reproduce exactly. Retrying costs the player two more spinners and
    // lands on the identical error.
    expect(isTransientGenError(new AppError('auth/session-expired'))).toBe(false);
    expect(isTransientGenError(new AppError('network/unauthorized'))).toBe(false);
    expect(
      isTransientGenError(new AppError('pipeline/failed', 'geminiGenerate 400: Missing prompt')),
    ).toBe(false);
  });
});

describe('LIFE-NODE-14 — generateWithTransportRetry', () => {
  it('returns the SECOND attempt’s text after a transient throw', async () => {
    generateGemini
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce('{"ok":true}');
    await expect(run()).resolves.toBe('{"ok":true}');
    expect(generateGemini).toHaveBeenCalledTimes(2);
  });

  it('survives a run of transient throws up to the ladder length', async () => {
    generateGemini
      .mockRejectedValueOnce(new AppError('pipeline/rate-limited'))
      .mockRejectedValueOnce(new AppError('pipeline/failed', 'geminiGenerate 503: busy'))
      .mockResolvedValueOnce('recovered');
    await expect(run()).resolves.toBe('recovered');
    expect(generateGemini).toHaveBeenCalledTimes(3);
  });

  it('throws the last error once the ladder is spent — bounded, never a hang', async () => {
    generateGemini.mockRejectedValue(new TypeError('fetch failed'));
    await expect(run()).rejects.toThrow('fetch failed');
    // 1 initial + one per backoff. The bound is the point: a ladder long
    // enough to outlast a real outage would read to the player as a hang.
    expect(generateGemini).toHaveBeenCalledTimes(TRANSPORT_BACKOFF_MS.length + 1);
  });

  it('does not retry a deterministic failure — one call, then out', async () => {
    generateGemini.mockRejectedValue(new AppError('auth/session-expired'));
    await expect(run()).rejects.toThrow();
    expect(generateGemini).toHaveBeenCalledTimes(1);
  });

  it('makes exactly one call on the happy path', async () => {
    generateGemini.mockResolvedValue('first time');
    await expect(run()).resolves.toBe('first time');
    expect(generateGemini).toHaveBeenCalledTimes(1);
  });
});

/**
 * LIFE-NODE-15(d) — the retry is logged where it is DECIDED, not where the
 * ladder ends. Owner report, 2026-08-03: *"log the reason they failed even if
 * they retry"*. A transport blip that the SECOND attempt recovers from produces
 * a perfectly good turn and, before this, left no trace anywhere but the
 * browser console — which a route change wipes. The buffer entry is the only
 * evidence that the turn cost three round-trips instead of one.
 */
describe('LIFE-NODE-15 — a transport retry is visible even when it SUCCEEDS', () => {
  it('LIFE-NODE-15 — logs the failed attempt + its reason before retrying, on a run that then succeeds', async () => {
    generateGemini
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce('{"ok":true}');

    await expect(run()).resolves.toBe('{"ok":true}');

    // The call SUCCEEDED. The failure that preceded it must still be in the
    // buffer — that is the whole point of the invariant.
    expect(lifeWarnMock).toHaveBeenCalledTimes(1);
    const [channel, summary, payload] = lifeWarnMock.mock.calls[0]!;
    expect(channel).toBe('GEN-RETRY');
    expect(summary).toMatch(/retry/i);
    // Enough to diagnose without re-deriving: WHICH call, WHICH attempt, WHY.
    expect(payload).toMatchObject({ category: 'life_step', attempt: 0 });
    expect(String(payload?.err)).toContain('fetch failed');
    expect(payload?.backoffMs).toBe(TRANSPORT_BACKOFF_MS[0]);
  });

  it('LIFE-NODE-15 — a recovered blip is warn-level, NOT a -FAILED entry', async () => {
    // `lifeFailed` tags `LIFE/<channel>-FAILED`. The turn did not fail: it
    // recovered. Tagging it FAILED makes a recovered blip indistinguishable
    // from an abandoned turn in the overlay.
    generateGemini
      .mockRejectedValueOnce(new AppError('pipeline/rate-limited'))
      .mockResolvedValueOnce('recovered');

    await expect(run()).resolves.toBe('recovered');

    expect(lifeFailedMock).not.toHaveBeenCalled();
    expect(lifeWarnMock).toHaveBeenCalledTimes(1);
  });

  it('LIFE-NODE-15 — every attempt of a run of transient failures is logged, in order', async () => {
    generateGemini
      .mockRejectedValueOnce(new AppError('pipeline/rate-limited'))
      .mockRejectedValueOnce(new AppError('pipeline/failed', 'geminiGenerate 503: busy'))
      .mockResolvedValueOnce('recovered');

    await expect(run()).resolves.toBe('recovered');

    expect(lifeWarnMock).toHaveBeenCalledTimes(2);
    expect(lifeWarnMock.mock.calls[0]![2]).toMatchObject({ attempt: 0 });
    expect(lifeWarnMock.mock.calls[1]![2]).toMatchObject({ attempt: 1 });
    expect(String(lifeWarnMock.mock.calls[1]![2]?.err)).toContain('503');
  });

  it('LIFE-NODE-15 — a deterministic failure logs no retry: there is no retry to log', async () => {
    // The caller logs the terminal failure (LIFE-NODE-15(a)). Logging it here
    // too would double-count every abandoned turn in the overlay.
    generateGemini.mockRejectedValue(new AppError('auth/session-expired'));
    await expect(run()).rejects.toThrow();
    expect(lifeWarnMock).not.toHaveBeenCalled();
  });

  it('LIFE-NODE-15 — the happy path logs nothing', async () => {
    generateGemini.mockResolvedValue('first time');
    await expect(run()).resolves.toBe('first time');
    expect(lifeWarnMock).not.toHaveBeenCalled();
    expect(lifeFailedMock).not.toHaveBeenCalled();
  });
});
