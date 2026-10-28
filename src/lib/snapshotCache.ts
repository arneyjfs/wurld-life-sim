/**
 * Session-scoped in-memory snapshot cache. Lives between hook unmount
 * and remount so the first render after navigation can serve real data
 * synchronously instead of flashing a loading state while Firestore's
 * IndexedDB cache round-trips.
 *
 * Two stores:
 *
 *   • `collectionCache` — last-seen parsed array for a useCollectionSnapshot
 *     call, keyed by its `resetKey` (or `depKey` when no reset key was
 *     given). The cached value is typed `unknown[]` because keys span
 *     schemas; callers cast back at the read site.
 *
 *   • `docCache` — last-parsed doc value, keyed by the doc's full path
 *     (e.g. `users/abc123` or `chats/foo/messages/bar`). Used by
 *     useDocSnapshot.
 *
 * Both are write-through on every snapshot delivery in the hooks, and
 * can be pre-seeded by callers (e.g. CacheWarmer) to make the
 * first-ever visit to a chat instant.
 *
 * Plus a third, `derivedCache(name)`, for values computed FROM Firestore data
 * (BOOT-CACHE-2), and the one viewer-transition signal every in-memory layer
 * resets from (BOOT-CACHE-3). The full list of cache layers is in
 * docs/specs/cold-boot.md §1b.
 *
 * Intentionally NOT persisted — Firestore's IndexedDB cache is the
 * authoritative offline store. This is a tiny hot copy so React's
 * initial-render-from-state isn't a blank.
 */

// Collection cache is double-keyed: outer WeakMap by schema reference,
// inner Map by resetKey. Without the schema dimension, two collections
// that happen to share a resetKey (every per-user collection uses `uid`
// — chats, contacts, flashcards) would clobber each other, and the
// first consumer to read after the swap would parse the wrong shape
// (e.g. flashcards being handed to useChats, breaking `c.members`).
const collectionCache = new WeakMap<object, Map<string, unknown[]>>();
const docCache = new Map<string, unknown>();
// Tracked set of schemas we've ever written to, so tests can wipe all
// inner buckets even though WeakMap has no .clear(). Strong ref by
// design — schemas are module-level Zod objects, not GC candidates.
const trackedSchemas = new Set<object>();

function key(k: unknown): string {
  return k == null ? '' : String(k);
}

function bucketFor(schema: object): Map<string, unknown[]> {
  let m = collectionCache.get(schema);
  if (!m) {
    m = new Map();
    collectionCache.set(schema, m);
  }
  // Track on every call: a prior _clearSnapshotCacheForTest may have
  // emptied trackedSchemas while leaving the WeakMap entry in place,
  // so subsequent writes wouldn't be wipeable without re-tagging here.
  trackedSchemas.add(schema);
  return m;
}

export function readCollectionCache<T>(
  schema: object,
  resetKey: unknown,
): T[] | undefined {
  return bucketFor(schema).get(key(resetKey)) as T[] | undefined;
}

export function writeCollectionCache<T>(
  schema: object,
  resetKey: unknown,
  data: T[],
): void {
  bucketFor(schema).set(key(resetKey), data);
}

export function readDocCache<T>(path: string | null | undefined): T | undefined {
  if (!path) return undefined;
  return docCache.get(path) as T | undefined;
}

export function writeDocCache<T>(path: string | null | undefined, data: T): void {
  if (!path) return;
  docCache.set(path, data);
}

export function deleteDocCache(path: string | null | undefined): void {
  if (!path) return;
  docCache.delete(path);
}


// ---------------------------------------------------------------------------
// Live collections — BOOT-CACHE-5
// ---------------------------------------------------------------------------
// A cached collection is LIVE while a listener holds it AND that listener's
// latest emit came from the server. Only then is the array a current view of
// the query rather than a leftover from an unmounted screen — which is what
// lets the chat-list preview read the open chat's live tail instead of paying
// a `getDocs` for a message the listener already delivered.

const liveHolds = new WeakMap<object, Map<string, number>>();

function holdsFor(schema: object): Map<string, number> {
  let m = liveHolds.get(schema);
  if (!m) {
    m = new Map();
    liveHolds.set(schema, m);
  }
  return m;
}

/** Mark (schema, resetKey) live; returns an idempotent release. Ref-counted,
 *  so two listeners on the same key keep it live until both release. */
