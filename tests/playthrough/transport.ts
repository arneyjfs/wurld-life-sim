/**
 * THE TRANSPORT SEAM — how the harness drives the SHIPPED generators headlessly.
 *
 * ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
 *
 * The old harness rebuilt the engine: it constructed its own turn prompt from
 * `prompts/stepTurn.ts`, a module nothing in the app imported. So it scored a
 * program nobody ships — the one failure mode a benchmark must not have.
 * (That module was DELETED on 2026-09-18, once this seam had been the reason
 * nothing read it for long enough to be sure. Kept named here because it is the
 * defect this file exists to prevent, not because the file still exists.)
 *
 * The fix is not to copy the app's loop more carefully. It is to CALL the app's
 * loop. Every life generator turns out to be pure — `generateStepOptions`,
 * `runSagaOpen`, `runSceneOpen`, `runSceneClose`, `runGradedQuestionGenerate`,
 * `generateBackdrop`, `generateNpcProfile`, `generateCharacterBio` all take
 * plain data and return plain data. The only things standing between them and a
 * node process are Firebase auth and the Cloud Function hop, and neither is
 * what we are trying to measure.
 *
 * So this replaces exactly one module — `@/lib/gemini` — with a direct API
 * call. Everything above it stays real: the real prompt builders, the real
 * response schemas, the real Zod parsers, the real retry ladders, the real
 * repair passes. What the harness measures is what the app does, because it IS
 * what the app does, minus one HTTP hop.
 *
 * ── WHY THIS SEAM AND NOT A HIGHER ONE ──────────────────────────────────────
 *
 * Mocking higher (say, stubbing `generateStepOptions`) would measure nothing.
 * Mocking lower is impossible — there is nothing below the network. `generateGemini`
 * is the last point where the app's own logic ends and Google's begins, which
 * makes it the only honest place to cut.
 *
 * ── EVERY CALL IS RECORDED ──────────────────────────────────────────────────
 *
 * The judge sees only what a player would see. Diagnosis needs everything else:
 * which prompt produced which output, how long it took, what it cost, which
 * attempt it was. `calls()` returns the full log so a bad score can be traced
 * to the generation that caused it — the "collect logs on everything else"
 * half of the benchmark.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');

function apiKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv) return fromEnv;
  const raw = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const line = raw.split('\n').find((l) => l.startsWith('GEMINI_API_KEY='));
  if (!line) throw new Error('GEMINI_API_KEY not found in env or .env.local');
  return line.slice('GEMINI_API_KEY='.length).trim();
}

/** List price per 1M tokens, USD — an order-of-magnitude spend guard, not billing. */
const PRICE_IN_PER_M = 0.1;
const PRICE_OUT_PER_M = 0.4;

export type CallRecord = {
  seq: number;
  /** The app's own telemetry bucket — `life_step`, `life_saga`, `life_backdrop`… */
  category: string;
  model: string;
  attempt: number;
  ms: number;
  inTokens: number;
  outTokens: number;
  systemInstruction: string;
  prompt: string;
  response: string;
  error: string | null;
};

const log: CallRecord[] = [];
let seq = 0;

export function calls(): readonly CallRecord[] {
  return log;
}

export function totals(): { calls: number; inTokens: number; outTokens: number; usd: number } {
  const inTokens = log.reduce((a, c) => a + c.inTokens, 0);
  const outTokens = log.reduce((a, c) => a + c.outTokens, 0);
  return {
    calls: log.length,
    inTokens,
    outTokens,
    usd: (inTokens / 1e6) * PRICE_IN_PER_M + (outTokens / 1e6) * PRICE_OUT_PER_M,
  };
}

export function assertBudget(ceilingUsd: number): void {
  const { usd, calls: n } = totals();
  if (usd > ceilingUsd) {
    throw new Error(
      `playthrough budget exceeded: $${usd.toFixed(3)} > $${ceilingUsd.toFixed(2)} after ${n} calls`,
    );
  }
}

