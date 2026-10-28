/**
 * MOVED from `src/lib/life/prompts/` by SRV-PROMPT-8..13 batch 8 (SRV-PROMPT-3:
 * a retired client prompt module is deleted and its tests MOVE rather than die).
 * The assertions are unchanged; only the imports point at the server modules.
 */
import { describe, expect, it } from 'vitest';
import { buildStepPromptFromWorld as buildLifeStepPrompt } from '../helpers/stepFixture';
import type { StepPracticeOutcome as PracticeOutcomeForPrompt } from '../../prompts/lifeStep';

/** The client-shaped fixture these tests were written against. */
type LifeStepInput = Record<string, unknown>;
import type { LifeWorld } from '../helpers/stepTypes';

/**
 * LIFE-SPEECH-2 — a `say` pick tells the model the line it ALREADY SPOKE.
 *
 * Reported 2026-07-31: "I click an option saying 'tell them I am lost', my
 * character says it, then the npc says it from their character."
 *
 * The cause is an ordering one, not a prompt-compliance one. `saysLine` rides
 * on the OPTION and is prepended as the player's bubble at ARRIVAL — which
 * happens *after* the generation that authors the reply. So at generation time
 * the model's entire view of the turn was the system-language menu label:
 *
 *     <turn kind="choice" speechAct="say"><choice id="lost">Tell them I am
 *     lost</choice></turn>
 *
 * It has been told the player SAID something but never what. So it stages the
 * speech itself — and because `LIFE-SPEECH-1`'s PLAYER-VOICE RULE forbids a
 * `user` beat, the utterance lands in an NPC's mouth. The rule was doing its
 * job; the information was missing.
 *
 * The line has to reach the SAME call that writes the reply.
 */
const baseWorld: LifeWorld = {
  id: 'main',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
};

const build = (choice: NonNullable<LifeStepInput['choice']>) =>
  buildLifeStepPrompt({
    world: baseWorld,
    events: [],
    systemLanguage: 'English',
    choice,
  } as unknown as LifeStepInput);

describe('LIFE-SPEECH-2 — the spoken line reaches the generating call', () => {
  it('LIFE-SPEECH-2 — a say pick carries the line verbatim', () => {
    const out = build({
      id: 'lost',
      practiceText: 'Tell them I am lost',
      speechAct: 'say',
      saysLine: 'Je suis perdu, je crois.',
    });
    expect(out).toContain('Je suis perdu, je crois.');
  });

  it('LIFE-SPEECH-2 — and states that it is ALREADY on screen', () => {
    // Without this the model can see the line and still re-stage it, because
    // nothing said it had landed. The instruction and the data must arrive
    // together.
    const out = build({
      id: 'lost',
      practiceText: 'Tell them I am lost',
      speechAct: 'say',
      saysLine: 'Je suis perdu, je crois.',
    });
    expect(out).toMatch(/alreadySpoken|already on screen|ALREADY/i);
  });

  it('LIFE-SPEECH-2 — an "act" pick carries no spoken line', () => {
    const out = build({ id: 'look', practiceText: 'Look around', speechAct: 'act' });
    expect(out).not.toMatch(/alreadySpoken/);
  });

  it('LIFE-SPEECH-2 — a say pick with no saysLine degrades to the old shape', () => {
    // Older clients / the graded path do not set it. Must not emit an empty
    // attribute that reads as "the player said nothing".
    const out = build({ id: 'greet', practiceText: 'Greet her', speechAct: 'say' });
    expect(out).toContain('speechAct="say"');
    expect(out).not.toMatch(/alreadySpoken=""/);
  });
});

/**
 * LIFE-SPEECH-6 — the SAME hole, one branch over.
 *
 * Reported 2026-08-05: "occasionally when i get a question that's directed from
 * ME saying something (e.g. fill blank) it shows in the events as both me and
 * the NPC saying the line, one after the other."
 *
 * Identical mechanism to LIFE-SPEECH-2 above, identical fix — but the
 * `practiceOutcome` branch was written separately and never got it. It sent
 * only the graded metadata (picked / correctAnswer / promptSource), so the
 * model knew a fill-blank had been answered and had NO idea the finished
 * sentence was already a bubble on screen. It staged the speech, the
 * PLAYER-VOICE RULE barred a `user` beat, and the player's own words came back
 * out of an NPC.
 */
describe('LIFE-SPEECH-6 — the resolved graded line reaches the next call', () => {
  const buildOutcome = (practiceOutcome: PracticeOutcomeForPrompt) =>
    buildLifeStepPrompt({
      world: baseWorld,
      events: [],
      systemLanguage: 'English',
      practiceOutcome,
    } as unknown as LifeStepInput);

  const graded: PracticeOutcomeForPrompt = {
    kind: 'generation',
    correct: true,
    picked: 'voudrais',
    correctAnswer: 'voudrais',
    promptSource: 'Je ___ un café.',
  };

  it('LIFE-SPEECH-6 — a fill-blank sends the completed line, marked already-spoken', () => {
    const out = buildOutcome({
      ...graded,
      resolvedLine: 'Je voudrais un café, s\'il vous plaît.',
      resolvedSpeaker: 'user',
    });
    expect(out).toContain('Je voudrais un café, s\'il vous plaît.');
    expect(out).toMatch(/<alreadySpoken>/);
    expect(out).toMatch(/ALREADY on screen/i);
  });

  it('LIFE-SPEECH-6 — a comprehension attributes the line to the NPC who said it', () => {
    // The inbound half lands as an NPC bubble, so the note must not call it the
    // player's own — but the do-not-repeat instruction is the same one.
    const out = buildOutcome({
      ...graded,
      kind: 'comprehension',
      resolvedLine: 'Le train part dans dix minutes.',
      resolvedSpeaker: 'npc',
    });
    expect(out).toContain('<alreadySpoken by="npc">');
    expect(out).not.toMatch(/player's own bubble/);
    expect(out).toMatch(/ALREADY on screen/i);
  });

  it('LIFE-SPEECH-6 — no resolved line emits no block and no empty attribute', () => {
    const out = buildOutcome(graded);
    expect(out).toContain('kind="practiceOutcome"');
    expect(out).not.toMatch(/alreadySpoken/);
  });
});
