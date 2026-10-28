/**
 * SRV-PROMPT-8..13 — the three artefacts `life_world_arc` had to DUPLICATE, and
 * the guard that stops the two copies drifting.
 *
 * ── WHY THEY COULD NOT MOVE ─────────────────────────────────────────────────
 *
 * `src/lib/life/prompts/worldArc.ts` was deleted when the chapter-arc prompt
 * moved server-side (SRV-PROMPT-3). It pulled in three things it did NOT own
 * alone, so none of them could move with it:
 *
 *   | artefact           | other client consumer | retires with        |
 *   |--------------------|-----------------------|---------------------|
 *   | `LEXICON_RULES`    | `prompts/sagaOpen.ts` | batch 5 — ✅ RETIRED |
 *   | `renderWorldStory` | `prompts/step.ts`     | batch 8 — ✅ RETIRED |
 *   | `renderUniverse`   | `prompts/step.ts`     | batch 8 — ✅ RETIRED |
 *
 * ⚠ EACH HAS EXACTLY ONE OTHER CONSUMER, and the batches differ — checked
 * rather than assumed, because the first version of this work assumed all three
 * were shared by both `life_saga` and `life_step` and all three were wrong.
 * `LEXICON_RULES` is NOT in the step SI: `LIFE-SI-LEAN-7` dropped it on
 * measurement and `bannedLexicon.test.ts` asserts its absence there. And
 * `sagaOpen.ts` does not use `renderWorldStory` — it renders its own blocks.
 *
 * ✅ THE LEXICON DUPLICATION EXPIRED ON SCHEDULE (batch 5, 2026-09-18) and the
 * block that guarded it is gone. `sagaOpen.ts` really was the last client
 * consumer — verified with `git grep LEXICON_RULES`, which returned that import,
 * this file, `bannedLexicon.test.ts` and prose — so the client constant was
 * DELETED and `functions/src/prompts/lifeLexiconRules.ts` is now the only copy.
 * A guard on two copies is worthless with one.
 *
 * ⚠ BUT RETIRING IT LEFT SOMETHING UNASSERTED, and that is the one thing worth
 * reading here. `LEXICON_RULES` was BUILT from `BANNED_LEXICON` /
 * `BANNED_IDIOMS`, which stayed client-side because they are the playthrough
 * SCORERS (`ruleConformance.ts`, `rescore.ts`, `run.play.ts` count against
 * them). While both copies existed, adding a word to the scorer list and not to
 * the server's flat text broke the equality check. With the client rule text
 * gone, nothing connected the two at all — the scorer could count a word the
 * prompt never banned, and the prompt would look correctly wired. The block
 * below replaces the equality with that CONTAINMENT, which is the property that
 * actually mattered and is strictly more than the old check proved.
 *
 * ── WHY THIS FILE, AND NOT A TEST NEXT TO EACH MODULE ───────────────────────
 *
 * `tests/playthrough/` is the ONLY place in the repo that can reach both sides:
 * it is in the `app` vitest project (so `@/` resolves) and it already imports
 * `functions/src/prompts/` dynamically, which `transport.ts` does for the same
 * reason. A test under `src/` cannot — `no-restricted-imports` bans the
 * `../../../` hop, which is why the batch-1 and batch-2 guards read the server
 * file as TEXT and parsed it with a regex.
 *
 * That matters for more than tidiness. Because both sides are REAL VALUES here,
 * these guards do almost no text parsing:
 *   - the lexicon check runs the CLIENT's scorer arrays against the SERVER's
 *     rendered rule lines, both imported, neither scraped;
 *   - the renderers are compared by RUNNING both over fixtures and diffing the
 *     output bytes;
 *   - the clock constants are imported from both sides and the classifier is
 *     swept across the bound.
 * The two exceptions read the server file as TEXT, and both are asserting a
 * NEGATIVE that no runtime value can express — "nothing is interpolated here"
 * and "this array is not declared server-side".
 * So the failure mode that bit batch 2 — a `[A-Za-z]` value regex that silently
 * dropped any name with an underscore, and then reported agreement about an
 * entry it had never seen — cannot arise: there is no parser to have a blind
 * spot. A guard against silent drift must not have a silent failure mode of its
 * own, and the surest way to achieve that is to have nothing to parse.
 *
 * ── DELETING THIS FILE ──────────────────────────────────────────────────────
 *
 * Not all at once, and after batch 8 it is nearly empty of expiring guards.
 * The LEXICON block went with batch 5; the two RENDERER blocks and the
 * STORY-STAGE ladder went with batch 8, when `life_step` took
 * `worldState.ts` / `universe.ts` / `prompts/storyStage.ts` server-side and
 * `timeOfDay.ts`'s six glosses re-converged with the backdrop's.
 *
 * ⚠ WHAT IS LEFT DOES NOT EXPIRE, and reading it as leftover would be the
 * mistake this note exists to prevent. `CHAPTER_ONE_MIN_CLOCK`,
 * `DELTA_PER_FRONT` / `DELTA_BUDGET` and `RECENT_SUBJECTS_WINDOW` are shared
 * with ENGINE code (`fronts.ts`, `applyClockDeltas`, `startScene`'s storage
 * cap), which never migrates — the `avatar/parts.ts` shape. Batch 8 ADDED three
 * more of that kind: the four scene-pace constants (`sceneLifecycle` refuses a
 * resolve below `SCENE_FLOOR`), the cadence streak (`generateStepOptions` logs
 * whether the model honoured it) and the SHAPE SENTENCES (a `ZodIssue` carries
 * a string; the retry hint carries a code).
 */
import { describe, expect, it } from 'vitest';
import { BANNED_IDIOMS, BANNED_LEXICON } from '@/lib/life/prompts/bannedLexicon';
import type { Front } from '@/types/lifeState';
// LIFE-DATA-DRIFT-2 — the two client Zod artefacts the step SI must agree with.
// They PARSE the model's answer, so they never migrate; the contract they have
// to match is now server-side, which is why this check lives here.
import { ZBackdropIntentFields, ZStepSceneSignal } from '@/lib/life/stepSchema';

