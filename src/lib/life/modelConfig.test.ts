/**
 * LIFE-TEMP-1..4: every life-sim Gemini call rides a temperature matched to
 * what it is generating. These assert the tiering itself AND that each call
 * site is wired to the right tier — the failure mode this guards against is a
 * new generator copy-pasting `temperature: LIFE_TEMPERATURE` onto a graded
 * path, where creative variance produces ambiguous questions.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIFE_BACKDROP_MODEL,
  LIFE_TEMPERATURE,
  LIFE_TEMPERATURE_ART,
  LIFE_TEMPERATURE_GRADED,
} from './modelConfig';

const read = (f: string): string =>
  readFileSync(join(__dirname, f), 'utf8');

/**
 * LIFE-BACKDROP-30 — the backdrop SYSTEM INSTRUCTION moved to the server, so
 * the guards over its CONTENT follow it. They stay in this file rather than
 * moving to `functions/src/__tests__/` so `git grep LIFE-BACKDROP-11` still
 * lands on every assertion about the backdrop prompt in one place, alongside
 * the call-site wiring checks below that are still client-side.
 *
 * Read by path, not imported: this is the `app` vitest project and the prompt
 * is in the `functions` one. The assertion is over the file's text either way.
 */
const readServerPrompt = (f: string): string =>
  readFileSync(join(__dirname, '..', '..', '..', 'functions', 'src', 'prompts', f), 'utf8');

