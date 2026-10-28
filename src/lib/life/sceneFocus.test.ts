/**
 * LIFE-SCENE-2 — the scene rotation.
 *
 * Written against a measured failure, not a hypothesis: a ten-scene playthrough
 * whose history read back as one fact rediscovered ten times, while signals 1-4
 * all reported healthy. See the header of `sceneFocus.ts`.
 *
 * ⚠ THE RENDERER ROWS MOVED (SRV-PROMPT-3 / PRACTICE-OWN-8). `renderSceneFocus`
 * and `renderRecentSubjects` are PROMPT TEXT whose only non-test consumer was
 * `prompts/sceneOpen.ts`, so batch 4 moved them whole into
 * `functions/src/prompts/lifeSceneOpen.ts` and their assertions with them, to
 * `functions/src/__tests__/lifeSceneOpen.test.ts`. They were not dropped: the
 * server copy had no coverage of its own, and deleting them would have retired
 * these renderers' only tests at the moment they became the only copy.
 *
 * What stays here is `focusForScene`, the ROTATION — engine arithmetic over
 * `sceneCount` that decides whose scene it is before any prompt exists.
 */
import { describe, expect, it } from 'vitest';
import { focusForScene } from './sceneFocus';
import type { CastMember } from '@/types/lifeState';

const member = (id: string, tier: CastMember['tier']): CastMember => ({
  id,
  name: id.toUpperCase(),
  known: '',
  tier,
  voice: '',
  standing: 0,
  ties: [],
});

const CAST = [
  member('pierre', 'principal'),
  member('marcel', 'principal'),
  member('giraud', 'principal'),
  member('sophie', 'regular'),
];

describe('focusForScene', () => {
  it('LIFE-SCENE-2 — cycles every principal before repeating one', () => {
    const seen = [0, 1, 2].map((i) => focusForScene(i, CAST)?.castId);
    expect(seen).toEqual(['pierre', 'marcel', 'giraud']);
  });

  it('LIFE-SCENE-2 — every (n+1)th scene belongs to nobody', () => {
    expect(focusForScene(3, CAST)).toBeNull();
    expect(focusForScene(7, CAST)).toBeNull();
  });

  it('LIFE-SCENE-2 — no principal owns more than its share of a long run', () => {
    // The failure this exists for: ONE person was the subject of ten scenes
    // out of ten, because the front's driver is the most salient thing in the
    // planner's context and nothing rotated it.
    const counts = new Map<string, number>();
    for (let i = 0; i < 40; i += 1) {
      const k = focusForScene(i, CAST)?.castId ?? '(ordinary)';
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([10, 10, 10, 10]);
  });

  it('regulars never carry a scene — they have no ambition to turn on', () => {
    for (let i = 0; i < 12; i += 1) {
      expect(focusForScene(i, CAST)?.castId).not.toBe('sophie');
    }
  });

  it('a cast with no principals yields ordinary scenes, not a crash', () => {
    expect(focusForScene(0, [member('sophie', 'regular')])).toBeNull();
    expect(focusForScene(3, [])).toBeNull();
  });

  it('is deterministic in the scene index', () => {
    expect(focusForScene(9, CAST)).toEqual(focusForScene(9, CAST));
  });
});
