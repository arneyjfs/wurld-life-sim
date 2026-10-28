/**
 * LIFE-UI-* (Phase B.2): the /life screen. Drives the real
 * lifeStep loop. Reads world state, runs lifeStep on mount (when
 * no events exist OR the cached "current turn" is stale), shows
 * the two-bubble sliding window, lets the user pick a chip or
 * type a free-text response.
 *
 * What's NOT here (yet — phases C / D):
 *  - Transport loop UI for scene transitions (Phase C). For now,
 *    backdropIntent updates the descriptor directly + the existing
 *    "Building world…" overlay covers the gen latency.
 *  - NPC roster + avatars (Phase C).
 *  - Memory compaction (Phase C).
 *  - Graded-exercise visual styling — Phase B.2 grades the answer
 *    but the chip grid looks identical to CYOA per LIFE-EX-3.
 *  - Save-concept affordance + character sheet (Phase D).
 *
 * Spec: docs/specs/life-sim.md §8, §9.
 */
import { speechSpeedFor } from '@/lib/level';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader } from 'lucide-react';
import { voiceForSpeaker } from '@/lib/ttsVoices';
import { castVoiceMap } from '@/lib/life/cast';
import { useUserProfile } from '@/hooks/useUserProfile';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { useLifeWorld } from '@/hooks/useLifeWorld';
import { useLifeEvents } from '@/hooks/useLifeEvents';
import { useLifeNpcs } from '@/hooks/useLifeNpcs';
import { useLifeScene } from '@/hooks/useLifeScene';
import { useLifeBackdrop, backdropBuildingVisible } from '@/hooks/useLifeBackdrop';
import {
  descriptorFromIntent,
  descriptorFromWorld,
  fallbackDescriptor,
} from './backdropDescriptorForLife';
import {
  type SceneCompletionSnapshot,
} from '@/lib/life/sceneLifecycle';
import { useNodeEngine } from './useNodeEngine';
import { useArcSelfHeal } from './useArcSelfHeal';
import { useChapterCompletion } from './useChapterCompletion';
import { recordSessionOpen } from '@/lib/life/engagement';
import { updateLifeWorld } from '@/lib/life/world';
import { buildResumeSeed } from '@/lib/life/resumeBubbles';
import { setLifeDebugWorld } from '@/lib/life/debugLog';
import { WorldIntroScreen } from './WorldIntroScreen';
import { WurldResumeScreen } from './WurldResumeScreen';
import { useResumeRecapOnExit } from './useResumeRecapOnExit';
import { AvatarModal, type AvatarModalSubject } from './AvatarModal';
import type { BackdropIntent } from '@/lib/life/stepSchema';
import { useUIStore } from '@/store/uiStore';
import { toUserMessage } from '@/lib/errors';
import type { LifeNpc } from '@/types/firestore';
import { toStored, type ViewSettings } from '@/lib/viewSettings';
import { lifeViewSettings } from '@/screens/LifeScreen/lifeViewSettings';
import { CenteredSpinner } from '@/components/CenteredSpinner';
import * as log from '@/lib/log';
import type { LifeErrorSink } from './nodeEngineTypes';
import { readTimeOfDay } from '@/lib/life/timeOfDay';
import { BackdropStage } from './BackdropStage';
import { useCharacterAvatar } from './useCharacterAvatar';
import { useNpcAvatars, useNpcAvatarPending } from './useNpcAvatars';
import { DialogueArea, type Bubble } from './DialogueArea';
import { LifeFlipHint } from './LifeFlipHint';
import { LifeCompletionOverlays } from './LifeCompletionOverlays';
import { useFlashcardLookup } from './useFlashcardLookup';
import { useLifeWordSave } from './useLifeWordSave';
import { LifeScreenBottom } from './LifeScreenBottom';
import { AnimateHeight } from './AnimateHeight';
import { LifeScreenHeader } from './LifeScreenHeader';
import { buildLifeExplainQuestion, lifeChoiceLabel } from './buildLifeExplainQuestion';
import { useEffectiveWorld } from './useEffectiveWorld';
import { INITIAL_STATE, type LocalState } from './lifeScreenState';
import { gradedOrdinal } from '@/lib/life/exerciseVariant';
import { objectiveBlockFor, worldFactsFor } from '@/lib/life/goalLadder';

// LIFE-LANG-5: route-level code-split so /life doesn't pull the
// ExplainModal bundle on cold boot. Same pattern PracticeScreen uses.
const ExplainModal = lazy(() =>
  import('@/components/ExplainModal/ExplainModal').then((m) => ({ default: m.ExplainModal })),
);

