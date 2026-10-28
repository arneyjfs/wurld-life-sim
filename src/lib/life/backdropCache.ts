/**
 * LIFE-BACKDROP-2: localStorage-backed backdrop cache for Phase A.2.
 *
 * The spec calls for a Firestore + Storage cache keyed by
 * `{worldId}::{descriptor}`. Without a `lifeWorld` doc yet, we
 * keep the same key shape but back the cache with localStorage.
 * Phase B replaces the storage layer without changing the key
 * format — every cached entry from Phase A.2 keeps working when
 * the Firestore mirror lands.
 *
 * Cache budget: localStorage caps around 5–10 MB depending on
 * browser; a generated SVG is typically 4–20 KB, so we comfortably
 * fit hundreds. A simple LRU eviction trim keeps the budget honest.
 */
import { descriptorCacheKey, type BackdropDescriptor } from './backdropDescriptor';

const CACHE_PREFIX = 'life:backdrop:';
const INDEX_KEY = 'life:backdrop:__index';
const MAX_ENTRIES = 64;

type IndexEntry = { key: string; lastUsed: number };

function readIndex(): IndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is IndexEntry =>
        typeof e === 'object' &&
        e !== null &&
        typeof e.key === 'string' &&
        typeof e.lastUsed === 'number',
    );
  } catch {
    return [];
  }
}

function writeIndex(index: IndexEntry[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Quota errors are harmless — we'll re-build next time.
  }
}

function touchIndex(key: string, now: number): void {
  const index = readIndex().filter((e) => e.key !== key);
  index.push({ key, lastUsed: now });
  // LRU trim — evict oldest if we're over budget.
  if (index.length > MAX_ENTRIES) {
    index.sort((a, b) => a.lastUsed - b.lastUsed);
    const evicted = index.splice(0, index.length - MAX_ENTRIES);
    for (const e of evicted) {
      try {
        localStorage.removeItem(CACHE_PREFIX + e.key);
      } catch {
        /* ignore */
      }
    }
  }
  writeIndex(index);
}

/** Compose the full cache key. `worldId` is optional during Phase A.2
 *  — Phase B always supplies it. */
export function fullCacheKey(
  d: BackdropDescriptor,
  worldId: string | null,
): string {
  const prefix = worldId ?? '__no_world__';
  return `${prefix}::${descriptorCacheKey(d)}`;
}

export function readBackdropCache(
  d: BackdropDescriptor,
  worldId: string | null,
): string | null {
  try {
    const key = fullCacheKey(d, worldId);
    const svg = localStorage.getItem(CACHE_PREFIX + key);
    if (svg) touchIndex(key, Date.now());
    return svg;
  } catch {
    return null;
  }
}

export function writeBackdropCache(
  d: BackdropDescriptor,
  worldId: string | null,
  svg: string,
): void {
  // LIFE-BACKDROP-3: cache transient backdrops too — resume in the middle of
  // one must hit cache, not re-burn a Gemini call.
  //
  // ONLY EVER WRITE GENERATOR OUTPUT HERE. LIFE-BACKDROP-15 classifies an SVG
  // as "not a real backdrop" by exact match against the bundled fallback
  // silhouettes; caching a silhouette would make `BackdropStage` refuse to
  // paint it and hold the previous backdrop indefinitely.
  try {
    const key = fullCacheKey(d, worldId);
    localStorage.setItem(CACHE_PREFIX + key, svg);
    touchIndex(key, Date.now());
  } catch {
    // Quota exceeded; eviction will try to fix this next call.
  }
}

/** Clears the entire cache. Useful for the "restart life" flow. */
export function clearBackdropCache(worldId: string | null): void {
  const prefix = worldId ?? '__no_world__';
  const index = readIndex();
  const survivors = index.filter((e) => {
    if (e.key.startsWith(`${prefix}::`)) {
      try {
        localStorage.removeItem(CACHE_PREFIX + e.key);
      } catch {
        /* ignore */
      }
      return false;
    }
    return true;
  });
  writeIndex(survivors);
}

/** Wipe EVERY backdrop-cache entry regardless of worldId. Used by the
 *  delete-and-restart flow so old SVGs can't bleed into the next
 *  world via localStorage. */
export function clearAllBackdropCaches(): void {
  const index = readIndex();
  for (const e of index) {
    try {
      localStorage.removeItem(CACHE_PREFIX + e.key);
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.removeItem(INDEX_KEY);
  } catch {
    /* ignore */
  }
}
