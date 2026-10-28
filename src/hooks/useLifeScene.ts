/**
 * LIFE-SCENE-1: live subscription to the user's active scene.
 *
 * Returns `{ data, loading }`. `data === null` AND `loading === false`
 * means there is no active scene — which, since `LIFE-SCENE-24`, means one is
 * about to be generated rather than that the player is idle.
 *
 * Path: `users/{uid}/lifeWorlds/{worldId}/scenes/active` (singleton;
 * completed scenes are archived alongside it under generated ids).
 */
import { useDocSnapshot } from './firestore/useDocSnapshot';
import { ZLifeScene } from '@/types/firestore';

export function useLifeScene(uid: string | null, worldId: string | null) {
  return useDocSnapshot(
    ZLifeScene,
    uid && worldId ? `users/${uid}/lifeWorlds/${worldId}/scenes/active` : null,
    uid && worldId ? `life:scene:${uid}:${worldId}` : undefined,
  );
}
