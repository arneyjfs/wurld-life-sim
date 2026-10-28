/**
 * THE HARNESS IS COMPILED AGAINST THE APP — asserted, not assumed.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * Three times now, a measurement harness has reported a product defect that was
 * really its own author writing a field name from memory:
 *
 *  1. `tests/experiments/life-cost` declared `npcMemoryUpdates[].memory` where
 *     production writes `oneLineMemory`, so NPC memory never reached a prompt.
 *     The numbers in a whole cost audit came from that harness.
 *  2. `LifeStartScreen` wrote a saga shape `ZLifeWorld` could not parse, so
 *     every world created for weeks read back as "world not found"
 *     (LIFE-DATA-DRIFT-1).
 *  3. `tests/playthrough` sent `{ id, text }` where `LiveTurnChoice` wants
 *     `{ id, practiceText, speechAct, saysLine }`, read `option.type` where the
 *     schema says `actionType`, and read `gradedPlan.target`/`.sourceLine`,
 *     which exist on NEITHER graded-plan variant. It then reported "zero
 *     questions in 157 turns" as a finding about the product.
 *
 * All three are the same failure: the WRITER's shape was never checked against
 * the READER's type. The fix that generalises is not another review habit, it
 * is putting the directory in front of the compiler — which is what
 * `tsconfig.tests.json` now does, and what the first test below keeps true.
 *
 * The rest assert the specific couplings a compiler cannot see: that the pick
 * the harness builds is the pick `nodeEngineActions` builds, and that the
 * client-side question interception is reachable from a captured option.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { gradedSayPlan } from '@/lib/life/gradedSayPlan';
import { ZStepOption } from '@/lib/life/stepSchema';
import { WorldStore } from './worldStore';

const ROOT = path.resolve(__dirname, '../..');

describe('every harness under tests/ is typechecked', () => {
  // 30s, not the 5s default. This test walks `tests/` and reads every `.ts` it
  // finds, so its runtime is I/O bound and tracks MACHINE LOAD, not correctness.
  // It timed out at 5,020ms during a full 440-file run and passed 18/18 in
  // isolation moments later. The note below already records one flake from the
  // same cause and fixed it by skipping `node_modules`; that made the walk
  // cheaper but left it sharing a cold cache with 439 other files. A coverage
  // assertion has no business failing on a stopwatch.
  it('tsconfig.tests.json covers each tests/ directory that imports from @/', { timeout: 30_000 }, () => {
    // The glob is a LIST OF DIRECTORIES, so adding a harness without adding it
    // here silently opts out of the compiler. That is exactly how the
    // playthrough harness came to ship three wrong field names to a paid model
    // run. This turns forgetting into a red test.
    const cfg = fs.readFileSync(path.join(ROOT, 'tsconfig.tests.json'), 'utf8');
    const covered = [...cfg.matchAll(/"(tests\/[^/"]+)\//g)].map((m) => m[1]);

    const dirs = fs
      .readdirSync(path.join(ROOT, 'tests'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `tests/${d.name}`);

    // SKIPPED, and the skip is load-bearing: `tests/e2e/node_modules` holds
    // 22,435 files, and reading every `.ts` under it took 9.6 seconds — long
    // enough to blow the default timeout under parallel load and fail this test
    // for a reason that has nothing to do with what it asserts. It did exactly
    // that once. An unbounded filesystem walk inside a unit test is a flake
    // waiting for a cold cache.
    const SKIP = new Set(['node_modules', '__pycache__', 'dist', 'coverage']);
    const walk = (p: string): string[] =>
      fs.readdirSync(p, { withFileTypes: true }).flatMap((e) => {
        if (e.name.startsWith('.') || SKIP.has(e.name)) return [];
        return e.isDirectory() ? walk(path.join(p, e.name))
          : e.name.endsWith('.ts') ? [path.join(p, e.name)] : [];
      });
    const importsApp = dirs.filter((d) =>
      walk(path.join(ROOT, d)).some((f) => /from '@\//.test(fs.readFileSync(f, 'utf8'))));

    // `tests/e2e` is knowingly excluded — it has 26 pre-existing errors and its
    // own note in the tsconfig. Everything else must be covered.
    const missing = importsApp.filter((d) => d !== 'tests/e2e' && !covered.includes(d));
    expect(missing, `add these to tsconfig.tests.json "include": ${missing.join(', ')}`)
      .toEqual([]);
  });
});

describe('LIFE-SPEECH-3 — the client-side question interception is reachable', () => {
  /** A `say` option exactly as the model emits one, through the real schema. */
  const sayOption = (over: Record<string, unknown> = {}) =>
    ZStepOption.parse({
      id: 'o1',
      practiceText: 'Demander le prix',
      nativeText: 'Ask the price',
      actionType: 'ask',
      speechAct: 'say',
      saysLine: { practiceText: 'Combien coûte le pain ?', nativeText: 'How much is the bread?' },
      gradeTarget: 'coûte',
      ...over,
    });

  it('turns a say pick carrying a gradeTarget into an outbound fill-blank', () => {
    // This is the mechanism the harness never once ran, because it never had
    // options to pick from. If it stops firing, outbound questions go to zero
    // and only the model-authored inbound ones remain.
    const plan = gradedSayPlan(sayOption(), []);
    expect(plan).toEqual({
      kind: 'generation',
      testTarget: 'coûte',
      sentenceContext: 'Combien coûte le pain ?',
    });
  });

  it('declines to recycle a target the player was already tested on', () => {
    // LIFE-EX-PLAN-3. The harness passed `recentTargets: []` unconditionally, so
    // this rule could never fire and the same word could be tested every scene.
    expect(gradedSayPlan(sayOption(), ['coûte'])).toBeNull();
  });

  it('declines a non-say option — direction is structural', () => {
    expect(gradedSayPlan(sayOption({ speechAct: 'act', saysLine: undefined }), [])).toBeNull();
  });
});