/** Per-category counts + spend, for the diagnostic report. */
export function byCategory(): Record<string, { calls: number; usd: number; failures: number }> {
  const out: Record<string, { calls: number; usd: number; failures: number }> = {};
  for (const c of log) {
    const row = (out[c.category] ??= { calls: 0, usd: 0, failures: 0 });
    row.calls += 1;
    row.usd += (c.inTokens / 1e6) * PRICE_IN_PER_M + (c.outTokens / 1e6) * PRICE_OUT_PER_M;
    if (c.error) row.failures += 1;
  }
  return out;
}

type Req = {
  prompt: string;
  model?: string;
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  responseMimeType?: 'application/json' | 'text/plain';
  responseSchema?: unknown;
  systemInstruction?: string;
  temperature?: number;
  category?: string;
  attempt?: number;
  /** SRV-PROMPT-8..13 — set on a call whose prompt the SERVER builds. */
  promptSpec?: Record<string, unknown>;
};

/**
 * SRV-PROMPT-13 — THE HARNESS MOVES WITH THE PROMPTS.
 *
 * This seam replaces `@/lib/gemini` and posts `req.prompt` / `req.systemInstruction`
 * straight to Gemini, bypassing the Cloud Function. That is the whole point —
 * it measures the shipped generators, not the transport. But it means every
 * prompt that migrates server-side disappears from what this file can see: the
 * client sends `prompt: ''` and a `promptSpec`, so without this table the
 * harness would post an EMPTY prompt and score the result.
 *
 * ⚠ THAT HAD ALREADY HAPPENED, before this batch, and nothing caught it.
 * `LIFE-BACKDROP-30` moved the backdrop SYSTEM INSTRUCTION server-side and the
 * client stopped sending one. This file honours `req.systemInstruction` and
 * nothing else, so every backdrop the harness has drawn since then was drawn
 * with NO illustrator instruction at all — no output format, no shape budget,
 * no dialogue-overlay safe area — while `markScheme.ts` went on scoring those
 * SVGs against the scene prose. Resolving the spec here fixes that at the same
 * time, which is the honest reason this batch touches the harness rather than
 * only the prompt.
 *
 * Pointed at `functions/src/prompts/` per SRV-PROMPT-13. One LEAF module per
 * kind rather than `resolveServerPrompt` itself: the resolver pulls in the
 * whole practice prompt graph, and this table has to stay cheap enough that the
 * next batch actually extends it.
 *
 * ⚠ IT RESOLVES THE RESPONSE SCHEMA TOO, and until batch 5 it did not. That was
 * the SAME DEFECT in a third costume: batches 2 and 4 moved a schema with their
 * prompt (SRV-PROMPT-1 — `life_npc_profile`, `life_scene_gen`, `life_scene`),
 * the clients stopped sending one, and this seam forwarded only
 * `req.responseSchema` — so every profile and every scene the harness has
 * generated since batch 2 ran with NO schema at all while the shipped app ran
 * with a required-heavy one. `LIFE-WORLD-SAGA-10` measured exactly that
 * difference: under a schema a model drops non-required fields far more readily,
 * which is why `playerFacingTeaser`, `goal`, `gender` and `wrongAbout` are
 * required in the first place. Found while wiring `life_saga`, whose schema is
 * DERIVED and therefore could not be sent from the client at all; fixed for
 * every kind rather than only the new one.
 */
