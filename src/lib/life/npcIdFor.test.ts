/**
 * LIFE-NPC-9 — one id per person.
 *
 * ⚠ SPLIT from `npcNames.test.ts` by SRV-PROMPT-8..13 batch 8. That file tested
 * two things one report named together: the PROMPT's naming rules (which moved
 * server-side with the step prompt) and this, the roster's canonical id, which
 * is engine code the roster writer reads and which never migrates.
 */
import { describe, expect, it } from 'vitest';
import { npcIdFor } from './npcs';

describe('LIFE-NPC-9 — canonical npc id', () => {
  it('collapses the case fork that billed two avatars for one baker', () => {
    // `introduces` supplied "Marc", `keyNpcs` supplied "marc", and `npcDoc`
    // took both at face value: two roster rows, two avatars, two descriptions.
    expect(npcIdFor('Marc')).toBe(npcIdFor('marc'));
  });

  it('accents cannot fork an id either', () => {
    expect(npcIdFor('Élodie')).toBe(npcIdFor('Elodie'));
    expect(npcIdFor('Élodie')).toBe('elodie');
  });

  it('slugs the shapes the three generators actually emit', () => {
    expect(npcIdFor('Marie la boulangère')).toBe('marie-la-boulangere');
    expect(npcIdFor('marc-the-baker')).toBe('marc-the-baker');
    expect(npcIdFor('  Soren  ')).toBe('soren');
  });

  it('is idempotent — re-slugging a slug is a no-op', () => {
    expect(npcIdFor(npcIdFor('Marie la boulangère'))).toBe('marie-la-boulangere');
  });
});
