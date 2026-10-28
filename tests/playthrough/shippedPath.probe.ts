/**
 * THE PROBE — does the SHIPPED generation path run headlessly through the
 * transport seam? Everything in the redesigned harness depends on the answer.
 *
 *   npx vitest run --config tests/playthrough/vitest.config.ts shippedPath.probe
 *
 * Spends real money (a handful of calls, well under a cent). It is a `.probe.ts`
 * rather than a `.test.ts` so the ordinary unit suite never picks it up.
 *
 * What it proves, in order of how badly the redesign needs each:
 *
 *  1. `generateStepOptions` — THE HOT PATH — runs with in-memory world/events
 *     and returns a validated node. This is the one the old harness faked.
 *  2. `runSagaOpen` opens a world from nothing.
 *  3. `generateBackdrop` returns SVG through a text/plain call, proving the
 *     transport does not force JSON on the one generator that is not JSON.
 *
 * If these three hold, every remaining generator is the same shape and the
 * harness can drive the real engine end to end.
 */
import { describe, expect, it, vi } from 'vitest';

// The ONE module replaced. Everything above it stays real.
vi.mock('@/lib/gemini', async () => await import('./transport'));
// `arcs.ts` reads Firestore for prior chapters; in-memory worlds have none.
vi.mock('@/lib/life/arcs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  readCompletedArcs: async () => [],
}));

const { generateStepOptions } = await import('@/lib/life/generateStepOptions');
const { runSagaOpen } = await import('@/lib/life/runSagaOpen');
const { generateBackdrop } = await import('@/lib/life/generateBackdrop');
const { totals, calls } = await import('./transport');
// ⚠ SERVER-SIDE SINCE SRV-PROMPT-8..13 batch 8, and batch 0's note predicted
// exactly this: *"the day that SI is built server-side, the line fails honestly
// instead of passing on an unmaintained substring."* It did — this import moved
// rather than the assertion being loosened, so the probe still compares the
// harness's recorded SI against the one the app is actually served.
const { lifeStepSystemInstruction } = await import(
  '../../functions/src/prompts/lifeStep'
);

import type { LifeWorld } from '@/types/firestore';

const WORLD = {
  id: 'probe-1',
  characterName: 'Alice',
  practiceLanguage: 'French',
  nativeLanguage: 'English (British)',
  systemLanguage: 'English (British)',
  difficulty: 3,
  worldSeedKey: 'city_life',
  worldMode: 'realistic',
  rollingSummary: '',
} as unknown as LifeWorld;

describe('the SHIPPED path runs headlessly', () => {
  it(
    'runSagaOpen opens a world from nothing',
    { timeout: 120_000 },
    async () => {
      const r = await runSagaOpen({ world: WORLD });
      expect(r.kind).toBe('ok');
      if (r.kind !== 'ok') return;
      expect(r.state.cast.length).toBeGreaterThan(0);
      expect(r.state.fronts.length).toBe(1);
      expect(r.state.situation.trim()).not.toBe('');
      // eslint-disable-next-line no-console
      console.log('SAGA:', r.state.title, '| cast', r.state.cast.map((c) => c.name).join(', '));
    },
  );

  it(
    'generateStepOptions — the HOT PATH the old harness faked — returns a real node',
    { timeout: 120_000 },
    async () => {
      const res = await generateStepOptions({
        uid: 'probe',
        world: WORLD,
        events: [],
        scene: null,
        npcs: [],
        turn: { kind: 'live', choice: null, freeText: null, practiceOutcome: null },
        nonce: 0,
      } as unknown as Parameters<typeof generateStepOptions>[0]);
      expect(res.kind).toBe('ok');
      if (res.kind !== 'ok' || !res.node) return;
      const node = res.node as { kind: string; beats?: unknown[]; options?: unknown[] };
      expect(node.kind).toBeTruthy();
      // The prompt that produced it must be the SHIPPED one, not a harness-built
      // turn prompt (the old `prompts/stepTurn.ts`, deleted 2026-09-18).
      //
      // ⚠ This asserted `toContain('MATERIALLY CHANGES')` until 2026-09-18, and
      // that string exists NOWHERE in `src/` — so the check could only ever
      // fail. It survived because a `.probe.ts` is outside the unit suite's
      // include (`tests/playthrough/**/*.test.ts`) by design, this one spending
      // real money, so nothing ran it in CI and the rot was invisible. Exactly
      // the failure SRV-PROMPT-13 names: the harness is the only behavioural
      // regression signal life prompts have, and half of it was broken BEFORE
      // any migration touched it.
      //
      // Asserted against the shipped builder's own output rather than a magic
      // substring, so it cannot rot the same way again — the day the SI is
      // built server-side this line fails honestly instead of passing on a
      // string nobody maintains.
      const stepCall = calls().find((c) => c.category === 'life_step');
      expect(stepCall, 'a life_step call was made').toBeTruthy();
      // Mirrors `generateStepOptions`'s own call exactly, including
      // LIFE-LANG-7's `systemLanguage ?? nativeLanguage` fallback.
      expect(stepCall!.systemInstruction).toBe(
        lifeStepSystemInstruction({
          practiceLanguage: WORLD.practiceLanguage,
          nativeLanguage: WORLD.nativeLanguage,
          systemLanguage: WORLD.systemLanguage ?? WORLD.nativeLanguage,
          difficulty: WORLD.difficulty,
        }),
      );
      // eslint-disable-next-line no-console
      console.log('STEP:', node.kind, '| beats', node.beats?.length, '| options', node.options?.length);
    },
  );

  it(
    'generateBackdrop returns SVG — the transport must not force JSON',
    { timeout: 120_000 },
    async () => {
      const r = await generateBackdrop({
        descriptor: {
          locationType: 'fruit_market',
          vibe: 'modern_city',
          persistent: true,
          label: 'Le marché',
          details: ['bustling', 'morning light'],
        } as unknown as Parameters<typeof generateBackdrop>[0]['descriptor'],
        practiceLanguage: 'French',
      });
       
      // eslint-disable-next-line no-console
      console.log('BACKDROP:', r.kind, r.kind === 'ok' ? `${r.svg.length} chars` : '');
      expect(r.kind, 'backdrop generated').toBe('ok');
      if (r.kind === 'ok') expect(r.svg).toContain('<svg');
    },
  );

  it('reports what the probe cost', () => {
    const t = totals();
    // eslint-disable-next-line no-console
    console.log(`PROBE COST: ${t.calls} calls, $${t.usd.toFixed(4)}`);
    expect(t.calls).toBeGreaterThan(0);
  });
});