/**
 * ── REPLACES THE RETIRED EQUALITY GUARD (batch 5) ───────────────────────────
 *
 * `prompts/bannedLexicon.ts` is a SPLIT artefact and only part of it ever
 * crossed. `LEXICON_RULES` was PROMPT TEXT and is now SERVER-ONLY. `BANNED_LEXICON`
 * and `BANNED_IDIOMS` are SCORERS — `ruleConformance.ts`, `rescore.ts` and
 * `run.play.ts` count violations against them — so they stayed client-side and
 * were never duplicated: the server does not score, it has no use for the arrays
 * as arrays, and a second copy of a list that looks authoritative is how two
 * lists come to disagree about which one is.
 *
 * What the old equality check bought, as a side effect, was that the SCORER and
 * the PROMPT named the same words: the client rule text was BUILT from these two
 * arrays, so a word added to one and not the server's flat copy failed the
 * comparison. With the client rule text deleted that link is gone, and the
 * failure it prevented is a benchmark counting violations of a rule the model
 * was never given — a scorer marking down output for something nobody asked for,
 * which reads as a quality regression and is a measurement bug.
 *
 * So the property is asserted DIRECTLY instead, which is more than the equality
 * ever proved: every scored word must appear in the shipped rule text.
 */
describe('LIFE-STORY-LEXICON-1 — the SCORED words are the words the prompt bans', () => {
  const serverRules = async () =>
    (await import('../../functions/src/prompts/lifeLexiconRules')).LEXICON_RULES.join('\n');

  it('LIFE-STORY-LEXICON-1 — every scored NOUN appears in the server rule text', async () => {
    const text = await serverRules();
    expect(BANNED_LEXICON.length).toBeGreaterThan(0);
    for (const w of BANNED_LEXICON) {
      expect(text, `"${w}" is scored but never banned`).toContain(w);
    }
  });

  it('LIFE-STORY-LEXICON-2 — every scored IDIOM appears in the server rule text', async () => {
    const text = (await serverRules()).toLowerCase();
    expect(BANNED_IDIOMS.length).toBeGreaterThan(0);
    for (const s of BANNED_IDIOMS) {
      expect(text, `"${s}" is scored but never banned`).toContain(s.toLowerCase());
    }
  });

  it('LIFE-STORY-LEXICON-1 — and the containment check DISCRIMINATES', async () => {
    // Mutation-proofing, not padding. `toContain` over a 3 kB block is the kind
    // of check that passes for the wrong reason — a short word can appear inside
    // an unrelated one, and every word here is short. This asserts the negative
    // so a future `BANNED_LEXICON` entry cannot be "found" by accident, and so
    // an empty rule text cannot pass the two checks above by having nothing to
    // disagree with.
    const text = await serverRules();
    expect(text.length).toBeGreaterThan(1_000);
    for (const w of ['roster', 'chandlery', 'ZZZ_NOT_A_BANNED_WORD']) {
      expect(text, `${w} should not be in the rule text`).not.toContain(w);
    }
  });

  it('LIFE-STORY-LEXICON-1 — the server copy is FLAT TEXT, with nothing interpolated', () => {
    // The client used to build its lines from the two arrays; the server holds
    // the rendered result. A template substitution reintroduced server-side
    // could agree with the arrays at import time and still diverge on a value
    // neither test had looked at, so the SHAPE is pinned as well as the words.
    const src = readServerSource();
    const block = src.slice(src.indexOf('export const LEXICON_RULES'));
    expect(block.length).toBeGreaterThan(500);
    expect(block).not.toContain('${');
  });

  it('LIFE-STORY-LEXICON-1 — the scorers did NOT move, and are still client-side', () => {
    // Asserted against a DECLARATION, not a mention. The server file names both
    // arrays in its header to explain what it deliberately left behind, and a
    // bare `toContain` check reads that documentation as the defect it warns
    // about — which it did on the first run of this test. Prose explaining a
    // decision must not be indistinguishable from reversing it.
    const src = readServerSource();
    for (const name of ['BANNED_LEXICON', 'BANNED_IDIOMS']) {
      expect(src, `${name} must not be declared server-side`).not.toMatch(
        new RegExp(`(export\\s+)?const\\s+${name}\\b`),
      );
      expect(src, `${name} must not be imported server-side`).not.toMatch(
        new RegExp(`import[^;]*\\b${name}\\b`),
      );
    }
  });

  it('LIFE-STORY-LEXICON-1 — the client rule text is GONE, not kept beside the server copy', async () => {
    // SRV-PROMPT-3 / PRACTICE-OWN-8 — a retired prompt artefact is deleted, not
    // left importable. A second copy is a second thing to edit, and this module
    // is the one the reported 2026-08-01 failure spanned three surfaces of.
    const client = await import('@/lib/life/prompts/bannedLexicon');
    expect('LEXICON_RULES' in client).toBe(false);
    // …and the two that STAYED are still there, so this is not "the module was
    // emptied".
    expect(Array.isArray(client.BANNED_LEXICON)).toBe(true);
    expect(Array.isArray(client.BANNED_IDIOMS)).toBe(true);
  });
});

/**
 * ── SRV-PROMPT-8..13 batch 5 — what `life_saga` moved, and the ONE thing it
 *    had to duplicate ─────────────────────────────────────────────────────────
 *
 *   | artefact               | other client consumer      | status            |
 *   |------------------------|----------------------------|-------------------|
 *   | `LEXICON_RULES`        | — none left after batch 5  | MOVED, no guard   |
 *   | `renderWorldTexture`   | — none                     | MOVED, no guard   |
 *   | `worldTexture`/`*_AXES`| — none                     | MOVED, no guard   |
 *   | `CHAPTER_ONE_MIN_CLOCK`| `life/fronts.ts` engine    | dup → NEVER       |
 *
 * ⚠ THE ONE DUPLICATION DOES NOT EXPIRE, and it is the `DELTA_PER_FRONT` shape
 * rather than the story-stage one. `CHAPTER_ONE_MIN_CLOCK` is not shared with
 * another PROMPT — it is shared with `conformsToOpeningRule`, which is ENGINE
 * code `runSagaOpen` runs over the model's answer and which never migrates. So
 * the two copies never re-converge, and deleting this block at batch 8 would be
 * wrong.
 *
 * Drift is invisible and wrong in the quiet direction: the SI would ask for a
 * clock of at least N, the check would demand at least M, and every world would
 * open with a logged LIFE-FRONT-7 breach nobody caused — a debug line that is
 * always on, which is the same as no signal at all.
 */
