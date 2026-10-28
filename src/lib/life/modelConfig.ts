/**
 * Single source of truth for the Gemini model the life-sim uses.
 * Mirrors `src/lib/practiceGenerator/modelConfig.ts` so a future
 * model bump touches one file.
 *
 * Gemini 3 Flash Preview is the chosen tier — newer than the
 * gemini-2.5 line and on the same preview track the practice
 * planner already runs on. Same model ID is used for the SVG-gen
 * call AND the per-turn lifeStep call; if we later split them
 * (e.g. lifeStep on Flash, SVG on Pro), this file is the place.
 */
/** Per the 2026-06-01 perf iteration: switched from
 *  gemini-3-flash-preview → gemini-3.1-flash-lite (matches the
 *  model the tutor + practice generator already use). Lower
 *  latency per turn; still capable enough for the structured
 *  life-step JSON + the SVG backdrop gen. If quality regresses we
 *  can split: lite for lifeStep, full flash for backdrop gen
 *  (LIFE_BACKDROP_MODEL). */
export const LIFE_PRIMARY_MODEL = 'gemini-3.1-flash-lite';

/** LIFE-SCENE-6 / LIFE-WORLD-ARC-*: one-shot generation calls
 *  (scene outline, world arc / chapter). Stays on flash-lite to
 *  match the Cloud Function's model whitelist.
 *
 *  These call sites USED to compensate for the smaller model by
 *  cranking thinking to 'high' — rare one-shots, so the reasoning
 *  looked affordable. Measured in 2026-07 it bought nothing: quality
 *  was identical at minimal on real dumped prompts, and 'high' cost
 *  2.2-2.8x the price and 3.6-4.7x the latency. Every life generator
 *  now runs minimal (LIFE-THINK-1, asserted in modelConfig.test.ts).
 *
 *  Note WHY the old 'high' was affordable in practice: it never reached
 *  the wire. The SDK dropped the model-level thinkingConfig whenever a
 *  request-level generationConfig was present, so these calls ran at the
 *  model default regardless of what was asked for here. That is fixed
 *  (`functions/src/generationConfig.ts`, LIFE-COST-4) — which is what
 *  makes the levels above load-bearing rather than decorative, and what
 *  turns the measured saving into a real one on any model that thinks by
 *  default.
 *
 *  If quality DOES slip in real play, the cleanest upgrade is to add
 *  `gemini-3-pro-preview` to the whitelist in `functions/src/index.ts`
 *  and switch these constants to it — a better model, not more
 *  thinking on a weaker one. */
export const LIFE_SCENE_GEN_MODEL = 'gemini-3.1-flash-lite';
export const LIFE_WORLD_ARC_MODEL = 'gemini-3.1-flash-lite';

/** LIFE-BACKDROP-11: scene SVG generation.
 *
 *  2026-07-25 — moved off `gemini-3-flash-preview` to
 *  `gemini-3.5-flash-lite`, measured against real Gemini on three
 *  scenes (bakery / café / magic academy) with the LIFE-BACKDROP-11 shape
 *  budget applied to the SI:
 *
 *    3-flash-preview   30 nodes  $0.005300   adequate, large dead zones
 *    3.5-flash-lite    47 nodes  $0.007400   BEST composed  <- chosen
 *    3.1-flash-lite    21 nodes  $0.002076   unusable (white boxes)
 *
 *  vs the previous production config (this model at medium thinking,
 *  no shape budget) at $0.012547/scene that is a 41% cost cut AND a
 *  visual improvement. The preview tier also shipped UTF-8 mojibake
 *  ("PÃĒtisserie"); 3.5 rendered accented French cleanly in every run.
 *
 *  NOTE: 3.5-flash-lite is DEARER per token than 3.1-flash-lite on both
 *  axes. It wins here only because the shape budget cut its output;
 *  do NOT copy this choice onto the per-turn or analysis paths, where
 *  it measured both slower to pay off and worse on quality. */
export const LIFE_BACKDROP_MODEL = 'gemini-3.5-flash-lite';

/** LIFE-NPC-2: portrait SVG for persistent NPCs. Smaller output
 *  than a full scene (200x200 viewBox vs 1200x800), simpler subject,
 *  but visual quality matters — players see this avatar every time
 *  the NPC speaks. Same model tier as scenes; thinking dialled down
 *  since the composition is much simpler. */
export const LIFE_NPC_AVATAR_MODEL = 'gemini-3-flash-preview';

/** LIFE-WORLD-SAGA-*: the book-level world synopsis. Generated ONCE
 *  per world; the most consequential call in the entire life-sim
 *  (everything downstream reads from it). Bumped to flash + high
 *  thinking. If the function whitelist ever picks up a Pro tier, the
 *  saga is the right place to spend it. */
export const LIFE_SAGA_MODEL = 'gemini-3-flash-preview';

/** LIFE-SCENE-7: outline refresh between phases / on divergence.
 *  Runs more often (~every 5-10 turns) so we keep it on flash-lite
 *  — same tier as lifeStep. */
export const LIFE_SCENE_REPLAN_MODEL = 'gemini-3.1-flash-lite';

/** LIFE-EX-GEN-*: graded-question generator. Fires AFTER lifeStep on
 *  graded turns (~1 in 3). Smaller prompt than lifeStep, focused
 *  output, no narrative — flash-lite handles it cleanly. Could be
 *  bumped to flash-preview if chip pedagogy needs deeper reasoning. */
export const GRADED_QUESTION_MODEL = 'gemini-3.1-flash-lite';

/** LIFE-TEMP-1: sampling temperature for CREATIVE life-sim calls — saga,
 *  scene outline, arcs, story beats, NPC bios/profiles (art has its
 *  own tier below; graded content must NOT use this one).
 *  High by design: outlines, beats, hooks and replans all benefit from
 *  variety + low repetition. Structured JSON output keeps the schema
 *  shape stable regardless; temperature governs WHAT happens, not HOW
 *  it serialises. */
export const LIFE_TEMPERATURE = 0.95;

/** LIFE-TEMP-2: sampling temperature for GRADED calls (question +
 *  distractor authoring). Creative variance is a defect here — a graded
 *  item needs exactly one defensibly-correct answer and distractors that
 *  are wrong for a *reason*. At 0.95 the generator wanders into
 *  ambiguous options and near-synonym distractors that make a correct
 *  answer look wrong. Low, not zero: chips still need lexical variety
 *  across turns. */
export const LIFE_TEMPERATURE_GRADED = 0.35;

/** LIFE-TEMP-3: sampling temperature for generated ART — NPC avatars and
 *  scene SVGs. Creative, but structurally constrained: avatar params come
 *  from a fixed menu and scene output must stay valid, composable SVG. Mid
 *  temperature keeps characters and places visually distinct from each
 *  other without pushing toward incoherent part combinations or messy
 *  draw commands. */
export const LIFE_TEMPERATURE_ART = 0.7;
