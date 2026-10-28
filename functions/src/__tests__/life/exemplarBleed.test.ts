/**
 * LIFE-STORY-EXEMPLAR-1 — the world-creation prompts may not name a specific
 * ORDINARY PLACE as their worked example.
 *
 * THE DEFECT, reported 2026-08-07: *"Why is this story taking me to a bakery?
 * Every story involves a bakery. This is not the first feature that is heavily
 * recycled. Before it was the same names everywhere and before that the same
 * cliches. What structurally is leading to lack in variation?"*
 *
 * THIS FILE IS DELIBERATELY NARROWER THAN THAT REPORT, because the measurement
 * over the 56 distinct worlds in `.playthroughs/` only supports the narrow
 * claim. Both halves are recorded here so the next person does not redo them.
 *
 * WHAT THE EVIDENCE SUPPORTS — the bakery, WITHIN a seed:
 *
 *   country_life       9/10   90%      frontier_colony   0/11   0%
 *   restaurant         2/3    67%      magic_university  0/3    0%
 *   magic_apprentice   5/8    63%      outlaw_trail      0/2    0%
 *   farm_life          1/3    33%      noir_detective    0/2    0%
 *                                      heist             0/1    0%
 *
 * It does NOT bleed across genres — the sci-fi and western seeds have none. It
 * saturates the seeds where a bakery is plausible, and 90% is not plausibility,
 * it is a default. `sagaOpen` — the FIRST call, whose `places` every later call
 * reads — literally offered *"a bakery, a ferry, a night watchman"* as its
 * worked example of an ordinary place. That is the one lever here worth pulling.
 *
 * WHAT THE EVIDENCE REFUTES — prompt language moving NAMES, in either direction:
 *
 *   used as a worked EXAMPLE     Sophie 1.8%   Marc 10.7%   Sabine 12.5%   Marcel 17.9%
 *   on the <doNotReachFor> BAN   Élodie 10.7%  Claire 16.1% Luc 17.9%      Elena 17.9%
 *   never in any prompt at all   Elara 12.5%   Hana 12.5%   Paco 14.3%     Lucía 19.6%
 *
 * Three groups, one band. A name the prompts demonstrate constantly (Sophie)
 * is RARER than names they explicitly forbid, and both are indistinguishable
 * from names the prompts have never heard of. So `LIFE-NPC-10`'s two
 * mechanisms — the worked examples it rewrote and the `<doNotReachFor>` list it
 * added — are both inert, and no amount of further prompt wording will change
 * that. Name variety is not a prompt problem; it is answered by
 * `worldTexture.ts` (LIFE-STORY-EXEMPLAR-2), which varies the CONTEXT per
 * world instead of arguing with the model inside a constant one.
 *
 * Hence: this guard covers PLACES on the WORLD-CREATION surfaces only. It is
 * not a general blocklist, and it deliberately does not assert anything about
 * names.
 */
import { describe, expect, it } from 'vitest';
import { lifeVocabAnnotationRules } from '../../prompts/lifeStepSI';
import { lifeStepSystemInstruction } from '../../prompts/lifeStep';

/**
 * The one place-noun family measured as saturating its seeds.
 *
 * Short and evidence-backed on purpose — a long list of forbidden nouns spends
 * tokens and pushes the model to whatever sits just outside it, which is the
 * argument `npcNames.ts` already makes about names and which the table above
 * shows it was right about.
 */
const RECYCLED_PLACES = ['bakery', 'baker', 'boulanger', 'boulangerie'] as const;

/** The calls that DECIDE the world's places, plus the two that demonstrate
 *  prose to every turn. The backdrop image prompt is out of scope: it receives
 *  an already-chosen `locationType` and only says how to draw one, so its "a
 *  bakery has a display window" cannot influence a story that never asked.
 *
 *  The second prose surface used to be `stepVoice.ts`'s `VOICE_RULES` +
 *  `GENTLE_INTRODUCTION_RULES`. That module was DELETED on 2026-09-18: its only
 *  importer was `prompts/stepTurn.ts`, which nothing in the app imported
 *  either, so this guard was the last thing reading it — it asserted against a
 *  prompt no player has ever been served. The entry moved to
 *  `lifeStepSystemInstruction`, the SHIPPED `life_step` SI, which carries the
 *  same two rules in their ported form and, unlike the constants, actually
 *  reaches the model: gentle introductions at `stepLean.ts:102` (`PEOPLE: … one
 *  clause says who they are TO THE PLAYER — "Gaël, the man teaching you the
 *  trade", "Yannick from the shop downstairs"`) and voice at `stepLean.ts:104`
 *  (`PROSE: say the concrete thing … a tray set down beats "tension filled the
 *  room"`). Both are WORKED EXAMPLES of ordinary places and people, which is
 *  exactly the shape this file exists to police — so the guard is now pointed
 *  at the surface where a bakery could actually bleed into a story.
 *  (`SRV-PROMPT-3` — a retired prompt module's tests MOVE rather than die.) */