describe('LIFE-FRONT-7 — the clock the MODEL is told is the one the ENGINE checks', () => {
  it('LIFE-FRONT-7 — the two copies of the minimum clock are equal', async () => {
    const server = await import('../../functions/src/prompts/lifeSagaOpen');
    const client = await import('@/lib/life/fronts');
    // Asserted against each other rather than each against a literal: a literal
    // on both sides agrees with nothing.
    expect(server.CHAPTER_ONE_MIN_CLOCK).toBe(client.CHAPTER_ONE_MIN_CLOCK);
  });

  it('LIFE-FRONT-7 — the SI states the ENGINE’s number, not a hand-written one', async () => {
    // Equality alone is not enough: the SI could interpolate a third literal and
    // still agree with nothing. This reads the sentence the model is served and
    // rebuilds it from the CLIENT's constant, so the prose and the check are
    // compared end to end.
    const { sagaOpenSystemInstruction } = await import(
      '../../functions/src/prompts/lifeSagaOpen'
    );
    const { CHAPTER_ONE_MIN_CLOCK } = await import('@/lib/life/fronts');
    const si = sagaOpenSystemInstruction({
      practiceLanguage: 'French',
      systemLanguage: 'English',
      succession: false,
      realistic: true,
    });
    expect(si).toContain(`its clock size must be at least ${CHAPTER_ONE_MIN_CLOCK}`);
    expect(si).toContain(`"size": ${CHAPTER_ONE_MIN_CLOCK}`);
  });

  it('LIFE-FRONT-7 — both copies AGREE on a clock either side of the bound', async () => {
    // Behavioural, and it is the rung the constants sit on that matters. A
    // fixture at size 12 is conforming under 8 and under 10 alike; only a size
    // ON the bound and one BELOW it tell a retuned constant apart. Sweeping the
    // whole range walks every rung, so no change can hide between samples.
    const server = await import('../../functions/src/prompts/lifeSagaOpen');
    const { conformsToOpeningRule } = await import('@/lib/life/fronts');
    const front = (size: number) =>
      ({
        id: 'f1',
        name: 'F',
        driverId: 'p1',
        agenda: 'a',
        kind: 'obligation',
        scope: 'saga',
        resolved: null,
        clock: { filled: 0, size, consequence: 'c', peak: 0, unattended: 0 },
      }) as unknown as Front;
    for (let size = 0; size <= 16; size += 1) {
      expect(conformsToOpeningRule(front(size)), `size ${size}`).toBe(
        size >= server.CHAPTER_ONE_MIN_CLOCK,
      );
    }
  });

  it('LIFE-FRONT-7 — the constant did NOT travel in the spec', async () => {
    // Sending it up would let a client write a number into a SYSTEM INSTRUCTION
    // — this migration's own hole, reached from the other direction, and the
    // same reason batch 2 refused to ship the avatar part names. The resolver's
    // own behaviour is the assertion: a spec field would have to be read for a
    // caller to move it.
    const { resolveServerPrompt } = await import(
      '../../functions/src/prompts/serverPromptSpec'
    );
    const { CHAPTER_ONE_MIN_CLOCK } = await import('@/lib/life/fronts');
    const r = resolveServerPrompt('life_saga', {
      kind: 'life_saga',
      worldId: 'w1',
      characterName: 'Alice',
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'English',
      worldSeedKey: 'heist',
      // A client trying to open with a countdown.
      chapterOneMinClock: 2,
      minClock: 2,
    });
    expect(r.status).toBe('built');
    if (r.status !== 'built') throw new Error('unreachable');
    expect(r.systemInstruction).toContain(`at least ${CHAPTER_ONE_MIN_CLOCK}`);
    expect(r.systemInstruction).not.toContain('at least 2');
  });
});

/**
 * ── SRV-PROMPT-3 — the retired world-open modules leave no client copy ───────
 *
 * `prompts/sagaOpen.ts` and `worldTexture.ts` had one non-test consumer between
 * them (the second's was the first) and crossed whole, so there is nothing to
 * keep in step — but "nothing to keep in step" holds only while nobody re-adds
 * them. Written against the FILESYSTEM for the reason batch 4 recorded: a
 * `await expect(import(...)).rejects` check on a template path passes because
 * Vite cannot analyse it, not because the file is gone.
 */
describe('SRV-PROMPT-3 — the retired world-open modules are GONE', () => {
  it('SRV-PROMPT-3 — neither module exists, and nothing under src/ imports one', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeFs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePath = require('node:path') as typeof import('node:path');
    const repoRoot = nodePath.resolve(__dirname, '..', '..');
    const lifeDir = nodePath.join(repoRoot, 'src', 'lib', 'life');
    for (const rel of ['prompts/sagaOpen.ts', 'worldTexture.ts']) {
      expect(
        nodeFs.existsSync(nodePath.join(lifeDir, rel)),
        `src/lib/life/${rel} must be DELETED, not kept for reference`,
      ).toBe(false);
    }
    // …and the check is not passing because the directory moved: surviving
    // siblings are still there.
    expect(nodeFs.existsSync(nodePath.join(lifeDir, 'runSagaOpen.ts'))).toBe(true);
    expect(nodeFs.existsSync(nodePath.join(lifeDir, 'prompts', 'bannedLexicon.ts'))).toBe(true);

    const walk = (dir: string): string[] =>
      nodeFs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name.startsWith('.') || e.name === 'node_modules') return [];
        const full = nodePath.join(dir, e.name);
        return e.isDirectory() ? walk(full) : /\.tsx?$/.test(e.name) ? [full] : [];
      });
    const offenders = walk(nodePath.join(repoRoot, 'src')).filter((f) =>
      /from '[^']*(prompts\/sagaOpen|life\/worldTexture|\.\.\/worldTexture)'/.test(
        nodeFs.readFileSync(f, 'utf8'),
      ),
    );
    expect(offenders, 'these still import a retired world-open module').toEqual([]);
  });

  it('SRV-PROMPT-3 — the texture renderer is server-side only', async () => {
    const server = await import('../../functions/src/prompts/lifeWorldTexture');
    expect(typeof server.renderWorldTexture).toBe('function');
    expect(typeof server.worldTexture).toBe('function');
    expect(server.NAME_AXES.length).toBeGreaterThan(5);
    expect(server.PLACE_AXES.length).toBeGreaterThan(5);
  });
});

function readServerSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  return fs.readFileSync(
    path.join(__dirname, '..', '..', 'functions', 'src', 'prompts', 'lifeLexiconRules.ts'),
    'utf8',
  );
}

