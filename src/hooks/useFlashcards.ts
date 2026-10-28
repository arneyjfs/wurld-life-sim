import { collection, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useCollectionSnapshot } from './firestore/useCollectionSnapshot';
import { ZFlashCard } from '@/types/firestore';

export function useFlashcards(uid: string | null) {
  const q = uid
    ? query(collection(db, 'users', uid, 'flashcards'), orderBy('createdAt', 'desc'))
    : null;
  return useCollectionSnapshot(ZFlashCard, q, uid);
}