describe('LIFE-EX-PLAN-5 — a question node moves the story on through its resolution', () => {
  it('the resolution, not the node, carries the options out of a graded moment', async () => {
    // A question node has NO options — the moves out of it live on its
    // pre-authored `resolution`, which the app lands via `resolutionToArrival`
    // without a second `life_step` call. A loop that reads only `result.options`
    // does not just lose the grid, it STALLS: no options → no pick → the next
    // turn is generated with `choice: null`, so the model sees a player who
    // answered nothing and asks again. Measured: 70 questions in 72 turns, 68
    // with an empty grid — read at first as "the model crams questions".
    const { resolutionToArrival } = await import('@/screens/LifeScreen/nodeEngineResolution');
    const arrival = resolutionToArrival({
      beats: [],
      options: [
        { id: 'r1', practiceText: 'Accepter', nativeText: 'Accept', actionType: 'offer' },
        { id: 'r2', practiceText: 'Refuser', nativeText: 'Refuse', actionType: 'leave' },
      ],
    } as Parameters<typeof resolutionToArrival>[0], 0);
    expect(arrival.liveResult.options.map((o) => o.id)).toEqual(['r1', 'r2']);
    // Presented as a BRANCH: a continuation would collapse to a single
    // "continue" chip and the player would lose the choice entirely.
    expect(arrival.node.kind).toBe('branch');
    // LIFE-ARC-PACE-1: costs no generation, so it is not a turn for pacing.
    expect(arrival.liveResult.fromResolution).toBe(true);
  });
});

describe('LIFE-EX-CADENCE — the counters the harness must feed', () => {
  it('a comprehension answer resets the streak exactly as a fill-blank does', async () => {
    // `cyoaStreak` walks back to the most recent `correction`. The harness
    // recorded them for fill-blanks only, so after a comprehension the streak
    // kept climbing, `cadenceTier` stayed `forced`, and the model was told
    // "THIS node is the question" every turn. Measured: 6 questions in 8 turns
    // against a 1-in-2-to-1-in-3 target — which reads as the model over-asking
    // and is the harness never telling it the question was answered.
    const { cyoaStreak, cadenceTier } = await import('@/lib/life/prompts/stepStreaks');
    const store = new WorldStore({ id: 'w' } as never);
    store.recordCorrection('comprehension', null);
    store.events.push({ id: 'd1', kind: 'decision', payload: {} } as never);
    expect(cyoaStreak(store.events)).toBe(1);
    // CADENCE_DUE is 2 as of 2026-08-04, so ONE pick is not yet due — what
    // matters here is that the comprehension RESET the streak at all. Before
    // the fix it never did, so the streak climbed and the tier stuck at forced.
    expect(cadenceTier(cyoaStreak(store.events))).toBe('none');
    store.events.push({ id: 'd2', kind: 'decision', payload: {} } as never);
    expect(cadenceTier(cyoaStreak(store.events))).toBe('due');
  });

  it('LIFE-NPC-MEM-1: a memory update reaches the roster the prompt reads', () => {
    // `<npcMemory>` renders from `npc.oneLineMemory` every turn. The harness
    // dropped `npcMemoryUpdates` on the floor, so the block was empty in every
    // playthrough and no character ever accumulated a history with the player —
    // damaging exactly the dimensions that scored worst.
    const store = new WorldStore({ id: 'w' } as never);
    store.touchNpc('marc', 'Marc', 'neighbour', 's1');
    store.applyNpcMemories([
      { npcId: 'marc', oneLineMemory: 'Your neighbour Marc; you fixed his gate and he now trusts you.' },
      { npcId: 'nobody', oneLineMemory: 'Not on the roster — must be dropped.' },
      { npcId: 'marc', oneLineMemory: '   ' },
    ]);
    expect(store.npcs.find((n) => n.id === 'marc')?.oneLineMemory)
      .toMatch(/fixed his gate/);
    expect(store.npcs).toHaveLength(1);
  });

  it('a fill-blank correction stays visible to the fresh-target rule', async () => {
    // The reason the fill-blank-only version looked right: the target filter is
    // the only reader that cares which kind it was.
    const { recentGenerationTargets } = await import('@/lib/life/generateStepOptions');
    const store = new WorldStore({ id: 'w' } as never);
    store.recordCorrection('generation', 'coûte');
    store.recordCorrection('comprehension', null);
    expect(recentGenerationTargets(store.events)).toEqual(['coûte']);
  });
});

describe('the graded plans do not share field names', () => {
  it('reads testTarget/sentenceContext from a fill-blank, npcUtterance from a comprehension', async () => {
    // `target` and `sourceLine` — the names the harness invented — are on
    // NEITHER. Reading them yielded `line: ''` on every captured question, so
    // the judge scored QUESTION-VALUE against blank strings and the transcript
    // rendered `QUESTION (fill-blank) on the line: ""`.
    const { ZGradedPlan } = await import('@/lib/life/stepSchema');
    const fill = ZGradedPlan.parse({
      kind: 'generation', testTarget: 'coûte', sentenceContext: 'Combien coûte le pain ?',
    });
    const comp = ZGradedPlan.parse({ kind: 'comprehension', npcUtterance: 'Il est déjà parti.' });
    expect(Object.keys(fill)).not.toContain('target');
    expect(Object.keys(fill)).not.toContain('sourceLine');
    expect(fill).toHaveProperty('testTarget');
    expect(comp).toHaveProperty('npcUtterance');
  });
});

describe('LIFE-BACKDROP: revisiting a place reuses its backdrop', () => {
  it('the app keys the cache on the LABEL alone, so the same place is drawn once', async () => {
    // Reported from Alice's transcript: "Mathieu's lavender distillery did not
    // read a cached scene and therefore the look of the building changed."
    // That was the harness calling `generateBackdrop` raw with no cache — the
    // app resolves through `useLifeBackdrop`, which reads localStorage first.
    //
    // The key is the normalised label; `details` and `flavour` are excluded on
    // purpose so cosmetic variants reuse one SVG. That exclusion is what makes
    // the reuse work here: the harness passes the scene's SUBJECT in `details`,
    // and the subject changes every visit.
    const { descriptorCacheKey } = await import('@/lib/life/backdropDescriptor');
    const at = (subject: string) => descriptorCacheKey({
      locationType: 'mathieu_s_lavender_distillery',
      vibe: 'modern_city', persistent: true,
      label: 'Mathieu\u2019s lavender distillery',
      details: [subject],
    } as Parameters<typeof descriptorCacheKey>[0]);
    expect(at('checking the irrigation')).toBe(at('the vat cracks open'));
  });

  it('two different places do not collide', async () => {
    const { descriptorCacheKey } = await import('@/lib/life/backdropDescriptor');
    const at = (label: string) => descriptorCacheKey({
      locationType: 'x', vibe: 'modern_city', persistent: true, label, details: [],
    } as Parameters<typeof descriptorCacheKey>[0]);
    expect(at('The wash-house (lavoir)')).not.toBe(at('The Café de la Place'));
  });
});