/**
 * ✅ THE TWO RENDERER PARITY BLOCKS EXPIRED WITH BATCH 8 and are GONE.
 *
 * `renderWorldStory` and `renderUniverse` were duplicated at
 * `functions/src/prompts/lifeWorldState.ts` because `prompts/step.ts` read the
 * client copy every turn while `life_world_arc` read the server copy. Batch 8
 * moved `life_step`, `src/lib/life/prompts/{worldState,universe}.ts` were
 * DELETED, and a guard on two copies is worthless with one.
 *
 * Their replacement is `functions/src/__tests__/stepGoldenParity.test.ts`,
 * which compares the SERVER's bytes against a capture of the CLIENT's taken
 * immediately before the deletion — strictly more than these blocks proved,
 * because it covers the whole assembled prompt rather than two of its blocks.
 * The fixtures those blocks swept (every branch, XML-breaking characters, a
 * front with `resolved` ABSENT so `== null` and `=== null` are distinguishable)
 * live on in `functions/src/__tests__/lifeWorldState.test.ts` and in the golden.
 */

/**
 * ── SRV-PROMPT-8..13 batch 4 — what `life_scene_gen` / `life_scene` duplicated,
 *    and the two DIFFERENT expiries ────────────────────────────────────────────
 *
 * `src/lib/life/prompts/{sceneOpen,sceneClose}.ts` were deleted when the two
 * scene prompts moved server-side. Between them they reached four things they
 * did not own alone. Three MOVED; only two are duplicated, and the two expire
 * at different times — checked rather than assumed, because batch 3's own note
 * records getting exactly this wrong twice in one change.
 *
 *   | artefact                     | other client consumer   | status          |
 *   |------------------------------|-------------------------|-----------------|
 *   | `renderSceneFocus`           | — none                  | MOVED, no guard |
 *   | `renderRecentSubjects`       | — none                  | MOVED, no guard |
 *   | `renderSceneStage`           | — none                  | MOVED, no guard |
 *   | `storyStage` + `STAGE_*`     | `prompts/step.ts`       | dup → EXPIRED, batch 8 |
 *   | `DELTA_PER_FRONT`/`_BUDGET`  | `life/fronts.ts` engine | dup → NEVER     |
 *
 * ⚠ THE SECOND DUPLICATION DOES NOT EXPIRE, and that is the unusual one. The
 * delta constants are not shared with another PROMPT — they are shared with
 * `applyClockDeltas`, which is engine code and never migrates. So this is the
 * `avatar/parts.ts` shape (two live copies that must agree forever), not the
 * batch-1 gloss shape (two copies that re-converge at a named batch). Deleting
 * that block when batch 8 lands would be wrong.
 */
/**
 * ✅ THE STORY-STAGE LADDER DUPLICATION EXPIRED WITH BATCH 8 and its block is
 * GONE. `src/lib/life/prompts/storyStage.ts` was the last client consumer of
 * `storyStage` + the three `STAGE_*_AT` thresholds; `life_step` took
 * `renderStoryStage` and `CAST_FLOOR` server-side with it and the module was
 * DELETED, so `functions/src/prompts/lifeStoryStage.ts` is now the only copy.
 * Its own header's "DELETE THE DUPLICATED HALF when batch 8 lands" is done.
 *
 * ⚠ THE SWEEP ITSELF DID NOT DIE. `functions/src/__tests__/life/storyStage.test.ts`
 * (moved here from `src/`, SRV-PROMPT-3) still walks every turn of chapters 1,
 * 2 and 7 and still asserts all four stages are reached — which was the half of
 * the old block that proved something rather than proving agreement.
 */

describe('LIFE-FRONT-2 — the clock budget the MODEL is told is the one the ENGINE enforces', () => {
  /** ⚠ NO EXPIRY, deliberately. `DELTA_PER_FRONT` / `DELTA_BUDGET` are shared
   *  with `applyClockDeltas`, which is engine code, not a prompt — so unlike
   *  the ladder above these two copies never re-converge. Drift is invisible
   *  and wrong in the boring direction: the SI would invite a move of 3, the
   *  clamp would silently take 2, and every close would discard part of a
   *  judgement the model was explicitly asked to make. */
  it('LIFE-FRONT-2 — the two copies of the delta constants are equal', async () => {
    const server = await import('../../functions/src/prompts/lifeSceneClose');
    const client = await import('@/lib/life/fronts');
    expect(server.DELTA_PER_FRONT).toBe(client.DELTA_PER_FRONT);
    expect(server.DELTA_BUDGET).toBe(client.DELTA_BUDGET);
  });

  it('LIFE-FRONT-2 — the SI states the ENGINE’s numbers, not a hand-written pair', async () => {
    // Equality above is not enough on its own: the SI could interpolate a third
    // literal and still agree with nothing. This reads the sentence the model
    // is actually served and rebuilds it from the CLIENT's constants, so the
    // prose and the clamp are compared end to end.
    const { sceneCloseSystemInstruction } = await import(
      '../../functions/src/prompts/lifeSceneClose'
    );
    const { DELTA_PER_FRONT, DELTA_BUDGET } = await import('@/lib/life/fronts');
    expect(sceneCloseSystemInstruction({ realistic: true })).toContain(
      `You may move a clock by at most ${DELTA_PER_FRONT}, and at most ${DELTA_BUDGET} across ALL fronts combined.`,
    );
  });

  it('LIFE-FRONT-2 — the constants did NOT travel in the spec', async () => {
    // Sending them up would let a client write numbers into a SYSTEM
    // INSTRUCTION — this migration's own hole, reached from the other
    // direction, and the same reason batch 2 refused to ship the avatar part
    // names. The resolver's own type is the assertion: a spec field would have
    // to exist for the builder to read one.
    const { resolveServerPrompt } = await import(
      '../../functions/src/prompts/serverPromptSpec'
    );
    const r = resolveServerPrompt('life_scene', {
      kind: 'life_scene',
      sceneLog: ['You: hello'],
      subject: 's',
      atStake: 'a',
      cast: [],
      fronts: [],
      realistic: true,
      // A client trying to raise its own budget.
      deltaPerFront: 9,
      deltaBudget: 9,
    });
    expect(r.status).toBe('built');
    if (r.status !== 'built') throw new Error('unreachable');
    expect(r.systemInstruction).toContain('at most 2, and at most 2');
    expect(r.systemInstruction).not.toContain('at most 9');
  });
});

/**
 * ── SRV-PROMPT-3 — the three renderers that MOVED leave no client copy ───────
 *
 * `renderSceneFocus`, `renderRecentSubjects` and `RECENT_SUBJECTS_WINDOW` had
 * one non-test consumer each and crossed whole, so there is nothing to keep in
 * step — but "nothing to keep in step" is only true while nobody re-adds them.
 * PRACTICE-OWN-8 is explicit that a retired client prompt module is deleted
 * rather than left importable, and this is that rule with a test on it.
 */
