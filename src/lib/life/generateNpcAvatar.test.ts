// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({ generateGemini: vi.fn() }));
vi.mock('../log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import { generateGemini } from '../gemini';
import { generateNpcAvatar } from './generateNpcAvatar';
import { LIFE_NPC_AVATAR_MODEL } from './modelConfig';

/**
 * SRV-PROMPT-8..13 batch 2 — the two avatar calls send a spec and no prose.
 *
 * ⚠ THIS FILE IS NEW. `generateNpcAvatar.ts` had no test file at all before
 * this batch — the only thing asserting anything about the parts path was
 * `avatar/assemble.test.ts`, one level down, which never saw a request. So the
 * migration lands the first coverage this call site has had, which is worth
 * stating rather than implying these assertions were merely relocated.
 *
 * `generateNpcAvatar` makes up to TWO calls: the cheap PARTS pick first
 * (`life_npc_avatar_params`, ~120 output tokens) and the direct SVG draw
 * (`life_npc_avatar`, ~8x the output) only as the fallback. Both are asserted,
 * because a migration that moved one and not the other would look green here.
 */

const generateGeminiMock = generateGemini as unknown as ReturnType<typeof vi.fn>;

/** The request the Nth (default first) call was made with. Throws rather than
 *  returning undefined so a missing call fails loudly on the right line. */
function callArg(n = 0): Record<string, unknown> {
  const call = generateGeminiMock.mock.calls[n];
  if (!call) throw new Error(`generateGemini was not called ${n + 1} time(s)`);
  return call[0] as Record<string, unknown>;
}

const INPUT = {
  name: 'Madame Roux',
  role: 'florist who delivers coded scripts',
  worldVibe: 'theatrical espionage',
};

/** A params answer the local assembler can actually build from. */
const GOOD_PARAMS = JSON.stringify({
  bg: '#efe', skin: '#f4c9a3',
  hair: { style: 'bob', color: '#6b4a2f' },
  eyes: 'almond', brows: 'neutral', mouth: 'smile',
  outfit: { style: 'apron', color: '#8a8' },
});

const OK_SVG = '<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="50" fill="#eee"/></svg>';

beforeEach(() => {
  generateGeminiMock.mockReset();
});

describe('generateNpcAvatar — the PARTS call (life_npc_avatar_params)', () => {
  beforeEach(() => {
    generateGeminiMock.mockResolvedValue(GOOD_PARAMS);
  });

  it('SRV-PROMPT-8..13 — sends NO prompt text and NO system instruction', async () => {
    await generateNpcAvatar(INPUT);
    const req = callArg();
    expect(req).not.toHaveProperty('prompt');
    expect('systemInstruction' in req).toBe(false);
    // Nothing recognisable from either old client prompt survives on the wire —
    // not under another key, not concatenated in. `witchHat` is the tell for
    // the parts table, which used to be rendered into the SI in the bundle.
    const wire = JSON.stringify(req);
    expect(wire).not.toContain('witchHat');
    expect(wire).not.toContain('<worldVibe>');
    expect(wire).not.toContain("Choose this character's parts");
  });

  it('SRV-PROMPT-8..13 — sends a life_npc_avatar_params spec carrying the FIELDS', async () => {
    await generateNpcAvatar(INPUT);
    expect(callArg().promptSpec).toEqual({
      kind: 'life_npc_avatar_params',
      name: 'Madame Roux',
      role: 'florist who delivers coded scripts',
      worldVibe: 'theatrical espionage',
    });
  });

  it('SRV-PROMPT-8..13 — a null role is ABSENT from the spec, never null', async () => {
    await generateNpcAvatar({ name: 'Léo', role: null, worldVibe: 'noir city' });
    const spec = callArg().promptSpec as Record<string, unknown>;
    expect(spec).toEqual({
      kind: 'life_npc_avatar_params',
      name: 'Léo',
      worldVibe: 'noir city',
    });
    expect('role' in spec).toBe(false);
  });

  it('SRV-PROMPT-5 — generation parameters STAY at the call site', async () => {
    await generateNpcAvatar(INPUT);
    const req = callArg();
    expect(req.model).toBe(LIFE_NPC_AVATAR_MODEL);
    expect(req.thinkingLevel).toBe('minimal');
    expect(req.responseMimeType).toBe('application/json');
    expect(typeof req.temperature).toBe('number');
    expect(req.category).toBe('life_npc_avatar_params');
    const spec = req.promptSpec as Record<string, unknown>;
    for (const k of ['model', 'thinkingLevel', 'temperature', 'responseMimeType']) {
      expect(k in spec, k).toBe(false);
    }
  });

  it('LIFE-NPC-2b — a usable params answer assembles locally and never calls again', async () => {
    // The whole point of the parts path: the SVG is built client-side from
    // `avatar/parts.ts`, so the second (dearer) call never happens.
    const r = await generateNpcAvatar(INPUT);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.via).toBe('parts');
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateNpcAvatar — the DRAW fallback (life_npc_avatar)', () => {
  /** Params call answers "the library cannot do this character", then the draw. */
  function fallbackThen(draw: string) {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify({ fallback: true }))
      .mockResolvedValueOnce(draw);
  }

  it('SRV-PROMPT-8..13 — the draw call sends NO prompt text and NO system instruction', async () => {
    fallbackThen(OK_SVG);
    await generateNpcAvatar(INPUT);
    const req = callArg(1);
    expect(req).not.toHaveProperty('prompt');
    expect('systemInstruction' in req).toBe(false);
    const wire = JSON.stringify(req);
    expect(wire).not.toContain('Draw the avatar');
    expect(wire).not.toContain('SECOND MOUTH');
    expect(wire).not.toContain('<role>');
  });

  it('SRV-PROMPT-8..13 — sends a life_npc_avatar spec carrying the FIELDS', async () => {
    fallbackThen(OK_SVG);
    await generateNpcAvatar(INPUT);
    expect(callArg(1).promptSpec).toEqual({
      kind: 'life_npc_avatar',
      name: 'Madame Roux',
      role: 'florist who delivers coded scripts',
      worldVibe: 'theatrical espionage',
    });
  });

  it('SRV-PROMPT-5 — the draw call keeps its own generation parameters', async () => {
    fallbackThen(OK_SVG);
    await generateNpcAvatar(INPUT);
    const req = callArg(1);
    expect(req.model).toBe(LIFE_NPC_AVATAR_MODEL);
    expect(req.thinkingLevel).toBe('minimal');
    // text/plain, NOT json: the draw returns raw SVG, and forcing JSON here
    // turns a working generator into a parse failure.
    expect(req.responseMimeType).toBe('text/plain');
    expect(typeof req.temperature).toBe('number');
    expect(req.category).toBe('life_npc_avatar');
  });

  it('LIFE-NPC-2b — the two calls run DIFFERENT kinds, in the cheap-first order', async () => {
    // A dispatch that confused the two would run the ~8x dearer draw on every
    // avatar while every assertion about the inputs still passed.
    fallbackThen(OK_SVG);
    const r = await generateNpcAvatar(INPUT);
    expect((callArg(0).promptSpec as { kind: string }).kind).toBe('life_npc_avatar_params');
    expect((callArg(1).promptSpec as { kind: string }).kind).toBe('life_npc_avatar');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.via).toBe('draw');
  });

  it('returns sanitise-failed rather than throwing when the model emits no usable SVG', async () => {
    fallbackThen('I cannot draw that.');
    expect((await generateNpcAvatar(INPUT)).kind).toBe('sanitise-failed');
  });

  it('returns error rather than throwing when both calls reject', async () => {
    generateGeminiMock.mockRejectedValue(new Error('boom'));
    expect((await generateNpcAvatar(INPUT)).kind).toBe('error');
  });

  it('LIFE-NPC-2b — a params answer naming an unknown part falls back to the draw', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify({ hair: { style: 'notAPartName' } }))
      .mockResolvedValueOnce(OK_SVG);
    const r = await generateNpcAvatar(INPUT);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.via).toBe('draw');
  });
});
