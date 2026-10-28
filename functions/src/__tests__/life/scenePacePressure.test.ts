/**
 * LIFE-ARC-PACE-5 — what keeps a scene moving after the DAY rule was deleted.
 *
 * `DAY_PACE_RULE` was removed 2026-08-05 (see the note where it used to live in
 * `stepRender.ts`). The owner's question when approving it was the right one:
 * *"As long as you don't think the pacing will slow down."*
 *
 * It does not, because the turn window was stated TWICE and the survivor is the
 * better of the two — the deleted rule said 6-9 while `WHAT A SCENE IS` says
 * 6-12, and 6/9/12 are the thresholds `renderScenePace` actually escalates on.
 * The deleted rule also carried a line that FORBADE early resolution ("a day
 * that resolves while the narration is still describing mid-morning reads as
 * broken"), so its removal should tighten pacing rather than loosen it.
 *
 * This test pins the three surviving sources of pressure. Delete any one of
 * them and a scene has nothing telling it to end — which is the failure the
 * whole `LIFE-ARC-PACE-*` family exists to prevent, and it would now be silent.
 */
import { describe, expect, it } from 'vitest';
import { lifeStepSystemInstruction } from '../../prompts/lifeStep';
import { renderScenePace, SCENE_IN_RANGE, SCENE_DUE, SCENE_OVERDUE } from '../../prompts/lifeStepRender';

/** The RULES live in the system instruction, not the per-turn user prompt —
 *  `buildLifeStepPrompt` is the turn, this is the contract. */
const si = lifeStepSystemInstruction({
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  systemLanguage: 'English',
  difficulty: 3,
});

describe('LIFE-ARC-PACE-5 — the scene still has a clock', () => {
  /**
   * LIFE-SI-LEAN-5 — the NUMBERS are stated in the `full` SI and pinned there.
   *
   * They were not ported into the lean variant, and the reason is that this
   * test's own premise — *"delete any one of them and a scene has nothing
   * telling it to end"* — over-counted. The window is not one source, it is two:
   * the SI's restatement, and `renderScenePace`, which is sent EVERY TURN and
   * carries the same 6/9/12 thresholds with an escalating stage. The lean SI
   * keeps the pointer (*"Read it back against &lt;scenePace&gt;"*) and drops the
   * duplicate, so the clock is still on the wire — the two assertions below are
   * the ones that prove it.
   *
   * Stated because it cuts against the change as well as for it: **no scene
   * resolves in EITHER arm.** Every scene of every archived run, both prompts,
   * ends "cut at the 8-turn ceiling" (`LIFE-CONFORM-2`). Whatever this pressure
   * is doing, it is not ending scenes, and restating it in the SI was not what
   * was missing.
   */

  it('the shipped SI points at the per-turn clock instead of restating it', () => {
    expect(si).toMatch(/<scenePace>/);
  });

  it('the SI still demands sceneProgress every turn', () => {
    expect(si).toMatch(/sceneProgress/);
  });

  it('renderScenePace escalates through three named stages', () => {
    expect(renderScenePace(SCENE_IN_RANGE)).toContain('stage="in-range"');
    expect(renderScenePace(SCENE_DUE)).toContain('stage="due"');
    expect(renderScenePace(SCENE_OVERDUE)).toContain('stage="overdue"');
    // and asks for the resolution outright at the top
    expect(renderScenePace(SCENE_OVERDUE)).toMatch(/scene\.resolved/);
  });

  it('says nothing below the window — the early game is deliberately unnudged', () => {
    expect(renderScenePace(SCENE_IN_RANGE - 1)).toBe('');
  });
});

describe('LIFE-ARC-PACE-5 — the day framing is gone and stays gone', () => {
  it('the SI no longer tells the model a scene is a day', () => {
    // A scene is not a day any more. Left in, this asks for a whole day's arc
    // inside a much smaller unit, which is pressure to keep going.
    expect(si).not.toMatch(/one scene IS one day/i);
    expect(si).not.toMatch(/morning → afternoon → evening/);
  });

  it('the SI no longer forbids resolving "too early in the day"', () => {
    expect(si).not.toMatch(/mid-morning/i);
  });

  it('the SI does not reference a <dayPace> block, which never existed', () => {
    // The rule advertised a tag the renderer has never emitted.
    expect(si).not.toContain('<dayPace');
    expect(si).toContain('<scenePace');
  });
});
