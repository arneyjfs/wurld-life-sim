/**
 * The CLIENT document shapes the moved `life_step` prompt tests build fixtures
 * from, declared structurally.
 *
 * SRV-PROMPT-8..13 batch 8 moved those tests here (SRV-PROMPT-3: tests move
 * rather than die) and `functions/` holds no copy of `@/types/firestore` — by
 * design, since a second copy of the Firestore contract is a second thing to
 * get wrong. The fixtures only ever set a handful of fields and the assertions
 * are about rendered TEXT, so a permissive structural type is the honest
 * declaration: it lets the fixtures compile without claiming to be the schema.
 */
export type LifeWorld = Record<string, unknown> & {
  characterName?: string;
  practiceLanguage?: string;
  nativeLanguage?: string;
  difficulty?: number;
  worldSeedKey?: string;
};

export type LifeEvent = {
  id?: string;
  kind: string;
  payload?: Record<string, unknown>;
  createdAt?: { toMillis: () => number };
};

export type WorldArc = Record<string, unknown> & {
  chapterNumber?: number;
  premise?: string;
  themes?: string[];
  recurringNpcIds?: string[];
  completedSceneMemories?: Array<{ title: string; summary: string }>;
};

export type LifeNpc = Record<string, unknown> & { id: string; name: string };
export type LifeScene = Record<string, unknown> & { id: string };
export type GoalLadderDoc = Record<string, unknown>;
