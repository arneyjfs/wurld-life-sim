/**
 * MOVED from `src/lib/life/prompts/` by SRV-PROMPT-8..13 batch 8 (SRV-PROMPT-3:
 * a retired client prompt module is deleted and its tests MOVE rather than die).
 * The assertions are unchanged; only the imports point at the server modules.
 */
import { describe, expect, it } from 'vitest';
import {
  CHAPTER_DUE,
  CHAPTER_IN_RANGE,
  CHAPTER_OVERDUE,
  renderChapterPace,
} from '../../prompts/lifeStepRender';

/**
 * LIFE-ARC-PACE-1. Chapters never ended in practice, and the cause was
 * mechanical rather than a weak prompt: the SI asked for "roughly 25-35 player
 * turns … don't let one drag past ~40" while nothing ever told the model which
 * turn it was on. The rule was expressed in a quantity the model could not
 * observe. These pin the observable half.
 */
describe('renderChapterPace — LIFE-ARC-PACE-1', () => {
  it('says NOTHING before the window — a chapter concluded early is its own failure', () => {
    expect(renderChapterPace(0)).toBe('');
    expect(renderChapterPace(CHAPTER_IN_RANGE - 1)).toBe('');
  });

  it('opens at the window with the turn count the model could not otherwise know', () => {
    const out = renderChapterPace(CHAPTER_IN_RANGE);
    expect(out).toContain(`turns="${CHAPTER_IN_RANGE}"`);
    expect(out).toContain('stage="in-range"');
    // In range is guidance about SCOPE, not an instruction to wrap up.
    expect(out).not.toContain('concluding');
  });

  it('escalates to due, and names the field that actually ends a chapter', () => {
    const out = renderChapterPace(CHAPTER_DUE);
    expect(out).toContain('stage="due"');
    // arcStage "concluding" is the ONLY signal that closes a chapter
    // (useChapterCompletion), and it defaults to "continues" when omitted — so
    // the directive has to name it explicitly or nothing happens.
    expect(out).toContain('arcStage');
    expect(out).toContain('concluding');
  });

  it('escalates to overdue past the ceiling and forbids opening new threads', () => {
    const out = renderChapterPace(CHAPTER_OVERDUE);
    expect(out).toContain('stage="overdue"');
    expect(out).toContain('PAST its');
    expect(out).toContain('scene.resolved');
    expect(out).toMatch(/Do not open a new thread/);
  });

  it('never lapses — the counter is unbounded, unlike the capped entry list', () => {
    // The pace counter is `storyLog.turns`, a plain integer, NOT
    // `entries.length` (which capStoryLog pins at STORY_LOG_CAP = 60). A
    // runaway chapter therefore keeps escalating instead of going quiet.
    expect(renderChapterPace(60)).toContain('stage="overdue"');
    expect(renderChapterPace(200)).toContain('stage="overdue"');
    expect(renderChapterPace(200)).toContain('turns="200"');
  });

  it('thresholds are ordered', () => {
    expect(CHAPTER_IN_RANGE).toBeLessThan(CHAPTER_DUE);
    expect(CHAPTER_DUE).toBeLessThan(CHAPTER_OVERDUE);
  });
});

/**
 * LIFE-ARC-PACE-3. `<chapterPace>` is inert on its own: a chapter ends only via
 * `scene.resolved.arcStage = "concluding"`, which needs an ACTIVE scene,
 * which needs a hook the model offered. Across two harness runs (25 turns and
 * 12 turns, real Gemini) the model offered ZERO hooks and
 * `<scene status="idle"/>` rendered on every turn — so no chapter could have
 * ended whatever the pace block said.
 */