export function retainLiveCollection(schema: object, resetKey: unknown): () => void {
  const k = key(resetKey);
  const holds = holdsFor(schema);
  holds.set(k, (holds.get(k) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = (holds.get(k) ?? 1) - 1;
    if (n <= 0) holds.delete(k);
    else holds.set(k, n);
  };
}

/**
 * BOOT-CACHE-6 — the write for every source that is NOT the listener holding
 * the entry (a `getDocsFromCache` prime, a listener's stage-1 eager read).
 * Such a read is a snapshot of the device cache taken when it STARTED; while
 * a listener holds the entry live, that listener's array is at least as new,
 * so the late write is dropped. Returns whether it landed.
 */
export function writeCollectionCacheUnlessLive<T>(
  schema: object,
  resetKey: unknown,
  data: T[],
): boolean {
  if (liveHolds.get(schema)?.get(key(resetKey))) return false;
  writeCollectionCache(schema, resetKey, data);
  return true;
}

/** The cached collection, but ONLY while it is live (BOOT-CACHE-5). */
export function readLiveCollection<T>(schema: object, resetKey: unknown): T[] | undefined {
  if (!liveHolds.get(schema)?.get(key(resetKey))) return undefined;
  return readCollectionCache<T>(schema, resetKey);
}

// ---------------------------------------------------------------------------
// Derived caches — BOOT-CACHE-2 (docs/specs/cold-boot.md §1b)
// ---------------------------------------------------------------------------
// Per-view values COMPUTED from Firestore data (today: the chat-list preview
// text, `useLastMessagePreview`). Neither a parsed doc nor a parsed collection,
// so they get their own keyed store — but they live HERE, under the same
// lifecycle as the two stores above, not in a private module with its own
// auth listener.

export type DerivedCache<V> = {
  get(key: string): V | undefined;
  has(key: string): boolean;
  /** Insert or refresh (moves the key to newest); evicts the oldest past `max`. */
  set(key: string, value: V): void;
  /** Entries, oldest first. */
  entries(): Array<[string, V]>;
  size(): number;
  clear(): void;
};

const derivedCaches = new Map<string, DerivedCache<unknown>>();

/** The named derived cache (created on first use). LRU by write order,
 *  capped at `max`. The same name always returns the same store. */
export function derivedCache<V>(name: string, max: number): DerivedCache<V> {
  const existing = derivedCaches.get(name);
  if (existing) return existing as DerivedCache<V>;
  const map = new Map<string, V>();
  const cache: DerivedCache<V> = {
    get: (k) => map.get(k),
    has: (k) => map.has(k),
    set: (k, v) => {
      if (map.has(k)) map.delete(k);
      map.set(k, v);
      while (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
    entries: () => [...map.entries()],
    size: () => map.size,
    clear: () => map.clear(),
  };
  derivedCaches.set(name, cache as DerivedCache<unknown>);
  return cache;
}

// ---------------------------------------------------------------------------
// Viewer transitions — BOOT-CACHE-3
// ---------------------------------------------------------------------------
// ONE signal for "the signed-in user changed", driven by `authStore`'s single
// `onAuthStateChanged`. The preview cache used to register a listener of its
// own; every in-memory layer now resets from here.

type ViewerListener = (prevUid: string | null, nextUid: string | null) => void;
const viewerListeners = new Set<ViewerListener>();
let currentViewer: string | null = null;

/** Subscribe to viewer transitions. Returns an unsubscribe. */
export function onViewerChange(listener: ViewerListener): () => void {
  viewerListeners.add(listener);
  return () => {
    viewerListeners.delete(listener);
  };
}

/**
 * Called by `authStore` on every auth emission; a no-op unless the uid moved.
 *
 * Leaving a signed-in user (sign-out, or a switch to another account) wipes
 * the doc, collection and derived caches before any listener runs: nothing
 * user A's session parsed may paint for user B. A cold boot (null -> restored
 * uid) wipes nothing — what stage 1 painted before auth resolved IS this
 * user's — and listeners decide what to re-hydrate.
 */
export function notifyViewerChange(nextUid: string | null): void {
  const prev = currentViewer;
  if (prev === nextUid) return;
  currentViewer = nextUid;
  if (prev !== null) {
    docCache.clear();
    for (const s of trackedSchemas) collectionCache.get(s)?.clear();
    for (const c of derivedCaches.values()) c.clear();
  }
  for (const l of [...viewerListeners]) l(prev, nextUid);
}

/** Test-only: drop every store (and forget the viewer) so module-scope state
 *  doesn't bleed between cases. Not used in app code. */
export function _clearSnapshotCacheForTest(): void {
  docCache.clear();
  for (const s of trackedSchemas) collectionCache.get(s)?.clear();
  trackedSchemas.clear();
  for (const c of derivedCaches.values()) c.clear();
  currentViewer = null;
}
