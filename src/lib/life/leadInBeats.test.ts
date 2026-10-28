/**
 * LIFE-CONTRACT-EX-6 — a question node's lead-in beats land the player's
 * ACTION, and may not pre-empt the line under test.
 */
import { describe, expect, it } from 'vitest';
import {
  leadInLeaksTestedLine,
  spokenKey,
  stripLeakingLeadIns,
  testedLineOf,
} from './leadInBeats';
import type { GradedPlan } from './stepSchema';

const comprehension: GradedPlan = {
  kind: 'comprehension',
  npcUtterance: 'Arrête ça, Jimothée ! Si tu la forces, cette lettre va se consumer.',
  speakerName: 'Rémy',
};
const fillBlank: GradedPlan = {
  kind: 'generation',
  testTarget: 'voudrais',
  sentenceContext: 'Je voudrais la lettre, s’il te plaît.',
};

const beat = (practiceText: string) => ({ practiceText });

describe('LIFE-CONTRACT-EX-6 — testedLineOf reads both directions', () => {
  it('inbound tests the NPC utterance', () => {
    expect(testedLineOf(comprehension)).toContain('Arrête ça');
  });
  it('outbound tests the sentence the PLAYER is about to say', () => {
    expect(testedLineOf(fillBlank)).toContain('Je voudrais');
  });
});

describe('LIFE-CONTRACT-EX-6 — the action may land, the tested line may not', () => {
  it('ALLOWS a beat narrating what the player did', () => {
    // The reported case: the pick was "grab the letter by force" and nothing
    // in the story ever said so. This beat is the whole point of the change.
    expect(
      leadInLeaksTestedLine(
        [beat('Tu plonges vers l’enveloppe, mais Rémy pivote.')],
        comprehension,
      ),
    ).toBe(false);
  });

  it('REJECTS a beat that already said the NPC line under test', () => {
    expect(leadInLeaksTestedLine([beat(comprehension.npcUtterance)], comprehension)).toBe(true);
  });

  it('REJECTS a beat that already said the player line under test', () => {
    // Outbound: the sentence IS the speech event the intercept sits in front
    // of. Saying it early spends the question and breaks LIFE-CONTRACT-EX-1.
    expect(leadInLeaksTestedLine([beat(fillBlank.sentenceContext)], fillBlank)).toBe(true);
  });

  it('catches a leak dressed in quotes and trailing punctuation', () => {
    expect(
      leadInLeaksTestedLine([beat(`« ${comprehension.npcUtterance} »…`)], comprehension),
    ).toBe(true);
  });

  it('does NOT reject a beat that merely SHARES words with the tested line', () => {
    // Equality, not containment. A lead-in that mentions the letter is normal;
    // rejecting it would make the honest case unwritable and push the model
    // back toward emitting nothing — the defect this whole change removes.
    expect(
      leadInLeaksTestedLine([beat('Rémy serre la lettre contre lui.')], comprehension),
    ).toBe(false);
  });

  it('an empty lead-in is always fine', () => {
    expect(leadInLeaksTestedLine([], comprehension)).toBe(false);
  });

  it('a plan with no tested line cannot leak', () => {
    expect(
      leadInLeaksTestedLine([beat('anything')], { ...comprehension, npcUtterance: '  ' }),
    ).toBe(false);
  });

  it('checks EVERY beat, not just the first', () => {
    expect(
      leadInLeaksTestedLine(
        [beat('Tu tends la main.'), beat(comprehension.npcUtterance)],
        comprehension,
      ),
    ).toBe(true);
  });
});

describe('LIFE-CONTRACT-EX-6 — spokenKey matches the LIFE-SPEECH-6 normalisation', () => {
  it('strips quotes, case, whitespace and terminal punctuation', () => {
    expect(spokenKey('  « Bonjour,   Marie ! »  ')).toBe('bonjour, marie');
  });
});

/**
 * LIFE-CONTRACT-EX-8 — a leak is REPAIRED, not retried-then-shipped.
 *
 * Reported 2026-08-07 with a screenshot: Madame Mora's warning landed as a
 * bubble, WITH its native translation, and the comprehension card underneath
 * then asked what she had just said. After answering, the same line arrived
 * again as the resolution bubble — so the leak also duplicated it.
 *
 * The cause is a ping-pong between two invariants, not a model whim.
 * `LIFE-CONTRACT-EX-7` rejects a question node with no lead-in and hints
 * *"what they did, and the world reacting to it"* — and for a comprehension
 * the world reacting IS the tested line. `MAX_ATTEMPTS` is 2, so attempt 0
 * fails EX-7, attempt 1 obeys the hint into an EX-6 leak, and there is no
 * attempt 2: the leak ships every time the ladder runs that way.
 *
 * So the leak stops being a retry. A beat that says the tested line is DROPPED
 * before validation, which also makes the ordering right: what remains is
 * judged by EX-7, so a node whose ONLY beat was the leak is correctly told it
 * narrated nothing rather than being told off for the leak it no longer has.
 */
describe('LIFE-CONTRACT-EX-8 — stripLeakingLeadIns', () => {
  it('drops the leaking beat and KEEPS the action beat — the reported shape', () => {
    // Exactly the screenshot: beat 0 is the player climbing the stool, beat 1
    // is Madame Mora's line, and beat 1 is what the question tests.
    const kept = stripLeakingLeadIns(
      [
        beat('Tu montes sur un vieux tabouret pour inspecter les grilles de plus près.'),
        beat('Attention, James ! Le métal est très vieux et il peut tomber sur tes pieds, eh ?'),
      ],
      {
        kind: 'comprehension',
        npcUtterance:
          'Attention, James ! Le métal est très vieux et il peut tomber sur tes pieds, eh ?',
        speakerName: 'Madame Mora',
      },
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.practiceText).toContain('tabouret');
  });

  it('returns the SAME array when nothing leaks — no needless churn', () => {
    const beats = [beat('Tu plonges vers l’enveloppe, mais Rémy pivote.')];
    expect(stripLeakingLeadIns(beats, comprehension)).toBe(beats);
  });

  it('can strip to EMPTY, so EX-7 gets to make the honest complaint', () => {
    // A node whose only beat was the leak has, after repair, narrated nothing.
    // That is a REAL EX-7 violation and should be reported as one — retrying
    // "you leaked the line" at a node that no longer contains it is the
    // ping-pong this invariant exists to end.
    expect(stripLeakingLeadIns([beat(comprehension.npcUtterance)], comprehension)).toEqual([]);
  });

  it('strips an outbound fill-blank lead-in too', () => {
    expect(
      stripLeakingLeadIns([beat('Je voudrais la lettre, s’il te plaît.')], fillBlank),
    ).toEqual([]);
  });

  it('matches on the SAME normalisation the detector uses', () => {
    // Punctuation/spacing drift must not smuggle the line through — the repair
    // and `leadInLeaksTestedLine` have to agree, or a leak survives repair and
    // then trips the validator it was supposed to have prevented.
    const kept = stripLeakingLeadIns(
      [beat('  Arrête ça, Jimothée !  Si tu la forces, cette lettre va se consumer.  ')],
      comprehension,
    );
    expect(kept).toEqual([]);
  });
});
