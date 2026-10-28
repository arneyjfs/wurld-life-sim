/**
 * THE LOOP — one world, played through the SHIPPED generators.
 *
 * Mirrors `LifeStartScreen` + `nodeEngineActions` + `sceneLifecycle` in order:
 *
 *   sagaOpen → bio → chapter 1
 *   ├─ sceneOpen → backdrop
 *   │  ├─ turn: generateStepOptions → (graded question) → commit → pick
 *   │  └─ …
 *   └─ sceneClose → history, clocks, cast deltas
 *
 * Every generation here is the real one. The only substitutions are the
 * transport (`transport.ts` — real Gemini, no Firebase hop) and the state fold
 * (`worldStore.ts` — the one thing `commitNode` does that cannot be called).
 *
 * THE PLAYER IS SIMULATED, and how it picks matters. Always taking the first
 * option would flatter the design by only ever walking the path the model
 * listed first — and the question this harness exists to answer is whether
 * DIFFERENT choices lead anywhere different. So the pick rotates.
 *
 * EVERYTHING THE PLAYER WOULD SEE IS CAPTURED — beats, options, questions,
 * backdrops, avatar bios — because that is what the judge scores. Everything
 * else lands in the transport's call log for diagnosis afterwards.
 */
import { runSagaOpen } from '@/lib/life/runSagaOpen';
import { generateCharacterBio, renderBioForPrompt } from '@/lib/life/generateBio';
import { runWorldArcGenerate } from '@/lib/life/runWorldArcGenerate';
import { runSceneOpen } from '@/lib/life/runSceneOpen';
import { runSceneClose } from '@/lib/life/runSceneClose';
import { generateStepOptions, recentGenerationTargets, type LiveTurnChoice } from '@/lib/life/generateStepOptions';
import { runGradedQuestionGenerate } from '@/lib/life/runGradedQuestionGenerate';
import { gradedSayPlan } from '@/lib/life/gradedSayPlan';
import { resolutionToArrival } from '@/screens/LifeScreen/nodeEngineResolution';
import { generateBackdrop } from '@/lib/life/generateBackdrop';
import { descriptorCacheKey } from '@/lib/life/backdropDescriptor';
import { generateNpcProfile } from '@/lib/life/generateNpcProfile';
import { frontsNeedingSign } from '@/lib/life/fronts';
import { sceneResolveTooEarly } from '@/lib/life/sceneLifecycle';
import { buildSceneLog } from '@/lib/life/sceneLog';
import { captureGraded, type CapturedGraded } from './captureGraded';
import { WorldStore, type NodeLike } from './worldStore';
import { assertBudget } from './transport';
import type { LifeWorld } from '@/types/firestore';
import type { GradedPlan, QuestionResolution, StepOption, StepSceneSignal } from '@/lib/life/stepSchema';
import type { CastMember, Front, OptionType } from '@/types/lifeState';

/**
 * THE PICK, AS THE CLIENT BUILDS IT — mirrors `nodeEngineActions.pick()`.
 *
 * `LiveTurnChoice`'s own doc comment records that a narrower hand-written copy
 * of this shape once dropped `speechAct` and broke the LIFE-SPEECH-1 direction
 * lock. This harness made the identical mistake a second time: it sent
 * `{ id, text }`, so `practiceText` arrived undefined and the prompt builder
 * threw on the FIRST pick it was ever given. Nothing is spelled out by hand
 * here — the return type is the app's, so a field added there fails this file
 * at compile time instead of at run time.
 */
function toLiveChoice(option: StepOption): LiveTurnChoice {
  return {
    id: option.id,
    practiceText: option.practiceText,
    speechAct: option.speechAct,
    saysLine: option.saysLine?.practiceText ?? null,
  };
}

/**
 * The two graded plans do not share field names — a fill-blank tests
 * `testTarget` inside `sentenceContext`; a comprehension tests understanding of
 * `npcUtterance`. This harness invented `target`/`sourceLine`, which exist on
 * neither, so every captured question recorded an empty line and the judge
 * scored QUESTION-VALUE on blanks.
 */
function readPlan(plan: GradedPlan): { target: string | null; line: string } {
  return plan.kind === 'generation'
    ? { target: plan.testTarget, line: plan.sentenceContext }
    : { target: null, line: plan.npcUtterance };
}