describe('the judge is an instrument, not an author', () => {
  /**
   * MEASURED 2026-08-04. The judge inherited `callGemini`'s default temperature
   * of 0.95 — right for generating a story, wrong for scoring one. Re-judging a
   * single FIXED transcript three times swung NINE of twenty dimensions by a
   * full band: PROSE [1,2,2], ARC [2,3,2], Q-TIMING [0,1,0], CAST-DEPTH
   * [2,3,2]. Every product comparison made that day was a 0.2-0.5 delta between
   * two runs; against ±1.0 of instrument noise, none of them were supported.
   *
   * At temperature 0 the same three passes returned spread 0.00 on all twenty.
   *
   * Guarded in the FREE unit suite rather than by re-measuring, because the
   * measurement costs money and this is the property that makes every other
   * measurement mean something. `npm run test:playthrough:variance` re-derives
   * the number when the mark scheme changes.
   */
  it('scores at temperature 0, so the same transcript scores the same', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('tests/playthrough/judge.ts', 'utf8');
    expect(src).toMatch(/temperature:\s*0\s*,/);
    // And it must be the ONLY temperature the judge sets — a second call site
    // added without one would silently inherit 0.95 again.
    const temps = src.match(/temperature:\s*[\d.]+/g) ?? [];
    expect(temps).toEqual(['temperature: 0']);
  });
});

/**
 * LIFE-BENCH-7 — the artefact records where the CHAPTER ended.
 *
 * Every run before this stopped at `spec.scenes`, so "the chapter concluded"
 * and "the harness ran out of scenes" were indistinguishable in the artefact —
 * `arcStage` came back on every resolution and was thrown away. That is the
 * same defect LIFE-SCENE-26 fixed one level down, where the TURN loop cut
 * scenes before they could resolve and the judge read it as an authorial
 * failure ("the playthrough simply stops").
 */
describe('LIFE-BENCH-7 — the run records the chapter boundary', () => {
  it('CapturedScene declares arcStage, and WorldRun declares chapterEndedAtScene', () => {
    // A TYPE-level assertion done through source, because the fields are only
    // populated by a real (paid) run. What this actually catches is the field
    // being quietly dropped again — which is exactly how it was lost the first
    // time, and there is no cheaper place to notice.
    const src = fs.readFileSync(path.join(__dirname, 'playWorld.ts'), 'utf8');
    expect(src).toMatch(/arcStage: 'continues' \| 'climactic' \| 'concluding' \| null;/);
    expect(src).toMatch(/chapterEndedAtScene: number \| null;/);
  });

  it('a concluding stage is what CAN end the run — see the opt-in block below', () => {
    // This assertion originally pinned an UNCONDITIONAL break, which is the
    // bug: it turned every DEFAULT_WORLDS long run into a short one. Kept,
    // narrowed to the part that is actually invariant — the run can only end
    // early on `concluding`, never on a turn count.
    const src = fs.readFileSync(path.join(__dirname, 'playWorld.ts'), 'utf8');
    expect(src).toMatch(/if \(arcStage === 'concluding'\)/);
  });

  it('arcStage is read off the RESOLUTION, never guessed from the turn count', () => {
    const src = fs.readFileSync(path.join(__dirname, 'playWorld.ts'), 'utf8');
    expect(src).toMatch(/arcStage = resolved\.arcStage \?\? 'continues';/);
  });
});

/**
 * LIFE-BENCH-7 — the chapter-end break is OPT-IN.
 *
 * It shipped unconditional and immediately cost the benchmark the thing it
 * exists for: `run.play.ts`'s own header says the LONG worlds are there
 * because *"a 2-scene run cannot fail those dimensions, so a benchmark made
 * only of short runs would report health it never measured"*, and the first
 * baseline world after the change declared `concluding` on scene 0 and yielded
 * a ONE-SCENE artefact where eight were wanted. A measurement mode is not a
 * default.
 */
describe('LIFE-BENCH-7 — stopping at the chapter boundary is opt-in', () => {
  const src = () => fs.readFileSync(path.join(__dirname, 'playWorld.ts'), 'utf8');

  it('the break is gated on spec.stopAtChapterEnd', () => {
    expect(src()).toMatch(/if \(spec\.stopAtChapterEnd\) break;/);
  });

  it('chapterEndedAtScene is recorded even when the run keeps playing', () => {
    // The artefact should always be able to say where the chapter landed —
    // recording it and stopping on it are two different decisions.
    expect(src()).toMatch(/if \(chapterEndedAtScene === null\) chapterEndedAtScene = s;/);
  });

  it('DEFAULT_WORLDS never sets the flag', () => {
    const play = fs.readFileSync(path.join(__dirname, 'run.play.ts'), 'utf8');
    const defaults = play.slice(play.indexOf('const DEFAULT_WORLDS'), play.indexOf('/** LIFE-BENCH-3'));
    expect(defaults).not.toContain('stopAtChapterEnd');
  });
});

/**
 * SRV-PROMPT-13 — the harness moves with the prompts.
 *
 * The seam replaces `@/lib/gemini` and posts what the CLIENT handed it. Every
 * prompt that migrates server-side therefore vanishes from the harness's view
 * unless the seam resolves the `promptSpec` itself: the client sends
 * `prompt: ''`, and the harness would post an empty prompt and score whatever
 * came back. This is the app's only behavioural regression signal for life
 * prompts, and losing it at the exact moment prompts become deployable without
 * an App Store review inverts the benefit the migration claims.
 */
