/**
 * LIFE-CONTRACT-BUBBLE-4. The first case is the exact string observed on beta
 * on 2026-07-21 — the player's own question, quote-wrapped, carrying a
 * narrator's attribution clause, rendered under an NPC's avatar.
 */
import { describe, expect, it } from 'vitest';
import {
  attributionSpeaker,
  hasAttributionWrapper,
  stripAttributionWrapper,
} from './utterance';

describe('LIFE-CONTRACT-BUBBLE-4 — a bubble holds the verbatim utterance only', () => {
  it('repairs the line seen on beta', () => {
    const r = stripAttributionWrapper('« Qu’est-ce que c’est que ce projet ? », demandes-tu.');
    expect(r.repaired).toBe(true);
    expect(r.text).toBe('Qu’est-ce que c’est que ce projet ?');
    expect(r.attribution).toBe('demandes-tu');
  });

  it('repairs the English gloss of the same line', () => {
    const r = stripAttributionWrapper('“What is this project?”, you ask.');
    expect(r.text).toBe('What is this project?');
    expect(r.attribution).toBe('you ask');
  });

  it('repairs a LEADING attribution too', () => {
    const r = stripAttributionWrapper('Elle demande : « Tu viens avec moi ? »');
    expect(r.text).toBe('Tu viens avec moi ?');
    expect(r.attribution).toBe('Elle demande');
  });

  it('unwraps a bare quoted line (the UI supplies its own quotes)', () => {
    const r = stripAttributionWrapper('« Bonjour ! »');
    expect(r.text).toBe('Bonjour !');
    expect(r.attribution).toBe('');
    expect(hasAttributionWrapper('« Bonjour ! »')).toBe(false);
  });

  it('LEAVES ALONE an utterance that legitimately contains a quotation', () => {
    // The dangerous false positive: stripping here would replace the whole
    // line with the single quoted word.
    const line = 'Il a dit « bonjour » hier, tu te souviens ?';
    const r = stripAttributionWrapper(line);
    expect(r.text).toBe(line);
    expect(hasAttributionWrapper(line)).toBe(false);
  });

  it('leaves a plain unquoted utterance untouched', () => {
    const line = 'Je voudrais un café, s’il vous plaît.';
    expect(stripAttributionWrapper(line).text).toBe(line);
    expect(hasAttributionWrapper(line)).toBe(false);
  });

  it('handles straight quotes and CJK brackets', () => {
    expect(stripAttributionWrapper('"Where are you going?", she asked.').text)
      .toBe('Where are you going?');
    expect(stripAttributionWrapper('「こんにちは」と彼女は言った。').text)
      .toBe('こんにちは');
  });

  it('survives empty / whitespace / quote-only input', () => {
    expect(stripAttributionWrapper('').text).toBe('');
    expect(stripAttributionWrapper('« »').text).toBe('« »');
  });
});

describe('LIFE-CONTRACT-BUBBLE-4 — whose line is it', () => {
  const names = { playerName: 'Jimothée', speakerName: 'Élise Laurent' };

  it('the speaker’s own name confirms the NPC', () => {
    expect(attributionSpeaker('dit Élise Laurent', names)).toBe('npc');
  });

  it('the player’s name re-attributes to the player', () => {
    expect(attributionSpeaker('demande Jimothée', names)).toBe('player');
  });

  it('the beta case: a 2nd-person attribution with NO name resolves to the player', () => {
    // « … », demandes-tu = "you ask". Names nobody, but "-tu" is 2nd person, so
    // it is the player's line — the exact screenshot bug. Name match handled
    // none of it; the subject-person fallback is what fixes it.
    expect(attributionSpeaker('demandes-tu', names)).toBe('player');
    expect(attributionSpeaker('you ask', names)).toBe('player');
    expect(attributionSpeaker('tu demandes', names)).toBe('player');
  });

  it('a 3rd-person attribution with no name resolves to the NPC', () => {
    expect(attributionSpeaker('dit-elle', names)).toBe('npc');
    expect(attributionSpeaker('demande-t-elle', names)).toBe('npc');
    expect(attributionSpeaker('she says', names)).toBe('npc');
  });

  it('returns unknown only when nothing is decisive — never a blind guess', () => {
    expect(attributionSpeaker('', names)).toBe('unknown');
    expect(attributionSpeaker('après un long silence', names)).toBe('unknown');
  });
});

