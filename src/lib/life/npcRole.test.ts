/**
 * LIFE-NPC-8 — an NPC's role is resolved BEFORE their assets are generated.
 *
 * Spec: docs/specs/life-sim.md — LIFE-NPC-8.
 *
 * The reported bug, verbatim: a beat introduced "Madame Roux, ta fleuriste"
 * handing the player a changed script, and the profile under her portrait
 * called her "your formidable vocal coach and mentor". The saga said exactly
 * who she was the whole time — `keyArchetypes` carries "The Handler" /
 * "Madame Roux, a florist who delivers coded scripts…" — and nothing read it.
 */
import { describe, expect, it } from 'vitest';
import { resolveNpcRole } from './npcRole';
import type { StepIntroduction } from './stepSchema';

/** The saga from the reported trace, trimmed to the field that matters. */
const ARCHETYPES = [
  {
    role: 'The Handler',
    description:
      "Madame Roux, a florist who delivers coded scripts and sharp critiques of Jimothée's performance.",
  },
  {
    role: 'The Rival',
    description:
      "Julian, a method actor who is obsessively trying to uncover Jimothée's 'secret'.",
  },
];

const intro = (over: Partial<StepIntroduction> = {}): StepIntroduction => ({
  kind: 'character',
  name: 'Madame Roux',
  ...over,
});

describe('LIFE-NPC-8 — resolveNpcRole', () => {
  it('finds the saga archetype that names the NPC', () => {
    const r = resolveNpcRole({
      npcId: 'madame-roux',
      name: 'Madame Roux',
      keyArchetypes: ARCHETYPES,
    });
    expect(r.relationship).toBe('The Handler');
    // The archetype line is what the profile prompt needs — it contains the
    // word the model got wrong.
    expect(r.archetype).toContain('florist');
    expect(r.archetype).toContain('The Handler');
  });

  it('picks the RIGHT archetype when the saga has several', () => {
    const r = resolveNpcRole({
      npcId: 'julian',
      name: 'Julian',
      keyArchetypes: ARCHETYPES,
    });
    expect(r.relationship).toBe('The Rival');
    expect(r.archetype).toContain('method actor');
    expect(r.archetype).not.toContain('florist');
  });

  it("prefers this turn's own note over the saga", () => {
    // The scene just described them; that beats a static archetype, which may
    // be several chapters stale.
    const r = resolveNpcRole({
      npcId: 'madame-roux',
      name: 'Madame Roux',
      introduces: [intro({ note: 'your florist, and your handler' })],
      keyArchetypes: ARCHETYPES,
    });
    expect(r.relationship).toBe('your florist, and your handler');
    // …but the archetype still rides along to the prompt: more context is
    // strictly better THERE, even though the card row can only hold one line.
    expect(r.archetype).toContain('your florist, and your handler');
    expect(r.archetype).toContain('coded scripts');
  });

  it('matches an introduction by explicit id, not just by name', () => {
    const r = resolveNpcRole({
      npcId: 'madame-roux',
      name: 'Madame Roux',
      introduces: [intro({ id: 'madame-roux', name: 'Mme Roux', note: 'the florist' })],
    });
    expect(r.relationship).toBe('the florist');
  });

  it('ignores introductions for OTHER characters and non-characters', () => {
    const r = resolveNpcRole({
      npcId: 'madame-roux',
      name: 'Madame Roux',
      introduces: [
        intro({ name: 'Julian', note: 'a rival actor' }),
        { kind: 'place', name: 'Madame Roux', note: 'not a person' },
      ],
    });
    expect(r.relationship).toBeNull();
  });

  it('keeps a long note OUT of the card row but keeps it for the prompt', () => {
    // `relationship` renders as the avatar card's one-line role row
    // (LIFE-NPC-7). A paragraph there is a layout bug; in the prompt it is
    // free context.
    const long =
      'the florist on the corner who has been quietly passing you coded scripts for years';
    const r = resolveNpcRole({
      npcId: 'madame-roux',
      name: 'Madame Roux',
      introduces: [intro({ note: long })],
      keyArchetypes: ARCHETYPES,
    });
    expect(r.relationship).toBe('The Handler');
    expect(r.archetype).toContain(long);
  });

  it('will not attach an archetype that merely mentions a shared word', () => {
    // A wrong archetype is worse than none: it renders with total confidence.
    // Full-name matching only — "Julian's dressing room" in someone else's
    // archetype must not capture Julian.
    const r = resolveNpcRole({
      npcId: 'elise',
      name: 'Élise',
      keyArchetypes: [
        { role: 'The Fixer', description: "A stagehand who cleans Julian's dressing room." },
      ],
    });
    expect(r.relationship).toBeNull();
    expect(r.archetype).toBeNull();
  });

  it('returns nothing when there is nothing to say — today’s behaviour', () => {
    const r = resolveNpcRole({ npcId: 'stranger', name: 'A stranger' });
    expect(r).toEqual({ relationship: null, archetype: null });
    // An empty name cannot match anything and must not throw.
    expect(resolveNpcRole({ npcId: 'x', name: '  ', keyArchetypes: ARCHETYPES }))
      .toEqual({ relationship: null, archetype: null });
  });
});
