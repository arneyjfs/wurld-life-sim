/**
 * TTS-VOICE-1/2 — the voice table and the per-speaker pick.
 *
 * The table is TRANSCRIBED from Google's docs, so the assertions that matter
 * most are the ones that would catch a transcription slip: the count, the two
 * voices already validated in production, and the fact that the server's
 * allowlist says the same thing (a second copy is the only way the server can
 * validate a client-chosen name, and two copies drift).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE,
  GEMINI_VOICES,
  isKnownVoice,
  voiceForSpeaker,
} from './ttsVoices';

describe('TTS-VOICE-1 — the table matches the documentation', () => {
  it('has all 30 prebuilt voices, with no duplicates', () => {
    expect(GEMINI_VOICES).toHaveLength(30);
    expect(new Set(GEMINI_VOICES.map((v) => v.name)).size).toBe(30);
  });

  it('agrees with the two voices that were already in production', () => {
    // The cross-check that makes the other 28 trustworthy: the gender page and
    // the characteristics page independently give Iapetus male / Erinome
    // female, both "Clear" — which is what ttsSynth.ts had called them ("a
    // fixed clear Gemini voice") before this table existed.
    const iapetus = GEMINI_VOICES.find((v) => v.name === 'Iapetus');
    const erinome = GEMINI_VOICES.find((v) => v.name === 'Erinome');
    expect(iapetus).toMatchObject({ gender: 'male', characteristic: 'Clear' });
    expect(erinome).toMatchObject({ gender: 'female', characteristic: 'Clear' });
    expect(DEFAULT_VOICE).toEqual({ male: 'Iapetus', female: 'Erinome' });
  });

  it('has a usable pool of BOTH genders', () => {
    const male = GEMINI_VOICES.filter((v) => v.gender === 'male');
    const female = GEMINI_VOICES.filter((v) => v.gender === 'female');
    expect(male.length).toBe(16);
    expect(female.length).toBe(14);
  });

  it('every register bucket is reachable for both genders', () => {
    // A register that exists for only one gender would silently collapse to
    // the whole pool for the other — working, but not what the sheet asked.
    for (const gender of ['male', 'female'] as const) {
      const buckets = new Set(
        GEMINI_VOICES.filter((v) => v.gender === gender).map((v) => v.register),
      );
      expect(buckets, gender).toEqual(
        new Set(['warm', 'firm', 'bright', 'calm', 'rough']),
      );
    }
  });

  it('isKnownVoice accepts the table and rejects anything else', () => {
    expect(isKnownVoice('Sulafat')).toBe(true);
    expect(isKnownVoice('sulafat')).toBe(false); // exact casing — Cloud TTS is strict
    expect(isKnownVoice('Gandalf')).toBe(false);
    expect(isKnownVoice('')).toBe(false);
    expect(isKnownVoice(null)).toBe(false);
  });
});

describe('TTS-VOICE-2 — the per-speaker pick', () => {
  const pick = (over: Partial<Parameters<typeof voiceForSpeaker>[0]> = {}) =>
    voiceForSpeaker({ worldId: 'w1', speakerId: 'remy', gender: 'male', ...over });

  it('always returns a voice of the SPEAKER\'s gender', () => {
    for (const id of ['remy', 'sophie', 'bebert', 'n-1', 'x', 'a-very-long-npc-id']) {
      const male = voiceForSpeaker({ worldId: 'w1', speakerId: id, gender: 'male' });
      const female = voiceForSpeaker({ worldId: 'w1', speakerId: id, gender: 'female' });
      expect(GEMINI_VOICES.find((v) => v.name === male)?.gender, id).toBe('male');
      expect(GEMINI_VOICES.find((v) => v.name === female)?.gender, id).toBe('female');
    }
  });

  it('is STABLE — the same character keeps one voice, with nothing persisted', () => {
    expect(pick()).toBe(pick());
  });

  it('differs BETWEEN wurlds for the same character id', () => {
    // Owner: "hashed for each wurld but not between wurlds as register
    // changes." Two wurlds' Rémy are two different people.
    const a = new Set(
      ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map((w) =>
        voiceForSpeaker({ worldId: w, speakerId: 'remy', gender: 'male' }),
      ),
    );
    expect(a.size).toBeGreaterThan(1);
  });

  it('spreads across the pool rather than favouring one voice', () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) =>
        voiceForSpeaker({ worldId: 'w1', speakerId: `npc-${i}`, gender: 'female' }),
      ),
    );
    // 14 female voices; a hash that spreads at all should reach most of them.
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });

  it('narrows to the register when the character sheet declares one', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const v = voiceForSpeaker({
        worldId: 'w1', speakerId: id, gender: 'male', register: 'rough',
      });
      expect(GEMINI_VOICES.find((x) => x.name === v)?.register, id).toBe('rough');
    }
  });

  it('falls back to the whole gender pool rather than failing on an odd register', () => {
    const v = voiceForSpeaker({
      worldId: 'w1', speakerId: 'remy', gender: 'male',
      register: 'nonsense' as never,
    });
    expect(GEMINI_VOICES.find((x) => x.name === v)?.gender).toBe('male');
  });

  it('returns EMPTY with no gender — the caller falls back, it does not guess', () => {
    // Guessing a gender from an id is the defect this exists to fix.
    expect(voiceForSpeaker({ worldId: 'w1', speakerId: 'remy', gender: null })).toBe('');
    expect(voiceForSpeaker({ worldId: 'w1', speakerId: 'remy', gender: undefined })).toBe('');
  });
});

/**
 * The two copies. The server needs its own allowlist to validate a
 * client-chosen name (it cannot import from `src/`), and two hand-maintained
 * lists drift. This reads the server's source and compares — the same
 * technique `tests/playthrough/harnessShape.test.ts` uses for the harness.
 */
describe('TTS-VOICE-3 — the server allowlist matches this table', () => {
  it('names the identical 30 voices', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../functions/src/ttsSynth.ts'),
      'utf8',
    );
    // Scope to the Set literal itself. A looser slice also swallows the
    // "MALE" in `ttsVoiceForGender` below it — which is how this assertion
    // failed the first time, reporting drift that did not exist.
    const start = src.indexOf('GEMINI_VOICE_NAMES');
    const block = src.slice(start, src.indexOf('])', start));
    const names = [...block.matchAll(/"([A-Z][a-zA-Z]+)"/g)].map((m) => m[1]);
    expect(new Set(names)).toEqual(new Set(GEMINI_VOICES.map((v) => v.name)));
  });
});