export async function resolveServerBuiltPrompt(
  req: Pick<Req, 'promptSpec' | 'prompt' | 'systemInstruction'>,
): Promise<{
  prompt: string;
  systemInstruction: string | undefined;
  responseSchema?: unknown;
} | null> {
  const spec = req.promptSpec;
  if (!spec) return null;
  if (spec.kind === 'life_backdrop') {
    const { BACKDROP_SYSTEM_INSTRUCTION, buildBackdropUserPrompt } = await import(
      '../../functions/src/prompts/lifeBackdrop'
    );
    return {
      systemInstruction: BACKDROP_SYSTEM_INSTRUCTION,
      prompt: buildBackdropUserPrompt(spec as unknown as Parameters<typeof buildBackdropUserPrompt>[0]),
    };
  }
  // SRV-PROMPT-8..13 batch 2 — the three portrait/profile kinds.
  //
  // `generateNpcProfile` is on the harness's own path (`playWorld.ts` calls it
  // directly and the rubric reads the result), so leaving it unwired would have
  // scored a profile the model was never asked for. The two avatar kinds are
  // not driven by the harness today; they are wired anyway because they resolve
  // through the same seam and the entry costs one branch — the alternative is
  // discovering the throw below at the least convenient moment.
  if (spec.kind === 'life_npc_profile') {
    const {
      NPC_PROFILE_RESPONSE_SCHEMA,
      NPC_PROFILE_SYSTEM_INSTRUCTION,
      buildNpcProfileUserPrompt,
    } = await import('../../functions/src/prompts/lifeNpcProfile');
    return {
      systemInstruction: NPC_PROFILE_SYSTEM_INSTRUCTION,
      prompt: buildNpcProfileUserPrompt(
        spec as unknown as Parameters<typeof buildNpcProfileUserPrompt>[0],
      ),
      // SRV-PROMPT-1 — the schema moved with the prompt in batch 2, and this
      // line did not follow it until batch 5.
      responseSchema: NPC_PROFILE_RESPONSE_SCHEMA,
    };
  }
  if (spec.kind === 'life_npc_avatar') {
    const { NPC_AVATAR_SYSTEM_INSTRUCTION, buildNpcAvatarUserPrompt } = await import(
      '../../functions/src/prompts/lifeNpcAvatar'
    );
    return {
      systemInstruction: NPC_AVATAR_SYSTEM_INSTRUCTION,
      prompt: buildNpcAvatarUserPrompt(
        spec as unknown as Parameters<typeof buildNpcAvatarUserPrompt>[0],
      ),
    };
  }
  if (spec.kind === 'life_npc_avatar_params') {
    // NOT the same builder as `life_npc_avatar`, despite the shared input
    // shape. Mapping both to the draw prompt would have the harness score the
    // ~8x dearer prompt for every parts call with nothing saying so.
    const { AVATAR_PARAMS_SYSTEM_INSTRUCTION, buildAvatarParamsUserPrompt } = await import(
      '../../functions/src/prompts/lifeAvatarParams'
    );
    return {
      systemInstruction: AVATAR_PARAMS_SYSTEM_INSTRUCTION,
      prompt: buildAvatarParamsUserPrompt(
        spec as unknown as Parameters<typeof buildAvatarParamsUserPrompt>[0],
      ),
    };
  }
  // SRV-PROMPT-8..13 batch 3 — the resume recap.
  //
  // The FIRST entry whose SYSTEM INSTRUCTION is not a constant: it interpolates
  // the world's system and practice languages, so the seam has to build it from
  // the spec rather than re-export a global. A table that reached for a constant
  // here would score every world's recap against the wrong output-language
  // instruction while looking correctly wired — the LIFE-BACKDROP-30 failure in
  // a new costume.
  //
  if (spec.kind === 'life_resume_recap') {
    const { buildResumeRecapUserPrompt, resumeRecapSystemInstruction } = await import(
      '../../functions/src/prompts/lifeResumeRecap'
    );
    const input = spec as unknown as Parameters<typeof buildResumeRecapUserPrompt>[0];
    return {
      systemInstruction: resumeRecapSystemInstruction({
        systemLanguage: input.systemLanguage,
        practiceLanguage: input.practiceLanguage,
      }),
      prompt: buildResumeRecapUserPrompt(input),
    };
  }
  // SRV-PROMPT-8..13 batch 3, SECOND HALF — the chapter arc, which landed one
  // change after the recap because it failed SRV-PROMPT-9's size gate first.
  //
  // This entry is not optional cover the way the two avatar kinds were.
  // `playWorld.ts` calls `runWorldArcGenerate` directly and then generates every
  // scene of the run against the chapter it returns — so an unwired kind here
  // would not mis-score one call, it would play the whole benchmark against a
  // chapter the model was never asked for, and the rubric would score the
  // result as authorship.
  if (spec.kind === 'life_world_arc') {
    const { buildWorldArcUserPrompt, worldArcSystemInstruction } = await import(
      '../../functions/src/prompts/lifeWorldArc'
    );
    const input = spec as unknown as Parameters<typeof buildWorldArcUserPrompt>[0];
    return {
      // Language-parameterised like the recap's, so it is built from the spec
      // rather than re-exported as a constant.
      systemInstruction: worldArcSystemInstruction({
        practiceLanguage: input.practiceLanguage,
        nativeLanguage: input.nativeLanguage,
      }),
      prompt: buildWorldArcUserPrompt(input),
    };
  }
  // SRV-PROMPT-8..13 batch 4 — the two ends of a SCENE.
  //
  // ⚠ `life_scene` is the CLOSE and `life_scene_gen` is the OPEN. Inverted-
  // looking, not a typo — the wire values the client has always sent. Mapping
  // either to the other's builder would be the `life_npc_avatar` /
  // `life_npc_avatar_params` mistake with far more at stake: `playWorld.ts`
  // drives BOTH directly, so the open would be scored against a bookkeeping
  // prompt and every history line in the run would come from a planner.
  //
  // Neither entry is optional cover. `playWorld.ts` calls `runSceneOpen` for
  // every scene of every world and `runSceneClose` at the end of each, and the
  // close's output IS the saga history the rubric reads back — so an unwired
  // kind here would not mis-score one call, it would score a benchmark whose
  // whole memory was written from an empty prompt.
  if (spec.kind === 'life_scene_gen') {
    const { buildSceneOpenPrompt, sceneOpenSystemInstruction, SCENE_OPEN_SCHEMA } = await import(
      '../../functions/src/prompts/lifeSceneOpen'
    );
    const input = spec as unknown as Parameters<typeof buildSceneOpenPrompt>[0];
    return {
      // Language-parameterised like the recap's and the arc's, so it is built
      // from the spec rather than re-exported as a constant. A table that
      // reached for a global here would score every world against the wrong
      // output-language instruction while looking correctly wired.
      systemInstruction: sceneOpenSystemInstruction({
        practiceLanguage: input.practiceLanguage,
      }),
      prompt: buildSceneOpenPrompt(input),
      responseSchema: SCENE_OPEN_SCHEMA,
    };
  }
  if (spec.kind === 'life_scene') {
    const { buildSceneClosePrompt, sceneCloseSystemInstruction, SCENE_CLOSE_SCHEMA } =
      await import('../../functions/src/prompts/lifeSceneClose');
    const input = spec as unknown as Parameters<typeof buildSceneClosePrompt>[0];
    return {
      // Parameterised on a BOOLEAN rather than a language (LIFE-FRONT-6), and
      // it is the field that decides what the close may escalate to. Reading it
      // off the spec is what keeps a FANTASY world from being closed under
      // REALISTIC rules in the benchmark and nowhere else.
      systemInstruction: sceneCloseSystemInstruction({
        realistic: (spec as { realistic?: boolean }).realistic === true,
      }),
      prompt: buildSceneClosePrompt(input),
      responseSchema: SCENE_CLOSE_SCHEMA,
    };
  }
  // SRV-PROMPT-8..13 batch 5 — the WORLD OPEN.
  //
  // ⚠ THE ONLY ENTRY WHOSE SCHEMA THE CLIENT COULD NOT SEND EVEN IF IT WANTED
  // TO. `sagaOpenResponseSchema` forks on whether the world already has a
  // universe, and SRV-PROMPT-1 moved that derivation server-side with the
  // prompt — so the seam has to re-derive the same bit from the spec. All three
  // artefacts read ONE expression here, as `buildLifeSagaOpen` does, because a
  // seam that paired a succession prompt with a new-world schema would ask the
  // model to re-invent a universe it was told was fixed, and the rubric would
  // score the result as authorship.
  //
  // Not optional cover: `playWorld.ts` calls `runSagaOpen` for every world in
  // the benchmark, and its cast, front and situation are what every later call
  // in the run is generated from.
  if (spec.kind === 'life_saga') {
    const { buildSagaOpenPrompt, sagaOpenResponseSchema, sagaOpenSystemInstruction } =
      await import('../../functions/src/prompts/lifeSagaOpen');
    const input = spec as unknown as Parameters<typeof buildSagaOpenPrompt>[0];
    const succession = input.universe !== undefined;
    return {
      systemInstruction: sagaOpenSystemInstruction({
        practiceLanguage: input.practiceLanguage,
        // LIFE-LANG-8 — already resolved at the call site, so the seam reads it
        // rather than re-applying the fallback and disagreeing with the server.
        systemLanguage: (spec as { systemLanguage?: string }).systemLanguage ?? '',
        succession,
        // LIFE-FRONT-6 — derived from `worldMode`, exactly as the server derives
        // it. A seam that hard-coded either would open every benchmark world in
        // the wrong register while looking correctly wired.
        realistic: (spec as { worldMode?: string }).worldMode === 'realistic',
      }),
      prompt: buildSagaOpenPrompt(input),
      responseSchema: sagaOpenResponseSchema(succession),
    };
  }
  // SRV-PROMPT-8..13 batch 6 — the character BIO.
  //
  // Not optional cover. `playWorld.ts` calls `generateCharacterBio` for every
  // world and writes the result into `store.world.bio`, which the chapter arc
  // and every step prompt in the run read back as the character sheet — so an
  // unwired kind here would not mis-score one call, it would play the whole
  // benchmark with a character the model was never asked to write.
  //
  // Language-parameterised like the recap's, the arc's and the scene open's, so
  // it is built from the spec rather than re-exported as a constant: the SI
  // names the cultural context to draw the bio's people and places from, and a
  // seam that reached for a global here would give every benchmark world French
  // names while looking correctly wired.
  //
  // No `responseSchema`, and that is the DECISION rather than another forgotten
  // forward (the defect batch 5 found in three other entries): this call has
  // never sent one, its output contract is prose inside the SI, and `ZBio`
  // defends against the answer.
  if (spec.kind === 'life_bio') {
    const { bioSystemInstruction, buildBioPrompt } = await import(
      '../../functions/src/prompts/lifeBio'
    );
    const input = spec as unknown as Parameters<typeof buildBioPrompt>[0];
    return {
      systemInstruction: bioSystemInstruction(input.practiceLanguage),
      prompt: buildBioPrompt(input),
    };
  }
  // SRV-PROMPT-8..13 batch 7 — the GRADED QUESTION.
  //
  // Not optional cover. `playWorld.ts` drives `runGradedQuestionGenerate` for
  // every graded turn, and QUESTION-VALUE / Q-TIMING are dimensions the mark
  // scheme scores directly — so an unwired kind here would score every question
  // in the benchmark against an empty prompt and read as the model being unable
  // to write one.
  //
  // ⚠ THE RETRY IS THE PART THAT WOULD HAVE GONE MISSING (SRV-PROMPT-12). The
  // client no longer renders `violationHint`; it sends CODES, and the server
  // writes the sentences. A seam that forwarded only the plan would drive the
  // benchmark's SECOND attempt with no hint at all — the model told nothing
  // about why it was rejected — while the app tells it precisely. That is the
  // LIFE-BACKDROP-30 failure aimed at the half of the ladder a benchmark is
  // least likely to notice, because a retry that fails simply demotes.
  //
  // Language-parameterised like the recap's and the bio's, and DIFFICULTY-
  // parameterised too: the SI bands both the tested target and how the line is
  // said (LIFE-EX-14), so a seam reaching for a constant would score every
  // world's questions at one level while looking correctly wired.
  if (spec.kind === 'life_graded_question') {
    const { buildGradedQuestionPrompt, gradedQuestionSystemInstruction } = await import(
      '../../functions/src/prompts/lifeGradedQuestion'
    );
    const input = spec as unknown as Parameters<typeof buildGradedQuestionPrompt>[0];
    return {
      systemInstruction: gradedQuestionSystemInstruction({
        practiceLanguage: (spec as { practiceLanguage?: string }).practiceLanguage ?? '',
        // LIFE-LANG-8 / LIFE-CTX-3 — already resolved at the call site, so the
        // seam reads them rather than re-applying the fallbacks and disagreeing
        // with the server.
        systemLanguage: (spec as { systemLanguage?: string }).systemLanguage ?? '',
        difficulty: (spec as { difficulty?: number }).difficulty ?? 0,
      }),
      prompt: buildGradedQuestionPrompt(input),
      // No `responseSchema`, and that is the DECISION rather than another
      // forgotten forward: this call has never sent one, and half its rules
      // govern fields a schema would make the model drop (LIFE-WORLD-SAGA-10).
    };
  }
  // SRV-PROMPT-8..13 batch 8 — the TURN PROMPT, and the entry this whole seam
  // was written for.
  //
  // `playWorld.ts` drives `generateStepOptions` for every turn of every world
  // in the benchmark. It is 88% of life-sim spend and the source of every beat
  // the rubric reads, so an unwired kind here would not mis-score one call — it
  // would score an entire playthrough generated from an empty prompt, and every
  // narrative dimension would read as the model being unable to write.
  //
  // FOUR-PARAMETER SI, which is one more than any previous entry: practice,
  // native and system language AND difficulty. The level ladder renders only
  // the player's own band (LIFE-LANG-9.1), so a seam that reached for a
  // constant would score every world at one level while looking correctly
  // wired — the LIFE-BACKDROP-30 failure aimed at the rule that governs how
  // hard the language is.
  //
  // ⚠ AND THE RETRY IS THE HALF A BENCHMARK IS LEAST LIKELY TO NOTICE
  // (SRV-PROMPT-12). The client no longer builds `retryHint`; it sends CODES,
  // and `buildLifeStepPrompt` appends the rendered block as its last section. A
  // seam that forwarded only the first attempt would drive every SECOND attempt
  // with no hint at all — and a failed retry just snags the turn, which reads
  // as flakiness rather than as a harness defect.
  //
  // No `responseSchema`, and that is the DECISION rather than another forgotten
  // forward (the defect batch 5 found in three entries): `life_step` has never
  // sent one and must not acquire one — LIFE-CTX-15 measured a schema on this
  // call as runaway generation, dropped optional objects and narrative output
  // halved.
  if (spec.kind === 'life_step') {
    const { buildLifeStepPrompt, lifeStepSystemInstruction } = await import(
      '../../functions/src/prompts/lifeStep'
    );
    const { renderStepRetryHint } = await import(
      '../../functions/src/prompts/lifeStepViolations'
    );
    const input = spec as unknown as Parameters<typeof buildLifeStepPrompt>[0] & {
      retry?: Parameters<typeof renderStepRetryHint>[0];
    };
    return {
      systemInstruction: lifeStepSystemInstruction({
        practiceLanguage: (spec as { practiceLanguage?: string }).practiceLanguage ?? '',
        nativeLanguage: (spec as { nativeLanguage?: string }).nativeLanguage ?? '',
        // LIFE-LANG-7 — already resolved at the call site, so the seam reads it
        // rather than re-applying the fallback and disagreeing with the server.
        systemLanguage: (spec as { systemLanguage?: string }).systemLanguage ?? '',
        difficulty: (spec as { difficulty?: number }).difficulty ?? 0,
      }),
      prompt: buildLifeStepPrompt({
        ...input,
        // SRV-PROMPT-12 — the codes become the block the server would append.
        retryHint: renderStepRetryHint(input.retry ?? []),
      }),
    };
  }
  // Fails loudly rather than posting an empty prompt. A silently-empty call is
  // what this function exists to prevent, and a missing entry is a migration
  // that forgot step 0 of SRV-PROMPT-13.
  throw new Error(
    `playthrough transport: no server-prompt builder wired for promptSpec.kind=${String(spec.kind)}`,
  );
}

