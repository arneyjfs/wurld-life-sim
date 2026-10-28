import { practiceStatsKey, type Difficulty } from '@/types/firestore';
import { DEFAULT_DIFFICULTY } from './xp';

/**
 * One level and one speech speed per practice language
 * (docs/specs/xp.md §4a XP-LANG-*, tts.md TTS-SPEED-1.2). Pure readers; the
 * writers are `writeLanguageLevel` / `writeLanguageSpeechSpeed` in
 * `./settings`. The server twin of `levelFor` is `functions/src/level.ts`.
 */

export type SpeechSpeed = 1 | 2 | 3 | 4;

type LevelSource = {
  difficulty?: number | null;
  levels?: Record<string, unknown> | null;
  speechSpeed?: number | null;
  speechSpeeds?: Record<string, unknown> | null;
} | null | undefined;

/** XP-LANG-1 — the map key: the language's `practiceStats` doc id. */
export function levelKey(language: string): string {
  return practiceStatsKey(language);
}

function intIn(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
}

/** XP-LANG-1/3 + XP-LEVEL-7 — the language's own level, else the starting
 *  level `users.difficulty`, else 2. No language → the starting level. */
export function levelFor(user: LevelSource, language: string | null | undefined): Difficulty {
  const own = language ? intIn(user?.levels?.[levelKey(language)], 1, 7) : undefined;
  return (own ?? intIn(user?.difficulty, 1, 7) ?? DEFAULT_DIFFICULTY) as Difficulty;
}

/** TTS-SPEED-1.2 — the language's own speed, else the global `speechSpeed`,
 *  else undefined (natural pace, the server's default). */
export function speechSpeedFor(user: LevelSource, language: string | null | undefined): SpeechSpeed | undefined {
  const own = language ? intIn(user?.speechSpeeds?.[levelKey(language)], 1, 4) : undefined;
  return (own ?? intIn(user?.speechSpeed, 1, 4)) as SpeechSpeed | undefined;
}

/** SETTINGS-LANG-1 — the profile's practice language first, then every
 *  other language from chats and flashcards, de-duplicated, alphabetical. */
export function userPracticeLanguages(input: {
  learningLanguage: string | null | undefined;
  chatLanguages: readonly (string | null | undefined)[];
  cardLanguages: readonly (string | null | undefined)[];
}): string[] {
  const first = input.learningLanguage || undefined;
  const rest = new Set<string>();
  for (const l of [...input.chatLanguages, ...input.cardLanguages]) {
    if (l && l !== first) rest.add(l);
  }
  return [...(first ? [first] : []), ...[...rest].sort((a, b) => a.localeCompare(b))];
}
