import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({ generateGemini: vi.fn() }));
vi.mock('./debugLog', () => ({ lifeDebug: vi.fn(), lifeFailed: vi.fn() }));
vi.mock('../log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));

import { generateGemini } from '../gemini';
import { generateCharacterBio, renderBioForPrompt, type GenerateBioInput } from './generateBio';
import type { CastMember, Front } from '@/types/lifeState';

const generateGeminiMock = generateGemini as unknown as ReturnType<typeof vi.fn>;

/**
 * SRV-PROMPT-8..13 batch 6 — `life_bio` sends a SPEC and no prose.
 *
 * Batch 6 because its input is batch 5's OUTPUT: `story` is the `title` /
 * `tone` / `situation` / `cast` / `fronts` that `runSagaOpen` has just written
 * (LIFE-ARCH-3), so the shape had to agree with `LifeSagaOpenPromptSpec` rather
 * than be designed a second time.
 *
 * This file is NEW. `generateBio.ts` had no test of its own before the
 * migration — the only coverage its prompt had was one row of
 * `prompts/exemplarBleed.test.ts`, which moved to
 * `functions/src/__tests__/lifeBio.test.ts` with the prompt itself
 * (SRV-PROMPT-3: tests move rather than die).
 */

const OK_JSON = JSON.stringify({
  people: [
    { name: 'Bébert', relationship: 'neighbour', oneLine: 'Opens at six and says so.' },
    { name: 'Sophie', relationship: 'colleague', oneLine: 'Never finishes a sentence.' },
  ],
  job: 'Keeps the roster book at the lock.',
  cityNeighborhood: 'The canal end of the old quarter.',
  homeDescription: 'A room over the chandlery, one window.',
  quirks: ['Collects bus tickets', 'Will not eat standing up'],
  currentSituation: 'The week you were promised has gone to someone else.',
  hooks: ['A letter you have not opened', 'Thursday at the office'],
});

const base: GenerateBioInput = {
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  worldSeedKey: 'city_life',
};

const story: NonNullable<GenerateBioInput['story']> = {
  title: 'Le 14 rue Cendrillon',
  tone: 'wry, unhurried',
  situation: 'You have a room over the lock.',
  cast: [{ name: 'Bébert', known: 'Runs the roster office.' }],
  fronts: [{ agenda: 'The lease is being bought out.', resolved: null }],
};

/** The single `generateGemini` request the runner made. */
const sentRequest = (): Record<string, unknown> =>
  generateGeminiMock.mock.calls[0]![0] as Record<string, unknown>;

const sentSpec = (): Record<string, unknown> =>
  sentRequest().promptSpec as Record<string, unknown>;

beforeEach(() => {
  generateGeminiMock.mockReset();
  generateGeminiMock.mockResolvedValue(OK_JSON);
});

describe('generateCharacterBio — SRV-PROMPT-8..13: a spec, not prose', () => {
  it('SRV-PROMPT-8..13 — sends NO prompt and no systemInstruction or schema', async () => {
    await generateCharacterBio(base);
    const req = sentRequest();
    // Sending NO `prompt` is load-bearing: the endpoint's "Missing prompt" guard is
    // skipped only when the resolver returns `built`, so a resolver that stopped
    // recognising this kind would 400 every bio with the unit suite still green.
    expect(req).not.toHaveProperty('prompt');
    expect(req.systemInstruction).toBeUndefined();
    // No schema before this batch and none after: the output contract is the
    // JSON shape written into the system instruction, and `ZBio` defends against
    // the answer. Adding one would be a behaviour change, not a migration.
    expect(req.responseSchema).toBeUndefined();
  });

  it('SRV-PROMPT-5 — the generation parameters stay at the call site', async () => {
    await generateCharacterBio(base);
    const req = sentRequest();
    expect(req.category).toBe('life_bio');
    // Measured 2026-07 (`thinking_ab.py bio`): 'medium' was not richer, just
    // slower. The comment in `generateBio.ts` records it; this pins it.
    expect(req.thinkingLevel).toBe('minimal');
    expect(req.responseMimeType).toBe('application/json');
    // MSG-PIPE-23 — every call names its temperature out loud.
    expect(typeof req.temperature).toBe('number');
    expect(typeof req.model).toBe('string');
  });

  it('SRV-PROMPT-8..13 — the spec carries the fields the prompt reads, under the right kind', async () => {
    await generateCharacterBio({
      ...base,
      worldSeedKey: 'manual',
      worldSeedText: 'a canal town',
      worldMode: 'fantasy',
      story,
    });
    expect(sentSpec()).toEqual({
      kind: 'life_bio',
      characterName: 'Marc',
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      worldSeedKey: 'manual',
      worldSeedText: 'a canal town',
      worldMode: 'fantasy',
      story: {
        title: 'Le 14 rue Cendrillon',
        tone: 'wry, unhurried',
        situation: 'You have a room over the lock.',
        cast: [{ name: 'Bébert', known: 'Runs the roster office.' }],
        fronts: [{ agenda: 'The lease is being bought out.', resolved: null }],
      },
    });
  });

  it('PRACTICE-OWN-4 — kind equals the category, so telemetry cannot be moved', async () => {
    await generateCharacterBio(base);
    expect(sentSpec().kind).toBe(sentRequest().category);
  });

  it('SRV-PROMPT-8..13 — an OPTIONAL field is ABSENT, never present-and-undefined', async () => {
    // The server tells the two apart (`raw.x !== undefined`), and on `story` the
    // distinction is what keeps a `null` from being read as "no world".
    await generateCharacterBio(base);
    const spec = sentSpec();
    expect('worldSeedText' in spec).toBe(false);
    expect('worldMode' in spec).toBe(false);
    expect('story' in spec).toBe(false);
  });

  it('LIFE-ARCH-3 — a NULL story becomes an OMISSION, never a null on the wire', async () => {
    // `LifeStartScreen` passes `story: null` when `sagaOpen` failed. The server
    // REJECTS a null on this field rather than reading it as absent, so this
    // call site is the one place that has to turn "there is no world" into an
    // omission — exactly the `universe` rule batch 5 landed.
    await generateCharacterBio({ ...base, story: null });
    expect('story' in sentSpec()).toBe(false);
  });

  it('PRACTICE-OWN-9 — the cast and fronts are NARROWED, field by field', async () => {
    // The call site hands over whole `CastMember`s and `Front`s — typed as such
    // here, so this also pins that the wider call-site shape still fits the
    // narrower input. Everything the prompt does not read must stay off the
    // wire: `clock.consequence` in particular is withheld from prompts by
    // LIFE-FRONT-1.1, and a field that travels is a field someone later wires
    // INTO something.
    const fatCast: CastMember[] = [
      {
        id: 'p1',
        name: 'Bébert',
        known: 'Runs the roster office.',
        tier: 'principal',
        voice: 'clipped',
        standing: 1,
        wants: 'The roster changed.',
        nextMove: 'Corners the clerk on Thursday.',
        wrongAbout: { aboutId: 'r1', believes: 'she never read it' },
        ties: [{ id: 'r1', how: 'have not spoken in a year' }],
      },
    ];
    const fatFronts: Front[] = [
      {
        id: 'f1',
        name: 'The lease',
        driverId: 'p1',
        agenda: 'The lease is being bought out.',
        kind: 'obligation',
        scope: 'saga',
        resolved: null,
        clock: {
          filled: 3,
          size: 8,
          consequence: 'the yard changes hands',
          peak: 3,
          unattended: 0,
          sinceAdvance: 1,
        },
      },
    ];
    await generateCharacterBio({ ...base, story: { ...story, cast: fatCast, fronts: fatFronts } });
    const sent = sentSpec().story as {
      cast: unknown[];
      fronts: unknown[];
    };
    expect(sent.cast).toEqual([{ name: 'Bébert', known: 'Runs the roster office.' }]);
    expect(sent.fronts).toEqual([
      { agenda: 'The lease is being bought out.', resolved: null },
    ]);
    // Non-vacuous: the withheld strings must be absent from the whole payload,
    // not merely from the two arrays.
    const wire = JSON.stringify(sentRequest());
    expect(wire).not.toContain('the yard changes hands');
    expect(wire).not.toContain('Corners the clerk');
  });

  it('LIFE-FRONT-1.1 — a front with no `resolved` key keeps it absent on the wire', async () => {
    // Absent and `null` are both LIVE to the server's filter, but they are
    // different shapes and the narrowing must not invent one. A spec builder
    // that wrote `resolved: undefined` would serialise to an absent key anyway;
    // one that wrote `resolved: null` would change the recorded payload.
    await generateCharacterBio({
      ...base,
      story: { ...story, fronts: [{ agenda: 'No date on the notice.' }] },
    });
    const fronts = (sentSpec().story as { fronts: Record<string, unknown>[] }).fronts;
    expect(fronts).toEqual([{ agenda: 'No date on the notice.' }]);
    expect('resolved' in fronts[0]!).toBe(false);
  });

  it('SRV-PROMPT-3 — the client holds NO copy of the prompt text', async () => {
    // The whole point of the batch. Nothing recognisable from either half of
    // the artefact may appear in the request the client makes.
    await generateCharacterBio({ ...base, story });
    const wire = JSON.stringify(sentRequest());
    expect(wire).not.toContain('Return ONE JSON object');
    expect(wire).not.toContain('Vibe key:');
    expect(wire).not.toContain('<world ');
    expect(wire).not.toContain('Generate a bio for');
  });
});

describe('generateCharacterBio — the parse is still the client’s', () => {
  it('returns the parsed bio on a well-formed answer', async () => {
    const bio = await generateCharacterBio(base);
    expect(bio?.job).toBe('Keeps the roster book at the lock.');
    expect(bio?.people).toHaveLength(2);
  });

  it('strips markdown fences before parsing', async () => {
    generateGeminiMock.mockResolvedValue('```json\n' + OK_JSON + '\n```');
    expect(await generateCharacterBio(base)).not.toBeNull();
  });

  it('returns null — never throws — when the answer fails ZBio', async () => {
    generateGeminiMock.mockResolvedValue(JSON.stringify({ job: 'x' }));
    expect(await generateCharacterBio(base)).toBeNull();
  });

  it('returns null when the call itself fails (LIFE-ONBOARD-6: non-fatal)', async () => {
    generateGeminiMock.mockRejectedValue(new Error('429'));
    expect(await generateCharacterBio(base)).toBeNull();
  });
});

/**
 * `renderBioForPrompt` STAYS CLIENT-SIDE, and this is the assertion that says
 * why rather than a comment that claims it.
 *
 * It is not part of the `life_bio` prompt: it renders the RESULT into the
 * `<bio>` block stored as `world.bio`, which `LifeStartScreen` writes to
 * Firestore and which `life_world_arc` and `life_step` (both server-owned since
 * batch 8) read back as a payload string. ⚠ BATCH 8 LANDED AND IT STILL DID NOT
 * MOVE: two live callers remain (`LifeStartScreen.tsx` and
 * `tests/playthrough/playWorld.ts`), and what the step prompt does to that
 * field is pass it through `normaliseBioBlock` at its own render site
 * (SRV-PROMPT-14) rather than take the renderer with it.
 */
describe('renderBioForPrompt — the bio OUTPUT renderer, which does not move', () => {
  it('renders the stable <bio> block the stored world field is made of', () => {
    const out = renderBioForPrompt(JSON.parse(OK_JSON));
    expect(out.startsWith('<bio>')).toBe(true);
    expect(out.endsWith('</bio>')).toBe(true);
    expect(out).toContain('<job>Keeps the roster book at the lock.</job>');
    expect(out).toContain(
      '<person name="Bébert" relationship="neighbour">Opens at six and says so.</person>',
    );
    expect(out).toContain('<quirk>Collects bus tickets</quirk>');
    expect(out).toContain('<hook>A letter you have not opened</hook>');
  });

  it('escapes attributes and text nodes separately, as it always has', () => {
    const out = renderBioForPrompt({
      ...JSON.parse(OK_JSON),
      people: [{ name: 'Bé<ber>t "the clerk"', relationship: 'a & b', oneLine: 'Says "no" & <goes>.' }],
      job: 'Keeps the "roster" & <book>.',
    });
    expect(out).toContain(
      '<person name="Bé&lt;ber&gt;t &quot;the clerk&quot;" relationship="a &amp; b">Says "no" &amp; &lt;goes&gt;.</person>',
    );
    // ⚠ A TEXT node keeps its quotes — `escapeText` does not touch `"`. That is
    // the OPPOSITE of the bio PROMPT builder, which uses one escape everywhere.
    // Pinned so the two are not "harmonised" by someone reading only one.
    expect(out).toContain('<job>Keeps the "roster" &amp; &lt;book&gt;.</job>');
  });
});
