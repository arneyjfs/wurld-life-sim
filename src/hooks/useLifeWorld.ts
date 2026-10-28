/**
 * LIFE-DATA-1 / LIFE-WORLD-*: live subscription to a single world.
 *
 * Returns `{ data, loading }`. `data === null` AND `loading === false`
 * means the requested worldId doesn't exist — caller routes to the
 * overview (LIFE-WORLD-3).
 *
 * Path: `users/{uid}/lifeWorlds/{worldId}` (multi-world; the legacy
 * `lifeWorld/main` singleton path is no longer read here).
 */
import { useDocSnapshot } from './firestore/useDocSnapshot';
import { ZLifeWorld } from '@/types/firestore';

export function useLifeWorld(uid: string | null, worldId: string | null) {
  return useDocSnapshot(
    ZLifeWorld,
    uid && worldId ? `users/${uid}/lifeWorlds/${worldId}` : null,
    uid && worldId ? `life:world:${uid}:${worldId}` : undefined,
  );
}