/**
 * LIFE-BENCH-5 — the harness can PUSH the story, not only pick from its menu.
 *
 *     PLAY_FREETEXT=3 npm run test:playthrough
 *
 * Every Nth turn the player writes their own action instead of taking an
 * option. Two reasons this is worth having.
 *
 * (a) **The route had never been run.** `freeText` was hard-coded `null` on
 * every turn since the harness was written, so "Write your own" — a first-class
 * user-facing input — had zero coverage. Exactly the gap the comment two
 * hundred lines below records for options ("because the harness never had
 * options, it had never once run").
 *
 * (b) **It is the only way to stress the SCENE BOUNDARY.** Options are authored
 * by the same call that authors the scene, so they mostly point where the scene
 * already intends to go. A player who writes "I leave and go somewhere else"
 * is pushing AGAINST the outline, which is what forces a replan or a resolve —
 * and the scene boundary (`LIFE-SCENE-33`) is what that produces.
 *
 * The lines are deliberately blunt and disruptive. This is a stress test, not
 * a simulation of typical play, and the report should be read that way.
 */
const FREETEXT_EVERY = Number(process.env.PLAY_FREETEXT ?? '0');

const PUSH_LINES = [
  'I have had enough of this. I leave and go somewhere else entirely.',
  'I stop what I am doing and go looking for someone I have not spoken to yet.',
  'I change the subject completely and ask about something nobody has mentioned.',
  'I walk out without explaining myself and head home.',
  'I decide this is finished and turn my attention to something new.',
];

export type WorldSpec = {
  name: string;
  label: string;
  seedKey: string;
  seedText?: string;
  mode: 'realistic' | 'fantasy';
  practiceLanguage: string;
  systemLanguage: string;
  difficulty: number;
  /** Scenes to play. LONG worlds get enough to reach a climax. */
  scenes: number;
  /** CEILING, not a target. A scene ends when the model resolves it
   *  (`scene.resolved`, honoured through `sceneResolveTooEarly` exactly as the
   *  app does); this only stops a scene that never resolves from running away. */
  turnsPerScene: number;
  /**
   * LIFE-BENCH-7: stop the run the moment a scene resolves with
   * `arcStage: 'concluding'` — the chapter is over, so the run ends where the
   * STORY ends rather than where the loop runs out.
   *
   * OPT-IN, and that is the whole point. It shipped as unconditional and
   * immediately broke the thing `DEFAULT_WORLDS` exists for: the benchmark's
   * own header says the LONG worlds are there because *"a 2-scene run cannot
   * fail those dimensions, so a benchmark made only of short runs would report
   * health it never measured"* — and the first baseline world after the change
   * declared `concluding` on scene 0 and produced a ONE-SCENE artefact where
   * eight were wanted. A measurement mode is not a default.
   */
  stopAtChapterEnd?: boolean;
};

export type CapturedTurn = {
  scene: number;
  turn: number;
  beats: { speaker: string; name: string | null; practice: string; native: string }[];
  options: {
    id: string;
    /** `''` when the model omitted `actionType` — legal per LIFE-GRID-1.1. */
    type: OptionType | '';
    targetId: string | null;
    label: string;
    speechAct: 'say' | 'act' | null;
  }[];
  chose: string | null;
  /** LIFE-BENCH-6 — the whole prompt object plus every chip with its verdict.
   *  See `captureGraded.ts` for what the truncated string it replaced lost. */
  graded: CapturedGraded | null;
  introduced: string[];
};

export type CapturedScene = {
  index: number;
  title: string;
  subject: string;
  /** LIFE-INTENT-2: the question this scene was opened as UNSETTLED on. Kept
   *  in the artefact so a leaning can be read against the question it was
   *  answering — the diagnosis that found LIFE-INTENT-3 needed exactly this
   *  and had to reconstruct it from the calls log. */
  openQuestion: string;
  where: string;
  atStake: string;
  drawsOn: string[];
  signOf: string | null;
  backdropSvg: string | null;
  backdropLabel: string;
  turns: CapturedTurn[];
  historyLine: string;
  /** LIFE-BENCH-7: the `arcStage` the scene resolved with — `continues` /
   *  `climactic` / `concluding`, or null when the scene was cut at the turn
   *  ceiling without resolving. This is the ONLY signal that says whether a
   *  CHAPTER ever ends, and until 2026-08-06 the harness discarded it: every
   *  run stopped at a scene count, so "the chapter concluded" and "the harness
   *  ran out of scenes" were indistinguishable in every artefact. */
  arcStage: 'continues' | 'climactic' | 'concluding' | null;
  frontsAfter: Front[];
  castAfter: CastMember[];
};

