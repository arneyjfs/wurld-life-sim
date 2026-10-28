import { beforeEach, describe, expect, it, vi } from 'vitest';

// Firestore is mocked so the path-construction + parse/sort logic is
// exercised without a live backend. `collection` records its path
// segments; `doc(collectionRef, id)` appends the arcId; `setDoc`
// captures its (ref, data) pair; `getDocs` returns a controllable
// snapshot.
vi.mock('@/lib/firebase', () => ({ db: {} }));

const setDocMock = vi.fn(async (_ref: unknown, _data: unknown) => undefined);
let getDocsDocs: Array<{ id: string; data: () => unknown }> = [];

// Keep the real module (ZWorldArc parsing needs the real `Timestamp`)
// and override ONLY the CRUD entry points arcs.ts calls.
vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    collection: (_db: unknown, ...segments: string[]) => ({
      path: segments.join('/'),
    }),
    doc: (parent: { path: string }, id: string) => ({ path: `${parent.path}/${id}` }),
    setDoc: (ref: unknown, data: unknown) => setDocMock(ref, data),
    getDocs: async () => ({ docs: getDocsDocs }),
  };
});

import {
  appendCompletedArc,
  capCompletedArcs,
  COMPLETED_ARCS_CAP,
  COMPLETED_ARCS_HEAD,
  readCompletedArcs,
} from './arcs';
import type { WorldArc } from '@/types/firestore';

function arc(overrides: Partial<WorldArc> & { chapterNumber: number }): WorldArc {
  return {
    premise: `Chapter ${overrides.chapterNumber} premise.`,
    playerTeaser: `Chapter ${overrides.chapterNumber} teaser.`,
    themes: [],
    status: 'completed',
    recurringNpcIds: [],
    completedSceneMemories: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getDocsDocs = [];
});

describe('appendCompletedArc — LIFE-WORLD-ARC-1 / LIFE-DATA-*', () => {
  it('LIFE-WORLD-ARC-1 — writes one doc per chapter at completedArcs/chapter-{N}', async () => {
    await appendCompletedArc('u1', 'w1', arc({ chapterNumber: 3 }));
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [ref, data] = setDocMock.mock.calls[0]!;
    expect((ref as { path: string }).path).toBe(
      'users/u1/lifeWorlds/w1/completedArcs/chapter-3',
    );
    // The full arc is persisted (subcollection doc holds the whole arc).
    expect((data as WorldArc).chapterNumber).toBe(3);
    expect((data as WorldArc).status).toBe('completed');
  });

  it('LIFE-WORLD-ARC-1 — arcId is stable per chapter so a re-archive overwrites (idempotent)', async () => {
    await appendCompletedArc('u1', 'w1', arc({ chapterNumber: 2 }));
    await appendCompletedArc('u1', 'w1', arc({ chapterNumber: 2, premise: 'redo' }));
    const paths = setDocMock.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(paths).toEqual([
      'users/u1/lifeWorlds/w1/completedArcs/chapter-2',
      'users/u1/lifeWorlds/w1/completedArcs/chapter-2',
    ]);
  });
});

