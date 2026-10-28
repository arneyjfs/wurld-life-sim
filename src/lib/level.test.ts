import { describe, expect, it } from 'vitest';
import { levelFor, levelKey, speechSpeedFor, userPracticeLanguages } from './level';

describe('per-language level — docs/specs/xp.md §4a', () => {
  it('XP-LANG-1 — a language reads its own entry first', () => {
    const user = { difficulty: 3 as const, levels: { french: 5, spanish: 1 } };
    expect(levelFor(user, 'French')).toBe(5);
    expect(levelFor(user, 'Spanish')).toBe(1);
  });

  it('XP-LANG-1 — the key is practiceStatsKey (the practiceStats doc id)', () => {
    expect(levelKey('Portuguese (Brazilian)')).toBe('portuguese_brazilian');
    expect(levelFor({ levels: { portuguese_brazilian: 6 } }, 'Portuguese (Brazilian)')).toBe(6);
  });

  it('XP-LANG-3 — a language with no entry starts at users.difficulty', () => {
    expect(levelFor({ difficulty: 4, levels: { french: 6 } }, 'German')).toBe(4);
  });

  it('XP-LEVEL-7 — nothing stored reads 2', () => {
    expect(levelFor({}, 'French')).toBe(2);
    expect(levelFor(null, 'French')).toBe(2);
    expect(levelFor({ difficulty: 5 }, undefined)).toBe(5);
  });

  it('XP-LANG-1 — a drifted entry reads as absent', () => {
    expect(levelFor({ difficulty: 3, levels: { french: 9 } }, 'French')).toBe(3);
    expect(levelFor({ difficulty: 3, levels: { french: 2.5 } }, 'French')).toBe(3);
    expect(levelFor({ difficulty: 3, levels: { french: 'x' as unknown as number } }, 'French')).toBe(3);
  });
});

describe('per-language speech speed — docs/specs/tts.md TTS-SPEED-1.2', () => {
  it('TTS-SPEED-1.2 — own entry, else the global speechSpeed, else undefined', () => {
    const user = { speechSpeed: 2 as const, speechSpeeds: { japanese: 1 } };
    expect(speechSpeedFor(user, 'Japanese')).toBe(1);
    expect(speechSpeedFor(user, 'French')).toBe(2);
    expect(speechSpeedFor({}, 'French')).toBeUndefined();
    expect(speechSpeedFor({ speechSpeeds: { french: 7 } }, 'French')).toBeUndefined();
  });
});

describe('practice languages — docs/specs/settings-screen.md SETTINGS-LANG-1', () => {
  it('SETTINGS-LANG-1 — profile language first, then chats + cards, de-duplicated and sorted', () => {
    expect(
      userPracticeLanguages({
        learningLanguage: 'Spanish',
        chatLanguages: ['Japanese', undefined, 'Spanish', 'French'],
        cardLanguages: ['French', 'German', ''],
      }),
    ).toEqual(['Spanish', 'French', 'German', 'Japanese']);
  });

  it('SETTINGS-LANG-1 — no profile language still lists the rest', () => {
    expect(userPracticeLanguages({ learningLanguage: undefined, chatLanguages: [], cardLanguages: ['Italian'] })).toEqual([
      'Italian',
    ]);
  });
});