describe('LIFE-TEMP-1..4 — temperature tiers', () => {
  it('LIFE-TEMP-1/2 — graded generation is markedly cooler than creative', () => {
    expect(LIFE_TEMPERATURE).toBeGreaterThanOrEqual(0.8);
    expect(LIFE_TEMPERATURE_GRADED).toBeLessThan(0.5);
    expect(LIFE_TEMPERATURE_GRADED).toBeGreaterThan(0);
  });

  it('LIFE-TEMP-3 — art sits between graded and creative', () => {
    expect(LIFE_TEMPERATURE_ART).toBeGreaterThan(LIFE_TEMPERATURE_GRADED);
    expect(LIFE_TEMPERATURE_ART).toBeLessThan(LIFE_TEMPERATURE);
  });

  it('LIFE-TEMP-2 — the graded generator does NOT use the creative tier', () => {
    const src = read('runGradedQuestionGenerate.ts');
    expect(src).toContain('temperature: LIFE_TEMPERATURE_GRADED');
    expect(src).not.toMatch(/temperature: LIFE_TEMPERATURE,/);
  });

  it('LIFE-TEMP-3 — avatar + backdrop generation ride the art tier', () => {
    for (const f of ['generateNpcAvatar.ts', 'generateBackdrop.ts']) {
      expect(read(f), f).toContain('temperature: LIFE_TEMPERATURE_ART');
    }
  });

  it('LIFE-BACKDROP-11 — backdrop generation rides gemini-3.5-flash-lite', () => {
    // Measured 2026-07-25 against real Gemini on three backdrops: with the
    // LIFE-BACKDROP-11 shape budget applied, 3.5-flash-lite produced the
    // best-composed SVGs of the three candidates at $0.007400/backdrop —
    // 41% below the previous gemini-3-flash-preview @ medium-thinking
    // baseline ($0.012547), and without the UTF-8 mojibake the preview
    // tier shipped ("PÃĒtisserie").
    expect(LIFE_BACKDROP_MODEL).toBe('gemini-3.5-flash-lite');
  });

  it('LIFE-BACKDROP-11 — the backdrop prompt carries a ~40 node budget + serialisation rules', () => {
    const si = readServerPrompt('lifeBackdrop.ts');
    // Node budget: ~40 is the chosen density. Earlier I concluded budgets
    // were inherently harmful, but that rested on a contaminated
    // measurement (the generator appended its own 30-node cap on top of
    // the file's prompt, so nothing changed in the file ever moved the
    // result). Re-measured cleanly, a stated target is fine.
    expect(si).toContain('SHAPE BUDGET');
    expect(si).toMatch(/HARD CAP: 40 drawing nodes/);
    // Animations must survive the budget — they are what make a backdrop
    // feel alive (chimney smoke, a drifting cloud) and they cost no
    // drawing nodes.
    expect(si).toContain('ANIMATIONS ARE FREE');
    // Geometry must stay inside 0..1000: the stage clips hard at the
    // canvas edge, so anything outside reads as a broken cut-off.
    expect(si).toContain('STAY INSIDE THE CANVAS');
    // Structural coherence: observed a castle whose spire covered only
    // the left third, overhung the wall by 120 units into open air, and
    // left the central tower uncapped.
    expect(si).toContain('STRUCTURAL COHERENCE');
    expect(si).toContain('drawing node');
    // Serialisation cuts tokens without touching what is drawn.
    expect(si).toContain('SERIALISATION');
    expect(si).toContain('INTEGERS only');
  });

  it('LIFE-BACKDROP-11 — backdrop generation requests NO native thinking', () => {
    // 'medium' cost 2365 thinking tokens/backdrop (59% of the bill) and
    // drew LESS for it — 25 nodes vs 43 at 'minimal'. Worse on both
    // axes, so this must not drift back.
    const src = read('generateBackdrop.ts');
    expect(src).toContain("thinkingLevel: 'minimal'");
    expect(src).not.toContain("thinkingLevel: 'medium'");
  });

  it('LIFE-SAGA — the saga generator requests no native thinking', () => {
    // 'high' cost 920 thinking tokens/call (32%) and 2x the latency for
    // no measurable gain; it also drifted toward a named villain.
    const src = read('runSagaOpen.ts');
    expect(src).toContain("thinkingLevel: 'minimal'");
    expect(src).not.toContain("thinkingLevel: 'high'");
  });

  it('LIFE-STEP — the per-turn generator requests no native thinking', () => {
    // The per-turn call is the one the player waits on. 'medium' cost
    // 2.9x the latency (8557ms vs 2912ms) and 16.5% more, for identical
    // 4/4 schema validity.
    const src = read('generateStepOptions.ts');
    expect(src).toContain("thinkingLevel: 'minimal'");
    expect(src).not.toContain("thinkingLevel: 'medium'");
  });

  it('LIFE-BACKDROP-12 — the backdrop SI specifies contain-fit, top-anchored + bleed plate', () => {
    const si = readServerPrompt('lifeBackdrop.ts');
    expect(si).toContain('viewBox="0 0 1000 1000"');
    expect(si).toContain('xMidYMin meet');
    // The bleed rect is what lets the stage paint the letterbox with a
    // colour that continues the backdrop instead of app chrome.
    expect(si).toContain('class="bleed"');
    // The plate must not be mistaken for the sky. Observed: a train
    // station whose first real shape was at y=320, leaving the top
    // third bare plate — it read as the drawing sliding down the frame.
    expect(si).toContain('NOT the sky');
    // Square canvas: chosen for how it sits in the stage on both a wide
    // desktop and a tall phone. (An earlier note here claimed square
    // produced sparser backdrops — that came from the contaminated
    // measurement described in LIFE-BACKDROP-11 and does not hold.)
    expect(si).not.toContain('0 0 1200 800');
  });

  it('LIFE-THINK-1 — NO life-sim generator requests native thinking', () => {
    // Measured site by site (scripts/measure/thinking_ab.py, deleted 2026-09-29; real prompts
    // dumped from source by dump_life_prompts.mts). Every one scored
    // IDENTICALLY at minimal and at the level it used to run, while the
    // higher level cost 1.7x-2.8x the price and 2.6x-5.1x the latency.
    //
    // This is a whole-directory assertion rather than one per file on
    // purpose: the failure mode is a NEW generator being added with a
    // copy-pasted `thinkingLevel: 'high'`, which a per-file list would not
    // catch. Reasoning in this app lives in guided OUTPUT, not in billed and
    // discarded thinking tokens.
    const dir = join(__dirname);
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    const offenders: string[] = [];
    for (const f of files) {
      // Strip comments first: prose that MENTIONS a level (a design note, a
      // changelog line) is not a call site, and matching it would make the
      // guard cry wolf — which is how a guard stops being trusted.
      const src = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      const m = src.match(/thinkingLevel: '(?!minimal')([a-z]+)'/);
      if (m) offenders.push(`${f}: ${m[1]}`);
    }
    expect(offenders).toEqual([]);
    // non-vacuous: the sweep must actually be looking at generators
    expect(files.length).toBeGreaterThan(10);
  });

  it('LIFE-TEMP-4 — every creative story generator rides the creative tier', () => {
    for (const f of [
      'runSagaOpen.ts', 'runSceneOpen.ts', 'runSceneClose.ts',
      'runWorldArcGenerate.ts', 'generateStepOptions.ts', 'generateBio.ts',
      'generateNpcProfile.ts',
    ]) {
      expect(read(f), f).toContain('temperature: LIFE_TEMPERATURE,');
    }
  });
});
