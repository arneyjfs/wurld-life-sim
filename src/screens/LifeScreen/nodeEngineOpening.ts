/**
 * LIFE-BACKDROP-21 — start the opening turn while the intro card is up.
 *
 * The first scene used to be generated from `fallbackDescriptor` (a seed
 * GUESS — `apartment_bedroom` plus a vibe off the world seed) and then thrown
 * away the moment the opening beat's real `backdropIntent` arrived. Owner,
 * 2026-08-01, reading the call log: *"clearly the first actual intent was
 * office. The scene that renders behind the introduction card is immediately
 * discarded. Maybe the first step needs to be run before the first scene gen."*
 *
 * The fix is ORDERING, not caching. Run the step first, and let its intent
 * drive the only gen there is.
 *
 * The promise is stored, not awaited. Two things consume it:
 *   1. this function, which publishes `backdropIntent` AS SOON AS IT RESOLVES —
 *      without arriving at the node, so the scene starts rendering behind the
 *      intro card while nothing else about the turn has happened yet;
 *   2. `startOpening`, which hands the same promise to `runLiveTurn`, so Begin
 *      arrives from cache rather than paying for the call a second time.
 *
 * Split from `nodeEngineActions` for the 600-line cap, following the
 * `nodeEngineCardMatch` / `nodeEngineResolution` precedent.
 */
import { generateStepOptions } from '@/lib/life/generateStepOptions';
import type { EngineDeps } from './nodeEngineTypes';
import type { LifeEvent } from '@/types/firestore';

export function createOpeningPrefetch(opts: {
  deps: EngineDeps;
  currentEvents: () => LifeEvent[];
}): () => void {
  const { propsRef, nonceRef, openingPrefetchRef } = opts.deps;

  return function prefetchOpening(): void {
    const p = propsRef.current;
    // Idempotent: the effect that calls this re-runs on unrelated world-doc
    // changes, and a second opening turn would be a second billed call whose
    // node is then discarded.
    if (!p.uid || !p.world || openingPrefetchRef.current) return;
    const pending = generateStepOptions({
      uid: p.uid,
      world: p.world,
      events: opts.currentEvents(),
      scene: p.scene,
      npcs: p.npcs,
      turn: { kind: 'live', choice: null, freeText: null, practiceOutcome: null },
      nonce: nonceRef.current,
    });
    openingPrefetchRef.current = pending;
    void pending
      .then((result) => {
        const intent = result.kind === 'ok' ? result.node?.backdropIntent : null;
        if (intent) propsRef.current.onBackdropIntent(intent);
      })
      // Swallowed on purpose: this is speculative work, and `startOpening`
      // re-enters `runLiveTurn` with the SAME promise — that path owns the
      // real error handling (`options-failed`, the Continue ladder). Logging
      // here would report one failure twice.
      .catch(() => undefined);
  };
}