/**
 * The thinking knob, mapped EXACTLY as `functions/src/index.ts` maps it.
 *
 * Gemini 3.x takes a categorical `thinkingLevel`; 2.x takes a numeric
 * `thinkingBudget`. It is a family-generation split, not a lite/non-lite one.
 * `includeThoughts` is kept on both paths, as production does.
 *
 * This mapping is not a detail. Getting it wrong sends a different generation
 * config than the app sends, which means measuring a different program — and
 * it fails loudly rather than quietly: `gemini-3.5-flash-lite` rejects
 * `thinkingBudget: 0` outright with a 400, which is how this was found.
 */
function thinkingConfig(model: string, level: string): Record<string, unknown> {
  if (model.startsWith('gemini-3')) {
    return { thinkingLevel: level, includeThoughts: true };
  }
  const budget: Record<string, number> = { minimal: 0, low: 512, medium: 2048, high: 8192 };
  return { thinkingBudget: budget[level] ?? -1, includeThoughts: true };
}

/**
 * A drop-in `generateGemini`. Same signature, same return (raw text), same
 * error shape — so every caller's retry ladder and repair pass behaves as it
 * does in production.
 */
export async function generateGemini(req: Req): Promise<string> {
  const model = req.model ?? 'gemini-3.1-flash-lite';
  const mime = req.responseMimeType ?? 'application/json';
  const started = Date.now();
  // SRV-PROMPT-13 — a spec-carrying call has its pair built from
  // `functions/src/prompts/`, exactly as `resolveServerPrompt` would. Recorded
  // as the BUILT text, so the rubric and conformance scorers keep reading the
  // prompt the model actually ran rather than the empty string the client sent.
  const serverBuilt = await resolveServerBuiltPrompt(req);
  const effectivePrompt = serverBuilt?.prompt ?? req.prompt;
  const effectiveSi = serverBuilt?.systemInstruction ?? req.systemInstruction;
  // SRV-PROMPT-1 — a server-built call's schema comes from the server too. The
  // client sends none, so without this the harness generates unconstrained while
  // the app generates under a required-heavy schema, and the rubric scores the
  // difference as quality.
  const effectiveSchema = serverBuilt?.responseSchema ?? req.responseSchema;
  const rec: CallRecord = {
    seq: (seq += 1),
    category: req.category ?? 'uncategorised',
    model,
    attempt: req.attempt ?? 0,
    ms: 0,
    inTokens: 0,
    outTokens: 0,
    systemInstruction: effectiveSi ?? '',
    prompt: effectivePrompt,
    response: '',
    error: null,
  };

  const body: Record<string, unknown> = {
    ...(effectiveSi ? { systemInstruction: { parts: [{ text: effectiveSi }] } } : {}),
    contents: [{ role: 'user', parts: [{ text: effectivePrompt }] }],
    generationConfig: {
      ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
      // text/plain is load-bearing: the BACKDROP generator returns raw SVG, and
      // forcing JSON there (as the old harness did unconditionally) turns a
      // working generator into a parse failure that looks like a quality problem.
      responseMimeType: mime,
      ...(mime === 'application/json' && effectiveSchema
        ? { responseSchema: effectiveSchema }
        : {}),
      ...(req.thinkingLevel
        ? { thinkingConfig: thinkingConfig(model, req.thinkingLevel) }
        : {}),
    },
  };

  const backoffs = [500, 1500, 4000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= backoffs.length; attempt += 1) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          thoughtsTokenCount?: number;
        };
      };
      // `p.thought !== true` mirrors functions/src/index.ts:882. `includeThoughts`
      // is on (as production has it), so the response carries REASONING parts
      // alongside the answer — concatenating them prepends the model's thinking
      // to its own output, which silently corrupts every non-JSON generator.
      // The backdrop SVG failed its sanitiser this way before the filter existed.
      const text =
        json.candidates?.[0]?.content?.parts
          ?.filter((p) => p.thought !== true && typeof p.text === 'string')
          .map((p) => p.text ?? '')
          .join('') ?? '';
      rec.inTokens = json.usageMetadata?.promptTokenCount ?? 0;
      // LIFE-COST-2: thinking tokens bill at the OUTPUT rate, so a cost figure
      // that ignores them under-reports exactly where thinking is most used.
      rec.outTokens =
        (json.usageMetadata?.candidatesTokenCount ?? 0) +
        (json.usageMetadata?.thoughtsTokenCount ?? 0);
      rec.ms = Date.now() - started;
      rec.response = text;
      if (!text.trim()) throw new Error('empty response');
      log.push(rec);
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt === backoffs.length) break;
      await new Promise((r) => setTimeout(r, backoffs[attempt]!));
    }
  }
  rec.ms = Date.now() - started;
  rec.error = String(lastErr);
  log.push(rec);
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** Between worlds, so per-world reports are not cumulative. */
export function resetCallLog(): void {
  log.length = 0;
  seq = 0;
}
