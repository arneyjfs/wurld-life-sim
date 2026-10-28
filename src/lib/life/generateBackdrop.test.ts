// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({
  generateGemini: vi.fn(),
}));

vi.mock('../log', () => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

import { generateGemini } from '../gemini';
import { generateBackdrop } from './generateBackdrop';

import { LIFE_BACKDROP_MODEL } from './modelConfig';
import type { BackdropDescriptor } from './backdropDescriptor';

const generateGeminiMock = generateGemini as unknown as ReturnType<typeof vi.fn>;

/** The request the Nth (default first) call was made with. Throws rather than
 *  returning undefined so a missing call fails loudly on the right line. */
function callArg(n = 0): Record<string, unknown> {
  const call = generateGeminiMock.mock.calls[n];
  if (!call) throw new Error(`generateGemini was not called ${n + 1} time(s)`);
  return call[0] as Record<string, unknown>;
}

const descriptor = (persistent: boolean): BackdropDescriptor => ({
  locationType: 'fruit_market',
  vibe: 'modern_city',
  persistent,
  label: 'Marché Bastille',
});

const OK_SVG = '<svg viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#eee"/></svg>';

beforeEach(() => {
  generateGeminiMock.mockReset();
  generateGeminiMock.mockResolvedValue(OK_SVG);
});

describe('generateBackdrop', () => {
  it('LIFE-BACKDROP-4 — pins thinkingLevel minimal for PERSISTENT descriptors', async () => {
    await generateBackdrop({ descriptor: descriptor(true), practiceLanguage: 'French' });
    expect(callArg().thinkingLevel).toBe('minimal');
  });

  it("LIFE-BACKDROP-4 — pins the same minimal level for TRANSIENT descriptors (no persistent/transient split)", async () => {
    await generateBackdrop({ descriptor: descriptor(false), practiceLanguage: 'French' });
    expect(callArg().thinkingLevel).toBe('minimal');
  });

  // The level is only load-bearing since LIFE-COST-4 fixed the SDK's
  // generationConfig clobber (functions/src/generationConfig.ts). Before that a
  // request-level generationConfig — which every backdrop sends, for
  // responseMimeType + temperature — silently dropped the model-level
  // thinkingConfig, so backdrops ran at the model default however this was set.
  // These two assertions are what stops the ~790 unbudgeted reasoning tokens
  // coming back unnoticed.
  it('LIFE-BACKDROP-4 — sends a request-level generationConfig alongside the thinking level', async () => {
    await generateBackdrop({ descriptor: descriptor(true), practiceLanguage: 'French' });
    const req = callArg();
    expect(req.responseMimeType).toBe('text/plain');
    expect(typeof req.temperature).toBe('number');
  });

  it('LIFE-BACKDROP-1/30 — routes to LIFE_BACKDROP_MODEL and sends NO system instruction', async () => {
    await generateBackdrop({ descriptor: descriptor(true), practiceLanguage: 'French' });
    const req = callArg();
    expect(req.model).toBe(LIFE_BACKDROP_MODEL);
    // LIFE-BACKDROP-30 — the client sends NO system instruction. The server
    // owns it and substitutes by `category`, which is what makes the explicit
    // cache's digest stable: computed over bytes no client can vary, so two app
    // versions mid-rollout cannot thrash the one shared cache record. Asserted
    // with `in` rather than a value check, because `{systemInstruction:
    // undefined}` would still serialise the key and is not the same request.
    expect('systemInstruction' in req).toBe(false);
  });

  it('LIFE-BACKDROP-4 — tags the call `life_backdrop` so the backend can cache the SI', async () => {
    await generateBackdrop({ descriptor: descriptor(true), practiceLanguage: 'French' });
    expect(callArg().category).toBe('life_backdrop');
  });

  // ── SRV-PROMPT-8..13 batch 1 — the user prompt is server-owned ───────────
  //
  // The SI left the bundle under LIFE-BACKDROP-30; this is the other half.
  // Asserting the ABSENCE of prompt text is the point: a test that only checked
  // the spec was present would pass against a client that sent both, which is
  // the state PRACTICE-OWN-1 exists to forbid ("replacing only the SI leaves
  // the hole open").

  it('SRV-PROMPT-8..13 — the client sends NO prompt text for this category', async () => {
    await generateBackdrop({ descriptor: descriptor(true), practiceLanguage: 'French' });
    const req = callArg();
    expect(req).not.toHaveProperty('prompt');
    // Nothing recognisable from the old client-built prompt survives anywhere
    // on the request — not under another key, not concatenated in.
    const wire = JSON.stringify(req);
    expect(wire).not.toContain('Generate a scene SVG');
    expect(wire).not.toContain('First-person camera');
    expect(wire).not.toContain('This scene is PERSISTENT');
    expect(wire).not.toContain('Practice language (ALL text inside the SVG');
  });

  it('SRV-PROMPT-8..13 — sends a life_backdrop promptSpec carrying the descriptor FIELDS', async () => {
    await generateBackdrop({
      descriptor: { ...descriptor(false), flavour: 'bustling, rainy', timeOfDay: 'evening' },
      practiceLanguage: 'French',
    });
    expect(callArg().promptSpec).toEqual({
      kind: 'life_backdrop',
      locationType: 'fruit_market',
      vibe: 'modern_city',
      persistent: false,
      practice: 'French',
      flavour: 'bustling, rainy',
      timeOfDay: 'evening',
    });
  });

  it('SRV-PROMPT-8..13 — the place LABEL stays off the wire', async () => {
    // `label` is the cache key and the location ribbon; the prompt has never
    // read it. Sending it would put a per-world place name on a request that
    // does nothing with it.
    await generateBackdrop({ descriptor: descriptor(true), practiceLanguage: 'French' });
    const spec = callArg().promptSpec as Record<string, unknown>;
    expect('label' in spec).toBe(false);
    expect(JSON.stringify(spec)).not.toContain('Marché Bastille');
  });

  it('SRV-PROMPT-8..13 — absent descriptor fields are ABSENT from the spec, not undefined', async () => {
    // The server tells the two apart (PRACTICE-OWN-3's rule, same reason here):
    // `{flavour: undefined}` still serialises the key on some transports and is
    // not the same request as one without it.
    await generateBackdrop({ descriptor: descriptor(true), practiceLanguage: 'French' });
    const spec = callArg().promptSpec as Record<string, unknown>;
    expect('flavour' in spec).toBe(false);
    expect('timeOfDay' in spec).toBe(false);
  });

  it('SRV-PROMPT-5 — generation parameters STAY at the call site', async () => {
    // `model`, `thinkingLevel`, `temperature` and `responseMimeType` are
    // generation parameters, not prompt. MSG-PIPE-23 requires every call to
    // name its temperature out loud, so moving them into the spec would make an
    // unreviewed default invisible again.
    await generateBackdrop({ descriptor: descriptor(true), practiceLanguage: 'French' });
    const req = callArg();
    expect(req.model).toBe(LIFE_BACKDROP_MODEL);
    expect(req.thinkingLevel).toBe('minimal');
    expect(req.responseMimeType).toBe('text/plain');
    expect(typeof req.temperature).toBe('number');
    const spec = callArg().promptSpec as Record<string, unknown>;
    for (const k of ['model', 'thinkingLevel', 'temperature', 'responseMimeType']) {
      expect(k in spec, k).toBe(false);
    }
  });

  it('returns sanitise-failed rather than throwing when the model emits no usable SVG', async () => {
    generateGeminiMock.mockResolvedValue('I cannot draw that.');
    const res = await generateBackdrop({ descriptor: descriptor(true), practiceLanguage: 'French' });
    expect(res.kind).toBe('sanitise-failed');
  });

  it('returns error rather than throwing when the Gemini call rejects', async () => {
    generateGeminiMock.mockRejectedValue(new Error('boom'));
    const res = await generateBackdrop({ descriptor: descriptor(true), practiceLanguage: 'French' });
    expect(res.kind).toBe('error');
  });

  it('strips markdown fences the SI told the model not to emit', async () => {
    generateGeminiMock.mockResolvedValue('```svg\n' + OK_SVG + '\n```');
    const res = await generateBackdrop({ descriptor: descriptor(true), practiceLanguage: 'French' });
    expect(res.kind).toBe('ok');
  });
});
