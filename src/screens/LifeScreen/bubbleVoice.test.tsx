/**
 * TTS-VOICE-9 — the SPEAK BUTTON ON THE BUBBLE uses the character's voice.
 *
 * Reported 2026-08-07: *"All the work you did attributing a tts voice to a
 * character, please make sure it is attached to the character also when the
 * button just above the message bubble is hit."*
 *
 * `TTS-VOICE-6` resolved the cast voice in `LifeScreen` and threaded it as
 * `speakerVoiceName` to exactly ONE consumer — `LifeScreenBottom` →
 * `ListenComprehensionCard`. That is the LISTENING EXERCISE. The per-bubble
 * button (`TTS-SURFACE-4`, the small speaker beside the NPC's name above their
 * bubble) is a different surface and was never given the voice, so tapping it
 * spoke Madame Mora in the player's own `voicePreference` — the exact thing
 * `TTS-VOICE-1` set out to stop, still happening on the surface the player
 * actually taps most.
 *
 * The USER bubble is the deliberate exception and is asserted here so a later
 * "fix" cannot quietly sweep it in: it is the player's own line, and it stays
 * on their own voice (`TTS-PREF-1`).
 */
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Capture what each bubble asks the shared button for. */
const seen: Array<Record<string, unknown>> = [];
vi.mock('@/components/TTSButton', () => ({
  TTSButton: (props: Record<string, unknown>) => {
    seen.push(props);
    return <div data-testid="TTSButton-stub" />;
  },
}));
vi.mock('./nodeEngineGlide', async (importActual) => ({
  ...(await importActual<typeof import('./nodeEngineGlide')>()),
  prefersReducedMotion: () => true,
}));

import { DialogueArea, type Bubble } from './DialogueArea';

afterEach(() => {
  seen.length = 0;
});

const npc = (over: Partial<Bubble> = {}): Bubble => ({
  id: 'b-npc',
  speaker: 'npc',
  speakerName: 'Madame Mora',
  npcId: 'madame-mora',
  practiceText: 'Attention, James !',
  ...over,
});

const view = (bubbles: Bubble[], voices?: ReadonlyMap<string, string>) =>
  render(
    <DialogueArea
      bubbles={bubbles}
      characterName="James"
      practiceLanguage="French"
      npcVoiceNames={voices}
    />,
  );

/** The props the button got for a bubble whose text matches. */
const askedFor = (text: string) =>
  seen.find((p) => p.text === text) as Record<string, unknown> | undefined;

describe('TTS-VOICE-9 — the npc bubble speaks in the CHARACTER\'s voice', () => {
  it('passes the cast voice for the bubble\'s npcId', () => {
    view([npc()], new Map([['madame-mora', 'Kore']]));
    expect(askedFor('Attention, James !')?.voiceName).toBe('Kore');
  });

  it('two different NPCs on screen get their OWN voices — the whole point', () => {
    // One shared default would be indistinguishable from the old behaviour on a
    // single-NPC screen, so the discriminating case is two speakers at once.
    view(
      [
        npc(),
        npc({ id: 'b2', npcId: 'zalo-benn', speakerName: 'Zalo', practiceText: 'Par ici.' }),
      ],
      new Map([['madame-mora', 'Kore'], ['zalo-benn', 'Puck']]),
    );
    expect(askedFor('Attention, James !')?.voiceName).toBe('Kore');
    expect(askedFor('Par ici.')?.voiceName).toBe('Puck');
  });

  it('an UNCAST npc falls back to the player\'s voice, not to somebody else\'s', () => {
    // Every world created before TTS-VOICE-5 has no gender on its cast, so this
    // is the common path for existing wurlds — it must land on the OLD
    // behaviour rather than on an arbitrary pool entry.
    view([npc()], new Map());
    expect(askedFor('Attention, James !')?.voiceName).toBeFalsy();
  });

  it('a TRANSIENT npc — no npcId at all — also falls back', () => {
    view([npc({ npcId: null })], new Map([['madame-mora', 'Kore']]));
    expect(askedFor('Attention, James !')?.voiceName).toBeFalsy();
  });

  it('survives the map being absent entirely', () => {
    view([npc()]);
    expect(askedFor('Attention, James !')?.voiceName).toBeFalsy();
  });
});

describe('TTS-VOICE-9 — the USER bubble keeps the player\'s own voice', () => {
  it('never carries a cast voice — it is the player speaking (TTS-PREF-1)', () => {
    // Guard against the obvious over-reach while fixing this: putting the
    // player's line in an NPC's mouth.
    view(
      [{ id: 'b-user', speaker: 'user', practiceText: 'Je voudrais un café.' }],
      new Map([['madame-mora', 'Kore']]),
    );
    expect(askedFor('Je voudrais un café.')?.voiceName).toBeFalsy();
  });
});
