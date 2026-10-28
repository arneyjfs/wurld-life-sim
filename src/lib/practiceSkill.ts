import type { PracticeQuestionType } from '@/lib/practiceGenerator/types';

/**
 * PRACTICE-SKILL-* — the custom session's question-type filter: every type,
 * or only the reading / writing / listening ones. Spec:
 * docs/specs/practice-mode.md §3.2.
 */
export const PRACTICE_SKILLS = ['all', 'reading', 'writing', 'listening'] as const;
export type PracticeSkill = (typeof PRACTICE_SKILLS)[number];
export type PracticeSkillFilter = Exclude<PracticeSkill, 'all'>;

/** PRACTICE-SKILL-3 — the one skill each question type practises. */
const SKILL_OF_TYPE: Record<PracticeQuestionType, PracticeSkillFilter> = {
  'multiple-choice': 'reading',
  'practice-to-native': 'reading',
  'vocab-matching': 'reading',
  'native-to-practice': 'writing',
  'fill-the-blank': 'writing',
  'find-the-mistake': 'writing',
  'listen-and-pick': 'listening',
  'listen-and-fill': 'listening',
  'listen-and-write': 'listening',
};

export function skillOfType(type: PracticeQuestionType): PracticeSkillFilter {
  return SKILL_OF_TYPE[type];
}

/** PRACTICE-SKILL-2 — the `?skill=` value; anything unrecognised is `all`. */
export function parsePracticeSkill(raw: string | null | undefined): PracticeSkill {
  return (PRACTICE_SKILLS as readonly string[]).includes(raw ?? '') ? (raw as PracticeSkill) : 'all';
}

/**
 * PRACTICE-SKILL-4 — `types` narrowed to `skill`. A filter that would leave
 * nothing (listening for a language without speech) returns `types` whole, so
 * the session is a normal one rather than empty.
 */
export function typesForSkill<T extends PracticeQuestionType>(types: T[], skill: PracticeSkill): T[] {
  if (skill === 'all') return types;
  const narrowed = types.filter((t) => SKILL_OF_TYPE[t] === skill);
  return narrowed.length ? narrowed : types;
}