describe('SRV-PROMPT-3 — the retired scene prompt modules are GONE, not kept for reference', () => {
  it('SRV-PROMPT-3 — neither client prompt module exists, and nothing imports one', () => {
    // ⚠ WRITTEN AGAINST THE FILESYSTEM, and the first version was not. It used
    // `await expect(import(`@/lib/life/prompts/${mod}`)).rejects.toThrow()`,
    // which Vite cannot analyse (`vite:dynamic-import-vars` warns "a file
    // extension must be included in the static part of the import") — so the
    // import rejected because the PLUGIN could not build it, not because the
    // file was gone, and the assertion would have passed just as happily with
    // both modules sitting there. A guard against a deletion must fail when the
    // thing comes back.
    //
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeFs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePath = require('node:path') as typeof import('node:path');
    const repoRoot = nodePath.resolve(__dirname, '..', '..');
    const promptsDir = nodePath.join(repoRoot, 'src', 'lib', 'life', 'prompts');
    for (const mod of ['sceneOpen', 'sceneClose']) {
      expect(
        nodeFs.existsSync(nodePath.join(promptsDir, `${mod}.ts`)),
        `src/lib/life/prompts/${mod}.ts must be DELETED, not kept for reference`,
      ).toBe(false);
    }
    // …and the check is not passing because the directory moved: its surviving
    // siblings are still there.
    expect(nodeFs.existsSync(nodePath.join(promptsDir, 'stepRender.ts'))).toBe(true);

    // Nothing under src/ or tests/ may import them either — a deleted file with
    // a live import is a build error, but a RE-ADDED file with live imports is
    // exactly the second copy PRACTICE-OWN-8 forbids, and this is what notices.
    const walk = (dir: string): string[] =>
      nodeFs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name.startsWith('.') || e.name === 'node_modules') return [];
        const full = nodePath.join(dir, e.name);
        return e.isDirectory() ? walk(full) : /\.tsx?$/.test(e.name) ? [full] : [];
      });
    const offenders = walk(nodePath.join(repoRoot, "src")).filter((f) =>
      /from '[^']*prompts\/scene(Open|Close)'/.test(nodeFs.readFileSync(f, 'utf8')),
    );
    expect(offenders, `these still import a retired scene prompt module`).toEqual([]);
  });

  it('SRV-PROMPT-3 — the scene-focus renderers are server-side only', async () => {
    const client = await import('@/lib/life/sceneFocus');
    for (const gone of ['renderSceneFocus', 'renderRecentSubjects']) {
      expect(gone in client, gone).toBe(false);
    }
    // `focusForScene` STAYED — the rotation is engine bookkeeping, and the
    // spec carries its decision. Asserting the positive keeps the split
    // legible: this is not "sceneFocus.ts was emptied".
    expect(typeof client.focusForScene).toBe('function');
    const server = await import('../../functions/src/prompts/lifeSceneOpen');
    expect(typeof server.renderSceneFocus).toBe('function');
    expect(typeof server.renderRecentSubjects).toBe('function');
    // …and `focusForScene` did NOT also cross: two copies of the rotation would
    // make a replay irreproducible the day they disagreed.
    expect('focusForScene' in server).toBe(false);
  });

  /**
   * ⚠ NO EXPIRY. `RECENT_SUBJECTS_WINDOW` is a SPLIT artefact and was very
   * nearly moved whole on the reading that it was prompt text: client-side it
   * is a STORAGE cap (`startScene` slices `world.recentSubjects` to it before
   * writing), server-side it is a RENDER window. A Firestore write cap never
   * migrates, so unlike the story-stage ladder these two never re-converge —
   * this is the `avatar/parts.ts` shape.
   *
   * It was `npm run typecheck` that found the second consumer, not a grep. The
   * lesson is the cheap one: a consumer list is a claim until a compiler has
   * checked it.
   */
  it('LIFE-SCENE-2 — the recent-subjects STORE and WINDOW are the same number', async () => {
    const client = await import('@/lib/life/sceneFocus');
    const server = await import('../../functions/src/prompts/lifeSceneOpen');
    expect(server.RECENT_SUBJECTS_WINDOW).toBe(client.RECENT_SUBJECTS_WINDOW);
  });

  it('LIFE-SCENE-2 — the server RENDERS exactly that many, so the number is load-bearing', async () => {
    // Equality alone would still pass if the renderer stopped using its own
    // constant. This drives it: N+4 subjects in, N rendered, newest kept.
    const server = await import('../../functions/src/prompts/lifeSceneOpen');
    const n = server.RECENT_SUBJECTS_WINDOW;
    const out = server.renderRecentSubjects(
      Array.from({ length: n + 4 }, (_, i) => `subject-${i}`),
    );
    expect(out.match(/<subject>/g)).toHaveLength(n);
    expect(out).toContain(`subject-${n + 3}`);
    expect(out).not.toContain('subject-3<');
  });

  it('LIFE-SCENE-2 — the client STORES exactly that many, so the number is load-bearing there too', () => {
    // The other half. `startScene` is the only writer, and the slice is a
    // literal line of source rather than something a unit can call without a
    // Firestore mock — so this pins the expression, which is what would change
    // if someone re-typed the bound.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeFs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePath = require('node:path') as typeof import('node:path');
    const src = nodeFs.readFileSync(
      nodePath.resolve(__dirname, '..', '..', 'src', 'lib', 'life', 'sceneLifecycle.ts'),
      'utf8',
    );
    expect(src).toContain('.slice(-RECENT_SUBJECTS_WINDOW)');
    // …and NOT a re-typed literal beside it, which is how the two come apart.
    expect(src).not.toMatch(/recentSubjects[\s\S]{0,200}\.slice\(-\d/);
  });
});


/**
 * ── MOVED HERE BY BATCH 8, because it is a CROSS-SIDE agreement ─────────────
 *
 * `ZStepSceneSignal` / `ZBackdropIntentFields` are client Zod that PARSE the
 * model's answer, so they never migrate. The OUTPUT CONTRACT they have to agree
 * with is now the server's system instruction. This file is the only one in the
 * repo that can import both — the same reason the lexicon containment guard
 * lives here. The assertions are unchanged; only the SI is fetched from
 * `functions/src/prompts/lifeStep.ts` instead of `src/lib/life/prompts/step.ts`.
 */
