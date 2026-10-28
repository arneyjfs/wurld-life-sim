/**
 * LIFE-NPC-9/10 — one id per person, and a cast that is not all called Marc.
 *
 * REPORTED 2026-08-03: duplicate avatar + description generations for one
 * baker, and *"everyone is called Marc or Elodie"* across unrelated worlds.
 *
 * ⚠ SPLIT BY SRV-PROMPT-8..13 batch 8. `renderNameRules` is PROMPT text and
 * moved here with the step prompt; `npcIdFor` is ENGINE code (`src/lib/life/
 * npcs.ts` — the roster writer reads it) and never migrates, so its half of
 * this file stayed behind as `src/lib/life/npcIdFor.test.ts`. The two halves
 * were one file because one report named both, not because they share code.
 */
import { describe, expect, it } from 'vitest';
import { overusedNamesFor, renderNameRules } from '../../prompts/lifeStepBlocks';

describe('LIFE-NPC-10 — name variety', () => {
  it('lists what this world already used, so one world has one Marc', () => {
    const out = renderNameRules({ practiceLanguage: 'French', inUse: ['Marc', 'Jimothée'] });
    expect(out).toContain('Marc, Jimothée');
    expect(out).toContain('one world, one Marc');
  });

  it('names the defaults the model reaches for, per language', () => {
    const fr = renderNameRules({ practiceLanguage: 'French', inUse: [] });
    expect(fr).toContain('Marc');
    expect(fr).toContain('Élodie');
    const es = renderNameRules({ practiceLanguage: 'Spanish (Spain)', inUse: [] });
    expect(es).toContain('Elena');
    expect(es).not.toContain('doNotReachFor>Marc');
  });

  it('a language with no measured list still renders the in-use half', () => {
    // The static list goes stale; the in-use half never does.
    const out = renderNameRules({ practiceLanguage: 'Welsh', inUse: ['Bartek'] });
    expect(overusedNamesFor('Welsh')).toEqual([]);
    expect(out).toContain('Bartek');
    expect(out).not.toContain('doNotReachFor');
  });

  it('dedupes and drops blanks rather than rendering an empty name', () => {
    const out = renderNameRules({ practiceLanguage: 'French', inUse: ['Marc', 'Marc', '', '  '] });
    expect(out).toContain('<alreadyInThisWorld>Marc</alreadyInThisWorld>');
  });

  it('renders an empty element at world open, not a broken block', () => {
    expect(renderNameRules({ practiceLanguage: 'French', inUse: [] })).toContain(
      '<alreadyInThisWorld/>',
    );
  });
});
