/**
 * LIFE-NPC-2: read the player's avatar from its sidecar doc (kept OFF
 * the hot world doc — LIFE-DATA-1). Fetches ONCE per world, the moment
 * the world doc's `characterAvatarStatus` reads 'ready', then caches
 * module-level so subsequent world snapshots don't re-fetch the bytes.
 * A 'pending'/'failed' status (a fresh gen or a regenerate in flight)
 * clears the cache so the new avatar reloads once it lands.
 */
import { useEffect, useReducer, useState } from 'react';
import { readCharacterAvatar } from '@/lib/life/lifeAvatarAssets';
import type { LifeWorld } from '@/types/firestore';

type Status = LifeWorld['characterAvatarStatus'];

/**
 * LIFE-FAIL-9: how long a `pending` avatar may shimmer before the client
 * treats the gen as dead and falls back to the initials circle. A parts avatar
 * gens in ~2-5s and a direct draw ~8× that, so 45s is far beyond any live gen:
 * a fired timeout means the call died (a reload/navigation stranded the status
 * at 'pending'). If a slow gen DOES land later, the status flips to 'ready' and
 * the real avatar overrides the initials.
 */
export const PENDING_AVATAR_TIMEOUT_MS = 45_000;

/** worldId → data URI. Read once per world per session. */
const characterAvatarCache = new Map<string, string>();
/** worldId → in-flight read. Shares ONE getDoc across concurrent
 *  triggers for the same world so React StrictMode's dev double-invoke
 *  of the effect can't fire two reads (mirrors LIFE-BACKDROP-2's dedup). */
const inFlightReads = new Map<string, Promise<string | null>>();

export function useCharacterAvatar(
  uid: string | null,
  worldId: string | null,
  status: Status,
): { url: string | null; loading: boolean } {
  // The effect only kicks the async fetch; the visible url is DERIVED
  // from the module cache during render (so the synchronous "nothing to
  // show" cases don't setState in the effect). `bump` forces one
  // re-render when the async read lands + populates the cache.
  const [, bump] = useReducer((n: number) => n + 1, 0);
  // LIFE-FAIL-9: flips true once a 'pending' status outlives the timeout, so
  // the shimmer stops and the initials fallback shows even if the player takes
  // no further action. Reset whenever (worldId, status) changes.
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    // Only fetch when a 'ready' status guarantees a sidecar exists. A
    // 'pending'/'failed'/absent status means clear any stale cache so a
    // regenerate reloads, then show nothing (derived below).
    if (!uid || !worldId) return;
    if (status !== 'ready') {
      // Regen/pending/failed: drop any stale cache so the next 'ready'
      // re-fetches. The visible url is already null via derivation, and
      // the parent re-renders on this status change — no bump needed.
      characterAvatarCache.delete(worldId);
      return;
    }
    if (characterAvatarCache.has(worldId)) return;
    let cancelled = false;
    let read = inFlightReads.get(worldId);
    if (!read) {
      read = readCharacterAvatar(uid, worldId)
        .then((u) => {
          if (u) characterAvatarCache.set(worldId, u);
          inFlightReads.delete(worldId);
          return u;
        })
        .catch(() => {
          inFlightReads.delete(worldId);
          return null;
        });
      inFlightReads.set(worldId, read);
    }
    void read.then((u) => {
      if (!cancelled && u) bump();
    });
    return () => {
      cancelled = true;
    };
  }, [uid, worldId, status]);

  // LIFE-FAIL-9: client-side pending timeout. A 'pending' that outlives the
  // window is treated as a dead gen — `loading` drops to false so the shimmer
  // gives up to the initials circle. `setGaveUp(false)` runs synchronously to
  // reset the window on every (worldId, status) change (incl. a regenerate's
  // ready→pending), so the ESLint set-state-in-effect guard is relaxed here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setGaveUp(false);
    if (status !== 'pending') return;
    const t = setTimeout(() => setGaveUp(true), PENDING_AVATAR_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [worldId, status]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const url =
    status === 'ready' && worldId
      ? (characterAvatarCache.get(worldId) ?? null)
      : null;
  const loading = status === 'pending' && !gaveUp;
  return { url, loading };
}

/** Test seam — reset the module caches between unit tests. */
export function __resetCharacterAvatarCache(): void {
  characterAvatarCache.clear();
  inFlightReads.clear();
}