describe('LIFE-DATA-DRIFT-2 — every scene signal the schema accepts is one the prompt ASKS for', () => {
  /**
   * THE BUG THIS EXISTS FOR, and it cost a whole benchmark run. LIFE-INTENT-2
   * added `leaning` / `leaningMoved` to `ZStepSceneSignal` and rendered a block
   * describing them in prose — but never added them to the prompt's OUTPUT
   * CONTRACT, the JSON skeleton the model actually writes to. So the model
   * emitted neither, the fold recorded 69 consecutive non-moves, and the
   * measurement read as "the mechanism doesn't work" when the mechanism had
   * never been switched on.
   *
   * This is LIFE-DATA-DRIFT-1 one seam over: there, the WRITER's shape drifted
   * from the READER's type; here, the prompt (writer) drifts from the schema
   * (reader). Same fix — put the directory in front of the compiler.
   */
  const DELIBERATELY_UNREQUESTED = new Set([
    // LIFE-STORY-SHAPE-3: accepted so in-flight responses don't fail parsing,
    // deliberately NOT asked for — plot-beat tracking is gone.
    'completedBeatIds',
  ]);

  const contract = async () => {
    const { lifeStepSystemInstruction } = await import(
      '../../functions/src/prompts/lifeStep'
    );
    return lifeStepSystemInstruction({
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'English',
      difficulty: 2,
    });
  };

  it('names every accepted field in the output contract, or documents why not', async () => {
    const text = await contract();
    const accepted = Object.keys(ZStepSceneSignal.shape);
    // Not vacuous: the schema really does have fields to check.
    expect(accepted.length).toBeGreaterThan(4);
    const missing = accepted.filter(
      (k) => !DELIBERATELY_UNREQUESTED.has(k) && !text.includes(`"${k}"`),
    );
    expect(missing).toEqual([]);
  });

  it('the same rule for the BACKDROP INTENT — LIFE-BACKDROP-26 arrived through this seam', async () => {
    const text = await contract();
    // `locationLabelNative` is the third instance of the pattern (after
    // LIFE-INTENT-2's `leaning` and LIFE-EX-VOCAB-4's `lineVocab`): a field
    // added to the Zod schema, described in prose, and absent from the JSON
    // skeleton the model writes to. Optional + absent = silently never emitted.
    const missing = Object.keys(ZBackdropIntentFields).filter((k) => !text.includes(`"${k}"`));
    expect(missing).toEqual([]);
  });
});


/**
 * ── SRV-PROMPT-8..13 batch 8 — what `life_step` DUPLICATED, and none of it
 *    expires ────────────────────────────────────────────────────────────────
 *
 * Batch 8 moved eleven client prompt modules whole and SPLIT seven more. Three
 * artefacts could not cross because ENGINE code reads them — the
 * `DELTA_PER_FRONT` shape, not the batch-1 gloss shape, so these blocks have NO
 * expiry and deleting them at some later batch would be wrong.
 *
 *   | artefact                  | engine reader                  | status |
 *   |---------------------------|--------------------------------|--------|
 *   | `SCENE_FLOOR` + the pace  | `sceneLifecycle` REFUSES an    | dup    |
 *   | constants                 | early resolve below the floor  |        |
 *   | `cyoaStreak`/`cadenceTier`| the LIFE-EX-CADENCE-3 debug row|  dup   |
 *   | the SHAPE SENTENCES       | a `ZodIssue` carries a STRING  |  dup   |
 */
describe('LIFE-SCENE-26 — the floor the MODEL is told is the floor the ENGINE enforces', () => {
  it('LIFE-SCENE-26 — the four scene-pace constants are equal on both sides', async () => {
    const server = await import('../../functions/src/prompts/lifeStepRender');
    const client = await import('@/lib/life/prompts/stepRender');
    // Asserted against each other rather than each against a literal: a literal
    // on both sides agrees with nothing.
    expect(server.SCENE_FLOOR).toBe(client.SCENE_FLOOR);
    expect(server.SCENE_IN_RANGE).toBe(client.SCENE_IN_RANGE);
    expect(server.SCENE_DUE).toBe(client.SCENE_DUE);
    expect(server.SCENE_OVERDUE).toBe(client.SCENE_OVERDUE);
  });

  it('LIFE-SCENE-26 — the BLOCK states the ENGINE\u2019s numbers, not a hand-written pair', async () => {
    // Equality alone is not enough: the renderer could interpolate a third
    // literal and still agree with nothing. This reads the block the model is
    // served and rebuilds it from the CLIENT\u2019s constants.
    const { renderScenePace } = await import('../../functions/src/prompts/lifeStepRender');
    const { SCENE_FLOOR, SCENE_OVERDUE } = await import('@/lib/life/prompts/stepRender');
    const out = renderScenePace(SCENE_OVERDUE, 'the gate');
    expect(out).toContain(`ceiling="${SCENE_OVERDUE}"`);
    expect(out).toContain(`floor="${SCENE_FLOOR}"`);
  });

  it('LIFE-SCENE-26 — both copies agree on EVERY turn either side of the bounds', async () => {
    // Behavioural, and it is the RUNG that matters: a fixture at turn 20 is
    // overdue under a ceiling of 12 and under one of 15 alike. Sweeping walks
    // every rung, so no retune can hide between samples.
    const { renderScenePace, SCENE_IN_RANGE, SCENE_DUE, SCENE_OVERDUE } = await import(
      '../../functions/src/prompts/lifeStepRender'
    );
    const client = await import('@/lib/life/prompts/stepRender');
    for (let t = 0; t <= 20; t += 1) {
      const out = renderScenePace(t, null);
      const stage = out === '' ? 'none' : /stage="([a-z-]+)"/.exec(out)?.[1];
      const want =
        t < client.SCENE_IN_RANGE
          ? 'none'
          : t >= client.SCENE_OVERDUE
            ? 'overdue'
            : t >= client.SCENE_DUE
              ? 'due'
              : 'in-range';
      expect(stage, `turn ${t}`).toBe(want);
    }
    // ...and the sweep is not vacuous: all four rungs are reached.
    expect(new Set([SCENE_IN_RANGE, SCENE_DUE, SCENE_OVERDUE]).size).toBe(3);
  });

  it('LIFE-SCENE-26 — the constants did NOT travel in the spec', async () => {
    // Sending one up would let a client write a floor into the block the
    // lifecycle then enforces differently \u2014 this migration\u2019s own hole reached
    // from the other direction.
    const { resolveServerPrompt } = await import(
      '../../functions/src/prompts/serverPromptSpec'
    );
    const { SCENE_OVERDUE } = await import('@/lib/life/prompts/stepRender');
    const r = resolveServerPrompt('life_step', {
      kind: 'life_step',
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'English',
      difficulty: 3,
      characterName: 'Marc',
      worldSeedKey: 'city_life',
      isOpeningBeat: false,
      sceneTurns: 99,
      // A client trying to move its own ceiling.
      sceneOverdue: 2,
      sceneFloor: 1,
    });
    expect(r.status).toBe('built');
    if (r.status !== 'built') throw new Error('unreachable');
    expect(r.prompt).toContain(`ceiling="${SCENE_OVERDUE}"`);
    expect(r.prompt).not.toContain('ceiling="2"');
  });
});

