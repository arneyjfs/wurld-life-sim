/**
 * THE "KILL MARC" PROBE — what happens when the player ignores the scene.
 *
 *   npx vitest run --config tests/playthrough/vitest.config.ts diverge.probe
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * INTENT is scored 1.25: every pick is ACKNOWLEDGED, none REDIRECTS. Option
 * grids are the mild version of that question, because the model authored the
 * options itself and every one of them is something it was already willing to
 * write. The hard version is FREE TEXT, where the player can want something the
 * scene never contemplated.
 *
 * The step prompt has nothing to say about it. `<turn kind="free">` carries one
 * note — "the player wrote that themselves and it is ALREADY on screen, do not
 * repeat or restage it" — about STAGING, not about intent. Meanwhile the scene
 * rules say "every beat has to serve the SUBJECT. If you find yourself writing
 * something that serves a different subject, that is the next scene, not this
 * one", which is exactly the instruction that would make a model deflect.
 *
 * So the question this probe answers, before anything is designed: does the
 * story ABSORB a free text that wrecks the premise, or does it deflect? A
 * little pushback is correct — a character can refuse, and consequences can
 * land — but the attempt has to be allowed to happen and change things.
 *
 * Spends real money (~$0.05). Never in `npm test`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/gemini', async () => await import('./transport'));
vi.mock('@/lib/life/arcs', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  readCompletedArcs: async () => [],
}));

const { runSagaOpen } = await import('@/lib/life/runSagaOpen');
const { runSceneOpen } = await import('@/lib/life/runSceneOpen');
const { generateStepOptions } = await import('@/lib/life/generateStepOptions');
const { WorldStore } = await import('./worldStore');
const { totals } = await import('./transport');

import type { LifeWorld } from '@/types/firestore';
import type { NodeLike } from './worldStore';

/** Free texts a scene about farm logistics is not expecting. */
const DIVERGENCES = [
  'I grab Marc by the collar and tell him I know he has been lying to me.',
  'I walk out, get in the van, and drive to Lyon without telling anyone.',
];

describe('free-text divergence', () => {
  it('absorbs a player intent the scene never planned for', { timeout: 15 * 60_000 }, async () => {
    const base = {
      id: 'probe', characterName: 'Alice',
      practiceLanguage: 'French', nativeLanguage: 'English (British)',
      systemLanguage: 'English (British)', difficulty: 3,
      worldSeedKey: 'farm_life', worldMode: 'realistic', rollingSummary: '',
    } as unknown as LifeWorld;

    const opened = await runSagaOpen({ world: base });
    if (opened.kind !== 'ok') throw new Error(`sagaOpen ${opened.reason}`);
    const store = new WorldStore({
      ...base,
      saga: { title: opened.state.title, titleNative: opened.state.titleNative, tone: opened.state.tone },
      universe: opened.state.universe, situation: opened.state.situation,
      cast: opened.state.cast, fronts: opened.state.fronts,
      sagaHistory: [], recentSubjects: [], sceneCount: 1,
    } as unknown as LifeWorld);

    const openRes = await runSceneOpen({
      world: store.worldDoc, cast: store.world.cast ?? [], fronts: store.world.fronts ?? [],
      canon: store.canon, history: [], recentSubjects: [], sceneIndex: 0,
    });
    store.openScene(openRes.outline, 'sc-0');

    const step = async (turn: Record<string, unknown>) =>
      generateStepOptions({
        uid: 'probe', world: store.worldDoc, events: store.events,
        scene: store.scene, npcs: store.npcs, turn, nonce: 0,
      } as unknown as Parameters<typeof generateStepOptions>[0]);

    // Two ordinary turns so the scene is genuinely underway and has something
    // to be derailed FROM.
    for (let i = 0; i < 2; i += 1) {
      const r = await step({ kind: 'live', choice: null, freeText: null, practiceOutcome: null });
      if (r.kind !== 'ok' || !r.node) throw new Error(`step ${r.kind}`);
      store.commit({ ...(r.node as unknown as NodeLike), logLine: r.logLine }, { countsAsTurn: true });
    }

    const out: string[] = [
      `SCENE: ${openRes.outline.title}`,
      `SUBJECT: ${openRes.outline.subject ?? ''}`,
      `AT STAKE: ${openRes.outline.premise}`,
      `CAST: ${(store.world.cast ?? []).map((c) => c.name).join(', ')}`,
      '',
    ];

    for (const freeText of DIVERGENCES) {
      const r = await step({ kind: 'live', choice: null, freeText, practiceOutcome: null });
      out.push(`── PLAYER WROTE: ${freeText}`);
      if (r.kind !== 'ok' || !r.node) {
        out.push(`   ✗ step ${r.kind} — the turn FAILED on divergent input`, '');
        continue;
      }
      for (const b of (r.node as unknown as NodeLike).beats ?? []) {
        out.push(`   ${b.speakerName ?? 'narrator'}: ${b.nativeText}`);
      }
      out.push(`   logLine: ${r.logLine ?? '(none)'}`);
      out.push(`   options: ${(r.options ?? []).map((o) => o.nativeText).join('  |  ')}`, '');
    }

    out.push(`$${totals().usd.toFixed(3)}`);
    const dest = path.resolve(process.cwd(), '.playthroughs/diverge-probe.txt');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out.join('\n'));
    expect(totals().calls).toBeGreaterThan(0);
  });
});