const SURFACES: Array<[string, string]> = [
  // ⚠ The `sagaOpen` row MOVED rather than dying (SRV-PROMPT-3, the same rule
  // the notes above record for `stepVoice` and `worldArc`). `life_saga` became
  // server-owned in SRV-PROMPT-8..13 batch 5, so its SI is built by
  // `functions/src/prompts/lifeSagaOpen.ts` and the `app` vitest project cannot
  // import it. The assertion lives at
  // `functions/src/__tests__/lifeSagaOpen.test.ts`
  // ("the world-open SI demonstrates no bakery"), running the same regex over
  // the same four nouns — on BOTH arms of the succession fork, which this row
  // never did. Its companion ("asks for the ROLE a place fills") moved with it.
  //
  // ⚠ THIS WAS THE MOST IMPORTANT ROW IN THE TABLE and it must not quietly
  // vanish: `sagaOpen` is the FIRST call in the chain and its `places` feed
  // every later prompt, which is why the bakery reached 9 of 10 `country_life`
  // worlds. Deleting it here without landing it there would have retired the
  // guard on the surface that MINTS the world's places.
  // ⚠ The `bio` row MOVED rather than dying (SRV-PROMPT-3, the same rule the
  // notes above and below record for `stepVoice`, `sagaOpen` and `worldArc`).
  // `life_bio` became server-owned in SRV-PROMPT-8..13 batch 6, so its SI is
  // built by `functions/src/prompts/lifeBio.ts` and the `app` vitest project
  // cannot import it. The assertion lives at
  // `functions/src/__tests__/lifeBio.test.ts`
  // ("the bio SI demonstrates no bakery"), running the same regex over the same
  // four nouns, plus the non-triviality check this table applies to every row.
  //
  // ⚠ IT WAS THE LAST WORLD-CREATION SURFACE IN THIS TABLE. `sagaOpen` left in
  // batch 5 and `worldArc` in batch 3; what remains below are the two per-TURN
  // prose surfaces, which are batch 8's. The bio is the prompt that writes the
  // player's own JOB and NEIGHBOURHOOD, so dropping it here without landing it
  // there would have retired the guard on the two fields most able to put a
  // bakery in a life.
  // ⚠ The `worldArc` row MOVED rather than dying (SRV-PROMPT-3, the same rule
  // the note above records for `stepVoice`). `life_world_arc` became
  // server-owned in SRV-PROMPT-8..13 batch 3, so its SI is built by
  // `functions/src/prompts/lifeWorldArc.ts` and the `app` vitest project cannot
  // import it. The assertion lives at
  // `functions/src/__tests__/lifeWorldArc.test.ts`
  // ("the chapter-arc SI demonstrates no bakery"), running the same regex over
  // the same four nouns. Deleting it here without landing it there would have
  // retired the guard on the one surface that MINTS the chapter's places.
  ['vocabRules', lifeVocabAnnotationRules('French', 'English')],
  [
    'lifeStep (shipped SI)',
    lifeStepSystemInstruction({
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'English',
      difficulty: 4,
    }),
  ],
];

describe('LIFE-STORY-EXEMPLAR-1 — no world-creation prompt demonstrates a bakery', () => {
  for (const [name, text] of SURFACES) {
    it(`${name} — names no specific ordinary place`, () => {
      const found = RECYCLED_PLACES.filter((w) =>
        new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, 'iu').test(text),
      );
      expect(found, `${name} still teaches: ${found.join(', ')}`).toEqual([]);
    });
  }

  it('the table is not empty, and still covers every surface left client-side', () => {
    // Non-vacuous: a `for` loop over an accidentally-emptied array is a suite
    // that passes with nothing to say, and this table has now lost three rows to
    // migrations (`worldArc` in batch 3, `sagaOpen` in batch 5, `bio` in batch
    // 6). Pinned by NAME so a fourth row cannot leave without a deliberate edit
    // here — and what is left are the two per-TURN surfaces, so the next
    // departure empties the table and the file should go with it.
    expect(SURFACES.map(([n]) => n)).toEqual([
      'vocabRules',
      'lifeStep (shipped SI)',
    ]);
    for (const [name, text] of SURFACES) {
      expect(text.length, name).toBeGreaterThan(200);
    }
  });
});
