/**
 * LIFE-CANON-6 — dormancy drives reuse.
 *
 * These assert the CONTRACT (sceneOpen gets a digest ordered so the longest-
 * dormant material is reachable), not the mechanism.
 */
import { describe, it, expect } from 'vitest';
import { canonDormancy, CANON_DIGEST_CAP } from './canon';
import type { WorldCanon } from '@/types/lifeNarrative';

function canonOf(rows: { id: string; name: string; note?: string }[]): WorldCanon {
  return {
    characters: rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: 'person',
      note: r.note ?? '',
    })),
    places: [],
    objects: [],
    facts: [],
  };
}

describe('canonDormancy', () => {
  it('LIFE-CANON-6 — an entity named in the newest line is not dormant', () => {
    const canon = canonOf([{ id: 'marc', name: 'Marc' }]);
    const rows = canonDormancy(canon, ['Something about Marc happened.']);
    expect(rows.find((r) => r.id === 'marc')?.scenesSince).toBe(0);
  });

  it('LIFE-CANON-6 — scenesSince counts scenes back to the last mention', () => {
    const canon = canonOf([{ id: 'marc', name: 'Marc' }]);
    const rows = canonDormancy(canon, [
      'Marc handed over the bread.',
      'A quiet day at the harbour.',
      'The lamp went out.',
    ]);
    // Newest line is index 2 → Marc last seen 2 scenes ago.
    expect(rows.find((r) => r.id === 'marc')?.scenesSince).toBe(2);
  });

  it('LIFE-CANON-6 — an entity never mentioned reads as maximally dormant', () => {
    const canon = canonOf([{ id: 'ghost', name: 'Yvette' }]);
    const history = ['One.', 'Two.', 'Three.'];
    const rows = canonDormancy(canon, history);
    expect(rows.find((r) => r.id === 'ghost')?.scenesSince).toBe(history.length);
  });

  it('LIFE-CANON-6 — matches on id as well as name', () => {
    // Options reference entities by targetId without necessarily naming them.
    const canon = canonOf([{ id: 'wire-cutters', name: 'the cutters' }]);
    const rows = canonDormancy(canon, ['Someone used the wire-cutters.']);
    expect(rows.find((r) => r.id === 'wire-cutters')?.scenesSince).toBe(0);
  });

  it('LIFE-CANON-6 — matching is case-insensitive', () => {
    const canon = canonOf([{ id: 'marc', name: 'Marc' }]);
    const rows = canonDormancy(canon, ['marc was late.']);
    expect(rows.find((r) => r.id === 'marc')?.scenesSince).toBe(0);
  });

  it('LIFE-CANON-6 — short names cannot match, or every entity is in play', () => {
    // Same MIN_NAME_MATCH floor canonWorkingSetIds uses: matching "Bo" against
    // prose would put half the canon in play on a coincidence.
    const canon = canonOf([{ id: 'bo', name: 'Bo' }]);
    const history = ['Nobody by that name, but the letters b and o abound.'];
    const rows = canonDormancy(canon, history);
    expect(rows.find((r) => r.id === 'bo')?.scenesSince).toBe(history.length);
  });

  it('LIFE-CANON-6 — the digest is ordered longest-dormant FIRST', () => {
    // This is the whole point: the planner is told to prefer what has been away
    // a while, and the order is what makes that cheap to obey.
    const canon = canonOf([
      { id: 'fresh', name: 'Amandine' },
      { id: 'stale', name: 'Bertrand' },
    ]);
    const rows = canonDormancy(canon, [
      'Bertrand argued about the rent.',
      'Amandine closed up.',
    ]);
    expect(rows.map((r) => r.id)).toEqual(['stale', 'fresh']);
  });

  it('LIFE-CANON-6 — the digest is capped, keeping the most dormant', () => {
    // Canon runs to ~192 entries at the bucket cap; the planner cannot be
    // handed all of it. The ones dropped must be the FRESH ones.
    const many = Array.from({ length: CANON_DIGEST_CAP + 10 }, (_, i) => ({
      id: `entity-${i}`,
      name: `Person${i}`,
    }));
    // Mention the first five in the newest line, so they are the freshest.
    const rows = canonDormancy(canonOf(many), [
      'entity-0 entity-1 entity-2 entity-3 entity-4 were all here.',
    ]);
    expect(rows).toHaveLength(CANON_DIGEST_CAP);
    for (const fresh of ['entity-0', 'entity-1', 'entity-2', 'entity-3', 'entity-4']) {
      expect(rows.map((r) => r.id)).not.toContain(fresh);
    }
  });

  it('LIFE-CANON-6 — an empty history ranks nothing above anything else', () => {
    // A world on its first scene has no basis to prefer one entity over
    // another, and must not invent one: every row ties at zero.
    const canon = canonOf([
      { id: 'a', name: 'Amandine' },
      { id: 'b', name: 'Bertrand' },
    ]);
    const rows = canonDormancy(canon, []);
    expect(rows.map((r) => r.scenesSince)).toEqual([0, 0]);
  });

  it('carries the note through — a bare id is not material to draw on', () => {
    const canon = canonOf([{ id: 'marc', name: 'Marc', note: 'the baker' }]);
    expect(canonDormancy(canon, [])[0]?.note).toBe('the baker');
  });
});
