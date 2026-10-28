import { describe, it, expect } from 'vitest';
import { SCENE_LOG_CAP, buildSceneLog } from './sceneLog';
import type { LifeEvent } from '@/types/firestore';

const ev = (kind: string, payload: Record<string, unknown> = {}): LifeEvent =>
  ({ id: `e-${Math.random()}`, kind, payload }) as unknown as LifeEvent;

const beat = (speakerName: string | null, nativeText: string) =>
  ev('beat', { speaker: speakerName ? 'npc' : 'narrator', speakerName, nativeText, practiceText: 'x' });

describe('LIFE-ARCH-2.2 — the scene log carries its whos', () => {
  it('attributes every NPC line to the character who said it', () => {
    // The defect: an unattributed log made sceneClose guess who redirected the
    // player, and it guessed a character who was not in the scene.
    const out = buildSceneLog([
      ev('scene_started', {}),
      beat('Elder Kaito', 'Go north and find Miki.'),
      beat('Hina', 'Report the blight to the Elder.'),
    ]);
    expect(out).toEqual([
      'Elder Kaito: Go north and find Miki.',
      'Hina: Report the blight to the Elder.',
    ]);
  });

  it('a decision is the PLAYER, always — that is what a decision is', () => {
    const out = buildSceneLog([ev('scene_started', {}), ev('decision', { text: 'Ask about the paper' })]);
    expect(out).toEqual(['You: Ask about the paper']);
  });

  it('an unnamed beat is narration, not an anonymous character', () => {
    expect(buildSceneLog([ev('scene_started', {}), beat(null, 'The wind picks up.')]))
      .toEqual(['Narration: The wind picks up.']);
  });
});

describe('LIFE-ARCH-2.2 — the window is the SCENE, not the last twelve events', () => {
  it('starts at the most recent scene_started, dropping the previous scene', () => {
    const out = buildSceneLog([
      ev('scene_started', {}),
      beat('Old', 'belongs to the previous scene'),
      ev('scene_started', {}),
      beat('New', 'belongs to this one'),
    ]);
    expect(out).toEqual(['New: belongs to this one']);
  });

  it('keeps a whole 12-turn scene — the old 12-EVENT window kept its last third', () => {
    // 12 turns x (2 beats + 1 decision) = 36 events. Under the old rule the
    // close model saw 12 of those and wrote the scene's history from its tail,
    // which is exactly the observed failure: ending right, opening invented.
    const events: LifeEvent[] = [ev('scene_started', {})];
    for (let t = 0; t < 12; t += 1) {
      events.push(beat('Bruno', `npc line ${t}`), beat(null, `narration ${t}`), ev('decision', { text: `pick ${t}` }));
    }
    const out = buildSceneLog(events);
    expect(out).toHaveLength(36);
    expect(out[0]).toBe('Bruno: npc line 0');
    expect(out.at(-1)).toBe('You: pick 11');
  });

  it('a runaway scene is capped, and the cap keeps the TAIL', () => {
    const events: LifeEvent[] = [ev('scene_started', {})];
    for (let i = 0; i < SCENE_LOG_CAP + 20; i += 1) events.push(beat('X', `line ${i}`));
    const out = buildSceneLog(events);
    expect(out).toHaveLength(SCENE_LOG_CAP);
    expect(out.at(-1)).toBe(`X: line ${SCENE_LOG_CAP + 19}`);
  });

  it('no scene_started at all falls back to the whole window, never to nothing', () => {
    // A compacted log that lost its marker must still describe a scene; an
    // empty log produces a confident history line about events nobody saw.
    const out = buildSceneLog([beat('Bruno', 'something happened')]);
    expect(out).toEqual(['Bruno: something happened']);
  });

  it('skips events that are neither beats nor decisions, and empty lines', () => {
    const out = buildSceneLog([
      ev('scene_started', {}),
      ev('correction', { text: 'graded answer' }),
      beat('Bruno', '   '),
      beat('Bruno', 'real line'),
    ]);
    expect(out).toEqual(['Bruno: real line']);
  });
});