describe('SRV-PROMPT-13 — the transport resolves server-owned prompts', () => {
  it('SRV-PROMPT-13 — a life_backdrop spec builds the SERVER pair, not an empty prompt', async () => {
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { BACKDROP_SYSTEM_INSTRUCTION, buildBackdropUserPrompt } = await import(
      '../../functions/src/prompts/lifeBackdrop'
    );
    const spec = {
      kind: 'life_backdrop',
      locationType: 'fruit_market',
      vibe: 'modern_city',
      persistent: true,
      practice: 'French',
      timeOfDay: 'morning',
    } as const;

    const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...spec } });
    expect(built).not.toBeNull();
    expect(built?.prompt).toBe(buildBackdropUserPrompt({ ...spec }));
    expect(built?.prompt).toContain('Generate a scene SVG.');
    // ⚠ The SI half was ALREADY missing here before this batch. LIFE-BACKDROP-30
    // stopped the client sending one, this file honoured `req.systemInstruction`
    // and nothing else, and so every backdrop the harness has drawn since was
    // drawn with no illustrator instruction at all — while the mark scheme went
    // on scoring those SVGs. Asserting it so the fix cannot quietly regress.
    expect(built?.systemInstruction).toBe(BACKDROP_SYSTEM_INSTRUCTION);
    expect(built?.systemInstruction).toContain('SHAPE BUDGET');
  });

  it('SRV-PROMPT-13 — a call with no spec is untouched', async () => {
    const { resolveServerBuiltPrompt } = await import('./transport');
    expect(await resolveServerBuiltPrompt({ prompt: 'raw prose' })).toBeNull();
  });

  it('SRV-PROMPT-13 — an unwired kind THROWS rather than posting an empty prompt', async () => {
    // ⚠ THIS CASE HAS NOW RUN OUT OF REAL EXAMPLES, and that is worth stating
    // rather than quietly deleting. It named `life_npc_profile` until batch 2
    // wired it, then `life_step` until batch 8 wired the last one — so every
    // kind the resolver owns is wired, and the only unwired kind is a
    // hypothetical. It is asserted with an invented one BECAUSE the throw is
    // what makes the roster test above load-bearing: without it, a kind added
    // to `isServerOwnedKind` and forgotten here would post an empty prompt and
    // the benchmark would score nothing (LIFE-BACKDROP-30, twice).
    const { resolveServerBuiltPrompt } = await import('./transport');
    await expect(
      resolveServerBuiltPrompt({ prompt: '', promptSpec: { kind: 'life_not_a_real_kind' } }),
    ).rejects.toThrow(/no server-prompt builder wired/);
  });

  // ── SRV-PROMPT-8..13 batch 2 — the three portrait/profile kinds ──────────
  //
  // `generateNpcProfile` is driven directly by `playWorld.ts` and its output is
  // read by the rubric, so an empty prompt here would score a profile the model
  // was never asked for. The two avatar kinds are not on the harness's own
  // path today, but they resolve through the same seam and wiring them costs
  // one table entry each — the alternative is the next person discovering the
  // throw above at the least convenient moment.

  it('SRV-PROMPT-13 — a life_npc_profile spec builds the SERVER pair', async () => {
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { NPC_PROFILE_SYSTEM_INSTRUCTION, buildNpcProfileUserPrompt } = await import(
      '../../functions/src/prompts/lifeNpcProfile'
    );
    const spec = {
      kind: 'life_npc_profile',
      name: 'Madame Roux',
      role: 'The Handler',
      archetype: 'The Handler — a florist who delivers coded scripts.',
      worldVibe: 'theatrical espionage',
      sagaPremise: 'Jimothée is the city’s most beloved stage actor.',
    } as const;

    const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...spec } });
    expect(built?.prompt).toBe(buildNpcProfileUserPrompt({ ...spec }));
    expect(built?.prompt).toContain('<archetype>');
    expect(built?.systemInstruction).toBe(NPC_PROFILE_SYSTEM_INSTRUCTION);
    expect(built?.systemInstruction).toContain('SPOILER-FREE');
  });

  it('SRV-PROMPT-13 — a life_npc_avatar spec builds the DRAW pair', async () => {
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { NPC_AVATAR_SYSTEM_INSTRUCTION, buildNpcAvatarUserPrompt } = await import(
      '../../functions/src/prompts/lifeNpcAvatar'
    );
    const spec = {
      kind: 'life_npc_avatar',
      name: 'Madame Roux',
      role: 'florist',
      worldVibe: 'theatrical espionage',
    } as const;

    const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...spec } });
    expect(built?.prompt).toBe(buildNpcAvatarUserPrompt({ ...spec }));
    expect(built?.systemInstruction).toBe(NPC_AVATAR_SYSTEM_INSTRUCTION);
  });

  it('SRV-PROMPT-13 — a life_npc_avatar_params spec builds the PARTS pair, not the draw one', async () => {
    // The two avatar kinds share an input shape, so a table that mapped both to
    // the same builder would score the direct-draw prompt for every parts call
    // and nothing would say so.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { AVATAR_PARAMS_SYSTEM_INSTRUCTION, buildAvatarParamsUserPrompt } = await import(
      '../../functions/src/prompts/lifeAvatarParams'
    );
    const spec = {
      kind: 'life_npc_avatar_params',
      name: 'Madame Roux',
      role: 'florist',
      worldVibe: 'theatrical espionage',
    } as const;

    const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...spec } });
    expect(built?.prompt).toBe(buildAvatarParamsUserPrompt({ ...spec }));
    expect(built?.systemInstruction).toBe(AVATAR_PARAMS_SYSTEM_INSTRUCTION);
    expect(built?.systemInstruction).toContain('witchHat');
  });

  // ── SRV-PROMPT-8..13 batch 3 — the resume recap ──────────────────────────
  //
  // `life_world_arc`, the other half of batch 3, is deliberately NOT here: it
  // stopped at SRV-PROMPT-9's size gate and still sends its own prose, so the
  // seam's `req.prompt` path is still the right one for it.

  it('SRV-PROMPT-13 — a life_resume_recap spec builds the SERVER pair', async () => {
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { buildResumeRecapUserPrompt, resumeRecapSystemInstruction } = await import(
      '../../functions/src/prompts/lifeResumeRecap'
    );
    const spec = {
      kind: 'life_resume_recap',
      characterName: 'Marc',
      practiceLanguage: 'French',
      systemLanguage: 'English',
      chapter: { chapterNumber: 2, premise: 'PLANNER_PREMISE', playerTeaser: 'TEASER' },
      storyLines: ['You arrived in the town.'],
      events: [{ kind: 'beat', speaker: 'npc', speakerName: 'Sophie', practiceText: 'Salut !' }],
    } as const;

    const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...spec } });
    expect(built).not.toBeNull();
    expect(built?.prompt).toBe(buildResumeRecapUserPrompt({ ...spec }));
    expect(built?.prompt).toContain('<storySoFar>');
    // The SI is language-parameterised, so the seam must build it from the
    // spec's own languages rather than reach for a constant.
    expect(built?.systemInstruction).toBe(
      resumeRecapSystemInstruction({ systemLanguage: 'English', practiceLanguage: 'French' }),
    );
    expect(built?.systemInstruction).toMatch(/in English ONLY/);
  });

  // ── SRV-PROMPT-8..13 batch 3, second half — the world arc ────────────────
  //
  // `playWorld.ts` drives `runWorldArcGenerate` directly and every scene in the
  // run is generated against the chapter it returns, so an unwired kind here
  // would not merely mis-score one call — it would play the whole benchmark
  // against a chapter the model was never asked for.

  it('SRV-PROMPT-13 — a life_world_arc spec builds the SERVER pair', async () => {
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { buildWorldArcUserPrompt, worldArcSystemInstruction } = await import(
      '../../functions/src/prompts/lifeWorldArc'
    );
    const spec = {
      kind: 'life_world_arc',
      characterName: 'Marc',
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      worldSeedKey: 'city_life',
      situation: 'You have a room over the bakery.',
      fronts: [{ driverId: 'p1', agenda: 'Buying the lease.', resolved: null }],
      cast: [],
      chapterNumber: 2,
      previousArcs: [
        {
          chapterNumber: 1,
          premise: 'PLANNER_PREMISE',
          themes: ['ambition'],
          completedSceneMemories: [],
        },
      ],
    } as const;

    const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...spec } });
    expect(built).not.toBeNull();
    expect(built?.prompt).toBe(
      buildWorldArcUserPrompt(spec as unknown as Parameters<typeof buildWorldArcUserPrompt>[0]),
    );
    expect(built?.prompt).toContain('<previousChapters>');
    expect(built?.prompt).toContain('PLANNER_PREMISE');
    // Language-parameterised like the recap's, so the seam must build it from
    // the spec rather than reach for a constant.
    expect(built?.systemInstruction).toBe(
      worldArcSystemInstruction({ practiceLanguage: 'French', nativeLanguage: 'English' }),
    );
    expect(built?.systemInstruction).toContain('TWO REGISTERS');
  });

  it('SRV-PROMPT-13 — the arc seam honours the spec\'s language pair', async () => {
    const { resolveServerBuiltPrompt } = await import('./transport');
    const built = await resolveServerBuiltPrompt({
      prompt: '',
      promptSpec: {
        kind: 'life_world_arc',
        characterName: 'Marc',
        practiceLanguage: 'Japanese',
        nativeLanguage: 'German',
        worldSeedKey: 'city_life',
        fronts: [],
        cast: [],
        chapterNumber: 1,
        previousArcs: [],
      },
    });
    expect(built?.systemInstruction).toContain(
      'Practice language: Japanese. Native language: German.',
    );
  });

  it('SRV-PROMPT-13 — the recap seam honours the spec\'s system language', async () => {
    // A seam that hard-coded a language pair would score every world's recap
    // against the wrong output-language instruction while looking wired.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const built = await resolveServerBuiltPrompt({
      prompt: '',
      promptSpec: {
        kind: 'life_resume_recap',
        characterName: 'Marc',
        practiceLanguage: 'Japanese',
        systemLanguage: 'German',
        storyLines: [],
        events: [],
      },
    });
    expect(built?.systemInstruction).toMatch(/in German ONLY/);
    expect(built?.systemInstruction).toMatch(/learning Japanese/);
  });
});

