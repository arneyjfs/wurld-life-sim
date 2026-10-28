/**
 * LIFE-NPC-2 / LIFE-DATA-1: resolve npcId → avatar URL for the roster,
 * reading each NPC's avatar from its `assets/npc-{id}` sidecar (kept OFF
 * the roster-listened npc doc). Each ready NPC's bytes are fetched ONCE
 * (getDoc), cached module-level + deduped in-flight (StrictMode-safe,
 * mirroring `useCharacterAvatar` / LIFE-BACKDROP-2), so a `lastSeenAt` /
 * memory write on an npc doc no longer re-streams its avatar bytes.
 */
import { useEffect, useMemo, useReducer, useState } from 'react';
import { readNpcAvatar } from '@/lib/life/lifeAvatarAssets';
import { PENDING_AVATAR_TIMEOUT_MS } from './useCharacterAvatar';
import type { LifeNpc } from '@/types/firestore';

/** `${worldId}:${npcId}` → data URI. Read once per NPC per session. */
const npcAvatarCache = new Map<string, string>();
const npcInFlightReads = new Map<string, Promise<string | null>>();

const cacheKey = (worldId: string, npcId: string) => `${worldId}:${npcId}`;

export function useNpcAvatars(
  uid: string | null,
  worldId: string | null,
  npcs: ReadonlyMap<string, LifeNpc>,
): ReadonlyMap<string, string> {
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  // Stable signature of the READY npc ids so the fetch effect re-runs
  // only when that set changes — not on every lastSeenAt / memory write.
  const readySig = useMemo(() => {
    const ids: string[] = [];
    npcs.forEach((n, id) => {
      if (n.avatarStatus === 'ready') ids.push(id);
    });
    return ids.sort().join(',');
  }, [npcs]);

  useEffect(() => {
    if (!uid || !worldId || !readySig) return;
    let cancelled = false;
    for (const npcId of readySig.split(',')) {
      const k = cacheKey(worldId, npcId);
      if (npcAvatarCache.has(k)) continue;
      let read = npcInFlightReads.get(k);
      if (!read) {
        read = readNpcAvatar(uid, worldId, npcId)
          .then((u) => {
            if (u) npcAvatarCache.set(k, u);
            npcInFlightReads.delete(k);
            return u;
          })
          .catch(() => {
            npcInFlightReads.delete(k);
            return null;
          });
        npcInFlightReads.set(k, read);
      }
      void read.then((u) => {
        if (!cancelled && u) bump();
      });
    }
    return () => {
      cancelled = true;
    };
  }, [uid, worldId, readySig]);

  // Derive npcId → url from the cache for currently-ready NPCs. `version`
  // re-derives when a fetch lands; `npcs` when the roster changes.
  return useMemo(() => {
    // `version` is a real dependency: a landed async fetch mutates the
    // module cache (invisible to React) and bumps it to force this
    // re-derivation. Referenced so the exhaustive-deps rule is satisfied.
    void version;
    const m = new Map<string, string>();
    if (worldId) {
      npcs.forEach((n, id) => {
        if (n.avatarStatus !== 'ready') return;
        const u = npcAvatarCache.get(cacheKey(worldId, id));
        if (u) m.set(id, u);
      });
    }
    return m;
  }, [worldId, npcs, version]);
}

const EMPTY_PENDING: ReadonlySet<string> = new Set();

/**
 * LIFE-FAIL-9 / LIFE-NPC-2: npcIds whose avatar is 'pending' AND still inside
 * the client-side gen-timeout window — the set that drives the roster's
 * "loading" shimmer. A pending row that outlives `PENDING_AVATAR_TIMEOUT_MS`
 * is treated as given-up (its gen died mid-flight and no status write ever
 * landed) and drops out, so the slot stops shimmering and shows the initials
 * circle — the graceful terminal fallback — rather than shimmering forever.
 * The next node arrival's `commitNode` roster sweep re-kicks a still-'pending'
 * NPC (LIFE-NPC-6); if a slow gen lands, the status flips to 'ready' and the
 * real avatar overrides the initials.
 */
export function useNpcAvatarPending(
  npcs: ReadonlyMap<string, LifeNpc>,
): ReadonlySet<string> {
  const [gaveUp, setGaveUp] = useState<ReadonlySet<string>>(EMPTY_PENDING);

  // Stable signature of the currently-'pending' ids so the timer effect
  // re-arms only when that set actually changes.
  const pendingSig = useMemo(() => {
    const ids: string[] = [];
    npcs.forEach((n, id) => {
      if (n.avatarStatus === 'pending') ids.push(id);
    });
    return ids.sort().join(',');
  }, [npcs]);

  // `setGaveUp(EMPTY_PENDING)` runs synchronously to open a fresh window
  // whenever the pending set changes (incl. a regenerate's ready→pending), so
  // the ESLint set-state-in-effect guard is relaxed here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setGaveUp(EMPTY_PENDING);
    const ids = pendingSig ? pendingSig.split(',') : [];
    if (ids.length === 0) return;
    const timers = ids.map((id) =>
      setTimeout(() => {
        setGaveUp((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      }, PENDING_AVATAR_TIMEOUT_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [pendingSig]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return useMemo(() => {
    const s = new Set<string>();
    npcs.forEach((n, id) => {
      if (n.avatarStatus === 'pending' && !gaveUp.has(id)) s.add(id);
    });
    return s;
  }, [npcs, gaveUp]);
}

/** Test seam — reset the module caches between unit tests. */
export function __resetNpcAvatarCache(): void {
  npcAvatarCache.clear();
  npcInFlightReads.clear();
}