export type WorldRun = {
  spec: WorldSpec;
  title: string;
  situation: string;
  bio: string;
  chapterPremise: string;
  cast: CastMember[];
  scenes: CapturedScene[];
  /** The avatar-card copy a player reads for each principal. */
  npcBios: { name: string; role: string; profile: string }[];
  /** LIFE-INTENT-2: one entry per live turn — did the player's action move the
   *  scene's open question, and how long has it been stuck. The MEASURED half
   *  of INTENT, scored by `scoreLeaningMovement`. */
  leaningClaims: { moved: boolean; stall: number; leaning: string; restatedQuestion: boolean }[];
  /** LIFE-BENCH-7: the scene index whose resolution declared the chapter over
   *  (`arcStage: 'concluding'`), or null if the run hit its scene ceiling with
   *  the chapter still open. A run that ends here ended where the STORY ended
   *  it, which is the only kind of ending worth scoring. */
  chapterEndedAtScene: number | null;
  failures: string[];
};

const BUDGET = Number(process.env.PLAY_BUDGET ?? '6.00');

export async function playWorld(spec: WorldSpec): Promise<WorldRun> {
  /** LIFE-BENCH-5: rotates ACROSS scenes so the same push line is not
   *  repeated at the same point in every scene. */
  let pushIdx = -1;
  const failures: string[] = [];
  /** The app's localStorage backdrop cache, in memory. Keyed exactly as
   *  `useLifeBackdrop` keys it, so revisiting a place reuses its SVG. */
  const backdrops = new Map<string, string>();
  const base = {
    id: `play-${spec.name}`,
    characterName: spec.name,
    practiceLanguage: spec.practiceLanguage,
    nativeLanguage: spec.systemLanguage,
    systemLanguage: spec.systemLanguage,
    difficulty: spec.difficulty,
    worldSeedKey: spec.seedKey,
    ...(spec.seedText ? { worldSeedText: spec.seedText } : {}),
    worldMode: spec.mode,
    rollingSummary: '',
  } as unknown as LifeWorld;

  // ── 1. the world opens ────────────────────────────────────────────────
  const opened = await runSagaOpen({ world: base });
  if (opened.kind !== 'ok') throw new Error(`sagaOpen failed: ${opened.reason}`);
  const store = new WorldStore({
    ...base,
    saga: { title: opened.state.title, titleNative: opened.state.titleNative, tone: opened.state.tone },
    universe: opened.state.universe,
    situation: opened.state.situation,
    cast: opened.state.cast,
    fronts: opened.state.fronts,
    sagaHistory: [],
    recentSubjects: [],
    sceneCount: 0,
  } as unknown as LifeWorld);

  // ── 2. the bio, inside the world that just opened ─────────────────────
  let bioText = '';
  try {
    const bio = await generateCharacterBio({
      characterName: spec.name,
      practiceLanguage: spec.practiceLanguage,
      nativeLanguage: spec.systemLanguage,
      worldSeedKey: spec.seedKey,
      worldSeedText: spec.seedText,
      worldMode: spec.mode,
      story: {
        title: opened.state.title, tone: opened.state.tone, situation: opened.state.situation,
        cast: opened.state.cast, fronts: opened.state.fronts,
      },
    });
    if (bio) {
      bioText = renderBioForPrompt(bio);
      store.world = { ...store.world, bio: bioText } as LifeWorld;
    }
  } catch (e) { failures.push(`bio: ${String(e)}`); }

  // ── 3. chapter 1 ──────────────────────────────────────────────────────
  let chapterPremise = '';
  try {
    const arc = await runWorldArcGenerate({
      uid: 'play', world: store.worldDoc, chapterNumber: 1,
    });
    chapterPremise = arc.arc.premise;
    store.world = { ...store.world, currentArc: arc.arc } as LifeWorld;
  } catch (e) { failures.push(`arc: ${String(e)}`); }

  // ── 4. scenes ─────────────────────────────────────────────────────────
  const scenes: CapturedScene[] = [];
  let chapterEndedAtScene: number | null = null;
  for (let s = 0; s < spec.scenes; s += 1) {
    assertBudget(BUDGET);
    const w = store.worldDoc;
    const openRes = await runSceneOpen({
      world: w,
      cast: w.cast ?? [],
      fronts: w.fronts ?? [],
      canon: store.canon,
      history: w.sagaHistory ?? [],
      recentSubjects: w.recentSubjects ?? [],
      sceneIndex: s,
    });
    const outline = openRes.outline;
    if (openRes.kind === 'fallback') failures.push(`scene ${s}: sceneOpen fell back (${openRes.reason})`);
    const sceneId = `sc-${s}`;
    store.openScene(outline, sceneId);
    store.world = {
      ...store.world,
      sceneCount: s + 1,
      recentSubjects: [...(store.world.recentSubjects ?? []), outline.subject ?? outline.premise].slice(-6),
    } as LifeWorld;

    // The backdrop the player looks at for this scene.
    //
    // CACHED BY THE APP'S OWN KEY. `useLifeBackdrop` resolves localStorage
    // first and `descriptorCacheKey` keys on the normalised LABEL alone —
    // `details` and `flavour` are deliberately excluded so cosmetic variants
    // reuse one SVG. The harness called `generateBackdrop` raw, so a place
    // revisited in scene 4 and scene 7 was drawn fresh each time and the
    // transcript showed three different lavender distilleries. Reported as a
    // product defect; it was this line. Scene labels were byte-identical
    // across those visits, so the real app hits cache and the building holds
    // still.
    const label = outline.where?.trim() || outline.title;
    const descriptor = {
      locationType: label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40),
      vibe: spec.mode === 'fantasy' ? 'heightened' : 'modern_city',
      persistent: true,
      label,
      details: [outline.subject ?? ''],
    } as Parameters<typeof generateBackdrop>[0]['descriptor'];
    const cacheKey = descriptorCacheKey(descriptor);
    let backdropSvg: string | null = backdrops.get(cacheKey) ?? null;
    // A cache hit makes no call at all — the app does nothing here either.
    if (!backdropSvg) {
      try {
        const bd = await generateBackdrop({ descriptor, practiceLanguage: spec.practiceLanguage });
        if (bd.kind === 'ok') { backdropSvg = bd.svg; backdrops.set(cacheKey, bd.svg); }
        else failures.push(`scene ${s}: backdrop ${bd.kind}`);
      } catch (e) { failures.push(`scene ${s}: backdrop ${String(e)}`); }
    }

    // ── turns ───────────────────────────────────────────────────────────
    const turns: CapturedTurn[] = [];
    let pendingPick: StepOption | null = null;
    // A SCENE ENDS WHEN THE STORY ENDS IT (LIFE-SCENE-26). This loop used to
    // run exactly `turnsPerScene` turns and then cut, which made ENDING a
    // measurement of where the HARNESS stopped rather than where the story
    // landed — the judge duly reported "the playthrough simply stops during the
    // movement to the basement". `scene.resolved` is now honoured, through the
    // same `sceneResolveTooEarly` floor the app applies, so the resolution path
    // is exercised too rather than never being reached.
    let resolvedAt: number | null = null;
    let arcStage: CapturedScene['arcStage'] = null;
    for (let t = 0; t < spec.turnsPerScene; t += 1) {
      assertBudget(BUDGET);
      // Never on turn 0: the scene has not established itself yet, and pushing
      // against an outline the player has not seen tests nothing.
      const pushNow = FREETEXT_EVERY > 0 && t > 0 && t % FREETEXT_EVERY === 0;
      if (pushNow) pushIdx += 1;
      const res = await generateStepOptions({
        uid: 'play',
        world: store.worldDoc,
        events: store.events,
        scene: store.scene,
        npcs: store.npcs,
        turn: {
          kind: 'live',
          // LIFE-BENCH-5: on a push turn the player writes their own action
          // instead of taking an option, so `choice` must go null — sending
          // both would describe a turn that cannot happen.
          choice: pushNow ? null : pendingPick ? toLiveChoice(pendingPick) : null,
          freeText: pushNow ? PUSH_LINES[pushIdx % PUSH_LINES.length]! : null,
          practiceOutcome: null,
        },
        nonce: 0,
      } as unknown as Parameters<typeof generateStepOptions>[0]);
      if (res.kind !== 'ok' || !res.node) {
        // KEEP THE RAW ATTEMPT. `schema-failed` fired once in 173 calls and the
        // failure line said only "step schema-failed", which is not enough to
        // tell a malformed field from a refusal from a truncation — so the one
        // occurrence could not be diagnosed at all. The result carries
        // `rawAttempts`; throwing it away made a rare bug permanently opaque.
        const detail = res.kind === 'schema-failed'
          ? ` — first attempt: ${(res.rawAttempts[0] ?? '').slice(0, 600)}`
          : res.kind === 'error' ? ` — ${String(res.error).slice(0, 200)}` : '';
        failures.push(`scene ${s} turn ${t}: step ${res.kind}${detail}`);
        break;
      }
      // LIFE-NODE-*: `options`, `introduces`, `logLine` and `worldDelta` are on
      // the RESULT, not the node — the node carries beats and (on a question
      // turn) the gradedPlan. Reading them off the node yields empty options on
      // every turn, which cascades: no options → no pick → no decision event →
      // `cyoaStreak` stays 0 → `renderPracticeCadence` returns null → the model
      // is never asked for a question. That chain produced the "zero questions
      // in 157 turns" result, and it was entirely this line.
      const nodeRaw = res.node as unknown as NodeLike & {
        gradedPlan?: GradedPlan;
        resolution?: QuestionResolution;
      };
      const node: NodeLike & { gradedPlan?: GradedPlan } = {
        ...nodeRaw,
        options: res.options as unknown as NodeLike['options'],
        introduces: res.introduces as unknown as NodeLike['introduces'],
        logLine: res.logLine,
        worldDelta: res.worldDelta as unknown as NodeLike['worldDelta'],
      };

      /** Author one graded question and fold its target into the correction log,
       *  so the LIFE-EX-PLAN-3 fresh-target rule can actually reject a repeat —
       *  passing `recentTargets: []` made every target look unused forever. */
      const authorQuestion = async (
        plan: GradedPlan,
        origin: 'client' | 'model',
      ): Promise<CapturedTurn['graded']> => {
        const { target, line } = readPlan(plan);
        try {
          const q = await runGradedQuestionGenerate({
            plan,
            practiceLanguage: spec.practiceLanguage,
            nativeLanguage: spec.systemLanguage,
            recentTargets: recentGenerationTargets(store.events),
          });
          if (q.kind !== 'ok') {
            failures.push(`scene ${s} turn ${t}: question(${origin}) ${q.reason}`);
            return null;
          }
          // EVERY answered question, not just fill-blanks — see recordCorrection.
          store.recordCorrection(plan.kind, plan.kind === 'generation' ? plan.testTarget : null);
          return captureGraded({
            kind: plan.kind, target, line,
            practicePrompt: q.practicePrompt,
            choices: q.choices,
            direction: plan.kind === 'generation' ? 'outbound' : 'inbound',
            origin,
          });
        } catch (e) {
          failures.push(`scene ${s} turn ${t}: question(${origin}) ${String(e)}`);
          return null;
        }
      };

      // A model-authored question node: the plan is written by the step call,
      // the CHIPS by the graded generator — exactly as the app splits it.
      let graded: CapturedTurn['graded'] = null;
      if (node.gradedPlan) graded = await authorQuestion(node.gradedPlan, 'model');

      // LIFE-EX-PLAN-5: A QUESTION NODE CARRIES NO OPTIONS. The moves out of a
      // graded moment live on its PRE-AUTHORED `resolution`, which the app lands
      // through `resolutionToArrival` without a second `life_step` call.
      //
      // Skipping that step does not merely lose the options — it stalls the
      // loop. No options → no pick → the next turn is generated with `choice:
      // null`, so the model sees a player who answered nothing and asks again.
      // Measured before this fix: 70 questions in 72 turns, 68 of them with an
      // empty grid. Read as "the model crams questions"; it was the harness
      // never letting a question finish.
      let options = (res.options ?? []) as StepOption[];
      let beats = node.beats ?? [];
      if (options.length === 0 && nodeRaw.resolution) {
        const arrival = resolutionToArrival(nodeRaw.resolution, 0);
        options = arrival.liveResult.options;
        // The resolution's beats are the same turn continuing, so they join the
        // question's rather than replacing them. Read off the resolution rather
        // than `arrival.node`, which is typed as the whole `NodePreview` union.
        beats = [...beats, ...nodeRaw.resolution.beats] as typeof beats;
        // LIFE-ARC-PACE-1: a resolution costs no generation, so it is a story
        // moment but NOT a turn. `commit` below still counts one for the
        // question node itself.
        if (arrival.liveResult.logLine) node.logLine = arrival.liveResult.logLine;
      }
      const pick = options.length ? options[(s + t) % options.length]! : null;

      // LIFE-SPEECH-3: the CLIENT turns a `say` pick that declared a
      // `gradeTarget` into an outbound fill-blank, before the player's bubble is
      // prepended. This is code-side interception, not a prompt instruction —
      // and because the harness never had options, it had never once run.
      if (pick && !graded) {
        const sayPlan = gradedSayPlan(pick, recentGenerationTargets(store.events));
        if (sayPlan) graded = await authorQuestion(sayPlan, 'client');
      }

      store.commit(node, {
        countsAsTurn: true,
        choiceText: pendingPick?.practiceText,
        actionType: pendingPick?.actionType,
        targetId: pendingPick?.targetId ?? null,
      });
      // LIFE-NPC-MEM-1: the per-NPC "story so far" the next turn's <npcMemory>
      // block reads. Dropped, every character stayed a stranger forever.
      store.applyNpcMemories(res.npcMemoryUpdates ?? []);
      turns.push({
        scene: s, turn: t,
        beats: beats.map((b) => ({
          speaker: b.speaker, name: b.speakerName ?? null, practice: b.practiceText, native: b.nativeText,
        })),
        options: options.map((o) => ({
          id: o.id, type: o.actionType ?? '', targetId: o.targetId ?? null,
          label: o.nativeText, speechAct: o.speechAct ?? null,
        })),
        chose: pick?.nativeText ?? null,
        graded,
        introduced: (node.introduces ?? []).map((i) => i.id ?? i.name),
      });
      pendingPick = pick;

      // LIFE-SCENE-26: the app refuses a resolve below the floor in CODE and
      // lets the scene continue, so the harness does the same — otherwise a
      // model that resolves on turn 2 would end scenes the app would have kept
      // running, and every downstream pace measurement would be off.
      // `res.scene` is a `StepSceneSignal`; read it through the app's type rather
      // than a hand-written cast — inventing shapes here is what produced three
      // wrong field names earlier in this harness's life.
      // LIFE-INTENT-2: fold the leaning claim exactly as `computeReplanPlan`
      // does. Without this the harness renders `stall="0"` on every turn
      // forever, the escalation never fires, and the benchmark would measure a
      // mechanism the app has and the harness doesn't — the same class of
      // harness/app drift that produced this suite's earlier fake findings.
      store.applyLeaning(res.scene);

      const resolved: StepSceneSignal['resolved'] = res.scene?.resolved;
      if (resolved && !sceneResolveTooEarly(store.world.storyLog?.sceneTurns ?? 0)) {
        resolvedAt = t + 1;
        // LIFE-BENCH-7: `arcStage` is the model's claim about the CHAPTER, not
        // the scene — `concluding` means the through-line has landed and the
        // app would show `WorldArcCompleteScreen`. Recorded per scene so the
        // run can stop where the story stops.
        arcStage = resolved.arcStage ?? 'continues';
        break;
      }
    }
    if (resolvedAt === null) {
      // Worth recording rather than silently treating a cut as an ending: a
      // scene that never resolved is exactly the case where ENDING must not be
      // read as an authorial failure.
      failures.push(`scene ${s}: never resolved — cut at the ${spec.turnsPerScene}-turn ceiling`);
    }

    // ── the scene closes ────────────────────────────────────────────────
    const cur = store.worldDoc;
    const closed = await runSceneClose({
      // LIFE-ARCH-2.2: the SAME builder the app uses. The harness had its own
      // version, and it dropped the speakers AND every player decision — so it
      // was measuring a sceneClose the app never runs. Sharing the function is
      // the only way these two stop drifting.
      sceneLog: buildSceneLog(store.events),
      subject: outline.subject ?? outline.premise,
      atStake: outline.premise,
      cast: cur.cast ?? [],
      fronts: cur.fronts ?? [],
      realistic: spec.mode === 'realistic',
      requestedSignIds: frontsNeedingSign(cur.fronts ?? []).map((f) => f.id),
      signOf: outline.signOf ?? null,
    });
    if (closed.kind !== 'ok') {
      failures.push(`scene ${s}: sceneClose ${closed.reason}`);
      scenes.push({
        index: s, title: outline.title, subject: outline.subject ?? '',
        openQuestion: outline.openQuestion ?? '', where: outline.where ?? '',
        atStake: outline.premise, drawsOn: outline.drawsOn ?? [], signOf: outline.signOf ?? null,
        backdropSvg, backdropLabel: label, turns, historyLine: '', arcStage,
        frontsAfter: cur.fronts ?? [], castAfter: cur.cast ?? [],
      });
      continue;
    }
    store.world = {
      ...store.world,
      fronts: closed.fronts,
      cast: closed.cast,
      ...(closed.situation ? { situation: closed.situation } : {}),
      sagaHistory: [...(store.world.sagaHistory ?? []), closed.historyLine].filter(Boolean),
    } as LifeWorld;
    scenes.push({
      index: s, title: outline.title, subject: outline.subject ?? '',
      openQuestion: outline.openQuestion ?? '', where: outline.where ?? '',
      atStake: outline.premise, drawsOn: outline.drawsOn ?? [], signOf: outline.signOf ?? null,
      backdropSvg, backdropLabel: label, turns, historyLine: closed.historyLine, arcStage,
      frontsAfter: closed.fronts, castAfter: closed.cast,
    });

    // LIFE-BENCH-7 — THE RUN ENDS WHERE THE CHAPTER ENDS.
    //
    // Every run before this stopped at `spec.scenes`, which made "played to the
    // end of a chapter" unmeasurable: an artefact of 8 scenes said nothing
    // about whether the through-line had landed or the loop had simply run out.
    // It is the same defect LIFE-SCENE-26 fixed one level down, where the TURN
    // loop cut scenes before they could resolve and the judge duly reported
    // "the playthrough simply stops" as an authorial failure.
    //
    // `spec.scenes` becomes a CEILING rather than a target, exactly as
    // `turnsPerScene` already is.
    if (arcStage === 'concluding') {
      // RECORDED for every run — the artefact should always be able to say
      // where the chapter landed, even in a run that keeps playing past it.
      if (chapterEndedAtScene === null) chapterEndedAtScene = s;
      if (spec.stopAtChapterEnd) break;
    }
  }

  // ── 5. the avatar copy a player reads ─────────────────────────────────
  const npcBios: WorldRun['npcBios'] = [];
  for (const c of (store.world.cast ?? []).filter((x) => x.tier === 'principal').slice(0, 3)) {
    try {
      const p = await generateNpcProfile({
        name: c.name,
        role: c.known,
        worldVibe: opened.state.tone,
        archetype: `${c.name}, ${c.known}`,
        practiceLanguage: spec.practiceLanguage,
        nativeLanguage: spec.systemLanguage,
      } as Parameters<typeof generateNpcProfile>[0]);
      npcBios.push({
        name: c.name, role: c.known,
        profile: p.kind === 'ok' ? p.description.slice(0, 600) : `(failed: ${String((p as { error?: unknown }).error).slice(0, 120)})`,
      });
    } catch (e) { failures.push(`npcProfile ${c.name}: ${String(e)}`); }
  }

  return {
    spec,
    title: opened.state.title,
    situation: opened.state.situation,
    bio: bioText,
    chapterPremise,
    cast: store.world.cast ?? [],
    scenes,
    npcBios,
    leaningClaims: [...store.leaningClaims],
    chapterEndedAtScene,
    failures,
  };
}
