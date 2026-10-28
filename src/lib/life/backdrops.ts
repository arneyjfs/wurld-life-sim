/**
 * LIFE-DATA-4 / LIFE-BACKDROP-2: persistent backdrop rows in Firestore.
 *
 * Phase A.2 cached backdrop SVGs in localStorage. That kept the
 * implementation simple but a player who switched devices, cleared
 * storage, or installed the PWA fresh would lose every location's
 * visual identity. Persistent backdrops now ALSO live in Firestore at
 * users/{uid}/lifeWorlds/{worldId}/backdrops/{backdropId}, keyed by the
 * descriptor cache key. The SVG bytes live in the row itself for v1 (no
 * Storage upload round-trip) — a follow-up can move large SVGs to Storage
 * when the doc-size budget gets tight.
 *
 * Reads still check localStorage first (fast path), Firestore
 * second (cross-device fallback), and only kick off a new Gemini
 * render on a true miss.
 */
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { descriptorCacheKey, type BackdropDescriptor } from './backdropDescriptor';

const COLLECTION = 'backdrops';

/** Firestore-safe doc id for a descriptor key. The key already
 *  uses only [a-z0-9_:] but Firestore disallows `/` in doc ids;
 *  swap `::` for a safe separator. */
function backdropDocId(key: string): string {
  return key.replace(/::/g, '__');
}

function backdropDoc(uid: string, worldId: string, key: string) {
  return doc(db, 'users', uid, 'lifeWorlds', worldId, COLLECTION, backdropDocId(key));
}

export async function readPersistentBackdrop(
  uid: string,
  worldId: string,
  d: BackdropDescriptor,
): Promise<string | null> {
  // LIFE-BACKDROP-3: serve cached transient backdrops too — resume must hit
  // cache regardless of the original persistence hint.
  const key = descriptorCacheKey(d);
  const ref = backdropDoc(uid, worldId, key);
  try {
    const snap = await getDoc(ref);
    const svg = svgOf(snap.exists() ? snap.data() : null);
    if (svg) {
      // Best-effort: touch lastVisitedAt so the user's "favourite
      // places" surface (future) can sort by recency.
      void updateDoc(ref, { lastVisitedAt: serverTimestamp() }).catch(
        () => undefined,
      );
      return svg;
    }
    return null;
  } catch {
    return null;
  }
}

function svgOf(data: unknown): string | null {
  const svg = (data as { svgInline?: unknown } | null)?.svgInline;
  return typeof svg === 'string' && svg.length > 0 ? svg : null;
}

export async function writePersistentBackdrop(
  uid: string,
  worldId: string,
  d: BackdropDescriptor,
  svg: string,
  locationLabel?: string,
): Promise<void> {
  // LIFE-BACKDROP-3: write transient backdrops to Firestore too — resume on a
  // different device should hit the cache, not regenerate.
  const key = descriptorCacheKey(d);
  const ref = backdropDoc(uid, worldId, key);
  try {
    await setDoc(ref, {
      id: backdropDocId(key),
      descriptor: key,
      svgInline: svg,
      ...(locationLabel ? { locationLabel } : {}),
      createdAt: serverTimestamp(),
      lastVisitedAt: serverTimestamp(),
    });
  } catch {
    // Failure to persist is non-fatal — the localStorage cache
    // still keeps the SVG for the local session.
  }
}

/** Reference for snapshot listeners on the index of all the
 *  player's persistent backdrops (powers the future
 *  "places you've been" view). */
export function backdropsCollection(uid: string, worldId: string) {
  return collection(db, 'users', uid, 'lifeWorlds', worldId, COLLECTION);
}
