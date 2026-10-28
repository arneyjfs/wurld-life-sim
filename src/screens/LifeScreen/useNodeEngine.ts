/**
 * LIFE-NODE-*: the client-side node/lookahead turn engine — the
 * React hook. All machine logic lives in nodeEngineActions.ts;
 * shared types + constants in nodeEngineTypes.ts (see that file's
 * header for the layout).
 *
 * Import rule: LifeScreen (and any code that RUNS the engine)
 * imports from here. Pure-UI code (LifeScreenBottom) imports
 * types/constants from ./nodeEngineTypes instead — this module's
 * import chain reaches lib/gemini → lib/firebase, which must not
 * load in jsdom component tests.
 *
 * Spec: docs/specs/life-sim.md §10.46.
 */
import { useEffect, useRef, useState } from 'react';
import type { GenerateStepOptionsResult } from '@/lib/life/generateStepOptions';
import { pruneDelivered } from '@/lib/life/mergeLocalEvents';
import type { GradedPlan, QuestionResolution } from '@/lib/life/stepSchema';
import type { LifeEvent } from '@/types/firestore';
import { createEngineActions } from './nodeEngineActions';
import { cancelPendingTurnArrivals } from './nodeEngineBeats';
import {
  INITIAL_ENGINE_STATE,
  type NodeEngineActions,
  type NodeEngineState,
  type UseNodeEngineProps,
} from './nodeEngineTypes';

// Re-exported for engine consumers (LifeScreen, useNodeEngine.test).
export {
  CONTINUE_AFTER_FAILURE_ID,
  type FeedbackState,
  type NodeEngineActions,
  type NodeEngineState,
  type TurnPhase,
  type UseNodeEngineProps,
} from './nodeEngineTypes';

export function useNodeEngine(
  props: UseNodeEngineProps,
): NodeEngineState & { actions: NodeEngineActions } {
  const [state, setState] = useState<NodeEngineState>(INITIAL_ENGINE_STATE);
  const propsRef = useRef(props);
  const machineRef = useRef<NodeEngineState>(INITIAL_ENGINE_STATE);
  const localEventsRef = useRef<LifeEvent[]>([]);
  const nonceRef = useRef(0);
  const prefetchRef = useRef<Promise<GenerateStepOptionsResult> | null>(null);
  // LIFE-BACKDROP-21: the opening turn, started behind the intro card.
  const openingPrefetchRef = useRef<Promise<GenerateStepOptionsResult> | null>(
    null,
  );
  const replanRef = useRef<Promise<void> | null>(null);
  // LIFE-SCENE-24: guards against two scene generations racing.
  const sceneStartRef = useRef(false);
  const activePlanRef = useRef<GradedPlan | null>(null);
  // LIFE-EX-PLAN-5: the question node's pre-authored continuation.
  const activeResolutionRef = useRef<QuestionResolution | null>(null);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);
  // LIFE-NODE-11: a turn's arrival sequence outlives the call that started it
  // (~1s per pending event, plus one more before the options are released). If
  // the player leaves the wurld mid-turn, drop the pending appends AND the
  // held options step rather than let them fire into an unmounted screen. No
  // write is lost: `commitNode` + the local overlay have already run
  // synchronously on arrival (LIFE-NODE-3) — only the render is deferred.
  useEffect(() => cancelPendingTurnArrivals, []);
  const events = props.events;
  useEffect(() => {
    // LIFE-NODE-3: drop overlay entries the listener has delivered.
    localEventsRef.current = pruneDelivered(events, localEventsRef.current);
  }, [events]);

  // `createEngineActions` only CLOSES OVER the ref objects; every
  // `.current` read happens later inside an action handler / effect,
  // never during render. The new react-hooks/refs rule can't
  // disambiguate. Disabling at this one passing site keeps the rule
  // active for genuinely unsafe cases elsewhere.
  // eslint-disable-next-line react-hooks/refs
  const [actions] = useState<NodeEngineActions>(() =>
    createEngineActions({
      propsRef,
      machineRef,
      localEventsRef,
      nonceRef,
      prefetchRef,
      openingPrefetchRef,
      replanRef,
      sceneStartRef,
      activePlanRef,
      activeResolutionRef,
      transition: (patch) => {
        machineRef.current = { ...machineRef.current, ...patch };
        setState((prev) => ({ ...prev, ...patch }));
      },
    }),
  );

  return { ...state, actions };
}
