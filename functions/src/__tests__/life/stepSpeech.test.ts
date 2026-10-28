/**
 * MOVED from `src/lib/life/prompts/` by SRV-PROMPT-8..13 batch 8 (SRV-PROMPT-3:
 * a retired client prompt module is deleted and its tests MOVE rather than die).
 * The assertions are unchanged; only the imports point at the server modules.
 */
import { describe, expect, it } from 'vitest';
import { renderAlreadySpoken } from '../../prompts/lifeStepBlocks';

/**
 * LIFE-CONTRACT-BUBBLE-5 — the one beat after a `say` pick needs a SPEAKER.
 *
 * `renderAlreadySpoken` offered "the reply, or one short reaction" and never
 * said whose beat a reaction is. The model has one slot, an NPC who is
 * reacting, and the line test three sections away in the SI — so it writes the
 * narration into the NPC's bubble. "Padrig attrape la pièce avec un sourire
 * large" renders under Padrig's avatar as something Padrig SAID.
 *
 * Measured: 7% of npc beats in the full arm, 14% in the lean arm, 22% after
 * `LIFE-EX-CADENCE-7` raised the number of `say` picks — **12 of 17 following a
 * `say` pick**. The production fix amplified a bug it did not create; the cause
 * is this block being silent on the distinction at the point the choice is made.
 */
describe('LIFE-CONTRACT-BUBBLE-5 — the reaction beat is a NARRATOR beat', () => {
  const note = () => renderAlreadySpoken('Bonjour, ça va ?');

  it('names the speaker for BOTH of the two options it offers', () => {
    expect(note()).toMatch(/an "npc" beat carrying their words and nothing else/);
    expect(note()).toMatch(/a "narrator" beat, ALWAYS/);
  });

  it('quotes the failing shape back, because the model finds it obvious', () => {
    // The line the model reaches for is not a mistake it recognises as one —
    // it is the character's own moment, so attributing it to them feels right.
    // Naming the exact construction is what LIFE-STORY-VOICE-1 does for cliché.
    expect(note()).toMatch(/narration ABOUT Padrig, not something Padrig says/);
    expect(note()).toMatch(/can never be an npc beat/);
  });

  it('still states the one-beat budget it always did', () => {
    expect(note()).toMatch(/AT MOST ONE more beat/);
  });

  it('says nothing at all when no line was spoken', () => {
    expect(renderAlreadySpoken(null)).toBe('');
    expect(renderAlreadySpoken('   ')).toBe('');
  });
});
