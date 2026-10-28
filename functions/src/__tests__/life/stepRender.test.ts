/**
 * MOVED from `src/lib/life/prompts/` by SRV-PROMPT-8..13 batch 8 (SRV-PROMPT-3:
 * a retired client prompt module is deleted and its tests MOVE rather than die).
 * The assertions are unchanged; only the imports point at the server modules.
 */
import { describe, expect, it } from 'vitest';
import {
  renderScenePace,
  SCENE_IN_RANGE,
  SCENE_DUE,
  SCENE_OVERDUE,
  CHAPTER_IN_RANGE,
} from '../../prompts/lifeStepRender';

/**
 * LIFE-ARC-PACE-4 / LIFE-SCENE-25 — the SCENE's budget, stated in a number the
 * model can see.
 *
 * The step SI has always asked for a scene to be brought to a close, but
 * nothing told it which turn of the scene it was on — the same defect
 * `<chapterPace>` exists to fix one level up. Scenes therefore ended wherever a
 * completionTrigger happened to fire.
 *
 * The block used to talk about a DAY, because a scene WAS a day (LIFE-DAY-1) —
 * hence "move the narration into the evening". A scene is now a SUBPLOT and a
 * player may run three in a sitting, so reaching for evening at turn 9 of the
 * first would break the clock rather than the scene.
 */
describe('LIFE-ARC-PACE-4 / LIFE-SCENE-25 — renderScenePace', () => {
  it('is silent below the window — a scene cut short is its own failure', () => {
    expect(renderScenePace(0)).toBe('');
    expect(renderScenePace(SCENE_IN_RANGE - 1)).toBe('');
  });

  it('opens at the window and escalates through due and overdue', () => {
    expect(renderScenePace(SCENE_IN_RANGE)).toContain('stage="in-range"');
    expect(renderScenePace(SCENE_DUE)).toContain('stage="due"');
    expect(renderScenePace(SCENE_OVERDUE)).toContain('stage="overdue"');
  });

  it('carries the observable count, which is the whole point', () => {
    expect(renderScenePace(SCENE_DUE)).toContain(`turns="${SCENE_DUE}"`);
  });

  it('asks for the SUBJECT to land, not for the evening', () => {
    // A scene is no longer a day, so the time-of-day cue is actively wrong:
    // three scenes in one sitting would each reach for dusk.
    const out = renderScenePace(SCENE_DUE);
    expect(out).not.toMatch(/evening/i);
    expect(out).toMatch(/resolution beat/i);
    expect(out).toMatch(/scene\.resolved/);
  });

  it('LIFE-SCENE-25 — names the SUBJECT when the scene declared one', () => {
    // "Bring it to an ending" points at a specific thing, not at the scene in
    // general — which is the whole reason `subject` exists as its own field.
    const out = renderScenePace(SCENE_DUE, 'getting the key back');
    expect(out).toContain('getting the key back');
    // …and degrades cleanly when a pre-2026-08 scene doc has none.
    expect(renderScenePace(SCENE_DUE)).toContain('stage="due"');
    expect(renderScenePace(SCENE_DUE, '   ')).not.toContain('subject is');
  });

  it('LIFE-SCENE-26 — publishes the FLOOR alongside the ceiling', () => {
    expect(renderScenePace(SCENE_DUE)).toContain('floor="4"');
  });

  it('bounds the SCENE well inside the CHAPTER — a chapter spans several scenes', () => {
    // The 2026-08-01 regression was these two collapsing onto each other.
    expect(SCENE_OVERDUE).toBeLessThan(CHAPTER_IN_RANGE);
  });
});
