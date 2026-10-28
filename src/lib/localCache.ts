/**
 * Tiny localStorage-backed cache of Firestore snapshot results so the
 * UI can paint instantly on cold-boot, before the Firestore SDK has
 * finished its lazy init (which on EDGE blocks for 60-70 seconds
 * waiting for the watch stream to time out).
 *
 * Scope: bounded collections only (chats, contacts) plus the user doc.
 * Each cached entry is the raw `doc.data()` plus the doc id, stored
 * as JSON. Firestore Timestamps round-trip through JSON because
 * `Timestamp.toJSON()` produces `{ seconds, nanoseconds }` and our
 * `ZTimestamp` schema's preprocess step accepts that shape.
 *
 * Quota defence: every setItem is wrapped in try/catch. On
 * QuotaExceededError we purge *our* keys first (other wurld.* state
 * is preserved) and retry once. Failing twice means the device is
 * actually full — silently drop the write; the UI continues to work,
 * just without the fast-paint optimisation on next boot.
 *
 * NOT for messages — chat history can run to MB-per-chat and would
 * blow the 5 MB localStorage budget. Messages stay on Firestore's
 * own IndexedDB cache (effectively unbounded).
 */

import { BOOT_CACHE_KEY } from './bootCache';

const VERSION = 1;
const KEY_PREFIX = `wurld.snap.v${VERSION}.`;

type CacheEntry = {
  v: number;
  docs: Array<{ id: string; data: unknown }>;
};

function keyFor(cacheKey: string): string {
  return `${KEY_PREFIX}${cacheKey}`;
}

export function readSnapshotCache(
  cacheKey: string,
): Array<{ id: string; data: unknown }> | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(keyFor(cacheKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CacheEntry>;
    if (parsed?.v !== VERSION || !Array.isArray(parsed.docs)) return null;
    return parsed.docs;
  } catch {
    return null;
  }
}

export function writeSnapshotCache(
  cacheKey: string,
  docs: Array<{ id: string; data: unknown }>,
): void {
  if (typeof localStorage === 'undefined') return;
  const entry: CacheEntry = { v: VERSION, docs };
  const payload = JSON.stringify(entry);
  try {
    // BOOT-HYDRATION-12 — once per doc VERSION, not per emit. Metadata-only
    // emits and a second consumer of the same snapshot hand us an identical
    // payload; `setItem` is synchronous main-thread I/O, so skip it. Compared
    // against the stored value itself (not an in-memory "last written" map)
    // so an external clear is never mistaken for "already written".
    if (localStorage.getItem(keyFor(cacheKey)) === payload) return;
    localStorage.setItem(keyFor(cacheKey), payload);
    return;
  } catch (err) {
    // QuotaExceededError or storage disabled.
    if (!isQuotaError(err)) return;
  }
  // Retry once after purging all our own keys.
  try {
    purgeAllSnapshotCaches();
    localStorage.setItem(keyFor(cacheKey), payload);
  } catch {
    /* device is genuinely full — silently drop */
  }
}

export function clearSnapshotCache(cacheKey: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(keyFor(cacheKey));
  } catch {
    /* ignore */
  }
}

export function purgeAllSnapshotCaches(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(KEY_PREFIX)) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/**
 * BOOT-CACHE-4 — drop superseded versions of the keys this module and
 * `bootCache` own: any `wurld.boot.v<N>` other than the live one, and any
 * `wurld.snap.v<N>.*` outside the live prefix, and every `wurld.sync.*` key
 * (the retired message-sync watermarks). Called once at boot. Keys under
 * any other name are never touched.
 */
export function purgeStaleStorageKeys(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (/^wurld\.boot\.v\d+$/.test(k) && k !== BOOT_CACHE_KEY) toRemove.push(k);
      else if (/^wurld\.snap\.v\d+\./.test(k) && !k.startsWith(KEY_PREFIX)) toRemove.push(k);
      // The retired CacheWarmer watermark store (BOOT-HYDRATION-10).
      else if (k.startsWith('wurld.sync.')) toRemove.push(k);
    }
    for (const k of toRemove) localStorage.removeItem(k);
  } catch {
    /* storage blocked — nothing to reclaim */
  }
}

function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: unknown }).name;
  // Different browsers / runtimes spell it differently.
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    (err as { code?: number }).code === 22 ||
    (err as { code?: number }).code === 1014
  );
}