describe('readCompletedArcs — LIFE-WORLD-ARC-1 / LIFE-DATA-*', () => {
  it('LIFE-WORLD-ARC-1 — returns arcs parsed via ZWorldArc, ordered by chapterNumber ascending', async () => {
    getDocsDocs = [
      { id: 'chapter-3', data: () => arc({ chapterNumber: 3 }) },
      { id: 'chapter-1', data: () => arc({ chapterNumber: 1 }) },
      { id: 'chapter-2', data: () => arc({ chapterNumber: 2 }) },
    ];
    const out = await readCompletedArcs('u1', 'w1');
    expect(out.map((a) => a.chapterNumber)).toEqual([1, 2, 3]);
  });

  it('LIFE-WORLD-ARC-1 — applies ZWorldArc defaults (missing themes/memories become [])', async () => {
    getDocsDocs = [
      {
        id: 'chapter-1',
        data: () => ({ chapterNumber: 1, premise: 'p', status: 'completed' }),
      },
    ];
    const out = await readCompletedArcs('u1', 'w1');
    expect(out).toHaveLength(1);
    expect(out[0]!.themes).toEqual([]);
    expect(out[0]!.completedSceneMemories).toEqual([]);
    expect(out[0]!.recurringNpcIds).toEqual([]);
  });

  it('LIFE-WORLD-ARC-1 — drops malformed docs rather than throwing', async () => {
    getDocsDocs = [
      { id: 'chapter-1', data: () => arc({ chapterNumber: 1 }) },
      // Missing required `premise` + `status` → fails ZWorldArc parse.
      { id: 'junk', data: () => ({ chapterNumber: 2 }) },
    ];
    const out = await readCompletedArcs('u1', 'w1');
    expect(out.map((a) => a.chapterNumber)).toEqual([1]);
  });

  it('LIFE-WORLD-ARC-1 — empty subcollection yields []', async () => {
    getDocsDocs = [];
    expect(await readCompletedArcs('u1', 'w1')).toEqual([]);
  });
});

/**
 * LIFE-WORLD-ARC-7 — the prompt's arc list is BOUNDED.
 *
 * Found while migrating `life_world_arc` server-side (SRV-PROMPT-8..13 batch 3)
 * and measured there: the chapter-open prompt renders every completed arc, at
 * roughly 2.7 KB each on a rich world, against ~40 KB of headroom once the
 * system instruction and world block are paid for. So the call crosses
 * `MAX_PROMPT_BYTES` at around fifteen chapters and the endpoint 400s.
 *
 * ⚠ That is NOT a migration artefact — it bites on the legacy path too, just a
 * few chapters later, because the two halves are capped separately there. And
 * it fails SILENTLY: `runWorldArcGenerate` falls back to `trivialArc`, so a
 * long-played world quietly stops getting authored chapters and nothing says
 * so. The worlds that break first are the ones someone played most.
 */
describe('LIFE-WORLD-ARC-7 — completed arcs are capped for the prompt', () => {
  const mk = (n: number) => ({ chapterNumber: n }) as unknown as WorldArc;

  it('LIFE-WORLD-ARC-7 — a short history is returned untouched', () => {
    const arcs = [1, 2, 3].map(mk);
    expect(capCompletedArcs(arcs).map((a) => a.chapterNumber)).toEqual([1, 2, 3]);
  });

  it('LIFE-WORLD-ARC-7 — at the cap, still untouched', () => {
    const arcs = Array.from({ length: COMPLETED_ARCS_CAP }, (_, i) => mk(i + 1));
    expect(capCompletedArcs(arcs)).toHaveLength(COMPLETED_ARCS_CAP);
  });

  it('LIFE-WORLD-ARC-7 — over the cap, the FOUNDING chapters survive', () => {
    // Head-and-tail, like `capStoryLog` and `capCanon`. Chapter 1 is where the
    // world's premise and cast were established, so a plain `.slice(-cap)`
    // would drop exactly the chapters the through-line rests on and keep the
    // churn — the mistake `capStoryLog`'s own comment records making.
    const arcs = Array.from({ length: 20 }, (_, i) => mk(i + 1));
    const out = capCompletedArcs(arcs).map((a) => a.chapterNumber);
    expect(out).toHaveLength(COMPLETED_ARCS_CAP);
    expect(out.slice(0, COMPLETED_ARCS_HEAD)).toEqual([1, 2]);
    expect(out[out.length - 1]).toBe(20);
  });

  it('LIFE-WORLD-ARC-7 — order stays oldest → newest, with no duplicates', () => {
    const out = capCompletedArcs(Array.from({ length: 30 }, (_, i) => mk(i + 1)));
    const ns = out.map((a) => a.chapterNumber);
    expect([...ns].sort((a, b) => a - b)).toEqual(ns);
    expect(new Set(ns).size).toBe(ns.length);
  });
});
