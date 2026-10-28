/**
 * LIFE-EVENT-1: live subscription to the user's appended event log,
 * ordered oldest → newest by createdAt. The most recent N events
 * form the LLM's "chat history" view (LIFE-CTX-1/2).
 */
import { useMemo } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { useCollectionSnapshot } from './firestore/useCollectionSnapshot';
import { db } from '@/lib/firebase';
import { ZLifeEvent } from '@/types/firestore';

const DEFAULT_LIMIT = 40;

export function useLifeEvents(
  uid: string | null,
  worldId: string | null,
  take: number = DEFAULT_LIMIT,
) {
  const q = useMemo(() => {
    if (!uid || !worldId) return null;
    return query(
      collection(db, 'users', uid, 'lifeWorlds', worldId, 'events'),
      orderBy('createdAt', 'desc'),
      limit(take),
    );
  }, [uid, worldId, take]);
  const result = useCollectionSnapshot(
    ZLifeEvent,
    q,
    uid && worldId ? `life:events:${uid}:${worldId}:${take}` : null,
  );
  // The query is desc-by-createdAt because Firestore needs that
  // direction for the `limit` to pick the NEWEST N. We flip back
  // to chronological order before exposing — that's the order the
  // LLM context assembler wants (LIFE-CTX-2).
  const ordered = useMemo(
    () => [...result.data].reverse(),
    [result.data],
  );
  return { ...result, data: ordered };
}
