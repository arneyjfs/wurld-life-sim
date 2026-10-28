/**
 * LIFE-WORLD-11 — a delete can WAIT, but it can never hang.
 *
 * Reported 2026-07-31: deleting the last wurld left its card faded and stuck
 * until an app restart. The handler already had a `finally` clearing the state
 * and a toast on error — so it was neither. The promise never SETTLED.
 *
 * `deleteLifeWorld` ends in `batch.commit()`, and Firestore resolves that only
 * once the write reaches the SERVER. The local write applies immediately (so
 * the data really is gone as far as this device is concerned), but on a
 * degraded connection the await can pend indefinitely. A UI state cleared in a
 * `finally` is only as reliable as the promise it is attached to.
 *
 * So the wait is bounded. On timeout the delete is NOT cancelled — it stays
 * queued in Firestore's offline layer and completes when the connection
 * recovers — the UI simply stops pretending it is still happening.
 */
export const DELETE_TIMEOUT_MS = 10_000;

export type SettleOutcome = 'ok' | 'failed' | 'timeout';

/**
 * Await `work`, but give up waiting after `timeoutMs`.
 *
 * Deliberately NOT `Promise.race` alone: the rejection has to be swallowed
 * whichever way it settles, or a late failure after a timeout surfaces as an
 * unhandled rejection with no UI left to attach it to.
 */
export async function settleWithTimeout(
  work: Promise<unknown>,
  timeoutMs: number = DELETE_TIMEOUT_MS,
): Promise<SettleOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<SettleOutcome>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const settled = work.then(
    () => 'ok' as const,
    () => 'failed' as const,
  );
  try {
    return await Promise.race([settled, guard]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
