/**
 * LIFE-FLOW-5 (wurlds-v2 Phase C): fire the fire-and-forget
 * resume-recap generator when the player EXITS a world (LifeScreen
 * unmount or worldId change — back-nav, exit-to-overview, any route
 * change). Extracted from LifeScreen.tsx to respect the 600-LOC cap.
 *
 * A ref snapshots the latest {uid, world, events} on every render
 * commit; the unmount cleanup reads the snapshot and fires
 * runResumeRecapGenerate, which self-gates on ≥5 new events since
 * the last recap and tolerates every failure (LIFE-FLOW-5).
 *
 * StrictMode note (dev-only double-mount): the synthetic first
 * cleanup runs right after mount. On a cold cache the snapshot is
 * still null (listeners haven't delivered) and nothing fires. With
 * a WARM in-memory snapshot cache (lib/snapshotCache.ts —
 * session-scoped, not persisted; useLifeWorld / useLifeEvents seed
 * synchronously from it on same-session re-entry, never across a
 * reload) it CAN fire once on entry — tolerated by design:
 * the call self-gates on ≥5 new events, and an entry-time recap
 * describes the end of the PREVIOUS session, which is exactly the
 * content the resume screen wants. Production builds double-mount
 * nothing.
 *
 * World-delete note: deleting the world also unmounts the screen;
 * the generator's updateLifeWorld then rejects on the missing doc
 * and the error is swallowed by design (fire-and-forget).
 */
import { useEffect, useRef } from 'react';
import { runResumeRecapGenerate } from '@/lib/life/runResumeRecapGenerate';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

export function useResumeRecapOnExit(opts: {
  uid: string | null;
  world: LifeWorld | null;
  events: LifeEvent[];
  worldId: string | null;
}): void {
  const snapRef = useRef<{
    uid: string;
    world: LifeWorld;
    events: LifeEvent[];
  } | null>(null);
  useEffect(() => {
    snapRef.current =
      opts.uid && opts.world
        ? { uid: opts.uid, world: opts.world, events: opts.events }
        : null;
  }, [opts.uid, opts.world, opts.events]);
  useEffect(() => {
    const exitedWorldId = opts.worldId;
    return () => {
      const snap = snapRef.current;
      // The snapshot must belong to the world being exited — guards
      // the (currently impossible) direct world→world navigation.
      if (!snap || snap.world.id !== exitedWorldId) return;
      snapRef.current = null;
      void runResumeRecapGenerate(snap).catch(() => undefined);
    };
  }, [opts.worldId]);
}