describe('LIFE-EX-CADENCE-3 — the streak the PROMPT counts is the streak the LOG reports', () => {
  /** ⚠ NO EXPIRY. `cyoaStreak` / `cadenceTier` are not shared with another
   *  PROMPT \u2014 they are read by `generateStepOptions`\u2019s debug row, which records
   *  whether the model HONOURED the cadence it was given. That is a judgement
   *  on the RESPONSE, so it never migrates, and the two copies never
   *  re-converge. Drift is invisible: the overlay would report `deferred` on a
   *  turn the prompt never marked due. */
  it('LIFE-EX-CADENCE-3 — both copies classify every streak identically', async () => {
    const server = await import('../../functions/src/prompts/lifeStepBlocks');
    const client = await import('@/lib/life/prompts/stepStreaks');
    expect(server.CADENCE_DUE).toBe(client.CADENCE_DUE);
    expect(server.CADENCE_OVERDUE).toBe(client.CADENCE_OVERDUE);
    for (let streak = 0; streak <= 8; streak += 1) {
      expect(server.cadenceTier(streak), `streak ${streak}`).toBe(client.cadenceTier(streak));
    }
    // ...and the sweep is not vacuous: it sees all three tiers.
    expect(new Set(Array.from({ length: 9 }, (_, i) => client.cadenceTier(i))).size).toBe(3);
  });

  it('LIFE-EX-CADENCE-3 — and both read the same streak off the same log', async () => {
    const server = await import('../../functions/src/prompts/lifeStepBlocks');
    const client = await import('@/lib/life/prompts/stepStreaks');
    const log = [
      { kind: 'correction', payload: { kind: 'generation', correctAnswer: 'veux' } },
      { kind: 'decision', payload: { text: 'a' } },
      { kind: 'beat', payload: { practiceText: 'b' } },
      { kind: 'decision', payload: { text: 'c' } },
    ];
    expect(server.cyoaStreak(log as never)).toBe(client.cyoaStreak(log as never));
    // ...on a log that actually produces a non-zero streak, so an implementation
    // that returned 0 unconditionally could not pass.
    expect(client.cyoaStreak(log as never)).toBe(2);
  });
});

describe('LIFE-GRID-6 — the DANGLE KEY is the same on both sides of the wire', () => {
  /** ⚠ NO EXPIRY. `shapeKey` / `goalKey` are the one pair batch 8 left on both
   *  sides, and it is a genuine split: `renderRecentActions` keys the block the
   *  model READS with them, and `gradeOptionSet` / `takenShapeCounts` key the
   *  REJECT it makes of the answer. Drift here is the exact failure `goalKey`'s
   *  own comment records — the rule was MEASURED against one key and
   *  IMPLEMENTED against another, and at 75.7% of grids it was a tax rather
   *  than a backstop. If the two copies disagree, the block would list a shape
   *  under one key while the check counted it under another, and the model
   *  would be told not to repeat something the rejection never saw. */
  it('LIFE-GRID-6 — both copies key every shape identically', async () => {
    const server = await import('../../functions/src/prompts/lifeStepBlocks');
    const client = await import('@/lib/life/optionGrid');
    const shapes = [
      { type: 'ask', targetId: null },
      { type: 'do', targetId: 'obje-letter' },
      { type: 'move', targetId: 'plac-<wash>&house' },
      { type: 'observe', targetId: '' },
      { type: 'offer', targetId: 'char-sophie' },
      { type: 'leave', targetId: null },
    ] as const;
    for (const a of shapes) {
      expect(server.shapeKey(a as never), `shapeKey ${a.type}`).toBe(client.shapeKey(a as never));
      expect(server.goalKey(a as never), `goalKey ${a.type}`).toBe(client.goalKey(a as never));
    }
    // ...and the sweep is not vacuous: the TARGETLESS arm is the one the bug
    // was, so both copies must answer `null` there and a key elsewhere.
    expect(client.goalKey(shapes[0] as never)).toBeNull();
    expect(client.goalKey(shapes[1] as never)).toBe('do:obje-letter');
  });

  it('LIFE-GRID-6 — and the RENDERED block agrees with the REJECT about which shape repeated', () => {
    // Behavioural, end to end across the wire: the same two picks must produce
    // the `<dangledGoal>` line server-side and the verdict client-side, keyed
    // the same way. Asserted together because either alone is satisfied by a
    // pair of copies that agree with themselves.
    return (async () => {
      const server = await import('../../functions/src/prompts/lifeStepBlocks');
      const client = await import('@/lib/life/optionGrid');
      const events = [
        { kind: 'decision', payload: { text: 'a', actionType: 'do', targetId: 'obje-letter' } },
        { kind: 'decision', payload: { text: 'b', actionType: 'do', targetId: 'obje-letter' } },
      ];
      const block = server.renderRecentActions(server.actionShapesFromEvents(events as never));
      expect(block).toContain('<dangledGoal shapes="do:obje-letter">');
      const verdict = client.gradeOptionSet(
        [{ type: 'do', targetId: 'obje-letter' }, { type: 'ask', targetId: null }] as never,
        client.takenShapeCounts(events as never),
      );
      expect(verdict.ok).toBe(false);
      if (verdict.ok) throw new Error('unreachable');
      expect(verdict.goal).toBe('do:obje-letter');
    })();
  });
});

