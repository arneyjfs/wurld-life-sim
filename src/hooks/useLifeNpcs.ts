/**
 * LIFE-DATA-3: live subscription to the persistent NPC roster.
 *
 * Returns a Map<npcId, LifeNpc> keyed by id so the dialogue UI
 * can resolve an NPC's avatar by the npcId slug on a beat without
 * iterating an array each render.
 */
import { useMemo } from 'react';
import { collection } from 'firebase/firestore';
import { useCollectionSnapshot } from './firestore/useCollectionSnapshot';
import { db } from '@/lib/firebase';
import { ZLifeNpc, type LifeNpc } from '@/types/firestore';

export function useLifeNpcs(
  uid: string | null,
  worldId: string | null,
): {
  npcs: ReadonlyMap<string, LifeNpc>;
  loading: boolean;
} {
  const q = useMemo(() => {
    if (!uid || !worldId) return null;
    return collection(db, 'users', uid, 'lifeWorlds', worldId, 'npcs');
  }, [uid, worldId]);
  const result = useCollectionSnapshot(
    ZLifeNpc,
    q,
    uid && worldId ? `life:npcs:${uid}:${worldId}` : null,
  );
  const npcs = useMemo(() => {
    const m = new Map<string, LifeNpc>();
    for (const n of result.data) m.set(n.id, n);
    return m;
  }, [result.data]);
  return { npcs, loading: result.loading };
}