/**
 * Review findings #4/#5/#8/#10/#12 — the detection rework. The old char-cap
 * both corrupted legit lines and missed long attributions; these lock the
 * speech-signal replacement.
 */
describe('LIFE-CONTRACT-BUBBLE-4 — detection precision (review #4/#5/#12)', () => {
  const kept = (line: string) => {
    const r = stripAttributionWrapper(line);
    expect(r.repaired, `should KEEP: ${line}`).toBe(false);
    expect(r.text).toBe(line);
  };
  const stripped = (line: string, to: string) =>
    expect(stripAttributionWrapper(line).text).toBe(to);

  it('#4 — keeps an utterance ABOUT a short quoted word', () => {
    kept('« Bonjour » est un mot français.');
    kept('“OK” is the most common word in English.');
  });
  it('#12 — keeps an NPC line that ENDS on a quoted word', () => {
    kept('Le code du coffre est « cygne ».');
  });
  it('#5 — strips a long novelistic attribution the old cap missed', () => {
    stripped('"Where is the key?" demanded the innkeeper suspiciously.', 'Where is the key?');
    stripped('« Assez ! » cria le vieux marin d’une voix rauque.', 'Assez !');
  });
  it('strips across Spanish / German / Italian / Portuguese attributions', () => {
    stripped('«¿Dónde estás?», preguntó María.', '¿Dónde estás?');
    stripped('„Wo bist du?“, fragte sie leise.', 'Wo bist du?');
    stripped('«Dove vai?», chiese lui.', 'Dove vai?');
  });
});

describe('LIFE-CONTRACT-BUBBLE-4 — attribution subject vs addressee (review #8/#10)', () => {
  const N = { playerName: 'Jimothée', speakerName: 'Élise Laurent' };
  it('#8 — "she says to you" is the NPC (you is the addressee, not the speaker)', () => {
    expect(attributionSpeaker('she says to you', N)).toBe('npc');
    expect(attributionSpeaker('dit-elle en te regardant', N)).toBe('npc');
  });
  it('#10 — a 2-char name does not match inside an unrelated word', () => {
    expect(attributionSpeaker('alors', { playerName: 'Al', speakerName: 'Bo' })).toBe('unknown');
  });
  it('a whole-token first name still matches the full roster name', () => {
    expect(attributionSpeaker('dit Élise', N)).toBe('npc');
  });
});

/**
 * Second-pass audit — the close-quote branch was over-eager. A genuine NPC line
 * that ENDS on a quoted word must survive; a narrator introducing a quote (with
 * a colon lead-in) still strips; and running the repair twice must be a no-op.
 */
describe('LIFE-CONTRACT-BUBBLE-4 — close-quote precision + idempotency (2nd-pass audit)', () => {
  it('KEEPS an NPC line that ends on a quoted word (no lead-in signal)', () => {
    for (const line of ['Elle m’a dit « non ».', 'He just said "no".', 'La réponse était « peut-être ».']) {
      const r = stripAttributionWrapper(line);
      expect(r.repaired, `should KEEP: ${line}`).toBe(false);
    }
  });

  it('STILL strips a narrator introducing a quote (colon lead-in)', () => {
    expect(stripAttributionWrapper('Elle demande : « Tu viens ? »').text).toBe('Tu viens ?');
    expect(stripAttributionWrapper('Le marin répondit — « Jamais ! »').text).toBe('Jamais !');
  });

  it('is a FIXPOINT — a second pass over a repaired line changes nothing', () => {
    const once = stripAttributionWrapper('« Qu’est-ce ? », demandes-tu.');
    expect(once.repaired).toBe(true);
    const twice = stripAttributionWrapper(once.text);
    expect(twice.repaired).toBe(false);
    expect(twice.text).toBe(once.text);
  });

  it('reports repaired:false for a whitespace-only difference (no spurious repair)', () => {
    const r = stripAttributionWrapper('  Je viens.  ');
    expect(r.repaired).toBe(false);
    expect(hasAttributionWrapper('  Je viens.  ')).toBe(false);
  });
});
