import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { generateOnceWithRetry, isRetryableGenError } from './generateOnceWithRetry';

/**
 * LIFE-FAIL-10 — one retry for the once-per-world / once-per-chapter calls.
 *
 * From the reported session: `TypeError: Load failed` (WebKit's transport
 * failure) killed chapter 1's arc outright, because the arc is generated once
 * and nothing later re-attempts it.
 */
describe('LIFE-FAIL-10 — isRetryableGenError', () => {
  it('retries a transport failure — the case this exists for', () => {
    expect(isRetryableGenError(new TypeError('Load failed'))).toBe(true);
    expect(isRetryableGenError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('retries a server-side or transient AppError', () => {
    expect(isRetryableGenError(new AppError('pipeline/failed', 'geminiGenerate 503:'))).toBe(true);
    expect(isRetryableGenError(new AppError('pipeline/rate-limited'))).toBe(true);
  });

  it('does NOT retry an error a second attempt cannot fix', () => {
    // No session / rejected token: retrying only delays the fallback the
    // player is already waiting on.
    expect(isRetryableGenError(new AppError('auth/session-expired'))).toBe(false);
    expect(isRetryableGenError(new AppError('network/unauthorized'))).toBe(false);
  });
});

describe('LIFE-FAIL-10 — generateOnceWithRetry', () => {
  it('returns the first result without a second call when it succeeds', async () => {
    const attempt = vi.fn(async () => 'ok');
    await expect(generateOnceWithRetry(attempt)).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('recovers a dropped socket on the second attempt', async () => {
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce('arc-json');
    await expect(generateOnceWithRetry(attempt)).resolves.toBe('arc-json');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('reports the SECOND error, since that is the one that decided the outcome', async () => {
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockRejectedValueOnce(new AppError('pipeline/failed', 'geminiGenerate 500:'));
    await expect(generateOnceWithRetry(attempt)).rejects.toThrow('geminiGenerate 500:');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('gives up immediately on a terminal error', async () => {
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new AppError('auth/session-expired'));
    await expect(generateOnceWithRetry(attempt)).rejects.toThrow();
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('announces the retry so a recovered failure is still visible in the log', async () => {
    // A retry that leaves no trace makes the failure rate unobservable — the
    // log line is how you find out whether this is earning its keep.
    const onRetry = vi.fn();
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce('ok');
    await generateOnceWithRetry(attempt, onRetry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(String(onRetry.mock.calls[0]![0])).toContain('Load failed');
  });

  it('does not call onRetry when the first attempt succeeds', async () => {
    const onRetry = vi.fn();
    await generateOnceWithRetry(async () => 'ok', onRetry);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