export function LifeScreen() {
  const t = useT();
  const navigate = useNavigate();
  const { worldId: routeWorldId } = useParams<{ worldId: string }>();
  const worldId = routeWorldId ?? null;
  // Bind the debug buffer to this world; entries don't bleed
  // between worlds (LIFE-WORLD-1 scoping).
  useEffect(() => setLifeDebugWorld(worldId), [worldId]);
  const user = useAuthStore((s) => s.user);
  const world = useLifeWorld(user?.uid ?? null, worldId);
  const events = useLifeEvents(user?.uid ?? null, worldId, 40);
  const npcs = useLifeNpcs(user?.uid ?? null, worldId);
  const scene = useLifeScene(user?.uid ?? null, worldId);
  // LIFE-EX-VOCAB-1 + LIFE-BUBBLE-7: deck lookup (extracted hook).
  const flashcardLookup = useFlashcardLookup(user?.uid ?? null, world.data ?? null);
  // TTS-VOICE-7: the player's saved speech pace (TTS-SPEED-1). Read here so
  // the engine's pre-warm and TTSButton's playback ask for the SAME cache key.
  const profile = useUserProfile(user?.uid ?? null);
  // LIFE-DATA-1: resolve npcId → avatar URL from the assets/npc-{id}
  // sidecars (bytes are off the roster-listened npc docs). Read-once +
  // cached; the returned map ref is stable across unrelated re-renders.
  const npcAvatarUrls = useNpcAvatars(user?.uid ?? null, worldId, npcs.npcs);
  // LIFE-NPC-2 / LIFE-FAIL-9: npcIds whose avatar SVG is still generating AND
  // still inside the client gen-timeout window — the avatar slot shows a person
  // icon under a shimmer until it lands OR the timeout gives up to the initials
  // circle (so a dead gen never shimmers forever).
  const npcAvatarPending = useNpcAvatarPending(npcs.npcs);
  const pushToast = useUIStore((s) => s.pushToast);
  // OBS-COVER-7 — every Life failure the player sees is one Sentry event.
  const reportLifeError = useCallback<LifeErrorSink>(
    (err, action) => {
      log.error(err, { action });
      pushToast({ kind: 'error', message: toUserMessage(err) });
    },
    [pushToast],
  );

  const [state, setState] = useState<LocalState>(INITIAL_STATE);
  /** Chapter/scene overlay transitions (closeScene /
   *  continueToNextChapter) — separate from the engine's phases. */
  const [overlayBusy, setOverlayBusy] = useState(false);
  // Track whether we've kicked off the opening lifeStep yet so a
  // re-mount doesn't refire it.
  const openingFiredRef = useRef(false);
  /** LIFE-WORLD-SAGA-*: false until the player taps Begin on the
   *  WorldIntroScreen. Gates the opening lifeStep so the player has
   *  a moment to read the saga teaser before the first turn fires.
   *  Resume flows (eventsData.length > 0) bypass this. */
  const [introDismissed, setIntroDismissed] = useState(false);
  /** LIFE-FLOW-5 (wurlds-v2 Phase C): false until the player taps
   *  Continue on the WurldResumeScreen overlay. Gates the LIFE-FLOW-2
   *  resume seeding the same way introDismissed gates a fresh world's
   *  opening step. Fresh worlds (0 events) never see the recap. */
  const [recapDismissed, setRecapDismissed] = useState(false);
  /** LIFE-NPC-2: open modal showing the tapped avatar at a larger
   *  size + a brief bio. Null when no modal is open. */
  const [avatarModal, setAvatarModal] = useState<AvatarModalSubject | null>(null);
  /** LIFE-LANG-5: whether the Why? ExplainModal is open for the
   *  current feedback. Reset on every new graded pick. */
  const [explainOpen, setExplainOpen] = useState(false);
  const chapter = useChapterCompletion({
    uid: user?.uid ?? null,
    world: world.data,
    scene: scene.data ?? null,
    onError: reportLifeError,
  });
  // LIFE-WORLD-ARC-9: a world whose chapter was archived but never continued
  // is playable and cannot ever finish a chapter. Repair it on open.
  useArcSelfHeal({ uid: user?.uid ?? null, world: world.data });

  const worldData = world.data;
  // LIFE-NPC-2 / LIFE-DATA-1: the player avatar bytes live in a sidecar
  // doc off the hot world doc; fetch once when status reads 'ready'.
  const characterAvatar = useCharacterAvatar(
    user?.uid ?? null,
    worldData?.id ?? null,
    worldData?.characterAvatarStatus,
  );
  const eventsData = events.data;
  const eventsLoaded = !events.loading;
  /**
   * LIFE-FLOW-6 — "this world has genuinely never been played", SERVER-CONFIRMED.
   *
   * `eventsLoaded` alone is not that claim. `useCollectionSnapshot` reports
   * `loading: false` as soon as it has ANY snapshot, including an empty
   * cache-only one on a cold load — which is why it also exposes `fromCache`
   * and documents it as "the definitive gate". An empty `fromCache` snapshot
   * for a world that HAS history is a false "fresh world", and everything that
   * branches on `eventsData.length === 0` believes it.
   *
   * Measured 2026-08-03 on the emulator, instrumenting every `life_step` with
   * its `<turn kind>`: entering a resumed world fired TWO calls —
   * `kind="opening"` and then `kind="continue"`. The opening was the prefetch
   * below acting on the cache-empty snapshot; its result is never consumed by
   * the resume path, so it is a full billed generation thrown away on every
   * resume that loads this way. `LIFE-EX-PLAN-5` holds a turn to exactly one
   * `life_step` for this reason, and this path was quietly paying two.
   */
  const eventsConfirmed = eventsLoaded && !events.fromCache;

  // LIFE-SETTINGS-7: resolve the effective difficulty (pin ?? live global
  // ?? 2) and hand the engine a world clone with `difficulty` overridden,
  // so step + graded + scene generation all track a mid-story change to
  // the global setting. globalDifficulty feeds the ⋯ menu's automatic state.
  const { effectiveWorld, globalDifficulty } = useEffectiveWorld(
    user?.uid ?? null,
    worldData ?? null,
  );

  // LIFE-FLOW-5: fire-and-forget recap polish on world exit.
  useResumeRecapOnExit({ uid: user?.uid ?? null, world: worldData ?? null, events: eventsData, worldId });

  const descriptor = worldData
    ? state.backdropIntent
      ? descriptorFromIntent(state.backdropIntent)
      : descriptorFromWorld(worldData) ?? fallbackDescriptor(worldData)
    : null;
  // LIFE-BACKDROP-7: only GENERATE a scene once a real one exists — a
  // `backdropIntent` from a beat, or a persisted `currentBackdrop`. A fresh
  // world's descriptor is a seed GUESS (fallbackDescriptor); render its
  // silhouette but don't burn a Gemini scene that the first beat's real
  // backdropIntent immediately replaces (fixes the new-world double scene-gen).
  // LIFE-BACKDROP-18 — the third arm is the fix. The gate's PURPOSE is "don't
  // burn a gen on the seed GUESS before the first beat lands", which is about
  // one moment; as written it was "never generate without a backdropIntent",
  // which is forever. A world whose opening beat omits `backdropIntent` — the
  // model is not required to emit one every turn — therefore never generated a
  // scene at all, and never would: no intent, no `currentBackdrop` to inherit,
  // and the early return in `useLifeBackdrop` fires BEFORE any logging, so it
  // did not even leave a trace (owner, 2026-08-01: "the scene gen is not being
  // triggered either, it doesn't even show in the logs").
  //
  // Once events exist the world has actually started, so the descriptor is no
  // longer a guess about a world we know nothing about — it is the best
  // reading of one that is underway, which is exactly when generating is
  // worth it.
  //
  // LIFE-BACKDROP-20/21 — the gen runs while the saga is being READ, and from a
  // REAL intent. `-20` moved the timing (owner: "the first scene should render
  // whilst I'm reading the saga. Not wait until I press begin"); `-21` fixed
  // what it was generating FROM. The `!!worldData.saga` arm `-20` added was
  // the speculative gen off `fallbackDescriptor` — a seed guess that the
  // opening beat's real `backdropIntent` then discarded (owner: "clearly the
  // first actual intent was office. The scene that renders behind the
  // introduction card is immediately discarded"). It is GONE: the opening
  // turn now prefetches behind the intro card and publishes its intent as
  // soon as it resolves, so `state.backdropIntent` is what fires here.
  //
  // `eventsData.length > 0` stays as the sole LIFE-BACKDROP-18 backstop — an
  // opening beat carrying NO backdropIntent still gets a scene once its events
  // land, from the seed descriptor, which is the best reading available then.
  const canGenerateBackdrop =
    !!worldData &&
    (!!state.backdropIntent || !!worldData.currentBackdrop || eventsData.length > 0);
  const backdrop = useLifeBackdrop(
    descriptor,
    worldData?.id ?? null,
    worldData?.practiceLanguage ?? null,
    canGenerateBackdrop,
  );
  // LIFE-BACKDROP-7: show the "Building your wurld…" placeholder over the
  // silhouette during a real gen OR the fresh-world pre-first-scene window.
  const backdropBuilding = backdropBuildingVisible(
    backdrop.status,
    canGenerateBackdrop,
    eventsData.length,
  );

  // LIFE-BUBBLE-7: one source for the BackdropStage ribbon label AND the
  // flashcard story-context stamp.
  const locationLabel =
    state.backdropIntent?.locationLabel ??
    worldData?.currentLocationLabel ??
    t('life.locationRibbon.apartment');
  // LIFE-BACKDROP-26: read from the SAME source as the label it translates, in
  // the same order. Mixing them (this turn's label, the stored translation)
  // would show the player the previous place's native text under the new
  // place's name, which is worse than showing nothing.
  const locationLabelNative = state.backdropIntent
    ? state.backdropIntent.locationLabelNative
    : worldData?.currentLocationLabelNative;
  // LIFE-BUBBLE-7: save/unsave a tapped vocab word as a flashcard.
  const wordSave = useLifeWordSave({
    uid: user?.uid ?? null,
    world: worldData ?? null,
    locationLabel,
    flashcardLookup,
  });

  // LIFE-SCENE-8 + LIFE-NPC-RECUR-4: scope the roster to
  // (world ∪ active scene), dropping retiring transients.
  const scopedNpcs = useMemo<LifeNpc[]>(() => {
    const activeSceneId = scene.data?.id ?? null;
    return Array.from(npcs.npcs.values()).filter(
      (n) =>
        n.scope !== 'transient' &&
        (!n.sceneId || n.sceneId === activeSceneId),
    );
  }, [npcs.npcs, scene.data?.id]);

  const appendBubbles = useCallback(
    (incoming: Bubble[], opts: { resetTurn: boolean }) => {
      setState((prev) => ({
        ...prev,
        bubbles:
          incoming.length > 0 ? [...prev.bubbles, ...incoming] : prev.bubbles,
        currentTurnIds: opts.resetTurn
          ? new Set(incoming.map((b) => b.id))
          : incoming.length > 0
            ? new Set([
                ...prev.currentTurnIds,
                ...incoming.map((b) => b.id),
              ])
            : prev.currentTurnIds,
      }));
    },
    [],
  );
  const onBackdropIntent = useCallback((intent: BackdropIntent) => {
    setState((prev) => ({ ...prev, backdropIntent: intent }));
  }, []);
  const onSceneResolved = useCallback(
    (snapshot: SceneCompletionSnapshot) => {
      // LIFE-SCENE-30: PARK it. The turn that resolved the scene is still
      // gliding its beats in, and the modal used to open over the very line
      // that says how the scene ended — the player read the outcome for the
      // first time inside a summary card, having never seen it in the story.
      // `LifeScreenBottom` shows a "View scene summary" chip where the options
      // would be, and the player promotes it when they are ready.
      // LIFE-SCENE-31: a NEW scene's summary is not written yet, so clear the
      // previous one here rather than when the overlay opens — otherwise a fast
      // second scene would show the last scene's record.
      setState((prev) => ({
        ...prev,
        pendingSceneComplete: snapshot,
        sceneSummary: null,
        sceneSummaryDone: false,
      }));
    },
    [],
  );
  const onSceneSummary = useCallback((historyLine: string | null) => {
    // LIFE-SCENE-31.1: `done` regardless of whether a line came back. The close
    // fires this exactly once per resolve, so this is the terminal transition.
    setState((prev) => ({ ...prev, sceneSummary: historyLine, sceneSummaryDone: true }));
  }, []);

  const engine = useNodeEngine({
    uid: user?.uid ?? null,
    // LIFE-SETTINGS-7: effective (difficulty-resolved) world — every
    // generator reads difficulty off input.world; other fields are intact.
    world: effectiveWorld,
    events: eventsData,
    scene: scene.data ?? null,
    npcs: scopedNpcs,
    appendBubbles,
    onBackdropIntent,
    onSceneResolved,
    onSceneSummary,
    onError: reportLifeError,
    // TTS-VOICE-7: so the audio the engine pre-warms lands on the same cache
    // key playback will ask for. A prefetch at the wrong speed is a paid clip
    // nobody hears.
    speechSpeed: speechSpeedFor(profile.data, world.data?.practiceLanguage), // TTS-SPEED-1.2
  });

  /**
   * TTS-VOICE-2 — cast the CURRENT speaker's voice.
   *
   * The question the engine is holding names its speaker (`npcId`, pinned from
   * the direction by LIFE-EX-DIR-2). That id plus the character sheet's gender
   * and register picks a real Gemini voice, hashed per wurld so the same
   * person sounds the same for the whole run.
   *
   * Falls back to `''` — which the button reads as "no override" and answers
   * with the player's own `voicePreference` — for a comprehension with no
   * npcId, a character the cast has no gender for (every world created before
   * this shipped), or any non-comprehension prompt. That fallback is the OLD
   * behaviour, so a legacy world is no worse off than it was.
   */
  const speakerVoiceName = useMemo(() => {
    const prompt = engine.question?.practicePrompt;
    if (!prompt || prompt.kind !== 'comprehension') return '';
    const npcId = prompt.npcId?.trim();
    if (!npcId) return '';
    // `worldData` is only non-null AFTER this component's early returns, and
    // this memo has to sit above them (hooks order). `effectiveWorld` is the
    // same doc, already optional.
    const worldId = effectiveWorld?.id;
    if (!worldId) return '';
    const member = (effectiveWorld.cast ?? []).find((c) => c.id === npcId);
    // `other` is a considered answer, but there is no third voice pool to send
    // it to — it falls back with everything else rather than being coerced.
    const gender = member?.gender === 'male' || member?.gender === 'female'
      ? member.gender
      : null;
    return voiceForSpeaker({
      worldId,
      speakerId: npcId,
      gender,
      register: member?.voiceRegister ?? null,
    });
  }, [engine.question, effectiveWorld]);

  /**
   * TTS-VOICE-9 — every cast member's voice, by npcId, for the per-bubble
   * speak button.
   *
   * `speakerVoiceName` above answers "who is speaking THIS question", which is
   * one NPC at a time and only while a comprehension is live. The dialogue
   * area needs the answer for any bubble on screen — two different NPCs can be
   * visible at once — so it gets the whole cast as a map, resolved here for
   * the same reason `npcAvatarUrls` is: this is the only place holding the
   * cast.
   *
   * Cast members with no usable gender are OMITTED rather than mapped to `''`.
   * An absent key and an empty string reach `TTSButton` identically (no
   * override → the player's `voicePreference`), and leaving them out keeps the
   * map honest about who has actually been cast.
   */
  const npcVoiceNames = useMemo(() => castVoiceMap(effectiveWorld), [effectiveWorld]);

  /**
   * LIFE-BACKDROP-21 — start the opening turn WHILE the intro card is up.
   *
   * Separate from the fire effect below, and deliberately so: that one is
   * gated on `introDismissed` because it ARRIVES at the node (beats mount,
   * options render), and the player must not miss that. This one only starts
   * the call, so its `backdropIntent` can reach the scene renderer during the
   * read — which is what stops the first scene being generated from a seed
   * guess and immediately discarded.
   *
   * Same preconditions as the opening fire minus the dismissal, so the
   * prefetch and the arrival can never be built from different world state.
   * `prefetchOpening` is idempotent, so a re-render costs nothing.
   */
  useEffect(() => {
    // LIFE-FLOW-6: `eventsConfirmed`, NOT `eventsLoaded`. This effect BILLS —
    // it starts a real `life_step` — so "zero events" has to be a fact from
    // the server, not a cache-only snapshot that has yet to be confirmed. On a
    // resumed world the cache-empty read looked exactly like a fresh one here,
    // and the opening turn it started was discarded the moment the real events
    // arrived and the resume path ran its own `continue`.
    if (!user || !worldData || !eventsConfirmed) return;
    if (eventsData.length > 0) return; // resume flows have their own path
    if (!worldData.saga || !worldData.currentArc) return;
    engine.actions.prefetchOpening();
  }, [
    user,
    worldData,
    worldData?.saga,
    worldData?.currentArc,
    eventsConfirmed,
    eventsData.length,
    engine.actions,
  ]);

  // Opening-beat fire. Only runs once per mount, after the world
  // doc + events listener resolve. setState-in-effect is the right
  // shape here — the lifeStep / resume choice is driven by the
  // first frame state landing.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // LIFE-FLOW-6: `eventsConfirmed` for the same reason as the prefetch —
    // this effect also bills, and the OPENING branch below is reached only by
    // `eventsData.length === 0`. Off a cache-only empty snapshot that claim is
    // wrong on a resumed world, and the cost is worse than the prefetch's: the
    // player would ARRIVE at a brand-new opening node in a world that already
    // has a story, instead of resuming it.
    if (!user || !worldData || !eventsConfirmed) return;
    if (openingFiredRef.current) return;
    // LIFE-WORLD-SAGA-* / LIFE-WORLD-ARC-*: a fresh world's opening
    // step waits for BOTH the saga AND chapter 1 to land, AND for
    // the player to dismiss the WorldIntroScreen. Resume flows
    // (eventsData.length > 0) skip the gate.
    if (
      eventsData.length === 0 &&
      (!worldData.saga || !worldData.currentArc || !introDismissed)
    )
      return;
    if (eventsData.length > 0) {
      // LIFE-FLOW-5 (wurlds-v2 Phase C): the WurldResumeScreen overlay
      // shows first on resumed worlds; hold the LIFE-FLOW-2 seeding
      // until the player taps Continue (same gate shape as
      // introDismissed). openingFiredRef stays false so this effect
      // re-runs when recapDismissed flips.
      if (!recapDismissed) return;
      // LIFE-FLOW-2: resume replays the last beat events into the
      // dialogue window so the player lands on context, not a
      // generic continue prompt. Helper extracted to resumeBubbles.ts.
      openingFiredRef.current = true;
      void recordSessionOpen(user.uid, worldData).catch(() => undefined);
      const seed = buildResumeSeed(eventsData, t);
      setState((prev) => ({ ...prev, bubbles: seed.bubbles }));
      // v2.1: seed the recent bubbles as context, then CONTINUE AUTOMATICALLY —
      // no '__resume__' placeholder chip to tap. The recap screen already gave
      // the "previously" summary; `continueTurn()` (resetTurn keeps the seeded
      // bubbles) fires the live turn straight away.
      engine.actions.continueTurn();
      return;
    }
    openingFiredRef.current = true;
    void recordSessionOpen(user.uid, worldData).catch(() => undefined);
    // LIFE-FLOW-5: a fresh world must never show the resume recap.
    // The opening step's beats land as events moments from now
    // (eventsData.length flips > 0); without this, E9b's overlay
    // condition would fire mid-play. Dismissed = never shows.
    setRecapDismissed(true);
    engine.actions.startOpening();
    // Effect runs ONCE per cold mount via openingFiredRef. The
    // saga + currentArc deps let us re-evaluate the wait gate as
    // each of those generations finishes for a brand-new world.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, worldData, worldData?.saga, worldData?.currentArc, eventsConfirmed, eventsData.length, introDismissed, recapDismissed, engine.actions, t]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // LIFE-FLOW-3: redirect to onboarding only AFTER auth has hydrated.
  // Without the `user` guard, on a cold reload `useLifeWorld` returns
  // {data: null, loading: false} while auth re-establishes from
  // IndexedDB, which would bounce a returning player to onboarding
  // and silently drop their world. Spec touchpoint: docs/specs/
  // life-sim.md §2 (LIFE-FLOW-3).
  if (!user) {
    return <CenteredSpinner />;
  }
  if (!world.loading && !worldData) {
    return <Navigate to="/wurlds" replace />;
  }
  if (world.loading || !worldData) {
    return <CenteredSpinner />;
  }

  /** LIFE-SCENE-30: the player has read the resolution beat and asked for the
   *  summary. Promotion is a pure state move — the scene was already resolved
   *  and committed by the engine; only the CARD was waiting. */
  function openSceneSummary() {
    setState((prev) =>
      prev.pendingSceneComplete
        ? {
            ...prev,
            completedScene: prev.pendingSceneComplete,
            pendingSceneComplete: null,
          }
        : prev,
    );
  }

  async function closeScene(opts?: { thenGoHome?: boolean }) {
    const snapshot = state.completedScene;
    if (!snapshot) return;
    setOverlayBusy(true);
    const r = await chapter.closeScene(snapshot);
    setState((prev) => ({
      ...prev,
      completedScene: null,
      arcComplete: r.kind === 'chapter-complete' ? { arc: r.arc, snapshot } : null,
    }));
    setOverlayBusy(false);
    // LIFE-SCENE-29: the two destinations. `continueTurn` is what the single
    // "Return home" button always did — the label was simply wrong. Going home
    // must NOT also fire it, or the story generates a turn nobody is watching
    // and the player pays for it on their next visit.
    if (opts?.thenGoHome) {
      chapter.pauseToOverview();
      return;
    }
    if (r.kind === 'continue') engine.actions.continueTurn();
  }

  async function handleContinueChapter() {
    const ending = state.arcComplete;
    if (!ending) return;
    setOverlayBusy(true);
    await chapter.continueToNextChapter(ending.arc);
    setState((prev) => ({ ...prev, arcComplete: null }));
    setOverlayBusy(false);
    engine.actions.continueTurn();
  }

  function handlePauseChapter() {
    setState((prev) => ({ ...prev, arcComplete: null }));
    chapter.pauseToOverview();
  }

  // LIFE-LANG-15 (v2): CYOA options are ALWAYS the native / system language —
  // they are the player's META-choices (what to do next), not practice content.
  // So they do NOT follow viewMode, carry no vocab, and never preview a
  // practice-language answer that a following question would then re-ask.
  const optionChipDisplay = 'native' as const;

  // LIFE-NEED-3/5 — is the live objective blocked, and by what?
  //
  // Computed here rather than in the engine because it is a pure function of
  // STATE (`LIFE-NEED-2`: never rolled, never a model judgement, same state →
  // same answer in a replay and in a test) and the screen is where that state
  // already lives. Recomputes on every render, so the turn the player clears
  // the block is the turn the row and its chip disappear.
  //
  // Deliberately NOT a `useMemo`, and this cost a crash to learn: this point in
  // the component is BELOW three early returns (loading, redirect, spinner), so
  // a hook here changes the hook count between renders and React tears the tree
  // down — the E2E hit "Something went wrong" where a missing element was
  // expected. Two small array scans over a scene-sized roster do not need
  // memoising, and a plain call cannot be misplaced this way again.
  const objectiveBlock = objectiveBlockFor(
    worldData.goalLadder?.objective ?? null,
    worldFactsFor(worldData, scopedNpcs),
  );

  // LIFE-LANG-3: the wurld's effective view settings (life's default differs
  // from chat's — see lifeViewSettings).
  const viewSettings = lifeViewSettings(worldData);

  // MSG-VIEW-7.8 — one writer. Firestore latency compensation echoes the
  // write into useLifeWorld immediately, so no local mirror is needed.
  const onSetViewSettings = (next: ViewSettings) => {
    if (!user || !worldData) return;
    void updateLifeWorld(user.uid, worldData.id, toStored(next)).catch((err: unknown) => {
      reportLifeError(err, 'lifeViewSettings');
    });
  };

  const onWorldDeleted = () => navigate('/wurlds', { replace: true });
  const onExitToOverview = () => navigate('/wurlds');

  // LIFE-LANG-16: the flip coach-mark shows only while the dialogue is the
  // active surface — never behind the intro/recap/completion overlays, and
  // never during a graded question (flipping the gated source bubble would
  // leak the comprehension answer).
  const introShowing =
    !!worldData.saga && eventsLoaded && eventsData.length === 0 && !introDismissed;
  const recapShowing = eventsLoaded && eventsData.length > 0 && !recapDismissed;
  const dialogueSurfaceActive =
    eventsLoaded &&
    !introShowing &&
    !recapShowing &&
    !state.arcComplete &&
    !state.completedScene &&
    !engine.question &&
    // LIFE-EX-10: no coach-mark over a focused card-match review.
    engine.phase !== 'card-match';

  return (
    <div
      className="flex-1 min-h-0 flex flex-col bg-(--color-bg)"
      data-testid="LifeScreen"
    >
      <LifeScreenHeader
        uid={user.uid}
        worldId={worldData.id}
        title={worldData.saga?.title?.trim() || worldData.characterName}
        viewSettings={viewSettings}
        onSetViewSettings={onSetViewSettings}
        practiceLanguage={worldData.practiceLanguage}
        nativeLanguage={worldData.systemLanguage ?? worldData.nativeLanguage}
        difficultyPinned={worldData.difficultyPinned}
        globalDifficulty={globalDifficulty}
        goalLadder={worldData.goalLadder}
        onExit={onExitToOverview}
        onDeleted={onWorldDeleted}
        onError={reportLifeError}
      />

      <div className="relative flex-1 min-h-0 flex flex-col">
        <BackdropStage
          svg={backdrop.svg}
          locationLabel={locationLabel}
          locationLabelNative={locationLabelNative}
          // LIFE-BACKDROP-17: 'fallback' is the TERMINAL state — gen finished and
          // failed — so the silhouette is the final answer and must paint.
          // Any other status still has something coming.
          generating={backdrop.status !== 'fallback'}
          // LIFE-TIME-1: re-skins the CACHED svg to the world clock, which is
          // the promise `backdropDescriptor` makes when it keeps time out of
          // the cache key.
          timeOfDay={readTimeOfDay(worldData?.timeOfDay)}
        />
        {backdropBuilding && (
          <>
            {/* LIFE-BACKDROP-7: a soft sheen over the fallback silhouette so a
                fresh world reads as LOADING, not a finished scene. */}
            <div
              className="absolute inset-0 pointer-events-none life-scene-building"
              aria-hidden
            />
            <div
              data-testid="LifeScreen-BackdropGenStatus"
              className="absolute top-12 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-(--color-bg)/85 backdrop-blur-sm text-xs text-(--color-fg-muted) border border-(--color-border)/50 flex items-center gap-1.5"
            >
              <Loader size={12} className="animate-spin" />
              <span>{t('life.buildingWorld')}</span>
            </div>
          </>
        )}
        <DialogueArea
          bubbles={state.bubbles}
          viewSettings={viewSettings}
          characterName={worldData.characterName} practiceLanguage={worldData.practiceLanguage}
          userAvatarUrl={characterAvatar.url}
          userAvatarLoading={characterAvatar.loading}
          npcAvatarUrls={npcAvatarUrls}
          // TTS-VOICE-9: the per-bubble speak button gets the CHARACTER's
          // voice, the same one the listening exercise uses. TTS-VOICE-6
          // resolved it here and threaded it to the exercise card only, so the
          // surface the player taps most was still reading every NPC in the
          // player's own voice.
          npcVoiceNames={npcVoiceNames}
          npcAvatarPending={npcAvatarPending}
          currentTurnIds={state.currentTurnIds}
          wordSave={wordSave}
          hideNativeForUtterance={
            engine.question?.practicePrompt.kind === 'comprehension'
              ? engine.question.practicePrompt.npcUtterance
              : null
          }
          onAvatarTap={(info) => {
            if (info.kind === 'user') {
              setAvatarModal({
                name: worldData.characterName,
                avatarUrl: characterAvatar.url,
                role: t('life.avatar.you'),
              });
              return;
            }
            const npc = info.npcId ? npcs.npcs.get(info.npcId) : null;
            setAvatarModal({
              name: info.name,
              avatarUrl: info.npcId
                ? (npcAvatarUrls.get(info.npcId) ?? null)
                : null,
              role: npc?.relationship ?? null,
              // LIFE-NPC-7: "who they are" blurb above the memory row.
              description: npc?.description ?? null,
              oneLineMemory: npc?.oneLineMemory ?? null,
            });
          }}
        />
        {avatarModal && (
          <AvatarModal subject={avatarModal} onClose={() => setAvatarModal(null)} />
        )}
        {dialogueSurfaceActive && <LifeFlipHint />}
        {worldData.saga &&
          eventsLoaded &&
          eventsData.length === 0 &&
          !introDismissed && (
            <WorldIntroScreen
              title={worldData.saga.title}
              titleTranslation={worldData.saga.titleNative}
              teaser={worldData.saga.playerFacingTeaser}
              goal={worldData.goalLadder?.saga ?? null}
              firstObjective={worldData.goalLadder?.objective?.text ?? null}
              tone={worldData.saga.tone}
              onBegin={() => setIntroDismissed(true)}
            />
          )}
        {eventsLoaded && eventsData.length > 0 && !recapDismissed && (
          <WurldResumeScreen world={worldData} events={eventsData} onContinue={() => setRecapDismissed(true)} />
        )}
        <LifeCompletionOverlays
          completedScene={state.completedScene}
          sceneSummary={state.sceneSummary}
          sceneSummaryDone={state.sceneSummaryDone}
          liveObjective={worldData.goalLadder?.objective?.text ?? null}
          arcComplete={state.arcComplete}
          busy={overlayBusy}
          eventsData={eventsData}
          npcs={npcs.npcs}
          onPractiseMissed={(href) => navigate(href)}
          // LIFE-DAY-5: practice exits to /cards by default. The player came
          // from here, mid-story, so send them back rather than leaving the
          // world to be found again by hand.
          returnTo={worldId ? `/wurlds/${encodeURIComponent(worldId)}` : undefined}
          uid={user?.uid}
          practiceLanguage={worldData?.practiceLanguage}
          nativeLanguage={worldData?.nativeLanguage}
          onCloseScene={() => void closeScene()}
          onReturnToWurlds={() => void closeScene({ thenGoHome: true })}
          onContinueChapter={() => void handleContinueChapter()}
          onPauseChapter={handlePauseChapter}
        />
      </div>

      {/* LIFE-UI-ANIM: glide the bottom panel's height as it swaps phase /
          grows-shrinks the option grid, so the dialogue above moves up/down
          gradually. Disabled while the ✏️ composer is open — the keyboard
          drives that height and we must not fight it. */}
      <AnimateHeight enabled={!engine.composerOpen}>
        <LifeScreenBottom
          // LIFE-SCENE-30: replaces the options with "View scene summary"
          // while a resolved scene is waiting to be opened.
          sceneSummaryPending={!!state.pendingSceneComplete}
          onViewSceneSummary={openSceneSummary}
          phase={engine.phase}
          waitKind={engine.waitKind}
          feedback={engine.feedback}
          question={engine.question}
          options={engine.options}
          nodeKind={engine.nodeKind}
          composerOpen={engine.composerOpen}
          cardMatch={engine.cardMatch}
          // LIFE-EX-13.3: owed-but-not-yet-shown, so the summary chip waits and
          // the ordinary question-loading shimmer covers the gap.
          cardMatchPending={engine.cardMatchPending}
          onCardMatchComplete={engine.actions.completeCardMatch}
          optionChipDisplay={optionChipDisplay}
          objectiveBlock={objectiveBlock}
          flashcardLookup={flashcardLookup}
          difficulty={effectiveWorld?.difficulty ?? worldData.difficulty}
          // TTS-VOICE-2: the NPC whose line is about to be READ ALOUD gets
          // their OWN voice, cast from the character sheet's gender + register
          // and hashed per wurld. This is the only place with the cast, so it
          // is the only place that can answer "who is speaking".
          speakerVoiceName={speakerVoiceName}
          // LIFE-EX-15: rotate the render variant by how many questions OF THIS
          // KIND this wurld has resolved — not by the total. The total was the
          // same number a since-deleted kind rotation read to decide fill-blank
          // vs comprehension, so sharing it locked each rotation's phase to the
          // alternation's parity and made `comprehension:read` unreachable at
          // every level >= 3. The rotation is gone (LIFE-EX-18) but the
          // per-kind seed is still the right one: it counts the exercises the
          // player has actually SEEN of this kind, which is what the variant
          // ladder is spacing out. Stable within a question, +1 each resolution.
          exerciseSeed={gradedOrdinal(
            eventsData,
            engine.question?.practicePrompt.kind === 'comprehension'
              ? 'comprehension'
              : 'generation',
          )}
          practiceLanguage={worldData.practiceLanguage}
          onPick={engine.actions.pick}
          onTypeSubmit={engine.actions.submitTyped}
          onOrderSubmit={engine.actions.submitOrder}
          onComposerCancel={engine.actions.closeComposer}
          onFreeText={engine.actions.submitFreeText}
          onFeedbackContinue={() => {
            // LIFE-LANG-5: a stale open ExplainModal must not survive
            // into the next question's feedback.
            setExplainOpen(false);
            engine.actions.feedbackContinue();
          }}
          onExplain={() => setExplainOpen(true)}
        />
      </AnimateHeight>

      {/* LIFE-LANG-5: Why? explain — practice-mode ExplainModal fed by
          the captured graded prompt + chips. Options + answers are in
          the language the chips were RENDERED in (comprehension →
          native, fill-blank → practice). */}
      {explainOpen && engine.feedback && engine.question && (
        <Suspense fallback={null}>
          <ExplainModal
            open
            onClose={() => setExplainOpen(false)}
            message={null}
            chatId=""
            practiceLanguage={worldData.practiceLanguage}
            nativeLanguage={worldData.nativeLanguage}
            translatedText=""
            wordDifficulty={effectiveWorld?.difficulty ?? worldData.difficulty}
            practiceQuestion={buildLifeExplainQuestion(
              engine.question.practicePrompt,
              engine.question.choices,
              engine.feedback.outcomeKind === 'comprehension' ? 'native' : 'practice',
            )}
            userAnswer={lifeChoiceLabel(
              engine.feedback.picked,
              engine.feedback.outcomeKind === 'comprehension' ? 'native' : 'practice',
            )}
            wasCorrect={engine.feedback.correct}
          />
        </Suspense>
      )}
    </div>
  );
}



