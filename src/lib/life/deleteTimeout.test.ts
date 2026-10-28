import { describe, expect, it } from 'vitest';
import { settleWithTimeout } from './deleteTimeout';

/**
 * LIFE-WORLD-11 — the delete UI can never be left waiting on a promise that
 * does not settle.
 *
 * `batch.commit()` resolves only on SERVER ack, so on a degraded connection it
 * pends indefinitely — and a `finally` is only as reliable as the promise it is
 * attached to. That is what left the card faded until an app restart.
 */
describe('LIFE-WORLD-11 — settleWithTimeout', () => {
  it('LIFE-WORLD-11 — resolves ok when the work succeeds', async () => {
    expect(await settleWithTimeout(Promise.resolve('done'), 50)).toBe('ok');
  });

  it('LIFE-WORLD-11 — reports failure WITHOUT rethrowing', async () => {
    // The caller decides what the user sees; an escaping rejection would take
    // the handler's own cleanup with it.
    expect(await settleWithTimeout(Promise.reject(new Error('nope')), 50)).toBe('failed');
  });

  it('LIFE-WORLD-11 — gives up on a promise that never settles', async () => {
    // The exact shape of the bug: not a rejection, just silence.
    expect(await settleWithTimeout(new Promise(() => {}), 20)).toBe('timeout');
  });

  it('LIFE-WORLD-11 — a LATE rejection after a timeout does not go unhandled', async () => {
    let reject!: (e: Error) => void;
    const never = new Promise((_, r) => { reject = r; });
    expect(await settleWithTimeout(never, 10)).toBe('timeout');
    // Rejecting after we stopped waiting must be absorbed — there is no UI left
    // to attach it to, and an unhandled rejection here would be reported as a
    // crash.
    reject(new Error('late'));
    await new Promise((r) => setTimeout(r, 20));
  });
});
