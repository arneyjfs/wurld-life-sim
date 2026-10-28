/**
 * LIFE-WORLD-*: live subscription to ALL worlds the user owns.
 * Drives the LifeOverviewScreen world-list.
 */
import { useMemo } from 'react';
import { collection, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCollectionSnapshot } from './firestore/useCollectionSnapshot';
import { ZLifeWorld } from '@/types/firestore';

export function useLifeWorlds(uid: string | null) {
  const q = useMemo(() => {
    if (!uid) return null;
    return query(
      collection(db, 'users', uid, 'lifeWorlds'),
      orderBy('updatedAt', 'desc'),
    );
  }, [uid]);
  return useCollectionSnapshot(
    ZLifeWorld,
    q,
    uid ? `life:worlds:${uid}` : null,
  );
}
