import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({ generateGemini: vi.fn() }));
vi.mock('./debugLog', () => ({ lifeDebug: vi.fn(), lifeFailed: vi.fn() }));
vi.mock('../log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import { generateGemini } from '../gemini';
import { generateNpcProfile } from './generateNpcProfile';

const generateGeminiMock = generateGemini as unknown as ReturnType<typeof vi.fn>;

/** The request the Nth (default first) call was made with. Throws rather than
 *  returning undefined so a missing call fails loudly on the right line. */
function callArg(n = 0): Record<string, unknown> {
  const call = generateGeminiMock.mock.calls[n];
  if (!call) throw new Error(`generateGemini was not called ${n + 1} time(s)`);
  return call[0] as Record<string, unknown>;
}

const baseInput = {
  name: 'Sophie',
  role: 'café owner',
  worldVibe: 'modern city',
  sagaPremise: 'You moved to reopen your late aunt’s café.',
};

beforeEach(() => {
  generateGeminiMock.mockReset();
});

describe('generateNpcProfile — LIFE-NPC-7', () => {
  it('LIFE-NPC-7 — returns { kind: "ok", description } on a clean JSON response', async () => {
    generateGeminiMock.mockResolvedValue(
      '{"description":"Your upstairs neighbour, a retired chef who slips you leftovers."}',
    );
    const r = await generateNpcProfile(baseInput);
    expect(r).toEqual({
      kind: 'ok',
      description: 'Your upstairs neighbour, a retired chef who slips you leftovers.',
    });
  });

  it('LIFE-NPC-7 — strips ```json fences before parsing', async () => {
    generateGeminiMock.mockResolvedValue(
      '```json\n{"description":"A colleague at the gallery."}\n```',
    );
    const r = await generateNpcProfile(baseInput);
    expect(r).toEqual({ kind: 'ok', description: 'A colleague at the gallery.' });
  });

  it('LIFE-NPC-7 — returns { kind: "error" } when the JSON is malformed', async () => {
    generateGeminiMock.mockResolvedValue('not json at all');
    const r = await generateNpcProfile(baseInput);
    expect(r.kind).toBe('error');
  });

  it('LIFE-NPC-7 — returns { kind: "error" } when description is empty (schema fail)', async () => {
    generateGeminiMock.mockResolvedValue('{"description":""}');
    const r = await generateNpcProfile(baseInput);
    expect(r.kind).toBe('error');
  });

  it('LIFE-NPC-7 — returns { kind: "error" } when generateGemini throws', async () => {
    generateGeminiMock.mockRejectedValue(new Error('network'));
    const r = await generateNpcProfile(baseInput);
    expect(r.kind).toBe('error');
  });

  it('LIFE-NPC-7 — calls flash-lite with JSON mime + the life_npc_profile category', async () => {
    generateGeminiMock.mockResolvedValue('{"description":"x."}');
    await generateNpcProfile(baseInput);
    expect(generateGeminiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-flash-lite',
        responseMimeType: 'application/json',
        category: 'life_npc_profile',
      }),
    );
  });

  it('LIFE-NPC-7 — survives trailing text after a valid JSON object', async () => {
    // The measured production failure, 2026-08-04: a profile came back as a
    // valid object followed by more text and died on `SyntaxError: Unexpected
    // non-whitespace character after JSON at position 142`, leaving that
    // character's avatar card with no bio at all.
    generateGeminiMock.mockResolvedValue(
      '{"description":"A weathered dairy farmer."}\n\nLet me know if you would like another version.',
    );
    const r = await generateNpcProfile(baseInput);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.description).toBe('A weathered dairy farmer.');
  });

  it('LIFE-NPC-7 — does not stop at a brace inside a string value', async () => {
    // Depth-counted rather than regex-matched: a lazy /\{.*?\}/ would cut the
    // object short at the first `}` inside the description.
    generateGeminiMock.mockResolvedValue('{"description":"He mutters {something} at the door."} trailing');
    const r = await generateNpcProfile(baseInput);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.description).toBe('He mutters {something} at the door.');
  });

  // ── SRV-PROMPT-8..13 batch 2 — both halves are server-owned ──────────────
  //
  // Asserting the ABSENCE of prompt text is the point: a test that only checked
  // the spec was present would pass against a client that sent both, which is
  // the state PRACTICE-OWN-1 exists to forbid ("replacing only the SI leaves
  // the hole open").

  it('SRV-PROMPT-8..13 — the client sends NO prompt text and NO system instruction', async () => {
    generateGeminiMock.mockResolvedValue('{"description":"x."}');
    await generateNpcProfile(baseInput);
    const req = callArg();
    expect(req).not.toHaveProperty('prompt');
    // `in` rather than a value check: `{systemInstruction: undefined}` still
    // serialises the key on some transports and is not the same request.
    expect('systemInstruction' in req).toBe(false);
    // Nothing recognisable from the old client-built pair survives anywhere on
    // the request — not under another key, not concatenated in.
    const wire = JSON.stringify(req);
    expect(wire).not.toContain('<worldVibe>');
    expect(wire).not.toContain('Write the profile');
    expect(wire).not.toContain('SPOILER-FREE');
  });

  it('SRV-PROMPT-8..13 — sends a life_npc_profile spec carrying the FIELDS', async () => {
    generateGeminiMock.mockResolvedValue('{"description":"x."}');
    await generateNpcProfile({
      name: 'Madame Roux',
      role: 'The Handler',
      archetype: 'The Handler — a florist who delivers coded scripts.',
      worldVibe: 'theatrical espionage',
      sagaPremise: 'Jimothée is the city’s most beloved stage actor.',
    });
    expect(callArg().promptSpec).toEqual({
      kind: 'life_npc_profile',
      name: 'Madame Roux',
      role: 'The Handler',
      archetype: 'The Handler — a florist who delivers coded scripts.',
      worldVibe: 'theatrical espionage',
      sagaPremise: 'Jimothée is the city’s most beloved stage actor.',
    });
  });

  it('SRV-PROMPT-8..13 — a null/absent optional is ABSENT from the spec, never null', async () => {
    // `kickoffNpcAssets` passes `role ?? null` / `archetype ?? null`, so this
    // builder is the one place that has to turn "we do not know" into an
    // omission. The server REJECTS a null here rather than treating it as
    // absent, so a regression is a 400 and not a silently role-less portrait.
    generateGeminiMock.mockResolvedValue('{"description":"x."}');
    await generateNpcProfile({
      name: 'A stranger',
      role: null,
      archetype: null,
      worldVibe: 'noir city',
      sagaPremise: null,
    });
    const spec = callArg().promptSpec as Record<string, unknown>;
    expect(spec).toEqual({ kind: 'life_npc_profile', name: 'A stranger', worldVibe: 'noir city' });
    for (const k of ['role', 'archetype', 'sagaPremise']) expect(k in spec, k).toBe(false);
  });

  it('SRV-PROMPT-1 — the RESPONSE SCHEMA moved with the prompt', async () => {
    // It used to be `PROFILE_SCHEMA`, inline in this module and sent up in the
    // body. Prompt and schema are ONE artefact: owning the prompt while
    // trusting a client-sent schema leaves the half that decides what the model
    // may SAY inside the bundle, where only an App Store review can correct it.
    // `built.responseSchema` overrides the body's, so the constraint is
    // unchanged — it is just no longer frozen in the app.
    generateGeminiMock.mockResolvedValue('{"description":"x."}');
    await generateNpcProfile(baseInput);
    const req = callArg();
    expect('responseSchema' in req).toBe(false);
    expect(JSON.stringify(req)).not.toContain('OBJECT');
  });

  it('SRV-PROMPT-5 — generation parameters STAY at the call site', async () => {
    // `model`, `thinkingLevel`, `temperature` and `responseMimeType` are
    // generation parameters, not prompt. MSG-PIPE-23 requires every call to
    // name its temperature out loud, so moving them into the spec would make an
    // unreviewed default invisible again.
    generateGeminiMock.mockResolvedValue('{"description":"x."}');
    await generateNpcProfile(baseInput);
    const req = callArg();
    expect(req.model).toBe('gemini-3.1-flash-lite');
    expect(req.thinkingLevel).toBe('minimal');
    expect(req.responseMimeType).toBe('application/json');
    expect(typeof req.temperature).toBe('number');
    const spec = callArg().promptSpec as Record<string, unknown>;
    for (const k of ['model', 'thinkingLevel', 'temperature', 'responseMimeType', 'responseSchema']) {
      expect(k in spec, k).toBe(false);
    }
  });
});