describe('SRV-PROMPT-12 — the SHAPE sentence the ZOD seam writes is the one the RETRY seam writes', () => {
  /** ⚠ NO EXPIRY, and the drift it prevents is specific. The three option
   *  predicates feed two consumers: `ZRawNodeResponse`\u2019s `superRefine`, which
   *  needs a STRING, and `applyRequestShape`, which now needs a CODE because
   *  the retry hint is written server-side. The PREDICATE is single; only the
   *  wording is duplicated. If the two copies diverge, the SAME defect reaches
   *  the model described two different ways depending on which seam caught it \u2014
   *  a Zod message lands in the hint too, as `schema-issue`\u2019s `message`. */
  it('SRV-PROMPT-12 — every shape code renders the same sentence on both sides', async () => {
    const { shapeViolationMessage } = await import('@/lib/life/stepSchema');
    const { renderStepViolation, STEP_VIOLATION_FAMILY } = await import(
      '../../functions/src/prompts/lifeStepViolations'
    );
    const samples = [
      { code: 'question-carries-options', count: 2 },
      { code: 'continuation-option-count', count: 3 },
      { code: 'continuation-option-id', optionId: 'go-on' },
      { code: 'branch-option-count', count: 1 },
      { code: 'options-repeat-action-type', actionTypes: ['ask', 'ask', 'do'] },
      { code: 'options-none-active' },
      { code: 'option-ids-duplicated', optionIds: ['ask', 'do'] },
      { code: 'live-turn-missing-node' },
    ] as const;
    for (const v of samples) {
      // The server prefixes the list marker; the Zod message does not.
      expect(renderStepViolation(v as never), v.code).toBe(
        `  - ${shapeViolationMessage(v as never)}`,
      );
    }
    // ...and the sample list really is the whole `shape` family, so a code
    // added later cannot slip past by not being listed.
    const shapeCodes = Object.entries(STEP_VIOLATION_FAMILY)
      .filter(([, family]) => family === 'shape')
      .map(([code]) => code)
      .sort();
    expect(samples.map((v) => v.code).sort()).toEqual(shapeCodes);
  });
});

/**
 * ── SRV-PROMPT-3 — the retired STEP prompt modules leave no client copy ─────
 *
 * Eleven modules, the largest deletion this programme has made. Written against
 * the FILESYSTEM for the reason batch 4 recorded: a dynamic-import rejection
 * proves the bundler could not analyse the path, not that the file is gone.
 */
describe('SRV-PROMPT-3 — the retired life_step prompt modules are GONE', () => {
  it('SRV-PROMPT-3 — none of the eleven exists, and nothing under src/ imports one', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeFs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePath = require('node:path') as typeof import('node:path');
    const repoRoot = nodePath.resolve(__dirname, '..', '..');
    const lifeDir = nodePath.join(repoRoot, 'src', 'lib', 'life');
    const gone = [
      'prompts/step.ts',
      'prompts/stepLean.ts',
      'prompts/stepSchemaBlock.ts',
      'prompts/levelLadder.ts',
      'prompts/vocabRules.ts',
      'prompts/stepSpeech.ts',
      'prompts/worldStateBlocks.ts',
      'prompts/goalPrompt.ts',
      'prompts/storyStage.ts',
      'prompts/worldState.ts',
      'prompts/universe.ts',
      'npcNames.ts',
    ];
    for (const rel of gone) {
      expect(
        nodeFs.existsSync(nodePath.join(lifeDir, rel)),
        `src/lib/life/${rel} must be DELETED, not kept for reference`,
      ).toBe(false);
    }
    // ...and the check is not passing because the directory moved: the SPLIT
    // siblings, whose engine halves stayed, are still there.
    for (const kept of ['prompts/stepRender.ts', 'prompts/stepStreaks.ts', 'optionGrid.ts', 'canon.ts']) {
      expect(nodeFs.existsSync(nodePath.join(lifeDir, kept)), kept).toBe(true);
    }

    const walk = (dir: string): string[] =>
      nodeFs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.name.startsWith('.') || e.name === 'node_modules') return [];
        const full = nodePath.join(dir, e.name);
        return e.isDirectory() ? walk(full) : /\.tsx?$/.test(e.name) ? [full] : [];
      });
    const offenders = walk(nodePath.join(repoRoot, 'src')).filter((f) =>
      /from '[^']*(prompts\/(step|stepLean|stepSchemaBlock|levelLadder|vocabRules|stepSpeech|worldStateBlocks|goalPrompt|storyStage|worldState|universe)|life\/npcNames|\.\.\/npcNames)'/.test(
        nodeFs.readFileSync(f, 'utf8'),
      ),
    );
    expect(offenders, 'these still import a retired step prompt module').toEqual([]);
  });

  it('SRV-PROMPT-3 — the SPLIT modules kept their ENGINE half and lost their RENDER half', async () => {
    // Asserting BOTH directions, because "moved" quietly becoming "copied" is
    // what PRACTICE-OWN-8 exists to catch and a one-sided check cannot see it.
    const stepRender = await import('@/lib/life/prompts/stepRender');
    // ⚠ THE ESCAPES WENT TOO, and that was not the plan. They were kept at
    // first on the reading that "several client modules still escape model text
    // with them" — `git grep` said otherwise: `sceneLeaning.ts` was the last
    // caller and its renderer crossed in the same batch. A consumer list is a
    // claim until something checks it (LIFE-SCENE-2's own note, one file over).
    for (const goneName of [
      'renderEvent',
      'renderIdleChapter',
      'renderRecentEvents',
      'renderChapterPace',
      'renderScenePace',
      'escapeText',
      'escapeAttr',
    ]) {
      expect(goneName in stepRender, goneName).toBe(false);
    }
    // What is LEFT is the four constants `sceneLifecycle` enforces.
    expect(typeof stepRender.SCENE_FLOOR).toBe('number');
    expect(typeof stepRender.SCENE_OVERDUE).toBe('number');

    const streaks = await import('@/lib/life/prompts/stepStreaks');
    for (const goneName of ['renderPracticeCadence', 'renderProductionCadence', 'recentlyPracticedTargets']) {
      expect(goneName in streaks, goneName).toBe(false);
    }
    expect(typeof streaks.cyoaStreak).toBe('function');

    const grid = await import('@/lib/life/optionGrid');
    for (const goneName of ['renderRequiredType', 'renderRecentActions', 'optionRules', 'optionOutputContract', 'requiredTypeForTurn']) {
      expect(goneName in grid, goneName).toBe(false);
    }
    expect(typeof grid.gradeOptionSet).toBe('function');

    const canon = await import('@/lib/life/canon');
    for (const goneName of ['renderCanon', 'canonWorkingSetIds']) {
      expect(goneName in canon, goneName).toBe(false);
    }
    expect(typeof canon.resolveCanon).toBe('function');
    expect(typeof canon.canonViolations).toBe('function');

    const leaning = await import('@/lib/life/sceneLeaning');
    expect('renderSceneQuestion' in leaning).toBe(false);
    expect(typeof leaning.nextLeaningState).toBe('function');

    const clock = await import('@/lib/life/timeOfDay');
    expect('renderTimeOfDay' in clock).toBe(false);
    expect(typeof clock.advanceTimeOfDay).toBe('function');
  });
});
