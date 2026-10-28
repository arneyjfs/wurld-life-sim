/**
 * LIFE-SCENE-33 — the scene boundary is a container, not a row.
 *
 * OBSERVED (`.playthroughs/2026-08-05T09-05-04-618Z-Ines`, scene 2): the scene
 * declares `where = "La Biblioteca de los Cien Pasos"` and opens on *"Sweat
 * runs down your forehead while the stone vibrates under the weight of the
 * tide"* — the sea grotto of scene 1, carried straight through the boundary.
 *
 * The boundary was one `<event kind="scene_started">` row among nineteen
 * others, carrying the same weight as a beat, with nothing around it saying the
 * events above were over. On the turn a scene opens, those events are the ONLY
 * ones in the window — so the loudest thing in the block is the last thing that
 * happened somewhere the player has left.
 */
import { describe, expect, it } from 'vitest';
import type { LifeEvent } from '../helpers/stepTypes';
import { renderRecentEvents } from '../../prompts/lifeStepRender';

let seq = 0;
const ev = (kind: string, payload: Record<string, unknown>): LifeEvent =>
  ({ id: `e${(seq += 1)}`, kind, payload, createdAt: null } as unknown as LifeEvent);

const beat = (practiceText: string): LifeEvent =>
  ev('beat', { speaker: 'narrator', practiceText, nativeText: '' });

const started = (sceneId: string, title = 'A Walk Through the Stacks'): LifeEvent =>
  ev('scene_started', { sceneId, title });

const GROTTO = 'La marea golpea la piedra.';
const LIBRARY = 'La Biblioteca de los Cien Pasos';

describe('LIFE-SCENE-33 — the boundary partitions the event window', () => {
  it('LIFE-SCENE-33 — events before the active scene start are wrapped and marked OVER', () => {
    const out = renderRecentEvents(
      [beat(GROTTO), started('s2'), beat('Los estantes se alzan.')],
      's2',
      LIBRARY,
    );
    expect(out).toContain('<priorScene status="over">');
    expect(out).toContain('</priorScene>');
    // The old scene's beat is INSIDE the prior container, not loose.
    const prior = out.slice(out.indexOf('<priorScene'), out.indexOf('</priorScene>'));
    expect(prior).toContain(GROTTO);
    // The instruction lands with the data, not three blocks away.
    expect(prior).toMatch(/FINISHED/);
    expect(prior).toMatch(/NOT where the player is/);
  });

  it('LIFE-SCENE-33 — events after it are wrapped as the current scene, named by `where`', () => {
    const out = renderRecentEvents(
      [beat(GROTTO), started('s2'), beat('Los estantes se alzan.')],
      's2',
      LIBRARY,
    );
    expect(out).toContain(`<currentScene at="${LIBRARY}">`);
    const cur = out.slice(out.indexOf('<currentScene'), out.indexOf('</currentScene>'));
    expect(cur).toContain('Los estantes se alzan.');
    expect(cur).toContain('THE PLAYER IS HERE NOW');
    expect(cur).not.toContain(GROTTO);
  });

  it('LIFE-SCENE-33 — turn ZERO of a scene says the next beat OPENS it', () => {
    // The exact failing turn: the boundary is the newest event, so every beat
    // in the window belongs to a scene that is over.
    const out = renderRecentEvents([beat(GROTTO), started('s2')], 's2', LIBRARY);
    expect(out).toMatch(/has not started yet/);
    expect(out).toMatch(/the beat you write now is its FIRST/);
    expect(out).toMatch(/Do not resume the exchange above/);
  });

  it('LIFE-SCENE-33 — a scene already filling the window renders FLAT, byte-identical', () => {
    // Scope guard. This is the common mid-scene turn: the boundary has aged out
    // of the window, so there is no boundary to draw and the block must not
    // change shape (or the prompt would differ turn to turn for no reason).
    const events = [beat('a'), beat('b'), beat('c')];
    const out = renderRecentEvents(events, 's2', LIBRARY);
    expect(out).not.toContain('priorScene');
    expect(out).not.toContain('currentScene');
    expect(out.startsWith('<recentEvents>')).toBe(true);
  });

  it('LIFE-SCENE-33 — the boundary as the OLDEST event does not make an empty prior block', () => {
    const out = renderRecentEvents([started('s2'), beat('Los estantes.')], 's2', LIBRARY);
    expect(out).not.toContain('priorScene');
    expect(out).toContain('Los estantes.');
  });

  it('LIFE-SCENE-33 — a scene_started for a DIFFERENT scene is not the boundary', () => {
    // Only the ACTIVE scene's start divides "over" from "now". An older
    // boundary still in the window belongs to history on both sides of it.
    const out = renderRecentEvents([beat(GROTTO), started('s1'), beat('x')], 's2', LIBRARY);
    expect(out).not.toContain('priorScene');
  });

  it('LIFE-SCENE-33 — no scene / no where degrades to the flat list', () => {
    expect(renderRecentEvents([beat('a'), started('s2')], null, null)).not.toContain('priorScene');
    const out = renderRecentEvents([beat(GROTTO), started('s2'), beat('x')], 's2', null);
    expect(out).toContain('<currentScene>');
    expect(out).toContain('<priorScene status="over">');
  });

  it('LIFE-SCENE-33 — an empty window is still the self-closing tag', () => {
    expect(renderRecentEvents([], 's2', LIBRARY)).toBe('<recentEvents/>');
    // Events that render to nothing (LIFE-CTX-16 drops several kinds) count as
    // empty too — an empty `<recentEvents>…</recentEvents>` would be noise.
    expect(renderRecentEvents([ev('npc_introduced', { npcId: 'n' })], 's2', LIBRARY)).toBe(
      '<recentEvents/>',
    );
  });
});
