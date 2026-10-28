/**
 * TTS-VOICE-7 — the audio starts loading before the question exists.
 *
 * The value here is entirely in WHEN and WITH WHAT: a prefetch whose request
 * differs from the eventual playback in any field lands on a different cache
 * key, so it is not a slower prefetch — it is a paid clip nobody ever hears.
 * Most of these assertions are about that exact equivalence.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tts', () => ({ prefetchTTS: vi.fn() }));
vi.mock('@/lib/life/debugLog', () => ({ lifeDebug: vi.fn() }));

import { prefetchTTS } from '@/lib/tts';
import { lifeDebug } from '@/lib/life/debugLog';
import { voiceForSpeaker } from '@/lib/ttsVoices';
import {
  pinPlannedUtterance,
  plannedSpokenLine,
  prefetchPlannedUtterance,
} from './nodeEngineVoice';
import type { GradedPlan, PracticePrompt } from '@/lib/life/stepSchema';
import type { LifeWorld } from '@/types/firestore';

const warm = vi.mocked(prefetchTTS);

const world = (over: Partial<LifeWorld> = {}): LifeWorld =>
  ({
    id: 'w1',
    characterName: 'Marc',
    practiceLanguage: 'French',
    nativeLanguage: 'English',
    difficulty: 3,
    worldSeedKey: 'city_life',
    rollingSummary: '',
    cast: [
      {
        id: 'remy', name: 'Rémy', known: 'the postman', voice: 'clipped',
        gender: 'male', voiceRegister: 'rough', tier: 'regular', standing: 0, ties: [],
      },
    ],
    ...over,
  }) as LifeWorld;

const comprehension = (over: Partial<Extract<GradedPlan, { kind: 'comprehension' }>> = {}) =>
  ({
    kind: 'comprehension',
    npcUtterance: 'Rends-moi ça.',
    speakerName: 'Rémy',
    npcId: 'remy',
    ...over,
  }) as GradedPlan;

beforeEach(() => vi.clearAllMocks());

describe('TTS-VOICE-7 — prefetchPlannedUtterance', () => {
  it('warms the planned utterance in the SPEAKER\'s voice', () => {
    prefetchPlannedUtterance(comprehension(), world(), 4);
    expect(warm).toHaveBeenCalledTimes(1);
    expect(warm.mock.calls[0]![0]).toMatchObject({
      text: 'Rends-moi ça.',
      speechSpeed: 4,
      voiceName: voiceForSpeaker({
        worldId: 'w1', speakerId: 'remy', gender: 'male', register: 'rough',
      }),
    });
    // DEAD-14: no legacy `preload` hint on the wire.
    expect(warm.mock.calls[0]![0]).not.toHaveProperty('preload');
  });

  it('passes the player\'s speechSpeed THROUGH, never a default of its own', () => {
    // The playback side resolves an absent speed from the profile and lets the
    // server default it. If this invented a 3 instead, the two would key
    // differently for every user who has never touched the slider.
    prefetchPlannedUtterance(comprehension(), world(), undefined);
    expect(warm.mock.calls[0]![0].speechSpeed).toBeUndefined();
  });

  it('warms a FILL-BLANK too — its line is the plan\'s sentenceContext', () => {
    // MISSED on the first pass, on the assumption that a listen-and-fill
    // speaks something only the chips can produce. It does not: the planner
    // writes the WHOLE sentence and names the token to blank, so the un-blanked
    // line exists before the generator has built a single chip.
    prefetchPlannedUtterance(
      { kind: 'generation', testTarget: 'voudrais', sentenceContext: 'Je voudrais un café' },
      world(),
      3,
    );
    expect(warm).toHaveBeenCalledTimes(1);
    expect(warm.mock.calls[0]![0].text).toBe('Je voudrais un café');
  });

  it('a FILL-BLANK keeps the PLAYER\'s voice — it is their own line', () => {
    // TTS-PREF-1. Passing an NPC voice here would put the player's words in
    // somebody else's mouth.
    prefetchPlannedUtterance(
      { kind: 'generation', testTarget: 'voudrais', sentenceContext: 'Je voudrais un café' },
      world(),
      3,
    );
    expect(warm.mock.calls[0]![0].voiceName).toBeUndefined();
  });

  it('stands down when the language has no speech support (TTS-LANG-1)', () => {
    prefetchPlannedUtterance(comprehension(), world({ practiceLanguage: 'Nonsense' }), 3);
    expect(warm).not.toHaveBeenCalled();
  });

  it('stands down on an empty utterance rather than warming silence', () => {
    prefetchPlannedUtterance(comprehension({ npcUtterance: '   ' }), world(), 3);
    expect(warm).not.toHaveBeenCalled();
  });

  it('still warms with NO voice when the cast has no gender — legacy worlds', () => {
    // The clip is the point; the voice is an improvement on top. A world
    // created before TTS-VOICE-5 must still get its audio early.
    const legacy = world({
      cast: [{ id: 'remy', name: 'Rémy', known: '', voice: '', tier: 'regular', standing: 0, ties: [] }],
    } as Partial<LifeWorld>);
    prefetchPlannedUtterance(comprehension(), legacy, 3);
    expect(warm).toHaveBeenCalledTimes(1);
    expect(warm.mock.calls[0]![0].voiceName).toBe('');
  });
});

describe('TTS-VOICE-7 — pinPlannedUtterance', () => {
  const prompt = (npcUtterance: string) =>
    ({
      kind: 'comprehension',
      npcUtterance,
      question: 'What is Rémy saying?',
      utteranceNativeText: 'Give that back.',
      speakerName: 'Rémy',
      npcId: 'remy',
    }) as PracticePrompt;

  it('leaves a verbatim copy untouched — the measured 100% case', () => {
    const p = prompt('Rends-moi ça.');
    expect(pinPlannedUtterance(p, comprehension())).toBe(p);
    expect(lifeDebug).not.toHaveBeenCalled();
  });

  it('PINS a paraphrase back to the plan, so the warmed clip is the one played', () => {
    const out = pinPlannedUtterance(prompt('Rends-moi cela tout de suite.'), comprehension());
    expect(out.kind === 'comprehension' && out.npcUtterance).toBe('Rends-moi ça.');
  });

  it('logs the divergence, so a drift rate stays visible instead of silent', () => {
    pinPlannedUtterance(prompt('something else entirely'), comprehension());
    expect(lifeDebug).toHaveBeenCalledWith(
      'STEP',
      expect.stringContaining('pinned'),
      expect.objectContaining({ planned: 'Rends-moi ça.' }),
    );
  });

  it('leaves a fill-blank prompt alone', () => {
    const fb = { kind: 'generation', practiceText: 'Je ___ un café' } as PracticePrompt;
    expect(pinPlannedUtterance(fb, comprehension())).toBe(fb);
  });
});

describe('TTS-VOICE-7 — plannedSpokenLine', () => {
  it('is the NPC utterance for a comprehension', () => {
    expect(plannedSpokenLine(comprehension())).toBe('Rends-moi ça.');
  });

  it('is the sentenceContext for a fill-blank — the COMPLETED sentence', () => {
    expect(
      plannedSpokenLine({
        kind: 'generation', testTarget: 'voudrais', sentenceContext: 'Je voudrais un café',
      }),
    ).toBe('Je voudrais un café');
  });

  it('is empty when the plan carries nothing to say', () => {
    expect(plannedSpokenLine(comprehension({ npcUtterance: '  ' }))).toBe('');
  });
});
