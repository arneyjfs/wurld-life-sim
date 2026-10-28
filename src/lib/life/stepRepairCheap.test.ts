/**
 * LIFE-NODE-16e / LIFE-NODE-19 — two defects that each cost a whole ~21k-token
 * `life_step` turn for a spelling choice.
 *
 * Found by sweeping the CALL LOG of two full playthrough runs rather than by
 * reading code: the retry column is where the engine's real cost lives, and
 * nothing had looked at it. 3 of the 19 step retries in one run.
 *
 * `LIFE-NODE-16` already settled the principle — repair what has ONE correct
 * reading, retry what needs regenerating — and it explicitly rules the third
 * candidate found in that sweep OUT of scope: a branch with two options of the
 * same `actionType` is NOT repaired, because you cannot invent the missing
 * kind. That rule sets its own threshold for revisiting (~15% of calls);
 * measured here at 1.5% and 4.8%, so it stands and those keep spending a
 * retry as designed.
 */
import { describe, expect, it } from 'vitest';
import { repairStepResponse, ZRawNodeResponse } from './stepSchema';
import { parseUpToBalance } from './generateStepOptions';

const beat = () => ({
  speaker: 'narrator',
  speakerName: null,
  npcId: null,
  practiceText: 'La pluie tombe sur les tuiles.',
  nativeText: 'Rain falls on the tiles.',
  complexWords: [],
  wordTranslations: {},
});

const opt = (id: string, actionType: string) => ({
  id,
  nativeText: `Do ${id}`,
  actionType,
});

const response = (over: Record<string, unknown> = {}) => ({
  node: { kind: 'branch', beats: [beat()] },
  options: [opt('a', 'do'), opt('b', 'ask'), opt('c', 'observe')],
  logLine: 'Something happened.',
  ...over,
});

describe('LIFE-NODE-16e — `"resolved": null` means the same as omitting it', () => {
  it('LIFE-NODE-16e — an explicit null no longer costs the turn', () => {
    const raw = response({ scene: { resolved: null } });
    // Before: `scene.resolved — expected object, received null`, whole turn lost.
    expect(ZRawNodeResponse.safeParse(repairStepResponse(raw)).success).toBe(true);
  });

  it('LIFE-NODE-16e — a REAL resolved object still comes through', () => {
    const raw = response({
      scene: { resolved: { endingKey: 'permit-granted', outcomeLine: 'Tu as obtenu le permis.' } },
    });
    const parsed = ZRawNodeResponse.safeParse(repairStepResponse(raw));
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.scene?.resolved?.endingKey : null).toBe('permit-granted');
  });

  it('LIFE-NODE-16e — a scene block with no nulls is passed through unchanged', () => {
    const raw = response({ scene: { progressNote: 'still going' } });
    expect(repairStepResponse(raw)).toBe(raw);
  });
});

describe('LIFE-NODE-19 — one stray closing brace does not cost the turn', () => {
  it('LIFE-NODE-19 — parses a complete object followed by an extra }', () => {
    // THE MEASURED SIGNATURE, twice in one run: `…}\n  ]\n}\n}`.
    const out = parseUpToBalance('{"node":{"kind":"branch"},"options":[]}\n}');
    expect(out).toEqual({ node: { kind: 'branch' }, options: [] });
  });

  it('LIFE-NODE-19 — a brace inside a STRING is not miscounted', () => {
    const out = parseUpToBalance('{"logLine":"a } inside \\" a string"}\n}');
    expect(out).toEqual({ logLine: 'a } inside " a string' });
  });

  it('LIFE-NODE-19 — a TRUNCATED response is NOT repaired', () => {
    // More openers than closers: the content is genuinely missing and inventing
    // it is a guess. Retry is correct here — that is the LIFE-NODE-16 line.
    expect(parseUpToBalance('{"node":{"kind":"branch","beats":[{"speaker":"nar')).toBeNull();
  });

  it('LIFE-NODE-19 — junk that is not JSON at all stays null', () => {
    expect(parseUpToBalance('I am sorry, I cannot do that.')).toBeNull();
    expect(parseUpToBalance('')).toBeNull();
  });
});
