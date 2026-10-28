import { describe, expect, it } from 'vitest';
import { BANNED_IDIOMS, BANNED_LEXICON } from './bannedLexicon';

/**
 * LIFE-STORY-LEXICON-1 — the portentous-noun family, banned by name.
 *
 * Reported 2026-08-01, after LIFE-STORY-VOICE-1 shipped: "Still too many
 * titles, chapters and prose with the words echo, shadow, etc." One session
 * produced Le Dernier Souffle de Verre, L'Ombre-sur-Seine, the Syndicate of
 * Silence, the Archive of Unspoken Vows, the Echo-Heirs and The Final
 * Broadcast — saga title, place, factions and chapters, all from one lexicon.
 *
 * ── WHAT THIS FILE STILL OWNS, AFTER BATCH 5 ────────────────────────────────
 *
 * The RULE TEXT is gone from the client. `LEXICON_RULES` was PROMPT TEXT and
 * `life_saga` — its last client consumer — moved server-side in
 * SRV-PROMPT-8..13 batch 5, so the rendered lines live once, at
 * `functions/src/prompts/lifeLexiconRules.ts`. The rows that asserted them on a
 * naming surface MOVED rather than dying (SRV-PROMPT-3):
 *
 *   `life_world_arc`  → `functions/src/__tests__/lifeWorldArc.test.ts` (batch 3)
 *   `life_saga`       → `functions/src/__tests__/lifeSagaOpen.test.ts` (batch 5)
 *
 * What is LEFT here is the half that did not move: the two SCORER arrays, which
 * `tests/playthrough/ruleConformance.ts`, `rescore.ts` and `run.play.ts` count
 * against — and the INVERTED `life_step` row, because that surface is still
 * client-side (batch 8) and LIFE-SI-LEAN-7's measured decision to drop the rule
 * there is the thing worth pinning.
 *
 * ⚠ The scorer-to-prompt link is asserted in
 * `tests/playthrough/serverPromptParity.test.ts`, which is the only place in the
 * repo that can import both sides. It replaced the retired parity guard, and it
 * is stronger: the old one compared two copies of the rule text, this one ties
 * the words the benchmark COUNTS to the words the model is actually BANNED from.
 */

describe('LIFE-STORY-LEXICON-1 — the scored vocabulary', () => {
  it('names the words the owner named', () => {
    expect(BANNED_LEXICON).toContain('echo');
    expect(BANNED_LEXICON).toContain('shadow');
  });

  it('covers the vocabulary the reported session actually used', () => {
    for (const w of ['silence', 'unspoken', 'final', 'last breath']) {
      expect(BANNED_LEXICON, `missing "${w}"`).toContain(w);
    }
  });

  it('LIFE-STORY-LEXICON-2 — the stock warning-idioms are a LIST, not only prose', () => {
    // Same argument as the noun ban: "avoid cliché" is unobservable, a list is
    // checkable in one pass — and unlike a single banned noun, a stock idiom has
    // no innocent concrete use, so these are safely machine-countable.
    for (const s of ['the walls have ears', 'nothing here is what it seems']) {
      expect(BANNED_IDIOMS, `missing "${s}"`).toContain(s);
    }
  });

  it('SRV-PROMPT-3 — the RULE TEXT is gone from the client, the SCORERS stayed', async () => {
    // The split, asserted from this side. A re-added `LEXICON_RULES` here would
    // be a second copy of a prompt nobody serves — PRACTICE-OWN-8's exact
    // failure, and the reason the module that used to read it was deleted rather
    // than left importable.
    const mod = await import('./bannedLexicon');
    expect('LEXICON_RULES' in mod).toBe(false);
    expect(mod.BANNED_LEXICON.length).toBeGreaterThan(0);
    expect(mod.BANNED_IDIOMS.length).toBeGreaterThan(0);
  });
});

/**
 * ⚠ THE INVERTED `life_step` ROW MOVED with SRV-PROMPT-8..13 batch 8, to
 * `functions/src/__tests__/life/bannedLexiconStep.test.ts`.
 *
 * It asserts that the step SI does NOT carry `NAMING + WORD CHOICE` —
 * `LIFE-SI-LEAN-7` dropped it on measurement — and that assertion has to live
 * where the SI is built. The arrays above STAYED: they are the playthrough
 * SCORERS (`ruleConformance.ts`, `rescore.ts`, `run.play.ts` count against
 * them) and the server has no use for them as arrays.
 */