/**
 * SRV-PROMPT-13 — batch 4's two kinds, and the ROSTER that stops the next batch
 * forgetting.
 *
 * `playWorld.ts` drives `runSceneOpen` for every scene of every world and
 * `runSceneClose` at the end of each. The close's output IS the saga history
 * the rubric reads back, so an unwired kind here would not mis-score one call —
 * it would score a benchmark whose entire world memory was written from an
 * empty prompt.
 */
describe('SRV-PROMPT-13 — the transport resolves the two scene kinds', () => {
  const OPEN_SPEC = {
    kind: 'life_scene_gen',
    characterName: 'Marc',
    practiceLanguage: 'French',
    situation: 'You have a room over the bakery.',
    cast: [
      { id: 'p1', name: 'Bébert', tier: 'principal', standing: 1, known: 'Runs the lock.', wants: 'w', nextMove: 'n' },
    ],
    fronts: [{ id: 'f1', driverId: 'p1', agenda: 'Buying the lease.' }],
    canon: [{ id: 'the-lock', name: 'The lock', note: 'the gate you fixed', scenesSince: 4 }],
    history: ['You arrived.'],
    sceneIndex: 5,
    needSign: ['f1'],
    ironyAvailable: [{ castId: 'p1', believes: 'the crate is safe' }],
    focus: { castId: 'p1', name: 'Bébert' },
    recentSubjects: ['the bread delivery'],
    chapterNumber: 1,
    chapterTurns: 14,
  } as const;

  const CLOSE_SPEC = {
    kind: 'life_scene',
    sceneLog: ['You: hello'],
    subject: 'the missing crate',
    atStake: 'the contract',
    cast: [{ id: 'p1', name: 'Bébert', tier: 'principal', standing: 1, wants: 'w', nextMove: 'n' }],
    fronts: [
      {
        id: 'f1',
        kind: 'obligation',
        driverId: 'p1',
        agenda: 'Buying the lease.',
        clock: { filled: 3, size: 8, consequence: 'the bakery is sold' },
      },
    ],
    realistic: true,
    objective: { id: 'o1', text: 'get the roster changed' },
  } as const;

  const SAGA_SPEC = {
    kind: 'life_saga',
    worldId: 'w-abc123',
    characterName: 'Marc',
    practiceLanguage: 'French',
    nativeLanguage: 'English',
    systemLanguage: 'English (British)',
    worldSeedKey: 'heist',
    worldMode: 'realistic',
  } as const;

  const BIO_SPEC = {
    kind: 'life_bio',
    characterName: 'Marc',
    practiceLanguage: 'French',
    nativeLanguage: 'English',
    worldSeedKey: 'heist',
    worldMode: 'realistic',
    story: {
      title: 'Le 14 rue Cendrillon',
      tone: 'wry, unhurried',
      situation: 'You have a room over the lock.',
      cast: [{ name: 'Bébert', known: 'Runs the roster office.' }],
      fronts: [{ agenda: 'The lease is being bought out.', resolved: null }],
    },
  } as const;

  const GRADED_SPEC = {
    kind: 'life_graded_question',
    plan: {
      kind: 'comprehension',
      npcUtterance: 'Le train part dans dix minutes.',
      speakerName: 'Sophie',
    },
    practiceLanguage: 'French',
    systemLanguage: 'English',
    difficulty: 3,
    recentTargets: ['bonjour'],
    scene: {
      sagaTitle: 'The Whispering Resistance',
      locationLabel: 'Underground bunker',
      recentBeats: ['The lamp went out.'],
    },
  } as const;

  it('SRV-PROMPT-13 — a life_graded_question spec builds the GRADED pair', async () => {
    // Not optional cover. `playWorld.ts` drives `runGradedQuestionGenerate` for
    // every graded turn and the mark scheme scores QUESTION-VALUE and Q-TIMING
    // directly, so an unwired kind here would score every question in the
    // benchmark against an empty prompt.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { buildGradedQuestionPrompt, gradedQuestionSystemInstruction } = await import(
      '../../functions/src/prompts/lifeGradedQuestion'
    );
    const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...GRADED_SPEC } });
    expect(built).not.toBeNull();
    expect(built?.prompt).toBe(
      buildGradedQuestionPrompt(
        GRADED_SPEC as unknown as Parameters<typeof buildGradedQuestionPrompt>[0],
      ),
    );
    expect(built?.prompt).toContain('<direction speaker="npc" name="Sophie">');
    expect(built?.prompt).toContain('<recentlyPracticed><target>bonjour</target></recentlyPracticed>');
    expect(built?.systemInstruction).toBe(
      gradedQuestionSystemInstruction({
        practiceLanguage: 'French',
        systemLanguage: 'English',
        difficulty: 3,
      }),
    );
    expect(built?.systemInstruction).toContain('SPEAKER DIRECTION');
    // No schema, before this batch and after it — SRV-PROMPT-11's shape.
    expect(built?.responseSchema).toBeUndefined();
  });

  it('SRV-PROMPT-13 — the graded seam honours the spec\'s LANGUAGES and its DIFFICULTY', async () => {
    // Three parameters, not one. A seam that hard-coded the difficulty would
    // score every world's questions at one level while looking wired — and
    // LIFE-EX-14 makes the level govern how the LINE is said, which is the half
    // the rubric hears rather than reads.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const built = await resolveServerBuiltPrompt({
      prompt: '',
      promptSpec: { ...GRADED_SPEC, practiceLanguage: 'Japanese', systemLanguage: 'German', difficulty: 7 },
    });
    expect(built?.systemInstruction).toContain(
      'Practice language: Japanese. System (reading) language: German.',
    );
    expect(built?.systemInstruction).toContain('level 7/7');
    expect(built?.systemInstruction).not.toContain('level 3/7');
  });

  it('SRV-PROMPT-13 — the seam carries the RETRY verdict, not just the first attempt', async () => {
    // SRV-PROMPT-12's half of the harness. The client sends codes now, so a
    // seam that forwarded only the plan would drive the benchmark's second
    // attempt with NO hint while the app gives it a precise one — and a retry
    // that fails simply demotes, which is the quietest way for a harness to be
    // wrong.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const built = await resolveServerBuiltPrompt({
      prompt: '',
      promptSpec: {
        ...GRADED_SPEC,
        violations: [{ code: 'line-vocab-missing' }, { code: 'comprehension-question-empty' }],
      },
    });
    expect(built?.prompt).toContain('<violationHint>The previous attempt was rejected.');
    expect(built?.prompt).toContain('practicePrompt.lineVocab is REQUIRED');
    expect(built?.prompt).toContain('practicePrompt.question is empty');
  });

  it('SRV-PROMPT-13 — a life_bio spec builds the BIO pair', async () => {
    // Not optional cover. `playWorld.ts` calls `generateCharacterBio` for every
    // world and writes the result into `store.world.bio`, which every later
    // chapter-arc and step prompt in the run reads back — so an unwired kind
    // here would not mis-score one call, it would play the whole benchmark with
    // a character sheet the model was never asked to write.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { bioSystemInstruction, buildBioPrompt } = await import(
      '../../functions/src/prompts/lifeBio'
    );
    const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...BIO_SPEC } });
    expect(built).not.toBeNull();
    expect(built?.prompt).toBe(
      buildBioPrompt(BIO_SPEC as unknown as Parameters<typeof buildBioPrompt>[0]),
    );
    expect(built?.prompt).toContain('<world title="Le 14 rue Cendrillon"');
    expect(built?.prompt).toContain('<force>The lease is being bought out.</force>');
    expect(built?.systemInstruction).toBe(bioSystemInstruction('French'));
    // No schema, before this batch and after it — the bio's output contract is
    // prose inside the SI. Asserted so "returns none" reads as the decision it
    // is rather than as another forgotten forward (the batch-5 defect).
    expect(built?.responseSchema).toBeUndefined();
  });

  it("SRV-PROMPT-13 — the bio seam honours the spec's PRACTICE language", async () => {
    // The SI interpolates it. A seam that hard-coded a language would name
    // French cultural context in every benchmark world while looking wired —
    // the LIFE-BACKDROP-30 failure in a new costume, which batch 3's recap entry
    // already caught once.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const built = await resolveServerBuiltPrompt({
      prompt: '',
      promptSpec: { ...BIO_SPEC, practiceLanguage: 'Japanese' },
    });
    expect(built?.systemInstruction).toContain(
      'appropriate to the practice language: Japanese.',
    );
    expect(built?.systemInstruction).not.toContain('practice language: French.');
  });

  it('SRV-PROMPT-13 — a life_saga spec builds the WORLD-OPEN pair AND its schema', async () => {
    // ⚠ THE SCHEMA IS THE PART THAT WOULD HAVE GONE MISSING. `runSagaOpen` no
    // longer sends a `responseSchema` (SRV-PROMPT-1 moved it with the prompt),
    // and this seam posts `req.responseSchema` — so without resolving it here
    // the benchmark would generate every world under NO schema at all, while
    // the shipped app generates under a required-heavy one. LIFE-WORLD-SAGA-10
    // measured that difference: a model under a schema drops non-required fields
    // far more readily, which is why `playerFacingTeaser`, `goal` and
    // `wrongAbout` are required. Scoring the unconstrained output as if it were
    // the app's is the LIFE-BACKDROP-30 failure in its third costume.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { buildSagaOpenPrompt, sagaOpenResponseSchema, sagaOpenSystemInstruction } =
      await import('../../functions/src/prompts/lifeSagaOpen');
    const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...SAGA_SPEC } });
    expect(built).not.toBeNull();
    expect(built?.prompt).toBe(
      buildSagaOpenPrompt(SAGA_SPEC as unknown as Parameters<typeof buildSagaOpenPrompt>[0]),
    );
    expect(built?.prompt).toContain('<texture>');
    expect(built?.systemInstruction).toBe(
      sagaOpenSystemInstruction({
        practiceLanguage: 'French',
        systemLanguage: 'English (British)',
        succession: false,
        realistic: true,
      }),
    );
    expect(built?.responseSchema).toEqual(sagaOpenResponseSchema(false));
  });

  it('SRV-PROMPT-13 — the saga seam FORKS with the payload, on all three halves', async () => {
    // The seam resolves the same derived bit the server does. A table that
    // hard-coded the new-world arm would ask a succession to re-invent its own
    // universe and score the result as authorship.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { sagaOpenResponseSchema } = await import('../../functions/src/prompts/lifeSagaOpen');
    const succ = await resolveServerBuiltPrompt({
      prompt: '',
      promptSpec: {
        ...SAGA_SPEC,
        universe: { setting: 'A canal town', era: 'now', laws: [], places: [] },
      },
    });
    expect(succ?.systemInstruction).toContain('THIS IS A SUCCESSION.');
    expect(succ?.prompt).toContain('<universe FIXED="true">');
    expect(succ?.responseSchema).toEqual(sagaOpenResponseSchema(true));
    // …and LIFE-FRONT-6's register fork, read off `worldMode` as the server
    // reads it.
    const fantasy = await resolveServerBuiltPrompt({
      prompt: '',
      promptSpec: { ...SAGA_SPEC, worldMode: 'fantasy' },
    });
    expect(fantasy?.systemInstruction).toContain('REGISTER — FANTASY.');
  });

  it('SRV-PROMPT-13 — every seam entry that HAS a schema returns it', async () => {
    // Batches 2 and 4 moved a response schema with their prompt
    // (`life_npc_profile`, `life_scene_gen`, `life_scene`) and this seam did not
    // forward one, so the harness has been driving all three unconstrained. Found
    // while wiring batch 5, fixed here rather than walked past.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { NPC_PROFILE_RESPONSE_SCHEMA } = await import(
      '../../functions/src/prompts/lifeNpcProfile'
    );
    const { SCENE_OPEN_SCHEMA } = await import('../../functions/src/prompts/lifeSceneOpen');
    const { SCENE_CLOSE_SCHEMA } = await import('../../functions/src/prompts/lifeSceneClose');
    const profile = await resolveServerBuiltPrompt({
      prompt: '',
      promptSpec: { kind: 'life_npc_profile', name: 'Roux', worldVibe: 'noir' },
    });
    expect(profile?.responseSchema).toEqual(NPC_PROFILE_RESPONSE_SCHEMA);
    expect(
      (await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...OPEN_SPEC } }))
        ?.responseSchema,
    ).toEqual(SCENE_OPEN_SCHEMA);
    expect(
      (await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...CLOSE_SPEC } }))
        ?.responseSchema,
    ).toEqual(SCENE_CLOSE_SCHEMA);
    // …and the kinds whose answer is NOT JSON return none, so "has a schema" is
    // a decision rather than a default.
    const backdrop = await resolveServerBuiltPrompt({
      prompt: '',
      promptSpec: {
        kind: 'life_backdrop',
        locationType: 'market',
        vibe: 'modern_city',
        persistent: true,
        practice: 'French',
      },
    });
    expect(backdrop?.responseSchema).toBeUndefined();
  });

  it('SRV-PROMPT-13 — a life_scene_gen spec builds the PLANNER pair', async () => {
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { buildSceneOpenPrompt, sceneOpenSystemInstruction } = await import(
      '../../functions/src/prompts/lifeSceneOpen'
    );
    const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...OPEN_SPEC } });
    expect(built).not.toBeNull();
    expect(built?.prompt).toBe(
      buildSceneOpenPrompt(OPEN_SPEC as unknown as Parameters<typeof buildSceneOpenPrompt>[0]),
    );
    expect(built?.prompt).toContain('<makePerceivable>f1</makePerceivable>');
    expect(built?.prompt).toContain('<focus castId="p1">');
    expect(built?.systemInstruction).toBe(
      sceneOpenSystemInstruction({ practiceLanguage: 'French' }),
    );
    expect(built?.systemInstruction).toContain('THE OPEN QUESTION');
  });

  it("SRV-PROMPT-13 — the open seam honours the spec's practice language", async () => {
    // A seam that hard-coded a language would score every world's planner
    // against the wrong instruction while looking wired — the LIFE-BACKDROP-30
    // failure in a new costume, which batch 3's recap entry already caught once.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const built = await resolveServerBuiltPrompt({
      prompt: '',
      promptSpec: { ...OPEN_SPEC, practiceLanguage: 'Japanese' },
    });
    expect(built?.systemInstruction).toContain('everything in Japanese');
  });

  it('SRV-PROMPT-13 — a life_scene spec builds the CLOSE pair, not the planner one', async () => {
    // ⚠ The inverted-name trap. `life_scene` is the CLOSE. A table that mapped
    // it to the open would score bookkeeping as authorship and write every
    // history line in the run from a planner prompt.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const { buildSceneClosePrompt, sceneCloseSystemInstruction } = await import(
      '../../functions/src/prompts/lifeSceneClose'
    );
    const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...CLOSE_SPEC } });
    expect(built?.prompt).toBe(
      buildSceneClosePrompt(CLOSE_SPEC as unknown as Parameters<typeof buildSceneClosePrompt>[0]),
    );
    expect(built?.prompt).toContain('<whatHappened>');
    expect(built?.prompt).toContain('at="3/8"');
    expect(built?.systemInstruction).toBe(sceneCloseSystemInstruction({ realistic: true }));
    expect(built?.systemInstruction).toContain('YOUR FOUR JOBS');
  });

  it("SRV-PROMPT-13 — the close seam honours the spec's REGISTER", async () => {
    // LIFE-FRONT-6. A seam that ignored `realistic` would close a FANTASY world
    // under realistic rules — capping exactly the escalation the benchmark is
    // there to observe — and every SI would still look correctly wired.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const realistic = await resolveServerBuiltPrompt({ prompt: '', promptSpec: { ...CLOSE_SPEC } });
    const fantasy = await resolveServerBuiltPrompt({
      prompt: '',
      promptSpec: { ...CLOSE_SPEC, realistic: false },
    });
    expect(realistic?.systemInstruction).toContain('REGISTER — REALISTIC.');
    expect(fantasy?.systemInstruction).toContain('REGISTER — FANTASY.');
    expect(fantasy?.systemInstruction).not.toBe(realistic?.systemInstruction);
  });

  it('SRV-PROMPT-13 — the seam is wired for EVERY kind the resolver owns', async () => {
    // THE ROSTER. `resolveServerBuiltPrompt` throws on an unwired owned kind by
    // design, and that design is only worth anything if something enumerates
    // the owned set — otherwise the throw is discovered by a paid benchmark run
    // at the least convenient moment. This drives the real seam with a minimal
    // spec per kind and asserts none of them hits the throw.
    const { resolveServerBuiltPrompt } = await import('./transport');
    const minimalSpecs: Record<string, Record<string, unknown>> = {
      life_backdrop: { kind: 'life_backdrop', locationType: 'market', vibe: 'modern_city', persistent: true, practice: 'French' },
      life_npc_profile: { kind: 'life_npc_profile', name: 'Roux', worldVibe: 'noir' },
      life_npc_avatar: { kind: 'life_npc_avatar', name: 'Roux', worldVibe: 'noir' },
      life_npc_avatar_params: { kind: 'life_npc_avatar_params', name: 'Roux', worldVibe: 'noir' },
      life_resume_recap: { kind: 'life_resume_recap', characterName: 'Marc', practiceLanguage: 'French', systemLanguage: 'English', storyLines: [], events: [] },
      life_world_arc: { kind: 'life_world_arc', characterName: 'Marc', practiceLanguage: 'French', nativeLanguage: 'English', worldSeedKey: 'city_life', fronts: [], cast: [], chapterNumber: 1, previousArcs: [] },
      life_scene_gen: { ...OPEN_SPEC },
      life_scene: { ...CLOSE_SPEC },
      life_saga: { ...SAGA_SPEC },
      life_bio: { ...BIO_SPEC },
      life_graded_question: { ...GRADED_SPEC },
      life_step: {
        kind: 'life_step',
        practiceLanguage: 'French',
        nativeLanguage: 'English',
        systemLanguage: 'English',
        difficulty: 3,
        characterName: 'Marc',
        worldSeedKey: 'city_life',
        isOpeningBeat: true,
        requestKind: 'live',
        events: [],
      },
    };

    // The owned set comes from the RESOLVER, not from the keys above, so adding
    // a kind in batch 5 fails here instead of passing with a stale list.
    const { isServerOwnedKind } = await import('../../functions/src/prompts/serverPromptSpec');
    const LIFE_CATEGORIES = [
      'life_backdrop', 'life_bio', 'life_graded_question', 'life_npc_avatar',
      'life_npc_avatar_params', 'life_npc_profile', 'life_resume_recap', 'life_saga',
      'life_scene', 'life_scene_gen', 'life_step', 'life_world_arc',
    ];
    // ✅ ALL TWELVE after batch 8 — `life_step` was the last. Pinned as a COUNT
    // as well as a set, so a kind dropping out of `minimalSpecs` and out of the
    // resolver at the same time cannot keep this green with two holes that
    // cancel. ⚠ The count being complete says the PROMPTS moved; it says
    // nothing about enforcement, which SRV-PROMPT-8 keeps separate.
    expect(LIFE_CATEGORIES.filter((k) => isServerOwnedKind(k))).toHaveLength(12);
    const owned = LIFE_CATEGORIES.filter((k) => isServerOwnedKind(k));
    expect(owned.sort()).toEqual(Object.keys(minimalSpecs).sort());

    for (const kind of owned) {
      const built = await resolveServerBuiltPrompt({ prompt: '', promptSpec: minimalSpecs[kind]! });
      expect(built, kind).not.toBeNull();
      expect(built!.prompt.length, kind).toBeGreaterThan(0);
      expect((built!.systemInstruction ?? '').length, kind).toBeGreaterThan(0);
    }
  });

  it('SRV-PROMPT-13 — an unwired OWNED kind would still throw, so the roster is load-bearing', async () => {
    // The roster above is only meaningful because the seam still fails loudly.
    // Every real kind is wired after batch 8, so this drives an invented one —
    // the point is the THROW, not which kind is currently missing.
    const { resolveServerBuiltPrompt } = await import('./transport');
    await expect(
      resolveServerBuiltPrompt({ prompt: '', promptSpec: { kind: 'life_not_a_real_kind' } }),
    ).rejects.toThrow(/no server-prompt builder wired/);
  });
});
